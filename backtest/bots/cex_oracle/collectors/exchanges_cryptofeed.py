#!/usr/bin/env python3
import argparse
import asyncio
import json
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from cryptofeed import FeedHandler
from cryptofeed.defines import TICKER, TRADES

from _parquet_roll import RollingParquetWriter

def utc_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_float(x):
    try:
        if x is None:
            return None
        return float(x)
    except Exception:
        return None


def resolve_exchange_class(name: str):
    import cryptofeed.exchanges as ex

    candidates = [name, name.replace(".", ""), name.replace("-", "")]
    if name.lower() in ("gate", "gateio", "gate.io"):
        candidates += ["Gateio", "GateIO", "Gate"]
    if name.lower() in ("kucoin",):
        candidates += ["KuCoin", "KUCOIN"]
    if name.lower() in ("coinbase", "coinbaseexchange", "coinbase_exchange"):
        candidates += ["Coinbase"]
    if name.lower() in ("htx", "huobi"):
        candidates += ["Huobi"]

    for c in candidates:
        if hasattr(ex, c):
            return getattr(ex, c)
    return None


def _load_symbol_map(path: str | None) -> dict:
    if not path:
        return {}
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"symbol map not found: {p}")
    return json.loads(p.read_text())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", default="BTC-USDT", help='Default symbol, e.g. "BTC-USDT"')
    ap.add_argument("--symbol-map", default=None, help="JSON file mapping exchange->symbol")
    ap.add_argument("--out-dir", default="src/out/cex_oracle/exchanges")
    ap.add_argument("--file-prefix", default="exchanges_1s")
    ap.add_argument("--vol-prefix", default="exchanges_1s_volume")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    symbol_map = _load_symbol_map(args.symbol_map)

    latest = {}
    volume_bucket = {}
    last_symbol = {}
    lock = threading.Lock()
    last_written_sec = {}
    last_written_vol_sec = {}

    exchange_names = [
        # Binance uses dedicated WS collector (binance_ws.py).
        # Coinbase requires auth on cryptofeed v2.4.1; use coinbase_rest collector instead.
        # Upbit does not support TICKER in cryptofeed; use upbit_rest collector instead.
        # Bitget endpoint in cryptofeed fails (400); use bitget_rest collector instead.
        ("OKX", "OKX"),
        ("Bybit", "BYBIT"),
        ("Gateio", "GATE"),
        # KuCoin ticker topic rejects BTC-USDT on cryptofeed; use kucoin_rest collector instead.
        ("Huobi", "HTX"),
    ]

    label_map = {}
    for class_name, label in exchange_names:
        label_map[class_name.upper()] = label
        label_map[label.upper()] = label

    async def on_ticker(*args, **kwargs):
        if len(args) >= 1 and hasattr(args[0], "__dict__"):
            ticker_obj = args[0]
            ex_name = getattr(ticker_obj, "exchange", None) or getattr(ticker_obj, "feed", None) or "UNKNOWN"
            sym = getattr(ticker_obj, "symbol", args[1] if len(args) > 1 else "UNKNOWN")
            bid = safe_float(getattr(ticker_obj, "bid", None))
            ask = safe_float(getattr(ticker_obj, "ask", None))
            last = safe_float(getattr(ticker_obj, "last", None) or getattr(ticker_obj, "price", None))
        else:
            ex_name = str(args[0]) if len(args) > 0 else "UNKNOWN"
            sym = str(args[1]) if len(args) > 1 else "UNKNOWN"
            bid = safe_float(args[2]) if len(args) > 2 else None
            ask = safe_float(args[3]) if len(args) > 3 else None
            last = None

        price = None
        if bid is not None and ask is not None:
            price = (bid + ask) / 2.0
        elif last is not None:
            price = last
        elif bid is not None:
            price = bid
        elif ask is not None:
            price = ask

        if price is None:
            return

        now_ms = int(time.time() * 1000)
        label = label_map.get(str(ex_name).upper(), str(ex_name))
        with lock:
            latest[label] = {
                "ts": utc_iso_now(),
                "ts_ms": now_ms,
                "symbol": sym,
                "bid": bid,
                "ask": ask,
                "price": float(price),
            }
            last_symbol[label] = sym

    async def on_trade(*args, **kwargs):
        amount = None
        ts = None
        price = None
        if len(args) >= 1 and hasattr(args[0], "__dict__"):
            trade = args[0]
            ex_name = getattr(trade, "exchange", None) or getattr(trade, "feed", None) or "UNKNOWN"
            sym = getattr(trade, "symbol", kwargs.get("symbol", "UNKNOWN"))
            amount = safe_float(
                getattr(trade, "amount", None)
                or getattr(trade, "size", None)
                or getattr(trade, "quantity", None)
            )
            price = safe_float(getattr(trade, "price", None))
            ts = getattr(trade, "timestamp", None) or getattr(trade, "ts", None)
        else:
            ex_name = str(args[0]) if len(args) > 0 else "UNKNOWN"
            sym = str(args[1]) if len(args) > 1 else "UNKNOWN"
            amount = safe_float(args[3]) if len(args) > 3 else None
            price = safe_float(args[4]) if len(args) > 4 else None
            ts = args[5] if len(args) > 5 else None

        if amount is None:
            return

        label = label_map.get(str(ex_name).upper(), str(ex_name))
        if ts is None:
            ts_ms = int(time.time() * 1000)
        else:
            try:
                ts_val = float(ts)
                if ts_val > 1_000_000_000_000:
                    ts_ms = int(ts_val)
                else:
                    ts_ms = int(ts_val * 1000)
            except Exception:
                ts_ms = int(time.time() * 1000)
        sec = ts_ms // 1000

        with lock:
            bucket = volume_bucket.setdefault(label, {})
            bucket[sec] = bucket.get(sec, 0.0) + float(amount)
            last_symbol[label] = sym

    price_writer = RollingParquetWriter(out_dir, args.file_prefix, window_sec=300)
    vol_writer = RollingParquetWriter(out_dir, args.vol_prefix, window_sec=300)

    def writer_loop() -> None:
        while True:
            now_ms = int(time.time() * 1000)
            now_sec = now_ms // 1000

            rows = []
            vol_rows = []
            with lock:
                for ex_name, data in latest.items():
                    if last_written_sec.get(ex_name) == now_sec:
                        continue
                    last_written_sec[ex_name] = now_sec
                    rows.append([
                        data["ts"],
                        data["ts_ms"],
                        ex_name,
                        data["symbol"],
                        data["price"],
                        data["bid"],
                        data["ask"],
                    ])

                target_sec = now_sec - 1
                for ex_name, bucket in list(volume_bucket.items()):
                    if target_sec in bucket:
                        vol = bucket.pop(target_sec)
                        sym = last_symbol.get(ex_name) or latest.get(ex_name, {}).get("symbol", "UNKNOWN")
                        vol_rows.append([
                            datetime.fromtimestamp(target_sec, tz=timezone.utc).isoformat(),
                            target_sec * 1000,
                            ex_name,
                            sym,
                            vol,
                        ])
                    # prune old buckets
                    for sec in list(bucket.keys()):
                        if sec < target_sec - 5:
                            del bucket[sec]

            for row in rows:
                price_writer.write(
                    {
                        "ts": row[0],
                        "ts_ms": row[1],
                        "source": row[2],
                        "symbol": row[3],
                        "price": row[4],
                        "bid": row[5],
                        "ask": row[6],
                    }
                )

            for row in vol_rows:
                vol_writer.write(
                    {
                        "ts": row[0],
                        "ts_ms": row[1],
                        "source": row[2],
                        "symbol": row[3],
                        "volume": row[4],
                    }
                )

            time.sleep(max(0.05, 1.0 - (time.time() % 1.0)))

    t = threading.Thread(target=writer_loop, daemon=True)
    t.start()

    fh = FeedHandler()
    ticker_cb = {TICKER: on_ticker, TRADES: on_trade}

    for class_name, label in exchange_names:
        cls = resolve_exchange_class(class_name)
        if cls is None:
            print(f"[WARN] cryptofeed exchange class not found: {class_name} (skip)")
            continue

        sym = symbol_map.get(label) or symbol_map.get(class_name) or args.symbol
        try:
            fh.add_feed(cls(symbols=[sym], channels=[TICKER], callbacks=ticker_cb))
        except Exception as exc:
            print(f"[WARN] failed to add feed {class_name}: {exc}")
            continue

    try:
        asyncio.get_event_loop()
    except RuntimeError:
        asyncio.set_event_loop(asyncio.new_event_loop())

    fh.run()


if __name__ == "__main__":
    main()
