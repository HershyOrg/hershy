from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging
import time
import urllib.request
from dataclasses import dataclass
from typing import Any

import websockets

from ..bus import Event, EventBus
from ..models import BookState

COINBASE_WS = "wss://ws-feed.exchange.coinbase.com"
COINBASE_REST = "https://api.exchange.coinbase.com/products"
LOG = logging.getLogger(__name__)


@dataclass
class CoinbaseL3BookBuilder:
    product_id: str
    top_n: int
    bus: EventBus
    resync_backoff: float = 1.0
    allow_l2_fallback: bool = True

    def __post_init__(self) -> None:
        self.orders: dict[str, dict[str, Any]] = {}
        self.levels: dict[str, dict[float, float]] = {"buy": {}, "sell": {}}
        self.last_sequence: int = 0
        self._resync_count = 0
        self._snapshot_failures = 0

    async def start(self, stop_evt: asyncio.Event) -> None:
        while not stop_evt.is_set():
            try:
                await self._run_once(stop_evt)
            except Exception:
                self._resync_count += 1
                LOG.warning("coinbase_l3 resync #%d", self._resync_count)
                await asyncio.sleep(self.resync_backoff)

    async def _run_once(self, stop_evt: asyncio.Event) -> None:
        self.orders.clear()
        self.levels = {"buy": {}, "sell": {}}
        self.last_sequence = 0
        event_q: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

        async def _receiver(ws) -> None:
            async for raw in ws:
                msg = json.loads(raw)
                if not isinstance(msg, dict):
                    continue
                if msg.get("type") in {"subscriptions", "heartbeat"}:
                    continue
                await event_q.put(msg)

        async with websockets.connect(COINBASE_WS, ping_interval=20, ping_timeout=20) as ws:
            sub = {"type": "subscribe", "product_ids": [self.product_id], "channels": ["full"]}
            await ws.send(json.dumps(sub))
            recv_task = asyncio.create_task(_receiver(ws))
            try:
                snapshot = self._fetch_snapshot()
                if not snapshot:
                    self._snapshot_failures += 1
                    if self.allow_l2_fallback and self._snapshot_failures >= 3:
                        LOG.warning("coinbase_l3 snapshot failed 3x; switching to REST L2 fallback")
                        await self._run_rest_only(stop_evt)
                        return
                    raise RuntimeError("coinbase_l3_snapshot_failed")
                snap_seq = int(snapshot.get("sequence") or 0)
                self._load_snapshot(snapshot)
                self.last_sequence = snap_seq

                buffered: list[dict[str, Any]] = []
                while not event_q.empty():
                    buffered.append(event_q.get_nowait())

                for msg in buffered:
                    seq = int(msg.get("sequence") or 0)
                    if seq <= self.last_sequence:
                        continue
                    self._apply_message(msg)
                    self.last_sequence = seq
                    self._emit_state(msg.get("time"))

                while not stop_evt.is_set():
                    msg = await event_q.get()
                    seq = int(msg.get("sequence") or 0)
                    if seq <= self.last_sequence:
                        continue
                    if seq > self.last_sequence + 1:
                        raise RuntimeError("coinbase_seq_gap")
                    self._apply_message(msg)
                    self.last_sequence = seq
                    self._emit_state(msg.get("time"))
            finally:
                recv_task.cancel()

    def _fetch_snapshot(self) -> dict[str, Any] | None:
        url = f"{COINBASE_REST}/{self.product_id}/book?level=3"
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "l2l3-orderbook",
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return json.load(resp)
        except Exception as exc:
            LOG.warning("coinbase_l3 snapshot fetch failed: %s", exc)
            return None

    def _fetch_snapshot_l2(self) -> dict[str, Any] | None:
        url = f"{COINBASE_REST}/{self.product_id}/book?level=2"
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "l2l3-orderbook",
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return json.load(resp)
        except Exception as exc:
            LOG.warning("coinbase_l2 snapshot fetch failed: %s", exc)
            return None

    def _load_snapshot(self, snap: dict[str, Any]) -> None:
        self.orders.clear()
        self.levels = {"buy": {}, "sell": {}}
        for price, size, order_id in snap.get("bids", []):
            self._add_order(order_id, "buy", float(price), float(size))
        for price, size, order_id in snap.get("asks", []):
            self._add_order(order_id, "sell", float(price), float(size))

    def _add_order(self, order_id: str, side: str, price: float, size: float) -> None:
        self.orders[order_id] = {"side": side, "price": price, "size": size}
        level = self.levels[side]
        level[price] = level.get(price, 0.0) + size

    def _remove_order(self, order_id: str) -> None:
        order = self.orders.pop(order_id, None)
        if not order:
            return
        side = order["side"]
        price = order["price"]
        size = order["size"]
        level = self.levels[side]
        new_size = level.get(price, 0.0) - size
        if new_size <= 0:
            level.pop(price, None)
        else:
            level[price] = new_size

    def _apply_message(self, msg: dict[str, Any]) -> None:
        mtype = msg.get("type")
        if mtype == "received":
            return
        if mtype == "open":
            order_id = msg.get("order_id")
            side = msg.get("side")
            price = msg.get("price")
            size = msg.get("remaining_size") or msg.get("size")
            if order_id and side and price and size:
                self._add_order(order_id, side, float(price), float(size))
            return
        if mtype == "match":
            order_id = msg.get("maker_order_id")
            size = msg.get("size")
            if not order_id or size is None:
                return
            order = self.orders.get(order_id)
            if not order:
                return
            trade_size = float(size)
            prev_size = float(order["size"])
            if trade_size >= prev_size:
                self._remove_order(order_id)
            else:
                order["size"] = prev_size - trade_size
                side = order["side"]
                price = order["price"]
                level = self.levels[side]
                level[price] = max(0.0, level.get(price, 0.0) - trade_size)
            return
        if mtype == "done":
            order_id = msg.get("order_id")
            if order_id:
                self._remove_order(order_id)
            return
        if mtype == "change":
            order_id = msg.get("order_id")
            new_size = msg.get("new_size")
            if not order_id or new_size is None:
                return
            order = self.orders.get(order_id)
            if not order:
                return
            if float(new_size) <= 0:
                self._remove_order(order_id)
                return
            side = order["side"]
            price = order["price"]
            level = self.levels[side]
            delta = float(new_size) - order["size"]
            level[price] = max(0.0, level.get(price, 0.0) + delta)
            order["size"] = float(new_size)

    def _top_levels(self) -> tuple[list[tuple[float, float]], list[tuple[float, float]]]:
        bids = sorted(self.levels["buy"].items(), key=lambda x: x[0], reverse=True)[: self.top_n]
        asks = sorted(self.levels["sell"].items(), key=lambda x: x[0])[: self.top_n]
        return bids, asks

    def _emit_state(self, ts_exchange: str | None) -> None:
        bids, asks = self._top_levels()
        if not bids or not asks:
            return
        ts_ms = None
        if ts_exchange:
            try:
                iso = ts_exchange.replace("Z", "+00:00")
                ts_ms = int(
                    dt.datetime.fromisoformat(iso).timestamp() * 1000
                )
            except Exception:
                ts_ms = None
        state = BookState(
            venue="coinbase",
            symbol=self.product_id,
            ts_exchange_ms=ts_ms,
            ts_local_ms=int(time.time() * 1000),
            kind="L3",
            best_bid=bids[0][0],
            best_ask=asks[0][0],
            bids=bids,
            asks=asks,
            l3_order_count=len(self.orders),
        )
        asyncio.create_task(self.bus.publish(Event(type="book_state", payload=state)))

    def _emit_state_l2(self, bids: list[list[str]], asks: list[list[str]]) -> None:
        top_bids = [(float(p), float(q)) for p, q, *_ in bids[: self.top_n]]
        top_asks = [(float(p), float(q)) for p, q, *_ in asks[: self.top_n]]
        if not top_bids or not top_asks:
            return
        now_ms = int(time.time() * 1000)
        state = BookState(
            venue="coinbase",
            symbol=self.product_id,
            ts_exchange_ms=now_ms,
            ts_local_ms=now_ms,
            kind="L2",
            best_bid=top_bids[0][0],
            best_ask=top_asks[0][0],
            bids=top_bids,
            asks=top_asks,
            l3_order_count=None,
        )
        asyncio.create_task(self.bus.publish(Event(type="book_state", payload=state)))

    async def _run_rest_only(self, stop_evt: asyncio.Event) -> None:
        while not stop_evt.is_set():
            snap = self._fetch_snapshot_l2()
            if snap:
                bids = snap.get("bids", [])
                asks = snap.get("asks", [])
                self._emit_state_l2(bids, asks)
            await asyncio.sleep(1.0)
