가능해. 폴리마켓은 “시장가 주문”이 **진짜 Market 타입**으로 따로 있는 게 아니라, **오더북에서 바로 체결될 만큼 “시장가로 체결 가능한(limit이지만 marketable)” 주문**을 넣는 방식이야. ([docs.polymarket.com][1])좋아, 이제 실전이야. 실제로 폴리마
그리고 파이썬/TS 클라이언트에는 **시장가 편의 함수(createAndPostMarketOrder / create_market_order)**도 제공돼. ([docs.polymarket.com][2])

> ⚠️ 참고: 네가 준 링크(“Bitcoin Up or Down - January 17, 5AM ET”)는 지금 날짜(2026-01-19 기준)로는 **이미 종료된 Past 시장**이라서, 동일 슬러그로 주문을 넣으면 **거래 불가(거절)**가 날 수 있어. 그래도 “API로 시장가 매수 넣는 법” 자체는 아래 그대로면 됨.

---

## 0) 1단계: 이 마켓의 `token_id`(clobTokenId) 구하기

폴리마켓 주문은 **event URL이 아니라 “token_id(=clobTokenId)”**로 들어가.

Gamma API에서 slug로 조회하면 응답에 `clobTokenIds`가 들어있어. ([docs.polymarket.com][3])

```bash
curl "https://gamma-api.polymarket.com/markets?slug=bitcoin-up-or-down-january-17-5am-et"
```

응답에서 보통 이런 필드가 나옴:

* `clobTokenIds: ["<UP_TOKEN_ID>", "<DOWN_TOKEN_ID>"]`
* `outcomes: ["Up","Down"]` 같은 식

---

## 1) 파이썬: “시장가 매수” 한 방에 넣기 (py-clob-client)

공식 파이썬 클라이언트가 있고, **MarketOrderArgs로 시장가 주문** 넣을 수 있어. ([GitHub][4])
CLOB 엔드포인트는 `https://clob.polymarket.com`, 체인은 Polygon(137)이야. ([GitHub][4])

```python
from py_clob_client.client import ClobClient
from py_clob_client.clob_types import MarketOrderArgs, OrderType
from py_clob_client.order_builder.constants import BUY

HOST = "https://clob.polymarket.com"
CHAIN_ID = 137

PRIVATE_KEY = "0xYOUR_PRIVATE_KEY"
FUNDER = "0xYOUR_FUNDER_ADDRESS"   # 보통 자금 들어있는 주소(EOA면 본인 주소)

UP_TOKEN_ID = "1234567890"        # Gamma API에서 가져온 clobTokenId(Up)
USDC_AMOUNT = 25.0                # $25만큼 시장가 매수

client = ClobClient(
    HOST,
    key=PRIVATE_KEY,
    chain_id=CHAIN_ID,
    signature_type=0,             # 일반 EOA면 0 / 이메일(Magic) 계열이면 1 (환경 따라 다름)
    funder=FUNDER
)

# L2 API creds 세팅 (주문/취소에 필요)
client.set_api_creds(client.create_or_derive_api_creds())  # :contentReference[oaicite:5]{index=5}

# 시장가(즉시 체결) 주문
mo = MarketOrderArgs(
    token_id=UP_TOKEN_ID,
    amount=USDC_AMOUNT,
    side=BUY,
    order_type=OrderType.FOK      # FOK = 즉시 전량 체결 아니면 실패 (안전)
)

signed = client.create_market_order(mo)                    # :contentReference[oaicite:6]{index=6}
resp = client.post_order(signed, OrderType.FOK)            # :contentReference[oaicite:7]{index=7}
print(resp)
```

### ✅ FOK / FAK 차이

* **FOK**: 전량 즉시 체결 아니면 “주문 실패” (미체결 잔량 남기기 싫을 때)
* **FAK**: 가능한 만큼 즉시 체결 + 나머지는 취소

---

## 2) TypeScript: `createAndPostMarketOrder()` 쓰는 방식

폴리마켓 문서에 **createAndPostMarketOrder()**가 “바로 시장가로 사고팔고 싶을 때” 쓰라고 명시돼 있어. ([docs.polymarket.com][2])

흐름은:

1. `tokenId` 준비
2. `createAndPostMarketOrder({ tokenId, amount, side })`

(정확한 TS 코드는 너 프로젝트 스택/지갑 타입(EOA vs Safe/프록시)에 따라 달라서, 원하면 네 auth 방식에 맞춰서 그대로 붙여넣기 가능한 샘플로 짜줄게.)

---

## 3) 수수료 주의: 15분 크립토 마켓이면 “taker fee” 있음

일반 시장은 대부분 수수료 0인데, **15분 크립토 Up/Down 류는 taker fee(시장가/즉시체결)가 붙을 수 있음**. ([docs.polymarket.com][5])

---

## 너한테 필요한 것 딱 2개만 말해줘

1. **Up을 살 거야 / Down을 살 거야?**
2. **$로 얼마만큼 시장가 매수?** (예: 25 USDC)

그러면 내가 위 코드에 **해당 slug에서 tokenId 자동으로 뽑아서** (Gamma API → clobTokenIds 매핑)
**“시장가 매수 1번에 실행되는 완성 코드”**로 만들어줄게.

[1]: https://docs.polymarket.com/developers/CLOB/orders/create-order?utm_source=chatgpt.com "Place Single Order"
[2]: https://docs.polymarket.com/developers/CLOB/clients/methods-l2?utm_source=chatgpt.com "L2 Methods"
[3]: https://docs.polymarket.com/quickstart/fetching-data?utm_source=chatgpt.com "Fetching Market Data"
[4]: https://github.com/Polymarket/py-clob-client "GitHub - Polymarket/py-clob-client: Python client for the Polymarket CLOB"
[5]: https://docs.polymarket.com/polymarket-learn/trading/fees?utm_source=chatgpt.com "Trading Fees"
가능해. **폴리마켓 오더북 모니터링은 “가능”**하고, 심지어 **WebSocket으로 거의 실시간(Level2) 업데이트**까지 받을 수 있어. ✅ ([Polymarket Documentation][1])

다만 폴리마켓 구조가 **오프체인 오더북 + 온체인 정산**이라서, 모니터링은 **CLOB API/WS(오프체인)** 로 하는 게 정석이야. ([Polymarket Documentation][2])

---

## 1) 오더북 모니터링 방법 2가지

### A) REST 폴링(느리지만 간단)

* `GET /book?token_id=...` 로 현재 호가창 스냅샷 받기 ([Polymarket Documentation][3])
* 단점: 초단타엔 느림/호출 많아짐

### B) WebSocket 구독(추천, 실시간)

* **CLOB WebSocket**: `wss://ws-subscriptions-clob.polymarket.com/ws/` ([Polymarket Documentation][3])
* 채널:

  * `market` (공개): 오더북/가격 업데이트(Level2) ([Polymarket Documentation][4])
  * `user` (인증): 내 주문/체결 상태 ([Polymarket Documentation][5])

---

## 2) “오더북이 안 열려있으면” 모니터링도 제한됨

`enableOrderBook=false`면 그 토큰은 CLOB에서 book 자체가 없을 수 있어(404 등). ([Polymarket Documentation][2])
그래서 **Gamma에서 enableOrderBook 확인 → true면 WS 구독** 이 흐름이 제일 안정적.

---

## 3) WebSocket으로 오더북 모니터링 (Python 예시)

(핵심: `market` 채널 구독 + token_id 목록)

```python
import json
import websocket

WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/"
TOKEN_ID = "YOUR_CLOB_TOKEN_ID"

def on_open(ws):
    sub = {
        "type": "subscribe",
        "channel": "market",
        "token_ids": [TOKEN_ID],
    }
    ws.send(json.dumps(sub))

def on_message(ws, message):
    msg = json.loads(message)
    # msg["type"]가 book / best_bid_ask / last_trade_price 등으로 옴
    print(msg.get("type"), msg.get("data"))

ws = websocket.WebSocketApp(
    WS_URL,
    on_open=on_open,
    on_message=on_message,
)

ws.run_forever()
```

> `market` 채널에서 `book`, `best_bid_ask`, `last_trade_price`, `tick_size_change` 같은 업데이트 타입을 받을 수 있어. ([Polymarket Documentation][4])

---

## 4) “내 주문 체결/취소 상태”까지 모니터링하고 싶으면

`user` 채널을 쓰면 됨 (인증 필요). ([Polymarket Documentation][5])
이건 봇 만들 때 **오더 상태 추적(체결됐는지/부분체결인지)**에 유용해.

---

### 결론

✅ 폴리마켓 오더북 모니터링 **가능**
✅ 실시간은 **CLOB WebSocket market 채널**이 정답 ([Polymarket Documentation][1])
⚠️ 단, **enableOrderBook=false면 애초에 오더북이 없음** ([Polymarket Documentation][2])

원하면 네가 보는 **15분 BTC/ETH 마켓** 기준으로

* Gamma에서 `clobTokenId` 자동 추출
* `enableOrderBook` true 되는 순간 감지
* WS로 오더북 구독 → 즉시 시장가(=marketable limit) 진입
  이 풀 파이프라인 코드로 바로 짜줄게.
가능해. 폴리마켓은 “시장가 주문”이 **진짜 Market 타입**으로 따로 있는 게 아니라, **오더북에서 바로 체결될 만큼 “시장가로 체결 가능한(limit이지만 marketable)” 주문**을 넣는 방식이야. ([docs.polymarket.com][1])좋아, 이제 실전이야. 실제로 폴리마
그리고 파이썬/TS 클라이언트에는 **시장가 편의 함수(createAndPostMarketOrder / create_market_order)**도 제공돼. ([docs.polymarket.com][2])

> ⚠️ 참고: 네가 준 링크(“Bitcoin Up or Down - January 17, 5AM ET”)는 지금 날짜(2026-01-19 기준)로는 **이미 종료된 Past 시장**이라서, 동일 슬러그로 주문을 넣으면 **거래 불가(거절)**가 날 수 있어. 그래도 “API로 시장가 매수 넣는 법” 자체는 아래 그대로면 됨.

---

## 0) 1단계: 이 마켓의 `token_id`(clobTokenId) 구하기

폴리마켓 주문은 **event URL이 아니라 “token_id(=clobTokenId)”**로 들어가.

Gamma API에서 slug로 조회하면 응답에 `clobTokenIds`가 들어있어. ([docs.polymarket.com][3])

```bash
curl "https://gamma-api.polymarket.com/markets?slug=bitcoin-up-or-down-january-17-5am-et"
```

응답에서 보통 이런 필드가 나옴:

* `clobTokenIds: ["<UP_TOKEN_ID>", "<DOWN_TOKEN_ID>"]`
* `outcomes: ["Up","Down"]` 같은 식

---

## 1) 파이썬: “시장가 매수” 한 방에 넣기 (py-clob-client)

공식 파이썬 클라이언트가 있고, **MarketOrderArgs로 시장가 주문** 넣을 수 있어. ([GitHub][4])
CLOB 엔드포인트는 `https://clob.polymarket.com`, 체인은 Polygon(137)이야. ([GitHub][4])

```python
from py_clob_client.client import ClobClient
from py_clob_client.clob_types import MarketOrderArgs, OrderType
from py_clob_client.order_builder.constants import BUY

HOST = "https://clob.polymarket.com"
CHAIN_ID = 137

PRIVATE_KEY = "0xYOUR_PRIVATE_KEY"
FUNDER = "0xYOUR_FUNDER_ADDRESS"   # 보통 자금 들어있는 주소(EOA면 본인 주소)

UP_TOKEN_ID = "1234567890"        # Gamma API에서 가져온 clobTokenId(Up)
USDC_AMOUNT = 25.0                # $25만큼 시장가 매수

client = ClobClient(
    HOST,
    key=PRIVATE_KEY,
    chain_id=CHAIN_ID,
    signature_type=0,             # 일반 EOA면 0 / 이메일(Magic) 계열이면 1 (환경 따라 다름)
    funder=FUNDER
)

# L2 API creds 세팅 (주문/취소에 필요)
client.set_api_creds(client.create_or_derive_api_creds())  # :contentReference[oaicite:5]{index=5}

# 시장가(즉시 체결) 주문
mo = MarketOrderArgs(
    token_id=UP_TOKEN_ID,
    amount=USDC_AMOUNT,
    side=BUY,
    order_type=OrderType.FOK      # FOK = 즉시 전량 체결 아니면 실패 (안전)
)

signed = client.create_market_order(mo)                    # :contentReference[oaicite:6]{index=6}
resp = client.post_order(signed, OrderType.FOK)            # :contentReference[oaicite:7]{index=7}
print(resp)
```

### ✅ FOK / FAK 차이

* **FOK**: 전량 즉시 체결 아니면 “주문 실패” (미체결 잔량 남기기 싫을 때)
* **FAK**: 가능한 만큼 즉시 체결 + 나머지는 취소

---

## 2) TypeScript: `createAndPostMarketOrder()` 쓰는 방식

폴리마켓 문서에 **createAndPostMarketOrder()**가 “바로 시장가로 사고팔고 싶을 때” 쓰라고 명시돼 있어. ([docs.polymarket.com][2])

흐름은:

1. `tokenId` 준비
2. `createAndPostMarketOrder({ tokenId, amount, side })`

(정확한 TS 코드는 너 프로젝트 스택/지갑 타입(EOA vs Safe/프록시)에 따라 달라서, 원하면 네 auth 방식에 맞춰서 그대로 붙여넣기 가능한 샘플로 짜줄게.)

---

## 3) 수수료 주의: 15분 크립토 마켓이면 “taker fee” 있음

일반 시장은 대부분 수수료 0인데, **15분 크립토 Up/Down 류는 taker fee(시장가/즉시체결)가 붙을 수 있음**. ([docs.polymarket.com][5])

---

## 너한테 필요한 것 딱 2개만 말해줘

1. **Up을 살 거야 / Down을 살 거야?**
2. **$로 얼마만큼 시장가 매수?** (예: 25 USDC)

그러면 내가 위 코드에 **해당 slug에서 tokenId 자동으로 뽑아서** (Gamma API → clobTokenIds 매핑)
**“시장가 매수 1번에 실행되는 완성 코드”**로 만들어줄게.

가능해. **폴리마켓 오더북 모니터링은 “가능”**하고, 심지어 **WebSocket으로 거의 실시간(Level2) 업데이트**까지 받을 수 있어. ✅ ([Polymarket Documentation][1])

다만 폴리마켓 구조가 **오프체인 오더북 + 온체인 정산**이라서, 모니터링은 **CLOB API/WS(오프체인)** 로 하는 게 정석이야. ([Polymarket Documentation][2])

---

## 1) 오더북 모니터링 방법 2가지

### A) REST 폴링(느리지만 간단)

* `GET /book?token_id=...` 로 현재 호가창 스냅샷 받기 ([Polymarket Documentation][3])
* 단점: 초단타엔 느림/호출 많아짐

### B) WebSocket 구독(추천, 실시간)

* **CLOB WebSocket**: `wss://ws-subscriptions-clob.polymarket.com/ws/` ([Polymarket Documentation][3])
* 채널:

  * `market` (공개): 오더북/가격 업데이트(Level2) ([Polymarket Documentation][4])
  * `user` (인증): 내 주문/체결 상태 ([Polymarket Documentation][5])

---

## 2) “오더북이 안 열려있으면” 모니터링도 제한됨

`enableOrderBook=false`면 그 토큰은 CLOB에서 book 자체가 없을 수 있어(404 등). ([Polymarket Documentation][2])
그래서 **Gamma에서 enableOrderBook 확인 → true면 WS 구독** 이 흐름이 제일 안정적.

---

## 3) WebSocket으로 오더북 모니터링 (Python 예시)

(핵심: `market` 채널 구독 + token_id 목록)

```python
import json
import websocket

WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/"
TOKEN_ID = "YOUR_CLOB_TOKEN_ID"

def on_open(ws):
    sub = {
        "type": "subscribe",
        "channel": "market",
        "token_ids": [TOKEN_ID],
    }
    ws.send(json.dumps(sub))

def on_message(ws, message):
    msg = json.loads(message)
    # msg["type"]가 book / best_bid_ask / last_trade_price 등으로 옴
    print(msg.get("type"), msg.get("data"))

ws = websocket.WebSocketApp(
    WS_URL,
    on_open=on_open,
    on_message=on_message,
)

ws.run_forever()
```

> `market` 채널에서 `book`, `best_bid_ask`, `last_trade_price`, `tick_size_change` 같은 업데이트 타입을 받을 수 있어. ([Polymarket Documentation][4])

---

## 4) “내 주문 체결/취소 상태”까지 모니터링하고 싶으면

`user` 채널을 쓰면 됨 (인증 필요). ([Polymarket Documentation][5])
이건 봇 만들 때 **오더 상태 추적(체결됐는지/부분체결인지)**에 유용해.

---

### 결론

✅ 폴리마켓 오더북 모니터링 **가능**
✅ 실시간은 **CLOB WebSocket market 채널**이 정답 ([Polymarket Documentation][1])
⚠️ 단, **enableOrderBook=false면 애초에 오더북이 없음** ([Polymarket Documentation][2])

원하면 네가 보는 **15분 BTC/ETH 마켓** 기준으로

* Gamma에서 `clobTokenId` 자동 추출
* `enableOrderBook` true 되는 순간 감지
* WS로 오더북 구독 → 즉시 시장가(=marketable limit) 진입
  이 풀 파이프라인 코드로 바로 짜줄게.
