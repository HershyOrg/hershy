#!/usr/bin/env python3
import argparse
import csv
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd
BASE = "https://api.bitget.com"
_WARNED = set()


def _warn_once(key: str, msg: str) -> None:
    if key in _WARNED:
        return
    _WARNED.add(key)
    print(f"[WARN] {msg}")


def _request(url: str, params: dict, label: str) -> list:
    query = urllib.parse.urlencode(params)
    full = f"{url}?{query}"
    req = urllib.request.Request(full, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.load(resp)
    payload = data.get("data", [])
    if isinstance(payload, list):
        return payload
    msg = data.get("msg") or data.get("message") or str(data)
    _warn_once(label, f"{label} returned non-list payload: {msg}")
    return []


def fetch_spot(symbol: str, start_ms: int, end_ms: int, limit: int) -> list:
    url = f"{BASE}/api/v2/spot/market/candles"
    params = {
        "symbol": symbol,
        "granularity": "1min",
        "startTime": start_ms,
        "endTime": end_ms,
        "limit": limit,
    }
    return _request(url, params, "spot/candles")


def fetch_perp(symbol: str, start_ms: int, end_ms: int, limit: int) -> list:
    url = f"{BASE}/api/v2/mix/market/candles"
    params = {
        "symbol": symbol,
        "productType": "usdt-futures",
        "granularity": "1m",
        "startTime": start_ms,
        "endTime": end_ms,
        "limit": limit,
    }
    return _request(url, params, "mix/candles")


def fetch_perp_history(symbol: str, end_ms: int, limit: int) -> list:
    url = f"{BASE}/api/v2/mix/market/history-candles"
    start_ms = max(0, end_ms - (limit * 60 * 1000))
    params = {
        "symbol": symbol,
        "productType": "usdt-futures",
        "granularity": "1m",
        "startTime": start_ms,
        "endTime": end_ms,
        "limit": limit,
    }
    return _request(url, params, "mix/history-candles")


def normalize(rows: list) -> list[tuple]:
    out = []
    for row in rows:
        if not row or len(row) < 5:
            continue
        try:
            ts = int(row[0])
            o = row[1]
            h = row[2]
            l = row[3]
            c = row[4]
            v = row[5] if len(row) > 5 else None
        except Exception:
            continue
        out.append((ts, o, h, l, c, v))
    return out


def _min_max_ts(path: Path) -> tuple[int | None, int | None]:
    if not path.exists():
        return None, None
    if path.name.endswith(".parquet"):
        df = pd.read_parquet(path, columns=["ts_ms"])
    else:
        df = pd.read_csv(path, usecols=["ts_ms"])
    if df.empty:
        return None, None
    ts = pd.to_numeric(df["ts_ms"], errors="coerce").dropna()
    if ts.empty:
        return None, None
    return int(ts.min()), int(ts.max())


def backfill_windowed(
    fetch_fn,
    symbol: str,
    out_csv: Path,
    end_ms: int,
    limit: int,
    max_empty: int,
    start_ms: int | None = None,
) -> int:
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    empty_count = 0
    step_ms = limit * 60 * 1000
    cur_end = end_ms
    last_earliest = None
    rows_written = 0

    with out_csv.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["ts_ms", "open", "high", "low", "close", "volume"])

        while True:
            cur_start = max(0, cur_end - step_ms)
            if start_ms is not None and cur_start < start_ms:
                cur_start = start_ms
            rows = fetch_fn(symbol, cur_start, cur_end, limit)
            if not rows:
                empty_count += 1
                if empty_count >= max_empty:
                    break
                cur_end = cur_start - 1
                time.sleep(0.1)
                continue

            empty_count = 0
            norm = normalize(rows)
            if start_ms is not None:
                norm = [r for r in norm if r[0] >= start_ms]
            if not norm:
                cur_end = cur_start - 1
                time.sleep(0.05)
                continue

            for r in norm:
                w.writerow(r)
                rows_written += 1

            earliest_ts = min(r[0] for r in norm)
            if last_earliest is not None and earliest_ts >= last_earliest:
                break
            last_earliest = earliest_ts
            if earliest_ts <= 0:
                break
            if start_ms is not None and earliest_ts <= start_ms:
                break
            cur_end = earliest_ts - 1
            time.sleep(0.05)

    if rows_written == 0:
        out_csv.unlink(missing_ok=True)
    return rows_written


def backfill_history(
    fetch_fn,
    symbol: str,
    out_csv: Path,
    end_ms: int,
    limit: int,
    max_empty: int,
    start_ms: int | None = None,
) -> int:
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    empty_count = 0
    cur_end = end_ms
    last_earliest = None
    rows_written = 0

    with out_csv.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["ts_ms", "open", "high", "low", "close", "volume"])

        while True:
            rows = fetch_fn(symbol, cur_end, limit)
            if not rows:
                empty_count += 1
                if empty_count >= max_empty:
                    break
                cur_end = cur_end - (limit * 60 * 1000)
                time.sleep(0.1)
                continue

            empty_count = 0
            norm = normalize(rows)
            if start_ms is not None:
                norm = [r for r in norm if r[0] >= start_ms]
            if not norm:
                cur_end = cur_end - (limit * 60 * 1000)
                time.sleep(0.05)
                continue

            for r in norm:
                w.writerow(r)
                rows_written += 1

            earliest_ts = min(r[0] for r in norm)
            if last_earliest is not None and earliest_ts >= last_earliest:
                break
            last_earliest = earliest_ts
            if earliest_ts <= 0:
                break
            if start_ms is not None and earliest_ts <= start_ms:
                break
            cur_end = earliest_ts - 1
            time.sleep(0.05)

    if rows_written == 0:
        out_csv.unlink(missing_ok=True)
    return rows_written


def merge_existing(existing_parquet: Path, new_csvs: list[Path]) -> Path | None:
    frames = []
    if existing_parquet.exists():
        frames.append(pd.read_parquet(existing_parquet))
    for p in new_csvs:
        if p.exists():
            frames.append(pd.read_csv(p))
    if not frames:
        return None
    df = pd.concat(frames, ignore_index=True)
    if "ts_ms" in df.columns:
        df["ts_ms"] = pd.to_numeric(df["ts_ms"], errors="coerce")
        df = df.dropna(subset=["ts_ms"]).drop_duplicates(subset=["ts_ms"]).sort_values("ts_ms")
    df.to_parquet(existing_parquet, index=False, compression="snappy")
    return existing_parquet


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", default="MYXUSDT")
    ap.add_argument("--out-dir", default="src/out/cex_oracle/bitget_history")
    ap.add_argument("--end-ms", type=int, default=None)
    ap.add_argument("--limit", type=int, default=100)
    ap.add_argument("--max-empty", type=int, default=5)
    ap.add_argument("--start-ms", type=int, default=None)
    ap.add_argument("--no-perp-history", action="store_true", help="Disable history-candles for perp")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    base_end_ms = args.end_ms or int(time.time() * 1000)

    spot_csv = out_dir / f"bitget_spot_{args.symbol}_1m.csv"
    perp_csv = out_dir / f"bitget_perp_{args.symbol}_1m.csv"
    spot_parquet = spot_csv.with_suffix(".parquet")
    perp_parquet = perp_csv.with_suffix(".parquet")

    use_perp_history = not args.no_perp_history
    spot_min, _ = _min_max_ts(spot_parquet)
    end_ms_spot = base_end_ms
    if spot_min is not None:
        end_ms_spot = min(end_ms_spot, spot_min - 1)

    new_csvs: list[Path] = []

    if args.start_ms is None or end_ms_spot > args.start_ms:
        print(f"[SPOT] backfill {args.symbol} -> {spot_csv}")
        rows = backfill_windowed(
            fetch_spot,
            args.symbol,
            spot_csv,
            end_ms_spot,
            args.limit,
            args.max_empty,
            args.start_ms,
        )
        if rows:
            new_csvs.append(spot_csv)
    else:
        print("[SPOT] no older data needed (start_ms >= end_ms)")

    if new_csvs or spot_parquet.exists():
        merged = merge_existing(spot_parquet, new_csvs)
        if merged:
            print(f"[OK] spot merged: {merged}")
        for p in new_csvs:
            p.unlink(missing_ok=True)

    new_csvs = []

    perp_min, _ = _min_max_ts(perp_parquet)
    end_ms_perp = base_end_ms
    if perp_min is not None:
        end_ms_perp = min(end_ms_perp, perp_min - 1)

    if args.start_ms is None or end_ms_perp > args.start_ms:
        print(f"[PERP] backfill {args.symbol} -> {perp_csv}")
        rows = backfill_windowed(fetch_perp, args.symbol, perp_csv, end_ms_perp, args.limit, args.max_empty, args.start_ms)
        if rows:
            new_csvs.append(perp_csv)
    else:
        print("[PERP] no older data needed (start_ms >= end_ms)")

    if use_perp_history:
        hist_csv = out_dir / f"bitget_perp_{args.symbol}_1m_history.csv"
        print(f"[PERP] history backfill {args.symbol} -> {hist_csv}")
        rows = backfill_history(fetch_perp_history, args.symbol, hist_csv, end_ms_perp, args.limit, args.max_empty, args.start_ms)
        if rows:
            new_csvs.append(hist_csv)

    if new_csvs or perp_parquet.exists():
        merged = merge_existing(perp_parquet, new_csvs)
        if merged:
            print(f"[OK] perp merged: {merged}")
        for p in new_csvs:
            p.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
