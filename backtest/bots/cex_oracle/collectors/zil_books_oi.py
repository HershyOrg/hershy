#!/usr/bin/env python3
import argparse
import asyncio
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

import websockets

from _parquet_roll import RollingParquetWriter


def utc_iso_from_ms(ms: int) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(ms / 1000)) + "Z"


def http_get_json(url: str, params: dict | None = None, timeout: int = 10) -> dict:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "zil-books-oi/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def _float(x):
    try:
        return float(x)
    except Exception:
        return None


def _parse_bids_asks(data, bid_key="bids", ask_key="asks"):
    bids = data.get(bid_key) if isinstance(data, dict) else None
    asks = data.get(ask_key) if isinstance(data, dict) else None
    return bids or [], asks or []


def fetch_binance_spot(symbol: str, depth: int) -> tuple[list, list]:
    data = http_get_json("https://api.binance.com/api/v3/depth", {"symbol": symbol, "limit": depth})
    return data.get("bids", []), data.get("asks", [])


def fetch_binance_perp(symbol: str, depth: int) -> tuple[list, list, float | None]:
    book = http_get_json("https://fapi.binance.com/fapi/v1/depth", {"symbol": symbol, "limit": depth})
    oi = http_get_json("https://fapi.binance.com/fapi/v1/openInterest", {"symbol": symbol})
    return book.get("bids", []), book.get("asks", []), _float(oi.get("openInterest"))


def fetch_okx_spot(inst_id: str, depth: int) -> tuple[list, list]:
    data = http_get_json("https://www.okx.com/api/v5/market/books", {"instId": inst_id, "sz": depth})
    rows = data.get("data", [])
    if not rows:
        return [], []
    return rows[0].get("bids", []), rows[0].get("asks", [])


def fetch_okx_perp(inst_id: str, depth: int) -> tuple[list, list, float | None]:
    data = http_get_json("https://www.okx.com/api/v5/market/books", {"instId": inst_id, "sz": depth})
    rows = data.get("data", [])
    bids, asks = (rows[0].get("bids", []), rows[0].get("asks", [])) if rows else ([], [])
    oi = http_get_json("https://www.okx.com/api/v5/public/open-interest", {"instId": inst_id})
    oi_rows = oi.get("data", [])
    oi_val = None
    if oi_rows:
        oi_val = _float(oi_rows[0].get("oi"))
    return bids, asks, oi_val


def fetch_bybit_spot(symbol: str, depth: int) -> tuple[list, list]:
    data = http_get_json("https://api.bybit.com/v5/market/orderbook", {"category": "spot", "symbol": symbol, "limit": depth})
    result = data.get("result", {})
    return result.get("b", []), result.get("a", [])


def fetch_bybit_perp(symbol: str, depth: int) -> tuple[list, list, float | None]:
    data = http_get_json("https://api.bybit.com/v5/market/orderbook", {"category": "linear", "symbol": symbol, "limit": depth})
    result = data.get("result", {})
    bids, asks = result.get("b", []), result.get("a", [])
    oi = http_get_json("https://api.bybit.com/v5/market/open-interest", {"category": "linear", "symbol": symbol})
    oi_rows = oi.get("result", {}).get("list", [])
    oi_val = _float(oi_rows[0].get("openInterest")) if oi_rows else None
    return bids, asks, oi_val


def fetch_bitget_spot(symbol: str, depth: int) -> tuple[list, list]:
    data = http_get_json("https://api.bitget.com/api/v2/spot/market/orderbook", {"symbol": symbol, "limit": depth})
    payload = data.get("data", {})
    return _parse_bids_asks(payload)


def fetch_bitget_perp(symbol: str, depth: int) -> tuple[list, list, float | None]:
    book = http_get_json(
        "https://api.bitget.com/api/v2/mix/market/orderbook",
        {"symbol": symbol, "productType": "usdt-futures", "limit": depth},
    )
    payload = book.get("data", {})
    bids, asks = _parse_bids_asks(payload)
    oi = http_get_json(
        "https://api.bitget.com/api/v2/mix/market/open-interest",
        {"symbol": symbol, "productType": "usdt-futures"},
    )
    oi_val = None
    oi_data = oi.get("data")
    if isinstance(oi_data, dict):
        oi_val = _float(oi_data.get("openInterest"))
    elif isinstance(oi_data, list) and oi_data:
        oi_val = _float(oi_data[0].get("openInterest"))
    return bids, asks, oi_val


def fetch_gate_spot(pair: str, depth: int) -> tuple[list, list]:
    data = http_get_json("https://api.gateio.ws/api/v4/spot/order_book", {"currency_pair": pair, "limit": depth})
    return data.get("bids", []), data.get("asks", [])


def fetch_gate_perp(contract: str, depth: int) -> tuple[list, list, float | None]:
    data = http_get_json(
        "https://api.gateio.ws/api/v4/futures/usdt/order_book",
        {"contract": contract, "limit": depth},
    )
    bids, asks = data.get("bids", []), data.get("asks", [])
    stats = http_get_json("https://api.gateio.ws/api/v4/futures/usdt/contract_stats", {"contract": contract})
    oi_val = None
    if isinstance(stats, list) and stats:
        oi_val = _float(stats[0].get("open_interest"))
    return bids, asks, oi_val


def fetch_upbit_spot(market: str, depth: int) -> tuple[list, list]:
    data = http_get_json("https://api.upbit.com/v1/orderbook", {"markets": market})
    if not isinstance(data, list) or not data:
        return [], []
    units = data[0].get("orderbook_units", [])[:depth]
    bids = []
    asks = []
    for u in units:
        bid_p = u.get("bid_price")
        bid_s = u.get("bid_size")
        ask_p = u.get("ask_price")
        ask_s = u.get("ask_size")
        if bid_p is not None and bid_s is not None:
            bids.append([bid_p, bid_s])
        if ask_p is not None and ask_s is not None:
            asks.append([ask_p, ask_s])
    bids.sort(key=lambda x: float(x[0]), reverse=True)
    asks.sort(key=lambda x: float(x[0]))
    return bids, asks


async def _collect_ws(depth: int, interval_sec: float, out_dir: Path) -> None:
    book_writer = RollingParquetWriter(out_dir, "zil_orderbook", window_sec=300)
    oi_writer = RollingParquetWriter(out_dir, "zil_open_interest", window_sec=300)

    # WS symbols (tick-based) for Binance/Bybit/Upbit only.
    symbols = {
        "BINANCE": {"spot": "ZILUSDT", "perp": "ZILUSDT"},
        "BYBIT": {"spot": "ZILUSDT", "perp": "ZILUSDT"},
        "UPBIT": {"spot": "KRW-ZIL"},
    }

    async def poll_oi_loop() -> None:
        while True:
            now_ms = int(time.time() * 1000)
            ts = utc_iso_from_ms(now_ms)
            try:
                _, _, oi_val = fetch_binance_perp(symbols["BINANCE"]["perp"], depth)
                oi_writer.write(
                    {
                        "ts": ts,
                        "ts_ms": now_ms,
                        "exchange": "BINANCE",
                        "market": "perp",
                        "symbol": symbols["BINANCE"]["perp"],
                        "open_interest": oi_val,
                    }
                )
            except Exception as exc:
                print(f"[WARN] BINANCE perp OI failed: {exc}")

            try:
                _, _, oi_val = fetch_bybit_perp(symbols["BYBIT"]["perp"], depth)
                oi_writer.write(
                    {
                        "ts": ts,
                        "ts_ms": now_ms,
                        "exchange": "BYBIT",
                        "market": "perp",
                        "symbol": symbols["BYBIT"]["perp"],
                        "open_interest": oi_val,
                    }
                )
            except Exception as exc:
                print(f"[WARN] BYBIT perp OI failed: {exc}")

            await asyncio.sleep(max(1.0, interval_sec))

    async def binance_loop() -> None:
        stream = "zilusdt@bookTicker"
        async def _run(u: str, mkt: str) -> None:
            while True:
                try:
                    async with websockets.connect(u, ping_interval=20, ping_timeout=20) as ws:
                        async for raw in ws:
                            if isinstance(raw, (bytes, bytearray)):
                                raw = raw.decode("utf-8")
                            msg = json.loads(raw)
                            payload = msg.get("data", msg)
                            bid = payload.get("b")
                            ask = payload.get("a")
                            if bid is None or ask is None:
                                continue
                            now_ms = int(time.time() * 1000)
                            ts = utc_iso_from_ms(now_ms)
                            bids = [[bid, "0"]]
                            asks = [[ask, "0"]]
                            book_writer.write(
                                {
                                    "ts": ts,
                                    "ts_ms": now_ms,
                                    "exchange": "BINANCE",
                                    "market": mkt,
                                    "symbol": symbols["BINANCE"][mkt],
                                    "depth": depth,
                                    "bids": json.dumps(bids, ensure_ascii=False),
                                    "asks": json.dumps(asks, ensure_ascii=False),
                                }
                            )
                except Exception:
                    await asyncio.sleep(1)

        await asyncio.gather(
            _run("wss://stream.binance.com:9443/stream?streams=" + stream, "spot"),
            _run("wss://fstream.binance.com/stream?streams=" + stream, "perp"),
        )

    async def bybit_loop() -> None:
        bybit_depth = 50 if depth < 50 else depth
        async def _run(url: str, market: str, symbol: str) -> None:
            sub = {"op": "subscribe", "args": [f"orderbook.{bybit_depth}.{symbol}"]}
            while True:
                try:
                    async with websockets.connect(url, ping_interval=20, ping_timeout=20) as ws:
                        await ws.send(json.dumps(sub))
                        async for raw in ws:
                            if isinstance(raw, (bytes, bytearray)):
                                raw = raw.decode("utf-8")
                            msg = json.loads(raw)
                            data = msg.get("data") or {}
                            if isinstance(data, list) and data:
                                data = data[0]
                            bids = data.get("b") or data.get("bids") or []
                            asks = data.get("a") or data.get("asks") or []
                            if not bids or not asks:
                                continue
                            bids = bids[:depth]
                            asks = asks[:depth]
                            now_ms = int(time.time() * 1000)
                            ts = utc_iso_from_ms(now_ms)
                            book_writer.write(
                                {
                                    "ts": ts,
                                    "ts_ms": now_ms,
                                    "exchange": "BYBIT",
                                    "market": market,
                                    "symbol": symbol,
                                    "depth": depth,
                                    "bids": json.dumps(bids, ensure_ascii=False),
                                    "asks": json.dumps(asks, ensure_ascii=False),
                                }
                            )
                except Exception:
                    await asyncio.sleep(1)

        await asyncio.gather(
            _run("wss://stream.bybit.com/v5/public/spot", "spot", symbols["BYBIT"]["spot"]),
            _run("wss://stream.bybit.com/v5/public/linear", "perp", symbols["BYBIT"]["perp"]),
        )

    async def upbit_loop() -> None:
        url = "wss://api.upbit.com/websocket/v1"
        codes = [f'{symbols["UPBIT"]["spot"]}.15']
        sub = [
            {"ticket": "zil-books"},
            {"type": "orderbook", "codes": codes},
            {"format": "SIMPLE"},
        ]
        while True:
            try:
                async with websockets.connect(url, ping_interval=20, ping_timeout=20) as ws:
                    await ws.send(json.dumps(sub))
                    async for raw in ws:
                        if isinstance(raw, (bytes, bytearray)):
                            raw = raw.decode("utf-8")
                        msg = json.loads(raw)
                        units = msg.get("orderbook_units") or []
                        if not units:
                            continue
                        bids = [[u.get("bid_price"), u.get("bid_size")] for u in units[:depth]]
                        asks = [[u.get("ask_price"), u.get("ask_size")] for u in units[:depth]]
                        now_ms = int(time.time() * 1000)
                        ts = utc_iso_from_ms(now_ms)
                        book_writer.write(
                            {
                                "ts": ts,
                                "ts_ms": now_ms,
                                "exchange": "UPBIT",
                                "market": "spot",
                                "symbol": symbols["UPBIT"]["spot"],
                                "depth": depth,
                                "bids": json.dumps(bids, ensure_ascii=False),
                                "asks": json.dumps(asks, ensure_ascii=False),
                            }
                        )
            except Exception:
                await asyncio.sleep(1)

    await asyncio.gather(
        binance_loop(),
        bybit_loop(),
        upbit_loop(),
        poll_oi_loop(),
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--depth", type=int, default=10)
    ap.add_argument("--interval-sec", type=float, default=1.0)
    ap.add_argument("--out-dir", default="src/out/zil_books_oi")
    ap.add_argument("--mode", choices=["poll", "ws"], default="poll")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    if args.mode == "ws":
        asyncio.run(_collect_ws(args.depth, args.interval_sec, out_dir))
        return

    book_writer = RollingParquetWriter(out_dir, "zil_orderbook", window_sec=300)
    oi_writer = RollingParquetWriter(out_dir, "zil_open_interest", window_sec=300)

    symbols = {
        "BINANCE": {"spot": "ZILUSDT", "perp": "ZILUSDT"},
        "OKX": {"spot": "ZIL-USDT", "perp": "ZIL-USDT-SWAP"},
        "BYBIT": {"spot": "ZILUSDT", "perp": "ZILUSDT"},
        "BITGET": {"spot": "ZILUSDT", "perp": "ZILUSDT"},
        "GATE": {"spot": "ZIL_USDT", "perp": "ZIL_USDT"},
        "UPBIT": {"spot": "KRW-ZIL", "perp": None},
    }

    fetchers = {
        "BINANCE": (fetch_binance_spot, fetch_binance_perp),
        "OKX": (fetch_okx_spot, fetch_okx_perp),
        "BYBIT": (fetch_bybit_spot, fetch_bybit_perp),
        "BITGET": (fetch_bitget_spot, fetch_bitget_perp),
        "GATE": (fetch_gate_spot, fetch_gate_perp),
        "UPBIT": (fetch_upbit_spot, None),
    }

    while True:
        now_ms = int(time.time() * 1000)
        ts = utc_iso_from_ms(now_ms)
        for ex, (spot_fn, perp_fn) in fetchers.items():
            sym = symbols[ex]
            try:
                bids, asks = spot_fn(sym["spot"], args.depth)
                book_writer.write(
                    {
                        "ts": ts,
                        "ts_ms": now_ms,
                        "exchange": ex,
                        "market": "spot",
                        "symbol": sym["spot"],
                        "depth": args.depth,
                        "bids": json.dumps(bids, ensure_ascii=False),
                        "asks": json.dumps(asks, ensure_ascii=False),
                    }
                )
            except Exception as exc:
                print(f"[WARN] {ex} spot orderbook failed: {exc}")

            if perp_fn and sym["perp"]:
                try:
                    bids, asks, oi_val = perp_fn(sym["perp"], args.depth)
                    book_writer.write(
                        {
                            "ts": ts,
                            "ts_ms": now_ms,
                            "exchange": ex,
                            "market": "perp",
                            "symbol": sym["perp"],
                            "depth": args.depth,
                            "bids": json.dumps(bids, ensure_ascii=False),
                            "asks": json.dumps(asks, ensure_ascii=False),
                        }
                    )
                    oi_writer.write(
                        {
                            "ts": ts,
                            "ts_ms": now_ms,
                            "exchange": ex,
                            "market": "perp",
                            "symbol": sym["perp"],
                            "open_interest": oi_val,
                        }
                    )
                except Exception as exc:
                    print(f"[WARN] {ex} perp orderbook/OI failed: {exc}")

        time.sleep(args.interval_sec)


if __name__ == "__main__":
    main()
