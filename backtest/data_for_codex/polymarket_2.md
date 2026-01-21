가능. 폴리마켓 CLOB에서 **“시장가 매수”는 별도 Market 주문이 아니라, *즉시 체결 가능한(limit이지만 marketable)* 주문**을 넣는 방식이야. ([Polymarket Documentation][1])
그리고 TS/Python SDK에 **“시장가 편의 함수”**가 있어서 그걸 쓰면 가장 깔끔해. ([Polymarket Documentation][2])

아래는 네가 준 slug:

`bitcoin-up-or-down-january-18-6am-et`

---

# 1) 먼저 slug → token_id(=clobTokenId) 뽑기 (Gamma API)

`enableOrderBook=true`인 경우에만 CLOB 주문 가능해. ([Polymarket Documentation][3])

```bash
curl -s "https://gamma-api.polymarket.com/markets?slug=bitcoin-up-or-down-january-18-6am-et"
```

응답 JSON에서 보통 이런 값이 나와:

* `enableOrderBook`
* `clobTokenIds` (Up/Down 토큰 2개)

> `enableOrderBook`이 false면 아직 오더북이 안 열려서 주문 자체가 불가.

---

# 2) “시장가로 긁기” (가장 쉬운 방법: TS SDK 1줄)

문서에 **createAndPostMarketOrder()**가 “지금 바로 시장가로 사고팔 때” 쓰라고 되어있어. (기본 FOK) ([Polymarket Documentation][2])

### TypeScript 예시 (UP 토큰을 $25 시장가 매수)

```ts
import { ClobClient, Side, OrderType } from "@polymarket/clob-client"; 
// 패키지명은 환경에 따라 다를 수 있음 (네 프로젝트에 맞게 import만 조정)

const host = "https://clob.polymarket.com";
const chainId = 137; // Polygon

const privateKey = process.env.PK!;
const funder = process.env.FUNDER!; // 보통 자금 주소(EOA면 본인 주소)

const tokenId = process.env.UP_TOKEN_ID!; // Gamma에서 뽑은 clobTokenId
const dollars = 25; // 시장가로 $25 매수

const client = new ClobClient(host, chainId, privateKey, { funder });

await client.createAndPostMarketOrder(
  {
    tokenId,
    amount: dollars,   // "달러 단위"로 매수 (시장가)
    side: Side.BUY,
  },
  undefined,
  OrderType.FOK // 전량 즉시 체결 아니면 실패(안전)
);
```

* `OrderType.FOK`: 전량 즉시 체결 아니면 실패 ([Polymarket Documentation][4])
* `OrderType.FAK`: 가능한 만큼 즉시 체결 + 나머지는 취소

---

# 3) Python으로 “시장가 매수” (py-clob-client)

폴리마켓은 `POST /order`가 있지만, **서명/헤더(L2 creds) 과정이 복잡**해서 SDK 사용을 권장해. ([Polymarket Documentation][5])

```py
from py_clob_client.client import ClobClient
from py_clob_client.clob_types import MarketOrderArgs, OrderType
from py_clob_client.order_builder.constants import BUY

HOST = "https://clob.polymarket.com"
CHAIN_ID = 137

PRIVATE_KEY = "0xYOUR_PRIVATE_KEY"
FUNDER = "0xYOUR_FUNDER_ADDRESS"

UP_TOKEN_ID = "YOUR_UP_CLOB_TOKEN_ID"  # Gamma에서 추출
USDC_AMOUNT = 25.0                     # $25 시장가 매수

client = ClobClient(
    HOST,
    key=PRIVATE_KEY,
    chain_id=CHAIN_ID,
    signature_type=0,
    funder=FUNDER
)

client.set_api_creds(client.create_or_derive_api_creds())

mo = MarketOrderArgs(
    token_id=UP_TOKEN_ID,
    amount=USDC_AMOUNT,   # 달러 단위
    side=BUY,
    order_type=OrderType.FOK
)

signed = client.create_market_order(mo)
resp = client.post_order(signed, OrderType.FOK)
print(resp)
```

(이 SDK는 `post_order` 형태로 주문을 올리는 예시가 공식 repo에 있어.) ([GitHub][6])

---

# 4) 참고: “진짜 REST curl 1방”은 거의 불가능한 이유

CLOB 주문은 `POST /order`로 보내지만 **L2 헤더 + EIP-712 서명된 payload**가 필요해서, 단순 curl만으로는 사실상 못해. ([Polymarket Documentation][1])
그래서 Polymarket도 **TS/Python/Go 라이브러리 사용**을 권장하고 있어. ([Polymarket Documentation][5])

---

# (중요) 이 마켓은 15분 BTC Up/Down이라 시장가(taker) 수수료 있을 수 있음

시장가로 긁으면 **taker**로 처리되는 경우가 많고, 15분 크립토 마켓은 taker fee 정책이 따로 있는 편이야(메이커 리베이트 재원). ([Polymarket Documentation][7])

---

원하면 내가 **네 슬러그에서 Up/Down token_id를 자동으로 뽑고**,
`enableOrderBook=true` 확인까지 한 다음에 **FOK 시장가 매수까지 “한 파일로 실행”**되는 스크립트로 만들어줄게.

[1]: https://docs.polymarket.com/developers/CLOB/orders/create-order?utm_source=chatgpt.com "Place Single Order"
[2]: https://docs.polymarket.com/developers/CLOB/clients/methods-l2?utm_source=chatgpt.com "L2 Methods"
[3]: https://docs.polymarket.com/developers/gamma-markets-api/get-markets?utm_source=chatgpt.com "Get Markets"
[4]: https://docs.polymarket.com/developers/CLOB/orders/create-order-batch?utm_source=chatgpt.com "Place Multiple Orders (Batching)"
[5]: https://docs.polymarket.com/developers/CLOB/orders/orders?utm_source=chatgpt.com "Orders Overview"
[6]: https://github.com/Polymarket/py-clob-client?utm_source=chatgpt.com "Python client for the Polymarket CLOB"
[7]: https://docs.polymarket.com/developers/market-makers/trading?utm_source=chatgpt.com "Trading"

맞아. 그 “BTC/ETH Up or Down (15분/1시간)” 계열은 **YES/NO 버튼이 아니라 `Up` / `Down`을 사는 시장**이야.

근데 구조는 똑같이 **“이진(binary) 시장”**이라서, 실제로는:

* **YES = Up**
* **NO = Down**

처럼 생각하면 돼. (UI만 다르게 보여주는 거)

폴리마켓 설명도 이 시장은 **끝 가격이 시작 가격 이상이면 Up, 아니면 Down**으로 결정된다고 명확히 써있어. ([Polymarket][1])

---

## 그럼 “어떻게 사는 거냐?”

### ✅ 1) Up을 산다

* “이 구간에서 BTC가 **오르거나 같을 것**”에 베팅
* 결과가 Up이면 **1주당 $1**로 정산

### ✅ 2) Down을 산다

* “이 구간에서 BTC가 **내릴 것**”에 베팅
* 결과가 Down이면 **1주당 $1**로 정산

즉, 너는 **YES/NO가 아니라 Up/Down 토큰을 ‘share’로 사는 것**이야.

---

## 주문 방식은 CLOB(오더북) 똑같음

이 시장도 “Up/Down” 각각이 **서로 다른 clobTokenId**를 가지고 있고,
그 토큰에 대해 **지정가/시장가(=marketable limit)로 매수/매도**하는 구조야.

예를 들면 Up을 “시장가로 긁는다”는 건:

> Up 토큰의 `token_id`로 **즉시 체결 가능한 가격(limit)을 넣어서 BUY** 한다

---

## “왜 YES/NO로 못 사게 해놨냐?”

그냥 UX 차이야.

* 일반 이벤트는 “YES/NO”가 직관적이고
* 이건 시간 구간에 대한 방향성이어서 “Up/Down”이 더 직관적이라서 그렇게 보여주는 것뿐

---

## 추가로 중요한 것: 이 시장은 만료가 초단기라 “0.99 양방향 아비트라지”가 자주 나옴

사람들이 Up+Down을 같이 사서 합이 $1보다 싸면 수익 나는 구조를 노리기도 해. ([GitHub][2])

---

원하면 네가 지금 보는 특정 슬러그(예: `bitcoin-up-or-down-january-18-6am-et`) 기준으로
**Gamma에서 Up/Down token_id 뽑고 → Up을 시장가로 긁는 API 호출까지** “완성 코드”로 바로 적어줄게.

