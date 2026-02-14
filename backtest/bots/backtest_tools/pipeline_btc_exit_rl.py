#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import asyncio
import csv
import datetime as dt
import json
import math
import time
import zipfile
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import numpy as np
import pandas as pd
import requests
from tqdm import tqdm

import websockets
import pyarrow as pa
import pyarrow.parquet as pq

import matplotlib.pyplot as plt


SYMBOL = "BTCUSDT"
BASE_VISION = "https://data.binance.vision"
DATA_DIR = Path("data")
OUT_DIR = Path("out")

LIVE_SNAPSHOT_DIR = OUT_DIR / "live_snapshots"
LIVE_STATE_PATH = OUT_DIR / "live_state.json"

MODEL_PATH = OUT_DIR / "prob_model_logit.json"

BINANCE_REST = "https://api.binance.com"

DEFAULT_BACKFILL_MAX_HOURS = 72
HEARTBEAT_SEC = 60

INTERVAL_SEC = {
    "1s": 1,
    "1m": 60,
    "1h": 3600,
}


# --------------------------
# Utils
# --------------------------

def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)

def parse_date(s: str) -> dt.date:
    return dt.datetime.strptime(s, "%Y-%m-%d").date()

def daterange(start_date: dt.date, end_date: dt.date) -> List[dt.date]:
    out = []
    cur = start_date
    while cur < end_date:
        out.append(cur)
        cur += dt.timedelta(days=1)
    return out

def to_ms(ts: int) -> int:
    # public data가 us일 수 있음
    if ts >= 10**15:
        return ts // 1000
    return ts

def floor_to_hour_ms(ts_ms: int) -> int:
    return (ts_ms // 3_600_000) * 3_600_000

def now_ms() -> int:
    return int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000)

def hour_ms_to_date(ms: int) -> dt.date:
    return dt.datetime.utcfromtimestamp(ms / 1000).date()

def ms_to_utc_str(ms: int) -> str:
    return dt.datetime.fromtimestamp(ms / 1000, tz=dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

def ms_to_local_str(ms: int) -> str:
    # 로컬 타임존(맥 시스템)으로 변환
    return dt.datetime.fromtimestamp(ms / 1000, tz=dt.timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")


# --------------------------
# Download: official daily klines
# --------------------------

def download_file(url: str, dest: Path) -> None:
    ensure_dir(dest.parent)
    if dest.exists() and dest.stat().st_size > 0:
        return
    with requests.get(url, stream=True, timeout=60) as r:
        r.raise_for_status()
        total = int(r.headers.get("Content-Length", 0))
        with open(dest, "wb") as f, tqdm(total=total, unit="B", unit_scale=True, desc=dest.name) as pbar:
            for chunk in r.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    f.write(chunk)
                    pbar.update(len(chunk))

def kline_daily_url(symbol: str, interval: str, d: dt.date) -> str:
    ds = d.strftime("%Y-%m-%d")
    return f"{BASE_VISION}/data/spot/daily/klines/{symbol}/{interval}/{symbol}-{interval}-{ds}.zip"

def download_daily_klines(symbol: str, interval: str, start_date: dt.date, end_date: dt.date) -> List[Path]:
    paths = []
    for d in daterange(start_date, end_date):
        url = kline_daily_url(symbol, interval, d)
        dest = DATA_DIR / "spot" / "daily" / "klines" / symbol / interval / f"{symbol}-{interval}-{d.strftime('%Y-%m-%d')}.zip"
        try:
            download_file(url, dest)
            paths.append(dest)
        except requests.HTTPError as e:
            print(f"[WARN] skip {url} ({e})")
    return paths


# --------------------------
# Read kline rows
# --------------------------

def iter_kline_rows_from_zip(zip_path: Path) -> Iterable[List[str]]:
    with zipfile.ZipFile(zip_path, "r") as zf:
        csv_names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
        if not csv_names:
            return
        name = csv_names[0]
        with zf.open(name, "r") as f:
            reader = csv.reader((line.decode("utf-8").strip() for line in f))
            for row in reader:
                if not row or len(row) < 6:
                    continue
                yield row


# --------------------------
# Build O_1h map (vision 1h)
# --------------------------

def build_O1h_map_from_1h_klines(zip_paths_1h: List[Path], start_ms: int, end_ms: int) -> Dict[int, float]:
    o_map: Dict[int, float] = {}
    for z in zip_paths_1h:
        for r in iter_kline_rows_from_zip(z):
            try:
                open_time = to_ms(int(r[0]))
                if open_time < start_ms or open_time >= end_ms:
                    continue
                hour_open = floor_to_hour_ms(open_time)
                o_map[hour_open] = float(r[1])
            except Exception:
                continue
    return o_map


# --------------------------
# Build snapshots (historical) - last window per hour
# --------------------------

def build_snapshot_rows_from_buffer(
    hour_open_ms: int,
    buffer: List[dict],
    o1h_map: Dict[int, float],
    last_window_sec: int,
    interval_sec: int,
) -> List[dict]:
    if interval_sec <= 0 or (last_window_sec % interval_sec) != 0:
        return []
    last_window_steps = last_window_sec // interval_sec
    if not buffer or len(buffer) != last_window_steps:
        return []
    if hour_open_ms not in o1h_map:
        return []

    O_1h = float(o1h_map[hour_open_ms])
    O_4m = float(buffer[0]["O_4m"])

    rows = []
    for i, b in enumerate(buffer):
        tau_sec = (last_window_steps - i) * interval_sec
        P_t = float(b["P_t"])
        cum_vol_1h = float(b["cum_vol_1h"])
        mom = float(b["mom_logret_60s"])
        regime = int(b["regime"])

        disparity_O = (P_t / (O_1h + 1e-12)) * 100.0
        delta_pct = (P_t / (O_1h + 1e-12) - 1.0) * 100.0

        rows.append({
            "hour_open_ms": int(hour_open_ms),
            "t_ms": int(b["t_ms"]),
            "tau_sec": int(tau_sec),
            "window_sec": int(last_window_sec),
            "interval_sec": int(interval_sec),
            "O_1h": O_1h,
            "O_4m": O_4m,
            "P_t": P_t,
            "cum_vol_1h": cum_vol_1h,
            "disparity_O": float(disparity_O),
            "delta_pct": float(delta_pct),
            "mom_logret_60s": mom,
            "regime": regime,
        })

    return rows

def build_snapshots_historical(
    zip_paths_interval: List[Path],
    o1h_map: Dict[int, float],
    start_ms: int,
    end_ms: int,
    last_window_sec: int = 240,
    momentum_sec: int = 60,
    interval_sec: int = 1,
    out_path: Optional[Path] = None,
) -> Path:
    ensure_dir(OUT_DIR)
    ensure_dir(OUT_DIR / "tau_partitions")

    if interval_sec <= 0 or (last_window_sec % interval_sec) != 0:
        raise ValueError("interval_sec must divide last_window_sec.")
    if momentum_sec <= 0 or (momentum_sec % interval_sec) != 0:
        raise ValueError("interval_sec must divide momentum_sec.")

    last_window_steps = last_window_sec // interval_sec
    momentum_steps = momentum_sec // interval_sec
    if momentum_steps < 1:
        raise ValueError("momentum_sec too small for interval_sec.")

    rows = []

    cur_hour = None
    hour_cum_vol = 0.0
    last_closes = deque(maxlen=momentum_steps + 1)
    window_buffer = []
    o4m = None

    def flush_hour(hour_open_ms: int, buffer: List[dict]):
        rows_for_hour = build_snapshot_rows_from_buffer(
            hour_open_ms,
            buffer,
            o1h_map,
            last_window_sec,
            interval_sec,
        )
        if rows_for_hour:
            rows.extend(rows_for_hour)

    for z in zip_paths_interval:
        for r in iter_kline_rows_from_zip(z):
            try:
                t_ms = to_ms(int(r[0]))
                if t_ms < start_ms or t_ms >= end_ms:
                    continue

                hour_open = floor_to_hour_ms(t_ms)
                offset_ms = t_ms - hour_open

                o = float(r[1])    # 1s open
                c = float(r[4])    # 1s close
                vol = float(r[5])  # 1s volume
            except Exception:
                continue

            if cur_hour is None or hour_open != cur_hour:
                if cur_hour is not None:
                    flush_hour(cur_hour, window_buffer)

                cur_hour = hour_open
                hour_cum_vol = 0.0
                last_closes.clear()
                window_buffer = []
                o4m = None

            hour_cum_vol += vol
            last_closes.append(c)

            if len(last_closes) >= momentum_steps + 1:
                prev = last_closes[0]
                mom = math.log(c / (prev + 1e-12))
            else:
                mom = 0.0

            eps = 0.0002
            regime = 1 if mom > eps else (-1 if mom < -eps else 0)

            if offset_ms >= (3_600_000 - last_window_sec * 1000):
                if o4m is None:
                    o4m = o

                window_buffer.append({
                    "t_ms": t_ms,
                    "P_t": c,
                    "cum_vol_1h": hour_cum_vol,
                    "mom_logret_60s": mom,
                    "regime": regime,
                    "O_4m": o4m,
                })
                if len(window_buffer) > last_window_steps:
                    window_buffer = window_buffer[-last_window_steps:]

    if cur_hour is not None:
        flush_hour(cur_hour, window_buffer)

    df = pd.DataFrame(rows)
    if df.empty:
        raise RuntimeError("No snapshots produced.")
    df = df.sort_values(["hour_open_ms", "t_ms"]).reset_index(drop=True)

    out_path = out_path or (OUT_DIR / "snapshots.parquet")
    df.to_parquet(out_path, index=False)

    print(f"[OK] snapshots rows={len(df):,}, hours={df['hour_open_ms'].nunique():,}")
    print(f"[OK] saved: {out_path}")
    return out_path


# --------------------------
# Iter snapshots (historical) for backfill
# --------------------------

def iter_snapshot_hours_from_1s(
    zip_paths_interval: List[Path],
    o1h_map: Dict[int, float],
    start_ms: int,
    end_ms: int,
    last_window_sec: int = 240,
    momentum_sec: int = 60,
    interval_sec: int = 1,
) -> Iterable[pd.DataFrame]:
    if interval_sec <= 0 or (last_window_sec % interval_sec) != 0:
        raise ValueError("interval_sec must divide last_window_sec.")
    if momentum_sec <= 0 or (momentum_sec % interval_sec) != 0:
        raise ValueError("interval_sec must divide momentum_sec.")

    last_window_steps = last_window_sec // interval_sec
    momentum_steps = momentum_sec // interval_sec
    if momentum_steps < 1:
        raise ValueError("momentum_sec too small for interval_sec.")

    cur_hour = None
    hour_cum_vol = 0.0
    last_closes = deque(maxlen=momentum_steps + 1)
    window_buffer = []
    o4m = None

    def flush_hour(hour_open_ms: int, buffer: List[dict]) -> Optional[pd.DataFrame]:
        rows_for_hour = build_snapshot_rows_from_buffer(
            hour_open_ms,
            buffer,
            o1h_map,
            last_window_sec,
            interval_sec,
        )
        if not rows_for_hour:
            return None
        return pd.DataFrame(rows_for_hour)

    for z in zip_paths_interval:
        for r in iter_kline_rows_from_zip(z):
            try:
                t_ms = to_ms(int(r[0]))
                if t_ms < start_ms or t_ms >= end_ms:
                    continue

                hour_open = floor_to_hour_ms(t_ms)
                offset_ms = t_ms - hour_open

                o = float(r[1])
                c = float(r[4])
                vol = float(r[5])
            except Exception:
                continue

            if cur_hour is None or hour_open != cur_hour:
                if cur_hour is not None:
                    df_hour = flush_hour(cur_hour, window_buffer)
                    if df_hour is not None:
                        yield df_hour

                cur_hour = hour_open
                hour_cum_vol = 0.0
                last_closes.clear()
                window_buffer = []
                o4m = None

            hour_cum_vol += vol
            last_closes.append(c)

            if len(last_closes) >= momentum_steps + 1:
                prev = last_closes[0]
                mom = math.log(c / (prev + 1e-12))
            else:
                mom = 0.0

            eps = 0.0002
            regime = 1 if mom > eps else (-1 if mom < -eps else 0)

            if offset_ms >= (3_600_000 - last_window_sec * 1000):
                if o4m is None:
                    o4m = o

                window_buffer.append({
                    "t_ms": t_ms,
                    "P_t": c,
                    "cum_vol_1h": hour_cum_vol,
                    "mom_logret_60s": mom,
                    "regime": regime,
                    "O_4m": o4m,
                })
                if len(window_buffer) > last_window_steps:
                    window_buffer = window_buffer[-last_window_steps:]

    if cur_hour is not None:
        df_hour = flush_hour(cur_hour, window_buffer)
        if df_hour is not None:
            yield df_hour


# --------------------------
# Build snapshots (live)
# --------------------------

def build_snapshot_df_from_live(
    hour_open_ms: int,
    O_1h: Optional[float],
    buffer: List[dict],
    last_window_sec: int = 240,
) -> Optional[pd.DataFrame]:
    if O_1h is None:
        return None
    if len(buffer) != last_window_sec:
        return None

    buffer_sorted = sorted(buffer, key=lambda x: x["t_ms"])
    O_4m = float(buffer_sorted[0]["O_4m"])

    rows = []
    for i, b in enumerate(buffer_sorted):
        tau_sec = last_window_sec - i
        P_t = float(b["P_t"])
        cum_vol_1h = float(b["cum_vol_1h"])
        mom = float(b["mom_logret_60s"])
        regime = int(b["regime"])

        disparity_O = (P_t / (O_1h + 1e-12)) * 100.0
        delta_pct = (P_t / (O_1h + 1e-12) - 1.0) * 100.0

        rows.append({
            "hour_open_ms": int(hour_open_ms),
            "t_ms": int(b["t_ms"]),
            "tau_sec": int(tau_sec),
            "O_1h": float(O_1h),
            "O_4m": O_4m,
            "P_t": P_t,
            "cum_vol_1h": cum_vol_1h,
            "disparity_O": float(disparity_O),
            "delta_pct": float(delta_pct),
            "mom_logret_60s": mom,
            "regime": regime,
        })

    return pd.DataFrame(rows)

def save_live_snapshot(df: pd.DataFrame, hour_open_ms: int) -> Path:
    ensure_dir(LIVE_SNAPSHOT_DIR)
    out_path = LIVE_SNAPSHOT_DIR / f"hour_{hour_open_ms}.parquet"
    df.to_parquet(out_path, index=False)
    return out_path


# --------------------------
# Live: checkpoint
# --------------------------

def load_live_state() -> dict:
    base = {"last_t_ms": None, "last_updated_hour_ms": None}
    if LIVE_STATE_PATH.exists():
        try:
            state = json.loads(LIVE_STATE_PATH.read_text())
            base.update(state)
            return base
        except Exception:
            return base
    return base

def save_live_state(
    last_t_ms: Optional[int] = None,
    last_updated_hour_ms: Optional[int] = None,
) -> None:
    state = load_live_state()
    if last_t_ms is not None:
        state["last_t_ms"] = int(last_t_ms)
    if last_updated_hour_ms is not None:
        state["last_updated_hour_ms"] = int(last_updated_hour_ms)
    state["updated_utc"] = dt.datetime.utcnow().isoformat() + "Z"
    ensure_dir(LIVE_STATE_PATH.parent)
    LIVE_STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2))


# --------------------------
# PROB MODEL: logistic regression (numpy SGD)
# --------------------------

def sigmoid_scalar(z: float) -> float:
    z = max(-50.0, min(50.0, z))
    return 1.0 / (1.0 + math.exp(-z))

def standardize_fit(X: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    mu = X.mean(axis=0)
    sd = X.std(axis=0)
    sd = np.where(sd < 1e-12, 1.0, sd)
    Xn = (X - mu) / sd
    return Xn, mu, sd

def build_labels_for_snapshots(df: pd.DataFrame) -> pd.Series:
    last_idx = df.groupby("hour_open_ms")["tau_sec"].idxmin()
    last_rows = df.loc[last_idx]
    y_hour = (last_rows["P_t"] > last_rows["O_1h"]).astype(np.int8)
    y_hour.index = last_rows["hour_open_ms"]
    return df["hour_open_ms"].map(y_hour).astype(np.int8)

def feature_matrix(df: pd.DataFrame, tau_norm_div: float = 240.0) -> np.ndarray:
    if tau_norm_div <= 0:
        tau_norm_div = 240.0
    tau_norm = (df["tau_sec"].to_numpy(dtype=np.float64) / float(tau_norm_div))
    X = np.column_stack([
        df["delta_pct"].to_numpy(dtype=np.float64),
        np.log1p(df["cum_vol_1h"].to_numpy(dtype=np.float64)),
        df["mom_logret_60s"].to_numpy(dtype=np.float64),
        df["regime"].to_numpy(dtype=np.float64),
        tau_norm,
    ])
    return X

def train_logit_sgd_df(
    df: pd.DataFrame,
    model_path: Path,
    epochs: int = 2,
    lr: float = 0.05,
    l2: float = 1e-4,
    sample_rows: Optional[int] = 600_000,
    seed: int = 42,
    tag: Optional[str] = None,
    tau_norm_div: Optional[float] = None,
) -> dict:
    if df.empty:
        raise RuntimeError("No snapshots to train on.")

    if tau_norm_div is None:
        if "window_sec" in df.columns and not df["window_sec"].empty:
            tau_norm_div = float(df["window_sec"].iloc[0])
        else:
            tau_norm_div = 240.0
    if tau_norm_div <= 0:
        tau_norm_div = 240.0

    tag_prefix = f"[PROB][{tag}] " if tag else "[PROB] "
    hours_n = int(df["hour_open_ms"].nunique())
    print(f"{tag_prefix}loaded snapshots rows={len(df):,} hours={hours_n:,}")

    y = build_labels_for_snapshots(df).to_numpy(dtype=np.float64)
    X = feature_matrix(df, tau_norm_div=tau_norm_div)

    if sample_rows is not None and sample_rows < len(df):
        rng = np.random.default_rng(seed)
        idx = rng.choice(len(df), size=sample_rows, replace=False)
        X = X[idx]
        y = y[idx]
        print(f"{tag_prefix}sampled rows={len(y):,}")

    Xn, mu, sd = standardize_fit(X)
    Xb = np.column_stack([np.ones(len(Xn)), Xn])
    w = np.zeros(Xb.shape[1], dtype=np.float64)

    batch = 4096
    rng = np.random.default_rng(seed)

    for ep in range(1, epochs + 1):
        perm = rng.permutation(len(y))
        Xp = Xb[perm]
        yp = y[perm]

        losses = []
        for i in range(0, len(y), batch):
            xb = Xp[i:i+batch]
            yb = yp[i:i+batch]

            z = xb @ w
            p = 1.0 / (1.0 + np.exp(np.clip(-z, -50, 50)))

            eps = 1e-12
            loss = -(yb * np.log(p + eps) + (1 - yb) * np.log(1 - p + eps)).mean() + 0.5 * l2 * (w[1:] @ w[1:])
            losses.append(loss)

            grad = (xb.T @ (p - yb)) / len(yb)
            grad[1:] += l2 * w[1:]
            w -= lr * grad

        print(f"{tag_prefix}epoch {ep}/{epochs} loss~{np.mean(losses):.6f}")

    min_hour_ms = int(df["hour_open_ms"].min())
    max_hour_ms = int(df["hour_open_ms"].max())

    ensure_dir(model_path.parent)
    payload = {
        "model": "logistic_regression_sgd",
        "features": ["delta_pct", "log1p_cum_vol_1h", "mom_logret_60s", "regime", "tau_norm"],
        "w": w.tolist(),
        "mu": mu.tolist(),
        "sd": sd.tolist(),
        "tau_norm_div": float(tau_norm_div),
        "trained_utc": dt.datetime.utcnow().isoformat() + "Z",
        "epochs": epochs,
        "lr": lr,
        "l2": l2,
        "sample_rows": sample_rows,
        "train_rows": int(len(df)),
        "train_hours": hours_n,
        "train_range": {
            "start_ms": min_hour_ms,
            "end_ms": max_hour_ms + 3_600_000,
            "start_utc": ms_to_utc_str(min_hour_ms),
            "end_utc": ms_to_utc_str(max_hour_ms + 3_600_000),
        },
    }
    model_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"{tag_prefix}saved model -> {model_path}")
    return payload

def train_logit_sgd(
    snapshots_path: Path,
    epochs: int = 2,
    lr: float = 0.05,
    l2: float = 1e-4,
    sample_rows: Optional[int] = 600_000,
    seed: int = 42,
    model_path: Optional[Path] = None,
    tau_norm_div: Optional[float] = None,
):
    df = pd.read_parquet(snapshots_path)
    out_path = model_path or MODEL_PATH
    return train_logit_sgd_df(
        df,
        model_path=out_path,
        epochs=epochs,
        lr=lr,
        l2=l2,
        sample_rows=sample_rows,
        seed=seed,
        tau_norm_div=tau_norm_div,
    )

def train_logit_sgd_multi_windows(
    snapshots_path: Path,
    years: List[int],
    out_dir: Path,
    out_prefix: str = "prob_model_logit",
    epochs: int = 2,
    lr: float = 0.05,
    l2: float = 1e-4,
    sample_rows: Optional[int] = None,
    seed: int = 42,
    tau_norm_div: Optional[float] = None,
):
    df = pd.read_parquet(snapshots_path)
    if df.empty:
        raise RuntimeError("No snapshots to train on.")

    min_hour_ms = int(df["hour_open_ms"].min())
    max_hour_ms = int(df["hour_open_ms"].max())
    end_excl_ms = max_hour_ms + 3_600_000

    ensure_dir(out_dir)

    windows: List[Tuple[str, Optional[int]]] = [("all", None)]
    for y in years:
        windows.append((f"last{y}y", int(y)))

    for label, y in windows:
        if y is None:
            start_ms = min_hour_ms
        else:
            start_ms = max_hour_ms - int(y * 365 * 24 * 3600 * 1000)
            if start_ms < min_hour_ms:
                start_ms = min_hour_ms
            start_ms = floor_to_hour_ms(start_ms)

        df_slice = df[(df["hour_open_ms"] >= start_ms) & (df["hour_open_ms"] < end_excl_ms)]
        if df_slice.empty:
            print(f"[PROB][{label}] skip (no rows in range)")
            continue

        out_path = out_dir / f"{out_prefix}_{label}.json"
        train_logit_sgd_df(
            df_slice,
            model_path=out_path,
            epochs=epochs,
            lr=lr,
            l2=l2,
            sample_rows=sample_rows,
            seed=seed,
            tag=label,
            tau_norm_div=tau_norm_div,
        )

def load_prob_model() -> dict:
    if not MODEL_PATH.exists():
        raise RuntimeError(f"prob model not found: {MODEL_PATH}. Run train_prob_model first.")
    return json.loads(MODEL_PATH.read_text())

def load_prob_model_from_path(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"prob model not found: {path}")
    return json.loads(path.read_text())

def prob_predict(model: dict, delta_pct: float, cum_vol_1h: float, mom: float, regime: int, tau_sec: int) -> float:
    w = model["w"]
    mu = model["mu"]
    sd = model["sd"]
    tau_norm_div = float(model.get("tau_norm_div", 240.0))
    if tau_norm_div <= 0:
        tau_norm_div = 240.0

    x0 = delta_pct
    x1 = math.log1p(max(cum_vol_1h, 0.0))
    x2 = mom
    x3 = float(regime)
    x4 = float(tau_sec) / tau_norm_div

    # standardize
    xs = [(x0 - mu[0]) / (sd[0] if sd[0] else 1.0),
          (x1 - mu[1]) / (sd[1] if sd[1] else 1.0),
          (x2 - mu[2]) / (sd[2] if sd[2] else 1.0),
          (x3 - mu[3]) / (sd[3] if sd[3] else 1.0),
          (x4 - mu[4]) / (sd[4] if sd[4] else 1.0)]

    z = w[0] + sum(w[i+1] * xs[i] for i in range(5))
    p = sigmoid_scalar(z)
    return max(0.0, min(1.0, p))


# --------------------------
# Online update (live)
# --------------------------

def online_update_logit(
    model: dict,
    df_hour: pd.DataFrame,
    lr: float = 0.01,
    l2: float = 1e-4,
    epochs: int = 1,
    seed: int = 42,
) -> Tuple[dict, float]:
    X = feature_matrix(df_hour, tau_norm_div=float(model.get("tau_norm_div", 240.0)))
    y_label = 1 if float(df_hour.iloc[-1]["P_t"]) > float(df_hour.iloc[-1]["O_1h"]) else 0
    y = np.full(len(X), y_label, dtype=np.float64)

    w = np.array(model["w"], dtype=np.float64)
    mu = np.array(model["mu"], dtype=np.float64)
    sd = np.array(model["sd"], dtype=np.float64)
    sd = np.where(sd < 1e-12, 1.0, sd)

    Xn = (X - mu) / sd
    Xb = np.column_stack([np.ones(len(Xn)), Xn])

    rng = np.random.default_rng(seed)
    loss = 0.0

    for _ in range(epochs):
        perm = rng.permutation(len(y))
        xb = Xb[perm]
        yb = y[perm]

        z = xb @ w
        p = 1.0 / (1.0 + np.exp(np.clip(-z, -50, 50)))

        eps = 1e-12
        loss = -(yb * np.log(p + eps) + (1 - yb) * np.log(1 - p + eps)).mean() + 0.5 * l2 * (w[1:] @ w[1:])

        grad = (xb.T @ (p - yb)) / len(yb)
        grad[1:] += l2 * w[1:]
        w -= lr * grad

    model["w"] = w.tolist()
    model["last_update_utc"] = dt.datetime.utcnow().isoformat() + "Z"
    model["online_updates"] = int(model.get("online_updates", 0)) + 1
    return model, float(loss)


# --------------------------
# Backfill missing hours (historical)
# --------------------------

def backfill_missing_hours(
    model: dict,
    last_updated_hour_ms: Optional[int],
    end_hour_ms: int,
    update_lr: float = 0.01,
    update_l2: float = 1e-4,
    update_epochs: int = 1,
    save_live_snapshots: bool = False,
) -> Tuple[dict, Optional[int]]:
    if last_updated_hour_ms is None:
        print("[BACKFILL] skip (no last_updated_hour_ms)")
        return model, None

    start_hour_ms = last_updated_hour_ms + 3_600_000
    if start_hour_ms > end_hour_ms:
        print("[BACKFILL] no missing hours")
        return model, last_updated_hour_ms

    start_date = hour_ms_to_date(start_hour_ms)
    end_date = hour_ms_to_date(end_hour_ms) + dt.timedelta(days=1)

    print(f"[BACKFILL] range {ms_to_local_str(start_hour_ms)} -> {ms_to_local_str(end_hour_ms)}")
    download_daily_klines(SYMBOL, "1h", start_date, end_date)
    download_daily_klines(SYMBOL, "1s", start_date, end_date)

    zip_1h_dir = DATA_DIR / "spot" / "daily" / "klines" / SYMBOL / "1h"
    zip_1s_dir = DATA_DIR / "spot" / "daily" / "klines" / SYMBOL / "1s"
    zip_paths_1h = sorted(zip_1h_dir.glob("*.zip"))
    zip_paths_1s = sorted(zip_1s_dir.glob("*.zip"))

    if not zip_paths_1h or not zip_paths_1s:
        print("[BACKFILL] missing kline files, skip")
        return model, last_updated_hour_ms

    start_ms = int(start_hour_ms)
    end_ms = int(end_hour_ms + 3_600_000)
    o1h_map = build_O1h_map_from_1h_klines(zip_paths_1h, start_ms, end_ms)

    updated_hour = last_updated_hour_ms
    for df_hour in iter_snapshot_hours_from_1s(zip_paths_1s, o1h_map, start_ms, end_ms):
        hour_open_ms = int(df_hour.iloc[0]["hour_open_ms"])
        if hour_open_ms < start_hour_ms or hour_open_ms > end_hour_ms:
            continue

        if save_live_snapshots:
            out_path = save_live_snapshot(df_hour, hour_open_ms)
            print(f"[BACKFILL][SNAP] saved {out_path}")

        model, loss = online_update_logit(
            model,
            df_hour,
            lr=update_lr,
            l2=update_l2,
            epochs=update_epochs,
        )
        MODEL_PATH.write_text(json.dumps(model, ensure_ascii=False, indent=2))

        label = 1 if float(df_hour.iloc[-1]["P_t"]) > float(df_hour.iloc[-1]["O_1h"]) else 0
        print(f"[BACKFILL][UPD] hour_open_ms={hour_open_ms} label={label} rows={len(df_hour)} loss={loss:.6f}")

        updated_hour = hour_open_ms
        save_live_state(last_updated_hour_ms=updated_hour)

    return model, updated_hour


# --------------------------
# LIVE SIGNAL: heartbeat + next window time + matplotlib
# --------------------------

def compute_pbad(p_up: float, P_t: float, O_1h: float) -> Tuple[float, int]:
    sgn = 1 if (P_t - O_1h) >= 0 else -1
    if sgn == 1:
        Pbad = 1.0 - p_up
    else:
        Pbad = p_up
    return Pbad, sgn

class LivePlot:
    def __init__(self, theta: float):
        plt.ion()
        self.fig, self.ax = plt.subplots()
        self.theta = theta

        self.ts = []
        self.pups = []
        self.pbads = []

        (self.line_p, ) = self.ax.plot([], [], label="p_up = Pr(C>O)")
        (self.line_b, ) = self.ax.plot([], [], label="Pbad (wrong prob)")
        self.ax.axhline(theta, linestyle="--", label=f"theta={theta:.2f}")

        self.ax.set_ylim(0, 1)
        self.ax.set_xlim(0, 240)
        self.ax.set_xlabel("seconds into last-4min window (0..239)")
        self.ax.set_ylabel("probability")
        self.ax.legend(loc="upper left")
        self.fig.canvas.draw()
        self.fig.canvas.flush_events()

    def reset_hour(self, title: str):
        self.ts.clear()
        self.pups.clear()
        self.pbads.clear()
        self.line_p.set_data([], [])
        self.line_b.set_data([], [])
        self.ax.set_title(title)
        self.fig.canvas.draw()
        self.fig.canvas.flush_events()

    def update(self, idx: int, p_up: float, pbad: float, title: str):
        self.ts.append(idx)
        self.pups.append(p_up)
        self.pbads.append(pbad)
        self.line_p.set_data(self.ts, self.pups)
        self.line_b.set_data(self.ts, self.pbads)
        self.ax.set_title(title)
        self.fig.canvas.draw_idle()
        self.fig.canvas.flush_events()

async def live_signal(
    theta: float = 0.5,
    online_update: bool = False,
    update_lr: float = 0.01,
    update_l2: float = 1e-4,
    update_epochs: int = 1,
    save_live_snapshots: bool = False,
    backfill_missing: bool = True,
):
    model = load_prob_model()
    print("[SIGNAL] loaded prob model:", MODEL_PATH)
    if online_update:
        print(f"[SIGNAL] online_update=Y lr={update_lr} l2={update_l2} epochs={update_epochs}")

    last_updated_hour_ms = None
    state = load_live_state()
    if online_update:
        last_updated_hour_ms = state.get("last_updated_hour_ms")
        if last_updated_hour_ms is None and state.get("last_t_ms") is not None:
            last_t_ms = int(state["last_t_ms"])
            last_updated_hour_ms = floor_to_hour_ms(last_t_ms) - 3_600_000
            print(f"[SIGNAL] inferred last_updated_hour_ms={last_updated_hour_ms} from last_t_ms")
        if backfill_missing:
            backfill_end = floor_to_hour_ms(now_ms()) - 3_600_000
            if last_updated_hour_ms is not None and backfill_end >= (last_updated_hour_ms + 3_600_000):
                model, last_updated_hour_ms = backfill_missing_hours(
                    model,
                    last_updated_hour_ms,
                    backfill_end,
                    update_lr=update_lr,
                    update_l2=update_l2,
                    update_epochs=update_epochs,
                    save_live_snapshots=save_live_snapshots,
                )

    url = "wss://stream.binance.com:9443/stream?streams=btcusdt@kline_1s/btcusdt@kline_1h"

    o1h_by_hour: Dict[int, float] = {}
    cur_hour = None
    O_1h = None
    cum_vol = 0.0
    last_60_closes = deque(maxlen=61)
    window_buffer: List[dict] = []
    o4m = None

    plot = LivePlot(theta=theta)
    plot.reset_hour("Waiting for last-4min window...")

    last_log_ms = 0
    last_hb = time.time()

    async with websockets.connect(url, ping_interval=20, ping_timeout=60, max_queue=5000) as ws:
        print("[SIGNAL] connected:", url)

        while True:
            msg = await ws.recv()
            payload = json.loads(msg)
            data = payload.get("data", payload)
            if data.get("e") != "kline":
                continue

            k = data.get("k", {})
            interval = k.get("i")
            t_ms = int(k.get("t"))
            hour_open = floor_to_hour_ms(t_ms)

            if interval == "1h":
                o1h_by_hour[hour_open] = float(k.get("o"))
                if cur_hour == hour_open:
                    O_1h = o1h_by_hour[hour_open]
                continue

            if interval != "1s":
                continue

            if cur_hour is None or hour_open != cur_hour:
                if cur_hour is not None:
                    prev_hour = cur_hour
                    prev_o1h = o1h_by_hour.get(prev_hour, O_1h)
                    if online_update or save_live_snapshots:
                        df_hour = build_snapshot_df_from_live(prev_hour, prev_o1h, window_buffer)
                        if df_hour is not None:
                            if save_live_snapshots:
                                out_path = save_live_snapshot(df_hour, prev_hour)
                                print(f"[SIGNAL][SNAP] saved {out_path}")
                            if online_update:
                                model, loss = online_update_logit(
                                    model,
                                    df_hour,
                                    lr=update_lr,
                                    l2=update_l2,
                                    epochs=update_epochs,
                                )
                                MODEL_PATH.write_text(json.dumps(model, ensure_ascii=False, indent=2))
                                label = 1 if float(df_hour.iloc[-1]["P_t"]) > float(df_hour.iloc[-1]["O_1h"]) else 0
                                print(f"[SIGNAL][UPD] hour_open_ms={prev_hour} label={label} rows={len(df_hour)} loss={loss:.6f}")
                                last_updated_hour_ms = prev_hour
                                save_live_state(last_updated_hour_ms=last_updated_hour_ms)
                        else:
                            print(f"[SIGNAL][UPD] skip hour_open_ms={prev_hour} (missing O1h or rows)")

                cur_hour = hour_open
                O_1h = o1h_by_hour.get(cur_hour)
                cum_vol = 0.0
                last_60_closes.clear()
                window_buffer = []
                o4m = None

                hour_end = cur_hour + 3_600_000
                window_start = hour_end - 240_000
                plot.reset_hour(f"New hour started. Next window starts at {ms_to_local_str(window_start)}")
                print(f"[SIGNAL] new hour started hour_open_ms={cur_hour} "
                      f"next_window_start_local={ms_to_local_str(window_start)} "
                      f"hour_end_local={ms_to_local_str(hour_end)}")

            hour_end = cur_hour + 3_600_000
            window_start = hour_end - 240_000  # last 4 minutes start

            # heartbeat: 60초마다 "왜 조용한지"를 알려준다
            if time.time() - last_hb >= HEARTBEAT_SEC:
                offset_sec = (t_ms - cur_hour) // 1000
                until_window = max(0, (window_start - t_ms) // 1000)
                print(f"[SIGNAL][HB] now_local={ms_to_local_str(t_ms)} "
                      f"hour_open_local={ms_to_local_str(cur_hour)} "
                      f"offset={offset_sec}s "
                      f"O1h={'Y' if O_1h is not None else 'N'} "
                      f"until_window={until_window}s "
                      f"next_window_start_local={ms_to_local_str(window_start)}")
                last_hb = time.time()

            o = float(k.get("o"))
            c = float(k.get("c"))
            v = float(k.get("v"))

            cum_vol += v
            last_60_closes.append(c)

            if len(last_60_closes) >= 61:
                prev = last_60_closes[0]
                mom = math.log(c / (prev + 1e-12))
            else:
                mom = 0.0

            eps = 0.0002
            regime = 1 if mom > eps else (-1 if mom < -eps else 0)

            # only last 4 minutes
            if t_ms < window_start:
                continue

            if o4m is None:
                o4m = o
            window_buffer.append({
                "t_ms": t_ms,
                "P_t": c,
                "cum_vol_1h": cum_vol,
                "mom_logret_60s": mom,
                "regime": regime,
                "O_4m": o4m,
            })
            if len(window_buffer) > 240:
                window_buffer = window_buffer[-240:]

            if O_1h is None:
                continue

            offset_ms = t_ms - cur_hour
            tau_sec = int((3_600_000 - offset_ms) / 1000)
            if tau_sec < 1 or tau_sec > 240:
                continue

            delta_pct = (c / (O_1h + 1e-12) - 1.0) * 100.0

            p_up = prob_predict(
                model=model,
                delta_pct=delta_pct,
                cum_vol_1h=cum_vol,
                mom=mom,
                regime=regime,
                tau_sec=tau_sec
            )

            pbad, sgn = compute_pbad(p_up, P_t=c, O_1h=O_1h)
            exit_now = (pbad > theta)

            if t_ms - last_log_ms >= 1000:
                last_log_ms = t_ms
                print(
                    f"[SIGNAL] tau={tau_sec:3d}s "
                    f"P={c:.2f} O1h={O_1h:.2f} sign={'+' if sgn==1 else '-'} "
                    f"p_up={p_up*100:6.2f}% Pbad={pbad*100:6.2f}% "
                    f"{'EXIT' if exit_now else 'HOLD'}"
                )

            idx = 240 - tau_sec
            title = f"tau={tau_sec}s | p_up={p_up:.3f} | Pbad={pbad:.3f} | {'EXIT' if exit_now else 'HOLD'}"
            plot.update(idx, p_up, pbad, title)

            save_live_state(t_ms)


# --------------------------
# BACKTEST: probability model + stopper policy
# --------------------------

def backtest_signal(
    snapshots_path: Path,
    theta: float = 0.5,
    fee_bps: float = 0.0,
    max_hours: Optional[int] = None,
    plot: bool = True
):
    """
    Backtest policy on historical snapshots:
      - for each hour block (240 rows)
      - enter at tau=240 with position sign = sign(P-O1h) (user rule)
      - step forward each second:
          compute p_up via model, pbad
          if pbad > theta => exit immediately at that second
      - else hold to tau=1 (close)
    Metrics:
      - avg holding seconds, exit rate, directional accuracy at exit, simple pnl
    """
    model = load_prob_model()
    df = pd.read_parquet(snapshots_path)

    # only complete hours
    counts = df.groupby("hour_open_ms").size()
    hours = counts[counts == 240].index.to_list()
    hours = sorted(hours)
    if max_hours is not None:
        hours = hours[:max_hours]

    fees = fee_bps / 10000.0

    holding_secs = []
    exits = 0
    wins = 0
    pnls = []
    eq = []

    equity = 0.0

    for h in tqdm(hours, desc="backtest hours"):
        b = df[df["hour_open_ms"] == h].sort_values("t_ms").reset_index(drop=True)

        # entry at tau=240 => index 0
        entry_row = b.iloc[0]
        O1h = float(entry_row["O_1h"])
        entry_p = float(entry_row["P_t"])
        pos = 1 if (entry_p - O1h) >= 0 else -1  # user rule

        exit_idx = None
        exit_p = None

        # simulate through 240..1 (i=0..239)
        for i in range(len(b)):
            r = b.iloc[i]
            tau = int(r["tau_sec"])
            P = float(r["P_t"])
            cumv = float(r["cum_vol_1h"])
            mom = float(r["mom_logret_60s"])
            reg = int(r["regime"])

            delta_pct = (P / (O1h + 1e-12) - 1.0) * 100.0
            p_up = prob_predict(model, delta_pct, cumv, mom, reg, tau)
            pbad, _ = compute_pbad(p_up, P_t=P, O_1h=O1h)

            if pbad > theta:
                exit_idx = i
                exit_p = P
                break

        if exit_idx is None:
            # close at last row (tau=1)
            exit_idx = len(b) - 1
            exit_p = float(b.iloc[-1]["P_t"])
        else:
            exits += 1

        # holding seconds: idx 0 => tau=240. exit_idx i means held i seconds + 1 tick
        held = exit_idx + 1
        holding_secs.append(held)

        # win definition vs final outcome (C>O)
        close_p = float(b.iloc[-1]["P_t"])
        outcome_up = 1 if (close_p > O1h) else 0
        pred_up = 1 if pos == 1 else 0
        if pred_up == outcome_up:
            wins += 1

        # simple pnl (price diff) with pos; exit at exit_p (policy realized), fee applied on entry+exit
        fee_cost = fees * abs(entry_p) + fees * abs(exit_p)
        pnl = pos * (exit_p - entry_p) - fee_cost
        pnls.append(pnl)
        equity += pnl
        eq.append(equity)

    n = len(hours)
    exit_rate = exits / n if n else 0.0
    win_rate = wins / n if n else 0.0
    avg_hold = float(np.mean(holding_secs)) if holding_secs else 0.0
    avg_pnl = float(np.mean(pnls)) if pnls else 0.0

    print("\n[BACKTEST RESULT]")
    print(f"hours={n:,}")
    print(f"theta={theta:.3f} fee_bps={fee_bps:.2f}")
    print(f"exit_rate={exit_rate*100:.2f}%")
    print(f"avg_holding_sec={avg_hold:.2f}")
    print(f"win_rate(vs close sign)={win_rate*100:.2f}%")
    print(f"avg_pnl(price units)={avg_pnl:.6f}")
    print(f"total_pnl(price units)={equity:.6f}")

    if plot and n > 0:
        plt.figure()
        plt.hist(holding_secs, bins=30)
        plt.title("Holding seconds distribution")
        plt.xlabel("seconds held")
        plt.ylabel("count")
        plt.show()

        plt.figure()
        plt.plot(eq)
        plt.title("Equity curve (cumulative PnL in price units)")
        plt.xlabel("hour index")
        plt.ylabel("cumulative pnl")
        plt.show()


# --------------------------
# BACKTEST: prediction market exit policy (1m)
# --------------------------

def backtest_prediction_market_models(
    snapshots_path: Path,
    model_paths: Optional[List[Path]] = None,
    step_sec: int = 1,
    max_hours: Optional[int] = None,
    out_csv: Optional[Path] = None,
):
    """
    Prediction-market style backtest:
      - enter once per hour at start of last-4min window (tau=240)
      - enter only if p_up >= 0.95 (YES) or <= 0.05 (NO); otherwise skip
      - evaluate p_up at each step inside last-4min window (default: every 1s)
      - exit if p_up crosses the stop threshold on the same side
    Thresholds (default):
      - 50%
      - 60/40
      - 70/30
      - 80/20
    """
    if step_sec <= 0 or (240 % step_sec) != 0:
        raise ValueError("step_sec must be a positive divisor of 240.")

    thresholds = [
        ("50", 0.50, 0.50),
        ("60/40", 0.40, 0.60),
        ("70/30", 0.30, 0.70),
        ("80/20", 0.20, 0.80),
    ]

    if model_paths is None or not model_paths:
        candidates = [
            OUT_DIR / "prob_model_logit_all.json",
            OUT_DIR / "prob_model_logit_last5y.json",
            OUT_DIR / "prob_model_logit_last3y.json",
            OUT_DIR / "prob_model_logit_last1y.json",
        ]
        model_paths = [p for p in candidates if p.exists()]
        if not model_paths:
            raise RuntimeError("No model files found. Provide --models or train models first.")

    models: Dict[str, dict] = {}
    for p in model_paths:
        name = p.stem
        if name.startswith("prob_model_logit_"):
            name = name[len("prob_model_logit_"):]
        models[name] = load_prob_model_from_path(p)

    cols = [
        "hour_open_ms",
        "t_ms",
        "tau_sec",
        "O_1h",
        "P_t",
        "cum_vol_1h",
        "mom_logret_60s",
        "regime",
        "delta_pct",
    ]
    df = pd.read_parquet(snapshots_path, columns=cols)

    counts = df.groupby("hour_open_ms").size()
    hours = sorted(counts[counts == 240].index.to_list())
    if max_hours is not None:
        hours = hours[:max_hours]
    df = df[df["hour_open_ms"].isin(hours)].copy()
    df = df.sort_values(["hour_open_ms", "t_ms"]).reset_index(drop=True)

    step_count = 240 // step_sec
    step_indices = [(i + 1) * step_sec - 1 for i in range(step_count)]

    stats: Dict[str, Dict[str, dict]] = {}
    for model_name in models.keys():
        stats[model_name] = {}
        for label, _, _ in thresholds:
            stats[model_name][label] = {
                "bets": 0,
                "exits": 0,
                "wins": 0,
                "exit_second_sum": 0,
            }

    for _, b in tqdm(df.groupby("hour_open_ms", sort=False), desc="pm backtest hours"):
        if len(b) != 240:
            continue
        b = b.reset_index(drop=True)

        entry = b.iloc[0]
        close_row = b.iloc[-1]
        outcome_up = 1 if float(close_row["P_t"]) > float(close_row["O_1h"]) else 0

        step_rows = [b.iloc[i] for i in step_indices]

        for model_name, model in models.items():
            entry_p = prob_predict(
                model=model,
                delta_pct=float(entry["delta_pct"]),
                cum_vol_1h=float(entry["cum_vol_1h"]),
                mom=float(entry["mom_logret_60s"]),
                regime=int(entry["regime"]),
                tau_sec=int(entry["tau_sec"]),
            )
            if entry_p >= 0.95:
                bet_up = True
            elif entry_p <= 0.05:
                bet_up = False
            else:
                continue

            step_ps = []
            for r in step_rows:
                p = prob_predict(
                    model=model,
                    delta_pct=float(r["delta_pct"]),
                    cum_vol_1h=float(r["cum_vol_1h"]),
                    mom=float(r["mom_logret_60s"]),
                    regime=int(r["regime"]),
                    tau_sec=int(r["tau_sec"]),
                )
                step_ps.append(p)

            for label, low, high in thresholds:
                s = stats[model_name][label]
                s["bets"] += 1
                if (1 if bet_up else 0) == outcome_up:
                    s["wins"] += 1

                exit_step = None
                if bet_up:
                    for i, p in enumerate(step_ps):
                        if p < high:
                            exit_step = i
                            break
                else:
                    for i, p in enumerate(step_ps):
                        if p > low:
                            exit_step = i
                            break

                if exit_step is not None:
                    s["exits"] += 1
                    s["exit_second_sum"] += (exit_step + 1) * step_sec

    rows = []
    for model_name, by_thresh in stats.items():
        for label, s in by_thresh.items():
            bets = s["bets"]
            exits = s["exits"]
            wins = s["wins"]
            exit_rate = (exits / bets) if bets else 0.0
            win_rate = (wins / bets) if bets else 0.0
            avg_exit_sec = (s["exit_second_sum"] / exits) if exits else 0.0
            rows.append({
                "model": model_name,
                "threshold": label,
                "bets": bets,
                "exits": exits,
                "exit_rate": exit_rate,
                "win_rate": win_rate,
                "avg_exit_second": avg_exit_sec,
            })

    out_df = pd.DataFrame(rows).sort_values(["model", "threshold"]).reset_index(drop=True)
    print(out_df.to_string(index=False))
    if out_csv is not None:
        ensure_dir(out_csv.parent)
        out_df.to_csv(out_csv, index=False)
        print(f"[OK] saved: {out_csv}")


# --------------------------
# CLI
# --------------------------

def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    ap_dl = sub.add_parser("download_klines")
    ap_dl.add_argument("--start-date", required=True)
    ap_dl.add_argument("--end-date", required=True)
    ap_dl.add_argument("--intervals", nargs="*", default=["1h", "1s"])

    ap_bs = sub.add_parser("build_snapshots")
    ap_bs.add_argument("--start-date", required=True)
    ap_bs.add_argument("--end-date", required=True)
    ap_bs.add_argument("--interval", choices=["1s", "1m"], default="1s")
    ap_bs.add_argument("--last-window-sec", type=int, default=None)
    ap_bs.add_argument("--momentum-sec", type=int, default=60)
    ap_bs.add_argument("--out", default=None)

    ap_pm = sub.add_parser("train_prob_model")
    ap_pm.add_argument("--snapshots", default=str(OUT_DIR / "snapshots.parquet"))
    ap_pm.add_argument("--epochs", type=int, default=2)
    ap_pm.add_argument("--lr", type=float, default=0.05)
    ap_pm.add_argument("--l2", type=float, default=1e-4)
    ap_pm.add_argument("--sample-rows", type=int, default=600_000)
    ap_pm.add_argument("--model-path", default=None)
    ap_pm.add_argument("--tau-norm-div", type=float, default=None)

    ap_pm_multi = sub.add_parser("train_prob_model_multi")
    ap_pm_multi.add_argument("--snapshots", default=str(OUT_DIR / "snapshots.parquet"))
    ap_pm_multi.add_argument("--epochs", type=int, default=2)
    ap_pm_multi.add_argument("--lr", type=float, default=0.05)
    ap_pm_multi.add_argument("--l2", type=float, default=1e-4)
    ap_pm_multi.add_argument("--sample-rows", type=int, default=None)
    ap_pm_multi.add_argument("--years", type=int, nargs="*", default=[5, 3, 1])
    ap_pm_multi.add_argument("--out-dir", default=str(OUT_DIR))
    ap_pm_multi.add_argument("--out-prefix", default="prob_model_logit")
    ap_pm_multi.add_argument("--tau-norm-div", type=float, default=None)

    ap_sig = sub.add_parser("live_signal")
    ap_sig.add_argument("--theta", type=float, default=0.5)
    ap_sig.add_argument("--online-update", action="store_true")
    ap_sig.add_argument("--update-lr", type=float, default=0.01)
    ap_sig.add_argument("--update-l2", type=float, default=1e-4)
    ap_sig.add_argument("--update-epochs", type=int, default=1)
    ap_sig.add_argument("--save-live-snapshots", action="store_true")
    ap_sig.add_argument("--no-backfill-missing", action="store_true")

    ap_bt = sub.add_parser("backtest_signal")
    ap_bt.add_argument("--snapshots", default=str(OUT_DIR / "snapshots.parquet"))
    ap_bt.add_argument("--theta", type=float, default=0.5)
    ap_bt.add_argument("--fee-bps", type=float, default=0.0)
    ap_bt.add_argument("--max-hours", type=int, default=None)
    ap_bt.add_argument("--no-plot", action="store_true")

    ap_pm_bt = sub.add_parser("backtest_prediction_market")
    ap_pm_bt.add_argument("--snapshots", default=str(OUT_DIR / "snapshots.parquet"))
    ap_pm_bt.add_argument("--models", nargs="*", default=None)
    ap_pm_bt.add_argument("--step-sec", "--minute-step", dest="step_sec", type=int, default=1)
    ap_pm_bt.add_argument("--max-hours", type=int, default=None)
    ap_pm_bt.add_argument("--out-csv", default=None)

    args = ap.parse_args()

    if args.cmd == "download_klines":
        s = parse_date(args.start_date)
        e = parse_date(args.end_date)
        intervals = args.intervals or []
        for interval in intervals:
            if interval not in INTERVAL_SEC:
                raise ValueError(f"Unsupported interval: {interval}")
            print(f"[DL] {interval} klines...")
            download_daily_klines(SYMBOL, interval, s, e)
        print("[OK] download done.")

    elif args.cmd == "build_snapshots":
        s = parse_date(args.start_date)
        e = parse_date(args.end_date)
        interval = args.interval
        if interval not in INTERVAL_SEC or interval == "1h":
            raise ValueError(f"Unsupported interval for snapshots: {interval}")
        interval_sec = INTERVAL_SEC[interval]
        if args.last_window_sec is None:
            last_window_sec = 240 if interval == "1s" else 1800
        else:
            last_window_sec = args.last_window_sec
        momentum_sec = args.momentum_sec
        out_path = Path(args.out) if args.out else None

        start_ms = int(dt.datetime(s.year, s.month, s.day, tzinfo=dt.timezone.utc).timestamp() * 1000)
        end_ms = int(dt.datetime(e.year, e.month, e.day, tzinfo=dt.timezone.utc).timestamp() * 1000)

        zip_1h_dir = DATA_DIR / "spot" / "daily" / "klines" / SYMBOL / "1h"
        zip_interval_dir = DATA_DIR / "spot" / "daily" / "klines" / SYMBOL / interval
        zip_paths_1h = sorted(zip_1h_dir.glob("*.zip"))
        zip_paths_interval = sorted(zip_interval_dir.glob("*.zip"))

        if not zip_paths_1h or not zip_paths_interval:
            raise RuntimeError("Missing klines files. Run download_klines first.")

        print(f"[BUILD] O_1h map from {len(zip_paths_1h)} files ...")
        o1h_map = build_O1h_map_from_1h_klines(zip_paths_1h, start_ms, end_ms)
        print(f"[BUILD] O_1h hours = {len(o1h_map):,}")

        print(f"[BUILD] snapshots from {interval} klines ({len(zip_paths_interval)} files) ...")
        build_snapshots_historical(
            zip_paths_interval,
            o1h_map,
            start_ms,
            end_ms,
            last_window_sec=last_window_sec,
            momentum_sec=momentum_sec,
            interval_sec=interval_sec,
            out_path=out_path,
        )

    elif args.cmd == "train_prob_model":
        model_path = Path(args.model_path) if args.model_path else None
        train_logit_sgd(
            snapshots_path=Path(args.snapshots),
            epochs=args.epochs,
            lr=args.lr,
            l2=args.l2,
            sample_rows=args.sample_rows,
            model_path=model_path,
            tau_norm_div=args.tau_norm_div,
        )

    elif args.cmd == "train_prob_model_multi":
        train_logit_sgd_multi_windows(
            snapshots_path=Path(args.snapshots),
            years=args.years,
            out_dir=Path(args.out_dir),
            out_prefix=args.out_prefix,
            epochs=args.epochs,
            lr=args.lr,
            l2=args.l2,
            sample_rows=args.sample_rows,
            tau_norm_div=args.tau_norm_div,
        )

    elif args.cmd == "live_signal":
        asyncio.run(live_signal(
            theta=args.theta,
            online_update=args.online_update,
            update_lr=args.update_lr,
            update_l2=args.update_l2,
            update_epochs=args.update_epochs,
            save_live_snapshots=args.save_live_snapshots,
            backfill_missing=(not args.no_backfill_missing),
        ))

    elif args.cmd == "backtest_signal":
        backtest_signal(
            snapshots_path=Path(args.snapshots),
            theta=args.theta,
            fee_bps=args.fee_bps,
            max_hours=args.max_hours,
            plot=(not args.no_plot),
        )

    elif args.cmd == "backtest_prediction_market":
        model_paths = [Path(p) for p in args.models] if args.models else None
        out_csv = Path(args.out_csv) if args.out_csv else None
        backtest_prediction_market_models(
            snapshots_path=Path(args.snapshots),
            model_paths=model_paths,
            step_sec=args.step_sec,
            max_hours=args.max_hours,
            out_csv=out_csv,
        )

    else:
        raise ValueError("Unknown cmd")


if __name__ == "__main__":
    main()
