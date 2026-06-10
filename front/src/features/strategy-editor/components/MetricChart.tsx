"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChartComparisonValue, IndicatorCondition } from "../types/editorTypes";
import type { LineData, LogicalRange, UTCTimestamp, WhitespaceData } from "lightweight-charts";

export type MetricPoint = LineData<UTCTimestamp> & { volume?: number };
type MetricWhitespacePoint = WhitespaceData<UTCTimestamp>;

const BASE_TIME = 1_706_011_200;
export const CHART_COMPARISON_COLORS = ["#f97316", "#2563eb", "#8b5cf6", "#0f766e", "#dc2626", "#f59e0b"];

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function buildMetricSeries(seed: string, length = 72, base = 100) {
  const hash = hashString(seed);
  const phase = (hash % 360) * (Math.PI / 180);
  const amplitude = 8 + (hash % 11);
  const drift = ((hash % 17) - 8) / 14;

  return Array.from({ length }, (_, index) => {
    const wave = Math.sin(index / 5 + phase) * amplitude;
    const pulse = Math.cos(index / 11 + phase / 2) * (amplitude * 0.42);
    const trend = drift * index;

    return {
      time: (BASE_TIME + index * 60) as UTCTimestamp,
      value: Number((base + wave + pulse + trend).toFixed(2)),
    };
  });
}

export function evaluateCondition(value: number, condition?: IndicatorCondition) {
  if (!condition || typeof condition.threshold !== "number") return false;

  switch (condition.operator) {
    case ">":
      return value > condition.threshold;
    case ">=":
      return value >= condition.threshold;
    case "<":
      return value < condition.threshold;
    case "<=":
      return value <= condition.threshold;
    default:
      return false;
  }
}

export function getConditionLabel(condition?: IndicatorCondition) {
  if (!condition) return "No condition";
  return condition.label || `${condition.metric || "value"} ${condition.operator} ${condition.threshold}`;
}

function readFiniteNumber(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function createChartComparisonValue(index: number, fallbackValue: number): ChartComparisonValue {
  return {
    id: `comparison-${Date.now()}-${index}`,
    label: `비교값 ${index}`,
    value: readFiniteNumber(fallbackValue, 0),
    color: CHART_COMPARISON_COLORS[index % CHART_COMPARISON_COLORS.length],
    enabled: true,
  };
}

export function normalizeChartComparisonValues(value: unknown): ChartComparisonValue[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index): ChartComparisonValue | null => {
      if (typeof item === "number" || typeof item === "string") {
        const numeric = readFiniteNumber(item, Number.NaN);
        if (!Number.isFinite(numeric)) return null;
        return {
          id: `comparison-${index}`,
          label: `비교값 ${index + 1}`,
          value: numeric,
          color: CHART_COMPARISON_COLORS[index % CHART_COMPARISON_COLORS.length],
          enabled: true,
        };
      }
      if (!item || typeof item !== "object") return null;
      const record = item as Partial<ChartComparisonValue>;
      const numeric = readFiniteNumber(record.value, Number.NaN);
      if (!Number.isFinite(numeric)) return null;
      return {
        id: typeof record.id === "string" && record.id ? record.id : `comparison-${index}`,
        label: typeof record.label === "string" ? record.label : `비교값 ${index + 1}`,
        value: numeric,
        color: typeof record.color === "string" ? record.color : CHART_COMPARISON_COLORS[index % CHART_COMPARISON_COLORS.length],
        enabled: record.enabled !== false,
      };
    })
    .filter((item): item is ChartComparisonValue => item !== null);
}

export function buildConditionSeries(series: MetricPoint[], condition?: IndicatorCondition) {
  return buildCombinedConditionSeries(series, condition ? [condition] : []);
}

function isFiniteCondition(condition: IndicatorCondition | undefined): condition is IndicatorCondition {
  return Boolean(condition && typeof condition.threshold === "number" && Number.isFinite(condition.threshold));
}

export type ConditionMergeMode = "AND" | "OR";

function satisfiesConditions(value: number, conditions: IndicatorCondition[], mode: ConditionMergeMode = "AND") {
  if (conditions.length === 0) return true;
  return mode === "OR"
    ? conditions.some((condition) => evaluateCondition(value, condition))
    : conditions.every((condition) => evaluateCondition(value, condition));
}

export function buildCombinedConditionSeries(
  series: MetricPoint[],
  conditions: IndicatorCondition[],
  mode: ConditionMergeMode = "AND",
) {
  const activeConditions = conditions.filter(isFiniteCondition);
  if (activeConditions.length === 0) return series;

  return series.map((point) =>
    satisfiesConditions(point.value, activeConditions, mode)
      ? point
      : ({ time: point.time } as MetricWhitespacePoint),
  );
}

function buildConditionSegments(
  series: MetricPoint[],
  conditions: IndicatorCondition[],
  mode: ConditionMergeMode = "AND",
) {
  const activeConditions = conditions.filter(isFiniteCondition);
  if (activeConditions.length === 0) return [series];

  const segments: MetricPoint[][] = [];
  let currentSegment: MetricPoint[] = [];

  series.forEach((point) => {
    if (satisfiesConditions(point.value, activeConditions, mode)) {
      currentSegment.push(point);
      return;
    }

    if (currentSegment.length > 0) {
      segments.push(currentSegment);
      currentSegment = [];
    }
  });

  if (currentSegment.length > 0) segments.push(currentSegment);
  return segments;
}

type MetricChartProps = {
  series: MetricPoint[];
  compareSeries?: Array<{
    label: string;
    series: MetricPoint[];
    color: string;
  }>;
  condition?: IndicatorCondition;
  conditions?: IndicatorCondition[];
  conditionMode?: ConditionMergeMode;
  comparisonValues?: ChartComparisonValue[];
  height?: number;
  compact?: boolean;
  baseColor?: string;
  activeColor?: string;
  thresholdColor?: string;
  backgroundColor?: string;
  source?: string;
  updatedAt?: string;
  showStats?: boolean;
  showVolume?: boolean;
  frameless?: boolean;
  isFocused?: boolean;
  booleanMode?: boolean;
  rangeKey?: string;
};

const visibleLogicalRangeByKey = new Map<string, LogicalRange>();

function useIsDarkMode() {
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setIsDarkMode(root.classList.contains("dark"));
    update();

    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDarkMode;
}

function formatMetricValue(value?: number) {
  if (!Number.isFinite(value)) return "-";
  const numeric = Number(value);
  if (Math.abs(numeric) >= 1000) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(numeric);
  }
  if (Math.abs(numeric) >= 1) return numeric.toFixed(2);
  return numeric.toFixed(6);
}

function formatBooleanValue(value?: number) {
  if (!Number.isFinite(value)) return "-";
  return Number(value) >= 0.5 ? "YES" : "NO";
}

function formatBooleanTickmarks(values: readonly number[]) {
  return values.map(formatBooleanValue);
}

function isBinaryChartSeries(series: MetricPoint[]) {
  const finiteValues = series.map((point) => point.value).filter((value) => Number.isFinite(value));
  if (finiteValues.length === 0) return false;
  return finiteValues.every((value) => value === 0 || value === 1);
}

function normalizeBooleanChartSeries(series: MetricPoint[]) {
  return series.map((point) => ({
    ...point,
    value: point.value >= 0.5 ? 1 : 0,
  }));
}

function buildBooleanStateSeries(series: MetricPoint[], state: 0 | 1) {
  return series.map((point) =>
    point.value === state
      ? point
      : ({ time: point.time } as MetricWhitespacePoint),
  );
}

function formatMetricTime(value?: number) {
  if (!Number.isFinite(value)) return "";
  return new Date(Number(value) * 1000).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function isUsableLogicalRange(range: LogicalRange | null | undefined): range is LogicalRange {
  return Boolean(
    range &&
      Number.isFinite(range.from) &&
      Number.isFinite(range.to) &&
      Number(range.to) > Number(range.from),
  );
}

export function MetricChart({
  series,
  compareSeries = [],
  condition,
  conditions = [],
  conditionMode = "AND",
  comparisonValues = [],
  height = 180,
  compact = false,
  baseColor = "#64748b",
  activeColor = "#10b981",
  thresholdColor = "#f59e0b",
  backgroundColor,
  source = "",
  updatedAt = "",
  showStats = !compact,
  showVolume = !compact,
  frameless = false,
  isFocused = false,
  booleanMode = false,
  rangeKey,
}: MetricChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const visibleLogicalRangeRef = useRef<LogicalRange | null>(
    rangeKey ? visibleLogicalRangeByKey.get(rangeKey) ?? null : null,
  );
  const isDarkMode = useIsDarkMode();
  const isBooleanMode = useMemo(
    () => booleanMode || isBinaryChartSeries(series),
    [booleanMode, series],
  );
  const displaySeries = useMemo(
    () => isBooleanMode ? normalizeBooleanChartSeries(series) : series,
    [isBooleanMode, series],
  );
  const displayCompareSeries = useMemo(
    () => isBooleanMode
      ? compareSeries.map((item) => ({ ...item, series: normalizeBooleanChartSeries(item.series) }))
      : compareSeries,
    [compareSeries, isBooleanMode],
  );
  const activeConditions = useMemo(
    () => {
      const merged = conditions.length > 0 ? conditions : condition ? [condition] : [];
      const seen = new Set<string>();
      return merged.filter(isFiniteCondition).filter((item) => {
        const key = `${item.operator}:${item.threshold}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
    [condition, conditions],
  );

  const activeSegments = useMemo(
    () => buildConditionSegments(displaySeries, activeConditions, conditionMode),
    [activeConditions, conditionMode, displaySeries],
  );
  const stats = useMemo(() => {
    const values = displaySeries.map((point) => point.value).filter((value) => Number.isFinite(value));
    const latest = values[values.length - 1];
    const previous = values.length > 1 ? values[values.length - 2] : undefined;
    const first = values[0];
    const change = typeof latest === "number" && Number.isFinite(latest) && typeof previous === "number" && Number.isFinite(previous)
      ? latest - previous
      : 0;
    const changePercent = Number.isFinite(latest) && Number.isFinite(first) && first !== 0
      ? ((latest - first) / first) * 100
      : 0;
    return {
      latest,
      change,
      changePercent,
      high: values.length > 0 ? Math.max(...values) : undefined,
      low: values.length > 0 ? Math.min(...values) : undefined,
      time: displaySeries[displaySeries.length - 1]?.time as number | undefined,
    };
  }, [displaySeries]);

  useEffect(() => {
    visibleLogicalRangeRef.current = rangeKey ? visibleLogicalRangeByKey.get(rangeKey) ?? null : null;
  }, [rangeKey]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || displaySeries.length === 0) return;

    let disposed = false;
    let cleanup: (() => void) | null = null;

    import("lightweight-charts").then(({ ColorType, HistogramSeries, LineSeries, LineStyle, LineType, createChart }) => {
      if (disposed || !containerRef.current) return;
      const resolvedBackgroundColor = backgroundColor ?? (isDarkMode ? "#020617" : "#f8fafc");
      const textColor = compact ? "transparent" : isDarkMode ? "#cbd5e1" : "#475569";
      const gridColor = compact ? "transparent" : isDarkMode ? "rgba(71, 85, 105, 0.56)" : "#e2e8f0";
      const crosshairColor = isDarkMode ? "rgba(148, 163, 184, 0.72)" : "rgba(100, 116, 139, 0.68)";
      const binaryBaseColor = isDarkMode ? "#5e6673" : "#94a3b8";
      const yesColor = "#0ecb81";
      const noColor = "#f6465d";
      const booleanSeriesOptions = isBooleanMode ? {
        lineType: LineType.WithSteps,
        priceFormat: {
          type: "custom" as const,
          minMove: 1,
          formatter: formatBooleanValue,
          tickmarksFormatter: formatBooleanTickmarks,
        },
        autoscaleInfoProvider: () => ({
          priceRange: {
            minValue: -0.1,
            maxValue: 1.1,
          },
          margins: {
            above: 6,
            below: 6,
          },
        }),
      } : {};

      const chart = createChart(containerRef.current, {
        width: containerRef.current.clientWidth || 320,
        height,
        autoSize: true,
        layout: {
          background: { type: ColorType.Solid, color: isBooleanMode ? "rgba(0, 0, 0, 0)" : resolvedBackgroundColor },
          textColor,
          fontSize: compact ? 10 : 11,
          attributionLogo: false,
        },
        localization: isBooleanMode ? {
          priceFormatter: formatBooleanValue,
          tickmarksPriceFormatter: formatBooleanTickmarks,
        } : undefined,
        grid: {
          vertLines: { color: gridColor, visible: !compact },
          horzLines: { color: isBooleanMode ? "transparent" : gridColor, visible: !isBooleanMode },
        },
        rightPriceScale: {
          visible: !compact && !isBooleanMode,
          borderVisible: false,
          scaleMargins: isBooleanMode ? { top: 0.24, bottom: 0.24 } : { top: 0.18, bottom: 0.16 },
        },
        timeScale: {
          visible: !compact,
          borderVisible: false,
          timeVisible: true,
          secondsVisible: false,
        },
        crosshair: {
          vertLine: { color: crosshairColor, visible: !compact, labelVisible: !compact },
          horzLine: { color: crosshairColor, visible: !compact, labelVisible: !compact && !isBooleanMode },
        },
        handleScale: !compact,
        handleScroll: !compact,
      });

      const baseSeries = chart.addSeries(LineSeries, {
        color: isBooleanMode ? binaryBaseColor : baseColor,
        lineWidth: compact ? 2 : 3,
        priceLineVisible: false,
        lastValueVisible: !compact && !isBooleanMode,
        ...booleanSeriesOptions,
      });
      baseSeries.setData(displaySeries);

      if (isBooleanMode) {
        const yesSeries = chart.addSeries(LineSeries, {
          color: yesColor,
          lineWidth: compact ? 3 : 4,
          priceLineVisible: false,
          lastValueVisible: false,
          ...booleanSeriesOptions,
        });
        yesSeries.setData(buildBooleanStateSeries(displaySeries, 1));

        const noSeries = chart.addSeries(LineSeries, {
          color: noColor,
          lineWidth: compact ? 3 : 4,
          priceLineVisible: false,
          lastValueVisible: false,
          ...booleanSeriesOptions,
        });
        noSeries.setData(buildBooleanStateSeries(displaySeries, 0));
      }

      if (activeConditions.length > 0) {
        activeSegments.forEach((segment) => {
          const focusedSeries = chart.addSeries(LineSeries, {
            color: activeColor,
            lineWidth: compact ? 3 : 4,
            priceLineVisible: false,
            lastValueVisible: false,
            ...booleanSeriesOptions,
          });
          focusedSeries.setData(segment);
        });
      }

      displayCompareSeries.forEach((item) => {
        const comparison = chart.addSeries(LineSeries, {
          color: item.color,
          lineWidth: compact ? 1 : 2,
          priceLineVisible: false,
          lastValueVisible: !compact,
          ...booleanSeriesOptions,
        });
        comparison.setData(item.series);
      });

      const volumeSeries = showVolume && !isBooleanMode
        ? displaySeries
          .filter((point) => Number.isFinite(point.volume))
          .map((point) => ({
            time: point.time,
            value: Number(point.volume),
            color: isDarkMode ? "rgba(34, 211, 238, 0.18)" : "rgba(14, 165, 233, 0.18)",
          }))
        : [];
      if (volumeSeries.length > 0) {
        const histogram = chart.addSeries(HistogramSeries, {
          priceFormat: { type: "volume" },
          priceScaleId: "",
          lastValueVisible: false,
          priceLineVisible: false,
        });
        histogram.priceScale().applyOptions({
          scaleMargins: {
            top: 0.82,
            bottom: 0,
          },
        });
        histogram.setData(volumeSeries);
      }

      activeConditions.forEach((activeCondition) => {
        const thresholdSeries = chart.addSeries(LineSeries, {
          color: thresholdColor,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: !compact,
          ...booleanSeriesOptions,
        });
        thresholdSeries.setData(
          displaySeries.map((point) => ({
            time: point.time,
            value: activeCondition.threshold,
          })),
        );
      });

      comparisonValues
        .filter((item) => item.enabled !== false && Number.isFinite(item.value))
        .forEach((item, index) => {
          const comparisonLine = chart.addSeries(LineSeries, {
            color: item.color || CHART_COMPARISON_COLORS[index % CHART_COMPARISON_COLORS.length],
            lineWidth: compact ? 1 : 2,
            lineStyle: LineStyle.Dashed,
            priceLineVisible: false,
            lastValueVisible: !compact,
            ...booleanSeriesOptions,
          });
          comparisonLine.setData(
            displaySeries.map((point) => ({
              time: point.time,
              value: item.value,
            })),
          );
        });

      const timeScale = chart.timeScale();
      const handleVisibleLogicalRangeChange = (range: LogicalRange | null) => {
        if (isUsableLogicalRange(range)) {
          const nextRange = { from: range.from, to: range.to };
          visibleLogicalRangeRef.current = nextRange;
          if (rangeKey) {
            visibleLogicalRangeByKey.set(rangeKey, nextRange);
          }
        }
      };

      timeScale.subscribeVisibleLogicalRangeChange(handleVisibleLogicalRangeChange);

      const savedCurrentRange = visibleLogicalRangeRef.current;
      if (isUsableLogicalRange(savedCurrentRange)) {
        try {
          timeScale.setVisibleLogicalRange(savedCurrentRange);
        } catch {
          timeScale.fitContent();
        }
      } else {
        timeScale.fitContent();
      }

      cleanup = () => {
        timeScale.unsubscribeVisibleLogicalRangeChange(handleVisibleLogicalRangeChange);
        chart.remove();
      };
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [
    activeColor,
    activeConditions,
    activeSegments,
    backgroundColor,
    baseColor,
    compact,
    comparisonValues,
    displayCompareSeries,
    displaySeries,
    height,
    isBooleanMode,
    isDarkMode,
    rangeKey,
    showVolume,
    thresholdColor,
  ]);

  const changePositive = (stats.change ?? 0) >= 0;

  return (
    <div
      className={[
        "relative h-full w-full overflow-hidden bg-slate-50 dark:bg-slate-950",
        frameless ? "rounded-none border-0" : "rounded-md border border-slate-200 dark:border-slate-800",
        isFocused && !frameless ? "ring-2 ring-emerald-300" : "",
      ].filter(Boolean).join(" ")}
      style={{ minHeight: height }}
    >
      {isBooleanMode ? (
        <div className="pointer-events-none absolute inset-0 z-0">
          <div className="absolute inset-x-0 top-0 h-1/2 bg-[#0ecb81]/[0.075]" />
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-[#f6465d]/[0.065]" />
          <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-[#848e9c]/45" />
          <div className="absolute left-2 top-2 rounded-sm border border-[#0ecb81]/30 bg-[#0ecb81]/10 px-1.5 py-0.5 font-mono text-[9px] font-black text-[#0ecb81]">
            YES
          </div>
          <div className="absolute bottom-2 left-2 rounded-sm border border-[#f6465d]/30 bg-[#f6465d]/10 px-1.5 py-0.5 font-mono text-[9px] font-black text-[#f6465d]">
            NO
          </div>
        </div>
      ) : null}
      {showStats ? (
        <div className="pointer-events-none absolute left-2 right-2 top-2 z-20 flex items-start justify-between gap-3">
          <div className="min-w-0 rounded-md border border-white/70 bg-white/80 px-2 py-1 shadow-sm backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/78">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[13px] font-black text-slate-900 dark:text-slate-100">
                {isBooleanMode ? formatBooleanValue(stats.latest) : formatMetricValue(stats.latest)}
              </span>
              {isBooleanMode ? null : (
                <span className={changePositive ? "text-[10px] font-bold text-emerald-600 dark:text-emerald-300" : "text-[10px] font-bold text-rose-600 dark:text-rose-300"}>
                  {changePositive ? "+" : ""}
                  {formatMetricValue(stats.change)} / {changePositive ? "+" : ""}
                  {stats.changePercent.toFixed(2)}%
                </span>
              )}
            </div>
            <div className="mt-0.5 flex gap-2 text-[9px] font-semibold text-slate-500 dark:text-slate-400">
              <span>H {isBooleanMode ? formatBooleanValue(stats.high) : formatMetricValue(stats.high)}</span>
              <span>L {isBooleanMode ? formatBooleanValue(stats.low) : formatMetricValue(stats.low)}</span>
              {stats.time ? <span>{formatMetricTime(stats.time)}</span> : null}
            </div>
          </div>
          {source ? (
            <div className="min-w-0 max-w-[46%] truncate rounded-md border border-white/70 bg-white/70 px-2 py-1 text-right text-[9px] font-bold text-slate-500 shadow-sm backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-400">
              <div className="truncate">{source}</div>
              {updatedAt ? <div className="truncate">{new Date(updatedAt).toLocaleTimeString("ko-KR")}</div> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {isBooleanMode ? (
        <div className="pointer-events-none absolute inset-y-3 right-1 z-20 flex flex-col justify-between text-right font-mono text-[9px] font-black uppercase">
          <span className="text-[#0ecb81]">YES</span>
          <span className="text-[#f6465d]">NO</span>
        </div>
      ) : null}
      <div ref={containerRef} className="relative z-10 h-full w-full" />
    </div>
  );
}
