from __future__ import annotations

import asyncio
import json
import logging
import time
import urllib.request
from dataclasses import dataclass
from typing import Any

import websockets

from ..bus import Event, EventBus
from ..models import BookState

BINANCE_REST = "https://api.binance.com/api/v3/depth"
LOG = logging.getLogger(__name__)


@dataclass
class BinanceL2BookBuilder:
    symbol: str
    top_n: int
    bus: EventBus
    depth_limit: int = 5000
    ws_url: str | None = None
    resync_backoff: float = 1.0
    emit_full: bool = False

    def __post_init__(self) -> None:
        if self.ws_url is None:
            stream = f"{self.symbol.lower()}@depth@100ms"
            self.ws_url = f"wss://stream.binance.com:9443/ws/{stream}"
        self.bids: dict[float, float] = {}
        self.asks: dict[float, float] = {}
        self.book_update_id: int = 0
        self._resync_count = 0
        self._last_event_ts = 0

    async def start(self, stop_evt: asyncio.Event) -> None:
        while not stop_evt.is_set():
            try:
                await self._run_once(stop_evt)
            except Exception:
                self._resync_count += 1
                LOG.warning("binance_l2 resync #%d", self._resync_count)
                await asyncio.sleep(self.resync_backoff)

    async def _run_once(self, stop_evt: asyncio.Event) -> None:
        self.bids.clear()
        self.asks.clear()
        self.book_update_id = 0
        event_q: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        first_u: int | None = None
        buffered: list[dict[str, Any]] = []

        async def _receiver(ws) -> None:
            nonlocal first_u
            async for raw in ws:
                msg = json.loads(raw)
                event = msg
                if "data" in msg and isinstance(msg["data"], dict):
                    event = msg["data"]
                if not isinstance(event, dict):
                    continue
                if event.get("e") != "depthUpdate":
                    continue
                if first_u is None:
                    try:
                        first_u = int(event.get("U") or 0)
                    except Exception:
                        first_u = 0
                await event_q.put(event)

        async with websockets.connect(self.ws_url, ping_interval=20, ping_timeout=20) as ws:
            recv_task = asyncio.create_task(_receiver(ws))
            try:
                while first_u is None and not stop_evt.is_set():
                    await asyncio.sleep(0.01)
                snapshot = self._fetch_snapshot()
                if not snapshot:
                    return
                last_id = int(snapshot["lastUpdateId"])
                while first_u is not None and last_id < first_u:
                    snapshot = self._fetch_snapshot()
                    if not snapshot:
                        return
                    last_id = int(snapshot["lastUpdateId"])

                self._load_snapshot(snapshot)
                self.book_update_id = last_id

                while not event_q.empty():
                    buffered.append(event_q.get_nowait())

                applied = False
                for event in buffered:
                    u = int(event.get("u") or 0)
                    U = int(event.get("U") or 0)
                    if u <= self.book_update_id:
                        continue
                    if U <= self.book_update_id + 1 <= u:
                        self._apply_event(event)
                        self.book_update_id = u
                        applied = True
                    elif U > self.book_update_id + 1:
                        raise RuntimeError("binance_l2_gap")

                if not applied:
                    while True:
                        event = await event_q.get()
                        u = int(event.get("u") or 0)
                        U = int(event.get("U") or 0)
                        if u <= self.book_update_id:
                            continue
                        if U <= self.book_update_id + 1 <= u:
                            self._apply_event(event)
                            self.book_update_id = u
                            break
                        if U > self.book_update_id + 1:
                            raise RuntimeError("binance_l2_gap")

                while not stop_evt.is_set():
                    event = await event_q.get()
                    u = int(event.get("u") or 0)
                    U = int(event.get("U") or 0)
                    if u <= self.book_update_id:
                        continue
                    if U > self.book_update_id + 1:
                        raise RuntimeError("binance_l2_gap")
                    self._apply_event(event)
                    self.book_update_id = u
                    self._emit_state(event.get("E"))
            finally:
                recv_task.cancel()

    def _fetch_snapshot(self) -> dict[str, Any] | None:
        url = f"{BINANCE_REST}?symbol={self.symbol}&limit={self.depth_limit}"
        try:
            with urllib.request.urlopen(url, timeout=5) as resp:
                return json.load(resp)
        except Exception:
            LOG.warning("binance_l2 snapshot fetch failed")
            return None

    def _load_snapshot(self, snap: dict[str, Any]) -> None:
        self.bids = {float(p): float(q) for p, q in snap.get("bids", []) if float(q) > 0.0}
        self.asks = {float(p): float(q) for p, q in snap.get("asks", []) if float(q) > 0.0}

    def _apply_event(self, event: dict[str, Any]) -> None:
        self._last_event_ts = int(event.get("E") or time.time() * 1000)
        for p, q in event.get("b", []):
            price = float(p)
            qty = float(q)
            if qty == 0.0:
                self.bids.pop(price, None)
            else:
                self.bids[price] = qty
        for p, q in event.get("a", []):
            price = float(p)
            qty = float(q)
            if qty == 0.0:
                self.asks.pop(price, None)
            else:
                self.asks[price] = qty

    def _top_levels(self) -> tuple[list[tuple[float, float]], list[tuple[float, float]]]:
        bids = sorted(self.bids.items(), key=lambda x: x[0], reverse=True)[: self.top_n]
        asks = sorted(self.asks.items(), key=lambda x: x[0])[: self.top_n]
        return bids, asks

    def _emit_state(self, ts_exchange_ms: int | None) -> None:
        if self.emit_full:
            bids = sorted(self.bids.items(), key=lambda x: x[0], reverse=True)
            asks = sorted(self.asks.items(), key=lambda x: x[0])
        else:
            bids, asks = self._top_levels()
        if not bids or not asks:
            return
        if ts_exchange_ms is None:
            ts_exchange_ms = int(time.time() * 1000)
        state = BookState(
            venue="binance",
            symbol=self.symbol,
            ts_exchange_ms=ts_exchange_ms,
            ts_local_ms=int(time.time() * 1000),
            kind="L2",
            best_bid=bids[0][0],
            best_ask=asks[0][0],
            bids=bids,
            asks=asks,
        )
        asyncio.create_task(self.bus.publish(Event(type="book_state", payload=state)))
