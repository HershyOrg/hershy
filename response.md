# strategy-exchange 정리 반영안

## 결정

Fork는 투자자용 strategy exchange 화면에서 삭제한다. 이 화면의 목적은 전략을 리믹스/소셜 오브젝트로 보이게 하는 것이 아니라, 바로 검토하고 사용할 수 있는 거래형 전략 상품으로 보이게 하는 것이다.

카테고리는 실행 인프라가 아니라 상품 공개 방식 기준으로 나눈다.

- 지수: ETF처럼 구성요소와 비중, 리밸런싱/방법론을 전체 공개하는 상품
- 퀀트: 정확한 로직과 구성요소는 공개하지 않고 성과, 리스크, 용량, 유동성만 공개하는 상품

## 제거한 것

- Adapter 상세의 Fork 액션 제거
- Fork 배지와 fork count 상태 제거
- 전략 카드의 fork count 제거
- 피드 카드의 Drop 버튼 제거
- Drop은 이미 사용 중인 전략의 Adapter 상세에서만 노출
- 동작 없는 헤더 Connect 버튼 제거
- Adapter 상세의 기본 Discussion 패널 제거
- 소셜 랭킹처럼 보이는 피드 필터 제거
  - Daily Hot
  - Top Gainer
  - Top Volume
- 품질 배지처럼 보이는 피드 필터 제거
  - Verified
  - Risk Adjusted
  - Low Drawdown
  - High Liquidity
- 투자자 화면의 주요 카테고리에서 CEX/DeFi/Mixed 같은 실행 섹터 제거
- 퀀트 상품 상세에서 methodology, Canvas 로직 노출 제거
- 지수 상품 상세에서도 별도 Methodology 패널 제거
- Adapter 상세 상단과 카드에서 Live/Cooling/Paused 상태 및 2h/3h 같은 생성시간 태그 제거
- 전략 상품 모델에서 status와 createdAt 제거
- ETF 상품 핵심 지표에서 Users 제거
- NAV 차트에서 Initial Margin Rate 제거
- Use 실행 영역의 멀티체인 배분표 제거
- SCW Bridge / Auto Portfolio Sort 플로우 제거
- Adapter 상세의 All Transactions / tx list 제거
  - tx activity hook, mock API route, demoDB transaction rows도 제거

## 추가한 것

- 상품형 피드 필터 추가
  - Featured
  - Perp Index
  - Funding Carry
  - Market Neutral
  - Tactical Quant
- 상품 카테고리 추가
  - 지수
  - 퀀트
- Adapter 상세에 Product Profile 섹션 추가
  - category: 지수 또는 퀀트
  - disclosure: 전체 공개 또는 성과만 공개
  - market: 거래 시장
  - asset class: 거래 자산군
  - high / low
  - 30D risk
  - liquidity
  - capacity
  - updated time
- ETF식 핵심 지표로 변경
  - TVL -> AUM
  - Commission -> Strategy Fee
  - Logic Value chart -> NAV / Share Price chart
  - 카드 MC -> AUM
  - Users -> Daily Volume
- Adapter 상세 배치 변경
  - 상단: 상품 헤더, 카테고리, 공개 범위, 시장, 자산군, creator
  - 그 아래: NAV / Share Price, AUM, 30D Return, APR, Daily Volume, Strategy Fee, Max Drawdown KPI strip
  - 본문: 왼쪽 NAV / Share Price 차트, 오른쪽 Use ticket
  - 하단: 기간별 Performance, Overview, Adapter Ledger 탭
- Adapter 상세에 Hyperliquid vault형 Ledger 탭 패널 추가
  - Balances
  - Positions
  - Trade History
  - Funding History
  - Deposits and Withdrawals
  - Depositors
- Balances 탭은 투자 전에는 Adapter 잔고, 투자 후에는 투자 금액 기준 asset amount/value/weight로 표시
- Positions 탭은 market, side, size, entry/mark/liquidation price, margin, uPnL, funding rate 표시
- Trade History 탭은 Logic Creator/User actor를 구분해서 표시
- Funding History 탭은 rate와 payment를 표시
- Deposits and Withdrawals 탭은 deposit/withdrawal flow의 time, type, account, amount만 표시
- Depositors 탭은 전체 주소를 노출하지 않고 masked address만 표시
- Buffer와 Role 컬럼 제거
- 현재 지원 실행 체인을 Hyperliquid-only로 설정
  - strategy / adapter / adapter balance chain 값은 현재 모두 Hyperliquid
  - SCW USDC 잔고는 현재 지원 체인 목록 기준으로 저장
  - Use 실행 시 현재 primary execution chain인 Hyperliquid USDC 잔고에서 차감
  - 나중에 체인을 늘릴 수 있도록 실행 체인 목록은 별도 설정으로 분리
- 기존 비-Hyperliquid 더미 전략 제거 후 Hyperliquid 중심 더미 전략 10개로 교체
  - Hyperliquid Majors Index
  - Hyperliquid Alt Rotation Index
  - Hyperliquid Defensive Collateral Index
  - Hyperliquid BTC Funding Carry
  - Hyperliquid ETH Basis Carry
  - Hyperliquid Market Neutral Grid
  - Hyperliquid Liquidation Reversal
  - Hyperliquid Volatility Breakout
  - Hyperliquid Orderflow Scalper
  - Hyperliquid Cross-Margin Hedge
  - 지수 상품은 전체 공개, 퀀트 상품은 성과만 공개

## 카테고리 정책

| 카테고리 | 성격 | 공개 범위 | 화면 노출 |
| --- | --- | --- | --- |
| 지수 | ETF처럼 자산 구성과 비중을 리밸런싱하는 상품 | 전체 공개 | 구성요소, 비중, 잔고 구성, 운영 원장 공개 |
| 퀀트 | 정확한 매매 로직을 공개하지 않는 전략 상품 | 성과만 공개 | 시장, 자산군, 성과, 리스크, 유동성, 용량, 운영 원장 공개. Methodology/Canvas 로직은 숨김 |

## 이유

Adapter 상세는 사용자가 이 전략이 무엇인지, 무엇으로 구성되는지, 성과와 리스크가 어떤지, 현재 잔고로 실행 가능한지를 빠르게 판단하게 해야 한다. 빌더/크리에이터 성격의 기능은 Launch Logic이나 별도 creator tool 쪽에 두고, 투자자 화면에서는 Use를 중심으로 상품 검토 정보를 강화한다.

다만 퀀트 상품은 정확한 로직을 공개하지 않는 것이 상품 특성이므로, Product Profile에서 `Sources`, `Chains`, `Constituents`, `Weighting` 같은 실행/구성 정보와 Canvas 로직은 숨긴다. 대신 어떤 시장과 자산군을 거래하는지는 성과만 공개 상품에서도 항상 보여준다. 운영 결과에 해당하는 balances, positions, trade history, funding history, deposits/withdrawals, depositors는 탭 패널로 묶어서 확인한다. 체인은 영구 고정값이 아니라 현재 지원 범위가 Hyperliquid-only인 상태로 두고, Use 실행 영역에서는 현재 primary execution chain의 SCW USDC 잔고와 필요 금액만 보여준다.
