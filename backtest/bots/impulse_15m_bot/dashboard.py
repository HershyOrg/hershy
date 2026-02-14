import time
from pathlib import Path

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

ROOT = Path(__file__).resolve().parents[2]
BASE_DIR = ROOT / "src/out/impulse_15m_bot"

st.set_page_config(page_title="Impulse 15m Bot Monitor", layout="wide")


def _list_sessions(base_dir: Path) -> list[str]:
    if not base_dir.exists():
        return []
    return sorted([p.name for p in base_dir.iterdir() if p.is_dir()])


def _read_parquet(glob_dir: Path, prefix: str) -> pd.DataFrame:
    if not glob_dir.exists():
        return pd.DataFrame()
    paths = sorted(glob_dir.glob(f"{prefix}_*.parquet"))
    if not paths:
        return pd.DataFrame()
    frames = []
    for p in paths[-400:]:
        try:
            frames.append(pd.read_parquet(p))
        except Exception:
            continue
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def _pair_trades(fills: pd.DataFrame) -> pd.DataFrame:
    if fills.empty:
        return pd.DataFrame()
    fills = fills.sort_values("ts_ms")
    trades = []
    open_pos = None
    for _, row in fills.iterrows():
        if row.get("action") == "ENTER":
            open_pos = row
        elif row.get("action") == "EXIT" and open_pos is not None:
            trades.append(
                {
                    "entry_ts": open_pos["ts_ms"],
                    "exit_ts": row["ts_ms"],
                    "entry_price": open_pos["price"],
                    "exit_price": row["price"],
                    "dir": open_pos["dir"],
                    "reason": row.get("reason"),
                }
            )
            open_pos = None
    df = pd.DataFrame(trades)
    if df.empty:
        return df
    df["pnl_pts"] = (df["exit_price"] - df["entry_price"]) * df["dir"]
    df["cum_pnl_pts"] = df["pnl_pts"].cumsum()
    df["entry_ts"] = pd.to_datetime(df["entry_ts"], unit="ms", utc=True, errors="coerce")
    df["exit_ts"] = pd.to_datetime(df["exit_ts"], unit="ms", utc=True, errors="coerce")
    return df


st.sidebar.header("Source")
if not BASE_DIR.exists():
    st.error(f"Base dir not found: {BASE_DIR}")
    st.stop()

sessions = _list_sessions(BASE_DIR)
if not sessions:
    st.warning("No sessions found.")
    st.stop()

sel = st.sidebar.selectbox("Session", sessions, index=len(sessions) - 1)
auto_refresh = st.sidebar.checkbox("Auto refresh", value=True)
refresh_sec = st.sidebar.number_input("Refresh seconds", min_value=0.5, max_value=10.0, value=1.0, step=0.5)

session_dir = BASE_DIR / sel
signals = _read_parquet(session_dir, "signals")
fills = _read_parquet(session_dir, "paper_fills")
pm = _read_parquet(session_dir, "raw_pm_quotes")
chainlink = _read_parquet(session_dir, "raw_chainlink")

st.title("Impulse 15m Bot Monitor")

if not signals.empty:
    signals["ts"] = pd.to_datetime(signals["ts_ms"], unit="ms", utc=True, errors="coerce")
    st.subheader("Signals")
    cols = [c for c in ["price_delta_5s", "sweep_usd", "beta", "beta_conf", "spoof_score", "ptb", "time_to_end"] if c in signals.columns]
    if cols:
        for c in cols:
            signals[c] = pd.to_numeric(signals[c], errors="coerce")
        fig = px.line(signals, x="ts", y=cols)
        st.plotly_chart(fig, width="stretch")
    else:
        st.info("No signal columns found yet.")

if not pm.empty:
    pm["ts"] = pd.to_datetime(pm["ts_ms"], unit="ms", utc=True, errors="coerce")
    st.subheader("Polymarket chance")
    st.plotly_chart(px.line(pm, x="ts", y="chance"), width="stretch")

if not chainlink.empty:
    chainlink["ts"] = pd.to_datetime(chainlink["ts_ms"], unit="ms", utc=True, errors="coerce")
    st.subheader("Chainlink price")
    st.plotly_chart(px.line(chainlink, x="ts", y="price"), width="stretch")

exch_book = _read_parquet(session_dir, "raw_exch_book")
if not exch_book.empty:
    exch_book["ts"] = pd.to_datetime(exch_book["ts_ms"], unit="ms", utc=True, errors="coerce")
    st.subheader("Exchange mid + spread (orderbook)")
    def _best(bids, asks):
        try:
            b = json.loads(bids)[0][0]
            a = json.loads(asks)[0][0]
            return float(b), float(a)
        except Exception:
            return None, None
    best = exch_book.apply(lambda r: _best(r["bids"], r["asks"]), axis=1, result_type="expand")
    exch_book["best_bid"] = best[0]
    exch_book["best_ask"] = best[1]
    exch_book["mid"] = (exch_book["best_bid"] + exch_book["best_ask"]) / 2.0
    exch_book["spread"] = exch_book["best_ask"] - exch_book["best_bid"]
    fig_m = px.line(exch_book, x="ts", y="mid")
    fig_s = px.line(exch_book, x="ts", y="spread")
    st.plotly_chart(fig_m, width="stretch")
    st.plotly_chart(fig_s, width="stretch")

    st.subheader("Orderbook (latest snapshot)")
    latest = exch_book.sort_values("ts_ms").tail(1)
    if not latest.empty:
        row = latest.iloc[0]
        try:
            bids = json.loads(row["bids"])
            asks = json.loads(row["asks"])
        except Exception:
            bids, asks = [], []
        depth = min(10, len(bids), len(asks))
        bids = bids[:depth]
        asks = asks[:depth]
        bid_df = pd.DataFrame(bids, columns=["price", "size"])
        ask_df = pd.DataFrame(asks, columns=["price", "size"])
        col1, col2 = st.columns(2)
        with col1:
            st.caption("Bids (top)")
            st.dataframe(bid_df, width="stretch")
        with col2:
            st.caption("Asks (top)")
            st.dataframe(ask_df, width="stretch")
    else:
        st.info("No orderbook snapshots yet.")
else:
    st.subheader("Exchange mid + spread (orderbook)")
    st.info("No orderbook data found.")

exch_trades = _read_parquet(session_dir, "raw_exch_trades")
if not exch_trades.empty:
    exch_trades["ts"] = pd.to_datetime(exch_trades["ts_ms"], unit="ms", utc=True, errors="coerce")
    st.subheader("Exchange trade price")
    st.plotly_chart(px.line(exch_trades, x="ts", y="price"), width="stretch")

st.subheader("PnL (paper)")
trades = _pair_trades(fills)
if trades.empty:
    st.info("No completed trades yet.")
else:
    st.plotly_chart(px.line(trades, x="exit_ts", y="cum_pnl_pts"), width="stretch")
    st.dataframe(trades.tail(50), width="stretch")

st.subheader("Raw fills")
if fills.empty:
    st.info("No fills yet.")
else:
    st.dataframe(fills.sort_values("ts_ms").tail(200), width="stretch")

if auto_refresh:
    time.sleep(float(refresh_sec))
    st.rerun()
