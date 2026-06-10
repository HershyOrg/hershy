export function getEasyNodeKind(label: string, id: string) {
  const text = `${label} ${id}`.toLowerCase();
  if (/risk|cap|hedge|delta|gamma|kill|drawdown/.test(text)) return "risk";
  if (/signal|basis|premium|window|arb|krw|usd|usdt|eth|vault|collateral/.test(text)) {
    return "stream";
  }
  if (/curve|uniswap|aave|morpho|lido|gmx|camelot|vault/.test(text)) return "dex";
  if (/binance|bybit|okx|coinbase|upbit|bithumb|hyperliquid|deribit|dydx/.test(text)) {
    return "cex";
  }
  return "condition";
}

export function getEasyEdgeKind(label: string) {
  const text = label.toLowerCase();
  if (/risk|cap|hedge|delta|rebalance|close|exit/.test(text)) return "risk";
  if (/signal|entry|condition|premium|spread|basis/.test(text)) return "condition";
  if (/data|route|mint|settle|supply|borrow|stake|loop|swap|bridge|local/.test(text)) {
    return "data";
  }
  return "sequence";
}

export function getEasyEdgeColor(kind: string) {
  if (kind === "condition") return "var(--easy-edge-label-3)";
  if (kind === "data") return "var(--easy-edge-label-4)";
  if (kind === "risk") return "var(--easy-edge-label-2)";
  return "var(--easy-edge-label-1)";
}

export function getEasyEdgeDash(kind: string) {
  if (kind === "condition" || kind === "risk") return "8 6";
  if (kind === "data") return "3 7";
  return undefined;
}

export function buildEasyPath(from: { x: number; y: number }, to: { x: number; y: number }) {
  const horizontalGap = Math.abs(to.x - from.x);
  const laneX = from.x + (to.x - from.x) / 2;
  if (horizontalGap > 58) {
    return `M ${from.x} ${from.y} L ${laneX} ${from.y} L ${laneX} ${to.y} L ${to.x} ${to.y}`;
  }
  const laneY = from.y + (to.y - from.y) / 2;
  return `M ${from.x} ${from.y} L ${from.x} ${laneY} L ${to.x} ${laneY} L ${to.x} ${to.y}`;
}
