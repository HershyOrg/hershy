import { useEffect, useState } from "react";
import type { VaultBalanceRow } from "../../../../demoDB";
import { creators } from "../store/strategyCatalog";
import {
  readScwUsdcBalanceStore,
  writeScwUsdcBalanceStore,
  type ScwUsdcBalances,
} from "../store/strategyExchangeStore";
import { connectedVenueSet, sectorLabels } from "../constants";
import type { Strategy, VaultViewMode } from "../types/strategyTypes";
import { Button, ToggleGroup } from "../../../shared/components";
import { useVaultMetadata } from "../hooks/useVaultMetadata";
import { getStrategyDescription } from "../utils/strategyMetrics";
import {
  getVaultShareMarketCap,
  getVaultShareSymbol,
} from "../utils/vaultShare";
import { ForkBadge } from "./ForkBadge";
import { HershyCanvasPreview } from "./StrategyVisuals";
import { NetPositionSummary } from "./NetPositionSummary";
import { VaultShareVisual } from "./VaultShareVisual";
import {
  VaultActivitySections,
  VaultAnalyticsSections,
  VaultDiscussionPanel,
  VaultValueTracker,
} from "./VaultPanels";
import { formatCompact, formatCurrency } from "../../../shared/utils/formatters";

type ChainRequirementMap = Record<string, number>;
type ChainShortage = {
  chain: string;
  required: number;
  available: number;
  shortage: number;
};

function getDepositValue(depositAmount: string) {
  const depositValue = Number(depositAmount);
  return Number.isFinite(depositValue) && depositValue > 0 ? depositValue : 0;
}

function getChainRequirements(balances: VaultBalanceRow[], depositValue: number): ChainRequirementMap {
  const totalWeight = balances.reduce((sum, balance) => sum + Math.max(balance.weight, 0), 0) || 1;

  return balances.reduce<ChainRequirementMap>((requirements, balance) => {
    const allocationValue = depositValue * (Math.max(balance.weight, 0) / totalWeight);
    requirements[balance.chain] = (requirements[balance.chain] ?? 0) + allocationValue;
    return requirements;
  }, {});
}

function getChainShortages(requirements: ChainRequirementMap, scwBalances: ScwUsdcBalances): ChainShortage[] {
  return Object.entries(requirements)
    .map(([chain, required]) => ({
      chain,
      required,
      available: scwBalances[chain] ?? 0,
      shortage: Math.max(required - (scwBalances[chain] ?? 0), 0),
    }))
    .filter((row) => row.shortage > 0);
}

function getBridgeSourceChain(scwBalances: ScwUsdcBalances, targetChain: string) {
  const candidates = Object.entries(scwBalances)
    .filter(([chain, value]) => chain !== targetChain && value > 0)
    .sort(([, firstValue], [, secondValue]) => secondValue - firstValue);
  return candidates[0]?.[0] ?? "";
}

function getAutoBridgePlan(
  shortages: ChainShortage[],
  scwBalances: ScwUsdcBalances,
  currentTargetChain: string,
) {
  const targetShortage =
    shortages.find((row) => row.chain === currentTargetChain) ??
    [...shortages].sort((first, second) => second.shortage - first.shortage)[0];
  if (!targetShortage) return null;

  const sourceEntries = Object.entries(scwBalances)
    .filter(([chain, value]) => chain !== targetShortage.chain && value > 0)
    .sort(([, firstValue], [, secondValue]) => secondValue - firstValue);
  const sourceEntry = sourceEntries.find(([, value]) => value >= targetShortage.shortage) ?? sourceEntries[0];
  if (!sourceEntry) return null;

  const [sourceChain, sourceBalance] = sourceEntry;
  return {
    sourceChain,
    targetChain: targetShortage.chain,
    amount: Math.ceil(Math.min(targetShortage.shortage, sourceBalance)),
  };
}

function UseAllocationPanel({
  balances,
  isLoading,
  depositAmount,
  onDepositAmountChange,
  scwBalances,
  chainRequirements,
  onBridgeRequest,
}: {
  balances: VaultBalanceRow[];
  isLoading: boolean;
  depositAmount: string;
  onDepositAmountChange: (value: string) => void;
  scwBalances: ScwUsdcBalances;
  chainRequirements: ChainRequirementMap;
  onBridgeRequest: (targetChain: string) => void;
}) {
  const depositValue = getDepositValue(depositAmount);
  const hasValidAmount = depositValue > 0;
  const totalWeight = balances.reduce((sum, balance) => sum + Math.max(balance.weight, 0), 0) || 1;

  return (
    <div id="vault-use-allocation" className="use-allocation-panel">
      <div className="use-allocation-inner">
        <div className="use-allocation-input-row">
          <label>
            <span>Amount</span>
            <input
              id="vault-use-allocation-amount"
              type="number"
              min="0"
              inputMode="decimal"
              value={depositAmount}
              onChange={(event) => onDepositAmountChange(event.target.value)}
            />
          </label>
          <div>
            <span>Split</span>
            <strong>{balances.length} legs</strong>
          </div>
        </div>

        <div className="use-allocation-table">
          <div className="use-allocation-head">
            <span>Chain</span>
            <span>Ratio</span>
            <span>USDC</span>
          </div>
          {isLoading ? (
            <div className="use-allocation-empty">Loading allocation</div>
          ) : balances.length > 0 ? (
            balances.map((balance) => {
              const ratio = Math.max(balance.weight, 0) / totalWeight;
              const allocationValue = hasValidAmount ? depositValue * ratio : 0;
              const chainRequired = chainRequirements[balance.chain] ?? 0;
              const chainAvailable = scwBalances[balance.chain] ?? 0;
              const shortage = Math.max(chainRequired - chainAvailable, 0);
              const isInsufficient = shortage > 0;

              return (
                <div
                  className={`use-allocation-row${isInsufficient ? " insufficient" : ""}`}
                  key={`${balance.chain}-${balance.token}-${balance.venue}`}
                >
                  <span className="allocation-chain">
                    {balance.chain}
                    {isInsufficient ? <small>{formatCurrency(shortage)}</small> : null}
                  </span>
                  <em>{(ratio * 100).toFixed(1)}%</em>
                  <span>
                    {hasValidAmount
                      ? `${formatCurrency(allocationValue)} / ${formatCurrency(chainAvailable)}`
                      : "-"}
                    <small>{hasValidAmount ? "Required / SCW USDC" : "Set amount"}</small>
                    {isInsufficient ? (
                      <button
                        type="button"
                        className="allocation-bridge-button"
                        onClick={() => onBridgeRequest(balance.chain)}
                      >
                        Bridge {formatCurrency(shortage)}
                      </button>
                    ) : null}
                  </span>
                </div>
              );
            })
          ) : (
            <div className="use-allocation-empty">No allocation</div>
          )}
        </div>
      </div>
    </div>
  );
}

function BridgeFundingModal({
  open,
  scwBalances,
  shortages,
  sourceChain,
  targetChain,
  amount,
  onSourceChainChange,
  onTargetChainChange,
  onAmountChange,
  onAutoSort,
  onClose,
  onConfirm,
}: {
  open: boolean;
  scwBalances: ScwUsdcBalances;
  shortages: ChainShortage[];
  sourceChain: string;
  targetChain: string;
  amount: string;
  onSourceChainChange: (chain: string) => void;
  onTargetChainChange: (chain: string) => void;
  onAmountChange: (amount: string) => void;
  onAutoSort: () => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;

  const chains = Object.keys(scwBalances);
  const bridgeAmount = getDepositValue(amount);
  const sourceBalance = scwBalances[sourceChain] ?? 0;
  const canBridge = sourceChain !== targetChain && bridgeAmount > 0 && sourceBalance >= bridgeAmount;
  const canAutoSort = getAutoBridgePlan(shortages, scwBalances, targetChain) !== null;

  return (
    <div className="bridge-modal-overlay" role="dialog" aria-modal="true" aria-label="bridge USDC">
      <section className="bridge-modal">
        <div className="bridge-modal-heading">
          <div>
            <span>SCW Bridge</span>
            <strong>Move USDC</strong>
          </div>
          <div className="bridge-heading-actions">
            <button
              type="button"
              className="bridge-auto-sort-button"
              disabled={!canAutoSort}
              onClick={onAutoSort}
            >
              Auto Portfolio Sort
            </button>
            <button type="button" className="bridge-close-button" onClick={onClose}>X</button>
          </div>
        </div>

        <p>타 체인 SCW에서 부족한 체인 SCW로 USDC를 옮길까요?</p>

        <div className="bridge-wallet-grid">
          {chains.map((chain) => (
            <button
              type="button"
              className={[
                "bridge-wallet-card",
                chain === sourceChain ? "source" : "",
                chain === targetChain ? "target" : "",
              ].filter(Boolean).join(" ")}
              key={chain}
              onClick={() => onSourceChainChange(chain)}
            >
              <span>{chain}</span>
              <strong>{formatCurrency(scwBalances[chain] ?? 0)}</strong>
              <small>{chain === sourceChain ? "Source" : chain === targetChain ? "Target" : "SCW"}</small>
            </button>
          ))}
        </div>

        <div className="bridge-controls">
          <label>
            <span>From</span>
            <select value={sourceChain} onChange={(event) => onSourceChainChange(event.target.value)}>
              {chains.map((chain) => (
                <option value={chain} key={chain}>{chain}</option>
              ))}
            </select>
          </label>
          <label>
            <span>To</span>
            <select value={targetChain} onChange={(event) => onTargetChainChange(event.target.value)}>
              {chains.map((chain) => (
                <option value={chain} key={chain}>{chain}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Amount</span>
            <input
              type="number"
              min="0"
              inputMode="decimal"
              value={amount}
              onChange={(event) => onAmountChange(event.target.value)}
            />
          </label>
        </div>

        <div className="bridge-route-visual">
          <div>
            <span>{sourceChain || "Source"}</span>
            <strong>{formatCurrency(sourceBalance)}</strong>
          </div>
          <b>→ {formatCurrency(bridgeAmount)} USDC →</b>
          <div>
            <span>{targetChain || "Target"}</span>
            <strong>{formatCurrency(scwBalances[targetChain] ?? 0)}</strong>
          </div>
        </div>

        <div className="bridge-modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" disabled={!canBridge} onClick={onConfirm}>Move USDC</button>
        </div>
      </section>
    </div>
  );
}

export function VaultAddressPage({
  address,
  strategy,
  forkCount,
  used,
  netPosition,
  onCreatorSelect,
  onUse,
  onDrop,
  onFork,
  onUserSelect,
}: {
  address: string;
  strategy: Strategy;
  forkCount: number;
  used: boolean;
  netPosition: number;
  onCreatorSelect: () => void;
  onUse: (amount: number) => void;
  onDrop: () => void;
  onFork: (strategy: Strategy) => void;
  onUserSelect: (address: string) => void;
}) {
  const creator = creators[strategy.creatorId];
  const shareSymbol = getVaultShareSymbol(strategy);
  const shareMarketCap = getVaultShareMarketCap(strategy);
  const { vaultDetails, vaultEndpoint, isVaultLoading } = useVaultMetadata(address);
  const [vaultViewMode, setVaultViewMode] = useState<VaultViewMode>("value");
  const [depositAmount, setDepositAmount] = useState("10000");
  const [scwBalances, setScwBalances] = useState<ScwUsdcBalances>(() => readScwUsdcBalanceStore());
  const [isBridgeModalOpen, setIsBridgeModalOpen] = useState(false);
  const [bridgeSourceChain, setBridgeSourceChain] = useState("");
  const [bridgeTargetChain, setBridgeTargetChain] = useState("");
  const [bridgeAmount, setBridgeAmount] = useState("");
  const depositValue = getDepositValue(depositAmount);
  const hasValidDepositAmount = depositValue > 0;
  const netPositionPnl = netPosition * (strategy.pnlPct / 100);
  const allocationBalances = vaultDetails?.balances ?? [];
  const chainRequirements = getChainRequirements(allocationBalances, depositValue);
  const chainShortages = getChainShortages(chainRequirements, scwBalances);

  useEffect(() => {
    setVaultViewMode("value");
  }, [address]);

  useEffect(() => {
    writeScwUsdcBalanceStore(scwBalances);
  }, [scwBalances]);

  const handleFork = () => {
    onFork(strategy);
  };

  const openBridgeModal = (targetChain?: string) => {
    const shortage = targetChain
      ? chainShortages.find((row) => row.chain === targetChain)
      : chainShortages[0];
    const resolvedTarget = targetChain ?? shortage?.chain ?? allocationBalances[0]?.chain ?? "Ethereum";
    const resolvedSource = getBridgeSourceChain(scwBalances, resolvedTarget);

    setBridgeTargetChain(resolvedTarget);
    setBridgeSourceChain(resolvedSource);
    setBridgeAmount(String(Math.ceil(shortage?.shortage ?? 0)));
    setIsBridgeModalOpen(true);
  };

  const handleBridgeTargetChange = (targetChain: string) => {
    const shortage = chainShortages.find((row) => row.chain === targetChain);
    setBridgeTargetChain(targetChain);
    if (bridgeSourceChain === targetChain) {
      setBridgeSourceChain(getBridgeSourceChain(scwBalances, targetChain));
    }
    if (shortage) {
      setBridgeAmount(String(Math.ceil(shortage.shortage)));
    }
  };

  const handleAutoBridgeSort = () => {
    const plan = getAutoBridgePlan(chainShortages, scwBalances, bridgeTargetChain);
    if (!plan) return;

    setBridgeTargetChain(plan.targetChain);
    setBridgeSourceChain(plan.sourceChain);
    setBridgeAmount(String(plan.amount));
  };

  const handleBridgeConfirm = () => {
    const amount = getDepositValue(bridgeAmount);
    if (!bridgeSourceChain || !bridgeTargetChain || bridgeSourceChain === bridgeTargetChain || amount <= 0) return;
    if ((scwBalances[bridgeSourceChain] ?? 0) < amount) return;

    setScwBalances((current) => ({
      ...current,
      [bridgeSourceChain]: (current[bridgeSourceChain] ?? 0) - amount,
      [bridgeTargetChain]: (current[bridgeTargetChain] ?? 0) + amount,
    }));
    setIsBridgeModalOpen(false);
  };

  const handleUseClick = () => {
    const amount = hasValidDepositAmount ? depositValue : 0;
    if (amount <= 0) {
      document.getElementById("vault-use-allocation-amount")?.focus();
      return;
    }
    if (chainShortages.length > 0) {
      openBridgeModal(chainShortages[0].chain);
      return;
    }

    setScwBalances((current) => {
      const next = { ...current };
      Object.entries(chainRequirements).forEach(([chain, required]) => {
        next[chain] = Math.max((next[chain] ?? 0) - required, 0);
      });
      return next;
    });
    onUse(amount);
  };

  const handleDropClick = () => {
    onDrop();
  };

  const defaultMaxTvl = vaultDetails ? Math.round(vaultDetails.strategyEquity * 2) : strategy.deployedCapital * 2;

  return (
    <main className="vault-page-layout">
      <section className="vault-page-hero">
        <div className="vault-page-canvas">
          <div className="canvas-toolbar">
            <span>{vaultViewMode === "value" ? "Logic Value" : "Hershy Canvas"}</span>
            <div className="canvas-toolbar-actions">
              <ForkBadge count={forkCount} />
              <ToggleGroup
                label="Vault detail view"
                value={vaultViewMode}
                onChange={setVaultViewMode}
                options={[
                  { label: "Logic", value: "value" },
                  { label: "Canvas", value: "canvas" },
                ]}
              />
            </div>
          </div>
          <div className="vault-view-frame">
            {vaultViewMode === "value" ? (
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

        <aside
          className={`vault-page-side${isVaultLoading ? " loading" : ""}`}
          data-vault-api-request={vaultEndpoint}
        >
          <div className="vault-share-summary">
            <VaultShareVisual strategy={strategy} className="vault-detail-share-visual" artworkOnly />
            <div>
              <span className="field-label">Vault Share</span>
              <strong>${shareSymbol}</strong>
              <small>MC ${formatCompact(shareMarketCap)}</small>
            </div>
          </div>

          <div className="modal-meta-row vault-tag-line">
            <span>{sectorLabels[strategy.primarySector]}</span>
            <span>{strategy.status}</span>
            <span>{strategy.createdAt}</span>
            {strategy.venues.map((venue) => (
              <span key={venue} className={connectedVenueSet.has(venue) ? "" : "unconnected"}>
                {venue}
              </span>
            ))}
            {strategy.chains.map((chain) => (
              <span key={chain}>{chain}</span>
            ))}
          </div>
          <h1>{strategy.title}</h1>
          <button type="button" className="modal-creator-link" onClick={onCreatorSelect}>
            <strong>{creator.name}</strong>
            <span>{creator.handle}</span>
          </button>
          <p>{getStrategyDescription(strategy)}</p>

          <UseAllocationPanel
            balances={allocationBalances}
            isLoading={isVaultLoading}
            depositAmount={depositAmount}
            onDepositAmountChange={setDepositAmount}
            scwBalances={scwBalances}
            chainRequirements={chainRequirements}
            onBridgeRequest={openBridgeModal}
          />

          <div className="modal-actions">
            <Button
              variant="use"
              aria-controls="vault-use-allocation"
              onClick={handleUseClick}
            >
              {used ? "Using" : "Use"}
            </Button>
            <Button variant="drop" onClick={handleDropClick}>
              Drop
            </Button>
            <Button variant="fork" onClick={handleFork}>
              Fork
            </Button>
          </div>
        </aside>
      </section>

      <VaultAnalyticsSections
        vaultDetails={vaultDetails}
        isVaultLoading={isVaultLoading}
        forkCount={forkCount}
        maxTvl={defaultMaxTvl}
      />

      <VaultActivitySections vaultAddress={address} onUserSelect={onUserSelect} />

      <VaultDiscussionPanel vaultAddress={address} onUserSelect={onUserSelect} />
      <BridgeFundingModal
        open={isBridgeModalOpen}
        scwBalances={scwBalances}
        shortages={chainShortages}
        sourceChain={bridgeSourceChain}
        targetChain={bridgeTargetChain}
        amount={bridgeAmount}
        onSourceChainChange={setBridgeSourceChain}
        onTargetChainChange={handleBridgeTargetChange}
        onAmountChange={setBridgeAmount}
        onAutoSort={handleAutoBridgeSort}
        onClose={() => setIsBridgeModalOpen(false)}
        onConfirm={handleBridgeConfirm}
      />
    </main>
  );
}
