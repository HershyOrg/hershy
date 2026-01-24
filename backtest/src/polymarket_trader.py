import argparse
import asyncio
import datetime as dt
import json
import math
import os
import sys
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from pipeline_btc_exit_rl import load_prob_model_from_path, prob_predict, compute_pbad
from polymarket_utils import (
    ET_TZ,
    fetch_market_by_slug,
    find_active_market_by_time,
    infer_slug_prefix,
    normalize_slug,
    resolve_yes_no_tokens,
)

try:
    import websockets
except ImportError as exc:
    raise RuntimeError("websockets is required. Install with: pip install websockets") from exc

try:
    from py_clob_client.client import ClobClient
    from py_clob_client.clob_types import (
        ApiCreds,
        AssetType,
        BalanceAllowanceParams,
        BookParams,
        MarketOrderArgs,
        OrderType,
    )
    from py_clob_client.order_builder.constants import BUY, SELL
except ImportError as exc:
    raise RuntimeError(
        "py-clob-client is required. Install with: pip install py-clob-client"
    ) from exc

BINANCE_WS_URL = "wss://stream.binance.com:9443/stream?streams=btcusdt@kline_1s/btcusdt@kline_1h"
CLOB_HOST = "https://clob.polymarket.com"
CHAIN_ID = 137
USDC_SCALE = 1_000_000
CONDITIONAL_SCALE = 1_000_000


@dataclass
class StrategyConfig:
    mode: str
    entry_high: float
    entry_low: float
    exit_high: float
    exit_low: float
    theta: float
    window_sec: int
    exit_at_window_end: bool
    exit_at_window_end_sec: int


@dataclass
class TradeConfig:
    max_usdc: Optional[float]
    min_usdc: float
    reserve_usdc: float
    min_shares: float
    order_type: OrderType
    dry_run: bool


@dataclass
class PaperConfig:
    start_usdc: float
    hold_to_expiry: bool
    ledger_path: Optional[Path]


@dataclass
class FillResult:
    usdc: float
    shares: float
    avg_price: Optional[float]
    partial: bool


@dataclass
class Position:
    token_id: str
    bet_up: bool
    entry_ts_ms: int
    entry_price: Optional[float] = None
    shares: float = 0.0
    cost_usdc: float = 0.0
    entry_o_1h: Optional[float] = None


@dataclass
class TradeState:
    position: Optional[Position] = None
    traded_this_hour: bool = False
    pending_bet_up: Optional[bool] = None
    pending_since_ms: Optional[int] = None


class PolymarketExecutor:
    def __init__(self, client: ClobClient, cfg: TradeConfig):
        self.client = client
        self.cfg = cfg

    def _post_market_order(self, order_args: MarketOrderArgs) -> dict:
        if self.cfg.dry_run:
            print(f"[DRY] market order: {order_args}")
            return {"status": "dry_run"}
        signed = self.client.create_market_order(order_args)
        return self.client.post_order(signed, order_args.order_type)

    def get_usdc_available(self) -> float:
        params = BalanceAllowanceParams(asset_type=AssetType.COLLATERAL)
        resp = self.client.get_balance_allowance(params)
        balance = _safe_float(resp.get("balance"))
        allowance = _extract_allowance(resp)
        available = min(balance, allowance)
        return available / USDC_SCALE

    def get_token_balance(self, token_id: str) -> float:
        params = BalanceAllowanceParams(
            asset_type=AssetType.CONDITIONAL, token_id=token_id
        )
        resp = self.client.get_balance_allowance(params)
        return _scale_conditional_balance(resp.get("balance"))

    def compute_buy_usdc(self) -> float:
        available = self.get_usdc_available() - self.cfg.reserve_usdc
        if self.cfg.max_usdc is not None:
            available = min(available, self.cfg.max_usdc)
        return max(0.0, available)

    def market_buy_max(self, token_id: str) -> Optional[FillResult]:
        amount = self.compute_buy_usdc()
        if amount < self.cfg.min_usdc:
            print(
                f"[TRADE] skip buy (amount={amount:.4f} < min_usdc={self.cfg.min_usdc:.4f})"
            )
            return None
        order_args = MarketOrderArgs(
            token_id=token_id,
            amount=amount,
            side=BUY,
            order_type=self.cfg.order_type,
        )
        try:
            resp = self._post_market_order(order_args)
        except Exception as exc:
            print(f"[TRADE] buy failed: {exc}")
            return None
        print(f"[TRADE] buy resp: {resp}")
        return FillResult(usdc=amount, shares=0.0, avg_price=None, partial=False)

    def market_sell_all(self, token_id: str) -> Optional[FillResult]:
        shares = self.get_token_balance(token_id)
        if shares < self.cfg.min_shares:
            print(
                f"[TRADE] skip sell (shares={shares:.6f} < min_shares={self.cfg.min_shares:.6f})"
            )
            return None
        order_args = MarketOrderArgs(
            token_id=token_id,
            amount=shares,
            side=SELL,
            order_type=self.cfg.order_type,
        )
        try:
            resp = self._post_market_order(order_args)
        except Exception as exc:
            print(f"[TRADE] sell failed: {exc}")
            return None
        print(f"[TRADE] sell resp: {resp}")
        return FillResult(usdc=0.0, shares=shares, avg_price=None, partial=False)

    def get_open_orders(self):
        return self.client.get_orders()

    def get_trades(self):
        return self.client.get_trades()

    def cancel_order(self, order_id: str):
        return self.client.cancel(order_id)

    def cancel_orders(self, order_ids: list[str]):
        return self.client.cancel_orders(order_ids)

    def cancel_all_orders(self):
        return self.client.cancel_all()

    def cancel_market_orders(self, token_id: str):
        return self.client.cancel_market_orders(asset_id=token_id)


class PaperExecutor:
    def __init__(self, client: ClobClient, cfg: TradeConfig, paper_cfg: PaperConfig):
        self.client = client
        self.cfg = cfg
        self.paper_cfg = paper_cfg
        self.start_usdc = paper_cfg.start_usdc
        self.usdc_balance = paper_cfg.start_usdc
        self.positions: dict[str, float] = {}

    def get_usdc_available(self) -> float:
        return self.usdc_balance

    def get_token_balance(self, token_id: str) -> float:
        return self.positions.get(token_id, 0.0)

    def compute_buy_usdc(self) -> float:
        available = self.get_usdc_available() - self.cfg.reserve_usdc
        if self.cfg.max_usdc is not None:
            available = min(available, self.cfg.max_usdc)
        return max(0.0, available)

    def market_buy_max(self, token_id: str) -> Optional[FillResult]:
        amount = self.compute_buy_usdc()
        if amount < self.cfg.min_usdc:
            print(
                f"[PAPER] skip buy (amount={amount:.4f} < min_usdc={self.cfg.min_usdc:.4f})"
            )
            return None
        try:
            book = self.client.get_order_book(token_id)
        except Exception as exc:
            print(f"[PAPER] orderbook fetch failed: {exc}")
            return None

        fill = _simulate_market_buy(book, amount)
        if fill is None:
            print("[PAPER] buy skipped (no liquidity)")
            return None
        if self.cfg.order_type == OrderType.FOK and fill.partial:
            print("[PAPER] buy skipped (FOK partial fill)")
            return None
        if fill.usdc <= 0 or fill.shares <= 0:
            print("[PAPER] buy skipped (empty fill)")
            return None

        remaining_usdc = max(0.0, amount - fill.usdc)
        self.usdc_balance -= fill.usdc
        self.positions[token_id] = self.positions.get(token_id, 0.0) + fill.shares
        print(
            f"[PAPER] buy token={token_id} usdc={fill.usdc:.4f} shares={fill.shares:.6f} "
            f"avg_px={fill.avg_price:.4f} remaining_usdc={remaining_usdc:.4f} "
            f"balance={self.usdc_balance:.4f}"
        )
        _write_paper_ledger(
            self.paper_cfg.ledger_path,
            {
                "event": "buy",
                "t_ms": int(time.time() * 1000),
                "token_id": token_id,
                "requested_usdc": amount,
                "usdc": fill.usdc,
                "remaining_usdc": remaining_usdc,
                "shares": fill.shares,
                "avg_price": fill.avg_price,
                "partial": fill.partial,
                "balance_usdc": self.usdc_balance,
            },
        )
        return fill

    def market_sell_all(self, token_id: str) -> Optional[FillResult]:
        shares = self.get_token_balance(token_id)
        if shares < self.cfg.min_shares:
            print(
                f"[PAPER] skip sell (shares={shares:.6f} < min_shares={self.cfg.min_shares:.6f})"
            )
            return None
        try:
            book = self.client.get_order_book(token_id)
        except Exception as exc:
            print(f"[PAPER] orderbook fetch failed: {exc}")
            return None

        fill = _simulate_market_sell(book, shares)
        if fill is None:
            print("[PAPER] sell skipped (no liquidity)")
            return None
        if self.cfg.order_type == OrderType.FOK and fill.partial:
            print("[PAPER] sell skipped (FOK partial fill)")
            return None
        if fill.usdc <= 0 or fill.shares <= 0:
            print("[PAPER] sell skipped (empty fill)")
            return None

        remaining_shares = max(0.0, shares - fill.shares)
        self.usdc_balance += fill.usdc
        remaining = self.positions.get(token_id, 0.0) - fill.shares
        if remaining <= 1e-9:
            self.positions.pop(token_id, None)
        else:
            self.positions[token_id] = remaining
        print(
            f"[PAPER] sell token={token_id} usdc={fill.usdc:.4f} shares={fill.shares:.6f} "
            f"avg_px={fill.avg_price:.4f} remaining_shares={remaining_shares:.6f} "
            f"balance={self.usdc_balance:.4f}"
        )
        _write_paper_ledger(
            self.paper_cfg.ledger_path,
            {
                "event": "sell",
                "t_ms": int(time.time() * 1000),
                "token_id": token_id,
                "requested_shares": shares,
                "usdc": fill.usdc,
                "remaining_shares": remaining_shares,
                "shares": fill.shares,
                "avg_price": fill.avg_price,
                "partial": fill.partial,
                "balance_usdc": self.usdc_balance,
            },
        )
        return fill


def _safe_float(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _extract_allowance(resp: dict) -> float:
    if not isinstance(resp, dict):
        return 0.0
    allowance = resp.get("allowance")
    if allowance is not None:
        return _safe_float(allowance)
    allowances = resp.get("allowances")
    if isinstance(allowances, dict):
        values = [_safe_float(v) for v in allowances.values()]
        return max(values) if values else 0.0
    return 0.0


def _scale_conditional_balance(raw) -> float:
    if raw is None:
        return 0.0
    if isinstance(raw, str) and "." in raw:
        return _safe_float(raw)
    return _safe_float(raw) / CONDITIONAL_SCALE


def _book_levels(levels, reverse: bool) -> list[tuple[float, float]]:
    out = []
    for lvl in levels or []:
        price = _safe_float(getattr(lvl, "price", None))
        size = _safe_float(getattr(lvl, "size", None))
        if price > 0 and size > 0:
            out.append((price, size))
    return sorted(out, key=lambda x: x[0], reverse=reverse)


def _best_bid_ask(book) -> tuple[Optional[float], Optional[float]]:
    bids = _book_levels(getattr(book, "bids", None), reverse=True)
    asks = _book_levels(getattr(book, "asks", None), reverse=False)
    best_bid = bids[0][0] if bids else None
    best_ask = asks[0][0] if asks else None
    return best_bid, best_ask


def _mid_from_bid_ask(bid: Optional[float], ask: Optional[float]) -> Optional[float]:
    if bid is None or ask is None:
        return None
    return (bid + ask) / 2.0


def _apply_fill_to_position(pos: Position, fill: FillResult) -> None:
    prev_shares = pos.shares
    pos.shares += fill.shares
    pos.cost_usdc += fill.usdc
    if fill.avg_price is None or fill.shares <= 0:
        return
    if prev_shares > 0 and pos.entry_price is not None:
        pos.entry_price = (
            (pos.entry_price * prev_shares) + (fill.avg_price * fill.shares)
        ) / (prev_shares + fill.shares)
    else:
        pos.entry_price = fill.avg_price


def _simulate_market_buy(book, usdc_amount: float) -> Optional[FillResult]:
    if usdc_amount <= 0:
        return None
    asks = _book_levels(getattr(book, "asks", None), reverse=False)
    remaining = usdc_amount
    cost = 0.0
    shares = 0.0
    for price, size in asks:
        if remaining <= 1e-12:
            break
        level_cost = price * size
        if level_cost <= remaining + 1e-12:
            fill_size = size
            fill_cost = level_cost
        else:
            fill_size = remaining / price
            fill_cost = remaining
        shares += fill_size
        cost += fill_cost
        remaining -= fill_cost
    if shares <= 0:
        return None
    avg_price = cost / shares
    partial = remaining > 1e-9
    return FillResult(usdc=cost, shares=shares, avg_price=avg_price, partial=partial)


def _simulate_market_sell(book, shares_to_sell: float) -> Optional[FillResult]:
    if shares_to_sell <= 0:
        return None
    bids = _book_levels(getattr(book, "bids", None), reverse=True)
    remaining = shares_to_sell
    proceeds = 0.0
    sold = 0.0
    for price, size in bids:
        if remaining <= 1e-12:
            break
        fill_size = min(size, remaining)
        sold += fill_size
        proceeds += fill_size * price
        remaining -= fill_size
    if sold <= 0:
        return None
    avg_price = proceeds / sold
    partial = remaining > 1e-9
    return FillResult(usdc=proceeds, shares=sold, avg_price=avg_price, partial=partial)


def _write_paper_ledger(path: Optional[Path], payload: dict) -> None:
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload, separators=(",", ":")) + "\n")


def _floor_to_hour_ms(t_ms: int) -> int:
    return (t_ms // 3_600_000) * 3_600_000


def _ms_to_utc_str(t_ms: int) -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(t_ms / 1000))


def _ms_to_et_str(t_ms: int) -> str:
    dt_et = dt.datetime.fromtimestamp(t_ms / 1000, tz=dt.timezone.utc).astimezone(
        ET_TZ
    )
    return dt_et.strftime("%Y-%m-%d %H:%M:%S ET")


def _parse_stop_at(value: Optional[str], tz: dt.tzinfo) -> Optional[int]:
    if not value:
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = dt.datetime.fromisoformat(text)
    except ValueError as exc:
        raise ValueError(
            "Invalid --stop-at-et format. Use YYYY-MM-DD HH:MM[:SS] or ISO format."
        ) from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=tz)
    return int(parsed.astimezone(dt.timezone.utc).timestamp() * 1000)


def _normalize_env_prefix(prefix: Optional[str]) -> Optional[str]:
    if prefix is None:
        return None
    cleaned = prefix.strip()
    return cleaned or None


def _env_key(base_key: str, env_prefix: Optional[str]) -> str:
    prefix = _normalize_env_prefix(env_prefix)
    if prefix:
        return f"{prefix}_{base_key}"
    return base_key


def _resolve_secret(
    value: Optional[str], base_env_key: str, arg_name: str, env_prefix: Optional[str]
) -> str:
    if value:
        return value
    env_key = _env_key(base_env_key, env_prefix)
    env_value = os.getenv(env_key)
    if env_value:
        return env_value
    raise RuntimeError(f"Missing {env_key}. Provide --{arg_name} or set env var.")


def _resolve_optional_secret(
    value: Optional[str], base_env_key: str, env_prefix: Optional[str]
) -> Optional[str]:
    if value:
        return value
    env_key = _env_key(base_env_key, env_prefix)
    return os.getenv(env_key)


def _parse_order_type(name: str) -> OrderType:
    name = name.upper()
    if name == "FOK":
        return OrderType.FOK
    if name == "FAK":
        return OrderType.FAK
    raise ValueError("order_type must be FOK or FAK")


def _parse_order_ids(value: Optional[str]) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in value.split(",") if part.strip()]


def _resolve_auto_slug(args: argparse.Namespace) -> bool:
    if args.auto_slug is not None:
        return args.auto_slug
    if args.slug_prefix:
        return True
    if args.slug and infer_slug_prefix(normalize_slug(args.slug)):
        return True
    return False


def _resolve_market_tokens(
    args: argparse.Namespace,
) -> tuple[str, str, str, Optional[bool], Optional[bool]]:
    slug_value = normalize_slug(args.slug) if args.slug else None
    if args.token_id_up and args.token_id_down:
        return (
            args.token_id_up,
            args.token_id_down,
            slug_value or "",
            None,
            None,
        )

    auto_slug = _resolve_auto_slug(args)
    if auto_slug:
        prefix = args.slug_prefix or infer_slug_prefix(slug_value or "")
        if not prefix:
            raise RuntimeError("Provide --slug-prefix or a slug with time suffix.")
        now_et = dt.datetime.now(tz=ET_TZ)
        market, slug = find_active_market_by_time(
            prefix,
            now_et=now_et,
            search_hours=args.search_hours,
            step_hours=args.search_step_hours,
        )
    else:
        if not slug_value:
            raise RuntimeError("Provide --slug or enable --auto-slug with --slug-prefix.")
        market = fetch_market_by_slug(slug_value)
        slug = market.get("slug", slug_value)

    tokens = resolve_yes_no_tokens(market, slug)
    return (
        tokens.yes_token_id,
        tokens.no_token_id,
        tokens.slug,
        tokens.enable_orderbook,
        tokens.closed,
    )


def build_clob_client(args: argparse.Namespace, read_only: bool = False) -> ClobClient:
    if read_only:
        return ClobClient(args.clob_host)

    private_key = _resolve_secret(
        args.private_key, "PRIVATE_KEY", "private-key", args.env_prefix
    )
    funder = _resolve_secret(args.funder, "FUNDER", "funder", args.env_prefix)
    client = ClobClient(
        args.clob_host,
        key=private_key,
        chain_id=args.chain_id,
        signature_type=args.signature_type,
        funder=funder,
    )

    api_key = _resolve_optional_secret(args.api_key, "API_KEY", args.env_prefix)
    api_secret = _resolve_optional_secret(args.api_secret, "API_SECRET", args.env_prefix)
    api_passphrase = _resolve_optional_secret(
        args.api_passphrase, "API_PASSPHRASE", args.env_prefix
    )

    if api_key and api_secret and api_passphrase:
        client.set_api_creds(
            ApiCreds(
                api_key=api_key,
                api_secret=api_secret,
                api_passphrase=api_passphrase,
            )
        )
    else:
        client.set_api_creds(client.create_or_derive_api_creds())

    return client


def _has_order_ops(args: argparse.Namespace) -> bool:
    return any(
        [
            args.list_open_orders,
            args.list_trades,
            args.cancel_order,
            args.cancel_orders,
            args.cancel_all_orders,
            args.cancel_market_orders,
        ]
    )


def _run_order_ops(args: argparse.Namespace) -> None:
    if args.paper:
        raise RuntimeError("order ops require live mode (remove --paper).")

    client = build_clob_client(args)
    trade_cfg = TradeConfig(
        max_usdc=args.max_usdc,
        min_usdc=args.min_usdc,
        reserve_usdc=args.reserve_usdc,
        min_shares=args.min_shares,
        order_type=_parse_order_type(args.order_type),
        dry_run=args.dry_run,
    )
    executor = PolymarketExecutor(client, trade_cfg)

    if args.list_open_orders:
        orders = executor.get_open_orders()
        print(f"[ORDERS] count={len(orders)}")
        print(json.dumps(orders, separators=(",", ":"), ensure_ascii=False))

    if args.list_trades:
        trades = executor.get_trades()
        print(f"[TRADES] count={len(trades)}")
        print(json.dumps(trades, separators=(",", ":"), ensure_ascii=False))

    if args.cancel_order:
        for order_id in args.cancel_order:
            resp = executor.cancel_order(order_id)
            print(json.dumps(resp, separators=(",", ":"), ensure_ascii=False))

    if args.cancel_orders:
        order_ids = _parse_order_ids(args.cancel_orders)
        if not order_ids:
            raise RuntimeError("--cancel-orders provided but no order IDs parsed.")
        resp = executor.cancel_orders(order_ids)
        print(json.dumps(resp, separators=(",", ":"), ensure_ascii=False))

    if args.cancel_all_orders:
        resp = executor.cancel_all_orders()
        print(json.dumps(resp, separators=(",", ":"), ensure_ascii=False))

    if args.cancel_market_orders:
        resp = executor.cancel_market_orders(args.cancel_market_orders)
        print(json.dumps(resp, separators=(",", ":"), ensure_ascii=False))


async def run_trader(args: argparse.Namespace) -> None:
    model_path = Path(args.model_path)
    model = load_prob_model_from_path(model_path)
    run_end_monotonic = None
    if args.run_for_sec is not None and args.run_for_sec > 0:
        run_end_monotonic = time.monotonic() + args.run_for_sec

    auto_slug = _resolve_auto_slug(args)
    token_id_up, token_id_down, market_slug, enable_orderbook, market_closed = (
        _resolve_market_tokens(args)
    )

    if enable_orderbook is False:
        print("[WARN] enableOrderBook=false for this market; orders may fail.")
    if market_closed:
        print("[WARN] market closed flag is true; orders may fail.")

    trade_cfg = TradeConfig(
        max_usdc=args.max_usdc,
        min_usdc=args.min_usdc,
        reserve_usdc=args.reserve_usdc,
        min_shares=args.min_shares,
        order_type=_parse_order_type(args.order_type),
        dry_run=args.dry_run,
    )
    strategy = StrategyConfig(
        mode=args.mode,
        entry_high=args.entry_high,
        entry_low=args.entry_low,
        exit_high=args.exit_high,
        exit_low=args.exit_low,
        theta=args.theta,
        window_sec=args.window_sec,
        exit_at_window_end=args.exit_at_window_end,
        exit_at_window_end_sec=max(1, int(args.exit_at_window_end_sec)),
    )
    stop_at_ms = _parse_stop_at(args.stop_at_et, ET_TZ)
    if args.paper:
        paper_cfg = PaperConfig(
            start_usdc=args.paper_usdc,
            hold_to_expiry=args.paper_hold_to_expiry,
            ledger_path=(Path(args.paper_ledger) if args.paper_ledger else None),
        )
        client = build_clob_client(args, read_only=True)
        executor = PaperExecutor(client, trade_cfg, paper_cfg)
    else:
        paper_cfg = None
        client = build_clob_client(args)
        executor = PolymarketExecutor(client, trade_cfg)

    print(
        "[BOOT] model="
        + str(model_path)
        + f" slug={market_slug} up_token={token_id_up} down_token={token_id_down}"
    )
    print(
        f"[BOOT] mode={strategy.mode} entry={strategy.entry_high:.2f}/{strategy.entry_low:.2f} "
        f"exit={strategy.exit_high:.2f}/{strategy.exit_low:.2f} theta={strategy.theta:.2f} "
        f"exit_at_window_end={strategy.exit_at_window_end} "
        f"exit_at_window_end_sec={strategy.exit_at_window_end_sec}"
    )
    if stop_at_ms is not None:
        print(
            f"[BOOT] stop_at_et={_ms_to_et_str(stop_at_ms)} "
            f"stop_exit={args.stop_exit}"
        )
    if args.signals_only:
        print("[BOOT] signals_only=True (no trades)")
    if run_end_monotonic is not None:
        print(f"[BOOT] run_for_sec={args.run_for_sec}")
    if args.paper and paper_cfg is not None:
        print(
            f"[BOOT] paper start_usdc={paper_cfg.start_usdc:.2f} "
            f"hold_to_expiry={paper_cfg.hold_to_expiry}"
        )

    o1h_by_hour = {}
    cur_hour = None
    o_1h = None
    cum_vol = 0.0
    last_60_closes = deque(maxlen=61)
    state = TradeState()
    last_log_ms = 0
    last_price = None
    last_price_ts_ms = None
    stop_logged = False
    signal_log_path = Path(args.signal_log) if args.signal_log else None
    signal_log_fh = None
    signal_log_lines = 0
    signal_log_flush_every = max(1, int(args.signal_log_flush_every))
    if signal_log_path is not None:
        signal_log_path.parent.mkdir(parents=True, exist_ok=True)
        signal_log_fh = signal_log_path.open("a", encoding="utf-8")

    next_market_check = time.time() + args.auto_refresh_sec if auto_slug else None

    try:
        while True:
            try:
                async with websockets.connect(
                    args.ws_url, ping_interval=20, ping_timeout=60, max_queue=5000
                ) as ws:
                    print("[BOOT] connected to Binance stream")
                    while True:
                        if run_end_monotonic is not None and time.monotonic() >= run_end_monotonic:
                            print("[STOP] run_for_sec reached; exiting")
                            return
                        if auto_slug and next_market_check is not None and time.time() >= next_market_check:
                            next_market_check = time.time() + args.auto_refresh_sec
                            try:
                                (
                                    new_up,
                                    new_down,
                                    new_slug,
                                    new_enable,
                                    new_closed,
                                ) = _resolve_market_tokens(args)
                            except Exception as exc:
                                print(f"[WARN] market refresh failed: {exc}")
                                new_up = new_down = new_slug = None
                            if new_slug:
                                if new_slug != market_slug:
                                    print(f"[MARKET] switch {market_slug} -> {new_slug}")
                                    if state.position is not None:
                                        if args.paper and paper_cfg is not None and paper_cfg.hold_to_expiry:
                                            if last_price is None or last_price_ts_ms is None:
                                                print("[PAPER] settle skipped (missing last price)")
                                            else:
                                                _settle_paper_position(
                                                    executor,
                                                    state,
                                                    reason="market_switch",
                                                    t_ms=last_price_ts_ms,
                                                    close_price=last_price,
                                                    o_1h=o_1h,
                                                    market_slug=market_slug,
                                                )
                                        elif strategy.exit_at_window_end:
                                            _try_exit_position(
                                                executor,
                                                state,
                                                reason="market_switch",
                                                t_ms=int(time.time() * 1000),
                                            )
                                        else:
                                            _expire_live_position(
                                                state,
                                                reason="market_switch",
                                                t_ms=int(time.time() * 1000),
                                            )
                                    token_id_up = new_up
                                    token_id_down = new_down
                                    market_slug = new_slug
                                    state.pending_bet_up = None
                                    state.pending_since_ms = None
                                enable_orderbook = new_enable
                                market_closed = new_closed

                        msg = await ws.recv()
                        payload = json.loads(msg)
                        data = payload.get("data", payload)
                        if data.get("e") != "kline":
                            continue

                        k = data.get("k", {})
                        interval = k.get("i")
                        t_ms = int(k.get("t"))
                        hour_open = _floor_to_hour_ms(t_ms)

                        if interval == "1h":
                            o1h_by_hour[hour_open] = float(k.get("o"))
                            if cur_hour == hour_open:
                                o_1h = o1h_by_hour[hour_open]
                            continue

                        if interval != "1s":
                            continue

                        if cur_hour is None or hour_open != cur_hour:
                            if cur_hour is not None and state.position is not None:
                                if args.paper and paper_cfg is not None and paper_cfg.hold_to_expiry:
                                    if last_price is None or last_price_ts_ms is None:
                                        print("[PAPER] settle skipped (missing last price)")
                                    else:
                                        _settle_paper_position(
                                            executor,
                                            state,
                                            reason="hour_rollover",
                                            t_ms=last_price_ts_ms,
                                            close_price=last_price,
                                            o_1h=o_1h,
                                            market_slug=market_slug,
                                        )
                                elif strategy.exit_at_window_end:
                                    print("[WARN] position still open at hour rollover; forcing exit")
                                    _try_exit_position(
                                        executor, state, reason="hour_rollover", t_ms=t_ms
                                    )
                                else:
                                    _expire_live_position(
                                        state, reason="hour_rollover", t_ms=t_ms
                                    )

                            cur_hour = hour_open
                            o_1h = o1h_by_hour.get(cur_hour)
                            cum_vol = 0.0
                            last_60_closes.clear()
                            state.traded_this_hour = False
                            state.pending_bet_up = None
                            state.pending_since_ms = None

                        c = float(k.get("c"))
                        v = float(k.get("v"))
                        last_price = c
                        last_price_ts_ms = t_ms

                        cum_vol += v
                        last_60_closes.append(c)

                        if len(last_60_closes) >= 61:
                            prev = last_60_closes[0]
                            mom = math.log(c / (prev + 1e-12))
                        else:
                            mom = 0.0

                        if mom > args.regime_eps:
                            regime = 1
                        elif mom < -args.regime_eps:
                            regime = -1
                        else:
                            regime = 0

                        hour_end = cur_hour + 3_600_000
                        window_start = hour_end - (strategy.window_sec * 1000)
                        if t_ms < window_start:
                            continue

                        if o_1h is None:
                            continue

                        tau_sec = int((hour_end - t_ms) / 1000)
                        if tau_sec < 1 or tau_sec > strategy.window_sec:
                            continue

                        delta_pct = (c / (o_1h + 1e-12) - 1.0) * 100.0
                        p_up = prob_predict(
                            model=model,
                            delta_pct=delta_pct,
                            cum_vol_1h=cum_vol,
                            mom=mom,
                            regime=regime,
                            tau_sec=tau_sec,
                        )
                        pbad, sgn = compute_pbad(p_up, P_t=c, O_1h=o_1h)

                        stop_active = stop_at_ms is not None and t_ms >= stop_at_ms
                        if stop_active and not stop_logged:
                            print(
                                f"[STOP] reached stop_at_et={_ms_to_et_str(stop_at_ms)}; "
                                "no new entries"
                            )
                            stop_logged = True

                        if args.log_every_sec and (t_ms - last_log_ms) >= (
                            args.log_every_sec * 1000
                        ):
                            last_log_ms = t_ms
                            print(
                                f"[SIGNAL] tau={tau_sec:3d}s time={_ms_to_utc_str(t_ms)} "
                                f"p_up={p_up:.4f} pbad={pbad:.4f} sign={sgn:+d}"
                            )
                            if signal_log_fh is not None:
                                payload = {
                                    "t_ms": t_ms,
                                    "hour_open_ms": hour_open,
                                    "tau_sec": tau_sec,
                                    "p_up": p_up,
                                    "pbad": pbad,
                                    "price": c,
                                    "o_1h": o_1h,
                                    "market_slug": market_slug,
                                }
                                if args.log_orderbook_gap:
                                    try:
                                        params = [
                                            BookParams(token_id=token_id_up),
                                            BookParams(token_id=token_id_down),
                                        ]
                                        if hasattr(client, "get_order_books"):
                                            books = client.get_order_books(params)
                                        else:
                                            books = [
                                                client.get_order_book(token_id_up),
                                                client.get_order_book(token_id_down),
                                            ]
                                        by_id = {}
                                        for book in books or []:
                                            asset_id = getattr(book, "asset_id", None)
                                            if asset_id:
                                                by_id[asset_id] = book
                                        yes_book = by_id.get(token_id_up)
                                        no_book = by_id.get(token_id_down)
                                        yes_bid, yes_ask = (None, None)
                                        no_bid, no_ask = (None, None)
                                        if yes_book is not None:
                                            yes_bid, yes_ask = _best_bid_ask(yes_book)
                                        if no_book is not None:
                                            no_bid, no_ask = _best_bid_ask(no_book)
                                        yes_mid = _mid_from_bid_ask(yes_bid, yes_ask)
                                        no_mid = _mid_from_bid_ask(no_bid, no_ask)
                                        payload["orderbook"] = {
                                            "yes": {
                                                "bid": yes_bid,
                                                "ask": yes_ask,
                                                "mid": yes_mid,
                                            },
                                            "no": {
                                                "bid": no_bid,
                                                "ask": no_ask,
                                                "mid": no_mid,
                                            },
                                            "gap_yes": (p_up - yes_mid)
                                            if yes_mid is not None
                                            else None,
                                            "gap_no": ((1.0 - p_up) - no_mid)
                                            if no_mid is not None
                                            else None,
                                        }
                                    except Exception as exc:
                                        payload["orderbook_error"] = str(exc)
                                signal_log_fh.write(
                                    json.dumps(payload, separators=(",", ":")) + "\\n"
                                )
                                signal_log_lines += 1
                                if (signal_log_lines % signal_log_flush_every) == 0:
                                    signal_log_fh.flush()

                        if args.signals_only:
                            continue

                        if stop_active:
                            state.pending_bet_up = None
                            state.pending_since_ms = None
                            if args.stop_exit and state.position is not None:
                                _try_exit_position(
                                    executor,
                                    state,
                                    reason="stop_time",
                                    t_ms=t_ms,
                                )
                            if state.position is None:
                                print("[STOP] no open position; exiting")
                                return
                        else:
                            bet_up_signal = None
                            if p_up >= strategy.entry_high:
                                bet_up_signal = True
                            elif p_up <= strategy.entry_low:
                                bet_up_signal = False

                            if state.position is None and not state.traded_this_hour:
                                if bet_up_signal is not None:
                                    if state.pending_bet_up is None:
                                        state.pending_bet_up = bet_up_signal
                                        state.pending_since_ms = t_ms
                                        print(
                                            f"[ENTRY] pending tau={tau_sec}s bet_up={bet_up_signal} "
                                            f"p_up={p_up:.4f}"
                                        )
                                    elif state.pending_bet_up != bet_up_signal:
                                        state.pending_bet_up = bet_up_signal
                                        state.pending_since_ms = t_ms
                                        print(
                                            f"[ENTRY] pending switch tau={tau_sec}s bet_up={bet_up_signal} "
                                            f"p_up={p_up:.4f}"
                                        )

                                if state.pending_bet_up is not None:
                                    if market_closed:
                                        print("[ENTRY] skip (market closed)")
                                        state.pending_bet_up = None
                                        state.pending_since_ms = None
                                        state.traded_this_hour = True
                                    elif enable_orderbook is False:
                                        print("[ENTRY] skip (orderbook disabled)")
                                        state.pending_bet_up = None
                                        state.pending_since_ms = None
                                        state.traded_this_hour = True
                                    else:
                                        token_id = (
                                            token_id_up if state.pending_bet_up else token_id_down
                                        )
                                        print(
                                            f"[ENTRY] tau={tau_sec}s bet_up={state.pending_bet_up} "
                                            f"p_up={p_up:.4f} token_id={token_id}"
                                        )
                                        fill = executor.market_buy_max(token_id)
                                        if fill is not None:
                                            state.position = Position(
                                                token_id=token_id,
                                                bet_up=state.pending_bet_up,
                                                entry_ts_ms=t_ms,
                                                entry_price=fill.avg_price,
                                                shares=fill.shares,
                                                cost_usdc=fill.usdc,
                                                entry_o_1h=o_1h,
                                            )
                                            if not args.allow_scale_in:
                                                state.traded_this_hour = True
                                            state.pending_bet_up = None
                                            state.pending_since_ms = None

                                if (
                                    state.position is None
                                    and state.pending_bet_up is not None
                                    and tau_sec <= 1
                                ):
                                    print(
                                        f"[ENTRY] pending expired tau={tau_sec}s "
                                        f"bet_up={state.pending_bet_up}"
                                    )
                                    state.pending_bet_up = None
                                    state.pending_since_ms = None
                                    state.traded_this_hour = True
                            elif (
                                args.allow_scale_in
                                and state.position is not None
                                and not state.traded_this_hour
                                and bet_up_signal is not None
                                and state.position.bet_up == bet_up_signal
                            ):
                                if market_closed:
                                    print("[ENTRY] scale-in skip (market closed)")
                                    state.traded_this_hour = True
                                elif enable_orderbook is False:
                                    print("[ENTRY] scale-in skip (orderbook disabled)")
                                    state.traded_this_hour = True
                                else:
                                    try:
                                        available = executor.compute_buy_usdc()
                                    except Exception as exc:
                                        print(
                                            f"[ENTRY] scale-in skip (balance check failed: {exc})"
                                        )
                                        state.traded_this_hour = True
                                        continue
                                    if available < executor.cfg.min_usdc:
                                        print(
                                            "[ENTRY] scale-in skip "
                                            f"(amount={available:.4f} < min_usdc={executor.cfg.min_usdc:.4f})"
                                        )
                                        state.traded_this_hour = True
                                        continue
                                    token_id = token_id_up if bet_up_signal else token_id_down
                                    print(
                                        f"[ENTRY] scale-in tau={tau_sec}s bet_up={bet_up_signal} "
                                        f"p_up={p_up:.4f} token_id={token_id}"
                                    )
                                    fill = executor.market_buy_max(token_id)
                                    if fill is not None:
                                        _apply_fill_to_position(state.position, fill)

                        if state.position is None:
                            continue

                        exit_now = False
                        exit_reason = None
                        if strategy.mode == "pm":
                            if state.position.bet_up and p_up < strategy.exit_high:
                                exit_now = True
                                exit_reason = "pm_exit"
                            elif (not state.position.bet_up) and p_up > strategy.exit_low:
                                exit_now = True
                                exit_reason = "pm_exit"
                        else:
                            if pbad > strategy.theta:
                                exit_now = True
                                exit_reason = "pbad"

                        if (
                            not exit_now
                            and strategy.exit_at_window_end
                            and tau_sec <= strategy.exit_at_window_end_sec
                        ):
                            exit_now = True
                            exit_reason = "window_end"

                        if exit_now:
                            if args.allow_scale_in:
                                state.traded_this_hour = True
                                state.pending_bet_up = None
                                state.pending_since_ms = None
                            if args.paper and paper_cfg is not None and paper_cfg.hold_to_expiry:
                                if exit_reason == "pbad":
                                    _try_exit_position(
                                        executor,
                                        state,
                                        reason=exit_reason,
                                        t_ms=t_ms,
                                    )
                                else:
                                    pass
                            else:
                                _try_exit_position(
                                    executor,
                                    state,
                                    reason=(exit_reason or "signal_exit"),
                                    t_ms=t_ms,
                                )
            except asyncio.CancelledError:
                raise
            except (websockets.exceptions.ConnectionClosed, ConnectionResetError, OSError) as exc:
                print(f"[WARN] websocket disconnected: {exc}; reconnecting in 5s")
                await asyncio.sleep(5)
    finally:
        if signal_log_fh is not None:
            signal_log_fh.flush()
            signal_log_fh.close()


def _try_exit_position(
    executor: PolymarketExecutor, state: TradeState, reason: str, t_ms: int
) -> None:
    if state.position is None:
        return
    print(
        f"[EXIT] reason={reason} time={_ms_to_utc_str(t_ms)} token_id={state.position.token_id}"
    )
    try:
        sold = executor.market_sell_all(state.position.token_id)
        if sold is not None:
            state.position = None
    except Exception as exc:
        print(f"[EXIT] failed: {exc}")


def _expire_live_position(state: TradeState, reason: str, t_ms: int) -> None:
    if state.position is None:
        return
    print(
        f"[HOLD] expiry reason={reason} time={_ms_to_utc_str(t_ms)} "
        f"token_id={state.position.token_id} (no exit order)"
    )
    state.position = None


def _settle_paper_position(
    executor: PaperExecutor,
    state: TradeState,
    reason: str,
    t_ms: int,
    close_price: float,
    o_1h: Optional[float],
    market_slug: str,
) -> None:
    if state.position is None:
        return
    pos = state.position
    entry_o_1h = pos.entry_o_1h if pos.entry_o_1h is not None else o_1h
    if entry_o_1h is None:
        print("[PAPER] settle skipped (missing O_1h)")
        return
    if pos.shares <= 0:
        print("[PAPER] settle skipped (missing shares)")
        return

    outcome_up = close_price >= entry_o_1h
    won = pos.bet_up == outcome_up
    payout = pos.shares * (1.0 if won else 0.0)
    pnl = payout - pos.cost_usdc

    executor.usdc_balance += payout
    remaining = executor.positions.get(pos.token_id, 0.0) - pos.shares
    if remaining <= 1e-9:
        executor.positions.pop(pos.token_id, None)
    else:
        executor.positions[pos.token_id] = remaining

    print(
        f"[PAPER] settle reason={reason} time={_ms_to_utc_str(t_ms)} "
        f"won={won} payout={payout:.4f} pnl={pnl:.4f} balance={executor.usdc_balance:.4f}"
    )
    _write_paper_ledger(
        executor.paper_cfg.ledger_path,
        {
            "event": "settle",
            "reason": reason,
            "t_ms": int(t_ms),
            "market_slug": market_slug,
            "token_id": pos.token_id,
            "bet_up": pos.bet_up,
            "entry_ts_ms": pos.entry_ts_ms,
            "entry_price": pos.entry_price,
            "entry_o_1h": entry_o_1h,
            "close_price": close_price,
            "won": won,
            "shares": pos.shares,
            "cost_usdc": pos.cost_usdc,
            "payout": payout,
            "pnl": pnl,
            "balance_usdc": executor.usdc_balance,
            "pnl_total": executor.usdc_balance - executor.start_usdc,
        },
    )
    state.position = None


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", default=None, help="Polymarket slug")
    ap.add_argument("--slug-prefix", default=None)
    ap.add_argument("--auto-slug", dest="auto_slug", action="store_true")
    ap.add_argument("--no-auto-slug", dest="auto_slug", action="store_false")
    ap.set_defaults(auto_slug=None)
    ap.add_argument("--search-hours", type=int, default=12)
    ap.add_argument("--search-step-hours", type=int, default=1)
    ap.add_argument("--auto-refresh-sec", type=int, default=300)
    ap.add_argument("--token-id-up", default=None, help="Up/Yes token ID")
    ap.add_argument("--token-id-down", default=None, help="Down/No token ID")
    ap.add_argument(
        "--model-path",
        default=str(SCRIPT_DIR / "out" / "prob_model_logit_all.json"),
    )
    ap.add_argument("--mode", choices=["pm", "pbad"], default="pbad")
    ap.add_argument("--entry-high", type=float, default=0.96)
    ap.add_argument("--entry-low", type=float, default=0.04)
    ap.add_argument("--exit-high", type=float, default=0.70)
    ap.add_argument("--exit-low", type=float, default=0.30)
    ap.add_argument("--theta", type=float, default=0.5)
    ap.add_argument("--window-sec", type=int, default=240)
    ap.add_argument("--log-every-sec", type=int, default=5)
    ap.add_argument("--regime-eps", type=float, default=0.0002)
    ap.add_argument("--signal-log", default=None)
    ap.add_argument("--signal-log-flush-every", type=int, default=10)
    ap.add_argument("--log-orderbook-gap", action="store_true")

    ap.add_argument("--max-usdc", type=float, default=None)
    ap.add_argument("--min-usdc", type=float, default=1.0)
    ap.add_argument("--reserve-usdc", type=float, default=0.0)
    ap.add_argument("--min-shares", type=float, default=0.01)
    ap.add_argument("--order-type", default="FAK")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--allow-scale-in", action="store_true")
    ap.add_argument("--list-open-orders", action="store_true")
    ap.add_argument("--list-trades", action="store_true")
    ap.add_argument("--cancel-order", action="append", default=[])
    ap.add_argument("--cancel-orders", default=None)
    ap.add_argument("--cancel-all-orders", action="store_true")
    ap.add_argument("--cancel-market-orders", default=None)

    ap.add_argument("--paper", action="store_true", help="simulate orderbook fills only")
    ap.add_argument("--paper-usdc", type=float, default=1000.0)
    ap.add_argument("--paper-ledger", default=None)
    ap.add_argument(
        "--paper-hold-to-expiry",
        dest="paper_hold_to_expiry",
        action="store_true",
        help="hold positions to hourly settlement",
    )
    ap.add_argument(
        "--no-paper-hold-to-expiry",
        dest="paper_hold_to_expiry",
        action="store_false",
    )
    ap.set_defaults(paper_hold_to_expiry=True)

    ap.add_argument("--private-key", default=None)
    ap.add_argument("--funder", default=None)
    ap.add_argument(
        "--env-prefix",
        default="POLY",
        help="Env var prefix for secrets (e.g. POLY, POLY2).",
    )
    ap.add_argument(
        "--signature-type",
        type=int,
        default=2,
        help="0=EOA, 1=POLY_PROXY, 2=GNOSIS_SAFE",
    )
    ap.add_argument("--api-key", default=None)
    ap.add_argument("--api-secret", default=None)
    ap.add_argument("--api-passphrase", default=None)
    ap.add_argument("--clob-host", default=CLOB_HOST)
    ap.add_argument("--chain-id", type=int, default=CHAIN_ID)

    ap.add_argument("--ws-url", default=BINANCE_WS_URL)

    ap.add_argument("--exit-at-window-end", dest="exit_at_window_end", action="store_true")
    ap.add_argument(
        "--no-exit-at-window-end", dest="exit_at_window_end", action="store_false"
    )
    ap.set_defaults(exit_at_window_end=True)
    ap.add_argument(
        "--exit-at-window-end-sec",
        type=int,
        default=2,
        help="exit this many seconds before the window ends",
    )
    ap.add_argument(
        "--stop-at-et",
        default=None,
        help="Stop new entries after this ET time (YYYY-MM-DD HH:MM[:SS] or ISO).",
    )
    ap.add_argument(
        "--stop-exit",
        action="store_true",
        help="Attempt to exit an open position at stop time.",
    )
    ap.add_argument(
        "--signals-only",
        action="store_true",
        help="Log signals only; disable all trading.",
    )
    ap.add_argument(
        "--run-for-sec",
        type=int,
        default=None,
        help="Stop after this many seconds of runtime.",
    )
    return ap.parse_args()


def main() -> None:
    args = parse_args()
    if _has_order_ops(args):
        _run_order_ops(args)
        return
    asyncio.run(run_trader(args))


if __name__ == "__main__":
    main()
