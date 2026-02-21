가능해. Polymarket 15분봉(“BTC up/down 15m” 같은 마켓)에서 “예측 대상 가격”이 **Chainlink 오라클 네트워크 가격**이라면, Polymarket가 제공하는 **RTDS(Real-Time Data Socket)** 에서 **`crypto_prices_chainlink`** 스트림으로 그 가격을 **무료/무인증(WebSocket)** 으로 받아서 그대로 기록할 수 있어. RTDS는 `wss://ws-live-data.polymarket.com` 이고, 연결 유지용으로 **5초마다 PING 권장**이야. ([docs.polymarket.com][1])
Chainlink 가격 스트림은 `topic="crypto_prices_chainlink"`, 심볼은 `"btc/usd"` 처럼 슬래시 포맷이고, 필터는 JSON 문자열로 넣어. ([docs.polymarket.com][2])

아래는 **(1) RTDS Chainlink 가격 다운로더 + (2) 10개 거래소 spot 1초 스냅샷 수집 + (3) 15분 “시가 vs 현재가(=현재 시점 가격)” 비교 차트 + (4) 임의 2개 거래소 가격차 그래프**까지 한 번에 되게 만드는 “로컬 실행용” 구성이다.

---

## 0) 구성 요약

* **RTDS Chainlink(Polymarket)**: WebSocket로 `btc/usd` 스트림 저장 (무인증) ([docs.polymarket.com][2])
* **거래소 9개**(Binance/Coinbase/Upbit/OKX/Bybit/Bitget/Gate/KuCoin/HTX): `cryptofeed`로 WS 티커 수집 (1초 스냅샷) ([PyPI][3])
* **MEXC**: `cryptofeed` 지원 목록에 없어서(=보통 미지원), MEXC 공식 Spot REST **`GET /api/v3/ticker/price`**로 1초 폴링 ([PyPI][3])
* **대시보드**: Streamlit + Plotly로

  * Chainlink 15분 기준 “(각 15분 구간 시가) 대비 현재가 변화율”
  * 10개 거래소 1초 가격 라인
  * 임의 2개 거래소 스프레드(절대값/퍼센트) 라인

---

## 1) 설치

```bash
mkdir pm_15m_oracle && cd pm_15m_oracle
python -m venv .venv
source .venv/bin/activate

pip install -U pip
pip install cryptofeed==2.4.1 streamlit plotly pandas pyarrow websockets aiohttp
```

`cryptofeed`는 다수 거래소(바이낸스/코인베이스/업비트/OKX/바이빗/비트겟/게이트/쿠코인/후오비(HTX))를 지원한다. ([PyPI][3])

---

## 2) 폴더/파일 구조

```text
pm_15m_oracle/
  collectors/
    rtds_chainlink.py
    exchanges_cryptofeed.py
    mexc_rest.py
    run_all.py
  dashboard/
    app.py
  data/
    (csv들이 여기에 생성)
```

---

## 3) collectors/rtds_chainlink.py  (Polymarket RTDS → Chainlink btc/usd 저장)

```python
# collectors/rtds_chainlink.py
import argparse
import asyncio
import csv
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import websockets

RTDS_URL = "wss://ws-live-data.polymarket.com"  # RTDS endpoint


def utc_iso_from_ms(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


async def rtds_chainlink_collector(symbol: str, out_csv: Path):
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    file_exists = out_csv.exists()

    latest = {"ts_ms": None, "price": None}

    async def writer_loop():
        # 1초마다 "스냅샷" 저장 (RTDS 업데이트가 없더라도 마지막 값을 유지 기록)
        last_written_sec = None
        while True:
            now_ms = int(time.time() * 1000)
            now_sec = now_ms // 1000
            if last_written_sec != now_sec and latest["price"] is not None:
                last_written_sec = now_sec
                row = [
                    utc_iso_from_ms(now_ms),
                    now_ms,
                    "POLYMARKET_RTDS_CHAINLINK",
                    symbol,
                    latest["price"],
                ]
                with out_csv.open("a", newline="") as f:
                    w = csv.writer(f)
                    if not file_exists and f.tell() == 0:
                        w.writerow(["ts", "ts_ms", "source", "symbol", "price"])
                    w.writerow(row)
            await asyncio.sleep(0.05)

    async def ws_loop():
        # RTDS는 연결 유지 위해 ping을 주기적으로 보내는 것을 권장(5초) :contentReference[oaicite:6]{index=6}
        while True:
            try:
                async with websockets.connect(RTDS_URL, ping_interval=None) as ws:
                    sub_msg = {
                        "action": "subscribe",
                        "subscriptions": [
                            {
                                "topic": "crypto_prices_chainlink",
                                "type": "*",
                                # docs: filters는 JSON 문자열. 예: "{\"symbol\":\"btc/usd\"}" :contentReference[oaicite:7]{index=7}
                                "filters": json.dumps({"symbol": symbol}),
                            }
                        ],
                    }
                    await ws.send(json.dumps(sub_msg))

                    async def ping_task():
                        while True:
                            try:
                                await ws.ping()
                            except Exception:
                                return
                            await asyncio.sleep(5)

                    pinger = asyncio.create_task(ping_task())

                    async for raw in ws:
                        try:
                            msg = json.loads(raw)
                        except Exception:
                            continue

                        if msg.get("topic") != "crypto_prices_chainlink":
                            continue

                        payload = msg.get("payload") or {}
                        if (payload.get("symbol") or "").lower() != symbol.lower():
                            continue

                        price = payload.get("value")
                        ts_ms = payload.get("timestamp") or msg.get("timestamp")
                        if price is None or ts_ms is None:
                            continue

                        latest["price"] = float(price)
                        latest["ts_ms"] = int(ts_ms)

                    pinger.cancel()

            except Exception as e:
                # 재연결
                await asyncio.sleep(1)

    await asyncio.gather(writer_loop(), ws_loop())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", default="btc/usd", help='Chainlink symbol like "btc/usd"')
    ap.add_argument("--out", default="data/chainlink_1s.csv")
    args = ap.parse_args()

    asyncio.run(rtds_chainlink_collector(args.symbol, Path(args.out)))


if __name__ == "__main__":
    main()
```

---

## 4) collectors/exchanges_cryptofeed.py (거래소 9개 WS 티커 → 1초 스냅샷)

```python
# collectors/exchanges_cryptofeed.py
import argparse
import csv
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from cryptofeed import FeedHandler
from cryptofeed.defines import TICKER


def utc_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_float(x):
    try:
        if x is None:
            return None
        return float(x)
    except Exception:
        return None


def resolve_exchange_class(name: str):
    # cryptofeed는 거래소별 클래스를 제공 :contentReference[oaicite:8]{index=8}
    # 환경/버전에 따라 클래스명 대소문자가 미세하게 다를 수 있어 후보들을 순차 탐색
    import cryptofeed.exchanges as ex

    candidates = [name, name.replace(".", ""), name.replace("-", "")]
    # 몇몇 케이스 보정
    if name.lower() in ("gate", "gateio", "gate.io"):
        candidates += ["Gateio", "GateIO", "Gate"]
    if name.lower() in ("kucoin",):
        candidates += ["KuCoin", "KUCOIN"]
    if name.lower() in ("coinbase", "coinbaseexchange", "coinbase_exchange"):
        candidates += ["Coinbase"]
    if name.lower() in ("htx", "huobi"):
        candidates += ["Huobi"]

    for c in candidates:
        if hasattr(ex, c):
            return getattr(ex, c)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", default="BTC-USDT", help='e.g. "BTC-USDT" (권장: 10개 거래소를 같은 쿼트로 맞추기)')
    ap.add_argument("--out", default="data/exchanges_1s.csv")
    args = ap.parse_args()

    out_csv = Path(args.out)
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    file_exists = out_csv.exists()

    latest = {}
    lock = threading.Lock()
    last_written_sec = {}

    # HTX는 Huobi 리브랜딩이어서 cryptofeed에서는 보통 Huobi 클래스를 사용
    exchange_names = [
        ("Binance", "BINANCE"),
        ("Coinbase", "COINBASE"),
        ("Upbit", "UPBIT"),
        ("OKX", "OKX"),
        ("Bybit", "BYBIT"),
        ("Bitget", "BITGET"),
        ("Gateio", "GATE"),
        ("KuCoin", "KUCOIN"),
        ("Huobi", "HTX"),
    ]

    async def on_ticker(*args, **kwargs):
        """
        cryptofeed TICKER 콜백은 버전에 따라 전달 형태가 다를 수 있어
        최대한 관대하게 파싱한다.
        """
        # 형태1: (ticker_obj, receipt_ts)
        if len(args) >= 1 and hasattr(args[0], "__dict__"):
            ticker_obj = args[0]
            ex_name = getattr(ticker_obj, "exchange", None) or getattr(ticker_obj, "feed", None) or "UNKNOWN"
            sym = getattr(ticker_obj, "symbol", args[1] if len(args) > 1 else "UNKNOWN")
            bid = safe_float(getattr(ticker_obj, "bid", None))
            ask = safe_float(getattr(ticker_obj, "ask", None))
            last = safe_float(getattr(ticker_obj, "last", None) or getattr(ticker_obj, "price", None))
        else:
            # 형태2(구버전 유사): (feed, symbol, bid, ask, ...)
            ex_name = str(args[0]) if len(args) > 0 else "UNKNOWN"
            sym = str(args[1]) if len(args) > 1 else "UNKNOWN"
            bid = safe_float(args[2]) if len(args) > 2 else None
            ask = safe_float(args[3]) if len(args) > 3 else None
            last = None

        price = None
        if bid is not None and ask is not None:
            price = (bid + ask) / 2.0
        elif last is not None:
            price = last
        elif bid is not None:
            price = bid
        elif ask is not None:
            price = ask

        if price is None:
            return

        now_ms = int(time.time() * 1000)
        with lock:
            latest[ex_name] = {
                "ts": utc_iso_now(),
                "ts_ms": now_ms,
                "symbol": sym,
                "bid": bid,
                "ask": ask,
                "price": float(price),
            }

    def writer_loop():
        nonlocal file_exists
        while True:
            now_ms = int(time.time() * 1000)
            now_sec = now_ms // 1000

            rows = []
            with lock:
                for ex_name, data in latest.items():
                    if last_written_sec.get(ex_name) == now_sec:
                        continue
                    last_written_sec[ex_name] = now_sec

                    rows.append([
                        data["ts"],
                        data["ts_ms"],
                        ex_name,
                        data["symbol"],
                        data["price"],
                        data["bid"],
                        data["ask"],
                    ])

            if rows:
                with out_csv.open("a", newline="") as f:
                    w = csv.writer(f)
                    if not file_exists and f.tell() == 0:
                        w.writerow(["ts", "ts_ms", "source", "symbol", "price", "bid", "ask"])
                        file_exists = True
                    w.writerows(rows)

            # 1초 경계에 최대한 맞춰서 기록
            time.sleep(max(0.05, 1.0 - (time.time() % 1.0)))

    t = threading.Thread(target=writer_loop, daemon=True)
    t.start()

    fh = FeedHandler()
    ticker_cb = {TICKER: on_ticker}

    for class_name, label in exchange_names:
        cls = resolve_exchange_class(class_name)
        if cls is None:
            print(f"[WARN] cryptofeed exchange class not found: {class_name} (skip)")
            continue

        # 심볼은 통일이 핵심. 거래소별 지원 마켓이 다르면 여기서 조정 필요.
        # 예: Coinbase는 BTC-USD도 많이 씀.
        fh.add_feed(cls(symbols=[args.symbol], channels=[TICKER], callbacks=ticker_cb))

    fh.run()


if __name__ == "__main__":
    main()
```

---

## 5) collectors/mexc_rest.py (MEXC 1초 폴링: /api/v3/ticker/price)

MEXC Spot V3 문서에 **`GET /api/v3/ticker/price`** 가 “Symbol Price Ticker”로 있고 응답은 `{symbol, price}` 형태야. ([MEXC][4])

```python
# collectors/mexc_rest.py
import argparse
import asyncio
import csv
import time
from datetime import datetime, timezone
from pathlib import Path

import aiohttp


def utc_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def main_async(symbol: str, out_csv: Path):
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    file_exists = out_csv.exists()

    url = "https://api.mexc.com/api/v3/ticker/price"  # :contentReference[oaicite:10]{index=10}
    params = {"symbol": symbol}

    async with aiohttp.ClientSession() as sess:
        while True:
            try:
                async with sess.get(url, params=params, timeout=5) as r:
                    j = await r.json()
                    price = float(j["price"])
                    now_ms = int(time.time() * 1000)

                    with out_csv.open("a", newline="") as f:
                        w = csv.writer(f)
                        if not file_exists and f.tell() == 0:
                            w.writerow(["ts", "ts_ms", "source", "symbol", "price"])
                            file_exists = True
                        w.writerow([utc_iso_now(), now_ms, "MEXC", symbol, price])

            except Exception:
                pass

            await asyncio.sleep(1.0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", default="BTCUSDT", help='MEXC REST symbol like "BTCUSDT"')
    ap.add_argument("--out", default="data/mexc_1s.csv")
    args = ap.parse_args()

    asyncio.run(main_async(args.symbol, Path(args.out)))


if __name__ == "__main__":
    main()
```

---

## 6) collectors/run_all.py (한 번에 실행)

```python
# collectors/run_all.py
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def p(*args):
    return subprocess.Popen([sys.executable, *args], cwd=str(ROOT))

def main():
    procs = []
    procs.append(p("collectors/rtds_chainlink.py", "--symbol", "btc/usd", "--out", "data/chainlink_1s.csv"))
    procs.append(p("collectors/exchanges_cryptofeed.py", "--symbol", "BTC-USDT", "--out", "data/exchanges_1s.csv"))
    procs.append(p("collectors/mexc_rest.py", "--symbol", "BTCUSDT", "--out", "data/mexc_1s.csv"))

    print("Collectors running. Ctrl+C to stop.")
    try:
        for pr in procs:
            pr.wait()
    except KeyboardInterrupt:
        for pr in procs:
            pr.terminate()

if __name__ == "__main__":
    main()
```

실행:

```bash
python collectors/run_all.py
```

---

## 7) dashboard/app.py (차트: 15분 시가 대비 현재가 + 10거래소 1초 + 임의 2거래소 스프레드)

```python
# dashboard/app.py
from pathlib import Path
import pandas as pd
import streamlit as st
import plotly.express as px

DATA_DIR = Path("data")

st.set_page_config(page_title="Polymarket 15m Oracle + 10 Exchanges", layout="wide")

@st.cache_data(ttl=2)
def load_csv(path: Path):
    if not path.exists():
        return pd.DataFrame()
    df = pd.read_csv(path)
    if "ts" in df.columns:
        df["ts"] = pd.to_datetime(df["ts"], utc=True, errors="coerce")
        df = df.dropna(subset=["ts"])
    return df

chainlink = load_csv(DATA_DIR / "chainlink_1s.csv")
ex9 = load_csv(DATA_DIR / "exchanges_1s.csv")
mexc = load_csv(DATA_DIR / "mexc_1s.csv")

# 표준화
def normalize(df, price_col="price"):
    if df.empty:
        return df
    out = df.copy()
    out["price"] = pd.to_numeric(out[price_col], errors="coerce")
    out = out.dropna(subset=["price"])
    out["source"] = out["source"].astype(str)
    out["symbol"] = out["symbol"].astype(str)
    return out

chainlink = normalize(chainlink)
ex9 = normalize(ex9)
mexc = normalize(mexc)

all_prices = pd.concat([chainlink, ex9, mexc], ignore_index=True)
if all_prices.empty:
    st.warning("아직 데이터가 없습니다. collectors를 먼저 실행하세요.")
    st.stop()

st.sidebar.header("필터")
hours = st.sidebar.slider("최근 N시간 보기", 1, 24, 2)
end = pd.Timestamp.utcnow().tz_localize("UTC")
start = end - pd.Timedelta(hours=hours)

df = all_prices[(all_prices["ts"] >= start) & (all_prices["ts"] <= end)].copy()
df = df.sort_values("ts")

# ----- 1) Chainlink 15분 "시가 대비 현재가" -----
st.title("Polymarket RTDS(Chainlink) + 10 Exchanges (1s)")

st.subheader("1) Chainlink(btc/usd) 15분 시가 대비 현재가 변화율")
cl = df[df["source"] == "POLYMARKET_RTDS_CHAINLINK"].copy()
if cl.empty:
    st.info("Chainlink 데이터가 없습니다 (chainlink_1s.csv 확인).")
else:
    cl = cl.set_index("ts").sort_index()
    # 15분 구간 시가(첫 값)
    window_open = cl["price"].groupby(pd.Grouper(freq="15min")).transform("first")
    cl["pct_from_15m_open"] = (cl["price"] / window_open) - 1.0
    fig1 = px.line(cl.reset_index(), x="ts", y=["price", "pct_from_15m_open"])
    st.plotly_chart(fig1, use_container_width=True)

# ----- 2) 10개 거래소 spot 1초 차트 -----
st.subheader("2) 거래소 Spot 1초 가격 차트")
# (참고) HTX는 Huobi로 수집될 수 있음
sources = sorted(df["source"].unique().tolist())
default_sel = [s for s in sources if s in ["BINANCE", "COINBASE", "OKX", "BYBIT", "HTX", "MEXC"]]
sel = st.multiselect("표시할 거래소(소스) 선택", sources, default=default_sel or sources[:3])

exdf = df[df["source"].isin(sel)].copy()
if exdf.empty:
    st.info("선택한 소스의 데이터가 없습니다.")
else:
    # source별 라인
    fig2 = px.line(exdf, x="ts", y="price", color="source")
    st.plotly_chart(fig2, use_container_width=True)

# ----- 3) 임의 2개 거래소 스프레드 -----
st.subheader("3) 임의 2개 거래소 가격 차이(Spread)")
col1, col2 = st.columns(2)
with col1:
    a = st.selectbox("거래소 A", sources, index=0)
with col2:
    b = st.selectbox("거래소 B", sources, index=min(1, len(sources)-1))

pivot = df.pivot_table(index="ts", columns="source", values="price").sort_index()
if a in pivot.columns and b in pivot.columns:
    spread = pd.DataFrame(index=pivot.index)
    spread["diff"] = pivot[a] - pivot[b]
    spread["pct"] = (pivot[a] / pivot[b]) - 1.0

    spread = spread.dropna()
    if spread.empty:
        st.info("두 소스가 같은 시점에 겹치는 데이터가 부족합니다.")
    else:
        fig3 = px.line(spread.reset_index(), x="ts", y=["diff", "pct"])
        st.plotly_chart(fig3, use_container_width=True)
else:
    st.info("선택한 소스 컬럼이 없습니다.")

st.subheader("4) 최신값 테이블")
latest = df.sort_values("ts").groupby("source").tail(1)[["source", "ts", "symbol", "price"]].sort_values("source")
st.dataframe(latest, use_container_width=True)
```

실행:

```bash
streamlit run dashboard/app.py
```

---

## 중요한 주의점 (안 헷갈리게 핵심만)

* RTDS `crypto_prices_chainlink`는 **“btc/usd”** 처럼 USD 기준 ([docs.polymarket.com][2])
* 거래소들은 **BTC-USDT / BTC-USD / BTC-KRW** 등 쿼트가 다를 수 있어. **스프레드 비교를 진짜로 하려면 쿼트를 통일(BTC-USDT 권장)** 해야 함.
* RTDS는 “시장가격 변동 시 업데이트”이고 payload timestamp(가격 시각)과 outer timestamp(전송 시각)가 다를 수 있다는 점도 문서에 명시돼 있어. ([docs.polymarket.com][2])

---

원하면, 너가 실제로 트레이딩하는 폴리마켓 마켓이 **BTC/USD 체인링크를 쓰는지, 혹은 특정 변형(예: 다른 피드/라운드)인지**까지 더 “정확히” 맞추려면:

1. 해당 마켓의 **resolution / price source 문구**(마켓 상세)랑
2. “price to beat / final price”가 찍히는 정확한 **시간(ET/KST)**
   이 2개를 주면, “그 시각의 오라클 라운드 값에 최대한 근접”하도록 리샘플링/정렬 로직(예: 가장 가까운 이전 값 vs 가장 가까운 값 vs 구간 평균)도 같이 깔끔하게 정리해줄게.

[1]: https://docs.polymarket.com/developers/RTDS/RTDS-overview "https://docs.polymarket.com/developers/RTDS/RTDS-overview"
[2]: https://docs.polymarket.com/developers/RTDS/RTDS-crypto-prices "https://docs.polymarket.com/developers/RTDS/RTDS-crypto-prices"
[3]: https://pypi.org/project/cryptofeed/ "https://pypi.org/project/cryptofeed/"
[4]: https://www.mexc.com/api-docs/spot-v3/market-data-endpoints "https://www.mexc.com/api-docs/spot-v3/market-data-endpoints"

질문: A) Polymarket RTDS(WebSocket)로 Chainlink 가격 스트림 받기 (무료/무인증)
해당 가격을 다 다운받고, 15분 기준으로 해당 가격의 시가랑 현개가를 비교하는 차트를 만들어줘.
Binance

Coinbase Exchange

Upbit

OKX

Bybit

Bitget

Gate

KuCoin

MEXC

HTX
그리고 이 10개의 거래소들의 spot 1초단위의 차트도 만들어주고, 임의의 두개의 거래소의 가격 차이를 나타낸 그래프를 보는 것도 가능하게 해줘.
