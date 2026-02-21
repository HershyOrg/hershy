#!/usr/bin/env python3
"""Build an Excel workbook of coins with FDV <= 500M USD and their spot/futures pairs.

Exchanges:
  - Binance (spot + USD-M futures)
  - Bitget (spot + USDT-mix futures)
  - OKX (spot + swap + futures)
  - Gate.io (spot + futures: USDT/BTC)
  - Bybit (spot + linear + inverse)

FDV source:
  - CoinGecko /coins/markets (field: fully_diluted_valuation)

Example:
  python fdv500m_pairs.py --out fdv_le_500m_pairs.xlsx

Optional:
  export COINGECKO_DEMO_API_KEY=...   # CoinGecko demo header (if you have one)

Caveats:
- Ticker symbols are not globally unique. This script maps symbols to CoinGecko coins by
  choosing the entry with the highest market cap for that symbol. All multi-match symbols
  are exported to the Ambiguous_Symbols sheet for manual verification.
- Some networks/regions block Binance exchangeInfo. The script tries api.binance.com and
  data-api.binance.vision, then falls back to /ticker/price with a suffix-heuristic.
"""

from __future__ import annotations

import argparse
import os
import time
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
import requests

FDV_LIMIT_USD = 500_000_000
COINGECKO_BASE = "https://api.coingecko.com/api/v3"


# ------------------------- HTTP helpers -------------------------

def http_get_json(url: str, params: Optional[dict] = None, timeout: int = 30) -> Any:
    """GET JSON with retries for 429/5xx."""
    headers = {
        "Accept": "application/json",
        "User-Agent": "fdv500m-pairs/1.0",
    }
    if "api.coingecko.com" in url:
        key = os.getenv("COINGECKO_DEMO_API_KEY")
        if key:
            headers["x-cg-demo-api-key"] = key

    backoff = 2
    last_err: Optional[str] = None
    for _ in range(8):
        r = requests.get(url, params=params, headers=headers, timeout=timeout)
        if r.status_code == 200:
            return r.json()
        if r.status_code in (429, 500, 502, 503, 504):
            last_err = f"{r.status_code} {r.text[:160]}"
            time.sleep(backoff)
            backoff = min(backoff * 2, 60)
            continue
        raise RuntimeError(f"GET {url} failed: {r.status_code} {r.text[:200]}")
    raise RuntimeError(f"GET {url} failed after retries. last={last_err}")


# ------------------------- CoinGecko FDV -------------------------

def fetch_coingecko_markets(max_pages: int = 40, per_page: int = 250) -> pd.DataFrame:
    rows: List[dict] = []
    for page in range(1, max_pages + 1):
        print(f"[CoinGecko] fetching markets page {page}/{max_pages} ...")
        data = http_get_json(
            f"{COINGECKO_BASE}/coins/markets",
            params={
                "vs_currency": "usd",
                "order": "market_cap_desc",
                "per_page": per_page,
                "page": page,
                "sparkline": "false",
            },
        )
        if not isinstance(data, list) or not data:
            print(f"[CoinGecko] no data at page {page}; stopping.")
            break
        rows.extend(data)
        print(f"[CoinGecko] page {page} rows: {len(data)} | total: {len(rows)}")
        time.sleep(0.25)
    df = pd.DataFrame(rows)
    if df.empty:
        raise RuntimeError("CoinGecko markets returned empty dataset.")
    df["symbol_u"] = df["symbol"].astype(str).str.upper()
    df["market_cap"] = pd.to_numeric(df.get("market_cap"), errors="coerce")
    df["fdv_usd"] = pd.to_numeric(df.get("fully_diluted_valuation"), errors="coerce")
    return df


def build_symbol_map(cg: pd.DataFrame) -> Tuple[Dict[str, dict], pd.DataFrame]:
    """Return (symbol->chosen coin row dict, ambiguous table)."""
    keep = ["id", "name", "symbol", "symbol_u", "market_cap", "fdv_usd"]
    cg2 = cg[[c for c in keep if c in cg.columns]].copy()

    counts = cg2.groupby("symbol_u")["id"].count().reset_index(name="cg_matches")
    ambiguous = counts[counts["cg_matches"] > 1].merge(cg2, on="symbol_u", how="left")
    ambiguous = ambiguous.sort_values(["symbol_u", "market_cap"], ascending=[True, False])

    chosen = cg2.sort_values(["symbol_u", "market_cap"], ascending=[True, False]).drop_duplicates(
        "symbol_u", keep="first"
    )
    symbol_map = {row["symbol_u"]: row.to_dict() for _, row in chosen.iterrows()}
    return symbol_map, ambiguous


# ------------------------- Exchange fetchers -------------------------

def add_pair(store: Dict[str, Dict[str, List[str]]], base: str, market: str, pair: str) -> None:
    b = base.upper()
    store.setdefault(b, {}).setdefault(market, [])
    store[b][market].append(pair)


def fetch_okx() -> Dict[str, Dict[str, List[str]]]:
    out: Dict[str, Dict[str, List[str]]] = {}
    for inst_type, market in [("SPOT", "spot"), ("SWAP", "futures"), ("FUTURES", "futures")]:
        print(f"[OKX] fetching {inst_type} instruments ...")
        data = http_get_json("https://www.okx.com/api/v5/public/instruments", params={"instType": inst_type})
        for row in data.get("data", []):
            inst_id = row.get("instId")
            if not inst_id:
                continue
            base = inst_id.split("-")[0]
            add_pair(out, base, market, inst_id)
    return out


def fetch_gate() -> Dict[str, Dict[str, List[str]]]:
    out: Dict[str, Dict[str, List[str]]] = {}

    print("[Gate.io] fetching spot pairs ...")
    spot = http_get_json("https://api.gateio.ws/api/v4/spot/currency_pairs")
    for row in spot:
        if row.get("trade_status") != "tradable":
            continue
        pair = row.get("id")
        base = row.get("base") or (pair.split("_")[0] if pair else None)
        if base and pair:
            add_pair(out, base, "spot", pair)

    for settle in ["usdt", "btc"]:
        print(f"[Gate.io] fetching futures contracts ({settle}) ...")
        fut = http_get_json(f"https://api.gateio.ws/api/v4/futures/{settle}/contracts")
        for row in fut:
            if row.get("in_delisting") is True:
                continue
            name = row.get("name")
            base = row.get("underlying") or (name.split("_")[0] if name else None)
            if base and name:
                add_pair(out, base, "futures", name)

    return out


def fetch_bitget() -> Dict[str, Dict[str, List[str]]]:
    out: Dict[str, Dict[str, List[str]]] = {}

    print("[Bitget] fetching spot symbols ...")
    spot = http_get_json("https://api.bitget.com/api/v2/spot/public/symbols")
    for row in spot.get("data", []):
        if row.get("status") != "online":
            continue
        pair = row.get("symbol") or row.get("symbolName")
        base = row.get("baseCoin") or row.get("base")
        if base and pair:
            add_pair(out, base, "spot", pair)

    print("[Bitget] fetching futures contracts ...")
    fut = http_get_json("https://api.bitget.com/api/v2/mix/market/contracts", params={"productType": "usdt-futures"})
    for row in fut.get("data", []):
        if row.get("symbolStatus") not in (None, "normal", "listed"):
            continue
        pair = row.get("symbol")
        base = row.get("baseCoin")
        if base and pair:
            add_pair(out, base, "futures", pair)

    return out


def fetch_bybit() -> Dict[str, Dict[str, List[str]]]:
    out: Dict[str, Dict[str, List[str]]] = {}

    # spot
    print("[Bybit] fetching spot instruments ...")
    data = http_get_json("https://api.bybit.com/v5/market/instruments-info", params={"category": "spot"})
    for row in data.get("result", {}).get("list", []):
        if row.get("status") not in (None, "Trading"):
            continue
        base = row.get("baseCoin")
        sym = row.get("symbol")
        if base and sym:
            add_pair(out, base, "spot", sym)

    # derivatives: linear + inverse (cursor pagination)
    for cat in ["linear", "inverse"]:
        print(f"[Bybit] fetching {cat} instruments (paginated) ...")
        cursor: Optional[str] = None
        while True:
            params = {"category": cat, "limit": 1000}
            if cursor:
                params["cursor"] = cursor
            data = http_get_json("https://api.bybit.com/v5/market/instruments-info", params=params)
            res = data.get("result", {})
            for row in res.get("list", []):
                if row.get("status") not in (None, "Trading"):
                    continue
                base = row.get("baseCoin")
                sym = row.get("symbol")
                if base and sym:
                    add_pair(out, base, "futures", sym)
            cursor = res.get("nextPageCursor")
            if not cursor:
                break
            time.sleep(0.25)

    return out


def fetch_binance_futures() -> Dict[str, Dict[str, List[str]]]:
    out: Dict[str, Dict[str, List[str]]] = {}
    print("[Binance] fetching USD-M futures exchangeInfo ...")
    data = http_get_json("https://fapi.binance.com/fapi/v1/exchangeInfo")
    for row in data.get("symbols", []):
        if row.get("status") != "TRADING":
            continue
        sym = row.get("symbol")
        base = row.get("baseAsset")
        if base and sym:
            add_pair(out, base, "futures", sym)
    return out


def fetch_binance_spot() -> Tuple[Dict[str, Dict[str, List[str]]], str]:
    """Try exchangeInfo; fallback to ticker/price heuristic."""
    out: Dict[str, Dict[str, List[str]]] = {}
    last_err: Optional[Exception] = None

    for url in [
        "https://api.binance.com/api/v3/exchangeInfo",
        "https://data-api.binance.vision/api/v3/exchangeInfo",
    ]:
        try:
            print(f"[Binance] fetching spot exchangeInfo: {url}")
            data = http_get_json(url, params={"permissions": "SPOT"})
            for row in data.get("symbols", []):
                if row.get("status") != "TRADING":
                    continue
                sym = row.get("symbol")
                base = row.get("baseAsset")
                if base and sym:
                    add_pair(out, base, "spot", sym)
            return out, "exchangeInfo"
        except Exception as e:
            last_err = e

    # fallback: ticker/price + quote-suffix heuristic
    print("[Binance] exchangeInfo failed; fallback to ticker/price heuristic")
    tickers = http_get_json("https://api.binance.com/api/v3/ticker/price")
    symbols = [t.get("symbol") for t in tickers if t.get("symbol")]

    quotes = sorted(
        [
            "USDT", "USDC", "FDUSD", "BUSD", "TUSD",
            "BTC", "ETH", "BNB",
            "EUR", "GBP", "TRY", "BRL", "AUD", "JPY", "KRW", "INR",
            "BIDR", "IDRT", "UAH", "ZAR", "ARS", "MXN", "PLN", "RUB", "NGN",
        ],
        key=len,
        reverse=True,
    )

    for sym in symbols:
        base = None
        for q in quotes:
            if sym.endswith(q) and len(sym) > len(q):
                base = sym[: -len(q)]
                break
        if base:
            add_pair(out, base, "spot", sym)

    return out, f"ticker/price heuristic (exchangeInfo failed: {last_err})"


# ------------------------- Workbook build -------------------------

def merge_exchanges(ex_map: Dict[str, Dict[str, Dict[str, List[str]]]]) -> pd.DataFrame:
    rows = []
    for ex, base_map in ex_map.items():
        for sym, mkt_map in base_map.items():
            for mkt, pairs in mkt_map.items():
                for p in sorted(set(pairs)):
                    rows.append({"exchange": ex, "symbol": sym, "market": mkt, "pair": p})
    return pd.DataFrame(rows)


def build_exchange_sheet(
    base_map: Dict[str, Dict[str, List[str]]],
    symbol_map: Dict[str, dict],
) -> pd.DataFrame:
    recs = []
    for sym, mkt_map in base_map.items():
        cg = symbol_map.get(sym)
        recs.append(
            {
                "Coin Name (CoinGecko)": cg.get("name") if cg else None,
                "Symbol": sym,
                "FDV (USD)": cg.get("fdv_usd") if cg else None,
                "Spot pairs": ", ".join(sorted(set(mkt_map.get("spot", [])))),
                "Futures/Perp pairs": ", ".join(sorted(set(mkt_map.get("futures", [])))),
            }
        )
    df = pd.DataFrame(recs)
    df = df[df["FDV (USD)"].notna() & (df["FDV (USD)"] <= FDV_LIMIT_USD)].copy()
    df.sort_values(["Coin Name (CoinGecko)", "Symbol"], inplace=True, na_position="last")
    return df


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="fdv_le_500m_pairs.xlsx")
    ap.add_argument("--cg_pages", type=int, default=40, help="CoinGecko /coins/markets pages (250 per page)")
    args = ap.parse_args()

    print("Fetching CoinGecko markets...")
    cg = fetch_coingecko_markets(max_pages=args.cg_pages)
    symbol_map, ambiguous = build_symbol_map(cg)
    print(f"CoinGecko: {len(cg):,} rows | {len(symbol_map):,} unique symbols")

    print("Fetching exchange instruments...")
    ex: Dict[str, Dict[str, Dict[str, List[str]]]] = {}

    ex["OKX"] = fetch_okx()
    ex["Bybit"] = fetch_bybit()
    ex["Gate.io"] = fetch_gate()
    ex["Bitget"] = fetch_bitget()

    bin_spot, bin_note = fetch_binance_spot()
    ex["Binance (Spot)"] = bin_spot
    ex["Binance (Futures)"] = fetch_binance_futures()

    print("Building workbook...")
    flat = merge_exchanges(ex)

    # summary by symbol
    all_syms = sorted({sym for bm in ex.values() for sym in bm.keys()})
    summary_rows = []
    for sym in all_syms:
        cgrow = symbol_map.get(sym)
        summary_rows.append(
            {
                "Symbol": sym,
                "Coin Name (CoinGecko)": cgrow.get("name") if cgrow else None,
                "FDV (USD)": cgrow.get("fdv_usd") if cgrow else None,
                "On exchanges": ", ".join(sorted([k for k, v in ex.items() if sym in v])),
                "Spot pair count": sum(len(v.get(sym, {}).get("spot", [])) for v in ex.values()),
                "Futures/perp pair count": sum(len(v.get(sym, {}).get("futures", [])) for v in ex.values()),
            }
        )
    summary = pd.DataFrame(summary_rows)
    summary = summary[summary["FDV (USD)"].notna() & (summary["FDV (USD)"] <= FDV_LIMIT_USD)].copy()
    summary.sort_values(["Coin Name (CoinGecko)", "Symbol"], inplace=True, na_position="last")

    meta = pd.DataFrame(
        [
            {"key": "FDV limit (USD)", "value": FDV_LIMIT_USD},
            {"key": "CoinGecko pages fetched", "value": args.cg_pages},
            {"key": "Binance spot method", "value": bin_note},
            {"key": "Generated at (UTC)", "value": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())},
        ]
    )

    with pd.ExcelWriter(args.out, engine="openpyxl") as writer:
        summary.to_excel(writer, sheet_name="Summary", index=False)

        for ex_name, base_map in ex.items():
            sheet_name = ex_name[:31]
            df = build_exchange_sheet(base_map, symbol_map)
            df.to_excel(writer, sheet_name=sheet_name, index=False)

        flat.to_excel(writer, sheet_name="AllPairs_Normalized", index=False)
        ambiguous.rename(columns={"symbol_u": "Symbol"}, inplace=True)
        ambiguous.to_excel(writer, sheet_name="Ambiguous_Symbols", index=False)
        meta.to_excel(writer, sheet_name="Meta", index=False)

    print(f"Done. Wrote {args.out}")


if __name__ == "__main__":
    main()
