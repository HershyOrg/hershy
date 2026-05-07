#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import json
import math
import os
import sys
import time
import urllib.request
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import websockets
from web3 import Web3

from fee_model import fee_usdc
from rolling_parquet import RollingParquetWriter
from config import BotConfig

REPO_ROOT = Path(__file__).resolve().parents[2]
LIBS_DIR = REPO_ROOT / "libs"
if str(LIBS_DIR) not in sys.path:
    sys.path.insert(0, str(LIBS_DIR))

from polymarket_utils import (
    ET_TZ,
    fetch_market_by_slug,
    find_active_market_by_time,
    infer_slug_prefix,
    normalize_slug,
    resolve_yes_no_tokens,
)

PM_WS = "wss://ws-subscriptions-clob.polymarket.com/ws/market"
PM_RTDS_WS = "wss://ws-live-data.polymarket.com"
BINANCE_WS = "wss://stream.binance.com:9443/stream?streams=btcusdt@aggTrade/btcusdt@depth10@100ms"
COINBASE_TICKER = "https://api.exchange.coinbase.com/products/BTC-USD/ticker"
COINBASE_BOOK = "https://api.exchange.coinbase.com/products/BTC-USD/book?level=2"

CHAINLINK_FEED = "0xc907E116054Ad103354f2D350FD2514433D57F6f"
AGGREGATOR_V3_ABI = [
    {
        "inputs": [],
        "name": "decimals",
        "outputs": [{"type": "uint8"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "latestRoundData",
        "outputs": [
            {"type": "uint80", "name": "roundId"},
            {"type": "int256", "name": "answer"},
            {"type": "uint256", "name": "startedAt"},
            {"type": "uint256", "name": "updatedAt"},
            {"type": "uint80", "name": "answeredInRound"},
        ],
        "stateMutability": "view",
        "type": "function",
    },
]


def utc_iso_from_ms(ms: int) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(ms / 1000)) + "Z"


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def _parse_slug_epoch(slug: str) -> Optional[int]:
    try:
        suffix = slug.split("-")[-1]
        if len(suffix) == 10 and suffix.isdigit():
            return int(suffix)
    except Exception:
        return None
    return None


def _build_epoch_slug(prefix: str, epoch_s: int) -> str:
    return f"{prefix}-{int(epoch_s)}"


def _find_active_epoch_market(prefix: str, step_s: int = 900, search_steps: int = 6) -> tuple[dict, str]:
    now_s = int(time.time())
    base = (now_s // step_s) * step_s
    offsets = [0]
    for i in range(1, search_steps + 1):
        offsets.append(i)
        offsets.append(-i)
    last_err = None
    for off in offsets:
        slug = _build_epoch_slug(prefix, base + off * step_s)
        try:
            market = fetch_market_by_slug(slug)
            return market, slug
        except Exception as exc:
            last_err = exc
            continue
    raise ValueError(f"No market found for prefix: {prefix} ({last_err})")


@dataclass
class BetaState:
    beta: float = 0.0
    conf: float = 0.0


class ShadowBot:
    def __init__(
        self,
        cfg: BotConfig,
        slug: str | None,
        out_dir: Path,
        rpc: str,
        live: bool,
        order_usdc: float,
        order_type: str,
        slug_prefix: str | None,
        auto_slug: bool,
        search_hours: int,
        search_step_hours: int,
    ):
        self.cfg = cfg
        self.slug = normalize_slug(slug) if slug else None
        self.slug_prefix = slug_prefix
        self.auto_slug = auto_slug
        self.search_hours = search_hours
        self.search_step_hours = search_step_hours
        self.out_dir = out_dir
        self.rpc = rpc
        self.live = live
        self.order_usdc = order_usdc
        self.order_type = order_type

        self.exch_trades = RollingParquetWriter(out_dir, "raw_exch_trades", window_sec=300)
        self.exch_book = RollingParquetWriter(out_dir, "raw_exch_book", window_sec=300)
        self.exch_candles = RollingParquetWriter(out_dir, "raw_exch_candles_1m", window_sec=300)
        self.chainlink = RollingParquetWriter(out_dir, "raw_chainlink", window_sec=300)
        self.pm_quotes = RollingParquetWriter(out_dir, "raw_pm_quotes", window_sec=300)
        self.signals = RollingParquetWriter(out_dir, "signals", window_sec=300)
        self.fills = RollingParquetWriter(out_dir, "paper_fills", window_sec=300)

        self.trade_window = {"BINANCE": deque(), "COINBASE": deque()}
        self.price_window = {"BINANCE": deque(), "COINBASE": deque()}
        self.candle_min = {}
        self.candle = {}
        self.book_snap = None
        self.book_prev = None
        self.chainlink_hist = deque()
        self.exch_mid_hist = deque()
        self.chainlink_rtds = deque()
        self.ptb_price: Optional[float] = None
        self.ptb_ts_ms: Optional[int] = None
        self.beta_state = BetaState()

        self.last_entry_ms: Optional[int] = None
        self.pos_dir: Optional[int] = None
        self.pos_entry_ms: Optional[int] = None
        self.pos_entry_price: Optional[float] = None
        self.pos_confirmed: bool = False
        self.pos_entry_chainlink: Optional[float] = None
        self.tokens = None
        self.client = None
        self._market_lock = asyncio.Lock()

    def _record_trade(self, exchange: str, price: float, qty: float, ts_ms: int, is_buy: Optional[bool]):
        usd = price * qty
        tw = self.trade_window.setdefault(exchange, deque())
        tw.append((ts_ms, usd, is_buy))
        while tw and ts_ms - tw[0][0] > 500:
            tw.popleft()
        pw = self.price_window.setdefault(exchange, deque())
        pw.append((ts_ms, price))
        while pw and ts_ms - pw[0][0] > 5000:
            pw.popleft()
        self.exch_trades.write(
            {
                "ts": utc_iso_from_ms(ts_ms),
                "ts_ms": ts_ms,
                "exchange": exchange,
                "price": price,
                "qty": qty,
                "usd": usd,
                "is_buy": is_buy,
            }
        )
        self._update_candle(exchange, ts_ms, price)

    def _update_candle(self, exchange: str, ts_ms: int, price: float) -> None:
        minute = ts_ms // 60000
        if self.candle_min.get(exchange) is None:
            self.candle_min[exchange] = minute
            self.candle[exchange] = {"open": price, "high": price, "low": price, "close": price}
            return
        if minute != self.candle_min.get(exchange):
            self.exch_candles.write(
                {
                    "ts": utc_iso_from_ms(self.candle_min[exchange] * 60000),
                    "ts_ms": int(self.candle_min[exchange] * 60000),
                    "exchange": exchange,
                    "open": self.candle[exchange]["open"],
                    "high": self.candle[exchange]["high"],
                    "low": self.candle[exchange]["low"],
                    "close": self.candle[exchange]["close"],
                }
            )
            self.candle_min[exchange] = minute
            self.candle[exchange] = {"open": price, "high": price, "low": price, "close": price}
            return
        if self.candle.get(exchange):
            self.candle[exchange]["high"] = max(self.candle[exchange]["high"], price)
            self.candle[exchange]["low"] = min(self.candle[exchange]["low"], price)
            self.candle[exchange]["close"] = price

    def _update_book(self, exchange: str, bids: list, asks: list, ts_ms: int):
        if self.book_snap is None:
            self.book_snap = {}
            self.book_prev = {}
        self.book_prev[exchange] = self.book_snap.get(exchange)
        self.book_snap[exchange] = {"bids": bids, "asks": asks, "ts_ms": ts_ms}
        self.exch_book.write(
            {
                "ts": utc_iso_from_ms(ts_ms),
                "ts_ms": ts_ms,
                "exchange": exchange,
                "bids": json.dumps(bids),
                "asks": json.dumps(asks),
            }
        )

        mid = None
        if bids and asks:
            try:
                mid = (float(bids[0][0]) + float(asks[0][0])) / 2.0
            except Exception:
                mid = None
        if mid is not None:
            self.exch_mid_hist.append((ts_ms, mid))
            while self.exch_mid_hist and ts_ms - self.exch_mid_hist[0][0] > self.cfg.W_BETA_SEC * 1000:
                self.exch_mid_hist.popleft()

    def _book_liq_usd(self, side: str) -> float:
        snap = self.book_snap
        if not snap:
            return 0.0
        rows = snap.get(side) or []
        total = 0.0
        for p, q in rows[: self.cfg.BOOK_TOP_N]:
            try:
                total += float(p) * float(q)
            except Exception:
                continue
        return total

    def _book_drop_usd(self, exchange: str, direction: int) -> float:
        if not self.book_prev or not self.book_snap:
            return 0.0
        prev_snap = self.book_prev.get(exchange)
        cur_snap = self.book_snap.get(exchange)
        if not prev_snap or not cur_snap:
            return 0.0
        if direction == 1:
            prev = self._liq_from_snap(prev_snap, "asks")
            cur = self._liq_from_snap(cur_snap, "asks")
        else:
            prev = self._liq_from_snap(prev_snap, "bids")
            cur = self._liq_from_snap(cur_snap, "bids")
        return max(0.0, prev - cur)

    def _liq_from_snap(self, snap: dict, side: str) -> float:
        rows = snap.get(side) or []
        total = 0.0
        for p, q in rows[: self.cfg.BOOK_TOP_N]:
            try:
                total += float(p) * float(q)
            except Exception:
                continue
        return total

    def _price_delta_5s(self, exchange: str) -> float:
        pw = self.price_window.get(exchange) or deque()
        if len(pw) < 2:
            return 0.0
        now_ms, now_price = pw[-1]
        past_price = next((p for t, p in pw if now_ms - t >= 5000), None)
        if past_price is None:
            past_price = pw[0][1]
        return now_price - past_price

    def _sweep_usd(self, exchange: str) -> float:
        tw = self.trade_window.get(exchange) or deque()
        total = 0.0
        for _ts, usd, _side in tw:
            try:
                total += float(usd)
            except Exception:
                continue
        return total

    def _spoof_score(self, book_drop_usd: float, sweep_usd: float) -> float:
        return _sigmoid((book_drop_usd - sweep_usd) / self.cfg.SPOOF_K)

    def _update_beta(self):
        # compute x_t from exch mid
        if len(self.exch_mid_hist) < 2 or len(self.chainlink_hist) < 2:
            return
        now_ms, now_mid = self.exch_mid_hist[-1]
        target_ms = now_ms - self.cfg.DELTA_MS
        past_mid = next((p for t, p in reversed(self.exch_mid_hist) if t <= target_ms), None)
        if past_mid is None:
            return
        x = now_mid - past_mid
        if abs(x) < self.cfg.BETA_X_MIN:
            return
        # oracle delta with lag
        lag_ms = self.cfg.LAG_MS_INIT
        o_now = next((p for t, p in reversed(self.chainlink_hist) if t <= now_ms + lag_ms), None)
        o_prev = next((p for t, p in reversed(self.chainlink_hist) if t <= target_ms + lag_ms), None)
        if o_now is None or o_prev is None:
            return
        y = o_now - o_prev
        ratio = y / x
        samples = getattr(self, "_beta_samples", deque())
        samples.append((now_ms, ratio))
        while samples and now_ms - samples[0][0] > self.cfg.W_BETA_SEC * 1000:
            samples.popleft()
        ratios = [r for _, r in samples]
        if not ratios:
            return
        ratios.sort()
        mid = ratios[len(ratios) // 2]
        beta_raw = max(self.cfg.BETA_MIN, min(self.cfg.BETA_MAX, mid))
        self.beta_state.beta = (1 - self.cfg.BETA_SMOOTH) * self.beta_state.beta + self.cfg.BETA_SMOOTH * beta_raw
        self.beta_state.conf = min(1.0, len(ratios) / 30.0)
        self._beta_samples = samples

    def _enter(self, direction: int, chance_price: float, ts_ms: int):
        self.pos_dir = direction
        self.pos_entry_ms = ts_ms
        self.pos_entry_price = chance_price
        self.pos_confirmed = False
        self.pos_entry_chainlink = self._latest_chainlink()
        self.last_entry_ms = ts_ms
        self.fills.write(
            {
                "ts": utc_iso_from_ms(ts_ms),
                "ts_ms": ts_ms,
                "action": "ENTER",
                "dir": direction,
                "price": chance_price,
            }
        )
        if self.live:
            self._place_order(direction, action="ENTER")

    def _exit(self, reason: str, chance_price: float, ts_ms: int):
        if self.pos_dir is None:
            return
        self.fills.write(
            {
                "ts": utc_iso_from_ms(ts_ms),
                "ts_ms": ts_ms,
                "action": "EXIT",
                "dir": self.pos_dir,
                "price": chance_price,
                "reason": reason,
            }
        )
        self.pos_dir = None
        self.pos_entry_ms = None
        self.pos_entry_price = None
        self.pos_confirmed = False
        self.pos_entry_chainlink = None
        if self.live:
            self._place_order(direction=None, action="EXIT")

    def _latest_chainlink(self) -> Optional[float]:
        if not self.chainlink_hist:
            return None
        return self.chainlink_hist[-1][1]

    def _place_order(self, direction: Optional[int], action: str) -> None:
        if not self.client or not self.tokens:
            return
        try:
            from py_clob_client.clob_types import (
                BalanceAllowanceParams,
                MarketOrderArgs,
                OrderType,
                AssetType,
            )
            from py_clob_client.order_builder.constants import BUY, SELL
        except Exception as exc:
            print(f"[WARN] py-clob-client not available: {exc}")
            return

        if action == "ENTER":
            token_id = self.tokens.yes_token_id if direction == 1 else self.tokens.no_token_id
            order_type = OrderType(self.order_type)
            order_args = MarketOrderArgs(
                token_id=token_id,
                amount=self.order_usdc,
                side=BUY,
                order_type=order_type,
            )
            signed = self.client.create_market_order(order_args)
            self.client.post_order(signed, order_args.order_type)
        else:
            # Exit: sell entire conditional balance
            for token_id in (self.tokens.yes_token_id, self.tokens.no_token_id):
                params = BalanceAllowanceParams(asset_type=AssetType.CONDITIONAL, token_id=token_id)
                resp = self.client.get_balance_allowance(params)
                bal = float(resp.get("balance") or 0)
                if bal <= 0:
                    continue
                order_type = OrderType(self.order_type)
                order_args = MarketOrderArgs(
                    token_id=token_id,
                    amount=bal,
                    side=SELL,
                    order_type=order_type,
                )
                signed = self.client.create_market_order(order_args)
                self.client.post_order(signed, order_args.order_type)

    async def _set_market(self, slug: str):
        market = fetch_market_by_slug(slug)
        tokens = resolve_yes_no_tokens(market, slug)
        async with self._market_lock:
            self.slug = slug
            self.tokens = tokens
            self.ptb_price = None
            self.ptb_ts_ms = None
            self.chainlink_rtds.clear()

    async def run(self):
        if self.auto_slug:
            prefix = self.slug_prefix or (infer_slug_prefix(self.slug or "") if self.slug else None)
            if not prefix:
                raise SystemExit("Missing --slug-prefix for auto mode.")
            # Epoch-suffix slugs: prefix-<epoch>
            try:
                market, slug = _find_active_epoch_market(prefix, step_s=900, search_steps=8)
            except Exception:
                now_et = dt.datetime.now(tz=ET_TZ)
                market, slug = find_active_market_by_time(
                    prefix,
                    now_et=now_et,
                    search_hours=self.search_hours,
                    step_hours=self.search_step_hours,
                )
            await self._set_market(slug)
        else:
            if not self.slug:
                raise SystemExit("Provide --slug or enable --auto-slug with --slug-prefix.")
            await self._set_market(self.slug)

        async def polymarket_loop():
            latest = {"yes_bid": None, "yes_ask": None}
            while True:
                try:
                    async with websockets.connect(PM_WS, ping_interval=20, ping_timeout=20) as ws:
                        async with self._market_lock:
                            tokens = self.tokens
                        if tokens is None:
                            await asyncio.sleep(0.2)
                            continue
                        sub = {"type": "market", "assets_ids": [tokens.yes_token_id, tokens.no_token_id], "custom_feature_enabled": True}
                        await ws.send(json.dumps(sub))
                        async for raw in ws:
                            if raw == "PONG":
                                continue
                            data = json.loads(raw)
                            events = data if isinstance(data, list) else data.get("data") or [data]
                            for event in events:
                                if event.get("event_type") != "best_bid_ask":
                                    continue
                                asset_id = event.get("asset_id")
                                bid = event.get("best_bid")
                                ask = event.get("best_ask")
                                if asset_id == tokens.yes_token_id:
                                    latest["yes_bid"] = float(bid) if bid is not None else None
                                    latest["yes_ask"] = float(ask) if ask is not None else None

                                if latest["yes_bid"] is not None and latest["yes_ask"] is not None:
                                    now_ms = int(time.time() * 1000)
                                    chance = (latest["yes_bid"] + latest["yes_ask"]) / 2.0
                                    self.pm_quotes.write(
                                        {
                                            "ts": utc_iso_from_ms(now_ms),
                                            "ts_ms": now_ms,
                                            "chance": chance,
                                            "yes_bid": latest["yes_bid"],
                                            "yes_ask": latest["yes_ask"],
                                        }
                                    )
                except Exception:
                    await asyncio.sleep(1)

        async def chainlink_loop():
            rpc = self.rpc or os.environ.get("POLYRPC")
            if not rpc:
                raise SystemExit("Missing POLYRPC for Chainlink.")
            w3 = Web3(Web3.HTTPProvider(rpc))
            addr = w3.to_checksum_address(CHAINLINK_FEED)
            c = w3.eth.contract(address=addr, abi=AGGREGATOR_V3_ABI)
            decimals = int(c.functions.decimals().call())
            while True:
                try:
                    _round_id, answer, _started, updated, _ans = c.functions.latestRoundData().call()
                    price = float(answer) / (10 ** decimals)
                    now_ms = int(time.time() * 1000)
                    self.chainlink_hist.append((now_ms, price))
                    while self.chainlink_hist and now_ms - self.chainlink_hist[0][0] > self.cfg.W_BETA_SEC * 1000:
                        self.chainlink_hist.popleft()
                    self.chainlink.write(
                        {
                            "ts": utc_iso_from_ms(now_ms),
                            "ts_ms": now_ms,
                            "price": price,
                            "updated_at": int(updated),
                        }
                    )
                except Exception:
                    pass
                await asyncio.sleep(1.0)

        async def chainlink_rtds_loop():
            # price_to_beat snapshot from RTDS chainlink stream
            start_ms = None

            def _maybe_set_ptb():
                if self.ptb_price is not None:
                    return
                if not self.chainlink_rtds:
                    return
                if start_ms is None:
                    return
                before = [x for x in self.chainlink_rtds if x[0] <= start_ms]
                after = [x for x in self.chainlink_rtds if x[0] >= start_ms]
                cand = []
                if before:
                    cand.append(before[-1])
                if after:
                    cand.append(after[0])
                if not cand:
                    return
                best = min(cand, key=lambda x: abs(x[0] - start_ms))
                self.ptb_ts_ms = best[0]
                self.ptb_price = best[1]

            while True:
                try:
                    async with websockets.connect(PM_RTDS_WS, ping_interval=20, ping_timeout=20) as ws:
                        sub = {"type": "subscribe", "topic": "crypto_prices_chainlink"}
                    await ws.send(json.dumps(sub))
                    async for raw in ws:
                        if raw == "PONG":
                            continue
                            try:
                                msg = json.loads(raw)
                            except Exception:
                                continue
                            payload = msg.get("payload") or msg.get("data") or msg
                            ts_ms = payload.get("timestamp") or payload.get("ts_ms") or payload.get("ts")
                            val = payload.get("value") or payload.get("price")
                            try:
                                ts_ms = int(ts_ms)
                                price = float(val)
                            except Exception:
                                continue
                            self.chainlink_rtds.append((ts_ms, price))
                            while self.chainlink_rtds and ts_ms - self.chainlink_rtds[0][0] > 5_000:
                                self.chainlink_rtds.popleft()
                            if start_ms is None:
                                async with self._market_lock:
                                    slug = self.slug
                                epoch = _parse_slug_epoch(slug or "")
                                if epoch is not None:
                                    start_ms = epoch * 1000
                            _maybe_set_ptb()
                except Exception:
                    await asyncio.sleep(1)

        async def binance_loop():
            while True:
                try:
                    async with websockets.connect(BINANCE_WS, ping_interval=20, ping_timeout=20) as ws:
                        async for raw in ws:
                            msg = json.loads(raw)
                            payload = msg.get("data", msg)
                            if payload.get("e") == "aggTrade":
                                price = float(payload["p"])
                                qty = float(payload["q"])
                                ts_ms = int(payload.get("T") or payload.get("E") or time.time() * 1000)
                                is_buy = not payload.get("m", False)
                                self._record_trade("BINANCE", price, qty, ts_ms, is_buy)
                            else:
                                is_depth_update = payload.get("e") == "depthUpdate"
                                bids = payload.get("b") if is_depth_update else payload.get("bids")
                                asks = payload.get("a") if is_depth_update else payload.get("asks")
                                if bids is not None and asks is not None:
                                    bids = bids[: self.cfg.BOOK_TOP_N]
                                    asks = asks[: self.cfg.BOOK_TOP_N]
                                    ts_ms = int(payload.get("E") or time.time() * 1000)
                                    self._update_book("BINANCE", bids, asks, ts_ms)
                except Exception:
                    await asyncio.sleep(1)

        async def coinbase_loop():
            while True:
                try:
                    with urllib.request.urlopen(COINBASE_TICKER, timeout=5) as resp:
                        data = json.load(resp)
                    price = float(data.get("price"))
                    ts_ms = int(time.time() * 1000)
                    self._record_trade("COINBASE", price, 0.0, ts_ms, None)
                except Exception:
                    pass
                try:
                    with urllib.request.urlopen(COINBASE_BOOK, timeout=5) as resp:
                        book = json.load(resp)
                    bids = book.get("bids", [])[: self.cfg.BOOK_TOP_N]
                    asks = book.get("asks", [])[: self.cfg.BOOK_TOP_N]
                    ts_ms = int(time.time() * 1000)
                    self._update_book("COINBASE", bids, asks, ts_ms)
                except Exception:
                    pass
                await asyncio.sleep(1.0)

        async def decision_loop():
            while True:
                now_ms = int(time.time() * 1000)
                self._update_beta()

                # time gate: monitor from T-180s, trade from T-120s
                time_to_end = None
                start_epoch = _parse_slug_epoch(self.slug or "")
                if start_epoch is not None:
                    end_epoch = start_epoch + 900
                    time_to_end = end_epoch - int(time.time())
                    if time_to_end > 180:
                        await asyncio.sleep(0.05)
                        continue

                # choose exchange with larger absolute move
                delta_b = self._price_delta_5s("BINANCE")
                delta_c = self._price_delta_5s("COINBASE")
                if abs(delta_c) > abs(delta_b):
                    price_delta_5s = delta_c
                    src_ex = "COINBASE"
                else:
                    price_delta_5s = delta_b
                    src_ex = "BINANCE"

                sweep = self._sweep_usd(src_ex)
                beta = self.beta_state.beta
                beta_conf = self.beta_state.conf
                ptb = self.ptb_price

                self.signals.write(
                    {
                        "ts": utc_iso_from_ms(now_ms),
                        "ts_ms": now_ms,
                        "price_delta_5s": price_delta_5s,
                        "sweep_usd": sweep,
                        "exchange": src_ex,
                        "beta": beta,
                        "beta_conf": beta_conf,
                        "ptb": ptb,
                        "time_to_end": time_to_end,
                    }
                )

                if self.last_entry_ms and now_ms - self.last_entry_ms < self.cfg.COOLDOWN_MS:
                    await asyncio.sleep(0.05)
                    continue

                if time_to_end is not None and time_to_end > 120:
                    await asyncio.sleep(0.05)
                    continue

                if self.pm_quotes._rows and self.exch_mid_hist:
                    now_mid = self.exch_mid_hist[-1][1]
                    target_ms = now_ms - self.cfg.DELTA_MS
                    past_mid = next((p for t, p in reversed(self.exch_mid_hist) if t <= target_ms), None)
                    if past_mid is not None:
                        delta_ex = now_mid - past_mid
                        direction = 1 if delta_ex >= 0 else -1
                        book_drop = self._book_drop_usd(src_ex, direction)
                        spoof = self._spoof_score(book_drop, sweep if sweep > 0 else book_drop)
                        if abs(price_delta_5s) >= self.cfg.PRICE_MOVE_USD_MIN_5S and book_drop >= self.cfg.BOOK_CONSUME_USD_MIN:
                            if beta_conf >= 0.2 and spoof <= self.cfg.SPOOF_SCORE_MAX:
                                chance = self.pm_quotes._rows[-1]["chance"]
                                est_fee = fee_usdc(chance, self.cfg.SHARES)
                                if ptb is not None:
                                    o_now = self._latest_chainlink() or 0.0
                                    o_pred = o_now + (beta * delta_ex)
                                    margin_pred = o_pred - ptb
                                    # only trade if predicted move crosses PTB with buffer
                                    if direction == 1 and margin_pred < self.cfg.PTB_CROSS_EPS_USD:
                                        await asyncio.sleep(0.05)
                                        continue
                                    if direction == -1 and margin_pred > -self.cfg.PTB_CROSS_EPS_USD:
                                        await asyncio.sleep(0.05)
                                        continue
                                if est_fee >= 0:
                                    self._enter(direction, chance, now_ms)

                if self.pos_dir is not None and self.pm_quotes._rows:
                    chance = self.pm_quotes._rows[-1]["chance"]
                    # confirm window
                    if not self.pos_confirmed and self.pos_entry_ms:
                        if now_ms - self.pos_entry_ms <= self.cfg.CONFIRM_WIN_MS:
                            cl_now = self._latest_chainlink()
                            cl_entry = self.pos_entry_chainlink
                            if cl_now is not None and cl_entry is not None:
                                delta = cl_now - cl_entry
                                if self.pos_dir == 1 and delta >= self.cfg.CONFIRM_EPS_USD:
                                    self.pos_confirmed = True
                                if self.pos_dir == -1 and delta <= -self.cfg.CONFIRM_EPS_USD:
                                    self.pos_confirmed = True
                            if not self.pos_confirmed and self.ptb_price is not None and cl_now is not None:
                                margin = cl_now - self.ptb_price
                                if self.pos_dir == 1 and margin > 0:
                                    self.pos_confirmed = True
                                if self.pos_dir == -1 and margin < 0:
                                    self.pos_confirmed = True
                        else:
                            self._exit("confirm_fail", chance, now_ms)
                    if self.pos_entry_ms and now_ms - self.pos_entry_ms > self.cfg.TIME_STOP_MS:
                        self._exit("time_stop", chance, now_ms)
                await asyncio.sleep(0.05)

        async def market_refresh_loop():
            if not self.auto_slug:
                return
            while True:
                try:
                    try:
                        market, slug = _find_active_epoch_market(self.slug_prefix, step_s=900, search_steps=8)
                    except Exception:
                        now_et = dt.datetime.now(tz=ET_TZ)
                        market, slug = find_active_market_by_time(
                            self.slug_prefix,
                            now_et=now_et,
                            search_hours=self.search_hours,
                            step_hours=self.search_step_hours,
                        )
                    async with self._market_lock:
                        cur = self.slug
                    if slug and slug != cur:
                        await self._set_market(slug)
                        print(f"[INFO] Switched market -> {slug}")
                except Exception:
                    pass
                await asyncio.sleep(5)

        await asyncio.gather(
            polymarket_loop(),
            chainlink_loop(),
            chainlink_rtds_loop(),
            binance_loop(),
            coinbase_loop(),
            decision_loop(),
            market_refresh_loop(),
        )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", default=None, help="Polymarket market slug")
    ap.add_argument("--auto-slug", action="store_true", help="Auto-switch markets by prefix")
    ap.add_argument("--slug-prefix", default=None, help="Slug prefix for auto mode")
    ap.add_argument("--search-hours", type=int, default=6)
    ap.add_argument("--search-step-hours", type=int, default=1)
    ap.add_argument("--out-dir", default="src/out/impulse_15m_bot")
    ap.add_argument("--session", default=None)
    ap.add_argument("--rpc", default=None, help="Override POLYRPC")
    ap.add_argument("--live", action="store_true", help="Place real orders via CLOB")
    ap.add_argument("--order-usdc", type=float, default=None)
    ap.add_argument("--order-type", default="FAK")
    args = ap.parse_args()

    session = args.session or time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    out_dir = Path(args.out_dir) / session
    out_dir.mkdir(parents=True, exist_ok=True)

    cfg = BotConfig()
    order_usdc = args.order_usdc or cfg.ORDER_USDC
    bot = ShadowBot(
        cfg,
        args.slug,
        out_dir,
        args.rpc,
        args.live,
        order_usdc,
        args.order_type,
        args.slug_prefix,
        args.auto_slug,
        args.search_hours,
        args.search_step_hours,
    )
    if args.live:
        try:
            from py_clob_client.client import ClobClient
            from py_clob_client.clob_types import ApiCreds
        except Exception as exc:
            raise SystemExit(f"py-clob-client required for --live: {exc}")

        private_key = os.getenv("POLY_PRIVATE_KEY")
        funder = os.getenv("POLY_FUNDER")
        api_key = os.getenv("POLY_API_KEY")
        api_secret = os.getenv("POLY_API_SECRET")
        api_passphrase = os.getenv("POLY_API_PASSPHRASE")
        if not private_key or not funder:
            raise SystemExit("Missing POLY_PRIVATE_KEY or POLY_FUNDER for live trading.")
        client = ClobClient(
            "https://clob.polymarket.com",
            key=private_key,
            chain_id=137,
            signature_type=2,
            funder=funder,
        )
        if api_key and api_secret and api_passphrase:
            client.set_api_creds(ApiCreds(api_key=api_key, api_secret=api_secret, api_passphrase=api_passphrase))
        else:
            client.set_api_creds(client.create_or_derive_api_creds())
        bot.client = client
    asyncio.run(bot.run())


if __name__ == "__main__":
    main()
