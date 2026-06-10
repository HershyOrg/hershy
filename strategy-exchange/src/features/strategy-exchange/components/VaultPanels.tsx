import { useEffect, useMemo, useState, type FormEvent, type MouseEvent } from "react";
import { selectUserAccountByAddress, type StrategyVaultMetadata } from "../../../../demoDB";
import type { VaultBalanceRow } from "../../../../demoDB";
import type { Strategy } from "../types/strategyTypes";
import { useVaultActivity } from "../hooks/useVaultActivity";
import { useVaultDiscussion } from "../hooks/useVaultDiscussion";
import { LightweightReturnChart } from "./LightweightReturnChart";
import { UserAvatar } from "../../../shared/components";
import {
  formatAddress,
  formatCompact,
  formatCurrency,
  formatPct,
  formatSignedCurrency,
  formatTimestamp,
} from "../../../shared/utils/formatters";

const balanceChartColors = ["#d0ad4f", "#23b56e", "#8da9c9", "#d95757", "#a695d8", "#c9a956"];
const activityUsersPerPage = 4;
const activityTransactionsPerPage = 4;
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

function getChainBalanceRows(balances: VaultBalanceRow[]) {
  const chainTotals = new Map<string, number>();

  balances.forEach((balance) => {
    const chain = balance.chain || "Unassigned";
    chainTotals.set(chain, (chainTotals.get(chain) ?? 0) + Math.max(balance.value, 0));
  });

  return Array.from(chainTotals.entries())
    .sort(([, valueA], [, valueB]) => valueB - valueA)
    .map(([chain, value], index) => ({
      id: chain,
      label: chain,
      amountLabel: formatCurrency(value),
      value,
      color: balanceChartColors[index % balanceChartColors.length],
    }));
}

function ChainBalanceDonut({ balances }: { balances: VaultBalanceRow[] }) {
  const rows = getChainBalanceRows(balances);
  const totalValue = rows.reduce((sum, row) => sum + row.value, 0);

  return (
    <div className="vault-chain-balance-layout">
      <BalanceDonut rows={rows} ariaLabel="chain balance allocation chart" totalLabel="Chain TVL" />
      <div className="vault-chain-balance-list" role="table" aria-label="chain balance totals">
        {rows.map((row) => {
          const pct = totalValue > 0 ? (row.value / totalValue) * 100 : 0;

          return (
            <div className="vault-chain-balance-row" role="row" key={row.id}>
              <span className="vault-chain-color" style={{ backgroundColor: row.color }} />
              <strong>{row.label}</strong>
              <span>{formatCurrency(row.value)}</span>
              <em>{pct.toFixed(1)}%</em>
            </div>
          );
        })}
      </div>
    </div>
  );
}

async function copyTextToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function CopyAddressButton({
  address,
  copied,
  onCopy,
}: {
  address: string;
  copied: boolean;
  onCopy: (address: string) => void;
}) {
  return (
    <button
      type="button"
      className={`copy-address-button${copied ? " copied" : ""}`}
      title={address}
      onClick={() => onCopy(address)}
    >
      {copied ? "Copied" : formatAddress(address)}
    </button>
  );
}

export function VaultMetadataBlocks({
  forkCount,
  vaultDetails,
  isVaultLoading,
  maxTvl,
}: {
  forkCount: number;
  vaultDetails: StrategyVaultMetadata | null;
  isVaultLoading: boolean;
  maxTvl: number;
}) {
  const [copiedAddress, setCopiedAddress] = useState("");

  if (!vaultDetails) {
    return <div className="vault-loading">{isVaultLoading ? "Vault loading" : "No vault metadata"}</div>;
  }

  const handleCopyAddress = async (address: string) => {
    try {
      await copyTextToClipboard(address);
      setCopiedAddress(address);
      window.setTimeout(() => {
        setCopiedAddress((current) => (current === address ? "" : current));
      }, 1200);
    } catch {
      setCopiedAddress("");
    }
  };

  return (
    <>
      <div className="vault-address-row">
        <span>Vault</span>
        <CopyAddressButton
          address={vaultDetails.address}
          copied={copiedAddress === vaultDetails.address}
          onCopy={handleCopyAddress}
        />
      </div>

      <div className="vault-metrics-layout">
        <div className="vault-primary-metrics">
          <div className="vault-metric-card tvl-ratio-metric">
            <span className="field-label">TVL / MAX TVL</span>
            <strong>
              {formatCurrency(vaultDetails.strategyEquity)}
              <span>/</span>
              {formatCurrency(maxTvl)}
            </strong>
          </div>
          <div className="vault-metric-card">
            <span className="field-label">APR</span>
            <strong className={vaultDetails.projectedApr >= 0 ? "positive" : "negative"}>
              {formatPct(vaultDetails.projectedApr)}
            </strong>
          </div>
        </div>

        <div className="vault-secondary-metrics">
          <div className="vault-metric-card">
            <span className="field-label">Fork</span>
            <strong>{forkCount}</strong>
          </div>
          <div className="vault-metric-card">
            <span className="field-label">Leader</span>
            <CopyAddressButton
              address={vaultDetails.leaderAddress}
              copied={copiedAddress === vaultDetails.leaderAddress}
              onCopy={handleCopyAddress}
            />
          </div>
          <div className="vault-metric-card">
            <span className="field-label">Leader Share</span>
            <strong>{(vaultDetails.leaderFraction * 100).toFixed(1)}%</strong>
          </div>
          <div className="vault-metric-card">
            <span className="field-label">Commission</span>
            <strong>{(vaultDetails.leaderCommission * 100).toFixed(0)}%</strong>
          </div>
        </div>
      </div>
    </>
  );
}

export function VaultAnalyticsSections({
  vaultDetails,
  isVaultLoading,
  forkCount,
  maxTvl,
}: {
  vaultDetails: StrategyVaultMetadata | null;
  isVaultLoading: boolean;
  forkCount: number;
  maxTvl: number;
}) {
  if (!vaultDetails) {
    return <div className="vault-loading">{isVaultLoading ? "Vault loading" : "No vault analytics"}</div>;
  }

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
        <div className="vault-performance-metadata">
          <VaultMetadataBlocks
            forkCount={forkCount}
            vaultDetails={vaultDetails}
            isVaultLoading={isVaultLoading}
            maxTvl={maxTvl}
          />
        </div>
      </section>

      <section className="vault-section" aria-label="token balances">
        <div className="vault-balance-chart-pair">
          <div className="vault-balance-card">
            <div className="vault-balance-card-heading">
              <span>Token Balance</span>
              <strong>By Asset</strong>
            </div>
            <TokenBalanceDonut balances={vaultDetails.balances} />
          </div>
          <div className="vault-balance-card">
            <div className="vault-balance-card-heading">
              <span>Chain Balance</span>
              <strong>By Chain</strong>
            </div>
            <ChainBalanceDonut balances={vaultDetails.balances} />
          </div>
        </div>
      </section>
    </div>
  );
}

function formatActivityAmount(amountUsd?: number, assetAmount?: number, assetSymbol?: string) {
  if (!amountUsd || !assetAmount || !assetSymbol) {
    return {
      primary: "-",
      secondary: "No capital move",
    };
  }

  return {
    primary: formatCurrency(amountUsd),
    secondary: `${formatCompact(assetAmount)} ${assetSymbol}`,
  };
}

function getPageItems<T>(items: T[], page: number, pageSize: number) {
  const startIndex = (page - 1) * pageSize;
  return items.slice(startIndex, startIndex + pageSize);
}

function PaginationControls({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="activity-pagination" aria-label="activity pagination">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(Math.max(1, page - 1))}
      >
        {"<"}
      </button>
      {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => (
        <button
          type="button"
          className={pageNumber === page ? "active" : ""}
          key={pageNumber}
          onClick={() => onChange(pageNumber)}
        >
          {pageNumber}
        </button>
      ))}
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onChange(Math.min(totalPages, page + 1))}
      >
        {">"}
      </button>
    </div>
  );
}

export function VaultActivitySections({
  vaultAddress,
  onUserSelect,
}: {
  vaultAddress: string;
  onUserSelect: (address: string) => void;
}) {
  const {
    users,
    transactions,
    activityEndpoint,
    isActivityLoading,
  } = useVaultActivity(vaultAddress);
  const [usersPage, setUsersPage] = useState(1);
  const [transactionsPage, setTransactionsPage] = useState(1);
  const usersTotalPages = Math.max(1, Math.ceil(users.length / activityUsersPerPage));
  const transactionsTotalPages = Math.max(1, Math.ceil(transactions.length / activityTransactionsPerPage));
  const currentUsersPage = Math.min(usersPage, usersTotalPages);
  const currentTransactionsPage = Math.min(transactionsPage, transactionsTotalPages);
  const visibleUsers = getPageItems(users, currentUsersPage, activityUsersPerPage);
  const visibleTransactions = getPageItems(
    transactions,
    currentTransactionsPage,
    activityTransactionsPerPage,
  );

  useEffect(() => {
    setUsersPage(1);
    setTransactionsPage(1);
  }, [vaultAddress]);

  return (
    <div className="vault-activity-panels" data-activity-api-request={activityEndpoint}>
      <section className="vault-section vault-activity-section" aria-label="user distribution">
        <div className="panel-heading">
          <span>User Distribution</span>
          <strong>{isActivityLoading ? "Loading" : `${users.length} users`}</strong>
        </div>
        <div className="vault-activity-list">
          {isActivityLoading ? (
            <div className="vault-activity-empty">Loading activity</div>
          ) : users.length > 0 ? (
            <>
              {visibleUsers.map((user) => (
                <button
                  type="button"
                  className="vault-activity-user-row"
                  key={`${user.vaultAddress}-${user.userAddress}`}
                  onClick={() => onUserSelect(user.userAddress)}
                >
                  <UserAvatar name={user.userName} src={user.avatarUrl} className="activity-avatar" />
                  <span className="activity-user-copy">
                    <strong>{user.userName}</strong>
                    <small>{formatAddress(user.userAddress)}</small>
                  </span>
                  <span className="activity-amount-copy">
                    <strong>{formatCurrency(user.depositUsd)}</strong>
                    <small>{formatCompact(user.depositAssetAmount)} {user.assetSymbol}</small>
                  </span>
                  <em>{(user.sharePct * 100).toFixed(1)}%</em>
                </button>
              ))}
              <PaginationControls
                page={currentUsersPage}
                totalPages={usersTotalPages}
                onChange={setUsersPage}
              />
            </>
          ) : (
            <div className="vault-activity-empty">No active users</div>
          )}
        </div>
      </section>

      <section className="vault-section vault-activity-section" aria-label="all transactions">
        <div className="panel-heading">
          <span>All Transactions</span>
          <strong>{isActivityLoading ? "Loading" : `${transactions.length} rows`}</strong>
        </div>
        <div className="vault-activity-list">
          {isActivityLoading ? (
            <div className="vault-activity-empty">Loading transactions</div>
          ) : transactions.length > 0 ? (
            <>
              {visibleTransactions.map((transaction) => {
                const amount = formatActivityAmount(
                  transaction.amountUsd,
                  transaction.assetAmount,
                  transaction.assetSymbol,
                );

                return (
                  <article className="vault-activity-transaction-row" key={transaction.id}>
                    <span className={`activity-type ${transaction.type.toLowerCase()}`}>{transaction.type}</span>
                    <div className="activity-user-copy">
                      <button type="button" onClick={() => onUserSelect(transaction.userAddress)}>
                        <UserAvatar
                          name={transaction.userName}
                          src={transaction.avatarUrl}
                          className="activity-avatar"
                        />
                        <span>
                          <strong>{transaction.userName}</strong>
                          <small>{formatAddress(transaction.userAddress)}</small>
                        </span>
                      </button>
                    </div>
                    <span className="activity-amount-copy">
                      <strong>{amount.primary}</strong>
                      <small>{amount.secondary}</small>
                    </span>
                    <span className="activity-meta-copy">
                      <strong>{transaction.chain}</strong>
                      <small>{formatAddress(transaction.txHash)} / {formatTimestamp(transaction.createdAt)}</small>
                    </span>
                  </article>
                );
              })}
              <PaginationControls
                page={currentTransactionsPage}
                totalPages={transactionsTotalPages}
                onChange={setTransactionsPage}
              />
            </>
          ) : (
            <div className="vault-activity-empty">No transactions</div>
          )}
        </div>
      </section>
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildInitialMarginRateSeries({
  strategy,
  vaultDetails,
  valueSeries,
  interval,
}: {
  strategy: Strategy;
  vaultDetails: StrategyVaultMetadata | null;
  valueSeries: number[];
  interval: VaultChartInterval;
}) {
  const config = vaultChartIntervalConfig[interval];
  const seed = getStableSeed(`margin-${strategy.id}-${interval}`);
  const equity = vaultDetails?.strategyEquity ?? strategy.deployedCapital;
  const utilization = vaultDetails ? vaultDetails.strategyEquity / Math.max(vaultDetails.strategyEquity * 2, 1) : 0.5;
  const sectorPremium = strategy.primarySector === "CEX" ? 2.4 : strategy.primarySector === "DeFi" ? 1.2 : 1.8;
  const baseRate = clamp(7 + strategy.maxDrawdown * 1.15 + utilization * 7 + sectorPremium, 4, 42);
  const firstValue = valueSeries[0] ?? equity;

  return valueSeries.map((value, index) => {
    const previousValue = valueSeries[Math.max(index - 1, 0)] ?? value;
    const equityChangePct = firstValue > 0 ? ((value - firstValue) / firstValue) * 100 : 0;
    const localMovePct = previousValue > 0 ? ((value - previousValue) / previousValue) * 100 : 0;
    const wave =
      Math.sin(index * 0.61 + seed * 0.017) * config.noise * 0.22 +
      Math.cos(index * 0.37 + seed * 0.011) * config.noise * 0.13;

    return Number(clamp(baseRate + equityChangePct * 0.08 + localMovePct * 0.55 + wave, 1, 65).toFixed(2));
  });
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
  const marginRateSeries = useMemo(
    () => buildInitialMarginRateSeries({ strategy, vaultDetails, valueSeries, interval: activeInterval }),
    [activeInterval, strategy, valueSeries, vaultDetails],
  );
  const timeStepSeconds = vaultChartIntervalConfig[activeInterval].seconds;
  const currentValue = valueSeries[valueSeries.length - 1] ?? strategy.deployedCapital;
  const firstValue = valueSeries[0] ?? currentValue;
  const positive = currentValue >= firstValue;
  const currentMarginRate = marginRateSeries[marginRateSeries.length - 1] ?? 0;
  const firstMarginRate = marginRateSeries[0] ?? currentMarginRate;
  const marginRatePositive = currentMarginRate >= firstMarginRate;

  return (
    <div className={`vault-value-tracker${isVaultLoading ? " loading" : ""}`}>
      <div className="vault-chart-header">
        <div>
          <span>Logic Value</span>
          <strong>{formatCurrency(currentValue)}</strong>
        </div>
        <div className="vault-chart-intervals" role="group" aria-label="logic value interval">
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

      <div className="vault-value-chart logic-value-chart" aria-label={`${strategy.title} logic value graph`}>
        <div className="vault-chart-caption">
          <span>Logic Value</span>
          <strong className={positive ? "positive" : "negative"}>
            {formatPct(firstValue > 0 ? ((currentValue - firstValue) / firstValue) * 100 : 0)}
          </strong>
        </div>
        <LightweightReturnChart
          className="vault-value-lightweight-chart"
          series={valueSeries}
          mode="value"
          height={620}
          fill
          positive={positive}
          backgroundColor="var(--surface-2)"
          timeStepSeconds={timeStepSeconds}
        />
      </div>

      <div className="vault-margin-rate-chart" aria-label={`${strategy.title} initial margin rate graph`}>
        <div className="vault-chart-caption">
          <span>Initial Margin Rate</span>
          <strong className={marginRatePositive ? "positive" : "negative"}>
            {currentMarginRate.toFixed(2)}% ({formatPct(currentMarginRate - firstMarginRate)})
          </strong>
        </div>
        <LightweightReturnChart
          className="vault-margin-lightweight-chart"
          series={marginRateSeries}
          mode="percent"
          height={150}
          fill
          positive={marginRatePositive}
          lineColor={marginRatePositive ? "#d0ad4f" : "#f6465d"}
          backgroundColor="var(--surface-2)"
          timeStepSeconds={timeStepSeconds}
        />
      </div>
    </div>
  );
}

export function VaultDiscussionPanel({
  vaultAddress,
  onUserSelect,
}: {
  vaultAddress: string;
  onUserSelect: (address: string) => void;
}) {
  const { messages, discussionEndpoint, isDiscussionLoading, addLocalMessage } = useVaultDiscussion(vaultAddress);
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
