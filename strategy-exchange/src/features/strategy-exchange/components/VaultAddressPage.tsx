import { useEffect, useState } from "react";
import type { VaultBalanceRow } from "../../../../demoDB";
import { creators } from "../store/strategyCatalog";
import {
  readScwUsdcBalanceStore,
  writeScwUsdcBalanceStore,
  type ScwUsdcBalances,
} from "../store/strategyExchangeStore";
import { primaryExecutionChain } from "../executionChains";
import { disclosureLabels, productTypeLabels } from "../constants";
import type { Strategy, VaultViewMode } from "../types/strategyTypes";
import { Button, ToggleGroup } from "../../../shared/components";
import { useVaultMetadata } from "../hooks/useVaultMetadata";
import { getStrategyDescription } from "../utils/strategyMetrics";
import {
  getVaultShareMarketCap,
  getVaultShareSymbol,
} from "../utils/vaultShare";
import { HershyCanvasPreview } from "./StrategyVisuals";
import { NetPositionSummary } from "./NetPositionSummary";
import { VaultShareVisual } from "./VaultShareVisual";
import {
  VaultAnalyticsSections,
  VaultValueTracker,
} from "./VaultPanels";
import { formatCompact, formatCurrency, formatPct } from "../../../shared/utils/formatters";

function getDepositValue(depositAmount: string) {
  const depositValue = Number(depositAmount);
  return Number.isFinite(depositValue) && depositValue > 0 ? depositValue : 0;
}

function getInvestableAssetCount(balances: VaultBalanceRow[]) {
  return new Set(
    balances
      .filter((balance) => balance.token !== "Buffer" && balance.venue !== "Reserve")
      .map((balance) => balance.token),
  ).size;
}

const depositAmountIncrements = [1, 10, 50, 100, 500];

function formatSharePrice(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function UseAllocationPanel({
  balances,
  isLoading,
  depositAmount,
  onDepositAmountChange,
  scwBalance,
}: {
  balances: VaultBalanceRow[];
  isLoading: boolean;
  depositAmount: string;
  onDepositAmountChange: (value: string) => void;
  scwBalance: number;
}) {
  const depositValue = getDepositValue(depositAmount);
  const hasValidAmount = depositValue > 0;
  const requiredUsdc = depositValue;
  const shortage = Math.max(requiredUsdc - scwBalance, 0);
  const isInsufficient = hasValidAmount && shortage > 0;
  const assetCount = getInvestableAssetCount(balances);
  const handleIncrementAmount = (increment: number) => {
    onDepositAmountChange(String(depositValue + increment));
  };

  return (
    <div id="vault-use-allocation" className="use-allocation-panel">
      <div className="use-allocation-inner">
        <div className="use-allocation-input-row">
          <label>
            <span>Amount</span>
            <input
              id="vault-use-allocation-amount"
              type="text"
              inputMode="decimal"
              value={depositAmount}
              onChange={(event) => onDepositAmountChange(event.target.value)}
            />
            <div className="use-allocation-increments" aria-label="amount quick increments">
              {depositAmountIncrements.map((increment) => (
                <button
                  type="button"
                  key={increment}
                  onClick={() => handleIncrementAmount(increment)}
                  aria-label={`Add ${increment} USDC`}
                >
                  +{increment}
                </button>
              ))}
            </div>
          </label>
          <div>
            <span>Route</span>
            <strong>
              {primaryExecutionChain} / {assetCount} assets
            </strong>
          </div>
        </div>

        <div className="use-allocation-table">
          <div className="use-allocation-head">
            <span>Execution</span>
            <span>Required</span>
            <span>SCW USDC</span>
          </div>
          {isLoading ? (
            <div className="use-allocation-empty">Loading allocation</div>
          ) : (
            <div className={`use-allocation-row${isInsufficient ? " insufficient" : ""}`}>
              <span className="allocation-chain">
                {primaryExecutionChain}
                {isInsufficient ? <small>{formatCurrency(shortage)} short</small> : null}
              </span>
              <em>{hasValidAmount ? formatCurrency(requiredUsdc) : "-"}</em>
              <span>
                {formatCurrency(scwBalance)}
                <small>{hasValidAmount ? `Available on ${primaryExecutionChain}` : "Set amount"}</small>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function VaultAddressPage({
  address,
  strategy,
  used,
  netPosition,
  onCreatorSelect,
  onUse,
  onDrop,
}: {
  address: string;
  strategy: Strategy;
  used: boolean;
  netPosition: number;
  onCreatorSelect: () => void;
  onUse: (amount: number) => void;
  onDrop: () => void;
}) {
  const creator = creators[strategy.creatorId];
  const shareSymbol = getVaultShareSymbol(strategy);
  const shareMarketCap = getVaultShareMarketCap(strategy);
  const { vaultDetails, vaultEndpoint, isVaultLoading } = useVaultMetadata(address);
  const isFullDisclosure = strategy.disclosure === "Full";
  const [vaultViewMode, setVaultViewMode] = useState<VaultViewMode>("value");
  const [depositAmount, setDepositAmount] = useState("10000");
  const [scwBalances, setScwBalances] = useState<ScwUsdcBalances>(() => readScwUsdcBalanceStore());
  const depositValue = getDepositValue(depositAmount);
  const hasValidDepositAmount = depositValue > 0;
  const netPositionPnl = netPosition * (strategy.pnlPct / 100);
  const allocationBalances = vaultDetails?.balances ?? [];
  const primaryChainScwBalance = scwBalances[primaryExecutionChain] ?? 0;
  const hasEnoughPrimaryChainUsdc = depositValue <= primaryChainScwBalance;
  const currentSharePrice = 100 * (1 + strategy.pnlPct / 100);
  const kpiRows = [
    {
      label: "NAV / Share Price",
      value: formatSharePrice(currentSharePrice),
    },
    {
      label: "AUM",
      value: formatCurrency(vaultDetails?.strategyEquity ?? shareMarketCap),
    },
    {
      label: "30D Return",
      value: formatPct(strategy.pnlPct),
      tone: strategy.pnlPct >= 0 ? "positive" : "negative",
    },
    {
      label: "APR",
      value: vaultDetails ? formatPct(vaultDetails.projectedApr) : "-",
      tone: (vaultDetails?.projectedApr ?? 0) >= 0 ? "positive" : "negative",
    },
    {
      label: "Daily Volume",
      value: `$${formatCompact(strategy.dailyVolume)}`,
    },
    {
      label: "Strategy Fee",
      value: vaultDetails ? `${(vaultDetails.leaderCommission * 100).toFixed(0)}%` : "-",
    },
    {
      label: "Max Drawdown",
      value: `${strategy.maxDrawdown.toFixed(1)}%`,
      tone: "negative",
    },
  ];

  useEffect(() => {
    setVaultViewMode("value");
  }, [address]);

  useEffect(() => {
    if (!isFullDisclosure) {
      setVaultViewMode("value");
    }
  }, [isFullDisclosure]);

  useEffect(() => {
    writeScwUsdcBalanceStore(scwBalances);
  }, [scwBalances]);

  const handleUseClick = () => {
    const amount = hasValidDepositAmount ? depositValue : 0;
    if (amount <= 0) {
      document.getElementById("vault-use-allocation-amount")?.focus();
      return;
    }
    if (!hasEnoughPrimaryChainUsdc) {
      document.getElementById("vault-use-allocation-amount")?.focus();
      return;
    }

    setScwBalances((current) => {
      const next = { ...current };
      next[primaryExecutionChain] = Math.max((next[primaryExecutionChain] ?? 0) - amount, 0);
      return next;
    });
    onUse(amount);
  };

  const handleDropClick = () => {
    onDrop();
  };

  const defaultMaxTvl = vaultDetails ? Math.round(vaultDetails.strategyEquity * 2) : strategy.deployedCapital * 2;

  return (
    <main className="vault-page-layout" data-vault-api-request={vaultEndpoint}>
      <section className={`vault-product-header${isVaultLoading ? " loading" : ""}`}>
        <VaultShareVisual strategy={strategy} className="vault-detail-share-visual" artworkOnly />
        <div className="vault-product-copy">
          <div className="modal-meta-row vault-tag-line">
            <span>{productTypeLabels[strategy.productType]}</span>
            <span>{disclosureLabels[strategy.disclosure]}</span>
          </div>
          <h1>{strategy.title}</h1>
          <button type="button" className="modal-creator-link" onClick={onCreatorSelect}>
            <strong>{creator.name}</strong>
            <span>{creator.handle}</span>
          </button>
          <p>{getStrategyDescription(strategy)}</p>
          <div className="vault-product-universe">
            <div>
              <span>Market</span>
              <strong>{strategy.markets.join(", ")}</strong>
            </div>
            <div>
              <span>Asset Class</span>
              <strong>{strategy.assetClasses.join(", ")}</strong>
            </div>
          </div>
        </div>
        <div className="vault-product-symbol">
          <span>Adapter Share</span>
          <strong>${shareSymbol}</strong>
          <small>AUM ${formatCompact(vaultDetails?.strategyEquity ?? shareMarketCap)}</small>
        </div>
      </section>

      <section className="vault-kpi-strip" aria-label="adapter key metrics">
        {kpiRows.map((row) => (
          <div className="vault-kpi-card" key={row.label}>
            <span>{row.label}</span>
            <strong className={row.tone}>{row.value}</strong>
          </div>
        ))}
      </section>

      <section className="vault-page-hero">
        <div className="vault-page-canvas">
          <div className="canvas-toolbar">
            <span>{isFullDisclosure && vaultViewMode === "canvas" ? "Hershy Canvas" : "NAV / Share Price"}</span>
            {isFullDisclosure ? (
              <div className="canvas-toolbar-actions">
                <ToggleGroup
                  label="Adapter detail view"
                  value={vaultViewMode}
                  onChange={setVaultViewMode}
                  options={[
                    { label: "NAV", value: "value" },
                    { label: "Canvas", value: "canvas" },
                  ]}
                />
              </div>
            ) : null}
          </div>
          <div className="vault-view-frame">
            {!isFullDisclosure || vaultViewMode === "value" ? (
              <VaultValueTracker
                strategy={strategy}
                vaultDetails={vaultDetails}
                isVaultLoading={isVaultLoading}
              />
            ) : (
              <HershyCanvasPreview strategy={strategy} />
            )}
          </div>
          <NetPositionSummary
            netPosition={netPosition}
            pnl={netPositionPnl}
          />
        </div>

        <aside className={`vault-trade-ticket${isVaultLoading ? " loading" : ""}`}>
          <div className="panel-heading">
            <span>Use</span>
            <strong>{primaryExecutionChain}</strong>
          </div>
          <UseAllocationPanel
            balances={allocationBalances}
            isLoading={isVaultLoading}
            depositAmount={depositAmount}
            onDepositAmountChange={setDepositAmount}
            scwBalance={primaryChainScwBalance}
          />

          <div className="modal-actions vault-trade-actions">
            <Button
              variant="use"
              aria-controls="vault-use-allocation"
              onClick={handleUseClick}
            >
              {used ? "Using" : "Use"}
            </Button>
            {used ? (
              <Button variant="drop" onClick={handleDropClick}>
                Drop
              </Button>
            ) : null}
          </div>
        </aside>
      </section>

      <VaultAnalyticsSections
        strategy={strategy}
        vaultDetails={vaultDetails}
        isVaultLoading={isVaultLoading}
        maxTvl={defaultMaxTvl}
        positionValue={netPosition}
      />
    </main>
  );
}
