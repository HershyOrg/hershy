import type { CSSProperties } from "react";
import { disclosureLabels, productTypeLabels } from "../constants";
import type { Strategy } from "../types/strategyTypes";
import { getVaultSharePalette, getVaultShareSymbol } from "../utils/vaultShare";
import { formatPct } from "../../../shared/utils/formatters";
import { LightweightReturnChart } from "./LightweightReturnChart";

type VaultShareVisualProps = {
  strategy: Strategy;
  bookmarked?: boolean;
  onBookmark?: () => void;
  className?: string;
  artworkOnly?: boolean;
};

function BookmarkButton({
  active,
  onToggle,
  label,
}: {
  active: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      className={`bookmark-button${active ? " active" : ""}`}
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      {active ? "★" : "☆"}
    </button>
  );
}

export function VaultShareVisual({
  strategy,
  bookmarked,
  onBookmark,
  className = "",
  artworkOnly = false,
}: VaultShareVisualProps) {
  const symbol = artworkOnly ? "" : getVaultShareSymbol(strategy);
  const palette = getVaultSharePalette(strategy);
  const visualStyle = {
    "--share-bg": palette.bg,
    "--share-accent": palette.accent,
    "--share-ink": palette.ink,
  } as CSSProperties;
  const visualClassName = [
    "vault-share-visual",
    artworkOnly ? "artwork-only" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <div className={visualClassName} style={visualStyle}>
      {!artworkOnly ? (
        <div className="vault-share-tags">
          <span>{productTypeLabels[strategy.productType]}</span>
          <span>{disclosureLabels[strategy.disclosure]}</span>
        </div>
      ) : null}

      {onBookmark && !artworkOnly ? (
        <BookmarkButton
          active={Boolean(bookmarked)}
          label={`${strategy.title} 북마크`}
          onToggle={onBookmark}
        />
      ) : null}

      <div className="vault-share-artwork" aria-hidden="true">
        <div className="vault-share-ring" />
        <div className="vault-share-coin">
          {!artworkOnly ? (
            <>
              <strong>{symbol}</strong>
              <span>share</span>
            </>
          ) : null}
        </div>
        <div className="vault-share-band top" />
        <div className="vault-share-band bottom" />
      </div>

      {!artworkOnly ? (
        <div className="vault-share-chart" aria-hidden="true">
          <LightweightReturnChart
            className="vault-share-lightweight-chart"
            series={strategy.pnlSeries}
            baseValue={strategy.deployedCapital}
            compact
            fill
            height={104}
            positive={strategy.realizedPnl >= 0}
            lineColor={strategy.realizedPnl >= 0 ? "#0ecb81" : "#f6465d"}
          />
        </div>
      ) : null}

      {!artworkOnly ? (
        <div className={strategy.realizedPnl >= 0 ? "vault-share-return positive" : "vault-share-return negative"}>
          {formatPct(strategy.pnlPct)}
        </div>
      ) : null}
    </div>
  );
}
