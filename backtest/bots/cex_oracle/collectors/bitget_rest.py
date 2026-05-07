#!/usr/bin/env python3
import argparse
import asyncio
import time
from datetime import datetime, timezone
from pathlib import Path

import aiohttp

from _parquet_roll import RollingParquetWriter

def utc_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def main_async(symbol: str, out_dir: Path, prefix: str) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    url = "https://api.bitget.com/api/v2/spot/market/tickers"
    params = {"symbol": symbol}

    writer = RollingParquetWriter(out_dir, prefix, window_sec=300)

    async with aiohttp.ClientSession() as sess:
        while True:
            try:
                async with sess.get(url, params=params, timeout=5) as r:
                    if r.status != 200:
                        await asyncio.sleep(1.0)
                        continue
                    j = await r.json()
                    data = j.get("data") or []
                    if not data:
                        await asyncio.sleep(1.0)
                        continue
                    payload = data[0]
                    price = float(payload.get("lastPr"))
                    bid = payload.get("bidPr")
                    ask = payload.get("askPr")
                    now_ms = int(time.time() * 1000)

                    writer.write(
                        {
                            "ts": utc_iso_now(),
                            "ts_ms": now_ms,
                            "source": "BITGET",
                            "symbol": symbol,
                            "price": price,
                            "bid": bid,
                            "ask": ask,
                        }
                    )
            except Exception:
                pass

            await asyncio.sleep(1.0)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", default="BTCUSDT", help='Bitget symbol like "BTCUSDT"')
    ap.add_argument("--out-dir", default="src/out/cex_oracle/bitget")
    ap.add_argument("--file-prefix", default="bitget_1s")
    args = ap.parse_args()

    asyncio.run(main_async(args.symbol, Path(args.out_dir), args.file_prefix))


if __name__ == "__main__":
    main()
