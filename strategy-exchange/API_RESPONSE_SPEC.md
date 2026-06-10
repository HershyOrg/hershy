# Strategy Exchange API Response Spec

프론트 기준 API base URL은 `VITE_API_BASE_URL`이다.
예: `VITE_API_BASE_URL=https://api.thirdeye.xyz`이면 `/api/strategy-exchange/strategies`는 `https://api.thirdeye.xyz/api/strategy-exchange/strategies`로 호출된다.

공통 규칙:

- 모든 응답은 JSON.
- 금액 필드는 숫자 USD 기준이다. 예: `strategyEquity: 70770`은 `$70,770`.
- 비율 필드는 두 방식이 섞여 있다.
  - `leaderFraction`, `leaderCommission`, `sharePct`, `weight`: `0.1`이 `10%`.
  - `pnlPct`, `projectedApr`, `winRate`, `maxDrawdown`: `8.9`가 `8.9%`.
- 시간은 ISO string을 권장한다. 전략 피드의 `createdAt`만 현재 UI에서 `"2h"`, `"3h"`, `"5h"` 같은 상대 시간을 사용한다.
- 현재 프론트 schema 때문에 `endpoint`, `sql` 필드는 응답에 포함하는 것이 안전하다. 실서버에서 SQL을 노출하지 않을 경우 `sql: ""`로 내려도 된다.
- Not found는 404보다 `200` + nullable payload를 권장한다. 현재 UI는 `vault: null`, `account: null`을 처리한다.

## 1. Strategy Feed

전략 카드 피드와 상단 랭킹 정렬에 사용된다.

`GET /api/strategy-exchange/strategies`

Query:

```ts
{
  category: "Daily Hot" | "New" | "Top Gainer" | "Top Volume";
  type: "All" | "CEX" | "DeFi" | "Mixed" | "Funding" | "Basis" | "LP/Hedge";
  includeUnconnected: "true" | "false";
  q?: string;
  connected?: string[]; // repeated query param: connected=Binance&connected=OKX
}
```

Response:

```ts
{
  endpoint: string;
  request: {
    category: "Daily Hot" | "New" | "Top Gainer" | "Top Volume";
    type: "All" | "CEX" | "DeFi" | "Mixed" | "Funding" | "Basis" | "LP/Hedge";
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
  primarySector: "CEX" | "DeFi" | "Mixed" | "Funding" | "Basis" | "LP/Hedge";
  sectors: Array<"CEX" | "DeFi" | "Mixed" | "Funding" | "Basis" | "LP/Hedge">;
  venues: string[];
  chains: string[];
  pnlSeries: number[];
  realizedPnl: number;
  pnlPct: number;
  deployedCapital: number;
  dailyVolume: number;
  winRate: number;
  maxDrawdown: number;
  traders: number;
  status: "Live" | "Cooling" | "Paused";
  createdAt: string;
  nodes: Array<{ id: string; label: string; x: number; y: number }>;
  edges: Array<{ from: string; to: string; label: string }>;
}
```

Example:

```json
{
  "endpoint": "/api/strategy-exchange/strategies?category=Daily+Hot&type=All&includeUnconnected=false&connected=Binance",
  "request": {
    "category": "Daily Hot",
    "type": "All",
    "query": "",
    "includeUnconnected": false,
    "connectedVenues": ["Binance"]
  },
  "strategies": [
    {
      "id": "sol-momentum-ladder",
      "title": "SOL Momentum Ladder",
      "creatorId": "mira.exec",
      "primarySector": "CEX",
      "sectors": ["CEX"],
      "venues": ["OKX", "Binance"],
      "chains": ["Solana", "Ethereum"],
      "pnlSeries": [0, 400, 980, 760, 1500],
      "realizedPnl": 6815,
      "pnlPct": 11.1,
      "deployedCapital": 41000,
      "dailyVolume": 229000,
      "winRate": 69,
      "maxDrawdown": 4.1,
      "traders": 218,
      "status": "Live",
      "createdAt": "3h",
      "nodes": [{ "id": "cash", "label": "USDC", "x": 34, "y": 78 }],
      "edges": []
    }
  ],
  "total": 1
}
```

## 2. Vault Metadata

개별 vault 상세 페이지, TVL 차트, Performance, Token Balance, Chain Balance, Use allocation 계산에 사용된다.

현재 프론트 route는 `/:address`이고, 주소가 vault address이면 아래 API를 호출한다.

`GET /api/strategy-exchange/vault-addresses/:address`

전략 ID로 조회하는 fallback endpoint도 있다.

`GET /api/strategy-exchange/vaults/:strategyId`

Response:

```ts
{
  endpoint: string;
  sql: string;
  vault: StrategyVaultMetadata | null;
}
```

`StrategyVaultMetadata`:

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
}
```

Notes:

- `strategyEquity`가 UI의 `TVL`.
- `MAX TVL`은 현재 프론트에서 `strategyEquity * 2`로 임시 계산한다. 백엔드가 별도 값으로 내려줄 수 있으면 `maxTvl` 추가를 권장한다.
- Use allocation UI는 입금 자산을 USDC로 고정한다. `balances.weight`와 `balances.chain`으로 체인별 필요한 USDC를 계산한다.
- `balances.token`, `balances.amount`, `balances.value`는 Token Balance 원형 차트에 사용된다.
- `balances.chain`, `balances.value`는 Chain Balance 원형 차트에 사용된다.

Example:

```json
{
  "endpoint": "/api/strategy-exchange/vault-addresses/0xf60c458247521bf6de41704859040ce8ba5fd4db",
  "sql": "",
  "vault": {
    "strategyId": "sol-momentum-ladder",
    "address": "0xf60c458247521bf6de41704859040ce8ba5fd4db",
    "leaderAddress": "0x5668ddaacb72dcb427639d114783930275e11e12",
    "leaderFraction": 0.699199,
    "leaderCommission": 0.1,
    "projectedApr": 71.04,
    "strategyEquity": 45890,
    "allTimePnl": 6815,
    "chains": ["Solana", "Ethereum"],
    "updatedAt": "2026-06-07T07:00:00.000Z",
    "periods": [
      { "strategyId": "sol-momentum-ladder", "label": "24h", "pnl": -290, "equity": 45890, "volume": 229000 },
      { "strategyId": "sol-momentum-ladder", "label": "7d", "pnl": 2150, "equity": 45522.8, "volume": 1603000 }
    ],
    "balances": [
      { "strategyId": "sol-momentum-ladder", "token": "SOL", "venue": "OKX", "chain": "Solana", "amount": 175.911667, "value": 21109.4, "weight": 0.46, "sortOrder": 1 },
      { "strategyId": "sol-momentum-ladder", "token": "USDC", "venue": "Cash", "chain": "Solana", "amount": 9178, "value": 9178, "weight": 0.2, "sortOrder": 3 }
    ]
  }
}
```

## 2.1 Vault Chart Data

Vault 상세 상단 차트와 ETF형 분석 차트에 사용된다.
현재 프론트는 `strategy.pnlSeries`, `vault.strategyEquity`, `vault.allTimePnl`, `vault.balances`로 일부 차트를 임시 파생해서 그리고 있다.
실제 백엔드 연결 시에는 아래 chart API로 내려주는 것을 권장한다.

Important:

- 차트 종류와 최종 데이터 포맷은 아직 확정되지 않았다.
- 아래 response shape는 현재 프론트/디자인 기준의 working draft다.
- 백엔드 구현 전 chart format은 변동될 수 있으며, 특히 `composition`, `premiumDiscount`, `netFlow`, `drawdown`은 제품 결정에 따라 필드가 바뀔 수 있다.
- 우선 확정에 가까운 것은 상단 `logicValue`와 `initialMarginRate` 시계열이다.

`GET /api/strategy-exchange/vault-addresses/:address/charts`

Query:

```ts
{
  interval: "1m" | "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "8h" | "1day" | "1month";
  charts?: Array<
    | "logicValue"
    | "initialMarginRate"
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
  vaultAddress: string;
  strategyId: string;
  currency: "USD";
  charts: {
    logicValue: {
      label: "Logic Value";
      unit: "USD";
      series: Array<{
        time: string;
        value: number;
      }>;
    };
    initialMarginRate: {
      label: "Initial Margin Rate";
      unit: "percent";
      series: Array<{
        time: string;
        value: number;
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

- `logicValue`
  - 현재 상단 메인 차트.
  - 기존 UI의 `Vault Value`가 아니라 `Logic Value`로 표시한다.
  - ETF의 NAV/TLV 성격에 대응되는 핵심 value curve.
- `initialMarginRate`
  - 해당 전략을 사용하는 유동성의 초기 증거금 변화율.
  - 단위는 percent. 예: `12.4`는 `12.4%`.
- `premiumDiscount`
  - ETF 성격을 가장 잘 보여주는 차트.
  - `premiumDiscountPct = (marketPrice - navPerShare) / navPerShare * 100`.
  - vault share가 NAV 대비 비싸게/싸게 거래되는지 보여준다.
- `composition`
  - ETF 구성자산 비중 변화.
  - 프론트에서는 stacked area chart로 표현하는 것을 권장한다.
  - `weight`는 `0.46`이 `46%`.
- `netFlow`
  - Use/Drop 유입·유출.
  - 프론트에서는 bar chart 또는 positive/negative flow chart로 표현한다.
- `drawdown`
  - Logic Value 고점 대비 하락률.
  - 단위는 percent이며 일반적으로 `0` 이하 값으로 내려줘도 된다.

Example:

```json
{
  "endpoint": "/api/strategy-exchange/vault-addresses/0xf60c458247521bf6de41704859040ce8ba5fd4db/charts?interval=1h",
  "request": {
    "interval": "1h",
    "charts": ["logicValue", "initialMarginRate", "premiumDiscount", "composition", "netFlow"]
  },
  "vaultAddress": "0xf60c458247521bf6de41704859040ce8ba5fd4db",
  "strategyId": "sol-momentum-ladder",
  "currency": "USD",
  "charts": {
    "logicValue": {
      "label": "Logic Value",
      "unit": "USD",
      "series": [
        { "time": "2026-06-10T00:00:00.000Z", "value": 44020 },
        { "time": "2026-06-10T01:00:00.000Z", "value": 44580 },
        { "time": "2026-06-10T02:00:00.000Z", "value": 45890 }
      ]
    },
    "initialMarginRate": {
      "label": "Initial Margin Rate",
      "unit": "percent",
      "series": [
        { "time": "2026-06-10T00:00:00.000Z", "value": 14.2 },
        { "time": "2026-06-10T01:00:00.000Z", "value": 15.1 },
        { "time": "2026-06-10T02:00:00.000Z", "value": 14.8 }
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
            { "token": "SOL", "chain": "Solana", "valueUsd": 21109.4, "weight": 0.46 },
            { "token": "USDC", "chain": "Ethereum", "valueUsd": 12849.2, "weight": 0.28 }
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

- 상단 메인 차트: `charts.logicValue.series`
- 상단 보조 차트: `charts.initialMarginRate.series`
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

## 4. Vault Activity

Vault 상세 페이지 하단의 User Distribution, All Transactions에 사용된다.

`GET /api/strategy-exchange/activity/vaults/:address`

Response:

```ts
{
  endpoint: string;
  sql: string;
  users: Array<{
    vaultAddress: string;
    userAddress: string;
    userName: string;
    avatarUrl?: string;
    depositUsd: number;
    depositAssetAmount: number;
    assetSymbol: string;
    sharePct: number;
    sortOrder: number;
  }>;
  transactions: Array<{
    id: string;
    vaultAddress: string;
    type: "Use" | "Drop";
    userAddress: string;
    userName: string;
    avatarUrl?: string;
    amountUsd?: number;
    assetAmount?: number;
    assetSymbol?: string;
    txHash: string;
    chain: string;
    createdAt: string;
  }>;
}
```

Notes:

- `users`는 `sortOrder` asc.
- `transactions`는 `createdAt` desc.
- 페이지네이션은 현재 프론트에서 client-side로 4개씩 처리한다. 백엔드 pagination을 넣을 경우 `page`, `pageSize`, `total` 확장이 필요하다.

## 5. Vault Discussion

Vault 상세 페이지 토론 영역에 사용된다.

`GET /api/strategy-exchange/discussions/vaults/:address`

Response:

```ts
{
  endpoint: string;
  sql: string;
  messages: Array<{
    id: string;
    vaultAddress: string;
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

`POST /api/strategy-exchange/discussions/vaults/:address/messages`

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
    vaultAddress: string;
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

Use에서 유저가 서명하는 것은 “내 SCW에 이 vault strategy adapter를 install하고, 이 USDC allocation으로 Hershy strategy code를 실행해도 된다”는 permission이다.

```txt
1. Frontend -> Backend API
   POST /api/strategy-exchange/vault-addresses/:vaultAddress/use/prepare

   body:
   {
     userAddress,
     scwAddress,
     amountUsd,
     assetSymbol: "USDC",
     allocations
   }

2. Backend API 내부 처리
   - vaultAddress로 strategyId 조회
   - strategyId로 adapterAddress 조회
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
     vaultAddress,
     strategyId,
     adapterAddress,
     codeHash,
     amountUsd,
     allocationHash,
     nonce,
     deadline
   }

   response.installTxPreview 반환
   {
     to: scwAddress,
     data: installAdapter(adapterAddress, installCalldata),
     value: "0",
     chainId
   }

4. Frontend -> User Wallet
   wallet.signTypedData(signatureRequest.domain, signatureRequest.types, signatureRequest.message)

5. User Wallet -> Frontend
   signature 반환

6. Frontend -> Backend API
   POST /api/strategy-exchange/vault-addresses/:vaultAddress/use/execute

   body:
   {
     userAddress,
     scwAddress,
     signatureRequestId,
     signature
   }

7. Backend API 내부 처리
   - signatureRequestId로 원본 typed data, install calldata, adapterAddress 조회
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
     data: installAdapter(adapterAddress, installCalldata),
     userSignature: signature,
     signatureRequestId
   }

9. Relayer -> SCW Contract
   tx 전송

   예시 contract call:
   SCW.executeWithSignature({
     target: scwAddress,
     value: 0,
     data: installAdapter(adapterAddress, installCalldata),
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
     vaultAddress,
     strategyId,
     scwAddress,
     adapterAddress,
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
   POST /api/strategy-exchange/vault-addresses/:vaultAddress/drop/prepare

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
     vaultAddress,
     strategyId,
     scwAddress,
     adapterAddress,
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
     vaultAddress,
     strategyId,
     adapterAddress,
     codeHash,
     killSwitchRunId,
     killSwitchTxHash,
     nonce,
     deadline
   }

   response.uninstallTxPreview 반환
   {
     to: scwAddress,
     data: uninstallAdapter(adapterAddress),
     value: "0",
     chainId
   }

6. Frontend -> User Wallet
   wallet.signTypedData(signatureRequest.domain, signatureRequest.types, signatureRequest.message)

7. User Wallet -> Frontend
   signature 반환

8. Frontend -> Backend API
   POST /api/strategy-exchange/vault-addresses/:vaultAddress/drop/execute

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
     data: uninstallAdapter(adapterAddress),
     userSignature: signature,
     signatureRequestId
   }

11. Relayer -> SCW Contract
   tx 전송

   예시 contract call:
   SCW.executeWithSignature({
     target: scwAddress,
     value: 0,
     data: uninstallAdapter(adapterAddress),
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
  - vault address에 연결된 strategy, adapter, Hershy code를 resolve한다.
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
  - 특정 vault strategy와 Hershy code를 SCW에 연결하는 contract module.
  - install되면 해당 전략 실행 권한/라우팅/asset handling을 담당한다.

Hershy Runtime
  - adapter install 후 실제 strategy code를 실행한다.
  - Drop 시 kill switch를 먼저 실행해 전략 실행을 멈춘다.
```

Use Vault contract flow:

```txt
1. Frontend -> Backend
   POST /vault-addresses/:address/use/prepare
   userAddress, scwAddress, amountUsd, USDC allocations 전달

2. Backend
   vault address -> strategyId resolve
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
   POST /vault-addresses/:address/use/execute
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

Drop Vault contract flow:

```txt
1. Frontend -> Backend
   POST /vault-addresses/:address/drop/prepare
   userAddress, scwAddress 전달

2. Backend / Hershy Runtime
   해당 user/scw/vault에 연결된 running strategy runId 조회
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
   POST /vault-addresses/:address/drop/execute
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
- `vaultAddress`
- `strategyId`
- `adapterAddress`
- `codeId`
- `codeHash`
- `nonce`
- `status`
- `txHash`
- `createdAt`
- `updatedAt`

### Use Vault

Use는 “해당 전략에 대응되는 adapter contract를 유저 SCW에 install하고, 그 adapter와 함께 Hershy strategy code를 실행”하는 동작이다.

#### Prepare Use

`POST /api/strategy-exchange/vault-addresses/:address/use/prepare`

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
  vault: {
    address: string;
    strategyId: string;
  };
  adapter: {
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

`POST /api/strategy-exchange/vault-addresses/:address/use/execute`

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
    vaultAddress: string;
    userAddress: string;
    netPositionUsd: number;
    pnlUsd: number;
    pnlPct: number;
    used: boolean;
    updatedAt: string;
  };
  transaction: {
    id: string;
    vaultAddress: string;
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

### Drop Vault

Drop은 “먼저 Hershy code kill switch를 실행하고, 그 다음 adapter uninstall 서명을 받아 SCW에서 adapter를 제거”하는 동작이다.(이때 서명을 먼저 받고, 그 다음에 kill switch를 실행시키고 나서 서명을 execute시켜야 함)

#### Prepare Drop

`POST /api/strategy-exchange/vault-addresses/:address/drop/prepare`

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
  adapter: {
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

`POST /api/strategy-exchange/vault-addresses/:address/drop/execute`

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
    vaultAddress: string;
    userAddress: string;
    netPositionUsd: 0;
    pnlUsd: number;
    pnlPct: number;
    used: false;
    updatedAt: string;
  };
  transaction: {
    id: string;
    vaultAddress: string;
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
2. `GET /vault-addresses/:address`
3. `GET /users/:address`
4. `GET /activity/vaults/:address`
5. `GET /discussions/vaults/:address`
6. `POST /user-logics`, `GET /user-logics`
7. `PATCH /users/:address/profile`
8. Use/Drop/Bridge write APIs
