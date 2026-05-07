#!/usr/bin/env python3
import argparse
import asyncio
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import websockets

from _parquet_roll import RollingParquetWriter

def utc_iso_from_ms(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


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


async def _collect(symbol: str, out_dir: Path, prefix: str, vol_prefix: str) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    stream_sym = symbol.lower()
    url = f"wss://stream.binance.com:9443/stream?streams={stream_sym}@bookTicker/{stream_sym}@aggTrade"

    latest = {"bid": None, "ask": None}
    volume_bucket = {}

    last_written_sec = None
    price_writer = RollingParquetWriter(out_dir, prefix, window_sec=300)
    vol_writer = RollingParquetWriter(out_dir, vol_prefix, window_sec=300)

    async def writer_loop() -> None:
        nonlocal last_written_sec
        while True:
            now_ms = int(time.time() * 1000)
            now_sec = now_ms // 1000
            if last_written_sec == now_sec:
                await asyncio.sleep(0.05)
                continue

            bid = latest["bid"]
            ask = latest["ask"]
            if bid is not None and ask is not None:
                mid = (bid + ask) / 2.0
                price_writer.write(
                    {
                        "ts": utc_iso_from_ms(now_ms),
                        "ts_ms": now_ms,
                        "source": "BINANCE",
                        "symbol": symbol,
                        "price": mid,
                        "bid": bid,
                        "ask": ask,
                    }
                )

            # write volume for previous second (if any)
            target_sec = now_sec - 1
            vol = volume_bucket.pop(target_sec, None)
            if vol is not None:
                vol_writer.write(
                    {
                        "ts": datetime.fromtimestamp(target_sec, tz=timezone.utc).isoformat(),
                        "ts_ms": target_sec * 1000,
                        "source": "BINANCE",
                        "symbol": symbol,
                        "volume": vol,
                    }
                )

            # prune old buckets
            for sec in list(volume_bucket.keys()):
                if sec < target_sec - 5:
                    del volume_bucket[sec]

            last_written_sec = now_sec
            await asyncio.sleep(0.05)

    async def ws_loop() -> None:
        while True:
            try:
                async with websockets.connect(url, ping_interval=20, ping_timeout=20) as ws:
                    async for raw in ws:
                        try:
                            msg = json.loads(raw)
                        except json.JSONDecodeError:
                            continue

                        payload = msg.get("data", msg)
                        stream = msg.get("stream", "")

                        if stream.endswith("bookTicker") or payload.get("e") == "bookTicker":
                            bid = payload.get("b")
                            ask = payload.get("a")
                            try:
                                bid_f = float(bid)
                                ask_f = float(ask)
                            except Exception:
                                bid_f = None
                                ask_f = None
                            if bid_f is not None and ask_f is not None:
                                latest["bid"] = bid_f
                                latest["ask"] = ask_f

                        elif stream.endswith("aggTrade") or payload.get("e") == "aggTrade":
                            qty = payload.get("q")
                            event_ts = payload.get("T") or payload.get("E")
                            try:
                                qty_f = float(qty)
                            except Exception:
                                qty_f = None
                            if qty_f is None:
                                continue
                            ts_ms = _normalize_ts_ms(event_ts)
                            sec = ts_ms // 1000
                            volume_bucket[sec] = volume_bucket.get(sec, 0.0) + qty_f
            except Exception:
                await asyncio.sleep(1)

    await asyncio.gather(writer_loop(), ws_loop())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", default="BTCUSDT")
    ap.add_argument("--out-dir", default="src/out/cex_oracle/binance")
    ap.add_argument("--file-prefix", default="binance_1s")
    ap.add_argument("--vol-prefix", default="binance_1s_volume")
    args = ap.parse_args()

    asyncio.run(_collect(args.symbol, Path(args.out_dir), args.file_prefix, args.vol_prefix))


if __name__ == "__main__":
    main()
