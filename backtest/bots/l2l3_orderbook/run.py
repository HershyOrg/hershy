from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

from bots.l2l3_orderbook.bus import EventBus
from bots.l2l3_orderbook.exchanges.binance_l2 import BinanceL2BookBuilder
from bots.l2l3_orderbook.exchanges.coinbase_l3 import CoinbaseL3BookBuilder
from bots.l2l3_orderbook.storage import StorageSink


def _session_id() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")


async def main_async(args: argparse.Namespace) -> None:
    out_root = Path(args.out_dir).resolve()
    session = _session_id()
    session_dir = out_root / session
    session_dir.mkdir(parents=True, exist_ok=True)
    logging.info("session_dir=%s", session_dir)
    latest_path = out_root / "LATEST"
    latest_path.write_text(session)

    bus = EventBus()
    stop_evt = asyncio.Event()
    storage = StorageSink(session_dir, window_sec=args.window_sec, flush_sec=5.0)

    counts = {"book": 0}

    async def heartbeat() -> None:
        while not stop_evt.is_set():
            print(f"[l2l3] running... book_states={counts['book']}", flush=True)
            await asyncio.sleep(5)

    tasks = [
        asyncio.create_task(heartbeat()),
        asyncio.create_task(storage.run(bus, stop_evt, counts)),
        asyncio.create_task(
            BinanceL2BookBuilder(
                symbol=args.binance_symbol,
                top_n=args.top_n,
                bus=bus,
                emit_full=args.binance_full_levels,
            ).start(stop_evt)
        ),
    ]
    if not args.no_coinbase:
        tasks.append(
            asyncio.create_task(
                CoinbaseL3BookBuilder(
                    product_id=args.coinbase_symbol,
                    top_n=args.top_n,
                    bus=bus,
                ).start(stop_evt)
            )
        )

    try:
        await asyncio.gather(*tasks)
    except asyncio.CancelledError:
        pass
    except KeyboardInterrupt:
        pass
    finally:
        stop_evt.set()
        for t in tasks:
            t.cancel()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", force=True)
    ap = argparse.ArgumentParser()
    ap.add_argument("--binance-symbol", default="BTCUSDT")
    ap.add_argument("--coinbase-symbol", default="BTC-USD")
    ap.add_argument("--top-n", type=int, default=10)
    ap.add_argument("--out-dir", default="src/out/l2l3_orderbook")
    ap.add_argument("--window-sec", type=int, default=300)
    ap.add_argument("--binance-full-levels", action="store_true")
    ap.add_argument("--no-coinbase", action="store_true")
    args = ap.parse_args()
    logging.info("starting l2l3 collector")
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
