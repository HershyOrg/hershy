import { FormEvent, useMemo, useState } from "react";
import type {
  StrategyRun,
  TokenAsset,
  TokenTracker,
  WalletSession,
  WalletTransaction,
} from "@/features/ai-wallet/types/walletTypes";
import { formatDateTime, formatUsd } from "@/features/ai-wallet/utils/formatters";
import {
  Activity,
  CheckCircle2,
  History,
  Pause,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Wallet,
} from "@/shared/components/icons";
import { cn } from "@/shared/utils/utils";

type WalletStatusPanelProps = {
  session: WalletSession;
  assets: TokenAsset[];
  trackers: TokenTracker[];
  transactions: WalletTransaction[];
  runs: StrategyRun[];
  lastRefreshLabel: string;
  isRefreshing: boolean;
  onRefresh: () => void;
  onAddTracker: (symbol: string, contractAddress: string) => void;
  onStopRun: (runId: string) => void;
};

function assetUsdValue(asset: TokenAsset) {
  return asset.balance * asset.fiatPrice;
}

function getTxIcon(kind: WalletTransaction["kind"]) {
  if (kind === "deposit") return Wallet;
  if (kind === "swap") return RefreshCw;
  if (kind === "release") return CheckCircle2;
  return Activity;
}

export function WalletStatusPanel({
  session,
  assets,
  trackers,
  transactions,
  runs,
  lastRefreshLabel,
  isRefreshing,
  onRefresh,
  onAddTracker,
  onStopRun,
}: WalletStatusPanelProps) {
  const [symbol, setSymbol] = useState("");
  const [budgetNote, setBudgetNote] = useState("");

  const availableUsd = useMemo(() => {
    return assets.reduce((sum, asset) => sum + Math.max(asset.balance - asset.lockedBalance, 0) * asset.fiatPrice, 0);
  }, [assets]);

  const lockedUsd = useMemo(() => {
    return assets.reduce((sum, asset) => sum + asset.lockedBalance * asset.fiatPrice, 0);
  }, [assets]);

  function submitTracker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!symbol.trim() && !budgetNote.trim()) return;
    onAddTracker(symbol, budgetNote);
    setSymbol("");
    setBudgetNote("");
  }

  return (
    <aside className="wallet-status" aria-label="Budget status">
      <section className="panel session-panel">
        <div className="panel__header">
          <div>
            <p className="panel__eyebrow">Session</p>
            <h2>{session.label}</h2>
          </div>
          <Wallet size={18} className="muted-icon" />
        </div>

        <div className="money-flow">
          <div>
            <span>Payment</span>
            <strong>Primary method</strong>
          </div>
          <div className="money-flow__arrow">→</div>
          <div>
            <span>Session</span>
            <strong>Budget ready</strong>
          </div>
        </div>

        <div className="session-metrics">
          <div>
            <span>Added</span>
            <strong>{formatUsd(session.fundingAmount)}</strong>
          </div>
          <div>
            <span>Available</span>
            <strong>{formatUsd(availableUsd)}</strong>
          </div>
          <div>
            <span>Reserved</span>
            <strong>{formatUsd(lockedUsd)}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{session.status}</strong>
          </div>
        </div>
      </section>

      <section className="panel assets-panel">
        <div className="panel__header">
          <div>
            <p className="panel__eyebrow">Budget</p>
            <h2>Categories</h2>
          </div>
          <button type="button" className={cn("refresh-button", isRefreshing && "refresh-button--active")} onClick={onRefresh}>
            <RefreshCw size={16} />
            <span>{lastRefreshLabel}</span>
          </button>
        </div>

        <div className="asset-list">
          {assets.map((asset) => {
            const available = Math.max(asset.balance - asset.lockedBalance, 0);

            return (
              <article className="asset-row" key={asset.id}>
                <div className="asset-row__token">
                  <span className="token-mark" style={{ backgroundColor: asset.color }}>
                    {asset.symbol.slice(0, 1)}
                  </span>
                  <div>
                    <strong>{asset.symbol}</strong>
                    <span>{asset.name}</span>
                  </div>
                </div>
                <div className="asset-row__amount">
                  <strong>{formatUsd(assetUsdValue(asset))}</strong>
                  <span>{formatUsd(available)} available</span>
                </div>
                {asset.lockedBalance > 0 ? (
                  <div className="asset-row__lock">
                    <CheckCircle2 size={13} />
                    <span>{formatUsd(asset.lockedBalance)} reserved</span>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel tracker-panel">
        <div className="panel__header">
          <div>
            <p className="panel__eyebrow">Custom</p>
            <h2>Budget tags</h2>
          </div>
          <Search size={18} className="muted-icon" />
        </div>

        <form className="tracker-form" onSubmit={submitTracker}>
          <input value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder="Category" />
          <input value={budgetNote} onChange={(event) => setBudgetNote(event.target.value)} placeholder="Optional note" />
          <button type="submit" title="추가">
            <Plus size={17} />
          </button>
        </form>

        <div className="tracker-list">
          {trackers.map((tracker) => (
            <div className="tracker-row" key={tracker.id}>
              <span>{tracker.symbol}</span>
              <strong>{tracker.source}</strong>
              <em>{tracker.source}</em>
            </div>
          ))}
        </div>
      </section>

      <section className="panel runs-panel">
        <div className="panel__header">
          <div>
            <p className="panel__eyebrow">Plans</p>
            <h2>Active</h2>
          </div>
          <Activity size={18} className="muted-icon" />
        </div>

        <div className="run-list">
          {runs.map((run) => (
            <article className="run-row" key={run.id}>
              <div className="run-row__top">
                <div>
                  <strong>{run.title}</strong>
                  <span>{run.mode}</span>
                </div>
                <div className={cn("run-status", `run-status--${run.status}`)}>{run.status}</div>
              </div>
              <div className="progress-track">
                <span style={{ width: `${run.progress}%` }} />
              </div>
              <div className="run-row__bottom">
                <span>{run.nextStep}</span>
                {run.status === "running" ? (
                  <button type="button" onClick={() => onStopRun(run.id)} title="중지">
                    <Pause size={15} />
                  </button>
                ) : (
                  <button type="button" title="삭제">
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel tx-panel">
        <div className="panel__header">
          <div>
            <p className="panel__eyebrow">Activity</p>
            <h2>Purchase history</h2>
          </div>
          <History size={18} className="muted-icon" />
        </div>

        <div className="tx-list">
          {transactions.map((activity) => {
            const Icon = getTxIcon(activity.kind);

            return (
              <article className="tx-row" key={activity.id}>
                <span className="tx-row__icon">
                  <Icon size={17} />
                </span>
                <div>
                  <div className="tx-row__title">
                    <strong>{activity.title}</strong>
                    <span>{activity.amountLabel}</span>
                  </div>
                  <p>{activity.summary}</p>
                  <div className="tx-row__meta">
                    <span>{formatDateTime(activity.timestamp)}</span>
                    <span>{activity.status}</span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </aside>
  );
}
