"use client";

import { useEffect, useMemo, useRef } from "react";
import type { IndicatorCondition } from "./types";
import type { LineData, UTCTimestamp, WhitespaceData } from "lightweight-charts";

export type MetricPoint = LineData<UTCTimestamp>;
type MetricWhitespacePoint = WhitespaceData<UTCTimestamp>;

const BASE_TIME = 1_706_011_200;

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
  height?: number;
  compact?: boolean;
  baseColor?: string;
  activeColor?: string;
  thresholdColor?: string;
  backgroundColor?: string;
};

export function MetricChart({
  series,
  compareSeries = [],
  condition,
  height = 180,
  compact = false,
  baseColor = "#64748b",
  activeColor = "#10b981",
  thresholdColor = "#f59e0b",
  backgroundColor = "#f8fafc",
}: MetricChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const activeSeries = useMemo(
    () => buildConditionSeries(series, condition),
    [condition, series],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || series.length === 0) return;

    let disposed = false;
    let cleanup: (() => void) | null = null;

    import("lightweight-charts").then(({ ColorType, LineSeries, LineStyle, createChart }) => {
      if (disposed || !containerRef.current) return;

      const chart = createChart(containerRef.current, {
        width: containerRef.current.clientWidth || 320,
        height,
        autoSize: true,
        layout: {
          background: { type: ColorType.Solid, color: backgroundColor },
          textColor: compact ? "transparent" : "#64748b",
          fontSize: compact ? 10 : 11,
        },
        grid: {
          vertLines: { visible: false },
          horzLines: { color: compact ? "transparent" : "#e2e8f0" },
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
          vertLine: { visible: !compact },
          horzLine: { visible: !compact },
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
    condition,
    height,
    series,
    thresholdColor,
  ]);

  return <div ref={containerRef} className="h-full w-full" style={{ minHeight: height }} />;
}
