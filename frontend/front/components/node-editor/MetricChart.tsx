"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChartComparisonValue, IndicatorCondition } from "./types";
import type { LineData, UTCTimestamp, WhitespaceData } from "lightweight-charts";

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
  return series.map((point) =>
    evaluateCondition(point.value, condition)
      ? point
      : ({ time: point.time } as MetricWhitespacePoint),
  );
}

type MetricChartProps = {
  series: MetricPoint[];
  compareSeries?: Array<{
    label: string;
    series: MetricPoint[];
    color: string;
  }>;
  condition?: IndicatorCondition;
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
};

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

function formatMetricTime(value?: number) {
  if (!Number.isFinite(value)) return "";
  return new Date(Number(value) * 1000).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function MetricChart({
  series,
  compareSeries = [],
  condition,
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
}: MetricChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isDarkMode = useIsDarkMode();

  const activeSeries = useMemo(
    () => buildConditionSeries(series, condition),
    [condition, series],
  );
  const stats = useMemo(() => {
    const values = series.map((point) => point.value).filter((value) => Number.isFinite(value));
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
      time: series[series.length - 1]?.time as number | undefined,
    };
  }, [series]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || series.length === 0) return;

    let disposed = false;
    let cleanup: (() => void) | null = null;

    import("lightweight-charts").then(({ ColorType, HistogramSeries, LineSeries, LineStyle, createChart }) => {
      if (disposed || !containerRef.current) return;
      const resolvedBackgroundColor = backgroundColor ?? (isDarkMode ? "#020617" : "#f8fafc");
      const textColor = compact ? "transparent" : isDarkMode ? "#cbd5e1" : "#475569";
      const gridColor = compact ? "transparent" : isDarkMode ? "rgba(71, 85, 105, 0.56)" : "#e2e8f0";
      const crosshairColor = isDarkMode ? "rgba(148, 163, 184, 0.72)" : "rgba(100, 116, 139, 0.68)";

      const chart = createChart(containerRef.current, {
        width: containerRef.current.clientWidth || 320,
        height,
        autoSize: true,
        layout: {
          background: { type: ColorType.Solid, color: resolvedBackgroundColor },
          textColor,
          fontSize: compact ? 10 : 11,
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: gridColor, visible: !compact },
          horzLines: { color: gridColor },
        },
        rightPriceScale: {
          visible: !compact,
          borderVisible: false,
          scaleMargins: { top: 0.18, bottom: 0.16 },
        },
        timeScale: {
          visible: !compact,
          borderVisible: false,
          timeVisible: true,
          secondsVisible: false,
        },
        crosshair: {
          vertLine: { color: crosshairColor, visible: !compact, labelVisible: !compact },
          horzLine: { color: crosshairColor, visible: !compact, labelVisible: !compact },
        },
        handleScale: false,
        handleScroll: false,
      });

      const baseSeries = chart.addSeries(LineSeries, {
        color: baseColor,
        lineWidth: compact ? 2 : 3,
        priceLineVisible: false,
        lastValueVisible: !compact,
      });
      baseSeries.setData(series);

      const highlightedSeries = chart.addSeries(LineSeries, {
        color: activeColor,
        lineWidth: compact ? 3 : 4,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      highlightedSeries.setData(activeSeries);

      compareSeries.forEach((item) => {
        const comparison = chart.addSeries(LineSeries, {
          color: item.color,
          lineWidth: compact ? 1 : 2,
          priceLineVisible: false,
          lastValueVisible: !compact,
        });
        comparison.setData(item.series);
      });

      const volumeSeries = showVolume
        ? series
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

      if (condition && Number.isFinite(condition.threshold)) {
        const thresholdSeries = chart.addSeries(LineSeries, {
          color: thresholdColor,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: !compact,
        });
        thresholdSeries.setData(
          series.map((point) => ({
            time: point.time,
            value: condition.threshold,
          })),
        );
      }

      comparisonValues
        .filter((item) => item.enabled !== false && Number.isFinite(item.value))
        .forEach((item, index) => {
          const comparisonLine = chart.addSeries(LineSeries, {
            color: item.color || CHART_COMPARISON_COLORS[index % CHART_COMPARISON_COLORS.length],
            lineWidth: compact ? 1 : 2,
            lineStyle: LineStyle.Dashed,
            priceLineVisible: false,
            lastValueVisible: !compact,
          });
          comparisonLine.setData(
            series.map((point) => ({
              time: point.time,
              value: item.value,
            })),
          );
        });

      chart.timeScale().fitContent();

      cleanup = () => chart.remove();
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [
    activeColor,
    activeSeries,
    backgroundColor,
    baseColor,
    compact,
    compareSeries,
    comparisonValues,
    condition,
    height,
    isDarkMode,
    series,
    showVolume,
    thresholdColor,
  ]);

  const changePositive = (stats.change ?? 0) >= 0;

  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-md border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950"
      style={{ minHeight: height }}
    >
      {showStats ? (
        <div className="pointer-events-none absolute left-2 right-2 top-2 z-10 flex items-start justify-between gap-3">
          <div className="min-w-0 rounded-md border border-white/70 bg-white/80 px-2 py-1 shadow-sm backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/78">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[13px] font-black text-slate-900 dark:text-slate-100">
                {formatMetricValue(stats.latest)}
              </span>
              <span className={changePositive ? "text-[10px] font-bold text-emerald-600 dark:text-emerald-300" : "text-[10px] font-bold text-rose-600 dark:text-rose-300"}>
                {changePositive ? "+" : ""}
                {formatMetricValue(stats.change)} / {changePositive ? "+" : ""}
                {stats.changePercent.toFixed(2)}%
              </span>
            </div>
            <div className="mt-0.5 flex gap-2 text-[9px] font-semibold text-slate-500 dark:text-slate-400">
              <span>H {formatMetricValue(stats.high)}</span>
              <span>L {formatMetricValue(stats.low)}</span>
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
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
