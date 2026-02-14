#!/usr/bin/env python3
import argparse
import asyncio
import datetime as dt
import json
import sys
import time
from pathlib import Path

import websockets

from _parquet_roll import RollingParquetWriter
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[3]
LIBS_DIR = REPO_ROOT / "libs"
if str(LIBS_DIR) not in sys.path:
    sys.path.insert(0, str(LIBS_DIR))

from polymarket_utils import fetch_market_by_slug, normalize_slug, resolve_yes_no_tokens

PM_WS = "wss://ws-subscriptions-clob.polymarket.com/ws/market"


def utc_iso_from_ms(ms: int) -> str:
    return dt.datetime.fromtimestamp(ms / 1000, tz=dt.timezone.utc).isoformat()


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


async def _collect(slug: str, out_dir: Path, prefix: str) -> None:
    slug = normalize_slug(slug)
    market = fetch_market_by_slug(slug)
    tokens = resolve_yes_no_tokens(market, slug)

    latest = {
        "yes_bid": None,
        "yes_ask": None,
        "no_bid": None,
        "no_ask": None,
        "event_ts_ms": None,
    }

    out_dir.mkdir(parents=True, exist_ok=True)
    writer = RollingParquetWriter(out_dir, prefix, window_sec=300)

    async def writer_loop() -> None:
        last_written_sec = None
        while True:
            now_ms = int(time.time() * 1000)
            now_sec = now_ms // 1000
            if last_written_sec == now_sec:
                await asyncio.sleep(0.05)
                continue

            yes_bid = latest["yes_bid"]
            yes_ask = latest["yes_ask"]
            no_bid = latest["no_bid"]
            no_ask = latest["no_ask"]
            if yes_bid is None or yes_ask is None:
                await asyncio.sleep(0.2)
                continue

            yes_mid = (yes_bid + yes_ask) / 2.0
            no_mid = None
            if no_bid is not None and no_ask is not None:
                no_mid = (no_bid + no_ask) / 2.0

            writer.write(
                {
                    "ts": utc_iso_from_ms(now_ms),
                    "ts_ms": now_ms,
                    "source": "POLYMARKET_CHANCE",
                    "slug": tokens.slug,
                    "chance": yes_mid,
                    "yes_bid": yes_bid,
                    "yes_ask": yes_ask,
                    "no_bid": no_bid,
                    "no_ask": no_ask,
                    "event_ts_ms": latest["event_ts_ms"],
                }
            )

            last_written_sec = now_sec
            await asyncio.sleep(0.05)

    async def ws_loop() -> None:
        token_ids = [tokens.yes_token_id, tokens.no_token_id]
        while True:
            try:
                async with websockets.connect(PM_WS, ping_interval=20, ping_timeout=20) as ws:
                    sub = {
                        "type": "market",
                        "assets_ids": token_ids,
                        "custom_feature_enabled": True,
                    }
                    await ws.send(json.dumps(sub))

                    async for raw in ws:
                        if raw == "PONG":
                            continue
                        try:
                            data = json.loads(raw)
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
                            asset_id = event.get("asset_id")
                            bid = event.get("best_bid")
                            ask = event.get("best_ask")
                            try:
                                bid_f = float(bid) if bid is not None else None
                                ask_f = float(ask) if ask is not None else None
                            except Exception:
                                bid_f = None
                                ask_f = None

                            if asset_id == tokens.yes_token_id:
                                latest["yes_bid"] = bid_f
                                latest["yes_ask"] = ask_f
                                latest["event_ts_ms"] = ts_ms
                            elif asset_id == tokens.no_token_id:
                                latest["no_bid"] = bid_f
                                latest["no_ask"] = ask_f
                                latest["event_ts_ms"] = ts_ms
            except Exception:
                await asyncio.sleep(1)

    await asyncio.gather(writer_loop(), ws_loop())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", required=True, help="Polymarket market slug")
    ap.add_argument("--out-dir", default="src/out/cex_oracle/polymarket")
    ap.add_argument("--file-prefix", default="polymarket_chance")
    args = ap.parse_args()

    asyncio.run(_collect(args.slug, Path(args.out_dir), args.file_prefix))


if __name__ == "__main__":
    main()
