import { formatCurrency, formatPct, formatSignedCurrency } from "../../../shared/utils/formatters";

export function NetPositionSummary({
  netPosition,
  pnl,
  className = "",
}: {
  netPosition: number;
  pnl: number;
  className?: string;
}) {
  const classes = ["vault-net-position-summary", className].filter(Boolean).join(" ");
  const pnlPct = netPosition > 0 ? (pnl / netPosition) * 100 : 0;
  const pnlClassName = pnl >= 0 ? "positive" : "negative";

  return (
    <div className={classes}>
      <div>
        <span>Net Position</span>
        <strong>{formatCurrency(netPosition)}</strong>
      </div>
      <div>
        <span>PnL</span>
        <strong className={pnlClassName}>
          {formatSignedCurrency(pnl)} <small>({formatPct(pnlPct)})</small>
        </strong>
      </div>
    </div>
  );
}
