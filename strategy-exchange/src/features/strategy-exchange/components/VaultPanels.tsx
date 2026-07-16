import { useMemo, useState, type FormEvent, type MouseEvent } from "react";
import {
  selectUserAccountByAddress,
  type AdapterFlowRow,
  type AdapterFundingHistoryRow,
  type AdapterPositionRow,
  type AdapterTradeHistoryRow,
  type StrategyVaultMetadata,
  type VaultBalanceRow,
} from "../../../../demoDB";
import type { Strategy } from "../types/strategyTypes";
import { useVaultDiscussion } from "../hooks/useVaultDiscussion";
import { LightweightReturnChart } from "./LightweightReturnChart";
import { UserAvatar } from "../../../shared/components";
import { disclosureLabels, productTypeLabels } from "../constants";
import {
  formatAddress,
  formatCompact,
  formatCurrency,
  formatPct,
  formatSignedCurrency,
  formatTimestamp,
} from "../../../shared/utils/formatters";

const balanceChartColors = ["#d0ad4f", "#23b56e", "#8da9c9", "#d95757", "#a695d8", "#c9a956"];
const vaultChartIntervals = [
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "8h",
  "1day",
  "1month",
] as const;

type VaultChartInterval = (typeof vaultChartIntervals)[number];

type BalanceDonutRow = {
  id: string;
  label: string;
  amountLabel?: string;
  value: number;
  color?: string;
};

type BalanceDonutChartRow = BalanceDonutRow & {
  chartWeight: number;
  color: string;
};

type AdapterDataTab = "balances" | "positions" | "trades" | "funding" | "flows" | "depositors";

const vaultChartIntervalConfig: Record<VaultChartInterval, { seconds: number; points: number; noise: number }> = {
  "1m": { seconds: 60, points: 60, noise: 0.2 },
  "5m": { seconds: 300, points: 60, noise: 0.26 },
  "15m": { seconds: 900, points: 56, noise: 0.34 },
  "30m": { seconds: 1_800, points: 52, noise: 0.42 },
  "1h": { seconds: 3_600, points: 48, noise: 0.5 },
  "2h": { seconds: 7_200, points: 44, noise: 0.58 },
  "4h": { seconds: 14_400, points: 40, noise: 0.68 },
  "8h": { seconds: 28_800, points: 36, noise: 0.82 },
  "1day": { seconds: 86_400, points: 32, noise: 1 },
  "1month": { seconds: 2_592_000, points: 24, noise: 1.18 },
};

function formatAmount(value: number) {
  const absoluteValue = Math.abs(value);
  if (absoluteValue >= 1_000) return formatCompact(value);
  if (absoluteValue >= 1) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value);
  }
  return new Intl.NumberFormat("en-US", { maximumSignificantDigits: 4 }).format(value);
}

function formatUsdPrice(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

function formatRatioPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(4)}%`;
}

function getBalanceChartRows(rows: BalanceDonutRow[]) {
  const totalValue = rows.reduce((sum, row) => sum + Math.max(row.value, 0), 0) || 1;
  return rows
    .slice()
    .sort((a, b) => b.value - a.value)
    .map((row, index) => ({
      ...row,
      chartWeight: Math.max(row.value, 0) / totalValue,
      color: row.color ?? balanceChartColors[index % balanceChartColors.length],
    }));
}

function getDonutSegmentPath(startRatio: number, endRatio: number) {
  const radius = 38;
  const center = 50;
  const startAngle = startRatio * Math.PI * 2 - Math.PI / 2;
  const endAngle = endRatio * Math.PI * 2 - Math.PI / 2;
  const largeArc = endRatio - startRatio > 0.5 ? 1 : 0;
  const startX = center + radius * Math.cos(startAngle);
  const startY = center + radius * Math.sin(startAngle);
  const endX = center + radius * Math.cos(endAngle);
  const endY = center + radius * Math.sin(endAngle);

  return `M ${startX.toFixed(3)} ${startY.toFixed(3)} A ${radius} ${radius} 0 ${largeArc} 1 ${endX.toFixed(3)} ${endY.toFixed(3)}`;
}

function BalanceDonut({
  rows,
  ariaLabel,
  totalLabel = "Total",
}: {
  rows: BalanceDonutRow[];
  ariaLabel: string;
  totalLabel?: string;
}) {
  const chartRows = getBalanceChartRows(rows);
  const totalValue = chartRows.reduce((sum, row) => sum + row.value, 0);
  const [tooltip, setTooltip] = useState<{
    label: string;
    amountLabel?: string;
    value: number;
    x: number;
    y: number;
  } | null>(null);
  let offset = 0;

  const showTooltip = (
    row: BalanceDonutChartRow,
    event: MouseEvent<SVGElement>,
  ) => {
    const donutElement = event.currentTarget.ownerSVGElement?.parentElement;
    if (!donutElement) return;
    const bounds = donutElement.getBoundingClientRect();
    setTooltip({
      label: row.label,
      amountLabel: row.amountLabel,
      value: row.value,
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });
  };

  return (
    <div className="vault-balance-chart">
      <div className="vault-balance-donut" aria-label={ariaLabel}>
        <svg viewBox="0 0 100 100" role="img">
          <circle cx="50" cy="50" r="38" className="vault-balance-donut-track" />
          {chartRows.map((row) => {
            const start = offset;
            const end = offset + row.chartWeight;
            offset = end;
            if (row.chartWeight <= 0) {
              return null;
            }
            if (row.chartWeight >= 0.999) {
              return (
                <circle
                  key={row.id}
                  cx="50"
                  cy="50"
                  r="38"
                  className="vault-balance-donut-segment"
                  style={{ stroke: row.color }}
                  onMouseEnter={(event) => showTooltip(row, event)}
                  onMouseMove={(event) => showTooltip(row, event)}
                  onMouseLeave={() => setTooltip(null)}
                />
              );
            }
            return (
              <path
                key={row.id}
                d={getDonutSegmentPath(start, end)}
                className="vault-balance-donut-segment"
                style={{ stroke: row.color }}
                onMouseEnter={(event) => showTooltip(row, event)}
                onMouseMove={(event) => showTooltip(row, event)}
                onMouseLeave={() => setTooltip(null)}
              />
            );
          })}
        </svg>
        <div className="vault-balance-donut-total">
          <span>{totalLabel}</span>
          <strong>{formatCurrency(totalValue)}</strong>
        </div>
        {tooltip ? (
          <div
            className="vault-balance-tooltip"
            style={{
              left: tooltip.x,
              top: tooltip.y,
            }}
          >
            <strong>{tooltip.label}</strong>
            {tooltip.amountLabel ? <span>{tooltip.amountLabel}</span> : null}
            <span>{formatCurrency(tooltip.value)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TokenBalanceDonut({ balances }: { balances: VaultBalanceRow[] }) {
  const rows = balances.map((balance) => ({
    id: `${balance.token}-${balance.venue}-${balance.chain}`,
    label: balance.token,
    amountLabel: `${formatCompact(balance.amount)} ${balance.token}`,
    value: balance.value,
  }));

  return <BalanceDonut rows={rows} ariaLabel="token balance allocation chart" />;
}

function getStrategyValueRange(strategy: Strategy) {
  const values = strategy.pnlSeries.map((value) => Math.max(0, strategy.deployedCapital + value));
  const fallback = strategy.deployedCapital;

  return {
    high: values.length ? Math.max(...values) : fallback,
    low: values.length ? Math.min(...values) : fallback,
  };
}

function getInvestableBalances(rows: VaultBalanceRow[]) {
  return rows.filter((row) => row.token !== "Buffer" && row.venue !== "Reserve");
}

function getPositionBalanceRows(rows: VaultBalanceRow[], positionValue: number): VaultBalanceRow[] {
  const investableRows = getInvestableBalances(rows);
  const totalWeight = investableRows.reduce((sum, row) => sum + Math.max(row.weight, 0), 0) || 1;

  return investableRows.map((row) => {
    const weight = Math.max(row.weight, 0) / totalWeight;
    const value = positionValue * weight;
    const amount = row.value > 0 ? row.amount * (value / row.value) : 0;
    return {
      ...row,
      weight,
      value,
      amount,
    };
  });
}

function VaultProductProfilePanel({
  strategy,
  vaultDetails,
  maxTvl,
}: {
  strategy: Strategy;
  vaultDetails: StrategyVaultMetadata;
  maxTvl: number;
}) {
  const valueRange = getStrategyValueRange(strategy);
  const profileRows = [
    {
      label: "고점 / 저점",
      value: `${formatCurrency(valueRange.high)} / ${formatCurrency(valueRange.low)}`,
    },
    {
      label: "30D 리스크",
      value: `${strategy.maxDrawdown.toFixed(1)}% max drawdown`,
    },
    {
      label: "유동성",
      value: `$${formatCompact(strategy.dailyVolume)} daily volume`,
    },
    {
      label: "용량",
      value: `${formatCurrency(vaultDetails.strategyEquity)} / ${formatCurrency(maxTvl)}`,
    },
    {
      label: "업데이트",
      value: formatTimestamp(vaultDetails.updatedAt),
    },
  ];

  return (
    <section className="vault-section vault-product-profile" aria-label="strategy product profile">
      <div className="panel-heading">
        <span>Overview</span>
        <strong>{productTypeLabels[strategy.productType]} / {disclosureLabels[strategy.disclosure]}</strong>
      </div>
      <div className="vault-profile-grid">
        {profileRows.map((row) => (
          <div key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function AdapterDataEmpty({ label }: { label: string }) {
  return <div className="adapter-data-empty">No {label} rows</div>;
}

function AdapterSidePill({ side }: { side: "Long" | "Short" }) {
  return <span className={`adapter-side ${side.toLowerCase()}`}>{side}</span>;
}

function AdapterBalancesTable({ balances }: { balances: VaultBalanceRow[] }) {
  const totalValue = balances.reduce((sum, row) => sum + row.value, 0) || 1;

  if (balances.length === 0) {
    return <AdapterDataEmpty label="balance" />;
  }

  return (
    <div className="adapter-data-balance-layout">
      <TokenBalanceDonut balances={balances} />
      <div className="adapter-data-scroll">
        <div className="adapter-data-table adapter-balances-table">
          <div className="adapter-data-table-head">
            <span>Asset</span>
            <span>Venue</span>
            <span>Amount</span>
            <span>Value</span>
            <span>Weight</span>
          </div>
          {balances.map((balance) => (
            <div className="adapter-data-table-row" key={`${balance.token}-${balance.venue}-${balance.sortOrder}`}>
              <strong>{balance.token}</strong>
              <span>{balance.venue}</span>
              <span>{formatAmount(balance.amount)}</span>
              <span>{formatCurrency(balance.value)}</span>
              <span>{((balance.value / totalValue) * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AdapterPositionsTable({ positions }: { positions: AdapterPositionRow[] }) {
  if (positions.length === 0) {
    return <AdapterDataEmpty label="position" />;
  }

  return (
    <div className="adapter-data-scroll">
      <div className="adapter-data-table adapter-positions-table">
        <div className="adapter-data-table-head">
          <span>Market</span>
          <span>Side</span>
          <span>Size</span>
          <span>Entry</span>
          <span>Mark</span>
          <span>Liq.</span>
          <span>Margin</span>
          <span>uPnL</span>
          <span>Funding</span>
        </div>
        {positions.map((position) => (
          <div className="adapter-data-table-row" key={`${position.coin}-${position.sortOrder}`}>
            <strong>{position.coin}-PERP</strong>
            <AdapterSidePill side={position.side} />
            <span>{formatAmount(position.size)}</span>
            <span>{formatUsdPrice(position.entryPrice)}</span>
            <span>{formatUsdPrice(position.markPrice)}</span>
            <span>{formatUsdPrice(position.liquidationPrice)}</span>
            <span>{formatCurrency(position.marginUsed)}</span>
            <span className={position.unrealizedPnl >= 0 ? "positive" : "negative"}>
              {formatSignedCurrency(position.unrealizedPnl)}
            </span>
            <span className={position.fundingRate >= 0 ? "positive" : "negative"}>
              {formatRatioPercent(position.fundingRate)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdapterTradesTable({ trades }: { trades: AdapterTradeHistoryRow[] }) {
  if (trades.length === 0) {
    return <AdapterDataEmpty label="trade history" />;
  }

  return (
    <div className="adapter-data-scroll">
      <div className="adapter-data-table adapter-trades-table">
        <div className="adapter-data-table-head">
          <span>Time</span>
          <span>Actor</span>
          <span>Action</span>
          <span>Market</span>
          <span>Side</span>
          <span>Size</span>
          <span>Price</span>
          <span>Value</span>
          <span>Fee</span>
          <span>PnL</span>
        </div>
        {trades.map((trade) => (
          <div className="adapter-data-table-row" key={trade.id}>
            <span>{formatTimestamp(trade.createdAt)}</span>
            <strong>{trade.actor}</strong>
            <span className="adapter-action">{trade.action}</span>
            <span>{trade.coin}-PERP</span>
            <AdapterSidePill side={trade.side} />
            <span>{formatAmount(trade.size)}</span>
            <span>{formatUsdPrice(trade.price)}</span>
            <span>{formatCurrency(trade.value)}</span>
            <span>{formatUsdPrice(trade.fee)}</span>
            <span className={trade.pnl >= 0 ? "positive" : "negative"}>{formatSignedCurrency(trade.pnl)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdapterFundingTable({ funding }: { funding: AdapterFundingHistoryRow[] }) {
  if (funding.length === 0) {
    return <AdapterDataEmpty label="funding history" />;
  }

  return (
    <div className="adapter-data-scroll">
      <div className="adapter-data-table adapter-funding-table">
        <div className="adapter-data-table-head">
          <span>Time</span>
          <span>Market</span>
          <span>Side</span>
          <span>Rate</span>
          <span>Payment</span>
        </div>
        {funding.map((row) => (
          <div className="adapter-data-table-row" key={row.id}>
            <span>{formatTimestamp(row.createdAt)}</span>
            <strong>{row.coin}-PERP</strong>
            <AdapterSidePill side={row.side} />
            <span className={row.rate >= 0 ? "positive" : "negative"}>{formatRatioPercent(row.rate)}</span>
            <span className={row.payment >= 0 ? "positive" : "negative"}>
              {formatSignedCurrency(row.payment)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdapterFlowsTable({ flows }: { flows: AdapterFlowRow[] }) {
  if (flows.length === 0) {
    return <AdapterDataEmpty label="deposit and withdrawal" />;
  }

  return (
    <div className="adapter-data-scroll">
      <div className="adapter-data-table adapter-flows-table">
        <div className="adapter-data-table-head">
          <span>Time</span>
          <span>Type</span>
          <span>Account</span>
          <span>Amount</span>
        </div>
        {flows.map((flow) => (
          <div className="adapter-data-table-row" key={flow.id}>
            <span>{formatTimestamp(flow.createdAt)}</span>
            <span className={`adapter-flow ${flow.type.toLowerCase()}`}>{flow.type}</span>
            <strong>{flow.accountLabel}</strong>
            <span>{formatCurrency(flow.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdapterDepositorsTable({ depositors }: { depositors: StrategyVaultMetadata["depositors"] }) {
  if (depositors.length === 0) {
    return <AdapterDataEmpty label="depositor" />;
  }

  return (
    <div className="adapter-data-scroll">
      <div className="adapter-data-table adapter-depositors-table">
        <div className="adapter-data-table-head">
          <span>Depositor</span>
          <span>Equity</span>
          <span>Share</span>
          <span>PnL</span>
          <span>Since</span>
        </div>
        {depositors.map((depositor) => (
          <div className="adapter-data-table-row" key={depositor.id}>
            <strong className="depositor-address">{depositor.maskedAddress}</strong>
            <span>{formatCurrency(depositor.equity)}</span>
            <span>{(depositor.sharePct * 100).toFixed(2)}%</span>
            <span className={depositor.pnl >= 0 ? "positive" : "negative"}>
              {formatSignedCurrency(depositor.pnl)}
            </span>
            <span>{formatTimestamp(depositor.joinedAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdapterDataPanel({
  vaultDetails,
  balanceRows,
}: {
  vaultDetails: StrategyVaultMetadata;
  balanceRows: VaultBalanceRow[];
}) {
  const [activeTab, setActiveTab] = useState<AdapterDataTab>("balances");
  const tabs: Array<{ id: AdapterDataTab; label: string; count: string | number }> = [
    { id: "balances", label: "Balances", count: balanceRows.length },
    { id: "positions", label: "Positions", count: vaultDetails.positions.length },
    { id: "trades", label: "Trade History", count: vaultDetails.trades.length },
    { id: "funding", label: "Funding History", count: vaultDetails.funding.length },
    { id: "flows", label: "Deposits and Withdrawals", count: vaultDetails.flows.length },
    { id: "depositors", label: "Depositors", count: "100+" },
  ];

  const renderActivePanel = () => {
    if (activeTab === "balances") return <AdapterBalancesTable balances={balanceRows} />;
    if (activeTab === "positions") return <AdapterPositionsTable positions={vaultDetails.positions} />;
    if (activeTab === "trades") return <AdapterTradesTable trades={vaultDetails.trades} />;
    if (activeTab === "funding") return <AdapterFundingTable funding={vaultDetails.funding} />;
    if (activeTab === "flows") return <AdapterFlowsTable flows={vaultDetails.flows} />;
    return <AdapterDepositorsTable depositors={vaultDetails.depositors} />;
  };

  return (
    <section className="vault-section adapter-data-panel" aria-label="adapter ledger">
      <div className="adapter-data-tabs" role="tablist" aria-label="adapter ledger tabs">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            className={`adapter-data-tab${activeTab === tab.id ? " active" : ""}`}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            <span>{tab.label}</span>
            <strong>{tab.count}</strong>
          </button>
        ))}
        <button className="adapter-filter-button" type="button">
          Filter
        </button>
      </div>
      <div className="adapter-data-body">{renderActivePanel()}</div>
    </section>
  );
}

export function VaultAnalyticsSections({
  strategy,
  vaultDetails,
  isVaultLoading,
  maxTvl,
  positionValue,
}: {
  strategy: Strategy;
  vaultDetails: StrategyVaultMetadata | null;
  isVaultLoading: boolean;
  maxTvl: number;
  positionValue: number;
}) {
  if (!vaultDetails) {
    return <div className="vault-loading">{isVaultLoading ? "Adapter loading" : "No adapter analytics"}</div>;
  }

  const hasPosition = positionValue > 0;
  const positionBalances = hasPosition ? getPositionBalanceRows(vaultDetails.balances, positionValue) : [];
  const balanceRows = hasPosition ? positionBalances : vaultDetails.balances;

  return (
    <div className="vault-lower-panels">
      <section className="vault-section vault-performance-section" aria-label="performance by period">
        <div className="panel-heading">
          <span>Performance</span>
          <strong>Equity / PnL / Volume</strong>
        </div>
        <div className="vault-table">
          <div className="vault-table-head">
            <span>Period</span>
            <span>PnL</span>
            <span>Equity</span>
            <span>Volume</span>
          </div>
          {vaultDetails.periods.map((period) => (
            <div className="vault-table-row" key={period.label}>
              <strong>{period.label}</strong>
              <span className={period.pnl >= 0 ? "positive" : "negative"}>
                {formatSignedCurrency(period.pnl)}
              </span>
              <span>{formatCurrency(period.equity)}</span>
              <span>${formatCompact(period.volume)}</span>
            </div>
          ))}
        </div>
      </section>

      <VaultProductProfilePanel strategy={strategy} vaultDetails={vaultDetails} maxTvl={maxTvl} />

      <AdapterDataPanel vaultDetails={vaultDetails} balanceRows={balanceRows} />

    </div>
  );
}

function buildVaultValueSeries(strategy: Strategy, vaultDetails: StrategyVaultMetadata | null) {
  const currentEquity = vaultDetails?.strategyEquity ?? strategy.deployedCapital + strategy.realizedPnl;
  const totalPnl = vaultDetails?.allTimePnl ?? strategy.realizedPnl;
  const latestPnl = strategy.pnlSeries[strategy.pnlSeries.length - 1] || 1;
  const baseEquity = currentEquity - totalPnl;

  return strategy.pnlSeries.map((pnl) => {
    const normalizedPnl = (pnl / latestPnl) * totalPnl;
    return Math.max(0, baseEquity + normalizedPnl);
  });
}

function getStableSeed(value: string) {
  return value.split("").reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 9_973, 17);
}

function interpolateSeries(series: number[], progress: number) {
  if (series.length === 0) return 0;
  if (series.length === 1) return series[0];

  const scaledIndex = progress * (series.length - 1);
  const lowerIndex = Math.floor(scaledIndex);
  const upperIndex = Math.min(series.length - 1, lowerIndex + 1);
  const segmentProgress = scaledIndex - lowerIndex;
  const lowerValue = series[lowerIndex];
  const upperValue = series[upperIndex];

  return lowerValue + (upperValue - lowerValue) * segmentProgress;
}

function buildIntervalSeries(series: number[], interval: VaultChartInterval, seedKey: string) {
  const config = vaultChartIntervalConfig[interval];
  const seed = getStableSeed(`${seedKey}-${interval}`);
  const firstValue = series[0] ?? 0;
  const lastValue = series[series.length - 1] ?? firstValue;
  const drift = Math.max(1, Math.abs(lastValue - firstValue), Math.abs(lastValue) * 0.012);

  return Array.from({ length: config.points }, (_, index) => {
    const progress = config.points <= 1 ? 1 : index / (config.points - 1);
    const baseline = interpolateSeries(series, progress);
    const wave =
      Math.sin(index * 0.72 + seed * 0.013) * config.noise +
      Math.cos(index * 0.29 + seed * 0.021) * config.noise * 0.45;

    return Math.max(0, Number((baseline + wave * drift * 0.028).toFixed(2)));
  });
}

function buildSharePriceSeries(valueSeries: number[]) {
  const baseNav = 100;
  const firstValue = valueSeries[0] || 1;

  return valueSeries.map((value) => Number(((value / firstValue) * baseNav).toFixed(2)));
}

export function VaultValueTracker({
  strategy,
  vaultDetails,
  isVaultLoading,
}: {
  strategy: Strategy;
  vaultDetails: StrategyVaultMetadata | null;
  isVaultLoading: boolean;
}) {
  const [activeInterval, setActiveInterval] = useState<VaultChartInterval>("1h");
  const baseValueSeries = useMemo(() => buildVaultValueSeries(strategy, vaultDetails), [strategy, vaultDetails]);
  const valueSeries = useMemo(
    () => buildIntervalSeries(baseValueSeries, activeInterval, strategy.id),
    [activeInterval, baseValueSeries, strategy.id],
  );
  const sharePriceSeries = useMemo(() => buildSharePriceSeries(valueSeries), [valueSeries]);
  const timeStepSeconds = vaultChartIntervalConfig[activeInterval].seconds;
  const currentSharePrice = sharePriceSeries[sharePriceSeries.length - 1] ?? 100;
  const firstSharePrice = sharePriceSeries[0] ?? currentSharePrice;
  const positive = currentSharePrice >= firstSharePrice;

  return (
    <div className={`vault-value-tracker${isVaultLoading ? " loading" : ""}`}>
      <div className="vault-chart-header">
        <div>
          <span>NAV / Share Price</span>
          <strong>{formatCurrency(currentSharePrice)}</strong>
        </div>
        <div className="vault-chart-intervals" role="group" aria-label="NAV and share price interval">
          {vaultChartIntervals.map((interval) => (
            <button
              type="button"
              key={interval}
              className={activeInterval === interval ? "active" : ""}
              aria-pressed={activeInterval === interval}
              onClick={() => setActiveInterval(interval)}
            >
              {interval}
            </button>
          ))}
        </div>
      </div>

      <div className="vault-value-chart logic-value-chart" aria-label={`${strategy.title} NAV and share price graph`}>
        <div className="vault-chart-caption">
          <span>NAV / Share Price</span>
          <strong className={positive ? "positive" : "negative"}>
            {formatPct(firstSharePrice > 0 ? ((currentSharePrice - firstSharePrice) / firstSharePrice) * 100 : 0)}
          </strong>
        </div>
        <LightweightReturnChart
          className="vault-value-lightweight-chart"
          series={sharePriceSeries}
          mode="value"
          height={620}
          fill
          positive={positive}
          backgroundColor="var(--surface-2)"
          timeStepSeconds={timeStepSeconds}
        />
      </div>
    </div>
  );
}

export function VaultDiscussionPanel({
  adapterAddress,
  onUserSelect,
}: {
  adapterAddress: string;
  onUserSelect: (address: string) => void;
}) {
  const { messages, discussionEndpoint, isDiscussionLoading, addLocalMessage } = useVaultDiscussion(adapterAddress);
  const [draftMessage, setDraftMessage] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = draftMessage.trim();
    if (!body) return;

    addLocalMessage(body);
    setDraftMessage("");
  };

  return (
    <section className="vault-discussion-panel" data-discussion-api-request={discussionEndpoint}>
      <div className="panel-heading">
        <span>Discussion</span>
        <strong>{isDiscussionLoading ? "Loading" : `${messages.length} messages`}</strong>
      </div>

      <div className="discussion-list">
        {isDiscussionLoading ? (
          <div className="discussion-empty">Loading discussion</div>
        ) : messages.length > 0 ? (
          messages.map((message) => {
            const canOpenProfile = message.authorAddress !== "local-session";
            const authorAccount = canOpenProfile ? selectUserAccountByAddress(message.authorAddress) : null;

            return (
              <article className="discussion-message" key={message.id}>
                <div>
                  <div className="discussion-author">
                    <UserAvatar
                      name={message.authorName}
                      src={authorAccount?.avatarUrl}
                      className="discussion-avatar"
                    />
                    <button
                      type="button"
                      disabled={!canOpenProfile}
                      onClick={() => {
                        if (canOpenProfile) onUserSelect(message.authorAddress);
                      }}
                    >
                      {message.authorName}
                    </button>
                  </div>
                  <span>
                    {formatAddress(message.authorAddress)} / {formatTimestamp(message.createdAt)}
                  </span>
                </div>
                <p>{message.body}</p>
              </article>
            );
          })
        ) : (
          <div className="discussion-empty">No discussion yet</div>
        )}
      </div>

      <form className="discussion-composer" onSubmit={handleSubmit}>
        <input
          value={draftMessage}
          onChange={(event) => setDraftMessage(event.target.value)}
          placeholder="Message"
        />
        <button type="submit">Send</button>
      </form>
    </section>
  );
}
