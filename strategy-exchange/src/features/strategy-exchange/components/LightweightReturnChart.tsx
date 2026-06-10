import { useEffect, useMemo, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, LineData, UTCTimestamp } from "lightweight-charts";

type LightweightReturnChartProps = {
  series: number[];
  className?: string;
  height?: number;
  compact?: boolean;
  mode?: "return" | "value" | "percent";
  positive?: boolean;
  baseValue?: number;
  lineColor?: string;
  backgroundColor?: string;
  fill?: boolean;
  timeStepSeconds?: number;
};

const baseTimestamp = 1_735_689_600;

function getNumericSeries(series: number[]) {
  return series.filter((value) => Number.isFinite(value));
}

function toReturnSeries(series: number[], baseValue?: number) {
  const numericSeries = getNumericSeries(series);
  const fallbackBase = numericSeries[0] || 1;
  const resolvedBase = baseValue && Number.isFinite(baseValue) ? baseValue : fallbackBase;

  return numericSeries.map((value) =>
    resolvedBase === 0 ? 0 : Number(((value / Math.abs(resolvedBase)) * 100).toFixed(4)),
  );
}

function toChartData(series: number[], timeStepSeconds = 86_400) {
  return series.map((value, index): LineData<UTCTimestamp> => ({
    time: (baseTimestamp + index * timeStepSeconds) as UTCTimestamp,
    value,
  }));
}

function formatAxisValue(mode: "return" | "value" | "percent", value: number) {
  if (mode === "return" || mode === "percent") return `${value.toFixed(2)}%`;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function readThemeColor(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function resolveCssColor(value: string, fallback: string) {
  const cssVarMatch = value.match(/^var\((--[^)]+)\)$/);
  if (!cssVarMatch) return value || fallback;
  return readThemeColor(cssVarMatch[1], fallback);
}

export function LightweightReturnChart({
  series,
  className = "",
  height = 160,
  compact = false,
  mode = "return",
  positive,
  baseValue,
  lineColor,
  backgroundColor = "transparent",
  fill = false,
  timeStepSeconds,
}: LightweightReturnChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const [themeRevision, setThemeRevision] = useState(0);
  const lineColorRef = useRef(lineColor);
  const modeRef = useRef(mode);
  const chartData = useMemo(() => {
    const values = mode === "return" ? toReturnSeries(series, baseValue) : getNumericSeries(series);
    return toChartData(values, timeStepSeconds);
  }, [baseValue, mode, series, timeStepSeconds]);
  const resolvedPositive =
    positive ?? ((chartData[chartData.length - 1]?.value ?? 0) >= (chartData[0]?.value ?? 0));

  useEffect(() => {
    const observer = new MutationObserver(() => setThemeRevision((revision) => revision + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    lineColorRef.current = lineColor;
    modeRef.current = mode;
  }, [lineColor, mode]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || chartData.length === 0) return;

    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;

    import("lightweight-charts").then(({ ColorType, LineSeries, createChart }) => {
      if (disposed || !containerRef.current) return;
      const resolvedHeight = fill ? containerRef.current.clientHeight || height : height;
      const resolvedBackground = resolveCssColor(backgroundColor, "transparent");
      const textColor = readThemeColor("--muted", "#9aa3ad");
      const gridColor = readThemeColor("--chart-grid", "rgba(154, 163, 173, 0.14)");
      const crosshairColor = readThemeColor("--chart-grid-strong", "rgba(154, 163, 173, 0.44)");

      const chart = createChart(containerRef.current, {
        width: containerRef.current.clientWidth || 320,
        height: resolvedHeight,
        autoSize: true,
        layout: {
          background: { type: ColorType.Solid, color: resolvedBackground },
          textColor: compact ? "transparent" : textColor,
          fontSize: compact ? 10 : 11,
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: compact ? "transparent" : gridColor },
          horzLines: { color: compact ? "transparent" : gridColor },
        },
        rightPriceScale: {
          visible: !compact,
          borderVisible: false,
          scaleMargins: { top: 0.18, bottom: 0.18 },
        },
        timeScale: {
          visible: !compact,
          borderVisible: false,
          timeVisible: false,
          secondsVisible: false,
        },
        crosshair: {
          vertLine: { visible: !compact, color: crosshairColor, labelVisible: !compact },
          horzLine: { visible: !compact, color: crosshairColor, labelVisible: !compact },
        },
        handleScale: !compact,
        handleScroll: !compact,
        localization: {
          priceFormatter: (value: number) => formatAxisValue(modeRef.current, value),
        },
      });

      const lineSeries = chart.addSeries(LineSeries, {
        color: lineColorRef.current ?? (resolvedPositive ? "#0ecb81" : "#f6465d"),
        lineWidth: compact ? 2 : 3,
        priceLineVisible: false,
        lastValueVisible: !compact,
      });

      lineSeries.setData(chartData);
      chart.timeScale().fitContent();

      resizeObserver = new ResizeObserver(() => {
        chart.timeScale().fitContent();
      });
      resizeObserver.observe(containerRef.current);

      chartRef.current = chart;
      seriesRef.current = lineSeries;
    });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      seriesRef.current = null;
      chartRef.current?.remove();
      chartRef.current = null;
    };
  }, [backgroundColor, compact, fill, height, resolvedPositive, themeRevision]);

  useEffect(() => {
    const lineSeries = seriesRef.current;
    const chart = chartRef.current;
    if (!lineSeries || !chart || chartData.length === 0) return;

    lineSeries.setData(chartData);
    lineSeries.applyOptions({
      color: lineColor ?? (resolvedPositive ? "#0ecb81" : "#f6465d"),
      lastValueVisible: !compact,
      lineWidth: compact ? 2 : 3,
    });
  }, [chartData, compact, lineColor, resolvedPositive]);

  return <div ref={containerRef} className={className || undefined} style={{ height: fill ? "100%" : height }} />;
}
