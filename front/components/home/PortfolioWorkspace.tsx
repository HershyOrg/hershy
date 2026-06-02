"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  BriefcaseBusiness,
  Landmark,
  PieChart,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { BalanceMyDataSnapshot, ExchangeConnection, MarketRow } from "./types";

type PortfolioWorkspaceProps = {
  exchangeConnections: ExchangeConnection[];
  balanceSnapshots?: BalanceMyDataSnapshot[];
  marketRows: MarketRow[];
  strategyCount: number;
  syncingBalanceConnectionId?: string;
  onSyncBalance?: (connectionId: string, market?: "spot" | "futures") => void;
  onManageExchanges: () => void;
};

type PortfolioHolding = {
  symbol: string;
  name: string;
  amount: number;
  valueUsd: number;
  allocation: number;
  pnl24h: number;
  note?: string;
};

type PortfolioVenueView = {
  id: string;
  name: string;
  status: string;
  live: boolean;
  type: ExchangeConnection["type"];
  hasLiveBalance: boolean;
  balanceSnapshot?: BalanceMyDataSnapshot;
  equityUsd: number;
  availableUsd: number;
  deployedUsd: number;
  pnl24h: number;
  syncLabel: string;
  riskLabel: string;
  holdings: PortfolioHolding[];
};

type AggregatedAsset = {
  symbol: string;
  name: string;
  amount: number;
  valueUsd: number;
  pnl24h: number;
  venues: string[];
};

type AllocationSlice = {
  label: string;
  valueUsd: number;
  ratio: number;
  color: string;
  helper?: string;
};

const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const USD_COMPACT_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const AMOUNT_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 4,
});

const PERCENT_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const DONUT_COLORS = [
  "#0f172a",
  "#0284c7",
  "#14b8a6",
  "#f59e0b",
  "#f97316",
  "#8b5cf6",
  "#ef4444",
] as const;


function formatUsd(value: number) {
  return USD_FORMATTER.format(value);
}

function formatCompactUsd(value: number) {
  return USD_COMPACT_FORMATTER.format(value);
}

function formatAmount(value: number) {
  return AMOUNT_FORMATTER.format(value);
}

function formatSignedPercent(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "" : "";
  return `${sign}${PERCENT_FORMATTER.format(value)}%`;
}

function parseAmount(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function formatSnapshotTime(value?: string) {
  if (!value) return "방금 전 실잔고 동기화";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "실잔고 동기화됨";
  return `${date.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 실잔고`;
}

function findBalanceSnapshot(connection: ExchangeConnection, snapshots: BalanceMyDataSnapshot[]) {
  const connectionTokens = [
    connection.id,
    connection.name,
  ].map((value) => String(value || "").toLowerCase());
  return snapshots
    .filter((snapshot) => {
      const snapshotTokens = [
        snapshot.connectionId,
        snapshot.exchangeId,
        snapshot.exchangeName,
        snapshot.exchange,
      ].map((value) => String(value || "").toLowerCase());
      return connectionTokens.some((token) => token && snapshotTokens.includes(token));
    })
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))[0];
}

function buildLiveHoldings(snapshot: BalanceMyDataSnapshot): PortfolioHolding[] {
  const assets = Array.isArray(snapshot.assets) ? snapshot.assets : [];
  const totalValue = snapshot.totals?.totalValueUsd
    ?? assets.reduce((sum, asset) => sum + parseAmount(asset.valueUsd ?? asset.availableUsd), 0);
  return assets
    .filter((asset) => parseAmount(asset.total ?? asset.available ?? asset.free) > 0)
    .slice(0, 18)
    .map((asset) => {
      const symbol = String(asset.asset || "");
      const amount = parseAmount(asset.total ?? asset.available ?? asset.free);
      const valueUsd = parseAmount(asset.valueUsd ?? asset.availableUsd);
      const available = String(asset.available ?? asset.free ?? "");
      return {
        symbol,
        name: symbol,
        amount,
        valueUsd,
        allocation: totalValue > 0 ? (valueUsd / totalValue) * 100 : 0,
        pnl24h: 0,
        note: available ? `가용 ${available}` : "실잔고",
      };
    });
}

function buildVenue(connection: ExchangeConnection, snapshots: BalanceMyDataSnapshot[]): PortfolioVenueView {
  const balanceSnapshot = findBalanceSnapshot(connection, snapshots);
  const liveHoldings = balanceSnapshot ? buildLiveHoldings(balanceSnapshot) : [];
  const liveEquity = balanceSnapshot?.totals?.totalValueUsd ?? liveHoldings.reduce((sum, holding) => sum + holding.valueUsd, 0);
  const liveAvailable = balanceSnapshot?.totals?.totalAvailableUsd
    ?? balanceSnapshot?.spendable?.totalStableAvailableUsd
    ?? liveHoldings.reduce((sum, holding) => sum + holding.valueUsd, 0);
  const hasLiveBalance = Boolean(balanceSnapshot);
  return {
    id: connection.id,
    name: connection.name,
    status: connection.status,
    live: connection.status === "연결됨",
    type: connection.type,
    hasLiveBalance,
    balanceSnapshot,
    equityUsd: hasLiveBalance ? parseAmount(liveEquity) : 0,
    availableUsd: hasLiveBalance ? parseAmount(liveAvailable) : 0,
    deployedUsd: hasLiveBalance ? Math.max(0, parseAmount(liveEquity) - parseAmount(liveAvailable)) : 0,
    pnl24h: 0,
    syncLabel: hasLiveBalance ? formatSnapshotTime(balanceSnapshot?.updatedAt) : "잔고 동기화 필요",
    riskLabel: hasLiveBalance
      ? `${balanceSnapshot?.market || balanceSnapshot?.accountType || "spot"} · ${balanceSnapshot?.spendable?.preferredAsset || "잔고"} 사용 가능`
      : "연결됨 · 실잔고 미동기화",
    holdings: hasLiveBalance ? liveHoldings : [],
  };
}

function aggregateAssets(venues: PortfolioVenueView[]) {
  const aggregated = new Map<string, AggregatedAsset>();

  venues.forEach((venue) => {
    venue.holdings.forEach((holding) => {
      const current = aggregated.get(holding.symbol);
      if (!current) {
        aggregated.set(holding.symbol, {
          symbol: holding.symbol,
          name: holding.name,
          amount: holding.amount,
          valueUsd: holding.valueUsd,
          pnl24h: holding.pnl24h * holding.valueUsd,
          venues: [venue.name],
        });
        return;
      }

      current.amount += holding.amount;
      current.valueUsd += holding.valueUsd;
      current.pnl24h += holding.pnl24h * holding.valueUsd;
      if (!current.venues.includes(venue.name)) {
        current.venues.push(venue.name);
      }
    });
  });

  return [...aggregated.values()]
    .map((asset) => ({
      ...asset,
      pnl24h: asset.valueUsd > 0 ? asset.pnl24h / asset.valueUsd : 0,
    }))
    .sort((left, right) => right.valueUsd - left.valueUsd);
}

function buildWatchItems(venues: PortfolioVenueView[], totalEquity: number) {
  const items: Array<{ title: string; detail: string; tone: "neutral" | "warn" | "good" }> = [];

  if (venues.length === 0) {
    return [{
      title: "연결된 자산 계정 없음",
      detail: "거래소를 연결하고 잔고를 동기화하면 포트폴리오와 전략 자금 기준이 표시됩니다.",
      tone: "neutral",
    }];
  }

  const mostConcentrated = aggregateAssets(venues)[0];
  if (mostConcentrated && totalEquity > 0) {
    const concentration = (mostConcentrated.valueUsd / totalEquity) * 100;
    items.push({
      title: `${mostConcentrated.symbol} 비중`,
      detail: `${PERCENT_FORMATTER.format(concentration)}% · ${mostConcentrated.venues.join(", ")}`,
      tone: concentration >= 45 ? "warn" : "good",
    });
  }

  venues.forEach((venue) => {
    const cashRatio = venue.equityUsd > 0 ? (venue.availableUsd / venue.equityUsd) * 100 : 0;
    if (cashRatio < 15) {
      items.push({
        title: `${venue.name} 현금 비중 낮음`,
        detail: `${PERCENT_FORMATTER.format(cashRatio)}% 가용 자금`,
        tone: "warn",
      });
    }
  });

  if (items.length < 3) {
    items.push({
      title: "리밸런스 메모",
      detail: "헤지 전략 실행 전 DEX 이벤트 포지션과 CEX 증거금 비중을 같이 확인하세요.",
      tone: "neutral",
    });
  }

  return items.slice(0, 4);
}

function buildAllocationSlices<T>(
  items: T[],
  getLabel: (item: T) => string,
  getValue: (item: T) => number,
  getHelper?: (item: T) => string | undefined,
  maxSlices = 5,
) {
  const ranked = [...items]
    .map((item) => ({
      label: getLabel(item),
      valueUsd: getValue(item),
      helper: getHelper?.(item),
    }))
    .filter((item) => item.valueUsd > 0)
    .sort((left, right) => right.valueUsd - left.valueUsd);

  const total = ranked.reduce((sum, item) => sum + item.valueUsd, 0);
  if (total <= 0) return [] as AllocationSlice[];

  const visible = ranked.slice(0, maxSlices);
  const hidden = ranked.slice(maxSlices);
  if (hidden.length > 0) {
    visible.push({
      label: "기타",
      valueUsd: hidden.reduce((sum, item) => sum + item.valueUsd, 0),
      helper: `${hidden.length}개 항목`,
    });
  }

  return visible.map((item, index) => ({
    label: item.label,
    valueUsd: item.valueUsd,
    ratio: (item.valueUsd / total) * 100,
    color: DONUT_COLORS[index % DONUT_COLORS.length],
    helper: item.helper,
  }));
}

function buildDonutGradient(slices: AllocationSlice[]) {
  if (slices.length === 0) {
    return "conic-gradient(#e2e8f0 0% 100%)";
  }

  let cursor = 0;
  const segments = slices.map((slice) => {
    const start = cursor;
    const end = cursor + slice.ratio;
    cursor = end;
    return `${slice.color} ${start}% ${end}%`;
  });

  return `conic-gradient(${segments.join(", ")})`;
}

function AllocationDonutCard({
  title,
  subtitle,
  totalValue,
  slices,
}: {
  title: string;
  subtitle: string;
  totalValue: number;
  slices: AllocationSlice[];
}) {
  const gradient = buildDonutGradient(slices);
  const topSlice = slices[0] ?? null;

  return (
    <div className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">{title}</div>
          <div className="mt-1 text-sm font-semibold text-slate-600">{subtitle}</div>
        </div>
        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-600">
          {slices.length} slices
        </span>
      </div>

      <div className="mt-4 grid items-center gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
        <div className="mx-auto flex h-[180px] w-[180px] items-center justify-center">
          <div
            className="relative h-[180px] w-[180px] rounded-full"
            style={{ background: gradient }}
          >
            <div className="absolute inset-[22px] flex flex-col items-center justify-center rounded-full border border-slate-200 bg-white text-center shadow-sm">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Total</div>
              <div className="mt-1 text-xl font-black text-slate-950">{formatCompactUsd(totalValue)}</div>
              {topSlice ? (
                <div className="mt-2 text-[11px] font-semibold text-slate-500">
                  최대 {topSlice.label} · {PERCENT_FORMATTER.format(topSlice.ratio)}%
                </div>
              ) : (
                <div className="mt-2 text-[11px] font-semibold text-slate-400">데이터 없음</div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          {slices.map((slice) => (
            <div key={slice.label} className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: slice.color }}
                    />
                    <div className="truncate text-sm font-bold text-slate-900">{slice.label}</div>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-slate-500">
                    {slice.helper ?? "포트폴리오 비중"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-black text-slate-950">{PERCENT_FORMATTER.format(slice.ratio)}%</div>
                  <div className="text-[11px] font-semibold text-slate-500">{formatCompactUsd(slice.valueUsd)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PortfolioWorkspace({
  exchangeConnections,
  balanceSnapshots = [],
  marketRows,
  strategyCount,
  syncingBalanceConnectionId = "",
  onSyncBalance,
  onManageExchanges,
}: PortfolioWorkspaceProps) {
  const connectedExchangeCount = exchangeConnections.filter((connection) => connection.status === "연결됨").length;
  const venues = exchangeConnections
    .map((connection) => buildVenue(connection, balanceSnapshots))
    .filter((venue) => venue.live || venue.hasLiveBalance);
  const syncedVenueCount = venues.filter((venue) => venue.hasLiveBalance).length;
  const totalEquity = venues.reduce((sum, venue) => sum + venue.equityUsd, 0);
  const totalAvailable = venues.reduce((sum, venue) => sum + venue.availableUsd, 0);
  const totalDeployed = venues.reduce((sum, venue) => sum + venue.deployedUsd, 0);
  const weightedPnl = totalEquity > 0
    ? venues.reduce((sum, venue) => sum + venue.equityUsd * venue.pnl24h, 0) / totalEquity
    : 0;
  const aggregatedAssets = aggregateAssets(venues);
  const venueAllocationSlices = buildAllocationSlices(
    venues,
    (venue) => venue.name,
    (venue) => venue.equityUsd,
    (venue) => `${venue.type} · ${venue.hasLiveBalance ? "실잔고" : "동기화 필요"}`,
  );
  const assetAllocationSlices = buildAllocationSlices(
    aggregatedAssets,
    (asset) => asset.symbol,
    (asset) => asset.valueUsd,
    (asset) => asset.venues.join(" · "),
  );
  const watchItems = buildWatchItems(venues, totalEquity);
  const defaultVenueId = venues.find((venue) => venue.hasLiveBalance)?.id ?? venues[0]?.id ?? "";
  const [selectedVenueId, setSelectedVenueId] = useState(defaultVenueId);

  useEffect(() => {
    if (!venues.some((venue) => venue.id === selectedVenueId)) {
      setSelectedVenueId(defaultVenueId);
    }
  }, [defaultVenueId, selectedVenueId, venues]);

  const selectedVenue = venues.find((venue) => venue.id === selectedVenueId) ?? venues[0] ?? null;
  const canSyncSelectedBalance = Boolean(
    onSyncBalance &&
    selectedVenue &&
    /binance/i.test(`${selectedVenue.id} ${selectedVenue.name}`),
  );
  const isSyncingSelectedBalance = Boolean(selectedVenue && syncingBalanceConnectionId === selectedVenue.id);

  return (
    <div className="h-full overflow-auto bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.12),_transparent_28%),radial-gradient(circle_at_right,_rgba(14,165,233,0.12),_transparent_24%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)]">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4 p-4 lg:p-6">
        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(255,247,237,0.94))] shadow-sm">
          <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1.25fr)_360px] xl:p-6">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-amber-800">
                  Portfolio Command Center
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600">
                  자산 계정 {venues.length}개
                </span>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700">
                  실잔고 {syncedVenueCount}개
                </span>
              </div>
              <h2 className="mt-4 text-3xl font-black tracking-tight text-slate-950">
                각 거래소 자산을 한 화면에서 추적하고,
                <br className="hidden md:block" /> 전략이 실제로 먹는 증거금까지 같이 봅니다.
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                연결되어 있고 잔고가 동기화된 계정만 포트폴리오 자산으로 집계합니다. 아직 연결하지 않은 거래소의 샘플 잔고는 표시하지 않습니다.
              </p>

              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                    <Wallet className="h-4 w-4 text-amber-600" />
                    Total Equity
                  </div>
                  <div className="mt-2 text-3xl font-black text-slate-950">{formatCompactUsd(totalEquity)}</div>
                  <div className="mt-1 text-xs font-semibold text-slate-500">{formatUsd(totalEquity)} 기준</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                    <BriefcaseBusiness className="h-4 w-4 text-cyan-600" />
                    Strategy Capital
                  </div>
                  <div className="mt-2 text-3xl font-black text-slate-950">{formatCompactUsd(totalDeployed)}</div>
                  <div className="mt-1 text-xs font-semibold text-slate-500">{strategyCount}개 템플릿이 이 자금을 참조</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                    <Activity className="h-4 w-4 text-emerald-600" />
                    24H Drift
                  </div>
                  <div className={cn("mt-2 text-3xl font-black", weightedPnl >= 0 ? "text-emerald-600" : "text-rose-600")}>
                    {formatSignedPercent(weightedPnl)}
                  </div>
                  <div className="mt-1 text-xs font-semibold text-slate-500">가중 평균 손익 변화</div>
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-white/88 p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Available to Deploy</div>
                  <div className="mt-1 text-2xl font-black text-slate-950">{formatCompactUsd(totalAvailable)}</div>
                </div>
                <button
                  type="button"
                  onClick={onManageExchanges}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  <Landmark className="h-4 w-4 text-amber-600" />
                  거래소 관리
                </button>
                <button
                  type="button"
                  onClick={() => selectedVenue ? onSyncBalance?.(selectedVenue.id, "spot") : undefined}
                  disabled={!canSyncSelectedBalance || isSyncingSelectedBalance}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-sm font-bold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <RefreshCw className={cn("h-4 w-4", isSyncingSelectedBalance ? "animate-spin" : "")} />
                  {isSyncingSelectedBalance ? "동기화 중" : "잔고 동기화"}
                </button>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-950 p-4 text-slate-100">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-black">시장 드리프트 체크</div>
                  <span className="text-[11px] font-semibold text-slate-400">자산 노출과 같이 보기</span>
                </div>
                <div className="mt-3 space-y-2">
                  {marketRows.slice(0, 4).map((row) => (
                    <div key={row.symbol} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
                      <div>
                        <div className="text-sm font-bold">{row.symbol}</div>
                        <div className="text-[11px] text-slate-400">{row.price}</div>
                      </div>
                      <div className={cn("text-sm font-black", row.tone === "up" ? "text-emerald-400" : "text-rose-400")}>
                        {row.change}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm xl:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Exchange Accounts</div>
                <h3 className="mt-1 text-xl font-black text-slate-950">거래소별 자산 보기</h3>
              </div>
              <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                연결 {connectedExchangeCount} / 실잔고 {syncedVenueCount}
              </div>
            </div>

            {venues.length > 0 ? (
              <div className="mt-4 grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                {venues.map((venue) => {
                const cashRatio = venue.equityUsd > 0 ? (venue.availableUsd / venue.equityUsd) * 100 : 0;
                return (
                  <button
                    key={venue.id}
                    type="button"
                    onClick={() => setSelectedVenueId(venue.id)}
                    className={cn(
                      "rounded-[24px] border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md",
                      selectedVenue?.id === venue.id
                        ? "border-slate-900 bg-slate-950 text-white shadow-lg"
                        : "border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] text-slate-950",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <div className={cn(
                            "h-2.5 w-2.5 rounded-full",
                            venue.live ? "bg-emerald-500" : "bg-amber-500",
                          )} />
                          <div className="text-lg font-black">{venue.name}</div>
                        </div>
                        <div className={cn("mt-1 text-xs font-semibold", selectedVenue?.id === venue.id ? "text-slate-300" : "text-slate-500")}>
                          {venue.type} · {venue.hasLiveBalance ? venue.syncLabel : "잔고 동기화 필요"}
                        </div>
                      </div>
                      <span className={cn(
                        "rounded-full px-2.5 py-1 text-[11px] font-bold",
                        venue.hasLiveBalance
                          ? selectedVenue?.id === venue.id
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-emerald-50 text-emerald-700"
                          : selectedVenue?.id === venue.id
                            ? "bg-amber-500/15 text-amber-300"
                            : "bg-amber-50 text-amber-700",
                      )}>
                        {venue.hasLiveBalance ? "Synced" : "Live"}
                      </span>
                    </div>

                    <div className="mt-4 flex items-end justify-between gap-3">
                      <div>
                        <div className={cn("text-[11px] font-bold uppercase tracking-wide", selectedVenue?.id === venue.id ? "text-slate-400" : "text-slate-500")}>
                          Equity
                        </div>
                        <div className="mt-1 text-2xl font-black">{formatCompactUsd(venue.equityUsd)}</div>
                      </div>
                      <div className={cn("text-sm font-black", venue.pnl24h >= 0 ? "text-emerald-500" : "text-rose-500")}>
                        {formatSignedPercent(venue.pnl24h)}
                      </div>
                    </div>

                    <div className="mt-4 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className={selectedVenue?.id === venue.id ? "text-slate-300" : "text-slate-500"}>가용 자금</span>
                        <span className="font-bold">{formatCompactUsd(venue.availableUsd)}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-200/80">
                        <div
                          className={cn("h-full rounded-full", selectedVenue?.id === venue.id ? "bg-white" : "bg-slate-900")}
                          style={{ width: venue.equityUsd > 0 ? `${Math.min(Math.max(cashRatio, 6), 100)}%` : "0%" }}
                        />
                      </div>
                      <div className={cn("text-[11px] font-semibold", selectedVenue?.id === venue.id ? "text-slate-300" : "text-slate-500")}>
                        {venue.riskLabel}
                      </div>
                    </div>
                  </button>
                );
                })}
              </div>
            ) : (
              <div className="mt-4 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
                <div className="text-sm font-black text-slate-900">표시할 실잔고가 없습니다</div>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
                  거래소 관리에서 API 키를 저장하고 잔고 동기화를 실행하면 이 영역에 실제 자산 계정만 표시됩니다.
                </p>
                <button
                  type="button"
                  onClick={onManageExchanges}
                  className="mt-4 inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-100"
                >
                  <Landmark className="h-4 w-4 text-amber-600" />
                  거래소 관리
                </button>
              </div>
            )}

            <div className="mt-4 grid gap-4 2xl:grid-cols-2">
              <AllocationDonutCard
                title="Venue Weight"
                subtitle="거래소별 전체 자산 비중"
                totalValue={totalEquity}
                slices={venueAllocationSlices}
              />
              <AllocationDonutCard
                title="Asset Weight"
                subtitle="자산별 전체 포트폴리오 비중"
                totalValue={totalEquity}
                slices={assetAllocationSlices}
              />
            </div>
          </section>

          <aside className="space-y-4">
            <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm xl:p-5">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                <PieChart className="h-4 w-4 text-cyan-600" />
                Cross-Exchange Allocation
              </div>
              <div className="mt-4 space-y-3">
                {aggregatedAssets.length > 0 ? aggregatedAssets.slice(0, 6).map((asset) => {
                  const ratio = totalEquity > 0 ? (asset.valueUsd / totalEquity) * 100 : 0;
                  return (
                    <div key={asset.symbol}>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <div>
                          <div className="font-bold text-slate-900">{asset.symbol}</div>
                          <div className="text-[11px] text-slate-500">{asset.venues.join(" · ")}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-black text-slate-950">{formatCompactUsd(asset.valueUsd)}</div>
                          <div className={cn("text-[11px] font-semibold", asset.pnl24h >= 0 ? "text-emerald-600" : "text-rose-600")}>
                            {formatSignedPercent(asset.pnl24h)}
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={cn("h-full rounded-full", ratio >= 30 ? "bg-amber-500" : "bg-cyan-600")}
                          style={{ width: `${Math.min(Math.max(ratio, 8), 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                }) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-center text-sm font-semibold text-slate-500">
                    잔고 동기화 후 자산 비중이 표시됩니다.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm xl:p-5">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                Rebalance Watch
              </div>
              <div className="mt-4 space-y-3">
                {watchItems.map((item) => (
                  <div
                    key={item.title}
                    className={cn(
                      "rounded-2xl border px-3 py-3",
                      item.tone === "warn"
                        ? "border-amber-200 bg-amber-50"
                        : item.tone === "good"
                          ? "border-emerald-200 bg-emerald-50"
                          : "border-slate-200 bg-slate-50",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-bold text-slate-900">{item.title}</div>
                      <ArrowUpRight className="h-4 w-4 text-slate-400" />
                    </div>
                    <div className="mt-1 text-xs leading-5 text-slate-600">{item.detail}</div>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>

        {selectedVenue ? (
          <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm xl:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Selected Venue</div>
                <h3 className="mt-1 text-xl font-black text-slate-950">{selectedVenue.name} 자산 상세</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedVenue.hasLiveBalance ? selectedVenue.syncLabel : selectedVenue.live ? "잔고 동기화 버튼으로 실잔고 마이데이터 생성" : "라이브 읽기 권한 연결 시 실잔고 API로 교체"} · {selectedVenue.riskLabel}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                  Equity {formatCompactUsd(selectedVenue.equityUsd)}
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                  Available {formatCompactUsd(selectedVenue.availableUsd)}
                </span>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-3xl border border-slate-200">
              <div className="grid grid-cols-[minmax(0,1.6fr)_1fr_1fr_0.8fr_0.8fr] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                <div>Asset</div>
                <div>Amount</div>
                <div>Value</div>
                <div>24H</div>
                <div>Weight</div>
              </div>
              <div className="divide-y divide-slate-200">
                {selectedVenue.holdings.length > 0 ? selectedVenue.holdings.map((holding) => (
                  <div
                    key={`${selectedVenue.id}-${holding.symbol}`}
                    className="grid grid-cols-[minmax(0,1.6fr)_1fr_1fr_0.8fr_0.8fr] items-center gap-3 px-4 py-4 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-black text-slate-950">{holding.symbol}</div>
                      <div className="truncate text-xs text-slate-500">
                        {holding.name}
                        {holding.note ? ` · ${holding.note}` : ""}
                      </div>
                    </div>
                    <div className="font-semibold text-slate-700">{formatAmount(holding.amount)}</div>
                    <div className="font-semibold text-slate-700">{formatUsd(holding.valueUsd)}</div>
                    <div className={cn("font-black", holding.pnl24h >= 0 ? "text-emerald-600" : "text-rose-600")}>
                      {formatSignedPercent(holding.pnl24h)}
                    </div>
                    <div>
                      <div className="font-bold text-slate-900">{PERCENT_FORMATTER.format(holding.allocation)}%</div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={cn("h-full rounded-full", holding.allocation >= 40 ? "bg-amber-500" : "bg-slate-900")}
                          style={{ width: `${Math.min(Math.max(holding.allocation, 6), 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )) : (
                  <div className="px-4 py-8 text-center text-sm font-semibold text-slate-500">
                    아직 동기화된 자산이 없습니다.
                  </div>
                )}
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
