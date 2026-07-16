export function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

export function formatToken(value: number, symbol: string) {
  const maximumFractionDigits = value < 1 ? 6 : 3;

  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(value)} ${symbol}`;
}

export function formatAddress(address: string) {
  if (address.includes("...")) return address;
  if (address.length <= 12) return address;

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
