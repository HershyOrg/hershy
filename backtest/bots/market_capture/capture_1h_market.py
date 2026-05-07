#!/usr/bin/env python3
import argparse
import asyncio
import datetime as dt
import json
import re
import sys
import urllib.parse
import urllib.request
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
LIBS_DIR = REPO_ROOT / "libs"
if str(LIBS_DIR) not in sys.path:
    sys.path.insert(0, str(LIBS_DIR))

import pandas as pd
import websockets

from polymarket_utils import (
    ET_TZ,
    SLUG_TIME_RE,
    build_slug,
    fetch_market_by_slug,
    find_active_market_by_time,
    normalize_slug,
    resolve_yes_no_tokens,
)

PM_WS = "wss://ws-subscriptions-clob.polymarket.com/ws/market"
BINANCE_WS = "wss://stream.binance.com:9443/ws"
BINANCE_REST = "https://api.binance.com/api/v3/klines"
HOUR_MS = 3_600_000


def _safe_slug(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "_", value).strip("_")


def _parse_iso_dt(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    try:
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        parsed = dt.datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=dt.timezone.utc)
    return parsed


def _parse_slug_start(slug: str) -> dt.datetime | None:
    slug = normalize_slug(slug)
    match = SLUG_TIME_RE.match(slug)
    if not match:
        return None
    month_name = match.group("month")
    day = int(match.group("day"))
    hour = int(match.group("hour"))
    ampm = match.group("ampm")

    month_map = {
        "january": 1,
        "february": 2,
        "march": 3,
        "april": 4,
        "may": 5,
        "june": 6,
        "july": 7,
        "august": 8,
        "september": 9,
        "october": 10,
        "november": 11,
        "december": 12,
    }
    month = month_map.get(month_name)
    if month is None:
        return None

    hour24 = hour % 12
    if ampm == "pm":
        hour24 += 12

    now_et = dt.datetime.now(tz=ET_TZ)
    year = now_et.year
    candidate = dt.datetime(year, month, day, hour24, tzinfo=ET_TZ)
    if candidate - now_et > dt.timedelta(days=180):
        candidate = candidate.replace(year=year - 1)
    elif now_et - candidate > dt.timedelta(days=180):
        candidate = candidate.replace(year=year + 1)
    return candidate


def _window_from_market(market: dict, slug: str) -> tuple[int, int, dt.datetime]:
    start_dt = _parse_iso_dt(market.get("startDate"))
    end_dt = _parse_iso_dt(market.get("endDate"))

    if start_dt and end_dt:
        pass
    elif start_dt and not end_dt:
        end_dt = start_dt + dt.timedelta(hours=1)
    elif end_dt and not start_dt:
        start_dt = end_dt - dt.timedelta(hours=1)
    else:
        start_et = _parse_slug_start(slug)
        if start_et is None:
            raise ValueError("Unable to infer window from slug; missing start/end date.")
        start_dt = start_et.astimezone(dt.timezone.utc)
        end_dt = start_dt + dt.timedelta(hours=1)

    start_ms = int(start_dt.timestamp() * 1000)
    end_ms = int(end_dt.timestamp() * 1000)
    start_et = start_dt.astimezone(ET_TZ)
    return start_ms, end_ms, start_et


def _normalize_ts_ms(value) -> int:
    try:
        ts = int(float(value))
    except (TypeError, ValueError):
        return int(time.time() * 1000)
    if ts < 1_000_000_000_000:
        return ts * 1000
    if ts > 1_000_000_000_000_000:
        return int(ts / 1_000_000)
    return ts


def _to_parquet(rows: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(rows)
    df.to_parquet(path, index=False)


def _fetch_binance_klines(
    symbol: str,
    interval: str,
    start_ms: int,
    end_ms: int,
) -> list[dict]:
    params = {
        "symbol": symbol.upper(),
        "interval": interval,
        "startTime": str(start_ms),
        "endTime": str(end_ms),
        "limit": "1000",
    }
    url = BINANCE_REST + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.load(resp)
    if not isinstance(data, list):
        raise RuntimeError(f"Unexpected kline response: {data}")
    rows = []
    for row in data:
        if len(row) < 9:
            continue
        rows.append(
            {
                "open_ms": int(row[0]),
                "close_ms": int(row[6]),
                "volume": float(row[5]),
                "quote_volume": float(row[7]),
                "trades": int(row[8]),
            }
        )
    return rows


async def _capture_polymarket(
    token_ids: list[str],
    start_ms: int,
    end_ms: int,
    out_rows: list[dict],
) -> None:
    while True:
        now_ms = int(time.time() * 1000)
        if now_ms >= end_ms:
            return
        try:
            async with websockets.connect(
                PM_WS, ping_interval=20, ping_timeout=20
            ) as ws:
                sub = {
                    "type": "market",
                    "assets_ids": token_ids,
                    "custom_feature_enabled": True,
                }
                await ws.send(json.dumps(sub))
                while True:
                    now_ms = int(time.time() * 1000)
                    if now_ms >= end_ms:
                        return
                    try:
                        msg = await asyncio.wait_for(ws.recv(), timeout=1.0)
                    except asyncio.TimeoutError:
                        continue
                    if msg == "PONG":
                        continue
                    try:
                        data = json.loads(msg)
                    except json.JSONDecodeError:
                        continue

                    if isinstance(data, list):
                        events = data
                    elif isinstance(data, dict) and isinstance(data.get("data"), list):
                        events = data["data"]
                    else:
                        events = [data]

                    for event in events:
                        if not isinstance(event, dict):
                            continue
                        if event.get("event_type") != "best_bid_ask":
                            continue
                        ts_ms = _normalize_ts_ms(event.get("timestamp"))
                        if ts_ms < start_ms or ts_ms > end_ms:
                            continue
                        out_rows.append(
                            {
                                "ts_ms": ts_ms,
                                "token_id": event.get("asset_id"),
                                "best_bid": float(event.get("best_bid") or 0.0),
                                "best_ask": float(event.get("best_ask") or 0.0),
                            }
                        )
        except (websockets.exceptions.ConnectionClosed, OSError) as exc:
            print(f"[WARN] polymarket ws disconnected: {exc}; reconnecting in 2s")
            await asyncio.sleep(2)


async def _capture_binance(
    symbol: str,
    start_ms: int,
    end_ms: int,
    out_rows: list[dict],
) -> None:
    url = f"{BINANCE_WS}/{symbol.lower()}@bookTicker"
    while True:
        now_ms = int(time.time() * 1000)
        if now_ms >= end_ms:
            return
        try:
            async with websockets.connect(
                url, ping_interval=20, ping_timeout=20
            ) as ws:
                while True:
                    now_ms = int(time.time() * 1000)
                    if now_ms >= end_ms:
                        return
                    try:
                        msg = await asyncio.wait_for(ws.recv(), timeout=1.0)
                    except asyncio.TimeoutError:
                        continue
                    data = json.loads(msg)
                    ts_ms = _normalize_ts_ms(data.get("E"))
                    if ts_ms < start_ms or ts_ms > end_ms:
                        continue
                    out_rows.append(
                        {
                            "ts_ms": ts_ms,
                            "bid": float(data.get("b") or 0.0),
                            "ask": float(data.get("a") or 0.0),
                        }
                    )
        except (websockets.exceptions.ConnectionClosed, OSError) as exc:
            print(f"[WARN] binance ws disconnected: {exc}; reconnecting in 2s")
            await asyncio.sleep(2)


def _plot(
    pm_path: Path,
    binance_path: Path,
    kline_path: Path | None,
    out_png: Path,
    start_ms: int,
    slug: str,
    yes_token_id: str,
    no_token_id: str,
) -> None:
    import matplotlib.pyplot as plt
    import matplotlib.ticker as mtick

    pm_df = pd.read_parquet(pm_path)
    bin_df = pd.read_parquet(binance_path)
    kline_df = pd.DataFrame()
    if kline_path is not None and kline_path.exists():
        kline_df = pd.read_parquet(kline_path)

    if not pm_df.empty:
        pm_df["t_sec"] = (pm_df["ts_ms"] - start_ms) / 1000.0
    if not bin_df.empty:
        bin_df["t_sec"] = (bin_df["ts_ms"] - start_ms) / 1000.0
        bin_df["mid"] = (bin_df["bid"] + bin_df["ask"]) / 2.0
    if not kline_df.empty:
        kline_df["t_sec"] = (kline_df["open_ms"] - start_ms) / 1000.0
        kline_df["width_sec"] = (kline_df["close_ms"] - kline_df["open_ms"]) / 1000.0

    fig, axes = plt.subplots(2, 1, figsize=(12, 8), sharex=True)
    ax_pm, ax_bn = axes

    if not pm_df.empty:
        yes = pm_df[pm_df["token_id"] == yes_token_id]
        no = pm_df[pm_df["token_id"] == no_token_id]
        ax_pm.plot(yes["t_sec"], yes["best_bid"], label="YES bid", color="#1f77b4")
        ax_pm.plot(yes["t_sec"], yes["best_ask"], label="YES ask", color="#ff7f0e")
        ax_pm.plot(no["t_sec"], no["best_bid"], label="NO bid", color="#2ca02c")
        ax_pm.plot(no["t_sec"], no["best_ask"], label="NO ask", color="#d62728")
    ax_pm.set_title(f"Polymarket 1h orderbook: {slug}")
    ax_pm.set_ylabel("price")
    ax_pm.legend(loc="upper left")
    ax_pm.grid(True, alpha=0.2)

    ax_vol = None
    if not bin_df.empty:
        ax_bn.plot(bin_df["t_sec"], bin_df["mid"], label="Binance mid", color="#111827")
        open_price = float(bin_df.iloc[0]["mid"])
        ax_bn.axhline(open_price, linestyle="--", color="#6b7280", label="1h open")
    if not kline_df.empty:
        ax_vol = ax_bn.twinx()
        width = float(kline_df["width_sec"].median()) if "width_sec" in kline_df else 60.0
        ax_vol.bar(
            kline_df["t_sec"],
            kline_df["volume"],
            width=width * 0.8,
            alpha=0.25,
            color="#9ca3af",
            label="Volume",
            align="edge",
        )
        ax_vol.set_ylabel("volume")
    ax_bn.set_title("Binance price ticks")

    def _format_mmss(x, _pos):
        if x is None:
            return ""
        total = int(max(0, x))
        minutes = total // 60
        seconds = total % 60
        return f"{minutes:02d}:{seconds:02d}"

    formatter = mtick.FuncFormatter(_format_mmss)
    ax_pm.xaxis.set_major_formatter(formatter)
    ax_bn.xaxis.set_major_formatter(formatter)
    ax_bn.set_xlabel("mm:ss since 1h start")
    ax_bn.set_ylabel("price")
    handles, labels = ax_bn.get_legend_handles_labels()
    if ax_vol is not None:
        h2, l2 = ax_vol.get_legend_handles_labels()
        handles += h2
        labels += l2
    ax_bn.legend(handles, labels, loc="upper left")
    ax_bn.grid(True, alpha=0.2)

    fig.tight_layout()
    out_png.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_png, dpi=150)
    print(f"[OK] saved plot: {out_png}")


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", default=None, help="Polymarket slug (1h)")
    ap.add_argument(
        "--auto-1h-prefix",
        default=None,
        help="Auto-select current 1h slug from prefix (e.g. btc-up-or-down).",
    )
    ap.add_argument(
        "--follow",
        action="store_true",
        help="Continue capturing consecutive 1h windows.",
    )
    ap.add_argument(
        "--max-windows",
        type=int,
        default=None,
        help="Stop after this many windows (only with --follow).",
    )
    ap.add_argument("--search-hours", type=int, default=6)
    ap.add_argument("--search-step-hours", type=int, default=1)
    ap.add_argument("--binance-symbol", default="btcusdc")
    ap.add_argument("--out-dir", default="src/out/market_1h")
    return ap.parse_args()


async def _capture_window(slug: str, binance_symbol: str, out_dir: Path) -> dt.datetime:
    slug = normalize_slug(slug)
    market = fetch_market_by_slug(slug)
    tokens = resolve_yes_no_tokens(market, slug)

    start_ms, end_ms, start_et = _window_from_market(market, tokens.slug)
    now_ms = int(time.time() * 1000)
    if now_ms >= end_ms:
        raise RuntimeError("Market window already ended.")

    wait_sec = max(0, (start_ms - now_ms) / 1000.0)
    if wait_sec > 0:
        start_label = start_et.strftime("%Y-%m-%d %H:%M:%S ET")
        print(f"[WAIT] start_at={start_label} in {wait_sec:.1f}s")
        await asyncio.sleep(wait_sec)

    pm_rows: list[dict] = []
    bn_rows: list[dict] = []

    print(f"[BOOT] slug={tokens.slug} start_ms={start_ms} end_ms={end_ms}")
    await asyncio.gather(
        _capture_polymarket([tokens.yes_token_id, tokens.no_token_id], start_ms, end_ms, pm_rows),
        _capture_binance(binance_symbol, start_ms, end_ms, bn_rows),
    )

    safe = _safe_slug(tokens.slug)
    pm_path = out_dir / f"{safe}_polymarket.parquet"
    bn_path = out_dir / f"{safe}_binance.parquet"
    meta_path = out_dir / f"{safe}_meta.json"
    plot_path = out_dir / f"{safe}_plot.png"
    kline_path = out_dir / f"{safe}_binance_klines.parquet"

    _to_parquet(pm_rows, pm_path)
    _to_parquet(bn_rows, bn_path)
    try:
        kline_rows = _fetch_binance_klines(binance_symbol, "1m", start_ms, end_ms)
        _to_parquet(kline_rows, kline_path)
        print(f"[OK] saved: {kline_path}")
    except Exception as exc:
        print(f"[WARN] binance klines fetch failed: {exc}")
    meta = {
        "slug": tokens.slug,
        "yes_token_id": tokens.yes_token_id,
        "no_token_id": tokens.no_token_id,
        "start_ms": start_ms,
        "end_ms": end_ms,
        "binance_symbol": binance_symbol,
        "binance_kline_interval": "1m",
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    print(f"[OK] saved: {pm_path}")
    print(f"[OK] saved: {bn_path}")
    print(f"[OK] saved: {meta_path}")

    _plot(
        pm_path,
        bn_path,
        kline_path if kline_path.exists() else None,
        plot_path,
        start_ms,
        tokens.slug,
        tokens.yes_token_id,
        tokens.no_token_id,
    )

    return start_et


async def main_async() -> None:
    args = parse_args()
    out_dir = Path(args.out_dir)

    if not args.slug and not args.auto_1h_prefix:
        raise RuntimeError("Provide --slug or --auto-1h-prefix.")

    if args.auto_1h_prefix:
        windows = 0
        market, slug = find_active_market_by_time(
            args.auto_1h_prefix,
            search_hours=args.search_hours,
            step_hours=args.search_step_hours,
        )
        start_ms, end_ms, start_et = _window_from_market(market, slug)
        if int(time.time() * 1000) >= end_ms:
            raise RuntimeError("Market window already ended.")

        while True:
            if windows == 0:
                current_slug = slug
            else:
                current_slug = build_slug(args.auto_1h_prefix, start_et)
            start_et = await _capture_window(current_slug, args.binance_symbol, out_dir)
            windows += 1
            if not args.follow:
                return
            if args.max_windows is not None and windows >= args.max_windows:
                return
            start_et = start_et + dt.timedelta(hours=1)
    else:
        await _capture_window(args.slug, args.binance_symbol, out_dir)


def main() -> None:
    asyncio.run(main_async())


if __name__ == "__main__":
    main()
