import { useEffect, useMemo, useState } from "react";
import type { UserAccountRow } from "../../demoDB";
import { creators, strategies } from "../features/strategy-exchange/store/strategyCatalog";
import type { Strategy, UserStrategyLogic } from "../features/strategy-exchange/types/strategyTypes";
import { getLargestSwing } from "../features/strategy-exchange/utils/strategyMetrics";
import { readUserStrategyLogics } from "../features/strategy-exchange/store/strategyLogicStore";
import { buildUserProfile } from "../features/strategy-exchange/store/userProfileStore";
import { CreatorStrategyCard } from "../features/strategy-exchange/components/StrategyCards";
import {
  formatAddress,
  formatCurrency,
  formatSignedCurrency,
  formatTimestamp,
  getDeBankProfileUrl,
} from "../shared/utils/formatters";
import { Button, ToggleGroup, UserAvatar } from "../shared/components";

type MyVaultView = "created" | "invested" | "bookmarked";

const myVaultViewCopy: Record<MyVaultView, { title: string; empty: string }> = {
  created: {
    title: "Created Vaults",
    empty: "No created vaults yet",
  },
  invested: {
    title: "Invested Vaults",
    empty: "No invested vaults yet",
  },
  bookmarked: {
    title: "Bookmarked Vaults",
    empty: "No bookmarked vaults yet",
  },
};

export function MyPage({
  account,
  usedStrategyIds,
  bookmarkedStrategyIds,
  onBack,
  onLaunchLogic,
  onEditProfile,
  onStrategySelect,
}: {
  account: UserAccountRow;
  usedStrategyIds: Set<string>;
  bookmarkedStrategyIds: Set<string>;
  onBack: () => void;
  onLaunchLogic: () => void;
  onEditProfile: () => void;
  onStrategySelect: (strategyId: string) => void;
}) {
  const creator = creators[account.creatorId];
  const profile = buildUserProfile(creator, account);
  const [myLogics, setMyLogics] = useState<UserStrategyLogic[]>([]);
  const [activeVaultView, setActiveVaultView] = useState<MyVaultView>("created");

  useEffect(() => {
    setMyLogics(readUserStrategyLogics());
  }, []);

  const createdStrategies = useMemo(
    () => strategies.filter((strategy) => strategy.creatorId === account.creatorId),
    [account.creatorId],
  );
  const usedStrategies = useMemo(
    () => strategies.filter((strategy) => usedStrategyIds.has(strategy.id)),
    [usedStrategyIds],
  );
  const bookmarkedStrategies = useMemo(
    () => strategies.filter((strategy) => bookmarkedStrategyIds.has(strategy.id)),
    [bookmarkedStrategyIds],
  );
  const visibleVaults = useMemo(() => {
    if (activeVaultView === "created") return createdStrategies;
    if (activeVaultView === "invested") return usedStrategies;
    return bookmarkedStrategies;
  }, [activeVaultView, bookmarkedStrategies, createdStrategies, usedStrategies]);
  const vaultViewOptions = useMemo(
    () => [
      { label: `Created ${createdStrategies.length}`, value: "created" as const },
      { label: `Invested ${usedStrategies.length}`, value: "invested" as const },
      { label: `Bookmarked ${bookmarkedStrategies.length}`, value: "bookmarked" as const },
    ],
    [bookmarkedStrategies.length, createdStrategies.length, usedStrategies.length],
  );
  const allMyStrategies = useMemo(
    () => Array.from(new Map([...createdStrategies, ...usedStrategies].map((strategy) => [strategy.id, strategy])).values()),
    [createdStrategies, usedStrategies],
  );
  const totalPnl = allMyStrategies.reduce((sum, strategy) => sum + strategy.realizedPnl, 0);
  const totalCapital = allMyStrategies.reduce((sum, strategy) => sum + strategy.deployedCapital, 0);
  const largestSwing = allMyStrategies
    .map((strategy) => ({ strategy, swing: getLargestSwing(strategy) }))
    .sort((a, b) => b.swing - a.swing)[0];

  return (
    <main className="profile-layout my-page-layout">
      <Button variant="back" onClick={onBack}>
        Back
      </Button>

      <section className="my-page-hero">
        <div className="my-account-panel">
          <span className="field-label">My Page</span>
          <div className="my-account-main">
            <UserAvatar name={profile.name} src={profile.avatarUrl} className="my-avatar" />
            <div>
              <h1>{profile.name}</h1>
              <strong>{profile.handle}</strong>
              <p>{profile.bio}</p>
            </div>
          </div>
          <div className="profile-social-row">
            {profile.twitter ? (
              <a href={profile.twitter} target="_blank" rel="noreferrer">
                Twitter
              </a>
            ) : null}
            {profile.github ? (
              <a href={profile.github} target="_blank" rel="noreferrer">
                GitHub
              </a>
            ) : null}
            <button type="button" onClick={onEditProfile}>
              Edit Profile
            </button>
            <button type="button" onClick={onLaunchLogic}>
              Launch Logic
            </button>
          </div>
        </div>

        <div className="wallet-box my-wallet-box">
          <span className="field-label">Wallet</span>
          <strong>{formatAddress(account.eoaAddress)}</strong>
          <small>Joined {formatTimestamp(account.joinedAt)}</small>
          <a href={getDeBankProfileUrl(account.eoaAddress)} target="_blank" rel="noreferrer">
            Portfolio on DeBank
          </a>
        </div>
      </section>

      <section className="profile-stats my-page-stats">
        <div>
          <span className="field-label">Invested</span>
          <strong>{usedStrategies.length}</strong>
        </div>
        <div>
          <span className="field-label">Bookmarked</span>
          <strong>{bookmarkedStrategies.length}</strong>
        </div>
        <div>
          <span className="field-label">My PnL</span>
          <strong className={totalPnl >= 0 ? "positive" : "negative"}>{formatSignedCurrency(totalPnl)}</strong>
        </div>
        <div>
          <span className="field-label">Capital</span>
          <strong>{formatCurrency(totalCapital)}</strong>
        </div>
        <div>
          <span className="field-label">Created</span>
          <strong>{createdStrategies.length}</strong>
        </div>
        <div>
          <span className="field-label">Max 24h Swing</span>
          <strong>{largestSwing ? formatCurrency(largestSwing.swing) : "$0"}</strong>
        </div>
      </section>

      <section className="my-page-section">
        <div className="my-vault-section-header">
          <div className="panel-heading">
            <span>{myVaultViewCopy[activeVaultView].title}</span>
            <strong>{visibleVaults.length}</strong>
          </div>
          <ToggleGroup
            label="My vault view"
            options={vaultViewOptions}
            value={activeVaultView}
            onChange={setActiveVaultView}
            className="my-vault-toggle"
          />
        </div>
        {visibleVaults.length > 0 ? (
          <div className="profile-strategy-grid">
            {visibleVaults.map((strategy: Strategy) => (
              <CreatorStrategyCard
                key={strategy.id}
                strategy={strategy}
                onOpen={() => onStrategySelect(strategy.id)}
              />
            ))}
          </div>
        ) : (
          <div className="logic-empty-state">{myVaultViewCopy[activeVaultView].empty}</div>
        )}
      </section>

      <section className="my-page-section">
        <div className="panel-heading">
          <span>My Logic</span>
          <strong>{myLogics.length}</strong>
        </div>
        <div className="my-logic-list">
          {myLogics.length > 0 ? (
            myLogics.map((logic) => (
              <article key={logic.id}>
                <strong>{logic.name}</strong>
                <span>{logic.description}</span>
                <small>{formatTimestamp(logic.updatedAt)}</small>
              </article>
            ))
          ) : (
            <div className="logic-empty-state">No saved logic yet</div>
          )}
        </div>
      </section>
    </main>
  );
}
