import json
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_DIR = ROOT / "src/out/zil_books_oi"

st.set_page_config(page_title="ZIL Orderbook + OI", layout="wide")


def _load_parquet(prefix: str, base_dir: Path) -> pd.DataFrame:
    if not base_dir.exists():
        return pd.DataFrame()
    paths = sorted(base_dir.glob(f"{prefix}_*.parquet"))
    if not paths:
        return pd.DataFrame()
    frames = []
    for p in paths[-200:]:
        try:
            frames.append(pd.read_parquet(p))
        except Exception:
            continue
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


@st.cache_data(ttl=10)
def fetch_usdkrw() -> float | None:
    sources = [
        ("https://open.er-api.com/v6/latest/USD", lambda d: d.get("rates", {}).get("KRW")),
        ("https://api.exchangerate.host/latest?base=USD&symbols=KRW", lambda d: d.get("rates", {}).get("KRW")),
    ]
    for url, getter in sources:
        try:
            with urllib.request.urlopen(url, timeout=5) as resp:
                data = json.load(resp)
            val = getter(data)
            if val is not None:
                return float(val)
        except Exception:
            continue
    return None


def _best_levels(side_json: str) -> tuple[float | None, float | None]:
    try:
        rows = json.loads(side_json)
    except Exception:
        return None, None
    if not rows:
        return None, None
    try:
        price = float(rows[0][0])
        size = float(rows[0][1])
        return price, size
    except Exception:
        return None, None


def _depth_curve(side_json: str, is_bid: bool) -> tuple[list[float], list[float]]:
    try:
        rows = json.loads(side_json)
    except Exception:
        return [], []
    out = []
    for row in rows:
        try:
            price = float(row[0])
            size = float(row[1])
        except Exception:
            continue
        out.append((price, size))
    if not out:
        return [], []
    out.sort(key=lambda x: x[0], reverse=is_bid)
    prices = []
    cum = []
    total = 0.0
    for price, size in out:
        total += size
        prices.append(price)
        cum.append(total)
    return prices, cum
    if not rows:
        return None, None
    try:
        price = float(rows[0][0])
        size = float(rows[0][1])
        return price, size
    except Exception:
        return None, None


st.sidebar.header("Source")
base_dir = Path(st.sidebar.text_input("Data dir", value=str(DEFAULT_DIR)))
lookback_min = st.sidebar.slider("Lookback minutes", 5, 180, 30, 5)
auto_refresh = st.sidebar.checkbox("Auto refresh", value=True)
refresh_sec = st.sidebar.number_input("Refresh seconds", min_value=0.5, max_value=10.0, value=1.0, step=0.5)
convert_krw = st.sidebar.checkbox("Convert KRW->USD (Upbit)", value=True)
usdkrw = fetch_usdkrw() if convert_krw else None
if convert_krw and usdkrw is None:
    st.sidebar.warning("Failed to fetch USDKRW; Upbit will remain in KRW.")

books = _load_parquet("zil_orderbook", base_dir)
ois = _load_parquet("zil_open_interest", base_dir)

if books.empty:
    st.warning("No orderbook data found.")
    st.stop()

books["ts"] = pd.to_datetime(books["ts_ms"], unit="ms", utc=True, errors="coerce")
cutoff = pd.Timestamp.utcnow() - pd.Timedelta(minutes=lookback_min)
books = books[books["ts"] >= cutoff].copy()

if not ois.empty:
    ois["ts"] = pd.to_datetime(ois["ts_ms"], unit="ms", utc=True, errors="coerce")
    ois = ois[ois["ts"] >= cutoff].copy()

st.title("ZIL top10 orderbook + OI (1s snapshots)")

exchanges = sorted(books["exchange"].unique().tolist())
sel_ex = st.multiselect("Exchanges", exchanges, default=exchanges)
market = st.selectbox("Market", ["spot", "perp"], index=1)

view = books[(books["exchange"].isin(sel_ex)) & (books["market"] == market)].copy()
if view.empty:
    st.info("No data for selection.")
    st.stop()

view["best_bid"] = None
view["best_ask"] = None
view["bid_size"] = None
view["ask_size"] = None

for idx, row in view.iterrows():
    bid_p, bid_s = _best_levels(row["bids"])
    ask_p, ask_s = _best_levels(row["asks"])
    if convert_krw and row["exchange"] == "UPBIT" and usdkrw:
        if bid_p is not None:
            bid_p = bid_p / usdkrw
        if ask_p is not None:
            ask_p = ask_p / usdkrw
    view.at[idx, "best_bid"] = bid_p
    view.at[idx, "best_ask"] = ask_p
    view.at[idx, "bid_size"] = bid_s
    view.at[idx, "ask_size"] = ask_s

valid_counts = view.groupby("exchange")[["best_bid", "best_ask"]].apply(
    lambda g: g["best_bid"].notna().sum()
).to_dict()
missing = [ex for ex in sel_ex if valid_counts.get(ex, 0) == 0]
if missing:
    st.warning(f"No best bid/ask parsed for: {', '.join(missing)}. Check WS data format or lookback.")

view = view.dropna(subset=["best_bid", "best_ask"]).copy()
view["mid"] = (view["best_bid"] + view["best_ask"]) / 2.0
view["spread"] = view["best_ask"] - view["best_bid"]

st.subheader("Best bid/ask + mid")
fig = go.Figure()
for ex in sel_ex:
    v = view[view["exchange"] == ex]
    fig.add_trace(go.Scatter(x=v["ts"], y=v["mid"], name=f"{ex} mid"))
fig.update_layout(height=400)
st.plotly_chart(fig, width="stretch")

st.subheader("Spread")
fig2 = px.line(view, x="ts", y="spread", color="exchange")
st.plotly_chart(fig2, width="stretch")

st.subheader("Cross-exchange gaps (spot-spot / perp-perp / spot-perp)")
gap_col1, gap_col2, gap_col3 = st.columns(3)
with gap_col1:
    ex_a = st.selectbox("Exchange A", sel_ex, index=0, key="gap_ex_a")
with gap_col2:
    ex_b = st.selectbox("Exchange B", sel_ex, index=min(1, len(sel_ex) - 1), key="gap_ex_b")
with gap_col3:
    gap_type = st.selectbox("Gap type", ["spot-spot", "perp-perp", "spot-perp"], index=0)

if ex_a == ex_b:
    st.warning("Exchange A and B are the same. Pick two different exchanges for gap attribution.")

gap_map = {
    "spot-spot": ("spot", "spot"),
    "perp-perp": ("perp", "perp"),
    "spot-perp": ("spot", "perp"),
}
mk_a, mk_b = gap_map[gap_type]

gap_a = books[(books["exchange"] == ex_a) & (books["market"] == mk_a)].copy()
gap_b = books[(books["exchange"] == ex_b) & (books["market"] == mk_b)].copy()
for df_ in (gap_a, gap_b):
    df_["ts"] = pd.to_datetime(df_["ts_ms"], unit="ms", utc=True, errors="coerce")
    df_ = df_[df_["ts"] >= cutoff]

def _mid_from_row(row, usdkrw_rate: float | None):
    bid_p, _ = _best_levels(row["bids"])
    ask_p, _ = _best_levels(row["asks"])
    if bid_p is None or ask_p is None:
        return None
    if convert_krw and row["exchange"] == "UPBIT" and usdkrw_rate:
        bid_p = bid_p / usdkrw_rate
        ask_p = ask_p / usdkrw_rate
    return (bid_p + ask_p) / 2.0

if not gap_a.empty and not gap_b.empty:
    gap_a = gap_a.sort_values("ts")
    gap_b = gap_b.sort_values("ts")
    gap_a["mid"] = gap_a.apply(lambda r: _mid_from_row(r, usdkrw), axis=1)
    gap_b["mid"] = gap_b.apply(lambda r: _mid_from_row(r, usdkrw), axis=1)
    gap_a = gap_a.dropna(subset=["mid"])
    gap_b = gap_b.dropna(subset=["mid"])
    if gap_a.empty or gap_b.empty:
        st.info("No mid prices available for selected pair.")
    else:
        gap_a["ts_sec"] = gap_a["ts"].dt.floor("s")
        gap_b["ts_sec"] = gap_b["ts"].dt.floor("s")
        a_series = gap_a.groupby("ts_sec")["mid"].last()
        b_series = gap_b.groupby("ts_sec")["mid"].last()
        joined = pd.concat([a_series, b_series], axis=1, keys=["a", "b"]).dropna()
        joined["gap"] = joined["a"] - joined["b"]
        joined["g_pct"] = ((joined["a"] / joined["b"]) - 1.0) * 100.0
        fig_gap = px.line(joined.reset_index(), x="ts_sec", y=["gap", "g_pct"])
        st.plotly_chart(fig_gap, width="stretch")
        st.caption(
            f"Latest gap: {joined['gap'].iloc[-1]:,.6f} | "
            f"Latest g%: {joined['g_pct'].iloc[-1]:.4f}%"
        )

        st.subheader("Gap spike attribution")
        spike_thresh = st.number_input("Spike threshold (abs g%)", min_value=0.01, max_value=50.0, value=0.5, step=0.1)
        spike_df = joined.copy()
        spike_df["g_pct_delta"] = spike_df["g_pct"].diff()
        spike_df["a_delta"] = spike_df["a"].diff()
        spike_df["b_delta"] = spike_df["b"].diff()
        spikes = spike_df[spike_df["g_pct_delta"].abs() >= spike_thresh].copy()
        if spikes.empty:
            st.info("No spikes above threshold in lookback window.")
        else:
            def _who(row):
                if abs(row["a_delta"]) >= abs(row["b_delta"]):
                    return ex_a
                return ex_b
            spikes["driver"] = spikes.apply(_who, axis=1)
            spikes = spikes.reset_index()[["ts_sec", "g_pct_delta", "a_delta", "b_delta", "driver"]].tail(50)
            a_col = f"{ex_a}_delta"
            b_col = f"{ex_b}_delta"
            if a_col == b_col:
                b_col = f"{ex_b}_delta_b"
            spikes = spikes.rename(columns={"g_pct_delta": "g%_delta", "a_delta": a_col, "b_delta": b_col})
            st.dataframe(spikes, width="stretch")
else:
    st.info("No data for selected exchanges/markets in the lookback window.")

st.subheader("Orderbook depth (latest snapshot)")
depth_ex = st.selectbox("Depth exchange", sel_ex, index=0)
depth_side = st.radio("Side", ["bids", "asks"], horizontal=True)
latest_row = (
    view[view["exchange"] == depth_ex]
    .sort_values("ts")
    .tail(1)
)
if not latest_row.empty:
    side_json = latest_row.iloc[0][depth_side]
    is_bid = depth_side == "bids"
    prices, cum = _depth_curve(side_json, is_bid=is_bid)
    if convert_krw and latest_row.iloc[0]["exchange"] == "UPBIT" and usdkrw:
        prices = [p / usdkrw for p in prices]
    if prices:
        fig_depth = go.Figure()
        fig_depth.add_trace(
            go.Scatter(x=prices, y=cum, mode="lines+markers", name=f"{depth_ex} {depth_side}")
        )
        fig_depth.update_layout(height=350, xaxis_title="Price", yaxis_title="Cumulative size")
        st.plotly_chart(fig_depth, width="stretch")
        st.subheader("Volume profile (매물대, latest snapshot)")
        bucket_n = st.number_input("Price buckets", min_value=5, max_value=50, value=15, step=1)
        try:
            rows = json.loads(side_json)
        except Exception:
            rows = []
        levels = []
        for row in rows:
            try:
                price = float(row[0])
                size = float(row[1])
            except Exception:
                continue
            if convert_krw and latest_row.iloc[0]["exchange"] == "UPBIT" and usdkrw:
                price = price / usdkrw
            levels.append((price, size))
        if levels:
            prices_only = [p for p, _ in levels]
            pmin, pmax = min(prices_only), max(prices_only)
            if pmin == pmax:
                pmax = pmin + 1e-6
            bins = pd.cut(prices_only, bins=int(bucket_n))
            df_vp = pd.DataFrame({"price": prices_only, "size": [s for _, s in levels], "bin": bins})
            vp = df_vp.groupby("bin")["size"].sum().reset_index()
            vp["mid"] = vp["bin"].apply(lambda b: (b.left + b.right) / 2.0)
            fig_vp = go.Figure()
            fig_vp.add_trace(go.Bar(x=vp["size"], y=vp["mid"], orientation="h", name="Volume"))
            fig_vp.update_layout(height=350, xaxis_title="Size", yaxis_title="Price")
            st.plotly_chart(fig_vp, width="stretch")
        else:
            st.info("No depth data to build volume profile.")
    else:
        st.info("No depth data for selected exchange.")
else:
    st.info("No latest snapshot for selected exchange.")

if market == "perp" and not ois.empty:
    st.subheader("Open Interest (perp)")
    oi_view = ois[ois["exchange"].isin(sel_ex)].copy()
    fig3 = px.line(oi_view, x="ts", y="open_interest", color="exchange")
    st.plotly_chart(fig3, width="stretch")

st.subheader("Latest snapshot")
latest = view.sort_values("ts").groupby("exchange").tail(1)
st.dataframe(latest[["exchange", "market", "symbol", "best_bid", "best_ask", "spread", "bid_size", "ask_size"]], width="stretch")

st.subheader("Tick-based mid (Binance/Bybit spot & perp)")
tick_exchanges = ["BINANCE", "BYBIT"]
tick_view = books[books["exchange"].isin(tick_exchanges)].copy()
tick_view["ts"] = pd.to_datetime(tick_view["ts_ms"], unit="ms", utc=True, errors="coerce")
tick_view = tick_view[tick_view["ts"] >= cutoff].copy()

if tick_view.empty:
    st.info("No tick data for Binance/Bybit.")
else:
    tick_view["best_bid"] = None
    tick_view["best_ask"] = None
    for idx, row in tick_view.iterrows():
        bid_p, _ = _best_levels(row["bids"])
        ask_p, _ = _best_levels(row["asks"])
        if convert_krw and row["exchange"] == "UPBIT" and usdkrw:
            if bid_p is not None:
                bid_p = bid_p / usdkrw
            if ask_p is not None:
                ask_p = ask_p / usdkrw
        tick_view.at[idx, "best_bid"] = bid_p
        tick_view.at[idx, "best_ask"] = ask_p
    tick_view = tick_view.dropna(subset=["best_bid", "best_ask"]).copy()
    tick_view["mid"] = (tick_view["best_bid"] + tick_view["best_ask"]) / 2.0
    tick_view["mid"] = pd.to_numeric(tick_view["mid"], errors="coerce")
    tick_view["label"] = tick_view["exchange"] + " " + tick_view["market"]
    fig_tick = px.line(tick_view, x="ts", y="mid", color="label")
    st.plotly_chart(fig_tick, width="stretch")

    st.subheader("Candles (Binance/Bybit spot & perp)")
    if "show_candles" not in st.session_state:
        st.session_state.show_candles = True
    show_candles = st.checkbox("Show candles", value=st.session_state.show_candles, key="show_candles")
    candle_interval = st.selectbox("Candle interval", ["1s", "5s", "10s", "1m"], index=2)
    if show_candles:
        candles = []
        for label, g in tick_view.groupby("label"):
            g = g.set_index("ts").sort_index()
            ohlc = g["mid"].resample(candle_interval).ohlc()
            ohlc = ohlc.dropna()
            if ohlc.empty:
                continue
            ohlc["label"] = label
            candles.append(ohlc.reset_index())
        if candles:
            cdf = pd.concat(candles, ignore_index=True)
            fig_c = go.Figure()
            palette = ["#2563eb", "#16a34a", "#f97316", "#a855f7"]
            for i, label in enumerate(sorted(cdf["label"].unique())):
                sub = cdf[cdf["label"] == label]
                color = palette[i % len(palette)]
                fig_c.add_trace(
                    go.Candlestick(
                        x=sub["ts"],
                        open=sub["open"],
                        high=sub["high"],
                        low=sub["low"],
                        close=sub["close"],
                        name=label,
                        increasing_line_color=color,
                        decreasing_line_color=color,
                    )
                )
            fig_c.update_layout(height=500, xaxis_rangeslider_visible=False)
            st.plotly_chart(fig_c, width="stretch")
        else:
            st.info("Not enough tick data to build candles.")

if auto_refresh:
    import time as _time

    _time.sleep(float(refresh_sec))
    st.rerun()
