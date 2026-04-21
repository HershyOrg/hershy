import { useState } from 'react'

type OrderLevel = {
  price: number
  size: number
  total: number
}

const asks: OrderLevel[] = [
  { price: 185330, size: 0.42, total: 77.84 },
  { price: 185220, size: 0.67, total: 124.09 },
  { price: 185150, size: 0.93, total: 172.19 },
  { price: 185090, size: 1.18, total: 218.41 },
  { price: 185020, size: 1.41, total: 260.88 },
]

const bids: OrderLevel[] = [
  { price: 184980, size: 1.62, total: 299.67 },
  { price: 184910, size: 1.24, total: 229.29 },
  { price: 184860, size: 0.95, total: 175.62 },
  { price: 184790, size: 0.74, total: 136.74 },
  { price: 184710, size: 0.56, total: 103.44 },
]

const currency = new Intl.NumberFormat('ko-KR')
const compact = new Intl.NumberFormat('ko-KR', {
  notation: 'compact',
  maximumFractionDigits: 2,
})

function formatPrice(value: number) {
  return `${currency.format(value)} KRW`
}

function formatNumber(value: number) {
  return value.toFixed(2)
}

function OrderBookRows({
  levels,
  tone,
}: {
  levels: OrderLevel[]
  tone: 'ask' | 'bid'
}) {
  const maxTotal = Math.max(...levels.map((level) => level.total))
  const isAsk = tone === 'ask'

  return (
    <div className="space-y-2.5">
      {levels.map((level) => {
        const depth = (level.total / maxTotal) * 100

        return (
          <div
            key={`${tone}-${level.price}`}
            className="relative overflow-hidden rounded-[22px] border border-white/6 bg-[#181818] px-4 py-3 shadow-[0_12px_28px_rgba(0,0,0,0.28)]"
          >
            <div
              className={`absolute inset-y-1 right-1 rounded-[18px] ${
                isAsk ? 'bg-rose-500/14' : 'bg-sky-500/14'
              }`}
              style={{ width: `${depth}%` }}
            />
            <div className="relative z-10 grid grid-cols-[1.1fr_0.85fr_0.85fr] items-center gap-3 text-sm">
              <span
                className={`text-base font-semibold ${
                  isAsk ? 'text-rose-400' : 'text-sky-400'
                }`}
              >
                {currency.format(level.price)}
              </span>
              <span className="text-right font-medium text-zinc-200">
                {formatNumber(level.size)}
              </span>
              <span className="text-right text-zinc-500">
                {formatNumber(level.total)}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function TradingOrderBook() {
  const [orderType, setOrderType] = useState<'limit' | 'market'>('limit')
  const [quantity, setQuantity] = useState('0.50')
  const [limitPrice, setLimitPrice] = useState('184980')

  const lastTradePrice = 185000
  const priceDiff = 4210
  const changeRate = 2.33
  const estimatedTotal =
    orderType === 'limit'
      ? Number(limitPrice || 0) * Number(quantity || 0)
      : lastTradePrice * Number(quantity || 0)

  return (
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(30,215,96,0.16),_transparent_30%),linear-gradient(180deg,_#121212_0%,_#050505_100%)] px-4 py-6 text-white sm:px-6 lg:px-10 lg:py-10">
      <div className="mx-auto max-w-7xl">
        <div className="relative overflow-hidden rounded-[36px] border border-white/8 bg-[#0e0e0e]/95 p-4 shadow-[0_40px_120px_rgba(0,0,0,0.56)] sm:p-6 lg:p-8">
          <div className="pointer-events-none absolute left-[-10%] top-[-12%] h-72 w-72 rounded-full bg-[#1ed760]/18 blur-3xl" />
          <div className="pointer-events-none absolute right-[-8%] top-[12%] h-64 w-64 rounded-full bg-[#1db954]/8 blur-3xl" />

          <section className="relative z-10 flex flex-col gap-6 border-b border-white/8 pb-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-[#1ed760]/20 bg-[#1ed760]/12 px-3 py-1 text-xs font-semibold tracking-[0.24em] text-[#1ed760] uppercase">
                  KRX
                  <span className="h-1.5 w-1.5 rounded-full bg-[#1ed760]" />
                  Live
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-zinc-500">
                    종목 정보
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-4">
                    <h1 className="text-3xl font-bold tracking-[-0.04em] text-white sm:text-5xl">
                      NAVER
                    </h1>
                    <span className="text-lg font-medium text-zinc-500">
                      035420
                    </span>
                  </div>
                  <p className="text-sm text-zinc-400">
                    플레이어처럼 집중도 높은 다크 트레이딩 레이아웃
                  </p>
                </div>
              </div>

              <div className="rounded-[30px] border border-[#1ed760]/16 bg-[linear-gradient(135deg,_rgba(30,215,96,0.92)_0%,_rgba(14,14,14,0.98)_82%)] px-5 py-4 text-white shadow-[0_28px_40px_rgba(0,0,0,0.36)]">
                <div className="text-xs uppercase tracking-[0.22em] text-white/70">
                  Last Trade
                </div>
                <div className="mt-2 flex items-end gap-3">
                  <span className="text-3xl font-bold tracking-[-0.04em] text-white">
                    {formatPrice(lastTradePrice)}
                  </span>
                  <span className="mb-1 rounded-full bg-black/28 px-2.5 py-1 text-sm font-semibold text-white">
                    +{changeRate}%
                  </span>
                </div>
                <p className="mt-2 text-sm text-white/76">
                  전일 대비 +{currency.format(priceDiff)} KRW
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ['거래량', compact.format(8123400)],
                ['시가총액', '30.2조 KRW'],
                ['고가 / 저가', '185,330 / 183,920 KRW'],
                ['호가 스프레드', '40 KRW'],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-[24px] border border-white/6 bg-[#181818] px-4 py-4 shadow-[0_16px_32px_rgba(0,0,0,0.18)]"
                >
                  <div className="text-sm text-zinc-500">{label}</div>
                  <div className="mt-2 text-xl font-semibold tracking-[-0.03em] text-white">
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="relative z-10 mt-6 grid gap-6 xl:grid-cols-[1.25fr_0.85fr]">
            <div className="rounded-[30px] border border-white/6 bg-[#111111] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:p-5">
              <div className="flex items-center justify-between pb-4">
                <div>
                  <h2 className="text-xl font-semibold tracking-[-0.03em] text-white">
                    Order Book
                  </h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    실시간 잔량과 누적 깊이를 스포티파이식 다크 패널로 정리했습니다.
                  </p>
                </div>
                <div className="rounded-full border border-[#1ed760]/16 bg-[#1ed760]/10 px-3 py-1 text-xs font-semibold text-[#1ed760]">
                  5 Level Depth
                </div>
              </div>

              <div className="mb-3 grid grid-cols-[1.1fr_0.85fr_0.85fr] px-4 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-600">
                <span>Price</span>
                <span className="text-right">Size</span>
                <span className="text-right">Total</span>
              </div>

              <div className="space-y-5">
                <div>
                  <div className="mb-3 flex items-center justify-between px-1">
                    <span className="rounded-full bg-rose-500/12 px-3 py-1 text-sm font-medium text-rose-400">
                      Ask
                    </span>
                    <span className="text-xs text-zinc-500">
                      공급 우위 구간
                    </span>
                  </div>
                  <OrderBookRows levels={asks} tone="ask" />
                </div>

                <div className="rounded-[28px] border border-[#1ed760]/18 bg-[linear-gradient(135deg,_rgba(30,215,96,0.16)_0%,_rgba(12,12,12,0.95)_100%)] px-5 py-5 text-center shadow-[0_22px_40px_rgba(0,0,0,0.24)]">
                  <div className="text-xs uppercase tracking-[0.24em] text-[#1ed760]/72">
                    Mid Price
                  </div>
                  <div className="mt-2 text-3xl font-bold tracking-[-0.05em] text-white">
                    {formatPrice(lastTradePrice)}
                  </div>
                  <p className="mt-2 text-sm text-[#1ed760]">
                    체결 강도 118.4 / 매수 우위
                  </p>
                </div>

                <div>
                  <div className="mb-3 flex items-center justify-between px-1">
                    <span className="rounded-full bg-sky-500/12 px-3 py-1 text-sm font-medium text-sky-400">
                      Bid
                    </span>
                    <span className="text-xs text-zinc-500">
                      수요 우위 구간
                    </span>
                  </div>
                  <OrderBookRows levels={bids} tone="bid" />
                </div>
              </div>
            </div>

            <div className="rounded-[30px] border border-white/6 bg-[linear-gradient(180deg,_rgba(28,28,28,0.96)_0%,_rgba(14,14,14,0.98)_100%)] p-4 shadow-[0_28px_48px_rgba(0,0,0,0.28)] sm:p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold tracking-[-0.03em] text-white">
                    Quick Ticket
                  </h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    강한 대비와 빠른 입력 흐름에 맞춘 주문 패널입니다.
                  </p>
                </div>
                <div className="rounded-full bg-[#1ed760] px-3 py-1 text-xs font-semibold text-black">
                  Active
                </div>
              </div>

              <div className="mt-6 inline-flex rounded-full border border-white/8 bg-black/30 p-1">
                {[
                  { key: 'limit', label: '지정가' },
                  { key: 'market', label: '시장가' },
                ].map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() =>
                      setOrderType(option.key as 'limit' | 'market')
                    }
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                      orderType === option.key
                        ? 'bg-[#1ed760] text-black shadow-[0_10px_24px_rgba(30,215,96,0.3)]'
                        : 'text-zinc-500 hover:text-white'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <div className="mt-6 space-y-4">
                <label className="block rounded-[24px] border border-white/8 bg-[#181818] px-4 py-4">
                  <span className="text-sm font-medium text-zinc-500">
                    주문 수량
                  </span>
                  <div className="mt-2 flex items-end justify-between gap-3">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={quantity}
                      onChange={(event) => setQuantity(event.target.value)}
                      className="w-full border-none bg-transparent p-0 text-2xl font-bold tracking-[-0.04em] text-white outline-none"
                    />
                    <span className="shrink-0 text-sm font-medium text-zinc-500">
                      Shares
                    </span>
                  </div>
                </label>

                <label className="block rounded-[24px] border border-white/8 bg-[#181818] px-4 py-4">
                  <span className="text-sm font-medium text-zinc-500">
                    {orderType === 'limit' ? '지정 가격' : '예상 체결가'}
                  </span>
                  <div className="mt-2 flex items-end justify-between gap-3">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={orderType === 'limit' ? limitPrice : lastTradePrice}
                      onChange={(event) => setLimitPrice(event.target.value)}
                      disabled={orderType === 'market'}
                      className="w-full border-none bg-transparent p-0 text-2xl font-bold tracking-[-0.04em] text-white outline-none disabled:text-zinc-600"
                    />
                    <span className="shrink-0 text-sm font-medium text-zinc-500">
                      KRW
                    </span>
                  </div>
                </label>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {[
                  ['주문 가능', '128,400,000 KRW'],
                  ['증거금', '10%'],
                  ['예상 총액', formatPrice(Math.round(estimatedTotal || 0))],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-[24px] border border-white/6 bg-[#151515] px-4 py-4"
                  >
                    <div className="text-sm text-zinc-500">{label}</div>
                    <div className="mt-2 text-lg font-semibold tracking-[-0.03em] text-white">
                      {value}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  className="rounded-[24px] bg-gradient-to-b from-rose-500 to-red-600 px-5 py-4 text-base font-bold text-white shadow-[0_20px_32px_rgba(225,29,72,0.28)] transition hover:translate-y-[-1px]"
                >
                  매수
                </button>
                <button
                  type="button"
                  className="rounded-[24px] bg-gradient-to-b from-sky-500 to-blue-600 px-5 py-4 text-base font-bold text-white shadow-[0_20px_32px_rgba(37,99,235,0.25)] transition hover:translate-y-[-1px]"
                >
                  매도
                </button>
              </div>

              <div className="mt-6 rounded-[26px] border border-[#1ed760]/16 bg-[linear-gradient(135deg,_rgba(30,215,96,0.14)_0%,_rgba(18,18,18,0.96)_100%)] px-5 py-5 text-zinc-200">
                <div className="text-xs uppercase tracking-[0.22em] text-[#1ed760]/72">
                  Market Insight
                </div>
                <p className="mt-3 text-sm leading-6 text-zinc-300">
                  상단에는 종목 핵심 정보, 중앙에는 호가 깊이, 하단에는 즉시 액션을
                  배치해 스포티파이처럼 강한 대비와 몰입감이 있는 다크 화면으로
                  정리했습니다.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
