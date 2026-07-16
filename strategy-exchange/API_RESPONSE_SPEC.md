# Strategy Exchange API Response Spec

프론트 기준 API base URL은 `VITE_API_BASE_URL`이다.
예: `VITE_API_BASE_URL=https://api.thirdeye.xyz`이면 `/api/strategy-exchange/strategies`는 `https://api.thirdeye.xyz/api/strategy-exchange/strategies`로 호출된다.

공통 규칙:

- 모든 응답은 JSON.
- 금액 필드는 숫자 USD 기준이다. 예: `strategyEquity: 70770`은 `$70,770`.
- 비율 필드는 두 방식이 섞여 있다.
  - `leaderFraction`, `leaderCommission`, `sharePct`, `weight`: `0.1`이 `10%`.
  - `pnlPct`, `projectedApr`, `winRate`, `maxDrawdown`: `8.9`가 `8.9%`.
- 시간은 ISO string을 권장한다. 전략 피드에서는 `status`, `traders`, `createdAt`을 사용하지 않는다.
- 현재 프론트 schema 때문에 `endpoint`, `sql` 필드는 응답에 포함하는 것이 안전하다. 실서버에서 SQL을 노출하지 않을 경우 `sql: ""`로 내려도 된다.
- Not found는 404보다 `200` + nullable payload를 권장한다. 현재 UI는 `adapter: null`, `account: null`을 처리한다.

## 1. Strategy Feed

전략 카드 피드와 상단 랭킹 정렬에 사용된다.

`GET /api/strategy-exchange/strategies`

Query:

```ts
{
  category: "Featured" | "Perp Index" | "Funding Carry" | "Market Neutral" | "Tactical Quant";
  type: "All" | "Index" | "Quant";
  includeUnconnected: "true" | "false";
  q?: string;
  connected?: string[]; // repeated query param: connected=Hyperliquid
}
```

Response:

```ts
{
  endpoint: string;
  request: {
    category: "Featured" | "Perp Index" | "Funding Carry" | "Market Neutral" | "Tactical Quant";
    type: "All" | "Index" | "Quant";
    query: string;
    includeUnconnected: boolean;
    connectedVenues?: string[];
  };
  strategies: Strategy[];
  total: number;
}
```

`Strategy`:

```ts
{
  id: string;
  title: string;
  creatorId: string;
  primarySector: "Perp Index" | "Funding" | "Basis" | "Market Neutral" | "Momentum" | "Liquidity" | "Volatility" | "Risk Hedge";
  sectors: Array<"Perp Index" | "Funding" | "Basis" | "Market Neutral" | "Momentum" | "Liquidity" | "Volatility" | "Risk Hedge">;
  productType: "Index" | "Quant";
  disclosure: "Full" | "PerformanceOnly";
  venues: string[];
  chains: string[];
  markets: string[];
  assetClasses: string[];
  pnlSeries: number[];
  realizedPnl: number;
  pnlPct: number;
  deployedCapital: number;
  dailyVolume: number;
  winRate: number;
  maxDrawdown: number;
  nodes: Array<{ id: string; label: string; x: number; y: number }>;
  edges: Array<{ from: string; to: string; label: string }>;
}
```

Example:

```json
{
  "endpoint": "/api/strategy-exchange/strategies?category=Featured&type=All&includeUnconnected=false&connected=Hyperliquid",
  "request": {
    "category": "Featured",
    "type": "All",
    "query": "",
    "includeUnconnected": false,
    "connectedVenues": ["Hyperliquid"]
  },
  "strategies": [
    {
      "id": "hl-majors-index",
      "title": "Hyperliquid Majors Index",
      "creatorId": "nari.trade",
      "primarySector": "Perp Index",
      "sectors": ["Perp Index"],
      "productType": "Index",
      "disclosure": "Full",
      "venues": ["Hyperliquid"],
      "chains": ["Hyperliquid"],
      "markets": ["Hyperliquid Perp DEX"],
      "assetClasses": ["BTC", "ETH", "SOL", "HYPE perps"],
      "pnlSeries": [0, 420, 760, 610, 1240, 1680, 2090, 2510, 3110, 3860, 4380, 5120],
      "realizedPnl": 5120,
      "pnlPct": 7.9,
      "deployedCapital": 119000,
      "dailyVolume": 440000,
      "winRate": 72,
      "maxDrawdown": 3.4,
      "nodes": [{ "id": "weights", "label": "Public Weights", "x": 34, "y": 78 }],
      "edges": [{ "from": "weights", "to": "btc", "label": "35%" }]
    }
  ],
  "total": 1
}
```

Notes:

- `markets`, `assetClasses`는 `disclosure: "PerformanceOnly"`인 퀀트 상품에서도 제공한다.
- 이 두 필드는 정확한 매매 로직이나 실시간 구성비가 아니라 투자자가 상품의 거래 범위를 이해하기 위한 high-level universe 정보다.

## 2. Adapter Metadata

개별 adapter 상세 페이지, AUM/NAV 차트, Performance, Adapter Ledger, Use allocation 계산에 사용된다.

현재 프론트 route는 `/:address`이고, 주소가 adapter address이면 아래 API를 호출한다.

`GET /api/strategy-exchange/adapter-addresses/:address`

전략 ID로 조회하는 fallback endpoint도 있다.

`GET /api/strategy-exchange/adapters/:strategyId`

Response:

```ts
{
  endpoint: string;
  sql: string;
  adapter: StrategyAdapterMetadata | null;
}
```

`StrategyAdapterMetadata`:

```ts
{
  strategyId: string;
  address: string;
  leaderAddress: string;
  leaderFraction: number;
  leaderCommission: number;
  projectedApr: number;
  strategyEquity: number;
  allTimePnl: number;
  chains: string[];
  updatedAt: string;
  periods: Array<{
    strategyId: string;
    label: "24h" | "7d" | "30d" | "All";
    pnl: number;
    equity: number;
    volume: number;
  }>;
  balances: Array<{
    strategyId: string;
    token: string;
    venue: string;
    chain: string;
    amount: number;
    value: number;
    weight: number;
    sortOrder: number;
  }>;
  positions: Array<{
    strategyId: string;
    coin: string;
    side: "Long" | "Short";
    size: number;
    entryPrice: number;
    markPrice: number;
    liquidationPrice: number;
    marginUsed: number;
    unrealizedPnl: number;
    fundingRate: number; // 0.0001 = 0.01%
    leverage: number;
    sortOrder: number;
  }>;
  trades: Array<{
    strategyId: string;
    id: string;
    actor: "Logic Creator" | "User";
    accountLabel: string;
    action: "Open" | "Close" | "Increase" | "Reduce";
    coin: string;
    side: "Long" | "Short";
    price: number;
    size: number;
    value: number;
    fee: number;
    pnl: number;
    createdAt: string;
    sortOrder: number;
  }>;
  funding: Array<{
    strategyId: string;
    id: string;
    coin: string;
    side: "Long" | "Short";
    rate: number; // 0.0001 = 0.01%
    payment: number;
    createdAt: string;
    sortOrder: number;
  }>;
  flows: Array<{
    strategyId: string;
    id: string;
    type: "Deposit" | "Withdrawal";
    accountLabel: string;
    amount: number;
    createdAt: string;
    sortOrder: number;
  }>;
  depositors: Array<{
    strategyId: string;
    id: string;
    maskedAddress: string;
    equity: number;
    sharePct: number;
    pnl: number;
    joinedAt: string;
    sortOrder: number;
  }>;
}
```

Notes:

- `strategyEquity`가 UI의 `AUM`.
- `MAX AUM`은 현재 프론트에서 `strategyEquity * 2`로 임시 계산한다. 백엔드가 별도 값으로 내려줄 수 있으면 `maxAum` 추가를 권장한다.
- Use allocation UI는 입금 자산을 USDC로 고정한다. 현재 primary execution venue는 Hyperliquid다.
- `balances`, `positions`, `trades`, `funding`, `flows`, `depositors`는 Adapter 상세의 tabbed ledger 패널에 사용된다.
- `depositors`는 프론트에 전체 주소를 내려주지 않는다. `maskedAddress`만 내려주고 full address 필드는 포함하지 않는다.
- 현재 더미 데이터의 `balances.venue`, `balances.chain`은 모두 `Hyperliquid`다.

Example:

```json
{
  "endpoint": "/api/strategy-exchange/adapter-addresses/0xe70c2de5482bb9b071d58a4fb22905edfd93b385",
  "sql": "",
  "adapter": {
    "strategyId": "hl-majors-index",
    "address": "0xe70c2de5482bb9b071d58a4fb22905edfd93b385",
    "leaderAddress": "0x751c7566baf4fec0be6edf0d479b5bf73a68918f",
    "leaderFraction": 0.742,
    "leaderCommission": 0.1,
    "projectedApr": 42.4,
    "strategyEquity": 128400,
    "allTimePnl": 9400,
    "chains": ["Hyperliquid"],
    "updatedAt": "2026-06-07T07:00:00.000Z",
    "periods": [
      { "strategyId": "hl-majors-index", "label": "24h", "pnl": 680, "equity": 128400, "volume": 440000 },
      { "strategyId": "hl-majors-index", "label": "7d", "pnl": 2460, "equity": 127260, "volume": 3080000 }
    ],
    "balances": [
      { "strategyId": "hl-majors-index", "token": "BTC-PERP", "venue": "Hyperliquid", "chain": "Hyperliquid", "amount": 0.661, "value": 44940, "weight": 0.35, "sortOrder": 1 },
      { "strategyId": "hl-majors-index", "token": "ETH-PERP", "venue": "Hyperliquid", "chain": "Hyperliquid", "amount": 10.7, "value": 38520, "weight": 0.3, "sortOrder": 2 }
    ],
    "positions": [
      { "strategyId": "hl-majors-index", "coin": "BTC", "side": "Long", "size": 0.661, "entryPrice": 66776, "markPrice": 68000, "liquidationPrice": 48960, "marginUsed": 4943, "unrealizedPnl": 809, "fundingRate": -0.00014, "leverage": 3, "sortOrder": 1 }
    ],
    "trades": [
      { "strategyId": "hl-majors-index", "id": "hl-majors-index-trade-1", "actor": "Logic Creator", "accountLabel": "Creator Logic", "action": "Open", "coin": "BTC", "side": "Long", "price": 67728, "size": 0.119, "value": 8058, "fee": 2.82, "pnl": 0, "createdAt": "2026-06-07T07:48:00.000Z", "sortOrder": 1 }
    ],
    "funding": [
      { "strategyId": "hl-majors-index", "id": "hl-majors-index-funding-1", "coin": "BTC", "side": "Long", "rate": -0.00011, "payment": -4.94, "createdAt": "2026-06-07T07:30:00.000Z", "sortOrder": 1 }
    ],
    "flows": [
      { "strategyId": "hl-majors-index", "id": "hl-majors-index-flow-deposit-1", "type": "Deposit", "accountLabel": "User Allocation", "amount": 4366, "createdAt": "2026-06-07T07:40:00.000Z", "sortOrder": 1 }
    ],
    "depositors": [
      { "strategyId": "hl-majors-index", "id": "hl-majors-index-depositor-1", "maskedAddress": "0x7421...91ce", "equity": 9502, "sharePct": 0.074, "pnl": 452, "joinedAt": "2026-06-06T20:00:00.000Z", "sortOrder": 1 }
    ]
  }
}
```

## 2.1 Adapter Chart Data

Adapter 상세 상단 차트와 ETF형 분석 차트에 사용된다.
현재 프론트는 `strategy.pnlSeries`, `adapter.strategyEquity`, `adapter.allTimePnl`, `adapter.balances`로 일부 차트를 임시 파생해서 그리고 있다.
실제 백엔드 연결 시에는 아래 chart API로 내려주는 것을 권장한다.

Important:

- 차트 종류와 최종 데이터 포맷은 아직 확정되지 않았다.
- 아래 response shape는 현재 프론트/디자인 기준의 working draft다.
- 백엔드 구현 전 chart format은 변동될 수 있으며, 특히 `composition`, `premiumDiscount`, `netFlow`, `drawdown`은 제품 결정에 따라 필드가 바뀔 수 있다.
- 우선 확정에 가까운 것은 상단 `navSharePrice` 시계열이다.

`GET /api/strategy-exchange/adapter-addresses/:address/charts`

Query:

```ts
{
  interval: "1m" | "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "8h" | "1day" | "1month";
	  charts?: Array<
	    | "navSharePrice"
	    | "premiumDiscount"
	    | "composition"
    | "netFlow"
    | "drawdown"
  >;
  from?: string;
  to?: string;
}
```

Response:

```ts
{
  endpoint: string;
  request: {
    interval: "1m" | "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "8h" | "1day" | "1month";
    charts: string[];
    from?: string;
    to?: string;
  };
  adapterAddress: string;
  strategyId: string;
  currency: "USD";
  charts: {
    navSharePrice: {
      label: "NAV / Share Price";
      unit: "USD";
      series: Array<{
        time: string;
        navPerShare: number;
        sharePrice: number;
      }>;
    };
    premiumDiscount?: {
      label: "Premium / Discount";
      unit: "percent";
      series: Array<{
        time: string;
        navPerShare: number;
        marketPrice: number;
        premiumDiscountPct: number;
      }>;
    };
    composition?: {
      label: "Composition";
      unit: "percent";
      series: Array<{
        time: string;
        assets: Array<{
          token: string;
          chain: string;
          valueUsd: number;
          weight: number;
        }>;
      }>;
    };
    netFlow?: {
      label: "Net Flow";
      unit: "USD";
      series: Array<{
        time: string;
        useUsd: number;
        dropUsd: number;
        netUsd: number;
      }>;
    };
    drawdown?: {
      label: "Drawdown";
      unit: "percent";
      series: Array<{
        time: string;
        value: number;
      }>;
    };
  };
  updatedAt: string;
}
```

Chart meaning:

- `navSharePrice`
  - 현재 상단 메인 차트.
  - ETF 상세의 핵심값인 NAV와 거래/표시 share price를 함께 보여준다.
  - `navPerShare`는 adapter AUM과 share supply로 계산한 기준 가격, `sharePrice`는 화면에 표시할 현재 가격이다.
- `premiumDiscount`
  - ETF 성격을 가장 잘 보여주는 차트.
  - `premiumDiscountPct = (marketPrice - navPerShare) / navPerShare * 100`.
  - adapter share가 NAV 대비 비싸게/싸게 거래되는지 보여준다.
- `composition`
  - ETF 구성자산 비중 변화.
  - 프론트에서는 stacked area chart로 표현하는 것을 권장한다.
  - `weight`는 `0.46`이 `46%`.
- `netFlow`
  - Use/Drop 유입·유출.
  - 프론트에서는 bar chart 또는 positive/negative flow chart로 표현한다.
- `drawdown`
  - NAV 고점 대비 하락률.
  - 단위는 percent이며 일반적으로 `0` 이하 값으로 내려줘도 된다.

Example:

```json
{
  "endpoint": "/api/strategy-exchange/adapter-addresses/0xe70c2de5482bb9b071d58a4fb22905edfd93b385/charts?interval=1h",
  "request": {
    "interval": "1h",
    "charts": ["navSharePrice", "premiumDiscount", "composition", "netFlow"]
  },
  "adapterAddress": "0xe70c2de5482bb9b071d58a4fb22905edfd93b385",
  "strategyId": "hl-majors-index",
  "currency": "USD",
  "charts": {
    "navSharePrice": {
      "label": "NAV / Share Price",
      "unit": "USD",
      "series": [
        { "time": "2026-06-10T00:00:00.000Z", "navPerShare": 1.024, "sharePrice": 1.031 },
        { "time": "2026-06-10T01:00:00.000Z", "navPerShare": 1.028, "sharePrice": 1.021 },
        { "time": "2026-06-10T02:00:00.000Z", "navPerShare": 1.034, "sharePrice": 1.036 }
      ]
    },
    "premiumDiscount": {
      "label": "Premium / Discount",
      "unit": "percent",
      "series": [
        { "time": "2026-06-10T00:00:00.000Z", "navPerShare": 1.024, "marketPrice": 1.031, "premiumDiscountPct": 0.68 },
        { "time": "2026-06-10T01:00:00.000Z", "navPerShare": 1.028, "marketPrice": 1.021, "premiumDiscountPct": -0.68 }
      ]
    },
    "composition": {
      "label": "Composition",
      "unit": "percent",
      "series": [
        {
          "time": "2026-06-10T00:00:00.000Z",
          "assets": [
            { "token": "BTC-PERP", "chain": "Hyperliquid", "valueUsd": 44940, "weight": 0.35 },
            { "token": "HYPE-PERP", "chain": "Hyperliquid", "valueUsd": 19260, "weight": 0.15 }
          ]
        }
      ]
    },
    "netFlow": {
      "label": "Net Flow",
      "unit": "USD",
      "series": [
        { "time": "2026-06-10T00:00:00.000Z", "useUsd": 18000, "dropUsd": 4000, "netUsd": 14000 },
        { "time": "2026-06-10T01:00:00.000Z", "useUsd": 9000, "dropUsd": 12000, "netUsd": -3000 }
      ]
    }
  },
  "updatedAt": "2026-06-10T02:00:00.000Z"
}
```

Frontend mapping:

- 상단 메인 차트: `charts.navSharePrice.series`
- ETF premium/discount 분석: `charts.premiumDiscount.series`
- 구성자산 변화 stacked area: `charts.composition.series`
- Use/Drop 유입·유출: `charts.netFlow.series`

## 3. User By Address

`/:address`가 유저 EOA이면 프로필 페이지를 보여준다.

`GET /api/strategy-exchange/users/:address`

Response:

```ts
{
  endpoint: string;
  sql: string;
  account: {
    creatorId: string;
    eoaAddress: string;
    avatarUrl?: string;
    aliases: string[];
    joinedAt: string;
    socialLinks: {
      twitter?: string;
      github?: string;
    };
  } | null;
}
```

Example:

```json
{
  "endpoint": "/api/strategy-exchange/users/0xc93c835eec0bc130f9c78d6debe6b6b8393806c0",
  "sql": "",
  "account": {
    "creatorId": "quant.kim",
    "eoaAddress": "0xc93c835eec0bc130f9c78d6debe6b6b8393806c0",
    "avatarUrl": "https://api.dicebear.com/9.x/personas/svg?seed=quant.kim",
    "aliases": ["0x7C2F...A19F"],
    "joinedAt": "2026-02-14T00:00:00.000Z",
    "socialLinks": {
      "twitter": "https://x.com/quant_kim",
      "github": "https://github.com/quant-kim"
    }
  }
}
```

## 4. Adapter Activity

Removed from the investor-facing adapter detail page.

`GET /api/strategy-exchange/activity/adapters/:address` is no longer required because User Distribution and All Transactions are not shown in the current ETF-style product detail.

## 5. Adapter Discussion

Adapter 상세 페이지 토론 영역에 사용된다.

`GET /api/strategy-exchange/discussions/adapters/:address`

Response:

```ts
{
  endpoint: string;
  sql: string;
  messages: Array<{
    id: string;
    adapterAddress: string;
    authorName: string;
    authorAddress: string;
    body: string;
    createdAt: string;
    avatarUrl?: string;
  }>;
}
```

Notes:

- 현재 프론트 타입에는 `avatarUrl`이 없지만, 백엔드가 내려주면 추후 프론트 단순화에 좋다.
- 메시지 작성은 현재 local-only다. 실서버 연결 시 아래 endpoint를 추가하면 된다.

Recommended write endpoint:

`POST /api/strategy-exchange/discussions/adapters/:address/messages`

Request:

```ts
{
  authorAddress: string;
  body: string;
}
```

Response:

```ts
{
  endpoint: string;
  message: {
    id: string;
    adapterAddress: string;
    authorName: string;
    authorAddress: string;
    body: string;
    createdAt: string;
    avatarUrl?: string;
  };
}
```

## 6. User Logics

Launch Logic 페이지의 내 전략 목록/생성에 사용된다.

`GET /api/strategy-exchange/user-logics`

Response:

```ts
{
  endpoint: string;
  logics: Array<{
    id: string;
    name: string;
    description: string;
    strategyText: string;
    baseLogicId?: string;
    createdAt: string;
    updatedAt: string;
  }>;
  total: number;
}
```

`POST /api/strategy-exchange/user-logics`

Request:

```ts
{
  name: string;
  description: string;
  strategyText: string;
  baseLogicId: string;
}
```

Response:

```ts
{
  endpoint: string;
  logic: {
    id: string;
    name: string;
    description: string;
    strategyText: string;
    baseLogicId?: string;
    createdAt: string;
    updatedAt: string;
  };
}
```

## 7. User Profile Update

마이페이지 수정 화면에 사용된다.

`PATCH /api/strategy-exchange/users/:address/profile`

Request:

```ts
{
  name: string;
  handle: string;
  bio: string;
  avatarUrl: string;
  twitter: string;
  github: string;
  exchanges: string[];
  chains: string[];
}
```

Response:

```ts
{
  endpoint: string;
  profile: {
    creatorId: string;
    name: string;
    handle: string;
    bio: string;
    avatarUrl: string;
    twitter: string;
    github: string;
    exchanges: string[];
    chains: string[];
    updatedAt?: string;
  };
}
```

## 8. Not Yet Wired, But Needed Soon

현재 프론트에서는 Use/Drop/SCW Bridge 상태가 localStorage/local state다.
실제 연결 시에는 단순히 position만 바꾸는 API가 아니라 SCW adapter install/uninstall, Hershy runtime start/kill, bridge tx를 다뤄야 한다.

공통 원칙:

- 유저는 직접 컨트랙트를 실행하지 않고 signature/approval만 한다.
- 실제 SCW adapter install/uninstall tx는 백엔드 relayer 또는 infra가 실행한다.
- Use는 adapter install이 완료된 뒤 해당 adapter와 연결된 Hershy strategy code를 실행한다.
- Drop은 Hershy strategy code kill switch를 먼저 실행하고, 그 다음 유저 서명을 받아 adapter uninstall tx를 실행한다.
- Bridge는 실제 bridge tx request를 프론트에 보여주고, 유저 확인/서명 후 전송한다.

Recommended flow:

1. `prepare`
   - 백엔드가 adapter, SCW, calldata, EIP-712 typed data, 예상 tx 정보를 만든다.
   - 프론트는 이 응답을 보고 유저에게 approve/sign UI를 보여준다.
2. `execute`
   - 프론트가 유저 signature를 백엔드에 넘긴다.
   - 백엔드는 relayer로 SCW tx를 실행하고 operation/tx 상태를 내려준다.

### Signature Handoff Workflow

이 섹션은 API response 모양이 아니라 실제 서버/지갑/컨트랙트 사이에서 무엇이 오가는지 설명한다.

핵심은 `prepare -> wallet signature -> execute -> relayer -> SCW contract`다.
유저는 typed data에 서명만 하고, tx 전송은 relayer가 한다.

#### Use Handoff

Use에서 유저가 서명하는 것은 “내 SCW에 이 strategy adapter contract를 install하고, 이 USDC allocation으로 Hershy strategy code를 실행해도 된다”는 permission이다.

```txt
1. Frontend -> Backend API
   POST /api/strategy-exchange/adapter-addresses/:adapterAddress/use/prepare

   body:
   {
     userAddress,
     scwAddress,
     amountUsd,
     assetSymbol: "USDC",
     allocations
   }

2. Backend API 내부 처리
   - adapterAddress로 strategyId 조회
   - strategyId로 adapterContractAddress 조회
   - strategyId로 Hershy codeId/codeHash 조회
   - scwAddress의 chainId, nonce 조회
   - SCW에 보낼 install calldata 생성
   - signatureRequestId 생성 후 DB에 저장

3. Backend API -> Frontend
   response.signatureRequest 반환

   유저가 실제로 서명할 typed data message 예시:
   {
     purpose: "InstallStrategyAdapter",
     userAddress,
     scwAddress,
     adapterAddress,
     strategyId,
     adapterContractAddress,
     codeHash,
     amountUsd,
     allocationHash,
     nonce,
     deadline
   }

   response.installTxPreview 반환
   {
     to: scwAddress,
     data: installAdapter(adapterContractAddress, installCalldata),
     value: "0",
     chainId
   }

4. Frontend -> User Wallet
   wallet.signTypedData(signatureRequest.domain, signatureRequest.types, signatureRequest.message)

5. User Wallet -> Frontend
   signature 반환

6. Frontend -> Backend API
   POST /api/strategy-exchange/adapter-addresses/:adapterAddress/use/execute

   body:
   {
     userAddress,
     scwAddress,
     signatureRequestId,
     signature
   }

7. Backend API 내부 처리
   - signatureRequestId로 원본 typed data, install calldata, adapterContractAddress 조회
   - signature recover 결과가 userAddress인지 검증
   - deadline 만료 여부 검증
   - SCW nonce가 prepare 당시 nonce와 같은지 검증
   - allocationHash가 원본 allocations와 같은지 검증

8. Backend API -> Relayer
   relayer job 생성

   payload:
   {
     operationId,
     chainId,
     scwAddress,
     target: scwAddress,
     value: "0",
     data: installAdapter(adapterContractAddress, installCalldata),
     userSignature: signature,
     signatureRequestId
   }

9. Relayer -> SCW Contract
   tx 전송

   예시 contract call:
   SCW.executeWithSignature({
     target: scwAddress,
     value: 0,
     data: installAdapter(adapterContractAddress, installCalldata),
     signature
   })

10. SCW Contract
   - signature 검증
   - nonce consume
   - adapter install 실행

11. Backend API / Worker
   - tx confirmed 감지
   - Hershy Runtime에 code 실행 요청

   payload:
   {
     runId,
     codeId,
     codeHash,
     adapterAddress,
     strategyId,
     scwAddress,
     adapterContractAddress,
     amountUsd,
     allocations
   }

12. Hershy Runtime
   adapterAddress를 사용해 strategy code 실행 시작

13. Backend API -> Frontend
   operation, adapterInstall, hershyRuntime, position, transaction 상태 반환
```

#### Drop Handoff

Drop에서 유저가 서명하는 것은 “kill switch가 실행된 뒤 내 SCW에서 이 strategy adapter를 uninstall해도 된다”는 permission이다.
Drop은 순서가 중요하다. Hershy kill switch가 먼저고, adapter uninstall은 그 다음이다.

```txt
1. Frontend -> Backend API
   POST /api/strategy-exchange/adapter-addresses/:adapterAddress/drop/prepare

   body:
   {
     userAddress,
     scwAddress,
     reason
   }

2. Backend API -> Hershy Runtime
   먼저 kill switch 요청

   payload:
   {
     runId,
     adapterAddress,
     strategyId,
     scwAddress,
     adapterContractAddress,
     reason
   }

3. Hershy Runtime -> Backend API
   kill switch status 반환

   response:
   {
     runId,
     status: "Confirmed",
     txHash
   }

4. Backend API 내부 처리
   kill switch가 성공했을 때만 uninstall signatureRequest 생성
   - adapter uninstall calldata 생성
   - SCW nonce/chainId 조회
   - signatureRequestId 생성 후 DB에 저장

5. Backend API -> Frontend
   response.signatureRequest 반환

   유저가 실제로 서명할 typed data message 예시:
   {
     purpose: "UninstallStrategyAdapter",
     userAddress,
     scwAddress,
     adapterAddress,
     strategyId,
     adapterContractAddress,
     codeHash,
     killSwitchRunId,
     killSwitchTxHash,
     nonce,
     deadline
   }

   response.uninstallTxPreview 반환
   {
     to: scwAddress,
     data: uninstallAdapter(adapterContractAddress),
     value: "0",
     chainId
   }

6. Frontend -> User Wallet
   wallet.signTypedData(signatureRequest.domain, signatureRequest.types, signatureRequest.message)

7. User Wallet -> Frontend
   signature 반환

8. Frontend -> Backend API
   POST /api/strategy-exchange/adapter-addresses/:adapterAddress/drop/execute

   body:
   {
     userAddress,
     scwAddress,
     signatureRequestId,
     signature
   }

9. Backend API 내부 처리
   - signature recover 결과가 userAddress인지 검증
   - killSwitchRunId가 Confirmed 상태인지 재검증
   - deadline/nonce 검증

10. Backend API -> Relayer
   relayer job 생성

   payload:
   {
     operationId,
     chainId,
     scwAddress,
     target: scwAddress,
     value: "0",
     data: uninstallAdapter(adapterContractAddress),
     userSignature: signature,
     signatureRequestId
   }

11. Relayer -> SCW Contract
   tx 전송

   예시 contract call:
   SCW.executeWithSignature({
     target: scwAddress,
     value: 0,
     data: uninstallAdapter(adapterContractAddress),
     signature
   })

12. SCW Contract
   - signature 검증
   - nonce consume
   - adapter uninstall 실행

13. Backend API -> Frontend
   operation, killSwitch, adapterUninstall, position, transaction 상태 반환
```

#### Bridge Handoff

Bridge에서 유저가 서명하는 것은 “내 SCW에서 fromChain의 USDC를 bridge provider contract로 보내고, toChain SCW로 받을 수 있게 실행해도 된다”는 permission이다.

```txt
1. Frontend -> Backend API
   POST /api/strategy-exchange/scw/bridge-usdc/prepare

   body:
   {
     userAddress,
     scwAddress,
     fromChain,
     toChain,
     amountUsd,
     assetSymbol: "USDC"
   }

2. Backend API -> Bridge Provider / Quote API
   route quote 요청

   payload:
   {
     fromChain,
     toChain,
     token: "USDC",
     amountUsd,
     fromAddress: scwAddress,
     toAddress: scwAddress
   }

3. Bridge Provider -> Backend API
   route, fee, bridge target, calldata 반환

4. Backend API 내부 처리
   - source SCW USDC balance 조회
   - target SCW USDC balance 조회
   - bridge calldata 저장
   - signatureRequestId 생성 후 DB에 저장

5. Backend API -> Frontend
   response.route, response.bridgeTxPreview, response.signatureRequest 반환

   유저가 실제로 서명할 typed data message 예시:
   {
     purpose: "BridgeUSDC",
     userAddress,
     scwAddress,
     fromChain,
     toChain,
     bridgeProvider,
     bridgeTarget,
     amountUsd,
     estimatedFeeUsd,
     calldataHash,
     nonce,
     deadline
   }

   response.bridgeTxPreview 반환
   {
     to: bridgeProviderContract,
     data: bridgeCalldata,
     value,
     chainId: fromChainId
   }

6. Frontend -> User
   bridge route UI 표시
   - from chain
   - to chain
   - amount
   - fee
   - estimated received
   - bridge provider

7. Frontend -> User Wallet
   wallet.signTypedData(...) 또는 wallet.personalSign(...)

8. User Wallet -> Frontend
   signature 반환

9. Frontend -> Backend API
   POST /api/strategy-exchange/scw/bridge-usdc/execute

   body:
   {
     userAddress,
     scwAddress,
     signatureRequestId,
     signature
   }

10. Backend API 내부 처리
   - signature recover 결과 검증
   - calldataHash가 prepare 당시 bridge calldata와 같은지 검증
   - source balance가 아직 충분한지 재검증
   - deadline/nonce 검증

11. Backend API -> Relayer
   relayer job 생성

   payload:
   {
     operationId,
     chainId: fromChainId,
     scwAddress,
     target: bridgeProviderContract,
     value,
     data: bridgeCalldata,
     userSignature: signature,
     signatureRequestId
   }

12. Relayer -> SCW Contract
   tx 전송

   예시 contract call:
   SCW.executeWithSignature({
     target: bridgeProviderContract,
     value,
     data: bridgeCalldata,
     signature
   })

13. SCW Contract -> Bridge Provider Contract
   USDC bridge tx 실행

14. Backend Worker
   source txHash, destination fill/receive status 추적

15. Backend API -> Frontend
   transfer status, txHash, updated SCW balances 반환
```

### Contract Workflow Overview

Section 8의 API는 단순 CRUD가 아니다.
프론트, 백엔드, relayer, SCW contract, adapter contract, Hershy runtime이 함께 움직이는 transaction workflow다.

Actors:

```txt
User Wallet
  - 유저 서명만 담당한다.
  - adapter install/uninstall tx를 직접 보내지 않는다.

Frontend
  - prepare API를 호출한다.
  - 백엔드가 내려준 signatureRequest와 txPreview를 유저에게 보여준다.
  - 유저 signature를 execute API로 넘긴다.

Backend API
  - adapter address에 연결된 strategy, adapter, Hershy code를 resolve한다.
  - EIP-712 typed data와 calldata를 만든다.
  - signature를 검증한다.
  - relayer에게 tx 실행을 요청한다.
  - operation, runtime, position 상태를 저장한다.

Relayer / Infra
  - 유저 signature를 포함해 SCW contract call을 실행한다.
  - adapter install/uninstall, bridge tx 같은 on-chain tx를 실제로 전송한다.

SCW Contract
  - 유저의 smart contract wallet.
  - signed permission이 맞으면 adapter를 install/uninstall한다.
  - bridge tx 또는 adapter call을 실행한다.

Strategy Adapter Contract
  - 특정 adapter strategy와 Hershy code를 SCW에 연결하는 contract module.
  - install되면 해당 전략 실행 권한/라우팅/asset handling을 담당한다.

Hershy Runtime
  - adapter install 후 실제 strategy code를 실행한다.
  - Drop 시 kill switch를 먼저 실행해 전략 실행을 멈춘다.
```

Use Adapter contract flow:

```txt
1. Frontend -> Backend
   POST /adapter-addresses/:address/use/prepare
   userAddress, scwAddress, amountUsd, USDC allocations 전달

2. Backend
   adapter address -> strategyId resolve
   strategyId -> adapter contract resolve
   strategyId -> Hershy codeId/codeHash resolve
   SCW nonce/chainId 조회
   adapter install calldata 생성
   EIP-712 signatureRequest 생성

3. Backend -> Frontend
   signatureRequest + installTxPreview + hershyRuntime plan 반환

4. Frontend -> User Wallet
   "이 strategy adapter를 내 SCW에 install한다"는 approve/sign 요청 표시

5. User Wallet -> Frontend
   signature 반환

6. Frontend -> Backend
   POST /adapter-addresses/:address/use/execute
   signatureRequestId, signature 전달

7. Backend
   signature 검증
   signatureRequest 만료/nonce 재사용 여부 검증
   relayer에 SCW adapter install tx 요청

8. Relayer -> SCW Contract
   signed permission으로 installAdapter(adapter, calldata) 실행

9. SCW Contract -> Adapter Contract
   strategy adapter install 완료

10. Backend / Hershy Runtime
   install tx confirmed 후 adapterAddress를 붙여 Hershy strategy code 실행

11. Backend -> Frontend
   adapterInstall status, hershyRuntime status, position, activity transaction 반환
```

Drop Adapter contract flow:

```txt
1. Frontend -> Backend
   POST /adapter-addresses/:address/drop/prepare
   userAddress, scwAddress 전달

2. Backend / Hershy Runtime
   해당 user/scw/adapter에 연결된 running strategy runId 조회
   Hershy code kill switch 실행

3. Backend
   kill switch 성공 여부 확인
   adapter uninstall calldata 생성
   EIP-712 signatureRequest 생성

4. Backend -> Frontend
   killSwitch status + uninstallTxPreview + signatureRequest 반환

5. Frontend -> User Wallet
   "이 strategy adapter를 내 SCW에서 uninstall한다"는 approve/sign 요청 표시

6. User Wallet -> Frontend
   signature 반환

7. Frontend -> Backend
   POST /adapter-addresses/:address/drop/execute
   signatureRequestId, signature 전달

8. Backend
   kill switch가 완료됐는지 재검증
   signature 검증
   relayer에 SCW adapter uninstall tx 요청

9. Relayer -> SCW Contract
   signed permission으로 uninstallAdapter(adapter) 실행

10. Backend -> Frontend
   killSwitch status, adapterUninstall status, position, activity transaction 반환
```

SCW USDC Bridge contract flow:

```txt
1. Frontend -> Backend
   POST /scw/bridge-usdc/prepare
   fromChain, toChain, amountUsd 전달

2. Backend
   연결된 bridge provider에서 route quote 조회
   source/target SCW USDC balance 조회
   bridge tx target/calldata/fee/estimated time 생성
   signatureRequest 생성

3. Backend -> Frontend
   route, fee, from/to balance afterTransfer, bridgeTxPreview 반환

4. Frontend -> User
   실제로 어떤 bridge tx가 나갈지 표시
   from chain, to chain, amount, fee, estimated received, provider를 보여준다.

5. User Wallet -> Frontend
   bridge 실행 approve/signature 반환

6. Frontend -> Backend
   POST /scw/bridge-usdc/execute
   signatureRequestId, signature 전달

7. Backend / Relayer
   signature 검증
   SCW에서 bridge tx 실행

8. Bridge Provider
   cross-chain transfer 처리

9. Backend -> Frontend
   transfer status, txHash, chain별 USDC balances 반환
```

State model:

```ts
type OperationStatus = "NeedsSignature" | "Pending" | "Confirmed" | "Failed";

type StrategyRuntimeStatus =
  | "NotStarted"
  | "Queued"
  | "Running"
  | "KillSwitchQueued"
  | "Stopped"
  | "Failed";
```

Backend storage should keep:

- `operationId`
- `signatureRequestId`
- `userAddress`
- `scwAddress`
- `adapterAddress`
- `strategyId`
- `adapterContractAddress`
- `codeId`
- `codeHash`
- `nonce`
- `status`
- `txHash`
- `createdAt`
- `updatedAt`

### Use Adapter

Use는 “해당 전략에 대응되는 adapter contract를 유저 SCW에 install하고, 그 adapter와 함께 Hershy strategy code를 실행”하는 동작이다.

#### Prepare Use

`POST /api/strategy-exchange/adapter-addresses/:address/use/prepare`

Request:

```ts
{
  userAddress: string;
  scwAddress: string;
  amountUsd: number;
  assetSymbol: "USDC";
  allocations: Array<{
    chain: string;
    amountUsd: number;
  }>;
}
```

Response:

```ts
{
  endpoint: string;
  status: "NeedsSignature";
  adapterProduct: {
    address: string;
    strategyId: string;
  };
  adapterContract: {
    address: string;
    implementationAddress: string;
    version: string;
    strategyCodeHash: string;
  };
  scw: {
    address: string;
    chainId: number;
    nonce: string;
  };
  signatureRequest: {
    id: string;
    purpose: "InstallStrategyAdapter";
    signingMode: "EIP-712";
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    message: Record<string, unknown>;
    expiresAt: string;
  };
  installTxPreview: {
    to: string;
    value: string;
    data: string;
    chainId: number;
    estimatedGas?: string;
  };
  hershyRuntime: {
    codeId: string;
    codeHash: string;
    adapterAddress: string;
    adapterContractAddress: string;
    startMode: "AfterAdapterInstalled";
    input: {
      amountUsd: number;
      assetSymbol: "USDC";
      allocations: Array<{
        chain: string;
        amountUsd: number;
      }>;
    };
  };
}
```

#### Execute Use

`POST /api/strategy-exchange/adapter-addresses/:address/use/execute`

Request:

```ts
{
  userAddress: string;
  scwAddress: string;
  signatureRequestId: string;
  signature: string;
}
```

Response:

```ts
{
  endpoint: string;
  operation: {
    id: string;
    type: "Use";
    status: "Pending" | "Confirmed" | "Failed";
    createdAt: string;
    updatedAt: string;
  };
  adapterInstall: {
    status: "Pending" | "Confirmed" | "Failed";
    txHash?: string;
    adapterAddress: string;
    scwAddress: string;
  };
  hershyRuntime: {
    runId: string;
    codeId: string;
    codeHash: string;
    adapterAddress: string;
    status: "Queued" | "Running" | "Failed";
    startedAt?: string;
  };
  position: {
    adapterAddress: string;
    userAddress: string;
    netPositionUsd: number;
    pnlUsd: number;
    pnlPct: number;
    used: boolean;
    updatedAt: string;
  };
  transaction: {
    id: string;
    adapterAddress: string;
    type: "Use";
    userAddress: string;
    userName: string;
    avatarUrl?: string;
    amountUsd: number;
    assetAmount: number;
    assetSymbol: "USDC";
    txHash: string;
    chain: string;
    createdAt: string;
  };
}
```

### Drop Adapter

Drop은 “먼저 Hershy code kill switch를 실행하고, 그 다음 adapter uninstall 서명을 받아 SCW에서 adapter를 제거”하는 동작이다.(이때 서명을 먼저 받고, 그 다음에 kill switch를 실행시키고 나서 서명을 execute시켜야 함)

#### Prepare Drop

`POST /api/strategy-exchange/adapter-addresses/:address/drop/prepare`

Request:

```ts
{
  userAddress: string;
  scwAddress: string;
  reason?: string;
}
```

Response:

```ts
{
  endpoint: string;
  status: "NeedsSignature";
  killSwitch: {
    runId: string;
    codeId: string;
    adapterAddress: string;
    status: "Queued" | "Running" | "Confirmed" | "Failed";
    txHash?: string;
    triggeredAt: string;
  };
  adapterContract: {
    address: string;
    strategyCodeHash: string;
  };
  scw: {
    address: string;
    chainId: number;
    nonce: string;
  };
  signatureRequest: {
    id: string;
    purpose: "UninstallStrategyAdapter";
    signingMode: "EIP-712";
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    message: Record<string, unknown>;
    expiresAt: string;
  };
  uninstallTxPreview: {
    to: string;
    value: string;
    data: string;
    chainId: number;
    estimatedGas?: string;
  };
}
```

Rules:

- `drop/prepare`는 kill switch를 먼저 trigger해야 한다.
- kill switch가 실패하면 uninstall signature를 요청하면 안 된다.
- `drop/execute`는 kill switch가 `Confirmed` 또는 backend policy상 안전한 상태일 때만 adapter uninstall을 실행해야 한다.

#### Execute Drop

`POST /api/strategy-exchange/adapter-addresses/:address/drop/execute`

Request:

```ts
{
  userAddress: string;
  scwAddress: string;
  signatureRequestId: string;
  signature: string;
}
```

Response:

```ts
{
  endpoint: string;
  operation: {
    id: string;
    type: "Drop";
    status: "Pending" | "Confirmed" | "Failed";
    createdAt: string;
    updatedAt: string;
  };
  killSwitch: {
    runId: string;
    status: "Confirmed" | "Failed";
    txHash?: string;
  };
  adapterUninstall: {
    status: "Pending" | "Confirmed" | "Failed";
    txHash?: string;
    adapterAddress: string;
    scwAddress: string;
  };
  position: {
    adapterAddress: string;
    userAddress: string;
    netPositionUsd: 0;
    pnlUsd: number;
    pnlPct: number;
    used: false;
    updatedAt: string;
  };
  transaction: {
    id: string;
    adapterAddress: string;
    type: "Drop";
    userAddress: string;
    userName: string;
    avatarUrl?: string;
    amountUsd?: number;
    assetAmount?: number;
    assetSymbol?: "USDC";
    txHash: string;
    chain: string;
    createdAt: string;
  };
}
```

### SCW USDC Bridge

Bridge는 버튼 클릭 시 실제 bridge tx 송금 내용을 프론트에 보여줘야 한다.
프론트는 route, from/to chain, fee, tx target/calldata를 표시하고 유저 확인/서명을 받은 뒤 실행한다.

#### Prepare Bridge

`POST /api/strategy-exchange/scw/bridge-usdc/prepare`

Request:

```ts
{
  userAddress: string;
  scwAddress: string;
  fromChain: string;
  toChain: string;
  amountUsd: number;
  assetSymbol: "USDC";
}
```

Response:

```ts
{
  endpoint: string;
  status: "NeedsSignature";
  route: {
    bridgeProvider: string;
    fromChain: string;
    toChain: string;
    assetSymbol: "USDC";
    amountUsd: number;
    estimatedReceivedUsd: number;
    estimatedFeeUsd: number;
    estimatedTimeSeconds?: number;
  };
  sourceBalance: {
    chain: string;
    availableUsd: number;
    afterTransferUsd: number;
  };
  targetBalance: {
    chain: string;
    availableUsd: number;
    afterTransferUsd: number;
  };
  bridgeTxPreview: {
    to: string;
    value: string;
    data: string;
    chainId: number;
    estimatedGas?: string;
  };
  signatureRequest: {
    id: string;
    purpose: "BridgeUSDC";
    signingMode: "EIP-712" | "PersonalSign";
    domain?: Record<string, unknown>;
    types?: Record<string, unknown>;
    message: Record<string, unknown>;
    expiresAt: string;
  };
}
```

#### Execute Bridge

`POST /api/strategy-exchange/scw/bridge-usdc/execute`

Request:

```ts
{
  userAddress: string;
  scwAddress: string;
  signatureRequestId: string;
  signature: string;
}
```

Response:

```ts
{
  endpoint: string;
  balances: Record<string, number>;
  transfer: {
    id: string;
    userAddress: string;
    scwAddress: string;
    fromChain: string;
    toChain: string;
    amountUsd: number;
    assetSymbol: "USDC";
    status: "Pending" | "Confirmed" | "Failed";
    txHash?: string;
    bridgeProvider: string;
    createdAt: string;
    updatedAt: string;
  };
}
```

## Backend Implementation Priority

1. `GET /strategies`
2. `GET /adapter-addresses/:address`
3. `GET /users/:address`
4. `GET /discussions/adapters/:address`
5. `POST /user-logics`, `GET /user-logics`
6. `PATCH /users/:address/profile`
7. Use/Drop write APIs
