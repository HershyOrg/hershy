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

export function CryptoEtfVisxDashboard() {
  const [selectedAsset, setSelectedAsset] = useState("BTC");
  const selected = useMemo(() => allocations.find((item) => item.asset === selectedAsset) ?? allocations[0], [selectedAsset]);

  return (
    <div className="bg-neutral-50 p-6 text-neutral-950 w-full rounded-lg h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col justify-between gap-4 rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm md:flex-row md:items-end">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-neutral-500">Core Crypto Infrastructure ETF</p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">Institutional crypto exposure, risk-capped.</h1>
            <p className="mt-3 max-w-2xl text-neutral-600 text-sm">
              NAV growth, portfolio weights, trailing returns, and rebalance decisions in one clean product demo screen.
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
            <div className="h-[240px]">
              <NavLineChart />
            </div>
          </div>

          <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-xl font-semibold">Portfolio Allocation</h2>
              <p className="text-sm text-neutral-500">Capped market-cap style</p>
            </div>
            <div className="h-[180px]">
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
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-xl font-semibold">Trailing Returns</h2>
              <p className="text-sm text-neutral-500">Demo presentation</p>
            </div>
            <div className="h-[200px]">
              <ReturnBars />
            </div>
          </div>

          <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Rebalance Log</h2>
                <p className="text-sm text-neutral-500">Explainable ETF</p>
              </div>
              <span className="rounded-full bg-neutral-100 px-3 py-1 text-sm text-neutral-600">Rules engine</span>
            </div>
            <div className="space-y-3 max-h-[200px] overflow-y-auto pr-2">
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
