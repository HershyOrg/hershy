import os
import time
import urllib.parse
import urllib.request
from datetime import time as dtime
from pathlib import Path

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import json
import streamlit as st

ROOT = Path(__file__).resolve().parents[3]
BASE_DIR = Path(os.environ.get("CEX_BASE_DIR", ROOT / "src/out/cex_oracle"))
DISPLAY_TZ = "America/New_York"

st.set_page_config(page_title="CEX Oracle Dashboard", layout="wide")


def _list_sessions(base_dir: Path) -> list[str]:
    if not base_dir.exists():
        return []
    return sorted([p.name for p in base_dir.iterdir() if p.is_dir()])


def _default_session(base_dir: Path) -> str | None:
    latest_path = base_dir / "LATEST"
    if latest_path.exists():
        return latest_path.read_text().strip()
    sessions = _list_sessions(base_dir)
    return sessions[-1] if sessions else None


def _read_frames(paths: list[Path]) -> pd.DataFrame:
    frames = []
    for p in paths:
        try:
            if p.name.endswith(".parquet"):
                frames.append(pd.read_parquet(p))
            else:
                frames.append(pd.read_csv(p))
        except Exception:
            continue
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


@st.cache_data(ttl=2)
def load_frames(glob_dir: Path, prefix: str) -> pd.DataFrame:
    if not glob_dir.exists():
        return pd.DataFrame()
    paths = []
    paths += list(glob_dir.glob(f"{prefix}_*.parquet"))
    paths += list(glob_dir.glob(f"{prefix}_*.csv"))
    paths += list(glob_dir.glob(f"{prefix}_*.csv.gz"))
    return _read_frames(sorted(set(paths)))


def normalize(df: pd.DataFrame, price_col: str = "price") -> pd.DataFrame:
    if df.empty:
        return df
    out = df.copy()
    if "ts" in out.columns:
        out["ts"] = pd.to_datetime(out["ts"], utc=True, errors="coerce")
    elif "ts_ms" in out.columns:
        out["ts"] = pd.to_datetime(out["ts_ms"], unit="ms", utc=True, errors="coerce")
    out = out.dropna(subset=["ts"])
    out["price"] = pd.to_numeric(out[price_col], errors="coerce")
    out = out.dropna(subset=["price"])
    out["source"] = out.get("source", "UNKNOWN").astype(str)
    out["symbol"] = out.get("symbol", "UNKNOWN").astype(str)
    return out


def normalize_volume(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    out = df.copy()
    if "ts" in out.columns:
        out["ts"] = pd.to_datetime(out["ts"], utc=True, errors="coerce")
    elif "ts_ms" in out.columns:
        out["ts"] = pd.to_datetime(out["ts_ms"], unit="ms", utc=True, errors="coerce")
    out = out.dropna(subset=["ts"])
    out["volume"] = pd.to_numeric(out.get("volume"), errors="coerce")
    out = out.dropna(subset=["volume"])
    out["source"] = out.get("source", "UNKNOWN").astype(str)
    out["symbol"] = out.get("symbol", "UNKNOWN").astype(str)
    return out


def normalize_chance(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    out = df.copy()
    if "ts" in out.columns:
        out["ts"] = pd.to_datetime(out["ts"], utc=True, errors="coerce")
    elif "ts_ms" in out.columns:
        out["ts"] = pd.to_datetime(out["ts_ms"], unit="ms", utc=True, errors="coerce")
    out = out.dropna(subset=["ts"])
    out["chance"] = pd.to_numeric(out.get("chance"), errors="coerce")
    out = out.dropna(subset=["chance"])
    out["slug"] = out.get("slug", "UNKNOWN").astype(str)
    return out


def _bitget_fetch(url: str, params: dict) -> list:
    query = urllib.parse.urlencode(params)
    full = f"{url}?{query}"
    req = urllib.request.Request(full, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.load(resp)
    payload = data.get("data", [])
    return payload if isinstance(payload, list) else []


def _normalize_bitget_candles(rows: list) -> pd.DataFrame:
    out = []
    for row in rows:
        if not row or len(row) < 5:
            continue
        try:
            ts_ms = int(row[0])
            o = float(row[1])
            h = float(row[2])
            l = float(row[3])
            c = float(row[4])
            v = float(row[5]) if len(row) > 5 and row[5] is not None else None
        except Exception:
            continue
        out.append((ts_ms, o, h, l, c, v))
    df = pd.DataFrame(out, columns=["ts_ms", "open", "high", "low", "close", "volume"])
    if not df.empty:
        df["ts"] = pd.to_datetime(df["ts_ms"], unit="ms", utc=True)
    return df


@st.cache_data(ttl=60)
def load_bitget_spot_1m(symbol: str, start_ms: int, end_ms: int, limit: int = 100) -> pd.DataFrame:
    url = "https://api.bitget.com/api/v2/spot/market/candles"
    step_ms = limit * 60 * 1000
    cur = start_ms
    rows = []
    while cur < end_ms:
        nxt = min(cur + step_ms, end_ms)
        params = {
            "symbol": symbol,
            "granularity": "1min",
            "startTime": cur,
            "endTime": nxt,
            "limit": limit,
        }
        rows.extend(_bitget_fetch(url, params))
        cur = nxt
        time.sleep(0.05)
    df = _normalize_bitget_candles(rows)
    if not df.empty:
        df = df.drop_duplicates(subset=["ts_ms"]).sort_values("ts_ms")
    return df


@st.cache_data(ttl=60)
def load_bitget_perp_1m(symbol: str, start_ms: int, end_ms: int, limit: int = 100) -> pd.DataFrame:
    url = "https://api.bitget.com/api/v2/mix/market/candles"
    step_ms = limit * 60 * 1000
    cur = start_ms
    rows = []
    while cur < end_ms:
        nxt = min(cur + step_ms, end_ms)
        params = {
            "symbol": symbol,
            "productType": "usdt-futures",
            "granularity": "1m",
            "startTime": cur,
            "endTime": nxt,
            "limit": limit,
        }
        rows.extend(_bitget_fetch(url, params))
        cur = nxt
        time.sleep(0.05)
    df = _normalize_bitget_candles(rows)
    if not df.empty:
        df = df.drop_duplicates(subset=["ts_ms"]).sort_values("ts_ms")
    return df


@st.cache_data(ttl=600)
def load_bitget_history(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame()
    if path.name.endswith(".parquet"):
        df = pd.read_parquet(path)
    else:
        df = pd.read_csv(path, compression="gzip")
    if "ts_ms" in df.columns:
        df["ts_ms"] = pd.to_numeric(df["ts_ms"], errors="coerce")
        df = df.dropna(subset=["ts_ms"])
        df = df.drop_duplicates(subset=["ts_ms"]).sort_values("ts_ms")
        df["ts"] = pd.to_datetime(df["ts_ms"], unit="ms", utc=True, errors="coerce")
    return df


st.sidebar.header("Data")
if not BASE_DIR.exists():
    st.error(f"Base dir not found: {BASE_DIR}")
    st.stop()
st.sidebar.caption(f"Timezone: {DISPLAY_TZ}")

sessions = _list_sessions(BASE_DIR)
if not sessions:
    st.warning("No sessions found. Run collectors first.")
    st.stop()

def_sess = _default_session(BASE_DIR)
sel = st.sidebar.selectbox("Session", sessions, index=sessions.index(def_sess) if def_sess in sessions else 0)

session_dir = BASE_DIR / sel
chainlink_dir = session_dir / "chainlink"
exchanges_dir = session_dir / "exchanges"
mexc_dir = session_dir / "mexc"
coinbase_dir = session_dir / "coinbase"
upbit_dir = session_dir / "upbit"
bitget_dir = session_dir / "bitget"
kucoin_dir = session_dir / "kucoin"
polymarket_dir = session_dir / "polymarket"
binance_dir = session_dir / "binance"

chainlink = normalize(load_frames(chainlink_dir, "chainlink_1s"))
ex9 = normalize(load_frames(exchanges_dir, "exchanges_1s"))
ex9_vol = normalize_volume(load_frames(exchanges_dir, "exchanges_1s_volume"))
mexc = normalize(load_frames(mexc_dir, "mexc_1s"))
coinbase = normalize(load_frames(coinbase_dir, "coinbase_1s"))
upbit = normalize(load_frames(upbit_dir, "upbit_1s"))
bitget = normalize(load_frames(bitget_dir, "bitget_1s"))
kucoin = normalize(load_frames(kucoin_dir, "kucoin_1s"))
polymarket = normalize_chance(load_frames(polymarket_dir, "polymarket_chance"))
binance = normalize(load_frames(binance_dir, "binance_1s"))
binance_vol = normalize_volume(load_frames(binance_dir, "binance_1s_volume"))

all_prices = pd.concat([chainlink, ex9, mexc, coinbase, upbit, bitget, kucoin, binance], ignore_index=True)
if all_prices.empty:
    st.warning("No data in session. Collectors may still be starting.")
    st.stop()

st.sidebar.header("Filter")
use_custom_range = st.sidebar.checkbox("Custom time range (ET)", value=False)
if use_custom_range:
    default_end = pd.Timestamp.now(tz=DISPLAY_TZ).to_pydatetime()
    default_start = (pd.Timestamp.now(tz=DISPLAY_TZ) - pd.Timedelta(hours=6)).to_pydatetime()
    start_date = st.sidebar.date_input("Start date", value=default_start.date())
    start_time = st.sidebar.time_input("Start time", value=default_start.time())
    end_date = st.sidebar.date_input("End date", value=default_end.date())
    end_time = st.sidebar.time_input("End time", value=default_end.time())
    start_local = pd.Timestamp.combine(start_date, start_time).tz_localize(DISPLAY_TZ)
    end_local = pd.Timestamp.combine(end_date, end_time).tz_localize(DISPLAY_TZ)
    start = start_local.tz_convert("UTC")
    end = end_local.tz_convert("UTC")
    if end <= start:
        st.sidebar.error("End must be after start.")
        st.stop()
else:
    hours = st.sidebar.slider("Recent hours", 1, 48, 6)
    end = pd.Timestamp.now(tz="UTC")
    start = end - pd.Timedelta(hours=hours)
    start_local = start.tz_convert(DISPLAY_TZ)
    end_local = end.tz_convert(DISPLAY_TZ)

st.sidebar.header("Refresh")
auto_refresh = st.sidebar.checkbox("Auto refresh", value=True)
refresh_sec = st.sidebar.number_input("Refresh seconds", min_value=0.2, max_value=10.0, value=1.0, step=0.2)

df = all_prices[(all_prices["ts"] >= start) & (all_prices["ts"] <= end)].copy()
df = df.sort_values("ts")
df["ts_local"] = df["ts"].dt.tz_convert(DISPLAY_TZ)

st.title("Polymarket RTDS Chainlink + 10 Exchanges")

st.subheader("1) Chainlink 15m open vs current (%)")
cl = df[df["source"].isin(["CHAINLINK_RPC", "POLYMARKET_RTDS_CHAINLINK"])].copy()
if cl.empty:
    st.info("No Chainlink data found in this session.")
else:
    cl = cl.set_index("ts_local").sort_index()
    window_open = cl["price"].groupby(pd.Grouper(freq="15min")).transform("first")
    cl["pct_from_15m_open"] = (cl["price"] / window_open) - 1.0
    fig1 = px.line(cl.reset_index(), x="ts_local", y=["price", "pct_from_15m_open"])
    st.plotly_chart(fig1, width="stretch")

st.subheader("2) Exchanges spot 1s chart")
sources = sorted(df["source"].unique().tolist())
default_sel = [s for s in sources if s in ["BINANCE", "COINBASE", "OKX", "BYBIT", "HTX", "MEXC"]]
with st.expander("Visible exchanges", expanded=True):
    visible_sources = []
    for src in sources:
        key = f"show_exchange_{src}"
        if key not in st.session_state:
            st.session_state[key] = src in (default_sel or sources[:3])
        if st.checkbox(src, value=st.session_state[key], key=key):
            visible_sources.append(src)

exdf = df[df["source"].isin(visible_sources)].copy()
if exdf.empty:
    st.info("No data for selected sources.")
else:
    vol_all = pd.concat([ex9_vol, binance_vol], ignore_index=True)
    vol_sources = sorted(vol_all["source"].unique().tolist()) if not vol_all.empty else []
    vol_source = st.selectbox(
        "Volume source (1s bars)",
        vol_sources,
        index=vol_sources.index("BINANCE") if "BINANCE" in vol_sources else 0,
    ) if vol_sources else None

    # Price controls (per exchange) + weights
    latest_price = exdf.sort_values("ts").groupby("source")["price"].last().to_dict()
    price_modes = {}
    manual_prices = {}
    weights = {}
    with st.expander("Price inputs (per exchange)", expanded=False):
        for src in visible_sources:
            mode = st.selectbox(
                f"{src} price source",
                ["price", "bid", "ask", "manual"],
                index=0,
                key=f"price_mode_{src}",
            )
            price_modes[src] = mode
            if mode == "manual":
                default_val = float(latest_price.get(src, 0.0))
                manual_prices[src] = st.number_input(
                    f"{src} manual price",
                    value=default_val,
                    step=0.01,
                    format="%.4f",
                    key=f"manual_price_{src}",
                )
            weights[src] = st.number_input(
                f"{src} weight",
                value=1.0,
                min_value=0.0,
                step=0.1,
                format="%.2f",
                key=f"weight_{src}",
            )

    exdf_used = exdf.copy()
    exdf_used["price_used"] = exdf_used["price"]
    for src, mode in price_modes.items():
        mask = exdf_used["source"] == src
        if mode == "bid":
            exdf_used.loc[mask, "price_used"] = exdf_used.loc[mask, "bid"].fillna(exdf_used.loc[mask, "price"])
        elif mode == "ask":
            exdf_used.loc[mask, "price_used"] = exdf_used.loc[mask, "ask"].fillna(exdf_used.loc[mask, "price"])

    manual_sources = [s for s, m in price_modes.items() if m == "manual"]
    exdf_used = exdf_used[~exdf_used["source"].isin(manual_sources)]
    manual_frames = []
    if manual_sources:
        ts_range = pd.date_range(start=start_local, end=end_local, freq="1s", tz=DISPLAY_TZ)
        for src in manual_sources:
            manual_val = manual_prices.get(src)
            if manual_val is None:
                continue
            manual_frames.append(
                pd.DataFrame(
                    {"source": src, "ts_local": ts_range, "price_used": float(manual_val)}
                )
            )
    exdf_plot = pd.concat([exdf_used, *manual_frames], ignore_index=True) if manual_frames else exdf_used

    pm_df = pd.DataFrame()
    pm_slugs = sorted(polymarket["slug"].unique().tolist()) if not polymarket.empty else []
    pm_slug = st.selectbox("Polymarket market", pm_slugs, index=0) if pm_slugs else None
    if pm_slug:
        pm_df = polymarket[polymarket["slug"] == pm_slug].copy()
        pm_df = pm_df[(pm_df["ts"] >= start) & (pm_df["ts"] <= end)]
        if not pm_df.empty:
            pm_df["ts_local"] = pm_df["ts"].dt.tz_convert(DISPLAY_TZ)

    has_pm = pm_slug is not None and not pm_df.empty
    if has_pm:
        st.caption("Polymarket chance = YES mid (best_bid/best_ask midpoint)")

    rows = 3 if has_pm else 2
    row_heights = [0.55, 0.25, 0.2] if has_pm else [0.7, 0.3]
    fig2 = make_subplots(rows=rows, cols=1, shared_xaxes=True, row_heights=row_heights, vertical_spacing=0.02)
    for src, g in exdf_plot.groupby("source"):
        fig2.add_trace(go.Scatter(x=g["ts_local"], y=g["price_used"], name=src), row=1, col=1)

    # Median + weighted average lines across selected sources
    med_df = exdf_plot.copy()
    med_df["ts_sec"] = med_df["ts_local"].dt.floor("s")
    pivot = med_df.pivot_table(index="ts_sec", columns="source", values="price_used", aggfunc="last").sort_index()
    pivot = pivot.ffill()
    if not pivot.empty:
        median = pivot.median(axis=1, skipna=True)
        fig2.add_trace(
            go.Scatter(
                x=median.index,
                y=median.values,
                name="Median",
                line=dict(color="#111827"),
            ),
            row=1,
            col=1,
        )
        if not median.dropna().empty:
            st.caption(f"Median (latest): {median.dropna().iloc[-1]:,.4f}")

        weight_series = pd.Series({k: float(v) for k, v in weights.items()})
        weight_series = weight_series.reindex(pivot.columns).fillna(0.0)
        weight_sum = weight_series.sum()
        show_weighted = st.checkbox("Show Weighted Avg", value=False, key="show_weighted_avg")
        if "weighted_avg_enabled" not in st.session_state:
            st.session_state.weighted_avg_enabled = False
            st.session_state.weighted_avg_start = None

        if show_weighted and not st.session_state.weighted_avg_enabled:
            st.session_state.weighted_avg_enabled = True
            st.session_state.weighted_avg_start = pd.Timestamp.now(tz=DISPLAY_TZ)
        elif (not show_weighted) and st.session_state.weighted_avg_enabled:
            st.session_state.weighted_avg_enabled = False
            st.session_state.weighted_avg_start = None

        if show_weighted and weight_sum > 0:
            weighted = (pivot * weight_series).sum(axis=1) / weight_sum
            full_ready_ts = pivot.dropna().index.min() if not pivot.dropna().empty else None
            start_ts = st.session_state.weighted_avg_start
            if full_ready_ts is not None:
                if start_ts is None or start_ts < full_ready_ts:
                    start_ts = full_ready_ts
                    st.session_state.weighted_avg_start = start_ts
            if start_ts is not None:
                weighted = weighted[weighted.index >= start_ts]
            if weighted.empty:
                st.info("Weighted Avg waiting for all selected exchanges to have data.")
            else:
                fig2.add_trace(
                    go.Scatter(
                        x=weighted.index,
                        y=weighted.values,
                        name="Weighted Avg",
                        line=dict(color="#2563eb"),
                    ),
                    row=1,
                    col=1,
                )
                st.caption(f"Weighted Avg (latest): {weighted.dropna().iloc[-1]:,.4f}")

    if has_pm:
        fig2.add_trace(
            go.Scatter(x=pm_df["ts_local"], y=pm_df["chance"], name="Polymarket chance"),
            row=2,
            col=1,
        )

    if vol_source:
        vdf = vol_all[vol_all["source"] == vol_source].copy()
        vdf = vdf[(vdf["ts"] >= start) & (vdf["ts"] <= end)]
        if not vdf.empty:
            vdf["ts_local"] = vdf["ts"].dt.tz_convert(DISPLAY_TZ)
            vseries = vdf.set_index("ts_local")["volume"].resample("1s").sum().fillna(0.0)
            row_idx = 3 if has_pm else 2
            fig2.add_trace(
                go.Bar(x=vseries.index, y=vseries.values, name=f"{vol_source} volume", marker_color="#9ca3af"),
                row=row_idx,
                col=1,
            )

            avg_15m = vseries.last("15min").mean()
            st.caption(f"Avg volume (last 15m) for {vol_source}: {avg_15m:,.6f}")
        else:
            st.info("No volume data for selected source in this time window.")

    fig2.update_layout(height=850 if has_pm else 700, showlegend=True)
    st.plotly_chart(fig2, width="stretch")

st.subheader("3) Spread between two exchanges")
st.caption("주의: 스프레드 계산은 타임스탬프를 초 단위로 내림(floor)하여 같은 초에 들어온 값만 비교합니다.")
col1, col2 = st.columns(2)
with col1:
    a = st.selectbox("Exchange A", sources, index=0)
with col2:
    b = st.selectbox("Exchange B", sources, index=min(1, len(sources) - 1))

df_floor = df.copy()
df_floor["ts_sec"] = df_floor["ts_local"].dt.floor("s")
pivot = df_floor.pivot_table(index="ts_sec", columns="source", values="price", aggfunc="last").sort_index()
if a in pivot.columns and b in pivot.columns:
    spread = pd.DataFrame(index=pivot.index)
    spread["diff"] = pivot[a] - pivot[b]
    spread["pct"] = (pivot[a] / pivot[b]) - 1.0
    spread = spread.dropna()
    if spread.empty:
        st.info("Not enough overlapping data points.")
    else:
        fig3 = px.line(spread.reset_index(), x="ts_sec", y=["diff", "pct"])
        st.plotly_chart(fig3, width="stretch")

        avg_window = st.number_input("Spread average window (sec)", min_value=5, max_value=3600, value=60, step=5)
        spread_avg = spread.copy()
        spread_avg["diff_avg"] = spread_avg["diff"].rolling(f"{int(avg_window)}s").mean()
        spread_avg["pct_avg"] = spread_avg["pct"].rolling(f"{int(avg_window)}s").mean()
        fig3b = px.line(spread_avg.reset_index(), x="ts_sec", y=["diff_avg", "pct_avg"])
        st.plotly_chart(fig3b, width="stretch")

        # Cumulative average based on all previous data
        spread_avg["diff_cumavg"] = spread_avg["diff"].expanding().mean()
        spread_avg["pct_cumavg"] = spread_avg["pct"].expanding().mean()
        fig3c = px.line(spread_avg.reset_index(), x="ts_sec", y=["diff_cumavg", "pct_cumavg"])
        st.plotly_chart(fig3c, width="stretch")
else:
    st.info("Selected sources not found in data.")

st.subheader("4) Bitget MYXUSDT spot vs perp (1m)")
default_end_local = end_local
default_start_local = (end_local - pd.Timedelta(hours=24)).to_pydatetime()
bitget_start_date = st.date_input("Bitget start date (ET)", value=default_start_local.date())
bitget_end_date = st.date_input("Bitget end date (ET)", value=default_end_local.date())
use_history = st.checkbox("Use backfilled history (compressed)", value=True)

if st.button("Refresh Bitget 1m now"):
    load_bitget_spot_1m.clear()
    load_bitget_perp_1m.clear()
    load_bitget_history.clear()

start_local_b = pd.Timestamp.combine(bitget_start_date, dtime.min).tz_localize(DISPLAY_TZ)
end_local_b = pd.Timestamp.combine(bitget_end_date, dtime.max).tz_localize(DISPLAY_TZ)
now_local = pd.Timestamp.now(tz=DISPLAY_TZ)
if bitget_end_date == now_local.date() and end_local_b > now_local:
    end_local_b = now_local
if end_local_b <= start_local_b:
    st.error("Bitget end date must be after start date.")
    st.stop()

start_ms = int(start_local_b.tz_convert("UTC").timestamp() * 1000)
end_ms = int(end_local_b.tz_convert("UTC").timestamp() * 1000)

if use_history:
    hist_dir = BASE_DIR / "bitget_history"
    spot_path = hist_dir / "bitget_spot_MYXUSDT_1m.parquet"
    perp_path = hist_dir / "bitget_perp_MYXUSDT_1m.parquet"
    if not spot_path.exists():
        spot_path = hist_dir / "bitget_spot_MYXUSDT_1m.csv.gz"
    if not perp_path.exists():
        perp_path = hist_dir / "bitget_perp_MYXUSDT_1m.csv.gz"
    spot_df = load_bitget_history(spot_path)
    perp_df = load_bitget_history(perp_path)
else:
    spot_df = load_bitget_spot_1m("MYXUSDT", start_ms, end_ms)
    perp_df = load_bitget_perp_1m("MYXUSDT", start_ms, end_ms)

if not spot_df.empty:
    spot_df = spot_df[(spot_df["ts_ms"] >= start_ms) & (spot_df["ts_ms"] <= end_ms)].copy()
if not perp_df.empty:
    perp_df = perp_df[(perp_df["ts_ms"] >= start_ms) & (perp_df["ts_ms"] <= end_ms)].copy()

if spot_df.empty or perp_df.empty:
    st.info("Bitget spot/perp 1m data not available for this range.")
else:
    spot_df["ts_local"] = spot_df["ts"].dt.tz_convert(DISPLAY_TZ)
    perp_df["ts_local"] = perp_df["ts"].dt.tz_convert(DISPLAY_TZ)

    merged = pd.merge(
        spot_df[["ts_local", "close"]].rename(columns={"close": "spot_close"}),
        perp_df[["ts_local", "close"]].rename(columns={"close": "perp_close"}),
        on="ts_local",
        how="outer",
    ).sort_values("ts_local")
    merged[["spot_close", "perp_close"]] = merged[["spot_close", "perp_close"]].ffill()
    merged = merged.dropna(subset=["spot_close", "perp_close"])
    merged["spread"] = merged["perp_close"] - merged["spot_close"]
    merged["spread_pct"] = merged["spread"] / merged["spot_close"]

    fig_b = make_subplots(rows=2, cols=1, shared_xaxes=True, row_heights=[0.7, 0.3], vertical_spacing=0.02)
    fig_b.add_trace(go.Scatter(x=merged["ts_local"], y=merged["spot_close"], name="Spot MYXUSDT"), row=1, col=1)
    fig_b.add_trace(go.Scatter(x=merged["ts_local"], y=merged["perp_close"], name="Perp MYXUSDT"), row=1, col=1)
    fig_b.add_trace(go.Scatter(x=merged["ts_local"], y=merged["spread"], name="Perp-Spot"), row=2, col=1)
    fig_b.update_layout(height=600, showlegend=True)
    st.plotly_chart(fig_b, width="stretch")

    fig_b2 = px.line(merged, x="ts_local", y="spread_pct")
    st.plotly_chart(fig_b2, width="stretch")

st.subheader("5) Latest prices")
latest = (
    df.sort_values("ts")
    .groupby("source")
    .tail(1)[["source", "ts_local", "symbol", "price"]]
    .sort_values("source")
)
latest = latest.rename(columns={"ts_local": "ts"})
st.dataframe(latest, width="stretch")

if auto_refresh:
    time.sleep(float(refresh_sec))
    st.rerun()
