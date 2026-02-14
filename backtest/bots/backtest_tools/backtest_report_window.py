#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import json
import math
from pathlib import Path
from typing import Optional, Tuple

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

from zoneinfo import ZoneInfo
import datetime as dt

OUT_DIR = Path("out")
SNAPSHOTS_DEFAULT = OUT_DIR / "snapshots.parquet"
MODEL_DEFAULT = OUT_DIR / "prob_model_logit.json"


def floor_to_hour_ms(ts_ms: int) -> int:
    return (ts_ms // 3_600_000) * 3_600_000

def sign(x: float) -> int:
    return 1 if x >= 0 else -1

def sigmoid_scalar(z: float) -> float:
    z = max(-50.0, min(50.0, z))
    return 1.0 / (1.0 + math.exp(-z))

def load_model(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"Model file not found: {path}")
    return json.loads(path.read_text())

def prob_predict(model: dict, delta_pct: float, cum_vol_1h: float, mom: float, regime: int, tau_sec: int) -> float:
    w = model["w"]
    mu = model["mu"]
    sd = model["sd"]

    x0 = delta_pct
    x1 = math.log1p(max(cum_vol_1h, 0.0))
    x2 = mom
    x3 = float(regime)
    x4 = float(tau_sec) / 240.0

    xs = [
        (x0 - mu[0]) / (sd[0] if sd[0] else 1.0),
        (x1 - mu[1]) / (sd[1] if sd[1] else 1.0),
        (x2 - mu[2]) / (sd[2] if sd[2] else 1.0),
        (x3 - mu[3]) / (sd[3] if sd[3] else 1.0),
        (x4 - mu[4]) / (sd[4] if sd[4] else 1.0),
    ]
    z = w[0] + sum(w[i + 1] * xs[i] for i in range(5))
    p = sigmoid_scalar(z)
    return max(0.0, min(1.0, p))

def compute_pbad(p_up: float, P_t: float, O_1h: float) -> Tuple[float, int]:
    sgn = 1 if (P_t - O_1h) >= 0 else -1
    # 포지션 방향 = sign(P - O) 기준이라고 했으니:
    # sgn=+1 이면 UP 포지션 -> 틀릴 확률=1-p_up
    # sgn=-1 이면 DOWN 포지션 -> 틀릴 확률=p_up
    pbad = (1.0 - p_up) if sgn == 1 else p_up
    return pbad, sgn

def parse_local_dt(s: str, tz_name: str) -> dt.datetime:
    """
    s: "YYYY-MM-DD HH:MM" or "YYYY-MM-DD HH:MM:SS"
    tz_name: e.g. "America/New_York"
    """
    tz = ZoneInfo(tz_name)
    fmt = "%Y-%m-%d %H:%M:%S" if len(s.strip().split(":")) == 3 else "%Y-%m-%d %H:%M"
    naive = dt.datetime.strptime(s, fmt)
    return naive.replace(tzinfo=tz)

def dt_to_utc_ms(x: dt.datetime) -> int:
    u = x.astimezone(dt.timezone.utc)
    return int(u.timestamp() * 1000)

def ms_to_local_str(ms: int, tz_name: str) -> str:
    tz = ZoneInfo(tz_name)
    return dt.datetime.fromtimestamp(ms / 1000, tz=dt.timezone.utc).astimezone(tz).strftime("%Y-%m-%d %H:%M:%S %Z")

def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)

def plot_hour_trace(
    out_png: Path,
    idxs: np.ndarray,
    p_up: np.ndarray,
    pbad: np.ndarray,
    theta: float,
    title: str,
    exit_idx: Optional[int],
):
    plt.figure()
    plt.plot(idxs, p_up, label="p_up = Pr(C>O)")
    plt.plot(idxs, pbad, label="Pbad (wrong prob)")
    plt.axhline(theta, linestyle="--", label=f"theta={theta:.2f}")
    if exit_idx is not None:
        plt.axvline(exit_idx, linestyle="--", label=f"EXIT@{exit_idx}s")
    plt.ylim(0, 1)
    plt.xlim(0, 239)
    plt.xlabel("seconds into last-4min window (0..239)")
    plt.ylabel("probability")
    plt.title(title)
    plt.legend(loc="upper left")
    plt.tight_layout()
    plt.savefig(out_png, dpi=140)
    plt.close()

def run_report(
    snapshots_path: Path,
    model_path: Path,
    start_local: str,
    end_local: str,
    tz_name: str,
    theta: float,
    plot: bool,
    max_hours: Optional[int],
):
    model = load_model(model_path)
    df = pd.read_parquet(snapshots_path)

    # 시간범위(ET 등) -> UTC ms 범위로 변환
    start_dt = parse_local_dt(start_local, tz_name)
    end_dt = parse_local_dt(end_local, tz_name)

    start_ms = dt_to_utc_ms(start_dt)
    end_ms = dt_to_utc_ms(end_dt)

    start_hour = floor_to_hour_ms(start_ms)
    end_hour = floor_to_hour_ms(end_ms)  # end는 exclusive로 처리 (end_hour 포함 X)

    # 해당 범위의 hour_open_ms만 선택
    df = df[(df["hour_open_ms"] >= start_hour) & (df["hour_open_ms"] < end_hour)].copy()
    if df.empty:
        raise RuntimeError("No rows in the requested time window. Check your timezone/range.")

    # 완전한 hour(240 rows)만 사용
    counts = df.groupby("hour_open_ms").size()
    hours = sorted(counts[counts == 240].index.tolist())
    if max_hours is not None:
        hours = hours[:max_hours]

    # 리포트 폴더
    safe_name = f"{start_dt.strftime('%Y%m%dT%H%M')}_{end_dt.strftime('%Y%m%dT%H%M')}_{tz_name.replace('/','-')}_theta{theta:.2f}"
    rep_dir = OUT_DIR / "reports" / safe_name
    ensure_dir(rep_dir)
    img_dir = rep_dir / "images"
    ensure_dir(img_dir)

    summary_rows = []
    total = len(hours)

    for h in hours:
        b = df[df["hour_open_ms"] == h].sort_values("t_ms").reset_index(drop=True)

        # entry at tau=240 => index 0
        entry = b.iloc[0]
        O1h = float(entry["O_1h"])
        entry_p = float(entry["P_t"])
        entry_sign = sign(entry_p - O1h)  # 네 규칙: 현재가-시가 부호로 방향

        # close (tau=1)
        close_p = float(b.iloc[-1]["P_t"])
        close_sign = sign(close_p - O1h)
        flipped = (entry_sign != close_sign)

        idxs = np.arange(240, dtype=int)  # 0..239
        pups = np.zeros(240, dtype=float)
        pbads = np.zeros(240, dtype=float)

        exit_i = None
        exit_tau = None
        exit_t_ms = None
        exit_price = None

        for i in range(240):
            r = b.iloc[i]
            tau = int(r["tau_sec"])
            P = float(r["P_t"])
            cumv = float(r["cum_vol_1h"])
            mom = float(r["mom_logret_60s"])
            reg = int(r["regime"])

            delta_pct = (P / (O1h + 1e-12) - 1.0) * 100.0
            p_up = prob_predict(model, delta_pct, cumv, mom, reg, tau)
            pbad, _ = compute_pbad(p_up, P_t=P, O_1h=O1h)

            pups[i] = p_up
            pbads[i] = pbad

            if exit_i is None and (pbad > theta):
                exit_i = i
                exit_tau = tau
                exit_t_ms = int(r["t_ms"])
                exit_price = float(P)

        exited = (exit_i is not None)
        hold_seconds = (exit_i + 1) if exited else 240

        hour_open_local = ms_to_local_str(int(h), tz_name)
        hour_end_local = ms_to_local_str(int(h + 3_600_000), tz_name)

        if plot:
            title = f"{hour_open_local} ~ {hour_end_local} | entrySign={'+' if entry_sign==1 else '-'} | flipped={flipped} | {'EXIT' if exited else 'HOLD'}"
            out_png = img_dir / f"hour_{int(h)}.png"
            plot_hour_trace(out_png, idxs, pups, pbads, theta, title, exit_i)

        summary_rows.append({
            "hour_open_ms": int(h),
            "hour_open_local": hour_open_local,
            "hour_end_local": hour_end_local,
            "O_1h": O1h,
            "entry_price(tau=240)": entry_p,
            "entry_sign": entry_sign,
            "close_price(tau=1)": close_p,
            "close_sign": close_sign,
            "flipped_at_close": bool(flipped),
            "exited_by_policy": bool(exited),
            "exit_second_index(0..239)": (int(exit_i) if exited else None),
            "exit_tau_sec": (int(exit_tau) if exited else None),
            "exit_time_local": (ms_to_local_str(exit_t_ms, tz_name) if exited else None),
            "exit_price": (float(exit_price) if exited else None),
            "hold_seconds": int(hold_seconds),
            "p_up_at_entry": float(pups[0]),
            "Pbad_at_entry": float(pbads[0]),
            "p_up_at_last": float(pups[-1]),
            "Pbad_at_last": float(pbads[-1]),
            "plot_path": (f"images/hour_{int(h)}.png" if plot else None),
        })

    summary = pd.DataFrame(summary_rows)
    summary_csv = rep_dir / "summary.csv"
    summary.to_csv(summary_csv, index=False)

    # 간단 통계
    exit_rate = float(summary["exited_by_policy"].mean()) if len(summary) else 0.0
    flip_rate = float(summary["flipped_at_close"].mean()) if len(summary) else 0.0
    avg_hold = float(summary["hold_seconds"].mean()) if len(summary) else 0.0

    # Markdown report
    report_md = rep_dir / "report.md"
    lines = []
    lines.append("# Backtest Report (Window)\n")
    lines.append(f"- symbol: BTCUSDT\n")
    lines.append(f"- timezone: {tz_name}\n")
    lines.append(f"- range: {start_local} ~ {end_local} ({tz_name})\n")
    lines.append(f"- theta: {theta}\n")
    lines.append(f"- hours analyzed: {total}\n")
    lines.append(f"- exited_by_policy rate: {exit_rate*100:.2f}%\n")
    lines.append(f"- flipped_at_close rate: {flip_rate*100:.2f}%\n")
    lines.append(f"- avg hold seconds: {avg_hold:.2f}\n")
    lines.append(f"- summary.csv: {summary_csv.name}\n")

    # 표는 너무 길 수 있으니 상위 몇 개만
    lines.append("\n## Samples (first 20 rows)\n")
    sample = summary.head(20).copy()
    # markdown table
    cols = [
        "hour_open_local","entry_sign","close_sign","flipped_at_close",
        "exited_by_policy","exit_tau_sec","hold_seconds","plot_path"
    ]
    lines.append("| " + " | ".join(cols) + " |\n")
    lines.append("|" + "|".join(["---"]*len(cols)) + "|\n")
    for _, r in sample.iterrows():
        row = [str(r.get(c, "")) for c in cols]
        lines.append("| " + " | ".join(row) + " |\n")

    if plot:
        lines.append("\n## Where to find plots\n")
        lines.append("- Per-hour traces saved under `images/`.\n")
        lines.append("- Each image contains p_up / Pbad / theta and EXIT marker.\n")

    report_md.write_text("".join(lines), encoding="utf-8")

    print("\n[REPORT DONE]")
    print("folder :", rep_dir)
    print("summary:", summary_csv)
    print("report :", report_md)
    if plot:
        print("images :", img_dir)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshots", default=str(SNAPSHOTS_DEFAULT))
    ap.add_argument("--model", default=str(MODEL_DEFAULT))

    ap.add_argument("--start", required=True, help='e.g. "2025-06-11 11:00"')
    ap.add_argument("--end", required=True, help='e.g. "2025-07-11 11:00"')

    ap.add_argument("--tz", default="America/New_York", help='default ET: America/New_York')
    ap.add_argument("--theta", type=float, default=0.5)
    ap.add_argument("--plot", action="store_true", help="save per-hour png plots")
    ap.add_argument("--max-hours", type=int, default=None)

    args = ap.parse_args()

    run_report(
        snapshots_path=Path(args.snapshots),
        model_path=Path(args.model),
        start_local=args.start,
        end_local=args.end,
        tz_name=args.tz,
        theta=args.theta,
        plot=args.plot,
        max_hours=args.max_hours,
    )

if __name__ == "__main__":
    main()