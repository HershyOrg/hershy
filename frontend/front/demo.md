지금부터 나는 데모를 만들 생각이야.

이를 위해서 더미데이터를 만들어야 하는데, 너가 만들어줄 더미데이터는 내가 ai에게 요청했을때 답을 하는 거야. 알았지? 나는 지금부터 두개의 전략을 만들어서 실행을 시켜볼거고, 이를 ai를 사용해서 만들 생각이야. p:데모 사용자, ai: 너가 답해야 하는거. [] ← 해당 반응형 더미데이터를 만들때 너가 알아야 할 내용들을 적었어. 주석같은거라고 보면돼.

### 전략 1 만들기

ai패널에서 시작 → p: 좋아요…새로운 전략 하나 만들어보자구요. 흠… 일단 코인 DCA좀 할까요? 매달 계좌에 돈 들어오니까. ai에게 요즘 잘나가는 코인 섹터를 추천해줘.

```markdown
ai: 내가 만든다면 **“수익률 제일 높을 것 같은 코인 묶음”**이 아니라, **기관투자자가 살 수 있고, 조작·수탁·규제 리스크가 낮은 코인 ETF**로 만들 것 같아.
핵심은 알파보다 **상장 가능성 + 운용 안정성 + NAV 추적력**이야.

## 결론부터: 내가 만들 ETF

이름을 붙이면:

> **Core Crypto Infrastructure ETF**

구성은 대략 이렇게 잡을 것 같아.

| 자산          |  비중 | 이유                   |
| ----------- | --: | -------------------- |
| BTC         | 45% | 가장 깊은 유동성, 디지털 금 포지션 |
| ETH         | 30% | 스마트컨트랙트 생태계의 핵심 인프라  |
| SOL         | 10% | 고성능 L1, 거래/소비자 앱 베타  |
| LINK        |  5% | 오라클 인프라              |
| UNI 또는 AAVE |  5% | DeFi 거래/대출 인프라       |
| 현금/T-bill   |  5% | 리밸런싱·환매 대응용          |

다만 미국식 ETF로 현실화한다면 처음에는 **BTC/ETH 중심 + 소수 대형 코인**으로 시작할 가능성이 높아. SEC는 2024년에 spot Bitcoin ETP를 승인했고, 2025년에는 crypto ETP의 in-kind creation/redemption도 허용했으며, 2025년 9월에는 commodity-based trust shares에 대한 generic listing standards를 승인해 디지털자산 ETF 상장 절차를 단축했다. 즉 2024년보다 2026년 현재는 구조적으로 더 다양한 코인 ETF를 만들 여지가 커졌다. ([Securities and Exchange Commission][1])

---

## 1. 제일 먼저 보는 기준: “좋은 코인인가?”가 아님

ETF에 넣을 코인을 고를 때 나는 이 순서로 볼 거야.

```text
1. 규제상 상품/디지털 커머디티로 취급될 가능성
2. 수탁 가능성
3. 현물 유동성
4. 파생상품/감시공유 가능성
5. 가격 지수 산출 가능성
6. 조작 저항성
7. 프로토콜 리스크
8. 투자 테마 적합성
```

소매 투자자는 “이 코인 오를까?”를 보지만, ETF 발행자는 먼저 **“이걸 상장사가 책임지고 담아도 되는가?”**를 봐야 해.

---

## 2. 코인 선정 기준

### A. 유동성

최소 조건은 이 정도로 둘 것 같아.

```text
- 글로벌 현물 거래량 상위권
- 여러 거래소에 분산된 거래량
- 미국 시간대에도 충분한 거래량
- 스프레드가 좁음
- AP/마켓메이커가 대량 creation/redemption을 처리 가능
```

한 거래소에서만 거래량이 큰 코인은 제외.
거래량이 많아 보여도 wash trading 의심이 크면 제외.

그래서 밈코인, 저유동성 L2 토큰, 특정 거래소 의존 토큰은 웬만하면 안 넣을 것 같아.

---

### B. 기준가격 산출 가능성

ETF는 NAV를 계산해야 하니까 “믿을 수 있는 기준가격”이 필요해.

BTC는 예를 들어 **CME CF Bitcoin Reference Rate**처럼 여러 주요 BTC-USD 시장의 거래 데이터를 집계하는 벤치마크가 이미 있고, CF Benchmarks는 FCA 규제 벤치마크 관리자라고 설명한다. ([CF Benchmarks](https://www.cfbenchmarks.com/data/indices/BRR?utm_source=chatgpt.com "BRR - CME CF Bitcoin Reference Rate"))

내가 ETF를 만든다면 모든 편입 자산에 대해 이런 조건을 요구할 거야.

```text
- 독립 벤치마크 관리자가 있음
- 여러 적격 거래소 데이터를 사용
- 극단값/이상거래 완화 로직이 있음
- 산출 방법론이 공개되어 있음
- 일별 NAV와 장중 indicative NAV 산출 가능
```

CoinDesk 20도 유동성, 분산, 실행 가능성을 고려한 디지털자산 지수로 설계됐다고 설명하고, 방법론 문서에서 편입 자산이 Reference Rate를 지원해야 하며 wrapped/pegged/staked asset, memecoin, privacy token 등은 제외한다고 밝힌다. ([CoinDesk Indices](https://indices.coindesk.com/coindesk20?utm_source=chatgpt.com "CoinDesk 20"))

---

### C. 수탁 가능성

ETF는 개인 지갑에 담는 게 아니라, 자산을 전문 수탁기관에 맡겨야 해.

내 기준은:

```text
- 기관 수탁사가 지원하는 자산
- 콜드월렛/멀티시그/HSM 체계
- 보험 또는 보상 체계
- 온체인 출금 통제
- 하드포크/에어드랍/슬래싱 이벤트 처리 정책
```

특히 ETH나 SOL 같은 PoS 자산은 **스테이킹을 할지 말지**가 중요해. 나는 처음에는 **스테이킹 안 하는 구조**로 갈 것 같아. 이유는 단순해. 스테이킹 수익은 매력적이지만, 슬래싱, 락업, 검증자 리스크, 세무 처리, “ETF가 네트워크 거버넌스에 참여하는가?” 같은 문제가 생겨.

---

### D. 규제 리스크

이게 가장 현실적인 필터야.

BTC, ETH는 이미 ETF/ETP 시장에서 제도권 편입이 진행된 상태라 가장 안전한 축에 가깝다. 반면 DeFi 거버넌스 토큰, 수익분배성 토큰, 특정 재단/회사 의존도가 높은 토큰은 ETF 편입 시 설명 부담이 커져.

그래서 나는 코인을 이렇게 나눌 거야.

```text
Tier 1:
BTC, ETH

Tier 2:
SOL, XRP, LTC 같은 대형·고유 체인·파생시장 존재 자산

Tier 3:
LINK, UNI, AAVE 같은 인프라/DeFi 토큰

Tier 4:
밈코인, 프라이버시 코인, 래핑 자산, 리베이스 토큰, 스테이킹 파생 토큰
```

ETF에는 Tier 1~2 위주로 넣고, Tier 3는 제한적으로만 넣을 것 같아. Tier 4는 제외.

---

## 3. 비중 산정 방식

그냥 시총가중으로 하면 BTC/ETH가 너무 커지고, 반대로 균등가중으로 하면 작은 코인 리스크가 과해져.

그래서 나는 **capped market-cap weighting**을 쓸 것 같아.

```text
- BTC 최대 50%
- ETH 최대 35%
- 단일 알트코인 최대 10%
- DeFi 토큰 전체 최대 10%
- 현금/T-bill 0~10%
```

이렇게 하면 BTC/ETH의 안정성을 가져가면서도, “크립토 인프라 전체”에 노출될 수 있어.

예시:

```text
BTC 45
ETH 30
SOL 10
LINK 5
UNI/AAVE 5
Cash/T-bill 5
```

시장이 더 성숙하면:

```text
BTC 35
ETH 25
SOL 10
LINK 7.5
AAVE 5
UNI 5
L2 basket 5
Cash/T-bill 7.5
```

하지만 초기 상품이라면 너무 많은 코인을 담지 않을 거야. **ETF는 간결해야 팔린다.**

---

## 4. 리밸런싱 규칙

월간 리밸런싱은 너무 잦고, 연간은 너무 느려.
나는 **분기 리밸런싱**으로 갈 것 같아.

```text
- 분기 1회 정기 리밸런싱
- 편입/제외 심사도 분기 1회
- 단일 자산이 상한 비중을 넘으면 다음 리밸런싱 때 캡 적용
- 특정 자산이 30일 평균 거래량 기준 미달 시 관찰 리스트
- 규제/보안/체인 장애 발생 시 특별 리밸런싱
```

특별 제외 조건은 강하게 둘 거야.

```text
- 주요 거래소 상장폐지
- 심각한 체인 중단
- 브릿지/수탁 불가능 이슈
- SEC/CFTC 등에서 명확한 법적 리스크 발생
- 가격 산출 불가능
- 30일 평균 거래량 급감
```

---

## 5. ETF 구조

내가 현실적으로 만들면 **현물 보유형 ETF/ETP**가 1순위야.

```text
펀드 구조:
현물 코인 보유

가격 산출:
독립 벤치마크 기준 NAV

수탁:
기관 수탁사

creation/redemption:
가능하면 in-kind
불가능하면 cash

거래소:
NYSE Arca / Nasdaq / Cboe 계열

운용보수:
0.35% ~ 0.65%
```

2024년 초기 spot Bitcoin ETF들은 cash creation/redemption 구조가 중심이었지만, SEC는 2025년 7월 crypto asset ETP에 대해 authorized participants의 in-kind creations/redemptions를 허용하는 명령을 승인했다. 이건 ETF 운용 입장에서는 세금·거래비용·추적오차 측면에서 더 나은 구조를 만들 수 있다는 의미가 크다. ([Securities and Exchange Commission](https://www.sec.gov/newsroom/press-releases/2025-101-sec-permits-kind-creations-redemptions-crypto-etps?utm_source=chatgpt.com "SEC Permits In-Kind Creations and Redemptions for ..."))

---

## 6. 내가 피할 것들

나는 이런 ETF는 안 만들 것 같아.

### 밈코인 ETF

마케팅은 잘 되겠지만, 기관용 장기 상품으로는 너무 위험해.
가격 지수, 수탁, 조작 저항성, 투자 논리 설명이 어렵다.

### AI 코인 ETF

테마는 좋지만 구성 자산의 질이 들쭉날쭉할 가능성이 크다. “AI”라는 이름이 붙었다고 실제 AI 인프라 현금흐름이 있는 것도 아니고, 대부분은 서사 중심일 수 있다.

### DeFi 고수익 ETF

AAVE, UNI 같은 대형은 제한적으로 가능하지만, yield farming을 ETF 안에서 적극적으로 돌리는 구조는 피할 거야. 운용 리스크, 스마트컨트랙트 리스크, 세무 처리가 복잡해진다.

### 스테이킹 수익 극대화 ETF

ETH/SOL 스테이킹 ETF는 언젠가 가능성이 크지만, 내가 첫 상품을 만든다면 안 넣을 것 같아. “심플한 현물 노출”이 먼저고, 수익 최적화는 두 번째 상품으로 뺄 거야.

---

## 7. 상품 라인업을 만든다면

하나만 만들지 않고 3개로 나눌 것 같아.

### 1단계: Core BTC/ETH ETF

```text
BTC 60%
ETH 40%
```

가장 팔기 쉽고, 설명이 쉽고, 기관도 이해하기 쉽다.

### 2단계: Crypto Infrastructure 5 ETF

```text
BTC
ETH
SOL
LINK
AAVE 또는 UNI
```

크립토를 “자산 + 컴퓨팅 + 오라클 + 금융 인프라”로 보는 상품.

### 3단계: Active Risk-Managed Crypto ETF

```text
BTC/ETH/SOL 중심
변동성 높을 때 T-bill 비중 확대
온체인/파생지표로 리스크 조절
```

이게 진짜 차별화 포인트일 수 있어.
단순 코인 바스켓은 누구나 만들 수 있는데, **리스크 관리형 크립토 ETF**는 훨씬 상품성이 있어.

예를 들면:

```text
- funding rate 과열
- perp OI 급증
- realized volatility 급등
- stablecoin liquidity 감소
- exchange netflow 급증
- BTC dominance 급변
```

이런 신호가 나오면 알트 비중을 줄이고 BTC/T-bill 비중을 늘리는 구조.

---

## 내 최종 설계

내가 진짜 만든다면 첫 상품은 이거야.

```text
상품명:
Core Crypto Infrastructure ETF

목표:
크립토 시장 전체가 아니라,
가장 제도권 편입 가능성이 높은 핵심 인프라 자산에 투자

구성:
BTC 45%
ETH 30%
SOL 10%
LINK 5%
AAVE/UNI 5%
Cash/T-bill 5%

리밸런싱:
분기 1회

편입 조건:
대형 시총, 높은 유동성, 독립 기준가격, 기관 수탁 가능,
규제 리스크 낮음, 조작 저항성 있음

제외:
밈코인, 프라이버시 코인, 래핑 자산, 스테이킹 파생상품,
저유동성 토큰, 단일 거래소 의존 토큰
```

한 문장으로 말하면, 나는 **“다음 100배 코인 찾기 ETF”가 아니라 “기관이 살 수 있는 크립토 베타 ETF”**를 만들 거야.
ETF는 투기성을 포장하는 상품이 아니라, **투자자가 안전하게 접근할 수 있는 시장 접근 레일**이어야 하기 때문이야.

```

p: 지금 계좌에 있는 돈이 얼마였더라?

→ai: 2500달러, 보니까 매달 binance계좌에 500달러씩 들어오는 거 같아. 해당 돈을 안전하게 투자할 생각이야?

→p:응, 너가 방금말한 대로 ETF하나 만들어주고, 제일 수익률 높은거 기준으로 투자하고 싶어. 너가 방금 말한 대로 etf를 담을때, 지난 5년 기준으로 최적 수익률을 구한 다음, 얼마나 비중으로 투자하면 될지 나에게 알려줘.

→ ai: 알았어.

[visx로 차트를 다운받을거야. visx는 너가 직접 ai 트레이딩 챗봇 패널에서 띄워줘야해. 전체화면일때는 띄워주고, 축소되었을때는 이걸 만들었다는 표시만 해주면 돼. 그걸 클릭하면 바로 전체화면으로 이동하면서 보여주고.]

```markdown
import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";

type NavPoint = {
  date: string;
  nav: number;
  parsedDate: Date;
};

type Allocation = {
  asset: string;
  weight: number;
  role: string;
};

type ReturnPoint = {
  period: string;
  value: number;
};

const navSeries: NavPoint[] = [
  { date: "2021-04", nav: 100 },
  { date: "2021-10", nav: 132 },
  { date: "2022-04", nav: 88 },
  { date: "2022-10", nav: 55 },
  { date: "2023-04", nav: 74 },
  { date: "2023-10", nav: 96 },
  { date: "2024-04", nav: 148 },
  { date: "2024-10", nav: 138 },
  { date: "2025-04", nav: 166 },
  { date: "2025-10", nav: 154 },
  { date: "2026-04", nav: 181 },
].map((d) => ({ ...d, parsedDate: new Date(`${d.date}-01T00:00:00`) }));

const allocations: Allocation[] = [
  { asset: "BTC", weight: 55, role: "Core Reserve" },
  { asset: "ETH", weight: 25, role: "Smart Contract" },
  { asset: "SOL", weight: 10, role: "High Beta L1" },
  { asset: "LINK", weight: 3, role: "Oracle" },
  { asset: "AAVE", weight: 2, role: "DeFi Credit" },
  { asset: "Cash", weight: 5, role: "Rebalance Buffer" },
];

const returns: ReturnPoint[] = [
  { period: "1M", value: 4.2 },
  { period: "3M", value: 11.8 },
  { period: "6M", value: 18.4 },
  { period: "YTD", value: 27.9 },
  { period: "1Y", value: 41.3 },
  { period: "5Y", value: 81.0 },
];

const rebalanceLogs = [
  { date: "2026 Q2", action: "Raised BTC cap after volatility spike", impact: "+5% BTC / -3% ETH / -2% LINK" },
  { date: "2026 Q1", action: "Reduced DeFi basket exposure", impact: "AAVE 3% → 2%, Cash 4% → 5%" },
  { date: "2025 Q4", action: "Added SOL as high-beta infrastructure sleeve", impact: "SOL 0% → 10%" },
];

const palette = ["#111827", "#374151", "#6B7280", "#9CA3AF", "#D1D5DB", "#E5E7EB"];

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function linearScale(domainMin: number, domainMax: number, rangeMin: number, rangeMax: number) {
  return (value: number) => {
    if (domainMax === domainMin) return rangeMin;
    const ratio = (value - domainMin) / (domainMax - domainMin);
    return rangeMin + ratio * (rangeMax - rangeMin);
  };
}

function polarToCartesian(cx: number, cy: number, radius: number, angleInRadians: number) {
  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians),
  };
}

function donutSlicePath(startAngle: number, endAngle: number, outerRadius: number, innerRadius: number) {
  const safeEndAngle = Math.max(endAngle, startAngle + 0.001);
  const largeArcFlag = safeEndAngle - startAngle > Math.PI ? 1 : 0;

  const outerStart = polarToCartesian(0, 0, outerRadius, startAngle);
  const outerEnd = polarToCartesian(0, 0, outerRadius, safeEndAngle);
  const innerStart = polarToCartesian(0, 0, innerRadius, safeEndAngle);
  const innerEnd = polarToCartesian(0, 0, innerRadius, startAngle);

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${innerEnd.x} ${innerEnd.y}`,
    "Z",
  ].join(" ");
}

function linePath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return "";
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"
    >
      <p className="text-sm text-neutral-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-neutral-950">{value}</p>
      <p className="mt-1 text-sm text-neutral-500">{sub}</p>
    </motion.div>
  );
}

function NavLineChart() {
  const width = 860;
  const height = 340;
  const margin = { top: 24, right: 24, bottom: 36, left: 44 };
  const xMax = width - margin.left - margin.right;
  const yMax = height - margin.top - margin.bottom;
  const minTime = navSeries[0].parsedDate.getTime();
  const maxTime = navSeries[navSeries.length - 1].parsedDate.getTime();
  const x = linearScale(minTime, maxTime, 0, xMax);
  const y = linearScale(40, 200, yMax, 0);

  const points = navSeries.map((d) => ({ x: x(d.parsedDate.getTime()), y: y(d.nav) }));
  const last = navSeries[navSeries.length - 1];
  const lastX = x(last.parsedDate.getTime());
  const lastY = y(last.nav);
  const yTicks = [40, 80, 120, 160, 200];
  const xTicks = [2021, 2022, 2023, 2024, 2025, 2026];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full overflow-visible">
      <g transform={`translate(${margin.left}, ${margin.top})`}>
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={0} x2={xMax} y1={y(tick)} y2={y(tick)} stroke="#E5E7EB" strokeDasharray="4 4" />
            <text x={-10} y={y(tick)} fill="#6B7280" fontSize={11} textAnchor="end" dominantBaseline="middle">
              {tick}
            </text>
          </g>
        ))}
        {xTicks.map((year) => {
          const tickX = x(new Date(`${year}-01-01T00:00:00`).getTime());
          return (
            <g key={year}>
              <line x1={tickX} x2={tickX} y1={0} y2={yMax} stroke="#F3F4F6" />
              <text x={tickX} y={yMax + 24} fill="#6B7280" fontSize={11} textAnchor="middle">
                {year}
              </text>
            </g>
          );
        })}
        <line x1={0} y1={yMax} x2={xMax} y2={yMax} stroke="#D1D5DB" />
        <line x1={0} y1={0} x2={0} y2={yMax} stroke="#D1D5DB" />
        <path d={linePath(points)} fill="none" stroke="#111827" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        <line x1={0} y1={y(100)} x2={xMax} y2={y(100)} stroke="#9CA3AF" strokeDasharray="6 6" />
        <circle cx={lastX} cy={lastY} r={5} fill="#111827" />
        <text x={clamp(lastX - 56, 0, xMax - 72)} y={lastY - 14} fontSize={12} fill="#111827" fontWeight={600}>
          NAV {last.nav}
        </text>
      </g>
    </svg>
  );
}

function AllocationDonut() {
  const width = 360;
  const height = 260;
  const outerRadius = 112;
  const innerRadius = 70;
  const total = allocations.reduce((sum, item) => sum + item.weight, 0);
  let currentAngle = -Math.PI / 2;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full overflow-visible">
      <g transform={`translate(${width / 2}, ${height / 2})`}>
        {allocations.map((item, index) => {
          const angle = (item.weight / total) * Math.PI * 2;
          const startAngle = currentAngle;
          const endAngle = currentAngle + angle - 0.012;
          currentAngle += angle;
          const midAngle = (startAngle + endAngle) / 2;
          const labelRadius = (outerRadius + innerRadius) / 2;
          const label = polarToCartesian(0, 0, labelRadius, midAngle);
          const hasSpace = angle > 0.28;

          return (
            <g key={item.asset}>
              <path d={donutSlicePath(startAngle, endAngle, outerRadius, innerRadius)} fill={palette[index % palette.length]} />
              {hasSpace && (
                <text x={label.x} y={label.y} fill="white" fontSize={11} textAnchor="middle" dominantBaseline="middle" fontWeight={600}>
                  {item.asset}
                </text>
              )}
            </g>
          );
        })}
        <text textAnchor="middle" dominantBaseline="middle" fontSize={24} fontWeight={700} fill="#111827">
          100%
        </text>
        <text y={24} textAnchor="middle" dominantBaseline="middle" fontSize={11} fill="#6B7280">
          Allocated
        </text>
      </g>
    </svg>
  );
}

function ReturnBars() {
  const width = 560;
  const height = 280;
  const margin = { top: 20, right: 16, bottom: 34, left: 38 };
  const xMax = width - margin.left - margin.right;
  const yMax = height - margin.top - margin.bottom;
  const y = linearScale(0, 90, yMax, 0);
  const barGap = 18;
  const barWidth = (xMax - barGap * (returns.length - 1)) / returns.length;
  const yTicks = [0, 30, 60, 90];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full overflow-visible">
      <g transform={`translate(${margin.left}, ${margin.top})`}>
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={0} x2={xMax} y1={y(tick)} y2={y(tick)} stroke="#E5E7EB" strokeDasharray="4 4" />
            <text x={-10} y={y(tick)} fill="#6B7280" fontSize={11} textAnchor="end" dominantBaseline="middle">
              {tick}
            </text>
          </g>
        ))}
        <line x1={0} y1={yMax} x2={xMax} y2={yMax} stroke="#D1D5DB" />
        <line x1={0} y1={0} x2={0} y2={yMax} stroke="#D1D5DB" />
        {returns.map((d, index) => {
          const barHeight = yMax - y(d.value);
          const barX = index * (barWidth + barGap);
          const barY = yMax - barHeight;
          return (
            <g key={d.period}>
              <rect x={barX} y={barY} width={barWidth} height={barHeight} rx={8} fill="#111827" />
              <text x={barX + barWidth / 2} y={barY - 8} fontSize={11} textAnchor="middle" fill="#111827" fontWeight={600}>
                {d.value}%
              </text>
              <text x={barX + barWidth / 2} y={yMax + 24} fontSize={11} textAnchor="middle" fill="#6B7280">
                {d.period}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

export default function CryptoEtfVisxDashboard() {
  const [selectedAsset, setSelectedAsset] = useState("BTC");
  const selected = useMemo(() => allocations.find((item) => item.asset === selectedAsset) ?? allocations[0], [selectedAsset]);

  return (
    <div className="min-h-screen bg-neutral-50 p-6 text-neutral-950">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col justify-between gap-4 rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm md:flex-row md:items-end">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-neutral-500">Core Crypto Infrastructure ETF</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">Institutional crypto exposure, risk-capped.</h1>
            <p className="mt-3 max-w-2xl text-neutral-600">
              A dependency-safe SVG dashboard concept for showing NAV growth, portfolio weights, trailing returns, and rebalance decisions in one clean product demo screen.
            </p>
          </div>
          <div className="rounded-2xl bg-neutral-950 px-5 py-4 text-white">
            <p className="text-sm text-neutral-300">Current NAV</p>
            <p className="mt-1 text-3xl font-semibold">181.0</p>
            <p className="mt-1 text-sm text-neutral-300">+81.0% since inception</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <MetricCard label="BTC Weight" value="55%" sub="Core reserve asset" />
          <MetricCard label="Volatility Target" value="38%" sub="Annualized risk band" />
          <MetricCard label="Max Single Alt" value="10%" sub="Concentration cap" />
          <MetricCard label="Rebalance" value="Quarterly" sub="Rules-based allocation" />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">NAV Growth</h2>
                <p className="text-sm text-neutral-500">Indexed to 100 at launch</p>
              </div>
              <span className="rounded-full bg-neutral-100 px-3 py-1 text-sm text-neutral-600">5Y backtest view</span>
            </div>
            <div className="h-[340px]">
              <NavLineChart />
            </div>
          </div>

          <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-xl font-semibold">Portfolio Allocation</h2>
              <p className="text-sm text-neutral-500">Capped market-cap style weights</p>
            </div>
            <div className="h-[260px]">
              <AllocationDonut />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {allocations.map((item) => (
                <button
                  key={item.asset}
                  onClick={() => setSelectedAsset(item.asset)}
                  className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                    selectedAsset === item.asset ? "border-neutral-950 bg-neutral-950 text-white" : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
                  }`}
                >
                  <div className="font-semibold">{item.asset} {item.weight}%</div>
                  <div className={`text-xs ${selectedAsset === item.asset ? "text-neutral-300" : "text-neutral-500"}`}>{item.role}</div>
                </button>
              ))}
            </div>
            <div className="mt-4 rounded-2xl bg-neutral-100 p-4">
              <p className="text-sm text-neutral-500">Selected sleeve</p>
              <p className="mt-1 text-lg font-semibold">{selected.asset} · {selected.weight}%</p>
              <p className="text-sm text-neutral-600">{selected.role}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-xl font-semibold">Trailing Returns</h2>
              <p className="text-sm text-neutral-500">Demo data for visual presentation</p>
            </div>
            <div className="h-[280px]">
              <ReturnBars />
            </div>
          </div>

          <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Rebalance Log</h2>
                <p className="text-sm text-neutral-500">Explainable ETF allocation changes</p>
              </div>
              <span className="rounded-full bg-neutral-100 px-3 py-1 text-sm text-neutral-600">Rules engine</span>
            </div>
            <div className="space-y-3">
              {rebalanceLogs.map((log, index) => (
                <motion.div
                  key={log.date}
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.08 }}
                  className="rounded-2xl border border-neutral-200 p-4"
                >
                  <div className="flex items-center justify-between gap-4">
                    <p className="font-semibold">{log.date}</p>
                    <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-600">Rebalanced</span>
                  </div>
                  <p className="mt-2 text-sm text-neutral-700">{log.action}</p>
                  <p className="mt-1 text-sm text-neutral-500">{log.impact}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

계산하면, **지난 5년 수익률만 극대화하는 최적 비중은 SOL 100%**가 나와.
하지만 그건 ETF라기보다 “과거 최고 수익 코인 몰빵”이라 현실적인 ETF 운용안은 아니야.

아래는 **2021년 4월 28일 → 2026년 4월 28일** 기준으로 단순 가격수익률을 계산한 결과야. 시작가격은 CoinMarketCap 2021년 4월 28일 스냅샷, 현재가는 조회 가능한 현재가 기준으로 잡았어. CMC 스냅샷에서 BTC는 $54,824.70, ETH는 $2,746.38, UNI는 $42.80, LINK는 $36.22, SOL은 $44.83로 표시돼 있고, AAVE는 같은 스냅샷 기준 $460.35였어. ([CoinMarketCap][1]) 현재가는 BTC $76,481, ETH $2,272.23, SOL $83.70, LINK $9.22, UNI $3.20, AAVE $97.04 기준으로 계산했어.

## 5년 단순 수익률

| 자산   | 2021-04-28 가격 |       현재가 |     5년 수익률 |   연환산 CAGR |
| ---- | ------------: | --------: | ---------: | ---------: |
| SOL  |        $44.83 |    $83.70 | **+86.7%** | **+13.3%** |
| BTC  |    $54,824.70 |   $76,481 | **+39.5%** |  **+6.9%** |
| ETH  |     $2,746.38 | $2,272.23 |     -17.3% |      -3.7% |
| LINK |        $36.22 |     $9.22 |     -74.5% |     -23.9% |
| AAVE |       $460.35 |    $97.04 |     -78.9% |     -26.8% |
| UNI  |        $42.80 |     $3.20 |     -92.5% |     -40.5% |

## 1. 과거 수익률만 최적화하면

```text
SOL 100%
```

예상 과거 성과:

```text
5년 수익률: +86.7%
연환산 수익률: 약 +13.3%
```

근데 이건 ETF로는 별로야. 이유는 단일 자산 리스크가 너무 크고, SOL은 2021~2022 사이에 고점 대비 대폭락을 겪었기 때문에 **최종 수익률은 좋아 보여도 중간 낙폭이 매우 컸을 가능성**이 높아.

---

## 2. 내가 ETF 제약을 걸고 최적화하면

이전에 말한 ETF식 제약을 걸어볼게.

```text
BTC 최대 50%
ETH 최대 35%
단일 알트 최대 10%
현금 최대 10%
DeFi 토큰 전체 최대 10%
100% fully invested
```

이 조건에서 5년 수익률을 최대화하면:

| 자산              | 비중          |
| ----------------- | ------------- |
| BTC               | **50%** |
| SOL               | **10%** |
| ETH               | **30%** |
| Cash/T-bill       | **10%** |
| LINK / UNI / AAVE | **0%**  |

예상 과거 성과:

```text
5년 수익률: 약 +23.2%
연환산 수익률: 약 +4.3%
```

왜 이렇게 나오냐면, 지난 5년 기준으로는 SOL과 BTC만 플러스였고, ETH/LINK/UNI/AAVE는 마이너스였기 때문이야. 그래서 제약이 없다면 SOL 몰빵이고, 제약이 있으면 **SOL 최대치 + BTC 최대치 + 나머지는 손실이 덜한 ETH와 현금**으로 가는 게 수학적으로 최적이야.

---

## 3. 하지만 내가 실제로 추천에 가깝게 짠다면

나는 과거 5년 수익률만 보고 ETF를 짜지는 않을 거야.
현실적으로는 이렇게 잡을 것 같아.

| 자산        | 비중          |
| ----------- | ------------- |
| BTC         | **55%** |
| ETH         | **25%** |
| SOL         | **10%** |
| LINK        | **3%**  |
| AAVE        | **2%**  |
| Cash/T-bill | **5%**  |
| UNI         | **0%**  |

이게 더 현실적인 이유는:

```text
BTC: 제도권 편입, ETF 수요, 가장 높은 생존성
ETH: 최근 5년 수익률은 별로지만 스마트컨트랙트 인프라 핵심
SOL: 과거 수익률 좋고 성장성 있지만 변동성 커서 10% 제한
LINK: 오라클 인프라라 소량 편입 가능
AAVE: DeFi 대출 인프라 대표지만 토큰 성과가 약해서 소량만
UNI: 과거 성과와 토큰 가치포획 문제 때문에 제외
Cash/T-bill: 급락장 리밸런싱용
```

이 포트폴리오는 “지난 5년 최적 수익률”만 보면 위의 제약 최적안보다 낮을 수 있어. 하지만 ETF라면 **수익률 최적화보다 생존성, 설명 가능성, 유동성, 규제 리스크**가 더 중요해.

---

## 내 결론

너가 “과거 5년 수익률만 최적화”하라고 하면:

```text
SOL 100%
```

너가 “ETF답게 제약을 걸고 과거 수익률을 최적화”하라고 하면:

```text
BTC 50%
ETH 30%
SOL 10%
Cash/T-bill 10%
```

내가 “실제로 오래 들고 갈 코인 ETF를 만든다”고 하면:

```text
BTC 55%
ETH 25%
SOL 10%
LINK 3%
AAVE 2%
Cash/T-bill 5%
```

개인적으로는 세 번째가 제일 낫다고 봐.
지난 5년만 보면 ETH와 DeFi 토큰들이 별로였지만, ETF 상품으로 만들 때는 **“과거 승자 몰빵”보다 “다음 5년에도 살아남을 인프라 비중”**을 보는 게 맞아.

원한다면 이 전략으로 트레이딩할 수 있게끔 해줄까? 매달 DCA를 위해서 얼마정도를 넣을지만 정해줘.

```

p: 응, 전략 짜줘. 매달 500달러씩 굴릴건데, 거래소는 너가 볼때 가장 싼곳으로 해줘.

→ ai: 좋아…지금 보니까, 거래소 수수료는 전부 다 같은거 같아. 거래소 송금을 하는 데에도 돈이 드니까, 그냥 바이낸스에서 진행할게.[위에 적힌 DCA를 블록언어로 만들어서 캔버스에 붙여줘. 1달에 한번씩 매수를 하게끔.]
다됐어. 확인해봐!

[p:전략실행]

p: (ai패널키고)  음…보니까 돈이 2000달러정도 있는데, 이자농사라도 질러볼까? 유니스왑 v2 이자농사를 하고 싶은데. 변동자산은 중앙화거래소에서 숏을 쳐서 햇지를 하고. 가장 수익률이 높을만한 페어는 없을까?

ai: 

```markdown
가능한데, 네가 말한 구조는 **“고APR 풀 찾아서 예치”**가 아니라 사실상:

```text
Uniswap v2 LP 수수료 수익
- 비영구적 손실
- CEX 숏 펀딩비
- CEX 숏 수수료
- 온체인 가스비
- 리밸런싱 비용
= 최종 수익
```

이렇게 봐야 해.

## 결론부터

**가장 수익률이 높을 가능성이 있는 건 `PEPE/WETH` 같은 “거래량 많은 밈코인/WETH v2 풀 + CEX에서 PEPE 숏/ETH 숏 헤지” 조합이야.**
하지만 $2,000으로 실제로 하기엔 리스크가 크고, 관리 난이도가 높아.

내가 너라면 후보를 이렇게 나눌 것 같아.

| 후보             | 수익률 잠재력 | 헤지 가능성            | 위험도    | 내 판단                    |
| ---------------- | ------------- | ---------------------- | --------- | -------------------------- |
| WETH/USDT        | 낮음~중간     | 매우 좋음              | 낮음      | 테스트용                   |
| DAI/WETH         | 낮음~중간     | 매우 좋음              | 낮음      | 테스트용                   |
| PEPE/WETH        | 높음          | 좋음, PEPE perp 있으면 | 높음      | 공격형 후보                |
| SHIB/WETH        | 중간          | 좋음                   | 중간~높음 | PEPE보다 보수적            |
| LINK/WETH        | 낮음          | 좋음                   | 중간      | 현재 v2 거래량이 너무 낮음 |
| 신생 밈코인/WETH | 매우 높음     | 대부분 불가능          | 매우 높음 | 비추                       |

Uniswap v2는 기본적으로 스왑 수수료 0.3%가 LP에게 분배되는 구조고, 수수료는 풀에 자동 재투자되는 방식이야. Uniswap 문서도 수수료 수익과 가격 이동 손실의 trade-off가 있으며, 왕복성 거래가 많을수록 LP에게 유리하다고 설명한다. ([Uniswap Developers](https://www.sec.gov/newsroom/speeches-statements/uyeda-statement-spot-bitcoin-011023?utm_source=chatgpt.com "Statement Regarding the Commission's Approval of ..."))

## 현재 눈에 띄는 풀

현재 GeckoTerminal 기준 Ethereum Uniswap v2 전체는 최근 24시간 거래량 약  **$59.97M** , 트랜잭션 약 **178K** 수준이야. 다만 상위 트렌딩은 `wojak/WETH`, `ASTEROID/WETH` 같은 밈코인 위주라서, 이들은 수익률은 높아 보일 수 있지만 CEX 숏 헤지가 어려울 가능성이 크다. ([geckoterminal.com](https://www.cfbenchmarks.com/data/indices/BRR?utm_source=chatgpt.com "BRR - CME CF Bitcoin Reference Rate"))

반면 헤지가 가능한 대표 후보는 이런 쪽이야.

### 1. WETH/USDT

현재 GeckoTerminal에서 Ethereum Uniswap v2 `WETH/USDT` 풀은 24시간 거래량이 약  **$564K** , 유동성이 약 **$16.35M**로 표시돼. ([geckoterminal.com](https://indices.coindesk.com/coindesk20?utm_source=chatgpt.com "CoinDesk 20"))

대략 수수료 APR을 단순 계산하면:

```text
일일 수수료 = 564,000 × 0.003 = $1,692
풀 TVL = $16,350,000

일일 수수료율 = 1,692 / 16,350,000 = 0.01035%
단순 APR = 0.01035% × 365 = 약 3.78%
```

여기에 네가 $2,000 넣으면 기대 수수료는 대략:

```text
$2,000 × 3.78% = 연 $75.6
월 $6.3 수준
```

이건 안전하지만 재미없어.
그리고 메인넷 가스비 쓰면 수익이 많이 깎여.

### 2. DAI/WETH

`DAI/WETH` v2 풀은 현재 유동성이 약 **$8.92M**로 표시돼. ([geckoterminal.com](https://www.sec.gov/newsroom/press-releases/2025-101-sec-permits-kind-creations-redemptions-crypto-etps?utm_source=chatgpt.com "SEC Permits In-Kind Creations and Redemptions for ..."))
다만 검색 결과에서 24h volume이 명확히 안 잡혀서, 들어가기 전 GeckoTerminal/Uniswap에서 직접 `24h volume / liquidity`를 봐야 해.

장점은:

```text
- ETH 숏으로 헤지 쉬움
- 토큰 리스크 낮음
- 러그 리스크 거의 없음
```

단점은:

```text
- 수익률 낮을 가능성이 큼
- v3/Curve/Aerodrome 같은 곳보다 자본효율이 떨어질 수 있음
```

### 3. PEPE/WETH

이게 “수익률 높은 후보”에 가장 가까워.
공식적으로 많이 쓰이는 Ethereum Uniswap v2 `PEPE/WETH` 풀은 현재 유동성이 약 **$27.36M**로 표시돼. ([geckoterminal.com](https://www.geckoterminal.com/eth/pools/0xa43fe16908251ee70ef74718545e4fe6c5ccec9f?utm_source=chatgpt.com "PEPE/WETH - Pepe Price on Uniswap V2"))

좋은 점:

```text
- 거래량이 터질 때 수수료 수익이 커질 수 있음
- PEPE는 주요 CEX에서 perp 숏 헤지가 가능한 편
- WETH도 ETH perp로 헤지 가능
- 밈코인 특성상 왕복 거래가 많을 수 있음
```

나쁜 점:

```text
- 변동성이 매우 큼
- PEPE 숏 펀딩비가 비쌀 수 있음
- LP 비중이 계속 바뀌어서 헤지 수량을 자주 조정해야 함
- 급등장에서 숏 청산 위험 있음
- DEX 가격과 CEX perp 가격 괴리가 날 수 있음
```

즉, **수익률만 보면 PEPE/WETH가 더 그럴듯하지만, $2,000으로 관리하기엔 꽤 공격적인 포지션**이야.

## 네가 말한 헤지 구조는 어떻게 잡아야 하냐

예를 들어 `PEPE/WETH`에 $2,000 넣는다고 하자.

처음 LP 구성은 대략:

```text
$1,000 PEPE
$1,000 WETH
```

그럼 CEX에서는 이론적으로:

```text
PEPE perp $1,000 숏
ETH perp $1,000 숏
```

을 잡으면 가격 방향성은 어느 정도 중립화돼.

하지만 Uniswap v2 LP는 가격이 움직이면 내부 보유량이 계속 바뀐다.
PEPE가 오르면 풀 안에서 네 PEPE는 줄고 WETH가 늘어난다.
PEPE가 내리면 풀 안에서 네 PEPE는 늘고 WETH가 줄어든다.

그래서 숏을 고정해두면 시간이 지나면서 헤지가 틀어져.

## 헤지 리밸런싱 규칙

실전에서는 이렇게 해야 해.

```text
1. LP 포지션의 현재 PEPE 수량과 WETH 수량을 계산
2. CEX 숏 수량과 비교
3. 차이가 10~20% 이상 벌어지면 숏 수량 조정
4. 펀딩비가 비정상적으로 비싸지면 포지션 축소
5. 풀의 Volume/TVL이 낮아지면 철수
```

$2,000이면 너무 자주 리밸런싱하면 CEX 수수료와 온체인 가스비 때문에 먹을 게 없어져.
그래서 내 기준은:

```text
헤지 오차 15% 이상일 때만 조정
또는
하루 1회만 점검
```

## 수익률 계산 공식

풀을 고를 때 가장 먼저 봐야 하는 건 **Volume / TVL**이야.

```text
수수료 APR ≈ 24h Volume / TVL × 0.003 × 365
```

예를 들어 어떤 풀의 조건이:

```text
TVL: $5,000,000
24h Volume: $1,000,000
```

이면:

```text
수수료 APR = 1,000,000 / 5,000,000 × 0.003 × 365
= 21.9%
```

여기서 네가 실제로 가져가는 순수익은:

```text
순수익률 =
수수료 APR
- 숏 펀딩비
- 숏 거래수수료
- 가스비
- 리밸런싱 비용
- 가격 괴리/슬리피지
- 남은 비영구적 손실
```

즉, 수수료 APR이 20%여도 PEPE 숏 펀딩비가 연 15~30% 수준이면 순수익은 거의 사라질 수 있어.

## “가장 수익률 높을 만한 페어”를 고르는 조건

나는 이렇게 필터링할 거야.

```text
필수 조건:
- Uniswap v2 풀
- 24h Volume / TVL 높음
- 토큰이 CEX perp에 있음
- 숏 유동성이 충분함
- 펀딩비가 과도하지 않음
- 풀 유동성이 최소 $1M 이상
- 토큰 컨트랙트 리스크 낮음
- 세금/락/블랙리스트/transfer tax 없음
```

이 조건을 만족하면서 수익률이 높을 가능성이 있는 건 보통:

```text
PEPE/WETH
SHIB/WETH
WETH/USDT
WETH/USDC 또는 DAI/WETH
```

순서야.

## 내 추천 순서

### 1순위: 테스트용 — WETH/USDT 또는 DAI/WETH

처음 해보는 거면 이걸로 해.

```text
투입금: $300~$500
LP: WETH/USDT or DAI/WETH
CEX: ETH 숏만 잡음
목표: 구조 이해, LP 수익 계산, 헤지 오차 확인
```

이건 돈을 크게 벌려고 하는 게 아니라, **시스템 테스트**야.

### 2순위: 공격형 — PEPE/WETH

수익률을 노린다면 이쪽.

```text
투입금: $300~$700
LP: PEPE/WETH
CEX: PEPE 숏 + ETH 숏
조건: PEPE perp 펀딩비가 너무 비싸지 않을 때만
```

이건 반드시 소액으로 해야 해.
특히 PEPE가 급등하면 CEX 숏이 청산될 수 있어. LP 쪽에서는 PEPE가 줄어들고 WETH가 늘지만, CEX 숏 손실은 실시간으로 증거금을 먹기 때문에 “이론상 헤지”와 “청산 리스크”는 다르다.

### 3순위: 중간형 — SHIB/WETH

SHIB/WETH는 PEPE보다 덜 뜨거울 수 있지만, 그래도 CEX 숏이 비교적 쉽고 밈코인 거래량이 생길 수 있어. 검색 결과 기준 SHIB/WETH v2 풀은 유동성이 약  **$551K** , 24h 거래량 약 **$23K** 수준으로 표시돼서 현재 수수료 매력은 그리 커 보이지 않는다. ([geckoterminal.com](https://www.geckoterminal.com/eth/pools/0x811beed0119b4afce20d2583eb608c6f7af1954f?utm_source=chatgpt.com "SHIB/WETH - SHIBA INU Price on Uniswap V2"))

## 내가 지금 너라면 이렇게 함

$2,000 전액은 안 넣어.

```text
총자금: $2,000

1단계 테스트:
- $500만 LP
- 나머지 $1,500은 증거금/대기자금

테스트 포지션:
- $500 PEPE/WETH LP
- CEX에서 PEPE $250 숏
- CEX에서 ETH $250 숏

또는 더 보수적으로:
- $500 WETH/USDT LP
- CEX에서 ETH $250~$500 숏
```

여기서 중요한 건 **LP 넣은 금액과 같은 금액을 CEX 증거금으로 따로 남겨야 한다는 것**이야.
$2,000 전부 LP에 넣고 숏까지 치면, 숏 청산 방어할 현금이 부족해져.

## 최종 답

“가장 수익률이 높을 만한 페어”를 하나 고르라면:

```text
PEPE/WETH
```

이유:

```text
- Uniswap v2에 큰 유동성 풀 존재
- 밈코인이라 거래량/왕복매매가 터질 때 수수료 수익 가능
- PEPE는 CEX perp 숏 헤지가 비교적 가능
- WETH도 ETH perp로 헤지 가능
```

하지만 “처음 실험용으로 가장 합리적인 페어”는:

```text
WETH/USDT 또는 DAI/WETH
```

내 실전 판단은 이거야.

```text
$500 이하로 PEPE/WETH 테스트
PEPE 숏 + ETH 숏으로 델타 헤지
일일 Volume/TVL과 펀딩비를 매일 기록
7~14일 후 실제 순수익이 플러스면 증액
처음부터 $2,000 전액 투입은 비추
```

이 전략에서 돈을 버는 핵심은 **좋은 페어 하나 찍기**가 아니라, `Volume/TVL × 0.3%`가 `펀딩비 + 리밸런싱 비용 + 가스비 + 헤지 오차`보다 계속 큰지 추적하는 거야.

```

p: 좋아. 그거로 만들어줘.(pepe/ETH)

ai: [pepe/ETH]를 블록 전략으로 만들기

다됐어. 확인해보고 실행해봐!
```

---

## 현재 구현 기준 확인

지금 데모용 반응형 더미데이터는 이미 들어가 있다.

- `components/node-editor/CryptoEtfVisxDashboard.tsx`
  - ETF 백테스트용 반응형 대시보드
- `lib/demo-data.ts`
  - `getEtfDcaStrategyNodes`
  - `getPepeHedgeStrategyNodes`
- `components/node-editor/AIPanel.tsx`
  - DCA/ETF 키워드 인식 후 차트 렌더링 + ETF 전략 주입
  - PEPE/이자농사 키워드 인식 후 PEPE 전략 주입

즉, 지금 시연은 "AI 패널 대화 → 반응형 시각화 → 캔버스 전략 생성 → 저장/버전/분기/실행" 흐름으로 바로 가능하다.

---

## 데모용 축약 AI 응답

실제 시연에서는 아래처럼 **두괄식 + 짧은 구어체**로 말하는 버전을 기준으로 간다.

### ETF 응답

```text
결론부터, 나는 이걸 Core Crypto Infrastructure ETF로 짤 거야.

비중은 BTC 55 / ETH 25 / SOL 10 / LINK 3 / AAVE 2 / Cash 5로 갈게.
수익률만 보는 게 아니라 유동성, 규제 리스크, 장기 생존력까지 같이 본 구성이야.
```

```text
좋아. 결론부터, 이건 바이낸스 기준 월 1회 자동 DCA로 만들게.
지금 캔버스에 붙여둘게.
```

### PEPE 응답

```text
결론부터, 데모용으로는 PEPE/WETH가 제일 좋아.

Uniswap v2 LP를 깔고, CEX에서 PEPE 숏 + ETH 숏으로 헤지하면 돼.
다만 이건 공격적이라 2천 달러 전액보단 500달러 정도 테스트가 맞아.
```

```text
좋아. 결론부터, PEPE/WETH LP + PEPE 숏 + ETH 숏 구조로 만들게.
모니터링이랑 리밸런싱까지 넣어서 캔버스에 붙여둘게.
```

### 시퀀스 AI 요약 응답

```text
결론부터, 이건 이 전략의 핵심 실행 단계야.
여기서 조건을 보고 다음 주문이나 온체인 액션으로 넘겨줘.
쉽게 말하면 전략 흐름을 이어주는 브릿지라고 보면 돼.
```

---

## 시연 목표

두 개의 시나리오만으로 아래 기능을 모두 보여준다.

- AI와 대화로 전략 아이디어 구체화
- 아이디어 → 구체화 질문 → 노드 생성 3단계 대화
- AI 추론 단계 애니메이션
- AI 패널 전체화면 전환
- 반응형 대시보드/차트 렌더링
- 전략 노드 자동 주입
- 상단 멀티 전략 탭
- 새 루트 전략 생성
- 현재 전략에서 새 분기 생성
- `Ctrl+S` 저장으로 버전 추가
- 전략 버전 히스토리 전체화면 모달
- 브랜치 미리보기와 브랜치 전환
- 탭 닫기와 저장본 유지
- 전략 실행/정지
- 하단 대시보드 패널
- 시퀀스 접기/펼치기
- 시퀀스 AI 요약

---

## 시연 전 세팅

1. `npm run dev`로 앱을 띄운다.
2. 시작 화면에는 기본 `V2 유동성 봇` 전략 탭이 열려 있는 상태를 사용한다.
3. 대시보드 패널은 닫힌 상태에서 시작한다.
4. 브라우저 너비를 한 번 줄였다 늘릴 준비를 해둔다.
   반응형 차트를 보여주기 위한 장면이다.

---

## 시나리오 1

### 테마

기관형 장기 투자 전략 생성: `Core Crypto Infrastructure ETF`

### 이 시나리오에서 보여줄 것

- 새 전략 탭 만들기
- AI 패널 대화
- ETF 반응형 차트
- ETF 생성 전 추론 단계 표시
- 캔버스 자동 전략 생성
- 전략 실행
- 하단 대시보드
- `Ctrl+S` 저장
- 전략 히스토리에서 버전 확인

### 운영자 액션과 대사

1. 상단 `새 전략` 버튼 클릭 → `빈 전략 탭 만들기`
   대사:
   `기존 전략 템플릿은 남겨두고, 아예 새 전략 탭에서 AI와 바로 하나 만들어보겠습니다.`

2. 우하단 AI 패널 열기 후 전체화면으로 확장
   대사:
   `이 앱은 단순 노코드 편집기가 아니라, AI와 대화하면서 전략을 설계하는 방식입니다.`

3. 사용자 프롬프트 입력
   `좋아요. 새로운 전략 하나 만들어보자구요. 흠... 일단 코인 DCA좀 할까요? 매달 계좌에 돈 들어오니까. 요즘 잘나가는 코인 섹터를 추천해줘.`

4. AI가 구체화 질문을 던지면 바로 답한다
   입력:
   `월 500달러, 바이낸스, 안정형으로 가자.`
   대사:
   `AI가 바로 노드를 만드는 게 아니라, 한 번 더 물어보면서 전략 조건을 구체화합니다.`

5. AI가 잠깐 `추론 중` 패널을 띄우는 걸 보여준다
   대사:
   `여기서는 실제 체인 오브 소트가 아니라, 사용자가 볼 수 있는 상위 작업 단계만 보여줍니다.`

6. AI가 ETF 관점으로 답변하고 차트를 렌더링하면 잠깐 멈춘다
   대사:
    `여기서 끝이 아니라, 말로만 추천하는 게 아니라 바로 백테스트형 시각화를 같이 보여줍니다.`

7. 브라우저 폭을 줄였다가 늘린다
   대사:
    `이 차트는 데모용 더미데이터지만 반응형으로 설계되어 있어서, 패널 크기가 바뀌어도 그대로 유지됩니다.`

8. AI가 `다됐어. 확인해봐!` 메시지 후 캔버스에 ETF 전략을 주입하면 캔버스로 시선 이동
   대사:
    `그리고 이게 핵심입니다. 방금 대화한 내용을 실제 실행 가능한 블록 전략으로 바로 내려줍니다.`

9. ETF 전략 그룹 블록의 `실행` 버튼 클릭
   대사:
    `생성만 하는 게 아니라, 전략 단위로 바로 실행/정지 흐름까지 연결됩니다.`

10. 상단 우측 `대시보드` 버튼 클릭
   대사:
    `실행 상태는 아래 대시보드에서 별도로 볼 수 있게 분리했습니다.`

11. `Ctrl+S` 입력
   대사:
    `이 상태를 저장하면 현재 창이 덮어쓰기 되는 게 아니라, 새 버전으로 누적됩니다.`

12. `전략 버전 히스토리` 열기
    대사:
    `이제 방금 만든 전략이 버전 히스토리와 브랜치 구조에 쌓인 걸 확인할 수 있습니다.`

13. 히스토리 모달에서 방금 저장된 카드 클릭
    대사:
    `각 버전은 미리보기 카드로 확인할 수 있고, 클릭하면 그 시점으로 바로 돌아갑니다.`

### 시나리오 1 종료 멘트

`첫 번째 시나리오는 장기 투자형 전략입니다. AI가 아이디어를 구조화하고, 시각화하고, 실제 전략 블록까지 만들어주는 흐름을 보여줬습니다.`

---

## 시나리오 2

### 테마

고수익형 델타뉴트럴 전략 생성: `PEPE/WETH LP Hedge Strategy`

### 이 시나리오에서 보여줄 것

- 현재 전략에서 새 분기 생성
- 두 번째 AI 시나리오 실행
- PEPE 생성 전 추론 단계 표시
- 멀티 탭 전환
- 탭 닫기와 저장본 유지
- 기본 V2 전략의 시퀀스 접기/펼치기
- 시퀀스 AI 요약
- 히스토리 모달에서 새 루트 전략/새 분기 생성

### 운영자 액션과 대사

1. 상단 `새 전략` 버튼 클릭 → `현재 전략에서 새 분기 시작`
   대사:
   `이번에는 완전히 새 템플릿이 아니라, 방금 만든 전략을 바탕으로 분기해서 다른 방향으로 발전시켜보겠습니다.`

2. 새 탭이 열리면 AI 패널 다시 오픈
   대사:
   `즉, 하나의 전략만 있는 구조가 아니라 VSCode처럼 여러 전략 탭을 동시에 비교하면서 작업할 수 있습니다.`

3. 사용자 프롬프트 입력
   `유니스왑 v2 이자농사를 하고 싶은데, PEPE/WETH 기준으로 델타뉴트럴 전략 만들어줘.`

4. AI가 구체화 질문을 던지면 바로 답한다
   입력:
   `500달러만, 공격형, 바이낸스로 가자.`
   대사:
   `두 번째 시나리오도 같은 방식으로, AI가 먼저 자금과 공격도를 다시 확인합니다.`

5. AI가 잠깐 `추론 중` 패널을 띄우는 걸 보여준다
   대사:
   `이번엔 헤지 구조, 자금 규모, 리밸런싱 조건을 정리하는 단계가 보입니다.`

6. AI가 PEPE 전략 설명 후 전략을 주입하면 캔버스로 이동
   대사:
    `이번에는 완전히 다른 성격의 전략입니다. 장기 DCA가 아니라 고변동성 자산의 수수료 수익과 헤지를 같이 다룹니다.`

7. 상단 탭을 클릭하며 ETF 탭과 PEPE 탭을 번갈아 전환
   대사:
    `이렇게 여러 전략을 동시에 열어 놓고 비교할 수 있고, 탭을 닫아도 저장본 자체는 사라지지 않습니다.`

8. 현재 탭의 `X` 버튼으로 한 번 닫았다가, `전략 버전 히스토리`에서 다시 연다
   대사:
    `닫기는 편집기에서 패널만 닫는 개념이고, 저장된 템플릿은 히스토리에 그대로 남습니다.`

9. 기본 `V2 유동성 봇` 탭으로 이동
   대사:
    `기본 템플릿 쪽에서는 시퀀스를 압축해서 큰 전략을 더 쉽게 읽을 수 있습니다.`

10. 접힌 시퀀스를 더블클릭해서 펼치고, 우측 상단 `접기` 버튼으로 다시 축소
   대사:
    `큰 전략도 이런 식으로 접었다 펴면서 단계별로 볼 수 있습니다.`

11. 시퀀스 블록을 선택해 설명 패널을 띄우고 `AI 요약` 버튼 클릭
   대사:
    `또 각 시퀀스는 AI 설명이 바로 붙어서, 데모 상황에서도 왜 이 블록이 필요한지 즉석에서 설명할 수 있습니다.`

12. 다시 `전략 버전 히스토리` 열기
    대사:
    `히스토리 탭에서는 새 루트 전략도 만들 수 있고, 현재 전략 기준 새 분기도 만들 수 있습니다.`

13. 히스토리 모달 상단에서 `새 루트 전략 시작` 버튼 클릭 후 닫기
    대사:
    `즉, 전략 생성의 진입점이 AI 패널 하나만이 아니라, 히스토리에서도 바로 새 전략 워크스페이스를 열 수 있습니다.`

### 시나리오 2 종료 멘트

`두 번째 시나리오에서는 분기, 멀티 탭, 실행 상태, 시퀀스 가독성, AI 설명, 히스토리 기반 재진입까지 보여줬습니다.`

---

## 마무리 멘트

`정리하면 이 앱은 전략을 그리는 도구가 아니라, AI와 대화해 아이디어를 구조화하고, 그 구조를 즉시 블록 전략으로 바꾸고, 그 결과를 버전/분기/탭 단위로 관리하면서 실행까지 연결하는 워크벤치입니다.`

---

## 기능 체크리스트

- AI 패널 열기/전체화면
- AI 응답 기반 차트 렌더링
- 반응형 시각화
- ETF 전략 자동 생성
- PEPE 전략 자동 생성
- 새 전략 탭 생성
- 현재 전략에서 새 분기 생성
- 탭 전환
- 탭 닫기
- `Ctrl+S` 저장
- 히스토리 모달 열기
- 히스토리에서 버전 클릭 복원
- 히스토리에서 새 루트 전략 생성
- 히스토리에서 현재 전략 기반 새 분기 생성
- 전략 실행/정지
- 하단 대시보드 열기
- 시퀀스 접기/펼치기
- 시퀀스 AI 요약
