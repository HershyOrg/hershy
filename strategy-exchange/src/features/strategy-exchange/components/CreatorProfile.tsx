import type { UserAccountRow } from "../../../../demoDB";
import { currentExecutionChains } from "../executionChains";
import { strategies } from "../store/strategyCatalog";
import type { Creator } from "../types/strategyTypes";
import { getLargestSwing } from "../utils/strategyMetrics";
import { buildUserProfile } from "../store/userProfileStore";
import { Button, UserAvatar } from "../../../shared/components";
import { formatCurrency, formatSignedCurrency, getDeBankProfileUrl } from "../../../shared/utils/formatters";
import { CreatorStrategyCard } from "./StrategyCards";

export function CreatorProfile({
  creator,
  account,
  onBack,
  onStrategySelect,
}: {
  creator: Creator;
  account?: UserAccountRow | null;
  onBack: () => void;
  onStrategySelect: (strategyId: string) => void;
}) {
  const creatorStrategies = strategies.filter((strategy) => strategy.creatorId === creator.id);
  const strategyVenues = Array.from(new Set(creatorStrategies.flatMap((strategy) => strategy.venues)));
  const shouldShowChains = currentExecutionChains.length > 1;
  const strategyChains = shouldShowChains
    ? Array.from(new Set(creatorStrategies.flatMap((strategy) => strategy.chains)))
    : [];
  const profile = account ? buildUserProfile(creator, account) : null;
  const largestSwing = creatorStrategies
    .map((strategy) => ({ strategy, swing: getLargestSwing(strategy) }))
    .sort((a, b) => b.swing - a.swing)[0];

  return (
    <main className="profile-layout">
      <Button variant="back" onClick={onBack}>
        Back
      </Button>

      <section className="profile-hero">
        <div className="profile-identity">
          <UserAvatar name={profile?.name ?? creator.name} src={profile?.avatarUrl} className="profile-avatar" />
          <div>
            <span className="field-label">Creator</span>
            <h1>{profile?.name ?? creator.name}</h1>
            <strong>{profile?.handle ?? creator.handle}</strong>
            <p>{profile?.bio ?? creator.bio}</p>
            {profile?.twitter || profile?.github ? (
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
              </div>
            ) : null}
          </div>
        </div>
        <div className="wallet-box">
          <span className="field-label">EOA</span>
          <strong>{account?.eoaAddress ?? creator.walletAddress ?? "Not linked"}</strong>
          {account?.eoaAddress ? (
            <a href={getDeBankProfileUrl(account.eoaAddress)} target="_blank" rel="noreferrer">
              Portfolio on DeBank
            </a>
          ) : null}
        </div>
      </section>

      <section className="profile-stats">
        <div>
          <span className="field-label">Traded Capital</span>
          <strong>{formatCurrency(creator.tradedCapital)}</strong>
        </div>
        <div>
          <span className="field-label">Trading Profit</span>
          <strong className="positive">{formatSignedCurrency(creator.tradingProfit)}</strong>
        </div>
        <div>
          <span className="field-label">Strategies</span>
          <strong>{creatorStrategies.length}</strong>
        </div>
        <div>
          <span className="field-label">Max 24h Swing</span>
          <strong>{largestSwing ? formatCurrency(largestSwing.swing) : "$0"}</strong>
        </div>
      </section>

      <section className="profile-columns">
        <div className="profile-panel">
          <h2>Exchanges</h2>
          <div className="profile-tags">
            {Array.from(new Set([...(profile?.exchanges ?? creator.exchanges), ...strategyVenues])).map((exchange) => (
              <span key={exchange}>{exchange}</span>
            ))}
          </div>
        </div>
        {shouldShowChains ? (
          <div className="profile-panel">
            <h2>Chains</h2>
            <div className="profile-tags">
              {Array.from(new Set([...(profile?.chains ?? creator.chains), ...strategyChains])).map((chain) => (
                <span key={chain}>{chain}</span>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="profile-strategy-section">
        <h2>Created Strategies</h2>
        <div className="profile-strategy-grid">
          {creatorStrategies.map((strategy) => (
            <CreatorStrategyCard
              key={strategy.id}
              strategy={strategy}
              onOpen={() => onStrategySelect(strategy.id)}
            />
          ))}
        </div>
      </section>
    </main>
  );
}
