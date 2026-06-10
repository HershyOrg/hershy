import { creators } from "../store/strategyCatalog";
import type { Strategy } from "../types/strategyTypes";
import { Button } from "../../../shared/components";
import { formatCompact, formatSignedCurrency } from "../../../shared/utils/formatters";
import { getBaseForkCount } from "../utils/strategyMetrics";
import { getVaultShareMarketCap, getVaultShareSymbol } from "../utils/vaultShare";
import { VaultShareVisual } from "./VaultShareVisual";

function VaultShareDetails({
  strategy,
  forkCount,
  onCreatorSelect,
}: {
  strategy: Strategy;
  forkCount: number;
  onCreatorSelect?: () => void;
}) {
  const creator = creators[strategy.creatorId];
  const symbol = getVaultShareSymbol(strategy);
  const marketCap = getVaultShareMarketCap(strategy);

  return (
    <div className="pump-card-body">
      <div className="pump-card-title-row">
        <div>
          <h2>{strategy.title}</h2>
          <span>${symbol}</span>
        </div>
        <strong className={strategy.realizedPnl >= 0 ? "positive" : "negative"}>
          {formatSignedCurrency(strategy.realizedPnl)}
        </strong>
      </div>

      <div className="pump-card-metrics">
        <div>
          <span>MC</span>
          <strong>${formatCompact(marketCap)}</strong>
        </div>
        {onCreatorSelect ? (
          <button
            type="button"
            className="pump-creator-link"
            onClick={(event) => {
              event.stopPropagation();
              onCreatorSelect();
            }}
          >
            <span>made by</span>
            <strong>{creator.name}</strong>
          </button>
        ) : (
          <div>
            <span>made by</span>
            <strong>{creator.name}</strong>
          </div>
        )}
        <div>
          <span>forks</span>
          <strong>{forkCount}</strong>
        </div>
      </div>
    </div>
  );
}

export function CreatorStrategyCard({
  strategy,
  onOpen,
}: {
  strategy: Strategy;
  onOpen: () => void;
}) {
  const forkCount = getBaseForkCount(strategy);

  return (
    <article
      className="profile-strategy-card pump-profile-strategy-card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <VaultShareVisual strategy={strategy} />
      <VaultShareDetails strategy={strategy} forkCount={forkCount} />
    </article>
  );
}

export function StrategyCard({
  strategy,
  bookmarked,
  forkCount,
  used,
  onBookmark,
  onCreatorSelect,
  onOpen,
  onUse,
  onDrop,
}: {
  strategy: Strategy;
  bookmarked: boolean;
  forkCount: number;
  used: boolean;
  onBookmark: () => void;
  onCreatorSelect: () => void;
  onOpen: () => void;
  onUse: () => void;
  onDrop: () => void;
}) {
  return (
    <article
      className={`strategy-card${used ? " used" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <VaultShareVisual
        strategy={strategy}
        bookmarked={bookmarked}
        onBookmark={onBookmark}
      />
      <VaultShareDetails strategy={strategy} forkCount={forkCount} onCreatorSelect={onCreatorSelect} />

      <div className="trade-actions">
        <Button
          variant="use"
          onClick={(event) => {
            event.stopPropagation();
            onUse();
          }}
        >
          Use
        </Button>
        <Button
          variant="drop"
          onClick={(event) => {
            event.stopPropagation();
            onDrop();
          }}
        >
          Drop
        </Button>
      </div>
    </article>
  );
}
