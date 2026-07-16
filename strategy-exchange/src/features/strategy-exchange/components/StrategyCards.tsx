import { creators } from "../store/strategyCatalog";
import type { Strategy } from "../types/strategyTypes";
import { Button } from "../../../shared/components";
import { formatCompact, formatSignedCurrency } from "../../../shared/utils/formatters";
import { getVaultShareMarketCap, getVaultShareSymbol } from "../utils/vaultShare";
import { VaultShareVisual } from "./VaultShareVisual";

function VaultShareDetails({
  strategy,
  onCreatorSelect,
}: {
  strategy: Strategy;
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
          <span>AUM</span>
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
      <VaultShareDetails strategy={strategy} />
    </article>
  );
}

export function StrategyCard({
  strategy,
  bookmarked,
  used,
  onBookmark,
  onCreatorSelect,
  onOpen,
  onUse,
}: {
  strategy: Strategy;
  bookmarked: boolean;
  used: boolean;
  onBookmark: () => void;
  onCreatorSelect: () => void;
  onOpen: () => void;
  onUse: () => void;
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
      <VaultShareDetails strategy={strategy} onCreatorSelect={onCreatorSelect} />

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
      </div>
    </article>
  );
}
