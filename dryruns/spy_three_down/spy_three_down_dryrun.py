#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any


YAHOO_CHART_BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart"


@dataclass(frozen=True)
class Candle:
    day: date
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass(frozen=True)
class KillSwitchConfig:
    max_data_age_days: int = 5
    atr_period: int = 14
    max_atr_pct: float = 0.025
    enable_trend_kill: bool = False
    sma_period: int = 200


@dataclass(frozen=True)
class KillSwitchResult:
    killed: bool
    reasons: list[str]
    warnings: list[str]
    metrics: dict[str, float | int | str | None]


@dataclass(frozen=True)
class ActionLogEntry:
    node: str
    status: str
    message: str


@dataclass(frozen=True)
class Trade:
    signal_day: date
    entry_day: date
    entry_price: float
    exit_day: date
    exit_price: float
    shares: float
    pnl: float
    return_pct: float


def parse_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(parsed):
        return None
    return parsed


def previous_business_day(day: date) -> date:
    current = day
    while current.weekday() >= 5:
        current -= timedelta(days=1)
    return current


def business_days_ending(end_day: date, count: int) -> list[date]:
    days: list[date] = []
    current = previous_business_day(end_day)
    while len(days) < count:
        if current.weekday() < 5:
            days.append(current)
        current -= timedelta(days=1)
    return list(reversed(days))


def load_fixture_candles(today: date | None = None) -> list[Candle]:
    end_day = today or datetime.now(timezone.utc).date()
    days = business_days_ending(end_day, 45)
    candles: list[Candle] = []
    close = 445.0

    for index, day in enumerate(days):
        drift = 0.35 if index % 4 else -0.18
        close = round(close + drift + ((index % 5) - 2) * 0.07, 2)
        open_price = round(close - 0.25 + (index % 3) * 0.08, 2)
        high = round(max(open_price, close) + 1.1, 2)
        low = round(min(open_price, close) - 1.0, 2)
        volume = 70_000_000 + index * 250_000
        candles.append(Candle(day, open_price, high, low, close, volume))

    def replace_candle_close(index: int, forced_close: float) -> None:
        day = candles[index].day
        open_price = round(forced_close + 0.35, 2)
        high = round(open_price + 1.15, 2)
        low = round(forced_close - 1.05, 2)
        candles[index] = Candle(day, open_price, high, low, forced_close, candles[index].volume)

    historical_start = len(candles) - 12
    for offset, forced_close in enumerate([457.60, 456.30, 455.10, 453.90]):
        replace_candle_close(historical_start + offset, forced_close)

    exit_index = historical_start + 4
    exit_day = candles[exit_index].day
    exit_open = 454.65
    exit_close = 454.80
    candles[exit_index] = Candle(
        exit_day,
        exit_open,
        round(exit_close + 1.05, 2),
        round(exit_open - 1.0, 2),
        exit_close,
        candles[exit_index].volume,
    )

    latest_start = len(candles) - 4
    for offset, forced_close in enumerate([458.00, 456.40, 454.80, 452.90]):
        replace_candle_close(latest_start + offset, forced_close)

    return candles


def parse_yahoo_chart_payload(payload: dict[str, Any]) -> list[Candle]:
    chart = payload.get("chart")
    if not isinstance(chart, dict):
        raise RuntimeError("Yahoo response did not include chart data")

    error = chart.get("error")
    if error:
        if isinstance(error, dict):
            raise RuntimeError(str(error.get("description") or error.get("message") or error))
        raise RuntimeError(str(error))

    results = chart.get("result")
    if not isinstance(results, list) or not results:
        raise RuntimeError("Yahoo response did not include a chart result")

    result = results[0]
    timestamps = result.get("timestamp") if isinstance(result, dict) else None
    indicators = result.get("indicators") if isinstance(result, dict) else None
    quotes = indicators.get("quote") if isinstance(indicators, dict) else None
    quote = quotes[0] if isinstance(quotes, list) and quotes else None

    if not isinstance(timestamps, list) or not isinstance(quote, dict):
        raise RuntimeError("Yahoo response did not include timestamp and quote arrays")

    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []

    candles: list[Candle] = []
    for index, timestamp in enumerate(timestamps):
        open_price = parse_float(opens[index] if index < len(opens) else None)
        high = parse_float(highs[index] if index < len(highs) else None)
        low = parse_float(lows[index] if index < len(lows) else None)
        close = parse_float(closes[index] if index < len(closes) else None)
        volume = parse_float(volumes[index] if index < len(volumes) else 0) or 0.0
        if open_price is None or high is None or low is None or close is None:
            continue

        day = datetime.fromtimestamp(float(timestamp), timezone.utc).date()
        candles.append(Candle(day, open_price, high, low, close, volume))

    if len(candles) < 4:
        raise RuntimeError("Not enough usable Yahoo candles for a three-down signal")

    candles.sort(key=lambda candle: candle.day)
    return candles


def fetch_yahoo_candles(symbol: str, range_: str, interval: str, timeout_seconds: int) -> list[Candle]:
    query = urllib.parse.urlencode({
        "range": range_,
        "interval": interval,
        "symbol": symbol.upper(),
    })
    url = f"{YAHOO_CHART_BASE_URL}/{urllib.parse.quote(symbol.upper())}?{query}"
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "hershy-spy-three-down-dryrun/1.0",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace").strip()
        detail = f"Yahoo returned HTTP {exc.code}"
        if body:
            detail = f"{detail}: {body[:180]}"
        raise RuntimeError(detail) from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Yahoo request failed: {exc.reason}") from exc

    return parse_yahoo_chart_payload(payload)


def load_csv_candles(path: Path) -> list[Candle]:
    with path.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))

    candles: list[Candle] = []
    for row in rows:
        day_text = row.get("date") or row.get("day") or row.get("timestamp")
        if not day_text:
            continue
        day = datetime.fromisoformat(day_text[:10]).date()
        open_price = parse_float(row.get("open"))
        high = parse_float(row.get("high"))
        low = parse_float(row.get("low"))
        close = parse_float(row.get("close"))
        volume = parse_float(row.get("volume")) or 0.0
        if open_price is None or high is None or low is None or close is None:
            continue
        candles.append(Candle(day, open_price, high, low, close, volume))

    if len(candles) < 4:
        raise RuntimeError(f"Not enough usable candles in {path}")
    candles.sort(key=lambda candle: candle.day)
    return candles


def is_three_down_close(candles: list[Candle], index: int) -> bool:
    if index < 3:
        return False
    return (
        candles[index - 2].close < candles[index - 3].close and
        candles[index - 1].close < candles[index - 2].close and
        candles[index].close < candles[index - 1].close
    )


def true_range(candles: list[Candle], index: int) -> float:
    candle = candles[index]
    if index == 0:
        return candle.high - candle.low
    previous_close = candles[index - 1].close
    return max(
        candle.high - candle.low,
        abs(candle.high - previous_close),
        abs(candle.low - previous_close),
    )


def calculate_atr(candles: list[Candle], period: int, index: int) -> float | None:
    if period <= 0 or index < period:
        return None
    ranges = [true_range(candles, item_index) for item_index in range(index - period + 1, index + 1)]
    return sum(ranges) / len(ranges)


def calculate_sma(candles: list[Candle], period: int, index: int) -> float | None:
    if period <= 0 or index + 1 < period:
        return None
    closes = [candle.close for candle in candles[index - period + 1:index + 1]]
    return sum(closes) / period


def evaluate_kill_switches(
    candles: list[Candle],
    index: int,
    config: KillSwitchConfig,
    today: date,
    check_freshness: bool,
) -> KillSwitchResult:
    candle = candles[index]
    reasons: list[str] = []
    warnings: list[str] = []
    metrics: dict[str, float | int | str | None] = {
        "latest_day": candle.day.isoformat(),
        "close": round(candle.close, 4),
    }

    if check_freshness:
        age_days = (today - candle.day).days
        metrics["data_age_days"] = age_days
        if age_days > config.max_data_age_days:
            reasons.append(
                f"Data stale: latest candle is {age_days} days old, max allowed is {config.max_data_age_days}"
            )

    if candle.open <= 0 or candle.high <= 0 or candle.low <= 0 or candle.close <= 0:
        reasons.append("Malformed candle: OHLC must be positive")

    atr = calculate_atr(candles, config.atr_period, index)
    if atr is None:
        warnings.append(f"ATR({config.atr_period}) unavailable; volatility kill switch skipped")
        metrics["atr_pct"] = None
    else:
        atr_pct = atr / candle.close
        metrics["atr"] = round(atr, 4)
        metrics["atr_pct"] = round(atr_pct, 6)
        if atr_pct > config.max_atr_pct:
            reasons.append(
                f"Volatility kill: ATR({config.atr_period})/close is {atr_pct:.2%}, max allowed is {config.max_atr_pct:.2%}"
            )

    if config.enable_trend_kill:
        sma = calculate_sma(candles, config.sma_period, index)
        if sma is None:
            warnings.append(f"SMA({config.sma_period}) unavailable; trend kill switch skipped")
            metrics[f"sma_{config.sma_period}"] = None
        else:
            metrics[f"sma_{config.sma_period}"] = round(sma, 4)
            if candle.close < sma:
                reasons.append(
                    f"Trend kill: close {candle.close:.2f} is below SMA({config.sma_period}) {sma:.2f}"
                )

    return KillSwitchResult(
        killed=bool(reasons),
        reasons=reasons,
        warnings=warnings,
        metrics=metrics,
    )


def replay_trades(candles: list[Candle], config: KillSwitchConfig, shares: float) -> tuple[list[Trade], int]:
    trades: list[Trade] = []
    killed_signals = 0
    today = datetime.now(timezone.utc).date()

    for index in range(3, len(candles) - 1):
        if not is_three_down_close(candles, index):
            continue
        kill = evaluate_kill_switches(candles, index, config, today=today, check_freshness=False)
        if kill.killed:
            killed_signals += 1
            continue

        entry = candles[index]
        exit_candle = candles[index + 1]
        pnl = (exit_candle.open - entry.close) * shares
        return_pct = (exit_candle.open - entry.close) / entry.close
        trades.append(Trade(
            signal_day=entry.day,
            entry_day=entry.day,
            entry_price=entry.close,
            exit_day=exit_candle.day,
            exit_price=exit_candle.open,
            shares=shares,
            pnl=pnl,
            return_pct=return_pct,
        ))

    return trades, killed_signals


def build_dry_run_report(
    symbol: str,
    source: str,
    candles: list[Candle],
    config: KillSwitchConfig,
    shares: float,
) -> dict[str, Any]:
    latest_index = len(candles) - 1
    latest = candles[latest_index]
    signal = is_three_down_close(candles, latest_index)
    today = datetime.now(timezone.utc).date()
    kill = evaluate_kill_switches(candles, latest_index, config, today=today, check_freshness=True)
    action_log: list[ActionLogEntry] = [
        ActionLogEntry(
            node="SPY Daily OHLCV Stream",
            status="ok",
            message=f"Loaded {len(candles)} daily candles from {source}",
        ),
        ActionLogEntry(
            node="3-Down Close Detector",
            status="yes" if signal else "no",
            message="Latest close completes three consecutive down closes" if signal else "Latest close does not complete three consecutive down closes",
        ),
    ]

    if not signal:
        decision = "NO_TRADE"
        action_log.append(ActionLogEntry(
            node="Workflow",
            status="halted",
            message="Entry path stopped before pre-trade kill switch because the signal is false",
        ))
    elif kill.killed:
        decision = "KILLED"
        action_log.append(ActionLogEntry(
            node="Pre-Trade Kill Switch",
            status="killed",
            message="; ".join(kill.reasons),
        ))
        action_log.append(ActionLogEntry(
            node="Error Handler",
            status="recorded",
            message="Entry action blocked; error record emitted for monitor log",
        ))
    else:
        decision = "WOULD_ENTER_LONG"
        action_log.append(ActionLogEntry(
            node="Pre-Trade Kill Switch",
            status="pass",
            message="All enabled kill switches passed",
        ))
        action_log.append(ActionLogEntry(
            node="Enter Long SPY at Third Down Close",
            status="paper_order",
            message=f"BUY {shares:g} {symbol.upper()} at close {latest.close:.2f}",
        ))
        action_log.append(ActionLogEntry(
            node="Exit Scheduler",
            status="scheduled",
            message="SELL at next session open when the next candle becomes available",
        ))

    trades, killed_signals = replay_trades(candles, config, shares)
    total_pnl = sum(trade.pnl for trade in trades)
    average_return_pct = (sum(trade.return_pct for trade in trades) / len(trades)) if trades else 0.0

    return {
        "symbol": symbol.upper(),
        "source": source,
        "latest_candle": candle_to_dict(latest),
        "signal": {
            "three_down_close": signal,
            "last_four_closes": [round(candles[latest_index - offset].close, 4) for offset in range(3, -1, -1)],
        },
        "kill_switch": kill_to_dict(kill),
        "decision": decision,
        "action_log": [asdict(entry) for entry in action_log],
        "historical_replay": {
            "executed_trades": len(trades),
            "killed_signals": killed_signals,
            "total_pnl": round(total_pnl, 2),
            "average_return_pct": round(average_return_pct * 100, 4),
            "trades": [trade_to_dict(trade) for trade in trades[-10:]],
        },
    }


def candle_to_dict(candle: Candle) -> dict[str, Any]:
    return {
        "date": candle.day.isoformat(),
        "open": round(candle.open, 4),
        "high": round(candle.high, 4),
        "low": round(candle.low, 4),
        "close": round(candle.close, 4),
        "volume": round(candle.volume, 4),
    }


def kill_to_dict(kill: KillSwitchResult) -> dict[str, Any]:
    return {
        "killed": kill.killed,
        "reasons": kill.reasons,
        "warnings": kill.warnings,
        "metrics": kill.metrics,
    }


def trade_to_dict(trade: Trade) -> dict[str, Any]:
    return {
        "signal_day": trade.signal_day.isoformat(),
        "entry_day": trade.entry_day.isoformat(),
        "entry_price": round(trade.entry_price, 4),
        "exit_day": trade.exit_day.isoformat(),
        "exit_price": round(trade.exit_price, 4),
        "shares": trade.shares,
        "pnl": round(trade.pnl, 2),
        "return_pct": round(trade.return_pct * 100, 4),
    }


def print_report(report: dict[str, Any]) -> None:
    latest = report["latest_candle"]
    signal = report["signal"]
    kill = report["kill_switch"]
    replay = report["historical_replay"]

    print(f"Strategy: SPY three consecutive down-close mean reversion")
    print(f"Symbol: {report['symbol']}")
    print(f"Source: {report['source']}")
    print(f"Latest candle: {latest['date']} close={latest['close']:.2f} volume={latest['volume']:.0f}")
    print(f"Last four closes: {', '.join(f'{value:.2f}' for value in signal['last_four_closes'])}")
    print(f"Signal three_down_close: {signal['three_down_close']}")
    print(f"Decision: {report['decision']}")
    print()

    print("Kill Switch")
    print(f"- killed: {kill['killed']}")
    if kill["reasons"]:
        for reason in kill["reasons"]:
            print(f"- reason: {reason}")
    if kill["warnings"]:
        for warning in kill["warnings"]:
            print(f"- warning: {warning}")
    for key, value in kill["metrics"].items():
        print(f"- {key}: {value}")
    print()

    print("Action Log")
    for entry in report["action_log"]:
        print(f"- [{entry['status']}] {entry['node']}: {entry['message']}")
    print()

    print("Historical Replay")
    print(f"- executed trades: {replay['executed_trades']}")
    print(f"- killed signals: {replay['killed_signals']}")
    print(f"- total pnl: {replay['total_pnl']:.2f}")
    print(f"- average return pct: {replay['average_return_pct']:.4f}%")
    if replay["trades"]:
        print("- last trades:")
        for trade in replay["trades"]:
            print(
                f"  {trade['entry_day']} buy {trade['entry_price']:.2f} -> "
                f"{trade['exit_day']} sell open {trade['exit_price']:.2f}; "
                f"pnl={trade['pnl']:.2f}, return={trade['return_pct']:.4f}%"
            )


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Dry run the SPY three-down-close strategy.")
    parser.add_argument("--data-source", choices=["yahoo", "fixture", "csv"], default="yahoo")
    parser.add_argument("--fallback-fixture", action="store_true", help="Use the built-in fixture if Yahoo fetch fails.")
    parser.add_argument("--csv", type=Path, help="CSV path with date, open, high, low, close, volume columns.")
    parser.add_argument("--symbol", default="SPY")
    parser.add_argument("--range", default="6mo", dest="range_")
    parser.add_argument("--interval", default="1d")
    parser.add_argument("--timeout-seconds", type=int, default=12)
    parser.add_argument("--shares", type=float, default=1.0)
    parser.add_argument("--max-data-age-days", type=int, default=5)
    parser.add_argument("--atr-period", type=int, default=14)
    parser.add_argument("--max-atr-pct", type=float, default=0.025)
    parser.add_argument("--enable-trend-kill", action="store_true")
    parser.add_argument("--sma-period", type=int, default=200)
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    return parser.parse_args(argv)


def load_candles(args: argparse.Namespace) -> tuple[list[Candle], str]:
    if args.data_source == "fixture":
        return load_fixture_candles(), "built-in fixture"

    if args.data_source == "csv":
        if not args.csv:
            raise RuntimeError("--csv is required when --data-source csv is used")
        return load_csv_candles(args.csv), str(args.csv)

    try:
        return (
            fetch_yahoo_candles(args.symbol, args.range_, args.interval, args.timeout_seconds),
            f"Yahoo Finance chart range={args.range_} interval={args.interval}",
        )
    except RuntimeError:
        if not args.fallback_fixture:
            raise
        return load_fixture_candles(), "built-in fixture after Yahoo fetch failure"


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    config = KillSwitchConfig(
        max_data_age_days=args.max_data_age_days,
        atr_period=args.atr_period,
        max_atr_pct=args.max_atr_pct,
        enable_trend_kill=args.enable_trend_kill,
        sma_period=args.sma_period,
    )

    try:
        candles, source = load_candles(args)
        report = build_dry_run_report(args.symbol, source, candles, config, args.shares)
    except Exception as exc:
        print(f"dry run failed: {exc}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print_report(report)

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
