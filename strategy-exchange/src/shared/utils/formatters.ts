export const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);

export const formatSignedCurrency = (value: number) => {
  const formatted = formatCurrency(Math.abs(value));
  return value >= 0 ? `+${formatted}` : `-${formatted}`;
};

export const formatCompact = (value: number) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

export const formatPct = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;

export function formatAddress(value: string) {
  if (!value || value === "Not linked") return value;
  if (value.includes("...")) return value;
  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

export function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getDeBankProfileUrl(address: string) {
  return `https://debank.com/profile/${encodeURIComponent(address)}`;
}
