"use client"

import { useState } from "react"
import { ArrowUpRight, ArrowDownRight, TrendingUp } from "lucide-react"

interface OrderBookEntry {
  price: number
  quantity: number
  total: number
}

interface StockInfo {
  symbol: string
  name: string
  currentPrice: number
  change: number
  changePercent: number
  high: number
  low: number
  volume: string
}

const stockInfo: StockInfo = {
  symbol: "AAPL",
  name: "Apple Inc.",
  currentPrice: 178.52,
  change: 2.34,
  changePercent: 1.33,
  high: 180.12,
  low: 175.89,
  volume: "52.3M",
}

const askOrders: OrderBookEntry[] = [
  { price: 178.80, quantity: 1250, total: 223500 },
  { price: 178.75, quantity: 890, total: 159097.5 },
  { price: 178.70, quantity: 2100, total: 375270 },
  { price: 178.65, quantity: 1560, total: 278694 },
  { price: 178.60, quantity: 3200, total: 571520 },
]

const bidOrders: OrderBookEntry[] = [
  { price: 178.50, quantity: 1800, total: 321300 },
  { price: 178.45, quantity: 2450, total: 437202.5 },
  { price: 178.40, quantity: 1120, total: 200608 },
  { price: 178.35, quantity: 3100, total: 552885 },
  { price: 178.30, quantity: 890, total: 158687 },
]

export function OrderBook() {
  const [orderType, setOrderType] = useState<"market" | "limit">("limit")
  const [quantity, setQuantity] = useState<string>("100")
  const [limitPrice, setLimitPrice] = useState<string>(stockInfo.currentPrice.toString())

  const maxQuantity = Math.max(
    ...askOrders.map((o) => o.quantity),
    ...bidOrders.map((o) => o.quantity)
  )

  const formatNumber = (num: number) => {
    return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const formatQuantity = (num: number) => {
    return num.toLocaleString("en-US")
  }

  const isPositive = stockInfo.change >= 0

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Spotify Dark Card Container */}
      <div className="bg-neutral-900 rounded-2xl overflow-hidden">
        
        {/* Stock Info Header - Gradient Top */}
        <div className="bg-gradient-to-b from-neutral-800 to-neutral-900 p-6 pb-5">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/30">
              <TrendingUp className="w-8 h-8 text-black" strokeWidth={2.5} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white tracking-tight">{stockInfo.symbol}</h2>
              <p className="text-sm text-neutral-400">{stockInfo.name}</p>
            </div>
          </div>

          <div className="flex items-baseline gap-3 mb-5">
            <span className="text-5xl font-bold text-white tracking-tight">
              ${formatNumber(stockInfo.currentPrice)}
            </span>
            <div className={`flex items-center gap-1 px-3 py-1.5 rounded-full ${
              isPositive ? "bg-red-500/20 text-red-400" : "bg-blue-500/20 text-blue-400"
            }`}>
              {isPositive ? (
                <ArrowUpRight className="w-4 h-4" strokeWidth={2.5} />
              ) : (
                <ArrowDownRight className="w-4 h-4" strokeWidth={2.5} />
              )}
              <span className="text-sm font-bold">
                {isPositive ? "+" : ""}{stockInfo.changePercent}%
              </span>
            </div>
          </div>

          {/* Stats Row */}
          <div className="flex gap-8">
            <div>
              <p className="text-xs text-neutral-500 uppercase tracking-wider font-bold mb-1">High</p>
              <p className="text-base font-bold text-white">${formatNumber(stockInfo.high)}</p>
            </div>
            <div>
              <p className="text-xs text-neutral-500 uppercase tracking-wider font-bold mb-1">Low</p>
              <p className="text-base font-bold text-white">${formatNumber(stockInfo.low)}</p>
            </div>
            <div>
              <p className="text-xs text-neutral-500 uppercase tracking-wider font-bold mb-1">Vol</p>
              <p className="text-base font-bold text-white">{stockInfo.volume}</p>
            </div>
          </div>
        </div>

        {/* Order Book */}
        <div className="p-6 pt-2">
          <h3 className="text-xs text-neutral-500 uppercase tracking-widest font-bold mb-4">Order Book</h3>
          
          {/* Column Headers */}
          <div className="grid grid-cols-3 text-xs text-neutral-500 font-bold mb-2 px-1">
            <span>PRICE</span>
            <span className="text-right">QTY</span>
            <span className="text-right">TOTAL</span>
          </div>

          {/* Ask Orders (Blue - Sell) */}
          <div className="space-y-0.5 mb-2">
            {[...askOrders].reverse().map((order, index) => (
              <div
                key={`ask-${index}`}
                className="relative grid grid-cols-3 text-sm py-2.5 px-3 rounded-lg hover:bg-neutral-800 cursor-pointer transition-colors"
              >
                <div
                  className="absolute inset-0 bg-blue-500/15 rounded-lg"
                  style={{ width: `${(order.quantity / maxQuantity) * 100}%`, right: 0, left: "auto" }}
                />
                <span className="relative text-blue-400 font-bold">${formatNumber(order.price)}</span>
                <span className="relative text-neutral-300 text-right">{formatQuantity(order.quantity)}</span>
                <span className="relative text-neutral-500 text-right">${formatQuantity(Math.round(order.total / 1000))}K</span>
              </div>
            ))}
          </div>

          {/* Current Price Indicator */}
          <div className="flex items-center gap-3 py-3">
            <div className="flex-1 h-px bg-neutral-700" />
            <div className="px-5 py-2 bg-emerald-500 rounded-full">
              <span className="text-sm font-bold text-black">${formatNumber(stockInfo.currentPrice)}</span>
            </div>
            <div className="flex-1 h-px bg-neutral-700" />
          </div>

          {/* Bid Orders (Red - Buy) */}
          <div className="space-y-0.5">
            {bidOrders.map((order, index) => (
              <div
                key={`bid-${index}`}
                className="relative grid grid-cols-3 text-sm py-2.5 px-3 rounded-lg hover:bg-neutral-800 cursor-pointer transition-colors"
              >
                <div
                  className="absolute inset-0 bg-red-500/15 rounded-lg"
                  style={{ width: `${(order.quantity / maxQuantity) * 100}%`, right: 0, left: "auto" }}
                />
                <span className="relative text-red-400 font-bold">${formatNumber(order.price)}</span>
                <span className="relative text-neutral-300 text-right">{formatQuantity(order.quantity)}</span>
                <span className="relative text-neutral-500 text-right">${formatQuantity(Math.round(order.total / 1000))}K</span>
              </div>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-neutral-800 mx-6" />

        {/* Order Input */}
        <div className="p-6">
          {/* Order Type Toggle */}
          <div className="flex p-1 bg-neutral-800 rounded-lg mb-5">
            <button
              onClick={() => setOrderType("limit")}
              className={`flex-1 py-2.5 text-sm font-bold rounded-md transition-all ${
                orderType === "limit"
                  ? "bg-neutral-700 text-white"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              Limit
            </button>
            <button
              onClick={() => setOrderType("market")}
              className={`flex-1 py-2.5 text-sm font-bold rounded-md transition-all ${
                orderType === "market"
                  ? "bg-neutral-700 text-white"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              Market
            </button>
          </div>

          {/* Input Fields */}
          <div className="space-y-4 mb-5">
            {orderType === "limit" && (
              <div>
                <label className="text-xs text-neutral-500 uppercase tracking-wider font-bold mb-2 block">Price</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500 font-bold">$</span>
                  <input
                    type="number"
                    value={limitPrice}
                    onChange={(e) => setLimitPrice(e.target.value)}
                    className="w-full bg-neutral-800 border-2 border-transparent rounded-lg py-3.5 pl-8 pr-4 text-white text-base font-bold focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
              </div>
            )}
            <div>
              <label className="text-xs text-neutral-500 uppercase tracking-wider font-bold mb-2 block">Quantity</label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full bg-neutral-800 border-2 border-transparent rounded-lg py-3.5 px-4 text-white text-base font-bold focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
            <div className="flex gap-2">
              {[10, 25, 50, 100].map((percent) => (
                <button
                  key={percent}
                  onClick={() => setQuantity((percent * 10).toString())}
                  className="flex-1 py-2.5 text-xs font-bold text-neutral-400 bg-neutral-800 rounded-lg hover:bg-neutral-700 hover:text-white transition-colors"
                >
                  {percent}%
                </button>
              ))}
            </div>
          </div>

          {/* Estimated Total */}
          <div className="flex justify-between items-center mb-5 p-4 bg-neutral-800 rounded-xl">
            <span className="text-sm text-neutral-400 font-bold">Estimated Total</span>
            <span className="text-xl font-bold text-white">
              ${formatNumber(Number(quantity) * (orderType === "limit" ? Number(limitPrice) : stockInfo.currentPrice))}
            </span>
          </div>

          {/* Buy/Sell Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button className="py-4 bg-red-500 hover:bg-red-400 hover:scale-[1.02] active:scale-[0.98] text-black font-bold rounded-full transition-all shadow-lg shadow-red-500/30">
              Buy
            </button>
            <button className="py-4 bg-blue-500 hover:bg-blue-400 hover:scale-[1.02] active:scale-[0.98] text-black font-bold rounded-full transition-all shadow-lg shadow-blue-500/30">
              Sell
            </button>
          </div>

          {/* Spotify-style footer text */}
          <p className="text-center text-xs text-neutral-600 mt-4 font-medium">
            Real-time market data
          </p>
        </div>
      </div>
    </div>
  )
}
