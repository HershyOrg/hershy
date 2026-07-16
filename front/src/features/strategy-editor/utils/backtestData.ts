export type NormalizedBacktestRow = {
  timestamp: number;
  isoDate: string;
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  metrics: Record<string, number | string>;
  sourceIndex: number;
};

export type BacktestNormalizationResult = {
  fileName: string;
  format: "csv" | "json";
  normalizedAt: number;
  columns: string[];
  rows: NormalizedBacktestRow[];
  previewRows: NormalizedBacktestRow[];
  rowCount: number;
  droppedRows: number;
  duplicateRows: number;
  startDate: string;
  endDate: string;
  symbols: string[];
  intervalLabel: string;
  detectedMetrics: string[];
  metricCoverage: Record<string, number>;
  fieldCoverage: {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    symbol: number;
  };
  warnings: string[];
  errors: string[];
};

export type BacktestReplayTrade = {
  symbol: string;
  signalDate: string;
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  returnPct: number;
};

export type BacktestReplayResult = {
  signalCount: number;
  tradeCount: number;
  pendingSignals: number;
  winRate: number;
  totalPnl: number;
  totalReturnPct: number;
  cagr: number;
  maxDrawdownPct: number;
  annualizedVolatilityPct: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  profitFactor: number;
  payoffRatio: number;
  expectancyPct: number;
  averageReturnPct: number;
  averageWinPct: number;
  averageLossPct: number;
  bestTradePct: number;
  worstTradePct: number;
  exposurePct: number;
  averageHoldingHours: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  trades: BacktestReplayTrade[];
};

type RawRecord = Record<string, unknown>;

type CsvParseResult = {
  columns: string[];
  rows: RawRecord[];
};

type NormalizationCounters = {
  invalidRows: number;
  duplicateRows: number;
  filledOpen: number;
  filledHigh: number;
  filledLow: number;
  filledVolume: number;
};

const TIMESTAMP_KEYS = [
  "date",
  "datetime",
  "time",
  "timestamp",
  "ts",
  "period",
  "periodstart",
  "opentime",
  "start",
];

const OPEN_KEYS = ["open", "o", "openprice"];
const HIGH_KEYS = ["high", "h", "highprice", "max"];
const LOW_KEYS = ["low", "l", "lowprice", "min"];
const CLOSE_KEYS = ["close", "c", "price", "last", "settle", "adjclose", "adjcloseprice"];
const VOLUME_KEYS = ["volume", "vol", "v", "qty", "quantity", "basevolume"];
const SYMBOL_KEYS = ["symbol", "ticker", "asset", "instrument", "pair", "market"];

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normalizeBacktestMetricName(metric: string) {
  return normalizeKey(metric);
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function chooseDelimiter(headerLine: string) {
  const candidates = [",", ";", "\t"];
  return candidates.reduce((best, candidate) => {
    const bestCount = headerLine.split(best).length;
    const candidateCount = headerLine.split(candidate).length;
    return candidateCount > bestCount ? candidate : best;
  }, ",");
}

function parseCsvLine(line: string, delimiter: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === "\"" && inQuotes && nextChar === "\"") {
      current += "\"";
      index += 1;
      continue;
    }

    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function parseCsv(text: string): CsvParseResult {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) return { columns: [], rows: [] };

  const delimiter = chooseDelimiter(lines[0]);
  const columns = parseCsvLine(lines[0], delimiter).map((column, index) =>
    column.trim() || `column_${index + 1}`,
  );
  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line, delimiter);
    return values.reduce<RawRecord>((record, value, index) => {
      record[columns[index] ?? `column_${index + 1}`] = value;
      return record;
    }, {});
  });

  return { columns, rows };
}

function arrayRowToRecord(row: unknown[]): RawRecord | null {
  if (row.length < 5) return null;
  return {
    timestamp: row[0],
    open: row[1],
    high: row[2],
    low: row[3],
    close: row[4],
    volume: row[5] ?? 0,
    symbol: row[6],
  };
}

function parseYahooChartRows(source: RawRecord): RawRecord[] | null {
  const chart = isRecord(source.chart) ? source.chart : null;
  const result = Array.isArray(chart?.result) ? chart.result[0] : null;
  if (!isRecord(result) || !Array.isArray(result.timestamp)) return null;

  const indicators = isRecord(result.indicators) ? result.indicators : null;
  const quoteList = Array.isArray(indicators?.quote) ? indicators?.quote : [];
  const quote = isRecord(quoteList[0]) ? quoteList[0] : null;
  if (!quote) return null;

  const opens = Array.isArray(quote.open) ? quote.open : [];
  const highs = Array.isArray(quote.high) ? quote.high : [];
  const lows = Array.isArray(quote.low) ? quote.low : [];
  const closes = Array.isArray(quote.close) ? quote.close : [];
  const volumes = Array.isArray(quote.volume) ? quote.volume : [];
  const meta = isRecord(result.meta) ? result.meta : {};
  const symbol = typeof meta.symbol === "string" ? meta.symbol : undefined;

  return result.timestamp.map((timestamp, index) => ({
    timestamp,
    open: opens[index],
    high: highs[index],
    low: lows[index],
    close: closes[index],
    volume: volumes[index],
    symbol,
  }));
}

function extractJsonRows(parsed: unknown): RawRecord[] {
  if (Array.isArray(parsed)) {
    return parsed
      .map((row) => {
        if (isRecord(row)) return row;
        if (Array.isArray(row)) return arrayRowToRecord(row);
        return null;
      })
      .filter((row): row is RawRecord => Boolean(row));
  }

  if (!isRecord(parsed)) return [];

  const yahooRows = parseYahooChartRows(parsed);
  if (yahooRows) return yahooRows;

  const candidateKeys = ["data", "rows", "candles", "ohlcv", "prices", "results"];
  for (const key of candidateKeys) {
    const value = parsed[key];
    if (Array.isArray(value)) return extractJsonRows(value);
  }

  return [parsed];
}

function buildKeyMap(record: RawRecord) {
  const keyMap = new Map<string, unknown>();
  Object.entries(record).forEach(([key, value]) => {
    keyMap.set(normalizeKey(key), value);
  });
  return keyMap;
}

function readAlias(keyMap: Map<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    if (keyMap.has(alias)) return keyMap.get(alias);
  }
  return undefined;
}

function readMetric(metrics: Record<string, number | string>, aliases: string[]) {
  for (const alias of aliases) {
    const key = normalizeKey(alias);
    if (Object.prototype.hasOwnProperty.call(metrics, key)) return metrics[key];
  }
  return undefined;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/,/g, "").replace(/[$%]/g, "");
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function collectMetrics(record: RawRecord) {
  const metrics: Record<string, number | string> = {};
  Object.entries(record).forEach(([key, value]) => {
    const metricKey = normalizeKey(key);
    if (!metricKey) return;
    const numeric = parseNumber(value);
    if (numeric !== null) {
      metrics[metricKey] = numeric;
      return;
    }
    if (typeof value === "string" && value.trim()) {
      metrics[metricKey] = value.trim();
    }
  });
  return metrics;
}

function firstNumericMetric(metrics: Record<string, number | string>) {
  for (const [key, value] of Object.entries(metrics)) {
    if (TIMESTAMP_KEYS.includes(key) || SYMBOL_KEYS.includes(key) || key === "sourceindex") continue;
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function countMetricCoverage(rows: NormalizedBacktestRow[]) {
  const coverage: Record<string, number> = {};
  rows.forEach((row) => {
    Object.entries(row.metrics).forEach(([key, value]) => {
      if (value === "" || value === null || value === undefined) return;
      coverage[key] = (coverage[key] ?? 0) + 1;
    });
  });
  return coverage;
}

function parseTimestamp(value: unknown): number | null {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  const numeric = parseNumber(value);
  if (numeric !== null) {
    if (numeric > 1_000_000_000_000) return numeric;
    if (numeric > 1_000_000_000) return numeric * 1000;
    if (numeric > 10_000 && numeric < 100_000) {
      const excelEpoch = Date.UTC(1899, 11, 30);
      return excelEpoch + numeric * 86_400_000;
    }
  }

  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatIsoDate(timestamp: number) {
  return new Date(timestamp).toISOString();
}

function normalizeRecord(
  record: RawRecord,
  sourceIndex: number,
  counters: NormalizationCounters,
  fieldCoverage: BacktestNormalizationResult["fieldCoverage"],
): NormalizedBacktestRow | null {
  const keyMap = buildKeyMap(record);
  const metrics = collectMetrics(record);
  const timestampValue = readAlias(keyMap, TIMESTAMP_KEYS);
  const openValue = readAlias(keyMap, OPEN_KEYS);
  const highValue = readAlias(keyMap, HIGH_KEYS);
  const lowValue = readAlias(keyMap, LOW_KEYS);
  const closeValue = readAlias(keyMap, CLOSE_KEYS);
  const volumeValue = readAlias(keyMap, VOLUME_KEYS);
  const timestamp = parseTimestamp(timestampValue);
  const close = parseNumber(closeValue) ?? firstNumericMetric(metrics);

  if (timestampValue !== undefined) fieldCoverage.timestamp += 1;
  if (openValue !== undefined) fieldCoverage.open += 1;
  if (highValue !== undefined) fieldCoverage.high += 1;
  if (lowValue !== undefined) fieldCoverage.low += 1;
  if (closeValue !== undefined) fieldCoverage.close += 1;
  if (volumeValue !== undefined) fieldCoverage.volume += 1;
  if (readAlias(keyMap, SYMBOL_KEYS) !== undefined) fieldCoverage.symbol += 1;

  if (timestamp === null || close === null) {
    counters.invalidRows += 1;
    return null;
  }

  const open = parseNumber(openValue);
  const high = parseNumber(highValue);
  const low = parseNumber(lowValue);
  const volume = parseNumber(volumeValue);
  const symbolValue = readAlias(keyMap, SYMBOL_KEYS);
  const metricSymbol = readMetric(metrics, SYMBOL_KEYS);
  const symbol = typeof symbolValue === "string" && symbolValue.trim()
    ? symbolValue.trim().toUpperCase()
    : typeof metricSymbol === "string" && metricSymbol.trim()
      ? metricSymbol.trim().toUpperCase()
    : "DATA";

  if (open === null) counters.filledOpen += 1;
  if (high === null) counters.filledHigh += 1;
  if (low === null) counters.filledLow += 1;
  if (volume === null) counters.filledVolume += 1;

  const normalizedOpen = open ?? close;
  const normalizedHigh = Math.max(high ?? close, normalizedOpen, close);
  const normalizedLow = Math.min(low ?? close, normalizedOpen, close);
  if (openValue !== undefined && open !== null) metrics.open = normalizedOpen;
  if (highValue !== undefined && high !== null) metrics.high = normalizedHigh;
  if (lowValue !== undefined && low !== null) metrics.low = normalizedLow;
  if (closeValue !== undefined) metrics.close = close;
  if (volumeValue !== undefined && volume !== null) metrics.volume = volume;
  if (symbolValue !== undefined) metrics.symbol = symbol;

  return {
    timestamp,
    isoDate: formatIsoDate(timestamp),
    symbol,
    open: normalizedOpen,
    high: normalizedHigh,
    low: normalizedLow,
    close,
    volume: volume ?? 0,
    metrics,
    sourceIndex,
  };
}

function inferIntervalLabel(rows: NormalizedBacktestRow[]) {
  const rowsBySymbol = rows.reduce<Map<string, NormalizedBacktestRow[]>>((groups, row) => {
    const group = groups.get(row.symbol) ?? [];
    group.push(row);
    groups.set(row.symbol, group);
    return groups;
  }, new Map());
  const diffs = Array.from(rowsBySymbol.values())
    .flatMap((symbolRows) => {
      const orderedRows = [...symbolRows].sort((a, b) => a.timestamp - b.timestamp);
      return orderedRows
        .slice(1)
        .map((row, index) => row.timestamp - orderedRows[index].timestamp);
    })
    .filter((diff) => Number.isFinite(diff) && diff > 0)
    .sort((a, b) => a - b);

  if (diffs.length === 0) return "single row";

  const median = diffs[Math.floor(diffs.length / 2)];
  const minutes = Math.round(median / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1_440)}d`;
}

function buildWarnings(counters: NormalizationCounters, symbols: string[]) {
  const warnings: string[] = [];
  if (counters.invalidRows > 0) warnings.push(`${counters.invalidRows} rows dropped because timestamp or metric data was invalid.`);
  if (counters.duplicateRows > 0) warnings.push(`${counters.duplicateRows} duplicate timestamp rows collapsed.`);
  if (counters.filledOpen > 0) warnings.push(`${counters.filledOpen} rows filled missing open from close.`);
  if (counters.filledHigh > 0) warnings.push(`${counters.filledHigh} rows filled missing high from close.`);
  if (counters.filledLow > 0) warnings.push(`${counters.filledLow} rows filled missing low from close.`);
  if (counters.filledVolume > 0) warnings.push(`${counters.filledVolume} rows filled missing volume with 0.`);
  if (symbols.length > 1) warnings.push(`${symbols.length} symbols detected; rows remain symbol-tagged.`);
  return warnings;
}

export function normalizeBacktestDataset(fileName: string, text: string): BacktestNormalizationResult {
  const trimmed = text.trim();
  const format = fileName.toLowerCase().endsWith(".json") || trimmed.startsWith("{") || trimmed.startsWith("[")
    ? "json"
    : "csv";
  const errors: string[] = [];
  let columns: string[] = [];
  let rawRows: RawRecord[] = [];

  try {
    if (format === "json") {
      const parsed = JSON.parse(trimmed);
      rawRows = extractJsonRows(parsed);
      columns = Array.from(new Set(rawRows.flatMap((row) => Object.keys(row))));
    } else {
      const parsedCsv = parseCsv(text);
      columns = parsedCsv.columns;
      rawRows = parsedCsv.rows;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown parse error";
    errors.push(`Parse failed: ${message}`);
  }

  if (rawRows.length === 0 && errors.length === 0) {
    errors.push("No rows found in uploaded data.");
  }

  const counters: NormalizationCounters = {
    invalidRows: 0,
    duplicateRows: 0,
    filledOpen: 0,
    filledHigh: 0,
    filledLow: 0,
    filledVolume: 0,
  };
  const fieldCoverage: BacktestNormalizationResult["fieldCoverage"] = {
    timestamp: 0,
    open: 0,
    high: 0,
    low: 0,
    close: 0,
    volume: 0,
    symbol: 0,
  };

  const normalizedRows = rawRows
    .map((record, index) => normalizeRecord(record, index + 1, counters, fieldCoverage))
    .filter((row): row is NormalizedBacktestRow => Boolean(row))
    .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.timestamp - b.timestamp);

  const dedupedByTimestamp = new Map<string, NormalizedBacktestRow>();
  normalizedRows.forEach((row) => {
    const key = `${row.symbol}:${row.timestamp}`;
    if (dedupedByTimestamp.has(key)) counters.duplicateRows += 1;
    dedupedByTimestamp.set(key, row);
  });

  const rows = Array.from(dedupedByTimestamp.values()).sort((a, b) =>
    a.symbol.localeCompare(b.symbol) || a.timestamp - b.timestamp,
  );

  if (rows.length === 0 && errors.length === 0) {
    errors.push("No usable rows after normalization.");
  }

  const symbols = Array.from(new Set(rows.map((row) => row.symbol))).sort();
  const timestamps = rows.map((row) => row.timestamp);
  const startDate = timestamps.length > 0 ? formatIsoDate(Math.min(...timestamps)) : "";
  const endDate = timestamps.length > 0 ? formatIsoDate(Math.max(...timestamps)) : "";
  const metricCoverage = countMetricCoverage(rows);
  const detectedMetrics = Object.keys(metricCoverage).sort();

  return {
    fileName,
    format,
    normalizedAt: Date.now(),
    columns,
    rows,
    previewRows: rows.slice(0, 5),
    rowCount: rows.length,
    droppedRows: counters.invalidRows,
    duplicateRows: counters.duplicateRows,
    startDate,
    endDate,
    symbols,
    intervalLabel: inferIntervalLabel(rows),
    detectedMetrics,
    metricCoverage,
    fieldCoverage,
    warnings: buildWarnings(counters, symbols),
    errors,
  };
}

export function replayThreeDownCloseBacktest(
  rows: NormalizedBacktestRow[],
  shares = 1,
): BacktestReplayResult {
  const rowsBySymbol = rows.reduce<Map<string, NormalizedBacktestRow[]>>((groups, row) => {
    const group = groups.get(row.symbol) ?? [];
    group.push(row);
    groups.set(row.symbol, group);
    return groups;
  }, new Map());
  const trades: BacktestReplayTrade[] = [];
  let pendingSignals = 0;
  let signalCount = 0;

  rowsBySymbol.forEach((symbolRows) => {
    const orderedRows = [...symbolRows].sort((a, b) => a.timestamp - b.timestamp);
    for (let index = 3; index < orderedRows.length; index += 1) {
      const hasThreeDownClose =
        orderedRows[index - 2].close < orderedRows[index - 3].close &&
        orderedRows[index - 1].close < orderedRows[index - 2].close &&
        orderedRows[index].close < orderedRows[index - 1].close;

      if (!hasThreeDownClose) continue;

      signalCount += 1;
      const entry = orderedRows[index];
      const exit = orderedRows[index + 1];
      if (!exit) {
        pendingSignals += 1;
        continue;
      }

      const pnl = (exit.open - entry.close) * shares;
      const returnPct = (exit.open - entry.close) / entry.close;
      trades.push({
        symbol: entry.symbol,
        signalDate: entry.isoDate,
        entryDate: entry.isoDate,
        exitDate: exit.isoDate,
        entryPrice: entry.close,
        exitPrice: exit.open,
        pnl,
        returnPct,
      });
    }
  });

  const winningTrades = trades.filter((trade) => trade.pnl > 0).length;
  const totalPnl = trades.reduce((sum, trade) => sum + trade.pnl, 0);
  const averageReturnPct = trades.length > 0
    ? trades.reduce((sum, trade) => sum + trade.returnPct, 0) / trades.length
    : 0;
  const orderedTrades = [...trades].sort((left, right) =>
    Date.parse(left.exitDate) - Date.parse(right.exitDate),
  );
  let equity = 1;
  let highWaterMark = 1;
  let maxDrawdownPct = 0;
  orderedTrades.forEach((trade) => {
    equity *= 1 + trade.returnPct;
    highWaterMark = Math.max(highWaterMark, equity);
    const drawdown = highWaterMark > 0 ? (highWaterMark - equity) / highWaterMark : 0;
    maxDrawdownPct = Math.max(maxDrawdownPct, drawdown);
  });
  const totalReturnPct = equity - 1;
  const firstTradeTimestamp = orderedTrades.length > 0 ? Date.parse(orderedTrades[0].entryDate) : Number.NaN;
  const lastTradeTimestamp = orderedTrades.length > 0 ? Date.parse(orderedTrades[orderedTrades.length - 1].exitDate) : Number.NaN;
  const years = Number.isFinite(firstTradeTimestamp) && Number.isFinite(lastTradeTimestamp)
    ? Math.max((lastTradeTimestamp - firstTradeTimestamp) / (365.25 * 24 * 60 * 60 * 1000), 1 / 365.25)
    : 0;
  const cagr = years > 0 && equity > 0 ? Math.pow(equity, 1 / years) - 1 : 0;
  const returns = orderedTrades.map((trade) => trade.returnPct);
  const winningReturns = orderedTrades.filter((trade) => trade.returnPct > 0).map((trade) => trade.returnPct);
  const losingReturns = orderedTrades.filter((trade) => trade.returnPct < 0).map((trade) => trade.returnPct);
  const sumWinningPnl = orderedTrades
    .filter((trade) => trade.pnl > 0)
    .reduce((sum, trade) => sum + trade.pnl, 0);
  const sumLosingPnl = orderedTrades
    .filter((trade) => trade.pnl < 0)
    .reduce((sum, trade) => sum + trade.pnl, 0);
  const averageWinPct = winningReturns.length > 0
    ? winningReturns.reduce((sum, value) => sum + value, 0) / winningReturns.length
    : 0;
  const averageLossPct = losingReturns.length > 0
    ? losingReturns.reduce((sum, value) => sum + value, 0) / losingReturns.length
    : 0;
  const returnVariance = returns.length > 1
    ? returns.reduce((sum, value) => sum + Math.pow(value - averageReturnPct, 2), 0) / (returns.length - 1)
    : 0;
  const tradesPerYear = years > 0 ? orderedTrades.length / years : 0;
  const annualizedVolatilityPct = returnVariance > 0 && tradesPerYear > 0
    ? Math.sqrt(returnVariance) * Math.sqrt(tradesPerYear)
    : 0;
  const annualizedReturnApprox = averageReturnPct * tradesPerYear;
  const downsideVariance = losingReturns.length > 1
    ? losingReturns.reduce((sum, value) => sum + Math.pow(value, 2), 0) / (losingReturns.length - 1)
    : losingReturns.length === 1
      ? Math.pow(losingReturns[0], 2)
      : 0;
  const annualizedDownsideDeviation = downsideVariance > 0 && tradesPerYear > 0
    ? Math.sqrt(downsideVariance) * Math.sqrt(tradesPerYear)
    : 0;
  const sharpeRatio = annualizedVolatilityPct > 0 ? annualizedReturnApprox / annualizedVolatilityPct : 0;
  const sortinoRatio = annualizedDownsideDeviation > 0 ? annualizedReturnApprox / annualizedDownsideDeviation : 0;
  const calmarRatio = maxDrawdownPct > 0 ? cagr / maxDrawdownPct : 0;
  const profitFactor = sumLosingPnl < 0
    ? sumWinningPnl / Math.abs(sumLosingPnl)
    : sumWinningPnl > 0
      ? Number.POSITIVE_INFINITY
      : 0;
  const payoffRatio = averageLossPct < 0 ? averageWinPct / Math.abs(averageLossPct) : 0;
  const bestTradePct = returns.length > 0 ? Math.max(...returns) : 0;
  const worstTradePct = returns.length > 0 ? Math.min(...returns) : 0;
  const totalHoldingMs = orderedTrades.reduce((sum, trade) => {
    const entryTime = Date.parse(trade.entryDate);
    const exitTime = Date.parse(trade.exitDate);
    if (!Number.isFinite(entryTime) || !Number.isFinite(exitTime) || exitTime <= entryTime) return sum;
    return sum + (exitTime - entryTime);
  }, 0);
  const averageHoldingHours = orderedTrades.length > 0
    ? totalHoldingMs / orderedTrades.length / (60 * 60 * 1000)
    : 0;
  const backtestSpanMs = Number.isFinite(firstTradeTimestamp) && Number.isFinite(lastTradeTimestamp)
    ? Math.max(lastTradeTimestamp - firstTradeTimestamp, 0)
    : 0;
  const exposurePct = backtestSpanMs > 0 ? Math.min(totalHoldingMs / backtestSpanMs, 1) : 0;
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;
  orderedTrades.forEach((trade) => {
    if (trade.pnl > 0) {
      currentWinStreak += 1;
      currentLossStreak = 0;
    } else if (trade.pnl < 0) {
      currentLossStreak += 1;
      currentWinStreak = 0;
    } else {
      currentWinStreak = 0;
      currentLossStreak = 0;
    }
    maxConsecutiveWins = Math.max(maxConsecutiveWins, currentWinStreak);
    maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLossStreak);
  });

  return {
    signalCount,
    tradeCount: trades.length,
    pendingSignals,
    winRate: trades.length > 0 ? winningTrades / trades.length : 0,
    totalPnl,
    totalReturnPct,
    cagr,
    maxDrawdownPct,
    annualizedVolatilityPct,
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    profitFactor,
    payoffRatio,
    expectancyPct: averageReturnPct,
    averageReturnPct,
    averageWinPct,
    averageLossPct,
    bestTradePct,
    worstTradePct,
    exposurePct,
    averageHoldingHours,
    maxConsecutiveWins,
    maxConsecutiveLosses,
    trades: trades.slice(-20),
  };
}
