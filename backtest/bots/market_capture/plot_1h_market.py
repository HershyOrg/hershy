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


def _load_meta(out_dir: Path, slug: str) -> dict:
    meta_path = out_dir / f"{slug}_meta.json"
    if not meta_path.exists():
        raise FileNotFoundError(f"meta not found: {meta_path}")
    return json.loads(meta_path.read_text())


def _load_parquet(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"parquet not found: {path}")
    return pd.read_parquet(path)


def _plot(
    polymarket_df: pd.DataFrame,
    binance_df: pd.DataFrame,
    kline_df: pd.DataFrame,
    meta: dict,
) -> None:
    import matplotlib.pyplot as plt
    import matplotlib.ticker as mtick

    start_ms = int(meta["start_ms"])
    yes_id = meta["yes_token_id"]
    no_id = meta["no_token_id"]

    if not polymarket_df.empty:
        polymarket_df = polymarket_df.sort_values("ts_ms").copy()
        polymarket_df["t_sec"] = (polymarket_df["ts_ms"] - start_ms) / 1000.0
        polymarket_df["mid"] = (polymarket_df["best_bid"] + polymarket_df["best_ask"]) / 2.0

    if not binance_df.empty:
        binance_df = binance_df.sort_values("ts_ms").copy()
        binance_df["t_sec"] = (binance_df["ts_ms"] - start_ms) / 1000.0
        binance_df["mid"] = (binance_df["bid"] + binance_df["ask"]) / 2.0
    if not kline_df.empty:
        kline_df = kline_df.sort_values("open_ms").copy()
        kline_df["t_sec"] = (kline_df["open_ms"] - start_ms) / 1000.0
        kline_df["width_sec"] = (kline_df["close_ms"] - kline_df["open_ms"]) / 1000.0

    fig, axes = plt.subplots(2, 1, figsize=(12, 8), sharex=True)
    ax_pm, ax_bn = axes

    if not polymarket_df.empty:
        yes = polymarket_df[polymarket_df["token_id"] == yes_id]
        no = polymarket_df[polymarket_df["token_id"] == no_id]

        ax_pm.plot(yes["t_sec"], yes["best_bid"], label="YES bid", color="#1f77b4")
        ax_pm.plot(yes["t_sec"], yes["best_ask"], label="YES ask", color="#ff7f0e")
        ax_pm.plot(no["t_sec"], no["best_bid"], label="NO bid", color="#2ca02c")
        ax_pm.plot(no["t_sec"], no["best_ask"], label="NO ask", color="#d62728")
    ax_pm.set_title(f"Polymarket 1h orderbook: {meta['slug']}")
    ax_pm.set_ylabel("price")
    ax_pm.grid(True, alpha=0.2)
    ax_pm.legend(loc="upper left")

    ax_vol = None
    if not binance_df.empty:
        ax_bn.plot(binance_df["t_sec"], binance_df["mid"], label="Binance mid", color="#111827")
        open_price = float(binance_df.iloc[0]["mid"])
        ax_bn.axhline(open_price, linestyle="--", color="#6b7280", label="1h open")
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
    ax_bn.set_xlabel("mm:ss since 1h start")
    ax_bn.set_ylabel("price")
    ax_bn.grid(True, alpha=0.2)
    handles, labels = ax_bn.get_legend_handles_labels()
    if ax_vol is not None:
        h2, l2 = ax_vol.get_legend_handles_labels()
        handles += h2
        labels += l2
    ax_bn.legend(handles, labels, loc="upper left")

    fig.tight_layout()
    plt.show()


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", required=True, help="Polymarket 1h slug")
    ap.add_argument("--out-dir", default="src/out/market_1h")
    return ap.parse_args()


def main() -> None:
    args = parse_args()
    out_dir = Path(args.out_dir)
    slug = args.slug
    meta = _load_meta(out_dir, slug)
    pm_path = out_dir / f"{slug}_polymarket.parquet"
    bn_path = out_dir / f"{slug}_binance.parquet"
    kline_path = out_dir / f"{slug}_binance_klines.parquet"

    pm_df = _load_parquet(pm_path)
    bn_df = _load_parquet(bn_path)
    kline_df = pd.DataFrame()
    if kline_path.exists():
        kline_df = _load_parquet(kline_path)
    _plot(pm_df, bn_df, kline_df, meta)


if __name__ == "__main__":
    main()
