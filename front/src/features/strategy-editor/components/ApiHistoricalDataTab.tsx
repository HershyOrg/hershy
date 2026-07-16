import { useCallback, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { Node } from "@xyflow/react";
import {
  AlertTriangle,
  CandlestickChart,
  CheckCircle2,
  Database,
  Download,
  FileUp,
  Link2,
  Search,
  Trash2,
  Unlink,
} from "@/shared/components/icons";
import {
  readHistoricalDataState,
  writeHistoricalDataState,
} from "@/shared/store/clientStateStore";
import type {
  AdvancedGraphModel,
  ApiHistoricalDataMapping,
  HistoricalDataDataset,
  HistoricalMissingDateRange,
  PersistedHistoricalDataState,
} from "@/shared/types/domain";
import { cn } from "@/shared/utils/utils";
import {
  normalizeBacktestDataset,
  type BacktestNormalizationResult,
  type NormalizedBacktestRow,
} from "../utils/backtestData";

const INLINE_DATA_BYTE_LIMIT = 750_000;
const MAX_DATASET_COUNT = 32;
const MAX_MISSING_DATE_PREVIEW = 180;
const MAX_MISSING_DATE_RANGES = 80;
const BINANCE_SPOT_KLINE_LIMIT = 1000;
const BINANCE_FUTURES_KLINE_LIMIT = 1500;
const MARKET_API_BLOCK_PREFIX = "market-api";

const MARKET_DATA_INTERVALS = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "6h",
  "8h",
  "12h",
  "1d",
  "3d",
  "1w",
] as const;

type MarketDataExchange = "binance";
type MarketDataVenue = "spot" | "usdm-futures";
type DataMode = "feature" | "market";

type MarketDownloadForm = {
  exchange: MarketDataExchange;
  venue: MarketDataVenue;
  symbol: string;
  interval: typeof MARKET_DATA_INTERVALS[number];
  startDate: string;
  endDate: string;
};

type BinanceKlineRow = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string,
];

type ApiBlockModel = {
  id: string;
  name: string;
  address: string;
  method: string;
  kind: string;
  requiredFields: string[];
};

type ApiHistoricalDataTabProps = {
  graph: AdvancedGraphModel | null;
  onUseApiBlock?: (payload: { apiBlock: ApiBlockModel; dataset: HistoricalDataDataset | null }) => void;
};

type PendingUpload = {
  id: string;
  file: File;
  fileName: string;
  byteSize: number;
  rawText: string;
  rawPreviewText: string;
};

type NormalizedUpload = {
  upload: PendingUpload;
  normalized: BacktestNormalizationResult;
};

function createEmptyHistoricalDataState(): PersistedHistoricalDataState {
  return {
    version: 1,
    savedAt: Date.now(),
    datasets: [],
    mappings: [],
  };
}

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readText(source: Record<string, unknown>, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return fallback;
}

function getNodeData(node: Node): Record<string, unknown> {
  return isRecord(node.data) ? node.data : {};
}

function getApiBlockName(node: Node) {
  const data = getNodeData(node);
  return readText(data, ["label", "title", "name", "functionName"], node.id);
}

function getApiBlockAddress(node: Node) {
  const data = getNodeData(node);
  return readText(data, ["url", "sourceUrl", "endpoint", "apiUrl", "wsUrl", "rpcUrl", "apiReference"], "");
}

function getOutputBlockNames(data: Record<string, unknown>) {
  const outputBlocks = Array.isArray(data.outputBlocks) ? data.outputBlocks : [];
  return outputBlocks
    .map((block) => {
      if (!isRecord(block)) return "";
      return readText(block, ["name", "id", "field", "label"], "");
    })
    .filter(Boolean)
    .slice(0, 8);
}

function nodeLooksLikeApiBlock(node: Node) {
  if (node.type === "streamingNode") return true;
  const data = getNodeData(node);
  return Boolean(getApiBlockAddress(node)) &&
    /api|stream|feed|market|price|quote|ohlc|candle|endpoint/i.test(
      `${node.type ?? ""} ${getApiBlockName(node)} ${readText(data, ["apiReference", "purpose", "description"], "")}`,
    );
}

function buildApiBlocks(graph: AdvancedGraphModel | null): ApiBlockModel[] {
  if (!graph) return [];
  return graph.nodes
    .filter((node) => !node.hidden && node.type !== "groupNode" && nodeLooksLikeApiBlock(node))
    .map((node) => {
      const data = getNodeData(node);
      const streamKind = readText(data, ["streamKind"], "url");
      const method = readText(data, ["method", "protocol", "streamMethod"], "");
      return {
        id: node.id,
        name: getApiBlockName(node),
        address: getApiBlockAddress(node),
        method: method || (String(data.url ?? "").startsWith("ws") ? "WEBSOCKET" : "POLLING"),
        kind: streamKind,
        requiredFields: getOutputBlockNames(data),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en", {
    notation: Math.abs(value) >= 100_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatDateOnly(value: string) {
  if (!value) return "n/a";
  return value.slice(0, 10);
}

function formatDatasetDates(dataset: HistoricalDataDataset | null | undefined) {
  if (!dataset) return "No dataset";
  if (!dataset.startDate && !dataset.endDate) return "No date range";
  return `${formatDateOnly(dataset.startDate)} - ${formatDateOnly(dataset.endDate)}`;
}

function formatSavedAt(value: number) {
  if (!value) return "never";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function byteSizeForText(file: File, text: string) {
  return file.size || new Blob([text]).size;
}

function createRawPreviewText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return "";
  try {
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      const parsed = JSON.parse(trimmed);
      const sample = Array.isArray(parsed) ? parsed.slice(0, 5) : parsed;
      return JSON.stringify(sample, null, 2).slice(0, 4000);
    }
  } catch {
    // Fall back to line preview below.
  }
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .slice(0, 12)
    .join("\n")
    .slice(0, 4000);
}

function buildNormalizedPreviewRowsFromRows(rows: NormalizedBacktestRow[]) {
  return rows.slice(0, 8).map((row) => ({
    date: formatDateOnly(row.isoDate),
    symbol: row.symbol,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    ...Object.fromEntries(
      Object.entries(row.metrics)
        .filter(([key]) => !["date", "datetime", "time", "timestamp", "symbol", "open", "high", "low", "close", "volume"].includes(key))
        .slice(0, 6),
    ),
  }));
}

function buildNormalizedPreviewRows(normalized: BacktestNormalizationResult) {
  return buildNormalizedPreviewRowsFromRows(normalized.previewRows);
}

function createCombinedRawPreviewText(uploads: PendingUpload[]) {
  return uploads
    .slice(0, 4)
    .map((upload) => `# ${upload.fileName}\n${upload.rawPreviewText}`)
    .join("\n\n")
    .slice(0, 6000);
}

function inferCombinedIntervalLabel(rows: NormalizedBacktestRow[]) {
  const rowsBySymbol = rows.reduce<Map<string, NormalizedBacktestRow[]>>((groups, row) => {
    const group = groups.get(row.symbol) ?? [];
    group.push(row);
    groups.set(row.symbol, group);
    return groups;
  }, new Map());
  const diffs = Array.from(rowsBySymbol.values())
    .flatMap((symbolRows) => {
      const orderedRows = [...symbolRows].sort((left, right) => left.timestamp - right.timestamp);
      return orderedRows
        .slice(1)
        .map((row, index) => row.timestamp - orderedRows[index].timestamp);
    })
    .filter((diff) => Number.isFinite(diff) && diff > 0);
  const intervalMs = median(diffs);
  if (!intervalMs) return "single row";
  const minutes = Math.round(intervalMs / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1_440)}d`;
}

function dedupeRows(rows: NormalizedBacktestRow[]) {
  const rowsByKey = new Map<string, NormalizedBacktestRow>();
  let duplicateRows = 0;
  rows.forEach((row) => {
    const key = `${row.symbol}:${row.timestamp}`;
    if (rowsByKey.has(key)) duplicateRows += 1;
    rowsByKey.set(key, row);
  });
  return {
    rows: Array.from(rowsByKey.values()).sort((left, right) =>
      left.symbol.localeCompare(right.symbol) || left.timestamp - right.timestamp,
    ),
    duplicateRows,
  };
}

function formatMissingTimestamp(timestamp: number, intervalMs: number) {
  const iso = new Date(timestamp).toISOString();
  return intervalMs >= 86_400_000 ? iso.slice(0, 10) : iso.slice(0, 16).replace("T", " ");
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function summarizeMissingDates(rows: NormalizedBacktestRow[]) {
  const rowsBySymbol = rows.reduce<Map<string, NormalizedBacktestRow[]>>((groups, row) => {
    const symbolRows = groups.get(row.symbol) ?? [];
    symbolRows.push(row);
    groups.set(row.symbol, symbolRows);
    return groups;
  }, new Map());
  const missingDatesPreview: Array<{ symbol: string; date: string }> = [];
  const missingDateRanges: HistoricalMissingDateRange[] = [];
  let missingDateCount = 0;

  rowsBySymbol.forEach((symbolRows, symbol) => {
    const orderedRows = [...symbolRows].sort((left, right) => left.timestamp - right.timestamp);
    const diffs = orderedRows
      .slice(1)
      .map((row, index) => row.timestamp - orderedRows[index].timestamp)
      .filter((diff) => Number.isFinite(diff) && diff > 0);
    const intervalMs = median(diffs);
    if (!intervalMs) return;

    for (let index = 1; index < orderedRows.length; index += 1) {
      const previous = orderedRows[index - 1].timestamp;
      const current = orderedRows[index].timestamp;
      const gap = current - previous;
      const missingCount = Math.max(0, Math.round(gap / intervalMs) - 1);
      if (missingCount === 0) continue;

      missingDateCount += missingCount;
      const startTimestamp = previous + intervalMs;
      const endTimestamp = previous + intervalMs * missingCount;
      if (missingDateRanges.length < MAX_MISSING_DATE_RANGES) {
        missingDateRanges.push({
          symbol,
          startDate: formatMissingTimestamp(startTimestamp, intervalMs),
          endDate: formatMissingTimestamp(endTimestamp, intervalMs),
          count: missingCount,
        });
      }

      const previewSlots = MAX_MISSING_DATE_PREVIEW - missingDatesPreview.length;
      const previewCount = Math.max(0, Math.min(previewSlots, missingCount));
      for (let missingIndex = 0; missingIndex < previewCount; missingIndex += 1) {
        missingDatesPreview.push({
          symbol,
          date: formatMissingTimestamp(startTimestamp + intervalMs * missingIndex, intervalMs),
        });
      }
    }
  });

  return {
    missingDateCount,
    missingDatesPreview,
    missingDateRanges,
  };
}

function toHistoricalDataset(file: File, text: string, normalized: BacktestNormalizationResult): HistoricalDataDataset {
  const now = Date.now();
  const byteSize = byteSizeForText(file, text);
  const missingSummary = summarizeMissingDates(normalized.rows);
  const storageMode = normalized.errors.length === 0 && byteSize <= INLINE_DATA_BYTE_LIMIT
    ? "inline"
    : "metadata";

  return {
    id: createId("historical-data"),
    fileName: normalized.fileName,
    format: normalized.format,
    byteSize,
    rowCount: normalized.rowCount,
    droppedRows: normalized.droppedRows,
    duplicateRows: normalized.duplicateRows,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    symbols: normalized.symbols,
    intervalLabel: normalized.intervalLabel,
    detectedMetrics: normalized.detectedMetrics,
    warnings: normalized.warnings,
    errors: normalized.errors,
    rawPreviewText: createRawPreviewText(text),
    normalizedPreviewRows: buildNormalizedPreviewRows(normalized),
    missingDateCount: missingSummary.missingDateCount,
    missingDatesPreview: missingSummary.missingDatesPreview,
    missingDateRanges: missingSummary.missingDateRanges,
    uploadedAt: now,
    updatedAt: now,
    storageMode,
    ...(storageMode === "inline" ? { rawText: text } : {}),
  };
}

function toCombinedHistoricalDataset(normalizedUploads: NormalizedUpload[]): HistoricalDataDataset {
  if (normalizedUploads.length === 1) {
    const [{ upload, normalized }] = normalizedUploads;
    const dataset = toHistoricalDataset(upload.file, upload.rawText, normalized);
    return {
      ...dataset,
      sourceFiles: [{
        fileName: upload.fileName,
        byteSize: upload.byteSize,
        rowCount: normalized.rowCount,
        format: normalized.format,
      }],
    };
  }

  const now = Date.now();
  const uploads = normalizedUploads.map((item) => item.upload);
  const allRows = normalizedUploads.flatMap((item) => item.normalized.rows);
  const deduped = dedupeRows(allRows);
  const rows = deduped.rows;
  const timestamps = rows.map((row) => row.timestamp);
  const byteSize = uploads.reduce((sum, upload) => sum + upload.byteSize, 0);
  const sourceFiles = normalizedUploads.map(({ upload, normalized }) => ({
    fileName: upload.fileName,
    byteSize: upload.byteSize,
    rowCount: normalized.rowCount,
    format: normalized.format,
  }));
  const fileNames = uploads.map((upload) => upload.fileName);
  const format = normalizedUploads.every((item) => item.normalized.format === "json") ? "json" : "csv";
  const missingSummary = summarizeMissingDates(rows);
  const errors = normalizedUploads.flatMap(({ upload, normalized }) =>
    normalized.errors.map((error) => `${upload.fileName}: ${error}`),
  );
  const warnings = [
    ...normalizedUploads.flatMap(({ upload, normalized }) =>
      normalized.warnings.map((warning) => `${upload.fileName}: ${warning}`),
    ),
    deduped.duplicateRows > 0 ? `${deduped.duplicateRows} overlapping symbol/timestamp rows merged across files.` : "",
  ].filter(Boolean);
  const storageMode = errors.length === 0 && byteSize <= INLINE_DATA_BYTE_LIMIT ? "inline" : "metadata";
  const combinedRawText = uploads
    .map((upload) => `# ${upload.fileName}\n${upload.rawText}`)
    .join("\n\n");

  return {
    id: createId("historical-data"),
    fileName: `Combined ${uploads.length} files: ${fileNames.slice(0, 2).join(" + ")}${fileNames.length > 2 ? ` +${fileNames.length - 2}` : ""}`,
    format,
    byteSize,
    sourceFiles,
    rowCount: rows.length,
    droppedRows: normalizedUploads.reduce((sum, item) => sum + item.normalized.droppedRows, 0),
    duplicateRows: normalizedUploads.reduce((sum, item) => sum + item.normalized.duplicateRows, 0) + deduped.duplicateRows,
    startDate: timestamps.length > 0 ? new Date(Math.min(...timestamps)).toISOString() : "",
    endDate: timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : "",
    symbols: Array.from(new Set(rows.map((row) => row.symbol))).sort(),
    intervalLabel: inferCombinedIntervalLabel(rows),
    detectedMetrics: Array.from(new Set(rows.flatMap((row) => Object.keys(row.metrics)))).sort(),
    warnings,
    errors,
    rawPreviewText: createCombinedRawPreviewText(uploads),
    normalizedPreviewRows: buildNormalizedPreviewRowsFromRows(rows),
    missingDateCount: missingSummary.missingDateCount,
    missingDatesPreview: missingSummary.missingDatesPreview,
    missingDateRanges: missingSummary.missingDateRanges,
    uploadedAt: now,
    updatedAt: now,
    storageMode,
    ...(storageMode === "inline" ? { rawText: combinedRawText } : {}),
  };
}

function datasetMissingCount(dataset: HistoricalDataDataset | null | undefined) {
  return dataset?.missingDateCount ?? 0;
}

function datasetMissingRanges(dataset: HistoricalDataDataset | null | undefined) {
  return dataset?.missingDateRanges ?? [];
}

function datasetMissingPreview(dataset: HistoricalDataDataset | null | undefined) {
  return dataset?.missingDatesPreview ?? [];
}

function upsertApiMapping(
  state: PersistedHistoricalDataState,
  apiBlock: ApiBlockModel,
  datasetId: string,
) {
  const now = Date.now();
  const existing = state.mappings.find((mapping) => mapping.apiId === apiBlock.id);
  const mapping: ApiHistoricalDataMapping = existing
    ? {
      ...existing,
      apiName: apiBlock.name,
      datasetId,
      updatedAt: now,
    }
    : {
      id: createId("api-data-map"),
      apiId: apiBlock.id,
      apiName: apiBlock.name,
      datasetId,
      createdAt: now,
      updatedAt: now,
    };

  return [
    mapping,
    ...state.mappings.filter((item) => item.id !== mapping.id && item.apiId !== apiBlock.id),
  ];
}

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function createDefaultMarketDownloadForm(): MarketDownloadForm {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  return {
    exchange: "binance",
    venue: "spot",
    symbol: "BTCUSDT",
    interval: "1h",
    startDate: toDateInputValue(start),
    endDate: toDateInputValue(end),
  };
}

function intervalToMs(interval: string) {
  const value = Number.parseInt(interval, 10);
  if (!Number.isFinite(value) || value <= 0) return 60_000;
  if (interval.endsWith("m")) return value * 60_000;
  if (interval.endsWith("h")) return value * 60 * 60_000;
  if (interval.endsWith("d")) return value * 24 * 60 * 60_000;
  if (interval.endsWith("w")) return value * 7 * 24 * 60 * 60_000;
  return 60_000;
}

function dateInputToUtcMs(value: string, endOfDay = false) {
  if (!value) return Number.NaN;
  const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
  const timestamp = Date.parse(`${value}${suffix}`);
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function normalizeMarketSymbol(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function buildBinanceKlineUrl(form: MarketDownloadForm, startTime: number, endTime: number, limit: number) {
  const params = new URLSearchParams({
    symbol: normalizeMarketSymbol(form.symbol),
    interval: form.interval,
    startTime: String(startTime),
    endTime: String(endTime),
    limit: String(limit),
  });
  const path = form.venue === "spot" ? "/api/v3/klines" : "/fapi/v1/klines";
  const proxyPrefix = form.venue === "spot" ? "/binance-spot" : "/binance-futures";
  return `${proxyPrefix}${path}?${params.toString()}`;
}

function isBinanceKlineRows(value: unknown): value is BinanceKlineRow[] {
  return Array.isArray(value) && value.every((row) =>
    Array.isArray(row) &&
    row.length >= 7 &&
    Number.isFinite(Number(row[0])),
  );
}

async function fetchBinanceKlines(form: MarketDownloadForm) {
  const symbol = normalizeMarketSymbol(form.symbol);
  if (!symbol) {
    throw new Error("Enter a market symbol such as BTCUSDT.");
  }

  const startMs = dateInputToUtcMs(form.startDate);
  const endMs = dateInputToUtcMs(form.endDate, true);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error("Select a valid start and end date.");
  }

  const limit = form.venue === "spot" ? BINANCE_SPOT_KLINE_LIMIT : BINANCE_FUTURES_KLINE_LIMIT;
  const intervalMs = intervalToMs(form.interval);
  let cursor = startMs;
  const rows: BinanceKlineRow[] = [];
  const seenOpenTimes = new Set<number>();

  while (cursor <= endMs) {
    const url = buildBinanceKlineUrl({ ...form, symbol }, cursor, endMs, limit);
    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Binance request failed (${response.status})${text ? `: ${text.slice(0, 160)}` : ""}`);
    }

    const payload = await response.json();
    if (!isBinanceKlineRows(payload)) {
      throw new Error("Binance response did not include kline rows.");
    }

    if (payload.length === 0) break;
    payload.forEach((row) => {
      const openTime = Number(row[0]);
      if (!seenOpenTimes.has(openTime)) {
        seenOpenTimes.add(openTime);
        rows.push(row);
      }
    });

    const lastOpenTime = Number(payload[payload.length - 1]?.[0]);
    const nextCursor = lastOpenTime + intervalMs;
    if (!Number.isFinite(nextCursor) || nextCursor <= cursor) break;
    cursor = nextCursor;
    if (payload.length < limit) break;
  }

  return rows.sort((left, right) => Number(left[0]) - Number(right[0]));
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function binanceKlinesToCsv(form: MarketDownloadForm, rows: BinanceKlineRow[]) {
  const symbol = normalizeMarketSymbol(form.symbol);
  const header = [
    "exchange",
    "venue",
    "symbol",
    "interval",
    "open_time",
    "open_time_iso",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "close_time",
    "close_time_iso",
    "quote_asset_volume",
    "trade_count",
    "taker_buy_base_volume",
    "taker_buy_quote_volume",
  ];
  const lines = rows.map((row) => [
    form.exchange,
    form.venue,
    symbol,
    form.interval,
    row[0],
    new Date(Number(row[0])).toISOString(),
    row[1],
    row[2],
    row[3],
    row[4],
    row[5],
    row[6],
    new Date(Number(row[6])).toISOString(),
    row[7],
    row[8],
    row[9],
    row[10],
  ].map(csvEscape).join(","));
  return [header.join(","), ...lines].join("\n");
}

function getMarketVenueLabel(venue: MarketDataVenue) {
  return venue === "spot" ? "Spot" : "USD-M Futures";
}

function buildMarketApiBlockId(form: MarketDownloadForm) {
  return [
    MARKET_API_BLOCK_PREFIX,
    form.exchange,
    form.venue,
    normalizeMarketSymbol(form.symbol),
    form.interval,
  ].join(":");
}

function parseMarketApiBlockId(apiId: string): MarketDownloadForm | null {
  const [prefix, exchange, venue, symbol, interval] = apiId.split(":");
  if (prefix !== MARKET_API_BLOCK_PREFIX) return null;
  if (exchange !== "binance") return null;
  if (venue !== "spot" && venue !== "usdm-futures") return null;
  if (!symbol || !MARKET_DATA_INTERVALS.includes(interval as MarketDownloadForm["interval"])) return null;
  return {
    exchange,
    venue,
    symbol,
    interval: interval as MarketDownloadForm["interval"],
    startDate: "",
    endDate: "",
  };
}

function getBinanceRealtimeKlineUrl(form: MarketDownloadForm) {
  const symbol = normalizeMarketSymbol(form.symbol).toLowerCase();
  const host = form.venue === "spot"
    ? "wss://stream.binance.com:9443/ws"
    : "wss://fstream.binance.com/ws";
  return `${host}/${symbol}@kline_${form.interval}`;
}

function buildMarketApiBlock(form: MarketDownloadForm): ApiBlockModel {
  const symbol = normalizeMarketSymbol(form.symbol);
  return {
    id: buildMarketApiBlockId({ ...form, symbol }),
    name: `Binance ${getMarketVenueLabel(form.venue)} ${symbol} ${form.interval} Candle Stream`,
    address: getBinanceRealtimeKlineUrl({ ...form, symbol }),
    method: "WEBSOCKET",
    kind: "url",
    requiredFields: ["open", "high", "low", "close", "volume"],
  };
}

function buildMarketApiBlocksFromMappings(mappings: ApiHistoricalDataMapping[]) {
  return mappings
    .map((mapping) => parseMarketApiBlockId(mapping.apiId))
    .filter((form): form is MarketDownloadForm => Boolean(form))
    .map(buildMarketApiBlock);
}

function downloadTextFile(fileName: string, text: string, mimeType = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ApiHistoricalDataTab({ graph, onUseApiBlock }: ApiHistoricalDataTabProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [historicalDataState, setHistoricalDataState] = useState<PersistedHistoricalDataState>(() =>
    readHistoricalDataState() ?? createEmptyHistoricalDataState(),
  );
  const [selectedApiBlockId, setSelectedApiBlockId] = useState("");
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [activePendingUploadId, setActivePendingUploadId] = useState("");
  const [isNormalizing, setIsNormalizing] = useState(false);
  const [marketDownloadForm, setMarketDownloadForm] = useState<MarketDownloadForm>(createDefaultMarketDownloadForm);
  const [isDownloadingMarketData, setIsDownloadingMarketData] = useState(false);
  const [marketDownloadStatus, setMarketDownloadStatus] = useState("");
  const [dataMode, setDataMode] = useState<DataMode>("feature");

  const apiBlocks = useMemo(() => {
    const blocksById = new Map<string, ApiBlockModel>();
    buildApiBlocks(graph).forEach((block) => {
      blocksById.set(block.id, block);
    });
    buildMarketApiBlocksFromMappings(historicalDataState.mappings).forEach((block) => {
      if (!blocksById.has(block.id)) {
        blocksById.set(block.id, block);
      }
    });
    return Array.from(blocksById.values()).sort((left, right) =>
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
  }, [graph, historicalDataState.mappings]);
  const selectedApiBlock = useMemo(
    () => apiBlocks.find((block) => block.id === selectedApiBlockId) ?? apiBlocks[0] ?? null,
    [apiBlocks, selectedApiBlockId],
  );
  const datasetsById = useMemo(
    () => new Map(historicalDataState.datasets.map((dataset) => [dataset.id, dataset])),
    [historicalDataState.datasets],
  );
  const mappingsByApiId = useMemo(
    () => new Map(historicalDataState.mappings.map((mapping) => [mapping.apiId, mapping])),
    [historicalDataState.mappings],
  );
  const selectedMapping = selectedApiBlock ? mappingsByApiId.get(selectedApiBlock.id) ?? null : null;
  const selectedMappedDataset = selectedMapping ? datasetsById.get(selectedMapping.datasetId) ?? null : null;
  const selectedDataset = datasetsById.get(selectedDatasetId) ?? selectedMappedDataset ?? historicalDataState.datasets[0] ?? null;
  const activeDataset = selectedDataset ?? selectedMappedDataset;
  const activePendingUpload = pendingUploads.find((upload) => upload.id === activePendingUploadId) ?? pendingUploads[0] ?? null;
  const mappedApiBlockIds = new Set(apiBlocks.map((block) => block.id));
  const visibleMappings = historicalDataState.mappings.filter((mapping) => mappedApiBlockIds.has(mapping.apiId));
  const filteredApiBlocks = apiBlocks.filter((block) => {
    const mapping = mappingsByApiId.get(block.id);
    const dataset = mapping ? datasetsById.get(mapping.datasetId) : null;
    const haystack = `${block.name} ${block.address} ${block.method} ${block.kind} ${dataset?.fileName ?? ""} ${dataset?.symbols.join(" ") ?? ""}`.toLowerCase();
    return haystack.includes(searchQuery.trim().toLowerCase());
  });
  const persistHistoricalDataState = useCallback((buildNext: (current: PersistedHistoricalDataState) => PersistedHistoricalDataState) => {
    setHistoricalDataState((current) => {
      const next = {
        ...buildNext(current),
        version: 1,
        savedAt: Date.now(),
      } satisfies PersistedHistoricalDataState;
      try {
        writeHistoricalDataState(next);
        return next;
      } catch (error) {
        console.warn("[historicalData] failed to persist mapping state", error);
        return current;
      }
    });
  }, []);

  const selectApiBlock = (apiBlockId: string) => {
    setSelectedApiBlockId(apiBlockId);
    const mapping = mappingsByApiId.get(apiBlockId);
    if (mapping) {
      setSelectedDatasetId(mapping.datasetId);
    }
  };

  const handleDatasetFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length === 0) return;

    setStatusMessage("");
    void Promise.all(
      files.map(async (file) => {
        const text = await file.text();
        return {
          id: createId("pending-upload"),
          file,
          fileName: file.name,
          byteSize: byteSizeForText(file, text),
          rawText: text,
          rawPreviewText: createRawPreviewText(text),
        } satisfies PendingUpload;
      }),
    )
      .then((uploads) => {
        setPendingUploads((current) => [...current, ...uploads]);
        setActivePendingUploadId((current) => current || uploads[0]?.id || "");
        setStatusMessage(`${uploads.length} file${uploads.length === 1 ? "" : "s"} uploaded. Review the samples, then run AI Normalize.`);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "File upload failed.";
        setStatusMessage(message);
      });
  }, []);

  const handleAiNormalizeDataset = useCallback(() => {
    if (pendingUploads.length === 0) {
      setStatusMessage("Upload one or more datasets first.");
      return;
    }

    setIsNormalizing(true);
    window.setTimeout(() => {
      try {
        const normalizedUploads = pendingUploads.map((upload) => ({
          upload,
          normalized: normalizeBacktestDataset(upload.fileName, upload.rawText),
        }));
        const dataset = toCombinedHistoricalDataset(normalizedUploads);

        persistHistoricalDataState((current) => {
          const datasets = [
            dataset,
            ...current.datasets.filter((item) => item.id !== dataset.id),
          ].slice(0, MAX_DATASET_COUNT);
          const mappings = selectedApiBlock && dataset.errors.length === 0
            ? upsertApiMapping(current, selectedApiBlock, dataset.id)
            : current.mappings;
          return {
            ...current,
            datasets,
            mappings,
            activeApiId: selectedApiBlock?.id ?? current.activeApiId,
          };
        });
        setSelectedDatasetId(dataset.id);
        setPendingUploads([]);
        setActivePendingUploadId("");

        if (dataset.errors.length > 0) {
          setStatusMessage(`${dataset.fileName}: ${dataset.errors[0]}`);
          return;
        }

        setStatusMessage(
          selectedApiBlock
            ? `AI normalized and linked ${normalizedUploads.length} file${normalizedUploads.length === 1 ? "" : "s"} to ${selectedApiBlock.name}.`
            : `AI normalized ${normalizedUploads.length} file${normalizedUploads.length === 1 ? "" : "s"}.`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "AI normalization failed.";
        setStatusMessage(message);
      } finally {
        setIsNormalizing(false);
      }
    }, 200);
  }, [pendingUploads, persistHistoricalDataState, selectedApiBlock]);

  const handleSaveMapping = () => {
    if (!selectedApiBlock || !selectedDataset) {
      setStatusMessage("Select an API block and dataset.");
      return;
    }
    if (selectedDataset.errors.length > 0) {
      setStatusMessage("Fix dataset parse errors before mapping.");
      return;
    }

    persistHistoricalDataState((current) => ({
      ...current,
      mappings: upsertApiMapping(current, selectedApiBlock, selectedDataset.id),
      activeApiId: selectedApiBlock.id,
    }));
    setStatusMessage(`${selectedDataset.fileName} -> ${selectedApiBlock.name}`);
  };

  const handleUseLibraryDataset = (datasetId: string) => {
    const dataset = datasetsById.get(datasetId);
    if (!dataset) {
      setStatusMessage("Select a saved dataset from the library.");
      return;
    }

    setSelectedDatasetId(dataset.id);
    setPendingUploads([]);
    setActivePendingUploadId("");

    if (!selectedApiBlock) {
      setStatusMessage(`${dataset.fileName} selected. Select a feature/API block to link it.`);
      return;
    }
    if (dataset.errors.length > 0) {
      setStatusMessage(`${dataset.fileName} has parse errors and cannot be linked yet.`);
      return;
    }

    persistHistoricalDataState((current) => ({
      ...current,
      mappings: upsertApiMapping(current, selectedApiBlock, dataset.id),
      activeApiId: selectedApiBlock.id,
    }));
    setStatusMessage(`${dataset.fileName} selected from Dataset Library and linked to ${selectedApiBlock.name}.`);
  };

  const handleRemoveMapping = (apiBlockId: string) => {
    persistHistoricalDataState((current) => ({
      ...current,
      mappings: current.mappings.filter((mapping) => mapping.apiId !== apiBlockId),
    }));
    setStatusMessage("Mapping removed.");
  };

  const handleDeleteDataset = (datasetId: string) => {
    persistHistoricalDataState((current) => ({
      ...current,
      datasets: current.datasets.filter((dataset) => dataset.id !== datasetId),
      mappings: current.mappings.filter((mapping) => mapping.datasetId !== datasetId),
    }));
    setSelectedDatasetId("");
    setStatusMessage("Dataset removed.");
  };

  const handleUseApiBlock = () => {
    if (!selectedApiBlock) {
      setStatusMessage("Select an API block first.");
      return;
    }
    onUseApiBlock?.({ apiBlock: selectedApiBlock, dataset: selectedMappedDataset ?? selectedDataset });
  };

  const updateMarketDownloadForm = (patch: Partial<MarketDownloadForm>) => {
    setMarketDownloadForm((current) => ({ ...current, ...patch }));
  };

  const handleDownloadMarketData = useCallback(async () => {
    setIsDownloadingMarketData(true);
    setMarketDownloadStatus("Requesting historical candles from Binance.");
    try {
      const normalizedForm = {
        ...marketDownloadForm,
        symbol: normalizeMarketSymbol(marketDownloadForm.symbol),
      };
      const rows = await fetchBinanceKlines(normalizedForm);
      if (rows.length === 0) {
        setMarketDownloadStatus("No candle rows were returned for that market/date range.");
        return;
      }

      const csv = binanceKlinesToCsv(normalizedForm, rows);
      const fileName = [
        normalizedForm.exchange,
        normalizedForm.venue,
        normalizedForm.symbol,
        normalizedForm.interval,
        normalizedForm.startDate,
        normalizedForm.endDate,
      ].join("_") + ".csv";
      downloadTextFile(fileName, csv);

      const normalized = normalizeBacktestDataset(fileName, csv);
      const file = new File([csv], fileName, { type: "text/csv" });
      const dataset = {
        ...toHistoricalDataset(file, csv, normalized),
        sourceFiles: [{
          fileName,
          byteSize: byteSizeForText(file, csv),
          rowCount: normalized.rowCount,
          format: normalized.format,
        }],
      } satisfies HistoricalDataDataset;
      const apiBlock = buildMarketApiBlock(normalizedForm);
      persistHistoricalDataState((current) => ({
        ...current,
        datasets: [
          dataset,
          ...current.datasets.filter((item) => item.id !== dataset.id && item.fileName !== dataset.fileName),
        ].slice(0, MAX_DATASET_COUNT),
        mappings: normalized.errors.length === 0
          ? upsertApiMapping(current, apiBlock, dataset.id)
          : current.mappings,
        activeApiId: apiBlock.id,
      }));
      setSelectedApiBlockId(apiBlock.id);
      setSelectedDatasetId(dataset.id);
      setSearchQuery("");
      setDataMode("feature");

      if (normalized.errors.length > 0) {
        setStatusMessage(`${dataset.fileName} was downloaded but could not be normalized: ${normalized.errors[0]}`);
        setMarketDownloadStatus(`Downloaded ${formatCompactNumber(rows.length)} ${normalizedForm.interval} candles to ${fileName}, but normalization failed: ${normalized.errors[0]}`);
        return;
      }

      setStatusMessage(`${dataset.fileName} was added to Feature Data and linked to ${apiBlock.name}.`);
      setMarketDownloadStatus(`Downloaded ${formatCompactNumber(rows.length)} ${normalizedForm.interval} candles to ${fileName}. Added to Feature Data and linked to the Binance realtime kline API.`);
    } catch (error) {
      setMarketDownloadStatus(error instanceof Error ? error.message : "Market data download failed.");
    } finally {
      setIsDownloadingMarketData(false);
    }
  }, [marketDownloadForm, persistHistoricalDataState]);

  return (
    <div className="h-full overflow-auto bg-slate-50 p-5 dark:bg-slate-950">
      <div className="mx-auto flex min-h-full max-w-[1600px] flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
          <div className="min-w-0">
            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-sky-600 dark:text-sky-300">
              Data
            </div>
            <div className="mt-1 truncate text-lg font-black text-slate-950 dark:text-slate-100">
              Feature datasets and market history
            </div>
            <div className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
              {apiBlocks.length} feature/API blocks · {visibleMappings.length} mappings · {historicalDataState.datasets.length} datasets
            </div>
          </div>
          {dataMode === "feature" ? (
            <div className="flex min-w-[280px] max-w-md flex-1 items-center gap-2 border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
                placeholder="Feature block, address, dataset, symbol"
              />
            </div>
          ) : null}
        </header>

        <section className="inline-grid max-w-xl grid-cols-2 border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-950">
          <button
            type="button"
            onClick={() => setDataMode("feature")}
            className={cn(
              "inline-flex h-10 items-center justify-center gap-2 px-3 text-sm font-black transition-colors",
              dataMode === "feature"
                ? "bg-sky-600 text-white"
                : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900",
            )}
          >
            <Database className="h-4 w-4" />
            Feature Data
          </button>
          <button
            type="button"
            onClick={() => setDataMode("market")}
            className={cn(
              "inline-flex h-10 items-center justify-center gap-2 px-3 text-sm font-black transition-colors",
              dataMode === "market"
                ? "bg-emerald-600 text-white"
                : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900",
            )}
          >
            <CandlestickChart className="h-4 w-4" />
            Market Historical
          </button>
        </section>

        <section className="grid min-h-[520px] grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_420px]">
          {dataMode === "feature" ? (
          <div className="min-w-0 border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
            <div className="grid grid-cols-[minmax(190px,0.9fr)_minmax(240px,1.25fr)_minmax(220px,1fr)_130px] border-b border-slate-200 bg-slate-100 text-[11px] font-black uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              <div className="px-3 py-2">Feature/API block</div>
              <div className="px-3 py-2">Data source address</div>
              <div className="px-3 py-2">Feature dataset</div>
              <div className="px-3 py-2 text-right">Missing</div>
            </div>

            {filteredApiBlocks.length > 0 ? (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredApiBlocks.map((block) => {
                  const mapping = mappingsByApiId.get(block.id);
                  const dataset = mapping ? datasetsById.get(mapping.datasetId) : null;
                  const isSelected = selectedApiBlock?.id === block.id;
                  const missingCount = datasetMissingCount(dataset);
                  return (
                    <button
                      key={block.id}
                      type="button"
                      onClick={() => selectApiBlock(block.id)}
                      className={cn(
                        "grid w-full grid-cols-[minmax(190px,0.9fr)_minmax(240px,1.25fr)_minmax(220px,1fr)_130px] text-left transition-colors",
                        isSelected
                          ? "bg-sky-50 dark:bg-sky-400/10"
                          : "bg-white hover:bg-slate-50 dark:bg-slate-950 dark:hover:bg-slate-900",
                      )}
                    >
                      <div className="min-w-0 px-3 py-3">
                        <div className="truncate text-sm font-black text-slate-900 dark:text-slate-100">{block.name}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <span className="border border-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-500 dark:border-slate-700 dark:text-slate-400">
                            {block.method}
                          </span>
                          <span className="border border-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 dark:border-slate-700 dark:text-slate-400">
                            {block.kind}
                          </span>
                        </div>
                      </div>
                      <div className="min-w-0 px-3 py-3">
                        <div className="truncate font-mono text-xs font-semibold text-slate-700 dark:text-slate-300" title={block.address}>
                          {block.address || "address not set"}
                        </div>
                        <div className="mt-1 truncate text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                          {block.requiredFields.length > 0 ? block.requiredFields.join(", ") : block.id}
                        </div>
                      </div>
                      <div className="min-w-0 px-3 py-3">
                        {dataset ? (
                          <>
                            <div className="truncate text-xs font-black text-slate-800 dark:text-slate-200">{dataset.fileName}</div>
                            <div className="mt-1 truncate text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                              {formatBytes(dataset.byteSize)} · {formatDatasetDates(dataset)}
                            </div>
                          </>
                        ) : (
                          <div className="flex h-full items-center text-xs font-semibold text-slate-400">
                            No mapped dataset
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-end gap-2 px-3 py-3">
                        {dataset ? (
                          <span className={cn(
                            "inline-flex min-w-20 items-center justify-center gap-1 border px-2 py-1 text-[10px] font-black",
                            missingCount > 0
                              ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200"
                              : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200",
                          )}>
                            {missingCount > 0 ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                            {missingCount}
                          </span>
                        ) : (
                          <span className="text-[10px] font-black text-slate-400">n/a</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex min-h-[360px] items-center justify-center px-6 text-center text-sm font-semibold text-slate-500 dark:text-slate-400">
                No feature/API blocks found.
              </div>
            )}
          </div>
          ) : null}

          <aside className={cn("min-w-0 space-y-4", dataMode === "market" && "xl:col-span-2")}>
            {dataMode === "market" ? (
            <section className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
              <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <div className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-slate-100">
                  <CandlestickChart className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
                  Market Historical Data
                </div>
                <div className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Download OHLCV candles by exchange, market, and interval.
                </div>
              </div>

              <div className="space-y-3 p-4">
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Exchange
                    </span>
                    <select
                      value={marketDownloadForm.exchange}
                      onChange={(event) => updateMarketDownloadForm({ exchange: event.target.value as MarketDataExchange })}
                      className="h-9 w-full border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-800 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      <option value="binance">Binance</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Market
                    </span>
                    <select
                      value={marketDownloadForm.venue}
                      onChange={(event) => updateMarketDownloadForm({ venue: event.target.value as MarketDataVenue })}
                      className="h-9 w-full border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-800 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      <option value="spot">Spot</option>
                      <option value="usdm-futures">USD-M Futures</option>
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-[1fr_110px] gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Symbol
                    </span>
                    <input
                      value={marketDownloadForm.symbol}
                      onChange={(event) => updateMarketDownloadForm({ symbol: event.target.value })}
                      className="h-9 w-full border border-slate-200 bg-white px-2 text-sm font-semibold uppercase text-slate-800 outline-none placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      placeholder="BTCUSDT"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Candle
                    </span>
                    <select
                      value={marketDownloadForm.interval}
                      onChange={(event) => updateMarketDownloadForm({ interval: event.target.value as MarketDownloadForm["interval"] })}
                      className="h-9 w-full border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-800 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      {MARKET_DATA_INTERVALS.map((interval) => (
                        <option key={interval} value={interval}>{interval}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Start
                    </span>
                    <input
                      type="date"
                      value={marketDownloadForm.startDate}
                      onChange={(event) => updateMarketDownloadForm({ startDate: event.target.value })}
                      className="h-9 w-full border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-800 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      End
                    </span>
                    <input
                      type="date"
                      value={marketDownloadForm.endDate}
                      onChange={(event) => updateMarketDownloadForm({ endDate: event.target.value })}
                      className="h-9 w-full border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-800 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </label>
                </div>

                <button
                  type="button"
                  onClick={() => void handleDownloadMarketData()}
                  disabled={isDownloadingMarketData}
                  className="inline-flex h-9 w-full items-center justify-center gap-2 bg-emerald-600 text-sm font-black text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  {isDownloadingMarketData ? "Downloading Candles" : "Download Candle CSV"}
                </button>

                {marketDownloadStatus ? (
                  <div className="border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                    {marketDownloadStatus}
                  </div>
                ) : null}
              </div>
            </section>
            ) : null}

            {dataMode === "feature" ? (
            <>
            <section className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
              <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <div className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-slate-100">
                  <Link2 className="h-4 w-4 text-sky-600 dark:text-sky-300" />
                  Feature Data Mapping
                </div>
                <div className="mt-1 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
                  {selectedApiBlock?.name ?? "No API block selected"}
                </div>
              </div>

              <div className="space-y-3 p-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".csv,.json,text/csv,application/json"
                  className="hidden"
                  onChange={handleDatasetFileChange}
                />

                <div className="border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] font-black uppercase tracking-wide text-slate-600 dark:text-slate-300">
                        Choose from Dataset Library
                      </div>
                      <div className="mt-0.5 text-[10px] font-semibold leading-4 text-slate-500 dark:text-slate-400">
                        Reuse a dataset that was already uploaded or downloaded.
                      </div>
                    </div>
                    <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-black text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                      {historicalDataState.datasets.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <select
                      value={selectedDataset?.id ?? ""}
                      onChange={(event) => setSelectedDatasetId(event.target.value)}
                      disabled={historicalDataState.datasets.length === 0}
                      className="h-9 min-w-0 border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-800 outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    >
                      {historicalDataState.datasets.length === 0 ? (
                        <option value="">No saved datasets</option>
                      ) : null}
                      {historicalDataState.datasets.map((dataset) => (
                        <option key={dataset.id} value={dataset.id}>
                          {dataset.fileName} · {formatBytes(dataset.byteSize)} · {formatDatasetDates(dataset)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => selectedDataset && handleUseLibraryDataset(selectedDataset.id)}
                      disabled={!selectedApiBlock || !selectedDataset}
                      className="inline-flex h-9 items-center justify-center gap-2 border border-sky-200 bg-white px-3 text-xs font-black text-sky-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-sky-400/30 dark:bg-slate-950 dark:text-sky-200 dark:hover:bg-sky-400/10"
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      Link
                    </button>
                  </div>
                  {selectedDataset ? (
                    <div className="mt-2 truncate text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                      Selected: {selectedDataset.fileName} · {formatBytes(selectedDataset.byteSize)} · {formatDatasetDates(selectedDataset)}
                    </div>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!selectedApiBlock}
                  className="inline-flex h-9 w-full items-center justify-center gap-2 border border-slate-200 bg-white text-sm font-black text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <FileUp className="h-4 w-4" />
                  Upload New Feature Datasets
                </button>

                <button
                  type="button"
                  onClick={handleAiNormalizeDataset}
                  disabled={pendingUploads.length === 0 || isNormalizing}
                  className="inline-flex h-9 w-full items-center justify-center gap-2 border border-emerald-200 bg-emerald-50 text-sm font-black text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200 dark:hover:bg-emerald-400/20"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {isNormalizing ? "AI Normalizing" : `AI Normalize Feature Data${pendingUploads.length > 1 ? ` (${pendingUploads.length})` : ""}`}
                </button>

                {pendingUploads.length > 0 ? (
                  <div className="space-y-1 border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">
                    <div className="flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      <span>Pending files</span>
                      <button
                        type="button"
                        onClick={() => {
                          setPendingUploads([]);
                          setActivePendingUploadId("");
                        }}
                        className="text-rose-500 hover:text-rose-600"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="max-h-28 space-y-1 overflow-auto">
                      {pendingUploads.map((upload) => (
                        <button
                          key={upload.id}
                          type="button"
                          onClick={() => setActivePendingUploadId(upload.id)}
                          className={cn(
                            "flex w-full min-w-0 items-center justify-between gap-2 border px-2 py-1.5 text-left text-[11px] font-semibold",
                            activePendingUpload?.id === upload.id
                              ? "border-sky-300 bg-white text-sky-700 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-200"
                              : "border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300",
                          )}
                        >
                          <span className="truncate">{upload.fileName}</span>
                          <span className="shrink-0 text-[10px] text-slate-400">{formatBytes(upload.byteSize)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <label className="block">
                  <span className="mb-1 block text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Feature Dataset
                  </span>
                  <select
                    value={selectedDataset?.id ?? ""}
                    onChange={(event) => setSelectedDatasetId(event.target.value)}
                    className="h-9 w-full border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-800 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    {historicalDataState.datasets.length === 0 ? (
                      <option value="">No datasets</option>
                    ) : null}
                    {historicalDataState.datasets.map((dataset) => (
                      <option key={dataset.id} value={dataset.id}>
                        {dataset.fileName} · {formatBytes(dataset.byteSize)}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <button
                    type="button"
                    onClick={handleSaveMapping}
                    disabled={!selectedApiBlock || !selectedDataset}
                    className="inline-flex h-9 items-center justify-center gap-2 border border-sky-200 bg-sky-50 text-sm font-black text-sky-700 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-200 dark:hover:bg-sky-400/20"
                  >
                    <Link2 className="h-4 w-4" />
                    Save Feature Mapping
                  </button>
                  <button
                    type="button"
                    onClick={() => selectedApiBlock && handleRemoveMapping(selectedApiBlock.id)}
                    disabled={!selectedMapping}
                    title="Remove mapping"
                    className="inline-flex h-9 w-10 items-center justify-center border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-rose-300"
                  >
                    <Unlink className="h-4 w-4" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleUseApiBlock}
                  disabled={!selectedApiBlock}
                  className="inline-flex h-9 w-full items-center justify-center gap-2 border border-slate-200 bg-white text-sm font-black text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Database className="h-4 w-4" />
                  Use Data Block in Advanced View
                </button>

                {statusMessage ? (
                  <div className="border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                    {statusMessage}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
              <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <div className="text-sm font-black text-slate-900 dark:text-slate-100">
                  Data Example
                </div>
                <div className="mt-1 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
                  {activePendingUpload
                    ? `${activePendingUpload.fileName} · ${formatBytes(activePendingUpload.byteSize)}`
                    : activeDataset
                      ? `${activeDataset.fileName} · normalized preview`
                      : "Upload a dataset to inspect the sample"}
                </div>
              </div>

              <div className="space-y-3 p-4">
                <div>
                  <div className="mb-1 text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Raw Sample
                  </div>
                  <pre className="max-h-44 overflow-auto border border-slate-200 bg-slate-950 p-3 text-[11px] leading-5 text-slate-100 dark:border-slate-800">
                    {activePendingUpload?.rawPreviewText || activeDataset?.rawPreviewText || "No raw sample available."}
                  </pre>
                </div>

                <div>
                  <div className="mb-1 text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Normalized Sample
                  </div>
                  {activeDataset?.normalizedPreviewRows?.length ? (
                    <div className="max-h-48 overflow-auto border border-slate-200 dark:border-slate-800">
                      <table className="min-w-full text-left text-[11px]">
                        <thead className="sticky top-0 bg-slate-100 text-[10px] font-black uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                          <tr>
                            {Object.keys(activeDataset.normalizedPreviewRows[0] ?? {}).map((key) => (
                              <th key={key} className="px-2 py-1.5">{key}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                          {activeDataset.normalizedPreviewRows.map((row, index) => (
                            <tr key={index} className="text-slate-700 dark:text-slate-200">
                              {Object.keys(activeDataset.normalizedPreviewRows[0] ?? {}).map((key) => (
                                <td key={key} className="whitespace-nowrap px-2 py-1.5 font-mono">
                                  {String(row[key] ?? "")}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="border border-dashed border-slate-200 px-3 py-5 text-center text-xs font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      Run AI Normalize to generate normalized rows.
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
              <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <div className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-slate-100">
                  <Database className="h-4 w-4 text-sky-600 dark:text-sky-300" />
                  Dataset Detail
                </div>
              </div>

              {activeDataset ? (
                <div className="space-y-3 p-4">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-slate-900 dark:text-slate-100">{activeDataset.fileName}</div>
                    <div className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                      {activeDataset.format.toUpperCase()} · {formatBytes(activeDataset.byteSize)} · {formatCompactNumber(activeDataset.rowCount)} rows
                    </div>
                    <div className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                      {formatDatasetDates(activeDataset)} · {activeDataset.intervalLabel}
                    </div>
                    {activeDataset.sourceFiles && activeDataset.sourceFiles.length > 1 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {activeDataset.sourceFiles.slice(0, 6).map((source) => (
                          <span
                            key={`${source.fileName}-${source.byteSize}`}
                            className="border border-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 dark:border-slate-700 dark:text-slate-400"
                            title={`${source.fileName} · ${formatBytes(source.byteSize)} · ${formatCompactNumber(source.rowCount)} rows`}
                          >
                            {source.fileName}
                          </span>
                        ))}
                        {activeDataset.sourceFiles.length > 6 ? (
                          <span className="border border-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 dark:border-slate-700 dark:text-slate-400">
                            +{activeDataset.sourceFiles.length - 6}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="border border-slate-200 px-2 py-2 dark:border-slate-800">
                      <div className="text-[9px] font-black uppercase text-slate-400">Missing</div>
                      <div className={cn("text-sm font-black", datasetMissingCount(activeDataset) > 0 ? "text-amber-600 dark:text-amber-300" : "text-emerald-600 dark:text-emerald-300")}>
                        {datasetMissingCount(activeDataset)}
                      </div>
                    </div>
                    <div className="border border-slate-200 px-2 py-2 dark:border-slate-800">
                      <div className="text-[9px] font-black uppercase text-slate-400">Symbols</div>
                      <div className="truncate text-sm font-black text-slate-800 dark:text-slate-200">
                        {activeDataset.symbols.slice(0, 2).join(", ") || "n/a"}
                      </div>
                    </div>
                    <div className="border border-slate-200 px-2 py-2 dark:border-slate-800">
                      <div className="text-[9px] font-black uppercase text-slate-400">Stored</div>
                      <div className="truncate text-sm font-black text-slate-800 dark:text-slate-200">
                        {activeDataset.storageMode}
                      </div>
                    </div>
                  </div>

                  {datasetMissingRanges(activeDataset).length > 0 ? (
                    <div className="max-h-52 overflow-auto border border-amber-200 bg-amber-50 dark:border-amber-400/30 dark:bg-amber-400/10">
                      <div className="grid grid-cols-[0.8fr_1fr_1fr_70px] border-b border-amber-200 px-2 py-1.5 text-[10px] font-black uppercase text-amber-700 dark:border-amber-400/30 dark:text-amber-200">
                        <div>Symbol</div>
                        <div>From</div>
                        <div>To</div>
                        <div className="text-right">Count</div>
                      </div>
                      {datasetMissingRanges(activeDataset).map((range, index) => (
                        <div
                          key={`${range.symbol}-${range.startDate}-${index}`}
                          className="grid grid-cols-[0.8fr_1fr_1fr_70px] px-2 py-1.5 text-xs font-semibold text-amber-800 dark:text-amber-100"
                        >
                          <div className="truncate">{range.symbol}</div>
                          <div className="truncate">{range.startDate}</div>
                          <div className="truncate">{range.endDate}</div>
                          <div className="text-right">{range.count}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200">
                      No missing dates detected.
                    </div>
                  )}

                  {datasetMissingPreview(activeDataset).length > 0 ? (
                    <div className="flex max-h-24 flex-wrap gap-1 overflow-auto">
                      {datasetMissingPreview(activeDataset).slice(0, 48).map((item, index) => (
                        <span
                          key={`${item.symbol}-${item.date}-${index}`}
                          className="border border-amber-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:border-amber-400/30 dark:bg-slate-950 dark:text-amber-200"
                        >
                          {item.symbol} {item.date}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="px-4 py-10 text-center text-sm font-semibold text-slate-500 dark:text-slate-400">
                  No dataset selected.
                </div>
              )}
            </section>

            <section className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
              <div className="border-b border-slate-200 px-4 py-3 text-sm font-black text-slate-900 dark:border-slate-800 dark:text-slate-100">
                Dataset Library
              </div>
              <div className="max-h-72 divide-y divide-slate-200 overflow-auto dark:divide-slate-800">
                {historicalDataState.datasets.length > 0 ? (
                  historicalDataState.datasets.map((dataset) => (
                    <div key={dataset.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setSelectedDatasetId(dataset.id)}
                        className="min-w-0 text-left"
                      >
                        <div className="truncate text-xs font-black text-slate-900 dark:text-slate-100">{dataset.fileName}</div>
                        <div className="mt-1 truncate text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                          {formatBytes(dataset.byteSize)} · {formatDatasetDates(dataset)} · uploaded {formatSavedAt(dataset.uploadedAt)}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUseLibraryDataset(dataset.id)}
                        disabled={!selectedApiBlock || dataset.errors.length > 0}
                        title={selectedApiBlock ? `Link to ${selectedApiBlock.name}` : "Select an API block first"}
                        className="inline-flex h-8 items-center justify-center border border-sky-200 px-2 text-[10px] font-black text-sky-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-sky-400/30 dark:text-sky-200 dark:hover:bg-sky-400/10"
                      >
                        Link
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteDataset(dataset.id)}
                        title="Delete dataset"
                        className="inline-flex h-8 w-8 items-center justify-center text-slate-400 hover:bg-slate-50 hover:text-rose-600 dark:hover:bg-slate-900 dark:hover:text-rose-300"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="px-4 py-8 text-center text-sm font-semibold text-slate-500 dark:text-slate-400">
                    No datasets saved.
                  </div>
                )}
              </div>
            </section>
            </>
            ) : null}
          </aside>
        </section>
      </div>
    </div>
  );
}
