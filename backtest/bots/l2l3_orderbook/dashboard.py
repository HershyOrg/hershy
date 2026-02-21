import json
import os
from pathlib import Path

import pandas as pd
import time

import plotly.express as px
import streamlit as st

ROOT = Path(__file__).resolve().parents[2]
BASE_DIR = ROOT / "src/out/l2l3_orderbook"

st.set_page_config(page_title="L2/L3 Orderbook Monitor", layout="wide")


def _list_sessions(base_dir: Path) -> list[str]:
    if not base_dir.exists():
        return []
    return sorted([p.name for p in base_dir.iterdir() if p.is_dir()])


def _latest_session_from_file(base_dir: Path) -> str | None:
    latest_path = base_dir / "LATEST"
    if latest_path.exists():
        try:
            return latest_path.read_text().strip()
        except Exception:
            return None
    return None


def _session_has_data(session_dir: Path) -> bool:
    if not session_dir.exists():
        return False
    return any(session_dir.glob("book_states_*.parquet"))


def _pick_default_session(base_dir: Path, sessions: list[str]) -> str:
    latest = _latest_session_from_file(base_dir)
    if latest and latest in sessions and _session_has_data(base_dir / latest):
        return latest
    for name in reversed(sessions):
        if _session_has_data(base_dir / name):
            return name
    return sessions[-1]


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


def _latest_parquet(glob_dir: Path, prefix: str) -> Path | None:
    if not glob_dir.exists():
        return None
    paths = list(glob_dir.glob(f"{prefix}_*.parquet"))
    if not paths:
        return None
    return max(paths, key=lambda p: p.stat().st_mtime)


def _best_levels(row) -> tuple[float | None, float | None]:
    try:
        bids = json.loads(row["bids"])
        asks = json.loads(row["asks"])
        if not bids or not asks:
            return None, None
        return float(bids[0][0]), float(asks[0][0])
    except Exception:
        return None, None


st.title("L2/L3 Orderbook Monitor")

if not BASE_DIR.exists():
    st.error(f"Base dir not found: {BASE_DIR}")
    st.stop()

sessions = _list_sessions(BASE_DIR)
if not sessions:
    st.warning("No sessions found.")
    st.stop()

default_session = _pick_default_session(BASE_DIR, sessions)
follow_latest = st.sidebar.checkbox("Follow LATEST", value=True)
session_key = "session_sel"
if follow_latest:
    st.session_state[session_key] = default_session
sel = st.sidebar.selectbox("Session", sessions, index=sessions.index(st.session_state.get(session_key, default_session)), key=session_key)
auto_refresh = st.sidebar.checkbox("Auto refresh", value=True)
refresh_sec = st.sidebar.number_input("Refresh seconds", min_value=0.5, max_value=10.0, value=1.0, step=0.5)

session_dir = BASE_DIR / sel
books = _read_parquet(session_dir, "book_states")
latest_file = _latest_parquet(session_dir, "book_states")

if books.empty:
    st.info("No orderbook data found.")
else:
    books["ts"] = pd.to_datetime(books["ts_ms"], unit="ms", utc=True, errors="coerce")
    best = books.apply(_best_levels, axis=1, result_type="expand")
    books["best_bid"] = best[0]
    books["best_ask"] = best[1]
    books["mid"] = (books["best_bid"] + books["best_ask"]) / 2.0
    books["spread"] = books["best_ask"] - books["best_bid"]

    st.subheader("Orderbook (latest snapshot)")
    if latest_file is not None:
        mtime = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(latest_file.stat().st_mtime))
        st.caption(f"rows={len(books)} last_ts={books['ts'].max()} latest_file={latest_file.name} mtime={mtime}")
    else:
        st.caption(f"rows={len(books)} last_ts={books['ts'].max()}")
    for venue in sorted(books["venue"].unique().tolist()):
        latest = books[books["venue"] == venue].sort_values("ts_ms").tail(1)
        if latest.empty:
            continue
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

        st.markdown(f"**{venue.upper()}**")
        col1, col2 = st.columns(2)
        with col1:
            st.caption("Bids (top)")
            st.dataframe(bid_df, width="stretch")
        with col2:
            st.caption("Asks (top)")
            st.dataframe(ask_df, width="stretch")
        if "l3_order_count" in books.columns:
            st.caption(f"L3 order count: {int(row.get('l3_order_count') or 0)}")

    st.subheader("Mid + Spread")
    fig_mid = px.line(books, x="ts", y="mid", color="venue")
    fig_sp = px.line(books, x="ts", y="spread", color="venue")
    st.plotly_chart(fig_mid, width="stretch")
    st.plotly_chart(fig_sp, width="stretch")

if auto_refresh:
    time.sleep(float(refresh_sec))
    st.rerun()
