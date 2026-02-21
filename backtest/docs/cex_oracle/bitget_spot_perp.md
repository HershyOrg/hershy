가능해. **MYX/USDT 기준으로** Bitget 에서

* **스팟 MYXUSDT 1분봉**
* **USDT-M 선물(MYXUSDT Perpetual) 1분봉**

둘 다 REST API로 수집할 수 있어. (웹에서도 MYXUSDT 스팟/선물 마켓이 존재함) ([Bitget][1])

아래는 “심볼 확인 → 1분봉 백필(backfill) → CSV 저장”까지 한 번에.

---

## 0) 먼저 심볼이 진짜 있는지 API로 확인 (추천)

### 스팟 심볼 리스트

`GET /api/v2/spot/public/symbols` ([Bitget][2])

```bash
curl "https://api.bitget.com/api/v2/spot/public/symbols" | head
```

### USDT-M(선물) 컨트랙트 리스트

`GET /api/v2/mix/market/contracts?productType=usdt-futures` ([Bitget][3])

```bash
curl "https://api.bitget.com/api/v2/mix/market/contracts?productType=usdt-futures" | head
```

---

## 1) 1분봉 캔들 엔드포인트

### 스팟 1분봉

`GET /api/v2/spot/market/candles` (granularity=`1min`) ([Bitget][2])

### USDT-M 1분봉

`GET /api/v2/mix/market/candles` (productType=`usdt-futures`, granularity=`1m`) ([Bitget][3])

> 선물 캔들은 기본적으로 한 번에 반환 개수 제한(예: limit=100)과 레이트리밋(20 req/sec/IP)이 문서에 명시돼 있어서, 기간이 길면 시간 구간을 쪼개서 반복 호출하는 방식이 안전해. ([Bitget][3])

---

## 2) 파이썬 수집기 (MYXUSDT 스팟 + USDT-M, 1분봉)

아래 코드는 **시간 구간을 쪼개서** 1분봉을 계속 긁고, **중복(같은 ts)** 제거 후 CSV로 저장해.

```python
import time
import csv
import requests
from datetime import datetime, timezone, timedelta

BASE = "https://api.bitget.com"

def fetch_spot_1m(symbol: str, start_ms: int, end_ms: int):
    url = f"{BASE}/api/v2/spot/market/candles"
    params = {
        "symbol": symbol,
        "granularity": "1min",
        "startTime": start_ms,
        "endTime": end_ms,
    }
    r = requests.get(url, params=params, timeout=10)
    r.raise_for_status()
    j = r.json()
    return j.get("data", [])

def fetch_usdtm_1m(symbol: str, start_ms: int, end_ms: int, limit: int = 100):
    url = f"{BASE}/api/v2/mix/market/candles"
    params = {
        "symbol": symbol,
        "productType": "usdt-futures",
        "granularity": "1m",
        "startTime": start_ms,
        "endTime": end_ms,
        "limit": limit,
    }
    r = requests.get(url, params=params, timeout=10)
    r.raise_for_status()
    j = r.json()
    return j.get("data", [])

def normalize(rows):
    """
    Bitget 캔들은 보통 배열 형태: [ts, open, high, low, close, volume, ...]
    (엔드포인트/버전에 따라 뒤에 필드가 더 붙을 수 있어 앞부분만 사용)
    """
    out = []
    for row in rows:
        ts = int(row[0])
        o, h, l, c = row[1], row[2], row[3], row[4]
        v = row[5] if len(row) > 5 else None
        out.append((ts, o, h, l, c, v))
    return out

def backfill(fetch_fn, symbol: str, start_ms: int, end_ms: int, step_ms: int, sleep_s: float = 0.07):
    cur = start_ms
    buf = []
    while cur < end_ms:
        nxt = min(cur + step_ms, end_ms)
        rows = fetch_fn(symbol, cur, nxt)
        buf.extend(normalize(rows))
        cur = nxt
        time.sleep(sleep_s)  # 레이트리밋 여유(특히 선물은 20req/s/IP) :contentReference[oaicite:7]{index=7}

    # ts 기준 중복 제거 + 정렬
    d = {}
    for r in buf:
        d[r[0]] = r
    return [d[k] for k in sorted(d.keys())]

def save_csv(path: str, rows):
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["ts_ms", "open", "high", "low", "close", "volume"])
        w.writerows(rows)

if __name__ == "__main__":
    symbol = "MYXUSDT"

    # 예: 최근 24시간 (KST 기준)
    kst = timezone(timedelta(hours=9))
    end_dt = datetime.now(tz=kst)
    start_dt = end_dt - timedelta(days=1)

    start_ms = int(start_dt.timestamp() * 1000)
    end_ms = int(end_dt.timestamp() * 1000)

    # 6시간씩 쪼개면 1분봉 기준 최대 360개라 limit 잘림 위험이 적음(안전)
    step_ms = 6 * 60 * 60 * 1000

    spot = backfill(fetch_spot_1m, symbol, start_ms, end_ms, step_ms)
    save_csv("bitget_spot_MYXUSDT_1m.csv", spot)

    usdtm = backfill(fetch_usdtm_1m, symbol, start_ms, end_ms, step_ms)
    save_csv("bitget_usdtm_MYXUSDT_1m.csv", usdtm)

    print("saved rows:", len(spot), len(usdtm))
```

---

## 3) 자주 걸리는 문제 2개

1. **심볼 표기 확인**
   일단 웹 상으로는 MYXUSDT 스팟/선물이 존재해. ([Bitget][1])
   그래도 API에서 정확한 심볼명을 보려면 `/spot/public/symbols`, `/mix/market/contracts`로 확인하는 게 제일 확실해. ([Bitget][2])

2. **기간이 길면(예: 3개월) “구간 쪼개기”가 필수**
   limit/레이트리밋 때문에, 위처럼 6시간~12시간 단위로 쪼개서 백필하면 안정적이야. ([Bitget][3])

---

원하는 수집 기간이 “최근 30일”이야, 아니면 “상장 이후 전부”야?
기간만 정해주면, **자동으로 날짜를 쪼개서 끝까지 백필**(재시도/누락검증 포함)하는 완성형으로 더 다듬어줄게.

[1]: https://www.bitget.com/asia/spot/MYXUSDT?utm_source=chatgpt.com "5.3273 | MYXUSDT｜Live Spot Trading Price Chart"
[2]: https://www.bitget.com/api-doc/spot/market/Get-Symbols?utm_source=chatgpt.com "Get Symbol Info | Bitget API"
[3]: https://www.bitget.com/api-doc/contract/market/Get-All-Symbols-Contracts?utm_source=chatgpt.com "Get Contract Config | Bitget API"
응, **Bitget은 과거 캔들(OHLCV) 데이터를 공식 REST API로 제공**해. 그래서 “이전 캔들”도 받고, “가격 변화(수익률/변동)”도 캔들로 계산하면 돼.

---

## 1) 스팟(현물) 과거 캔들

**엔드포인트**

* `GET https://api.bitget.com/api/v2/spot/market/candles` ([Bitget][1])

**예시**

```bash
curl "https://api.bitget.com/api/v2/spot/market/candles?symbol=BTCUSDT&granularity=1min&startTime=1700000000000&endTime=1700003600000&limit=100"
```

* `startTime/endTime`: 밀리초(ms)
* `granularity`: 1min, 5min 등
* `limit`: 최대 100개(예시 기준) ([Bitget][1])

---

## 2) 선물(USDT-M/COIN-M/USDC-M) 과거 캔들

### (A) 일반 캔들

* `GET https://api.bitget.com/api/v2/mix/market/candles` ([Bitget][2])

예:

```bash
curl "https://api.bitget.com/api/v2/mix/market/candles?symbol=BTCUSDT&granularity=5m&limit=100&productType=usdt-futures"
```

여기서 중요한 제약: **과거 조회 가능 기간이 granularity별로 제한**돼 있어(예: 1m/3m/5m는 약 1개월, 1H는 ~83일 등). ([Bitget][2])

### (B) 더 긴 과거(히스토리) 캔들

* `GET https://api.bitget.com/api/v2/mix/market/history-candles` (최대 200개 반환) ([Bitget][3])

예:

```bash
curl "https://api.bitget.com/api/v2/mix/market/history-candles?symbol=BTCUSDT&granularity=1W&limit=200&productType=usdt-futures"
```

([Bitget][3])

---

## 3) “가격 변화”는 캔들로 이렇게 계산하면 됨

캔들의 `open, high, low, close`가 있으면:

* **구간 수익률(%)**:
  [
  r = \frac{close - open}{open} \times 100
  ]
* **로그수익률**(합치기 편함):
  [
  \ln(close/open)
  ]
* **변동성(요동)**: 짧은 구간 로그수익률의 표준편차 등

---

## 4) 파이썬으로 바로 받는 최소 예시 (스팟 1분봉)

```python
import os, time, requests

symbol = "BTCUSDT"
end_ms = int(time.time() * 1000)
start_ms = end_ms - 60*60*1000  # 최근 1시간

url = "https://api.bitget.com/api/v2/spot/market/candles"
params = {
    "symbol": symbol,
    "granularity": "1min",
    "startTime": start_ms,
    "endTime": end_ms,
    "limit": 100,
}
data = requests.get(url, params=params, timeout=10).json()
print(data)
```

(응답 포맷은 배열 형태로 오고, 그 안에 OHLCV가 들어있어서 파싱해서 쓰면 돼.) ([Bitget][1])

---

원하는 게 정확히 뭐야?

1. **스팟** BTCUSDT 같은 거야, 아니면 **선물(usdt-futures)**이야?
2. “이전 캔들”을 **몇 분봉(1m/15m/1h)**으로, **기간은 얼마나** 필요해? (예: 최근 30일 / 6개월)

이 두 개만 주면, 그 조건에 맞춰 **페이지네이션까지 포함해서** (기간 길어도) 자동으로 다 긁어서 CSV/Parquet로 저장하는 코드로 바로 맞춰줄게.

응, **그 말 그대로 가능해.** Bitget은 “공개 시장데이터”를 **인증 없이(무료로)** REST로 내려줘서, 과거 **캔들/체결/티커**를 쭉 모을 수 있어(단, 기간/개수 제한 때문에 구간을 쪼개서 호출해야 함).

아래는 **스팟 + USDT-M(선물)** 기준으로 “무슨 데이터를 어디서 받는지”를 딱 정리한 거야.

---

## 1) 캔들(OHLCV) 과거 다운로드

### 스팟 캔들

* `GET /api/v2/spot/market/candles` ([Bitget][1])
* `granularity`: `1min, 3min, 5min, 15min ...` 등 ([Bitget][1])

예시(MYXUSDT 1분봉):

```bash
curl "https://api.bitget.com/api/v2/spot/market/candles?symbol=MYXUSDT&granularity=1min&startTime=1700000000000&endTime=1700003600000"
```

### USDT-M 선물 캔들

* `GET /api/v2/mix/market/candles` ([Bitget][2])
* 1m/3m/5m는 **최대 1개월 구간까지 조회 가능**(요청에서 start~end 범위 제한) ([Bitget][2])
* 기본 100개 반환 ([Bitget][2])

예시(MYXUSDT, USDT-M, 1분봉):

```bash
curl "https://api.bitget.com/api/v2/mix/market/candles?symbol=MYXUSDT&productType=usdt-futures&granularity=1m&startTime=1700000000000&endTime=1700003600000&limit=100"
```

---

## 2) 체결(fills) / “시장 체결 히스토리” 과거 다운로드

### 스팟 최근 체결(짧게)

* `GET /api/v2/spot/market/fills` ([Bitget][3])

```bash
curl "https://api.bitget.com/api/v2/spot/market/fills?symbol=MYXUSDT&limit=100"
```

### 스팟 과거 체결(90일, 구간 제한 있음)

* `GET /api/v2/spot/market/fills-history` ([Bitget][4])
* **최근 90일 내 데이터**, 그리고 **startTime~endTime 간격은 7일 이내** ([Bitget][4])
* (그보다 오래된 건 웹에서 다운로드 안내가 붙어있음) ([Bitget][4])

```bash
curl "https://api.bitget.com/api/v2/spot/market/fills-history?symbol=MYXUSDT&limit=100&startTime=1700000000000&endTime=1700604800000"
```

### USDT-M 선물 과거 체결(90일, 구간 제한 있음)

* `GET /api/v2/mix/market/fills-history` ([Bitget][5])
* **최근 90일**, **start~end 7일 이내** ([Bitget][5])

```bash
curl "https://api.bitget.com/api/v2/mix/market/fills-history?symbol=MYXUSDT&productType=usdt-futures&limit=100&startTime=1700000000000&endTime=1700604800000"
```

---

## 3) 티커(현재가/24h 변화 등) 받기

### 스팟 티커

* `GET /api/v2/spot/market/tickers` ([Bitget][6])

```bash
curl "https://api.bitget.com/api/v2/spot/market/tickers?symbol=MYXUSDT"
```

### USDT-M 선물 티커

* 단일: `GET /api/v2/mix/market/ticker` ([Bitget][7])
* 전체: `GET /api/v2/mix/market/tickers` ([Bitget][8])

```bash
curl "https://api.bitget.com/api/v2/mix/market/ticker?productType=usdt-futures&symbol=MYXUSDT"
```

---

## “다운로드”를 실제로 하려면 이렇게 하면 됨

* **캔들**: 기간이 길면(예: 6개월) → `startTime/endTime`을 **며칠~몇시간 단위로 쪼개서** 반복 호출해서 CSV 저장
* **체결 히스토리**: **최근 90일만** API로 가능 + **7일씩 끊어서** 반복 호출 ([Bitget][4])
* **티커**: 실시간 모니터링이면 주기적으로 폴링(예: 1초/2초) 또는 WebSocket(원하면 그쪽도 붙여줄게)

---

원하는 “이전 데이터”가 딱 무엇인지 확인만 해줘:

1. MYXUSDT를 **최근 몇 개월**치 모을 거야? (예: 30일 / 180일 / 상장 이후 전부)
2. 캔들은 **1분봉만**이면 돼, 아니면 5분/15분도 같이?

기간만 정해주면, 스팟+USDT-M을 **자동으로 쪼개서 끝까지 백필하고 CSV/Parquet로 저장하는 스크립트**를 MYX 전용으로 바로 만들어줄게.

[4]: https://www.bitget.com/api-doc/spot/market/Get-Market-Trades?utm_source=chatgpt.com "Get Market Trades | Bitget API"
[5]: https://www.bitget.com/api-doc/contract/market/Get-Fills-History?utm_source=chatgpt.com "Get History Transactions | Bitget API"
[6]: https://www.bitget.com/api-doc/spot/market/Get-Tickers?utm_source=chatgpt.com "Get Ticker Information | Bitget API"
[7]: https://www.bitget.com/api-doc/contract/market/Get-Ticker?utm_source=chatgpt.com "Get Ticker | Bitget API"
[8]: https://www.bitget.com/api-doc/contract/market/Get-All-Symbol-Ticker?utm_source=chatgpt.com "Get All Tickers | Bitget API"
