응, **가능해** ✅
폴리마켓은 **WebSocket(실시간 스트리밍)** 으로 “가격이 변동할 때마다” **현재가(최우선 bid/ask)** 를 푸시로 받을 수 있어.

---

## ✅ 방법: Polymarket CLOB WebSocket (Market Channel) 구독

폴리마켓 CLOB는 `market` 채널에서 토큰(=YES/NO, Up/Down)의 **best bid/ask** 변화를 실시간으로 보내줘. ([docs.polymarket.com][1])
그리고 WebSocket 피드 레이턴시는 대략 **~100ms 수준**으로 안내돼 있어. ([docs.polymarket.com][2])

### 받아야 하는 이벤트

* `best_bid_ask`: **best bid / best ask가 바뀔 때마다** emit ([docs.polymarket.com][3])
  (이게 너가 원하는 “현재 매수가/매도가” 그 자체임)

> 참고: 문서에 `best_bid_ask`는 `custom_feature_enabled` 플래그 뒤에 있다고 적혀있어. ([docs.polymarket.com][3])

---

## ✅ 파이썬 예시: “가격 변동할 때마다 best ask(=즉시 매수가) 출력”

```python
# pip install websocket-client
from websocket import WebSocketApp
import json, threading, time

WSS_BASE = "wss://ws-subscriptions-clob.polymarket.com"
CHANNEL = "market"

# 여기에 UP / DOWN 토큰ID 넣기 (asset_id, token_id)
ASSET_IDS = [
    "UP_TOKEN_ID",
    "DOWN_TOKEN_ID",
]

def on_message(ws, message: str):
    if message == "PONG":
        return

    try:
        data = json.loads(message)
    except Exception:
        return

    # best bid/ask 변경 이벤트
    if data.get("event_type") == "best_bid_ask":
        token_id = data["asset_id"]
        best_bid = float(data["best_bid"])
        best_ask = float(data["best_ask"])
        ts = int(data["timestamp"])
        print(f"[{ts}] token={token_id}  best_bid={best_bid:.4f}  best_ask={best_ask:.4f}")

def on_open(ws):
    # market 채널 구독 (custom_feature_enabled True 권장)
    sub = {
        "type": CHANNEL,
        "assets_ids": ASSET_IDS,
        "custom_feature_enabled": True,
    }
    ws.send(json.dumps(sub))

    # keepalive ping
    def ping():
        while True:
            ws.send("PING")
            time.sleep(10)

    threading.Thread(target=ping, daemon=True).start()

def on_error(ws, err):
    print("WS error:", err)

def on_close(ws, code, msg):
    print("WS closed:", code, msg)

if __name__ == "__main__":
    url = f"{WSS_BASE}/ws/{CHANNEL}"  # 문서 예시와 동일한 형태 :contentReference[oaicite:4]{index=4}
    ws = WebSocketApp(url, on_open=on_open, on_message=on_message, on_error=on_error, on_close=on_close)
    ws.run_forever()
```

이렇게 돌리면 **호가가 바뀔 때마다 바로 best_ask(best 매수가)** 가 찍혀.

---

## 🔥 토큰ID(UP/DOWN token_id)는 어디서 구하냐?

너가 보고 있는 마켓의 **UP/Down(=YES/NO) 토큰ID**만 알아오면 끝인데,
보통은

* Gamma API로 마켓 조회해서 outcomes & token_id 확인
  또는
* UI에서 해당 토큰의 asset_id 확인
  하는 식으로 가져와.

---

원하면 네가 보고 있는 **폴리마켓 마켓 링크(slug)** 하나 던져줘.
내가 그걸로 **UP/DOWN token_id 자동 추출 → WebSocket 실시간 현재가 스트리밍까지** 한 번에 돌아가게 코드 완성해줄게.

[1]: https://docs.polymarket.com/developers/CLOB/websocket/wss-overview?utm_source=chatgpt.com "WSS Overview"
[2]: https://docs.polymarket.com/developers/market-makers/data-feeds?utm_source=chatgpt.com "Data Feeds"
[3]: https://docs.polymarket.com/developers/CLOB/websocket/market-channel?utm_source=chatgpt.com "Market Channel"
응 **바이낸스도 완전 가능해.**
폴리마켓처럼 **“변동할 때마다 현재가를 푸시로 받는 방식”**이 WebSocket으로 지원돼.

---

## ✅ 바이낸스에서 “변동할 때마다 현재가” 받는 대표 스트림 2개

### 1) **best bid/ask = 진짜 ‘지금 체결 가능한’ 현재가 느낌**

**`<symbol>@bookTicker`**

* best bid(매도가격) / best ask(매수가격) 이 바뀔 때마다 이벤트가 옴
* 오더북 최상단만 필요하면 이게 제일 가볍고 빠름

**Spot 예시 (BTCUSDC):**

```
wss://stream.binance.com:9443/ws/btcusdc@bookTicker
```

(심볼은 무조건 lowercase) ([developers.binance.com][1])

---

### 2) “캔들(OHLC)”이 변할 때마다 받고 싶으면

**`<symbol>@kline_1m`** (또는 5m,1h 등)

* 1분봉 진행 중에도 계속 업데이트가 옴
* “캔들 기준 현재 상태”가 필요하면 이걸 쓰면 됨

---

## ✅ 파이썬 예시: 가격 변동할 때마다 best bid/ask 출력

```python
# pip install websockets
import asyncio, json, websockets

SYMBOL = "btcusdc"  # lowercase!
URL = f"wss://stream.binance.com:9443/ws/{SYMBOL}@bookTicker"

async def main():
    async with websockets.connect(URL, ping_interval=20, ping_timeout=20) as ws:
        while True:
            msg = await ws.recv()
            data = json.loads(msg)

            best_bid = float(data["b"])   # best bid price
            best_ask = float(data["a"])   # best ask price
            bid_qty  = float(data["B"])
            ask_qty  = float(data["A"])

            print(f"{SYMBOL.upper()}  bid={best_bid}({bid_qty})  ask={best_ask}({ask_qty})")

asyncio.run(main())
```

이거 돌리면 **호가가 바뀌는 순간마다 바로 출력**돼.

---

## ✅ 여러 심볼을 “한 번에” 받고 싶으면 (combined stream)

예: BTCUSDC + ETHUSDC

```
wss://stream.binance.com:9443/stream?streams=btcusdc@bookTicker/ethusdc@bookTicker
```

Combined stream은 payload가 `{"stream": "...", "data": {...}}`로 감싸져서 와. ([developers.binance.com][1])

---

## ✅ (선물) Binance Futures도 동일하게 가능

USD-M 선물 base는 `wss://fstream.binance.com` 쪽이야. ([developers.binance.com][2])
여기도 `<symbol>@bookTicker` / `<symbol>@depth@100ms` 다 지원.

---

원하면 내가 너가 쓰는 형태에 맞춰서

* **Up/Down처럼 2개 토큰 동시 모니터링**
* **스프레드/괴리율 계산**
* **특정 임계값(예: ask가 0.51 넘으면 알림/매수)**

까지 바로 붙여줄게.
지금 원하는 심볼이 **BTCUSDC** 맞아? 아니면 **BTCUSDT**로 할까?

응 **BTCUSDC spot도 “변동할 때마다”** 실시간으로 받아올 수 있어 ✅
바이낸스는 **WebSocket 스트림**으로 계속 푸시해줌.

---

## ✅ 1) “현재 매수가/매도가(최우선 호가)”가 바뀔 때마다 받기 (추천)

이게 폴리마켓에서 말한 **best bid/ask**랑 똑같은 개념이야.

**bookTicker 스트림**

```
wss://stream.binance.com:9443/ws/btcusdc@bookTicker
```

* `b` = best bid price (가장 비싼 매수호가)
* `a` = best ask price (가장 싼 매도호
가능해 ✅
폴리마켓에서 **“시장가(Market)로 긁을 때 들어가는 가격”**을 스트림으로 받으려면, 핵심은 이거야:

* **시장가 매수(Market Buy)** = 오더북 **asks(매도호가)** 를 위에서부터 먹음
* 그래서 “들어가는 가격”은 보통

  1. **최우선 매수가(best ask)** (소량이면 거의 이 가격으로 체결)
  2. **내 주문 수량 기준 예상 체결 평균가(VWAP)** (물량 크면 슬리피지 반영)
     둘 중 하나로 정의해.

폴리마켓은 WebSocket `market` 채널에서 **오더북/호가 변동을 실시간으로** 줘서, 너가 원하는 형태로 계산해서 출력할 수 있어. ([Polymarket Documentation][1])

---

# 1) 스트림에서 받아야 할 것 (Polymarket CLOB WebSocket)

### ✅ (A) `best_bid_ask`

“지금 당장 시장가로 소량 매수하면 사실상 이 가격”
→ **best_ask**가 바로 “현재 매수가”로 보면 됨

### ✅ (B) `book` + `price_change`

“큰 수량 시장가로 긁을 때 평균 체결가(VWAP) 계산”

* `book`: 풀 오더북 스냅샷
* `price_change`: 오더북 변경분(새 주문/취소 반영)

문서에 메시지 스키마까지 나와있어. ([Polymarket Documentation][1])

---

# 2) 파이썬 예시: “시장가 매수 예상 체결 평균가(VWAP)”를 **변동 때마다 출력**

아래 코드는:

* WebSocket으로 `market` 구독
* `book / price_change / best_bid_ask` 로컬 오더북 유지
* **내가 시장가로 X shares 매수하면 예상 평균가**를 매번 계산해서 출력

```python
# pip install websockets orjson
import asyncio, orjson, websockets

WSS = "wss://ws-subscriptions-clob.polymarket.com/ws/market"

ASSET_ID = "YOUR_TOKEN_ID"  # 예: UP 토큰 id
TARGET_SHARES = 200.0       # 시장가로 살 물량(share 단위)

book = {"bids": {}, "asks": {}}  # price(str) -> size(float)

def set_side(side_map, levels):
    side_map.clear()
    for lv in levels:
        p = lv["price"]
        s = float(lv["size"])
        if s > 0:
            side_map[p] = s

def apply_price_change(pc):
    # pc: {asset_id, price, size, side, ...}
    side = pc["side"]  # "BUY" or "SELL"
    price = pc["price"]
    size = float(pc["size"])

    # Polymarket convention: side=="SELL" affects asks, side=="BUY" affects bids
    side_map = book["asks"] if side == "SELL" else book["bids"]
    if size <= 0:
        side_map.pop(price, None)
    else:
        side_map[price] = size

def vwap_market_buy(shares: float):
    """시장가 매수: asks를 싼 가격부터 소비"""
    if shares <= 0:
        return None

    asks_sorted = sorted(((float(p), s) for p, s in book["asks"].items()), key=lambda x: x[0])
    remaining = shares
    cost = 0.0

    for price, size in asks_sorted:
        take = min(remaining, size)
        cost += take * price
        remaining -= take
        if remaining <= 1e-9:
            return cost / shares

    # 오더북이 얕아서 다 못 샀음
    filled = shares - remaining
    return (cost / filled) if filled > 0 else None

async def ping_loop(ws, interval=10):
    while True:
        await asyncio.sleep(interval)
        await ws.send("PING")

async def main():
    async with websockets.connect(WSS) as ws:
        # 구독
        await ws.send(orjson.dumps({
            "type": "market",
            "assets_ids": [ASSET_ID],
            "custom_feature_enabled": True
        }).decode())

        asyncio.create_task(ping_loop(ws))

        best_ask = None

        while True:
            msg = await ws.recv()
            if msg == "PONG":
                continue

            data = orjson.loads(msg)
            et = data.get("event_type")

            if et == "book":
                # 전체 스냅샷
                set_side(book["bids"], data.get("bids", []))
                set_side(book["asks"], data.get("asks", []))

            elif et == "price_change":
                # 변경분 반영
                for pc in data.get("price_changes", []):
                    if pc.get("asset_id") == ASSET_ID:
                        apply_price_change(pc)
                        # 메시지에 best_bid/best_ask가 같이 딸려올 수도 있음 :contentReference[oaicite:2]{index=2}
                        if "best_ask" in pc:
                            best_ask = float(pc["best_ask"])

            elif et == "best_bid_ask":
                if data.get("asset_id") == ASSET_ID:
                    best_ask = float(data["best_ask"])

            # 계산 출력 (오더북 업데이트가 있을 때마다)
            if et in ("book", "price_change", "best_bid_ask"):
                est = vwap_market_buy(TARGET_SHARES)
                if est is not None:
                    print(f"[{et}] best_ask={best_ask}  market_buy_VWAP({TARGET_SHARES} sh)={est:.4f}")
                else:
                    print(f"[{et}] best_ask={best_ask}  (insufficient asks depth)")

asyncio.run(main())
```

---

# 3) 너가 얻는 값(정리)

* `best_ask`
  → **지금 “한 번에 긁기” 위한 즉시 매수가(최상단 호가)**

* `market_buy_VWAP(n shares)`
  → **n shares를 시장가로 긁으면 평균적으로 이 가격 근처로 체결될 것**
  (슬리피지 반영 ✅)

---

# 4) 참고: WebSocket 데이터 레벨

폴리마켓은 MM용으로 WebSocket(약 100ms), Gamma API(약 1s) 정도로 구분해서 안내하고 있어. ([Polymarket Documentation][2])

---

원하면 내가 이걸 **UP/DOWN 두 토큰 동시에** 붙여서

* UP 시장가 매수가
* DOWN 시장가 매수가
* 두 개 스프레드 / 역전(arb) 시그널
  까지 한 번에 찍히게 만들어줄게.
  (토큰ID만 2개 넣으면 끝)

