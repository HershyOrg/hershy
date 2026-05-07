#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path

import pandas as pd

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
LIBS_DIR = REPO_ROOT / "libs"
if str(LIBS_DIR) not in sys.path:
    sys.path.insert(0, str(LIBS_DIR))


def _load_meta(meta_path: Path) -> dict:
    return json.loads(meta_path.read_text())


def _load_parquet(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"parquet not found: {path}")
    return pd.read_parquet(path)


def _plot_one(
    pm_df: pd.DataFrame,
    bn_df: pd.DataFrame,
    kline_df: pd.DataFrame,
    meta: dict,
    title_prefix: str,
) -> None:
    import matplotlib.pyplot as plt
    import matplotlib.ticker as mtick

    start_ms = int(meta["start_ms"])
    yes_id = meta["yes_token_id"]
    no_id = meta["no_token_id"]

    if not pm_df.empty:
        pm_df = pm_df.sort_values("ts_ms").copy()
        pm_df["t_sec"] = (pm_df["ts_ms"] - start_ms) / 1000.0
        pm_df["mid"] = (pm_df["best_bid"] + pm_df["best_ask"]) / 2.0

    if not bn_df.empty:
        bn_df = bn_df.sort_values("ts_ms").copy()
        bn_df["t_sec"] = (bn_df["ts_ms"] - start_ms) / 1000.0
        bn_df["mid"] = (bn_df["bid"] + bn_df["ask"]) / 2.0
    if not kline_df.empty:
        kline_df = kline_df.sort_values("open_ms").copy()
        kline_df["t_sec"] = (kline_df["open_ms"] - start_ms) / 1000.0
        kline_df["width_sec"] = (kline_df["close_ms"] - kline_df["open_ms"]) / 1000.0

    fig, axes = plt.subplots(2, 1, figsize=(12, 8), sharex=True)
    ax_pm, ax_bn = axes

    if not pm_df.empty:
        yes = pm_df[pm_df["token_id"] == yes_id]
        no = pm_df[pm_df["token_id"] == no_id]

        ax_pm.plot(yes["t_sec"], yes["best_bid"], label="YES bid", color="#1f77b4")
        ax_pm.plot(yes["t_sec"], yes["best_ask"], label="YES ask", color="#ff7f0e")
        ax_pm.plot(no["t_sec"], no["best_bid"], label="NO bid", color="#2ca02c")
        ax_pm.plot(no["t_sec"], no["best_ask"], label="NO ask", color="#d62728")
    ax_pm.set_title(f"{title_prefix} Polymarket orderbook: {meta['slug']}")
    ax_pm.set_ylabel("price")
    ax_pm.grid(True, alpha=0.2)
    ax_pm.legend(loc="upper left")

    ax_vol = None
    if not bn_df.empty:
        ax_bn.plot(bn_df["t_sec"], bn_df["mid"], label="Binance mid", color="#111827")
        open_price = float(bn_df.iloc[0]["mid"])
        ax_bn.axhline(open_price, linestyle="--", color="#6b7280", label="open")
    if not kline_df.empty:
        ax_vol = ax_bn.twinx()
        width = float(kline_df["width_sec"].median()) if "width_sec" in kline_df else 60.0
        ax_vol.bar(
            kline_df["t_sec"],
            kline_df["volume"],
            width=width * 0.8,
            alpha=0.25,
            color="#9ca3af",
            label="Volume",
            align="edge",
        )
        ax_vol.set_ylabel("volume")
    ax_bn.set_title("Binance price ticks")

    def _format_mmss(x, _pos):
        if x is None:
            return ""
        total = int(max(0, x))
        minutes = total // 60
        seconds = total % 60
        return f"{minutes:02d}:{seconds:02d}"

    formatter = mtick.FuncFormatter(_format_mmss)
    ax_pm.xaxis.set_major_formatter(formatter)
    ax_bn.xaxis.set_major_formatter(formatter)
    ax_bn.set_xlabel("mm:ss since window start")
    ax_bn.set_ylabel("price")
    ax_bn.grid(True, alpha=0.2)
    handles, labels = ax_bn.get_legend_handles_labels()
    if ax_vol is not None:
        h2, l2 = ax_vol.get_legend_handles_labels()
        handles += h2
        labels += l2
    ax_bn.legend(handles, labels, loc="upper left")

    fig.tight_layout()


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True, help="Hour bundle directory")
    return ap.parse_args()


def main() -> None:
    args = parse_args()
    bundle_dir = Path(args.dir)
    if not bundle_dir.exists():
        raise FileNotFoundError(f"dir not found: {bundle_dir}")

    meta_paths = sorted(bundle_dir.glob("*_meta.json"))
    if not meta_paths:
        raise RuntimeError(f"No meta files found in {bundle_dir}")

    fifteen = []
    one_hour = []

    for meta_path in meta_paths:
        meta = _load_meta(meta_path)
        start_ms = int(meta["start_ms"])
        end_ms = int(meta["end_ms"])
        duration_ms = end_ms - start_ms
        prefix = meta_path.name[: -len("_meta.json")]
        record = {
            "meta": meta,
            "prefix": prefix,
            "duration_ms": duration_ms,
            "start_ms": start_ms,
        }
        if duration_ms >= 3_000_000:
            one_hour.append(record)
        else:
            fifteen.append(record)

    fifteen = sorted(fifteen, key=lambda r: r["start_ms"])
    one_hour = sorted(one_hour, key=lambda r: r["duration_ms"], reverse=True)

    if not one_hour:
        raise RuntimeError("No 1h meta found in bundle directory.")
    if len(fifteen) < 4:
        print(f"[WARN] expected 4x 15m metas, found {len(fifteen)}")

    selected_15m = fifteen[:4]
    selected_1h = one_hour[:1]

    for idx, rec in enumerate(selected_15m, start=1):
        prefix = rec["prefix"]
        meta = rec["meta"]
        pm_path = bundle_dir / f"{prefix}_polymarket.parquet"
        bn_path = bundle_dir / f"{prefix}_binance.parquet"
        kline_path = bundle_dir / f"{prefix}_binance_klines.parquet"
        pm_df = _load_parquet(pm_path)
        bn_df = _load_parquet(bn_path)
        kline_df = pd.DataFrame()
        if kline_path.exists():
            kline_df = _load_parquet(kline_path)
        _plot_one(pm_df, bn_df, kline_df, meta, title_prefix=f"15m #{idx} |")

    for rec in selected_1h:
        prefix = rec["prefix"]
        meta = rec["meta"]
        pm_path = bundle_dir / f"{prefix}_polymarket.parquet"
        bn_path = bundle_dir / f"{prefix}_binance.parquet"
        kline_path = bundle_dir / f"{prefix}_binance_klines.parquet"
        pm_df = _load_parquet(pm_path)
        bn_df = _load_parquet(bn_path)
        kline_df = pd.DataFrame()
        if kline_path.exists():
            kline_df = _load_parquet(kline_path)
        _plot_one(pm_df, bn_df, kline_df, meta, title_prefix="1h |")

    import matplotlib.pyplot as plt

    plt.show()


if __name__ == "__main__":
    main()
