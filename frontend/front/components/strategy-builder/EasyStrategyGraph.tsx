"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BarChart3,
  CheckCircle2,
  Code2,
  Crosshair,
  PlayCircle,
  Rocket,
  RotateCcw,
  RefreshCw,
  Save,
  ShieldAlert,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  Waves,
} from "lucide-react";
import {
  getEasyViewEdgeRoutePoints,
  isEasyViewParamEditable,
  type EasyEdgeKind,
  type EasyViewModel,
  type EasyViewNode,
} from "@/lib/easyViewAgent";
import { cn } from "@/lib/utils";

type DetailTab = "overview" | "params" | "code";

type EasyStrategyGraphProps = {
  model: EasyViewModel;
  toolbar?: ReactNode;
  onSaveCurrentBlock?: (node: EasyViewNode) => void;
};

const EDGE_STYLE: Record<EasyEdgeKind, { stroke: string; dash?: string }> = {
  sequence: { stroke: "#007aff" },
  condition: { stroke: "#34c759", dash: "7 6" },
  data: { stroke: "#8e8e93", dash: "8 7" },
  risk: { stroke: "#ff3b30", dash: "7 6" },
};

const KIND_STYLE: Record<EasyViewNode["kind"], string> = {
  start: "border-white/80 bg-white/[0.88] text-blue-600",
  stream: "border-white/80 bg-white/[0.88] text-sky-600",
  condition: "border-white/80 bg-white/[0.88] text-emerald-600",
  cex: "border-white/80 bg-white/[0.9] text-blue-600",
  dex: "border-white/80 bg-white/[0.9] text-cyan-600",
  monitor: "border-white/80 bg-white/[0.88] text-blue-600",
  risk: "border-white/80 bg-white/[0.88] text-rose-600",
  end: "border-white/80 bg-white/[0.88] text-rose-600",
};

function NodeIcon({ kind }: { kind: EasyViewNode["kind"] }) {
  const className = "h-5 w-5 shrink-0";
  if (kind === "start") return <Rocket className={className} />;
  if (kind === "stream") return <Waves className={className} />;
  if (kind === "condition") return <Crosshair className={className} />;
  if (kind === "cex") return <TrendingUp className={className} />;
  if (kind === "dex") return <TrendingDown className={className} />;
  if (kind === "monitor") return <RotateCcw className={className} />;
  if (kind === "risk") return <ShieldAlert className={className} />;
  return <CheckCircle2 className={className} />;
}

function StatusBadge({ status }: { status: EasyViewNode["status"] }) {
  const label = {
    ready: "대기",
    watching: "감시",
    running: "작동",
    complete: "완료",
    blocked: "제한",
  }[status];

  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-[10px] font-black",
        status === "running" && "bg-emerald-500/10 text-emerald-700",
        status === "watching" && "bg-blue-500/10 text-blue-700",
        status === "complete" && "bg-slate-900/[0.06] text-slate-700",
        status === "blocked" && "bg-rose-500/10 text-rose-700",
        status === "ready" && "bg-white/70 text-slate-500 shadow-sm ring-1 ring-slate-200/70",
      )}
    >
      {label}
    </span>
  );
}

type EdgeLabelPlacement = {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type Point = { x: number; y: number };
type Box = { left: number; right: number; top: number; bottom: number };
type NodeMeasurement = { width: number; height: number };
type MeasuredEasyViewNode = EasyViewNode & { measuredWidth?: number; measuredHeight?: number };
type MeasuredEasyViewModel = Omit<EasyViewModel, "nodes"> & { nodes: MeasuredEasyViewNode[] };

const EDGE_LABEL_TEXT: Record<string, string> = {
  "action-input": "입력",
  "action-result": "결과",
  "trigger-action": "실행",
  "trigger-input": "조건 입력",
  "stream-monitor": "차트",
  sequence: "다음",
  condition: "조건",
  data: "데이터",
};

function getEdgeLabelText(label?: string) {
  if (!label) return "";
  return EDGE_LABEL_TEXT[label.toLowerCase()] ?? label;
}

function getNodeVisualHeight(node: EasyViewNode) {
  if (node.kind === "stream" && node.chart) return 134;
  if (node.kind === "condition" || node.kind === "risk") return 56;
  return 82;
}

function getMeasuredNodeWidth(node: MeasuredEasyViewNode) {
  return node.measuredWidth ?? node.w;
}

function getMeasuredNodeHeight(node: MeasuredEasyViewNode) {
  return node.measuredHeight ?? getNodeVisualHeight(node);
}

function getNodeKindLabel(kind?: EasyViewNode["kind"]) {
  if (kind === "stream") return "시장 데이터";
  if (kind === "condition") return "매매 기준";
  if (kind === "cex") return "거래소 주문";
  if (kind === "dex") return "온체인 실행";
  if (kind === "monitor") return "상태 확인";
  if (kind === "risk") return "리스크 기준";
  if (kind === "start") return "시작";
  return "완료";
}

function getNodeBox(node: MeasuredEasyViewNode, padding = 10): Box {
  const width = getMeasuredNodeWidth(node);
  const height = getMeasuredNodeHeight(node);
  return {
    left: node.x - padding,
    right: node.x + width + padding,
    top: node.y - padding,
    bottom: node.y + height + padding,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function overlapArea(a: Box, b: Box) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return width * height;
}

function makeLabelBox(x: number, y: number, width: number, height: number): Box {
  return {
    left: x - width / 2,
    right: x + width / 2,
    top: y - height / 2,
    bottom: y + height / 2,
  };
}

function roundedPathFromPoints(points: Point[], radius = 10) {
  if (points.length <= 1) return "";
  let path = `M ${points[0].x} ${points[0].y}`;

  for (let index = 1; index < points.length - 1; index += 1) {
    const prev = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const prevLength = Math.hypot(current.x - prev.x, current.y - prev.y);
    const nextLength = Math.hypot(next.x - current.x, next.y - current.y);
    const corner = Math.min(radius, prevLength / 2, nextLength / 2);

    const from = {
      x: current.x - ((current.x - prev.x) / (prevLength || 1)) * corner,
      y: current.y - ((current.y - prev.y) / (prevLength || 1)) * corner,
    };
    const to = {
      x: current.x + ((next.x - current.x) / (nextLength || 1)) * corner,
      y: current.y + ((next.y - current.y) / (nextLength || 1)) * corner,
    };

    path += ` L ${from.x} ${from.y} Q ${current.x} ${current.y} ${to.x} ${to.y}`;
  }

  const last = points[points.length - 1];
  return `${path} L ${last.x} ${last.y}`;
}

function projectPointToSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return { point: start, distance: Math.hypot(point.x - start.x, point.y - start.y), t: 0 };
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  const projected = { x: start.x + dx * t, y: start.y + dy * t };
  return {
    point: projected,
    distance: Math.hypot(point.x - projected.x, point.y - projected.y),
    t,
  };
}

function splitRouteAtLabel(routePoints: Point[], label: EdgeLabelPlacement) {
  if (routePoints.length < 2) {
    return {
      incoming: routePoints,
      outgoing: routePoints,
    };
  }

  const labelCenter = { x: label.x, y: label.y };
  let best = {
    segmentIndex: 0,
    projected: routePoints[0],
    distance: Number.POSITIVE_INFINITY,
  };

  for (let index = 0; index < routePoints.length - 1; index += 1) {
    const projection = projectPointToSegment(labelCenter, routePoints[index], routePoints[index + 1]);
    if (projection.distance < best.distance) {
      best = { segmentIndex: index, projected: projection.point, distance: projection.distance };
    }
  }

  const segmentStart = routePoints[best.segmentIndex];
  const segmentEnd = routePoints[best.segmentIndex + 1];
  const segmentLength = Math.hypot(segmentEnd.x - segmentStart.x, segmentEnd.y - segmentStart.y) || 1;
  const tangent = {
    x: (segmentEnd.x - segmentStart.x) / segmentLength,
    y: (segmentEnd.y - segmentStart.y) / segmentLength,
  };
  const rawHalfDistance = Math.min(
    Math.abs(tangent.x) > 0.0001 ? label.width / 2 / Math.abs(tangent.x) : Number.POSITIVE_INFINITY,
    Math.abs(tangent.y) > 0.0001 ? label.height / 2 / Math.abs(tangent.y) : Number.POSITIVE_INFINITY,
  );
  const halfDistance = Number.isFinite(rawHalfDistance) ? rawHalfDistance : Math.max(label.width, label.height) / 2;
  const entry = {
    x: labelCenter.x - tangent.x * halfDistance,
    y: labelCenter.y - tangent.y * halfDistance,
  };
  const exit = {
    x: labelCenter.x + tangent.x * halfDistance,
    y: labelCenter.y + tangent.y * halfDistance,
  };

  return {
    incoming: [...routePoints.slice(0, best.segmentIndex + 1), entry],
    outgoing: [exit, ...routePoints.slice(best.segmentIndex + 1)],
  };
}

function getPolylineSampleAtRatio(points: Point[], ratio: number): { point: Point; tangent: Point } {
  if (points.length === 0) return { point: { x: 0, y: 0 }, tangent: { x: 1, y: 0 } };
  if (points.length === 1) return { point: points[0], tangent: { x: 1, y: 0 } };

  const segments = points.slice(0, -1).map((point, index) => {
    const next = points[index + 1];
    return {
      start: point,
      end: next,
      length: Math.hypot(next.x - point.x, next.y - point.y),
    };
  });
  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  let remaining = totalLength * ratio;

  for (const segment of segments) {
    if (segment.length === 0) continue;
    if (remaining <= segment.length) {
      const t = remaining / segment.length;
      return {
        point: {
          x: segment.start.x + (segment.end.x - segment.start.x) * t,
          y: segment.start.y + (segment.end.y - segment.start.y) * t,
        },
        tangent: {
          x: (segment.end.x - segment.start.x) / segment.length,
          y: (segment.end.y - segment.start.y) / segment.length,
        },
      };
    }
    remaining -= segment.length;
  }

  let last = segments[segments.length - 1];
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (segments[index].length > 0) {
      last = segments[index];
      break;
    }
  }
  return {
    point: points[points.length - 1],
    tangent: last
      ? {
        x: (last.end.x - last.start.x) / last.length,
        y: (last.end.y - last.start.y) / last.length,
      }
      : { x: 1, y: 0 },
  };
}

function buildEdgeLabelPlacements(model: MeasuredEasyViewModel) {
  const placements = new Map<string, EdgeLabelPlacement>();
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  const nodeBoxes = model.nodes.map((node) => getNodeBox(node, 18));
  const occupied: Box[] = [];
  const candidateRatios = [
    0.5,
    ...Array.from({ length: 18 }, (_, index) => {
      const step = Math.floor(index / 2) + 1;
      const direction = index % 2 === 0 ? -1 : 1;
      return 0.5 + direction * step * 0.04;
    }).filter((ratio) => ratio >= 0.12 && ratio <= 0.88),
  ];

  for (const edge of model.edges) {
    const label = getEdgeLabelText(edge.label);
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!label || !source || !target) continue;

    const width = clamp(label.length * 11 + 22, 46, 106);
    const height = 22;
    const routePoints = getEasyViewEdgeRoutePoints(source, target, model.nodes, edge, model.edges);
    let bestPlacement: EdgeLabelPlacement | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const ratio of candidateRatios) {
      const sample = getPolylineSampleAtRatio(routePoints, ratio);
      const rawX = sample.point.x;
      const rawY = sample.point.y;
      const x = clamp(rawX, width / 2 + 8, model.canvasWidth - width / 2 - 8);
      const y = clamp(rawY, height / 2 + 8, model.canvasHeight - height / 2 - 8);
      const box = makeLabelBox(x, y, width, height);
      const nodeOverlap = nodeBoxes.reduce((sum, nodeBox) => sum + overlapArea(box, nodeBox), 0);
      const labelOverlap = occupied.reduce((sum, occupiedBox) => sum + overlapArea(box, occupiedBox), 0);
      const clampedDistance = Math.abs(rawX - x) + Math.abs(rawY - y);
      const score =
        nodeOverlap * 10000 +
        labelOverlap * 650 +
        Math.abs(ratio - 0.5) * 140 +
        clampedDistance * 20;

      if (score < bestScore) {
        bestScore = score;
        bestPlacement = { label, x, y, width, height };
      }
      if (nodeOverlap === 0 && labelOverlap === 0 && ratio === 0.5) break;
    }

    if (bestPlacement) {
      placements.set(edge.id, bestPlacement);
      occupied.push(makeLabelBox(bestPlacement.x, bestPlacement.y, bestPlacement.width, bestPlacement.height));
    }
  }

  return placements;
}

function StreamMiniChart({ node }: { node: EasyViewNode }) {
  const chart = node.chart;
  if (!chart) return null;

  const seed = node.id.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const values = Array.from({ length: 9 }, (_, index) => {
    const wave = Math.sin((index + seed % 7) * 0.92) * 11;
    const trend = index * 2.8;
    return 34 + wave + trend;
  });
  const max = Math.max(...values);
  const min = Math.min(...values);
  const points = values
    .map((value, index) => {
      const x = 8 + index * 18;
      const y = 35 - ((value - min) / Math.max(1, max - min)) * 26;
      return `${x},${y}`;
    })
    .join(" ");
  const lastPoint = points.split(" ")[values.length - 1]?.split(",");
  const lastY = lastPoint?.[1] ?? "20";
  const fields = chart.fields.length > 0 ? chart.fields : ["price", "volume"];

  return (
    <div className="mt-2 rounded-2xl border border-white/80 bg-white/70 p-2 shadow-inner">
      <div className="mb-1 flex items-center justify-between gap-2 text-[9px] font-bold text-slate-500">
        <span className="truncate">{chart.title}</span>
        {chart.highlight ? <span className="shrink-0 text-sky-600">{chart.highlight}</span> : null}
      </div>
      <svg viewBox="0 0 160 42" className="h-11 w-full overflow-visible">
        <path d="M 8 9 H 152 M 8 22 H 152 M 8 35 H 152" stroke="#e2e8f0" strokeWidth="1" />
        <polyline points={points} fill="none" stroke="#0ea5e9" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="152" cy={lastY} r="3.2" fill="#0ea5e9" />
      </svg>
      <div className="mt-1 flex min-w-0 gap-1 overflow-hidden">
        {fields.slice(0, 3).map((field) => (
          <span key={field} className="truncate rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-bold text-sky-700">
            {field}
          </span>
        ))}
      </div>
    </div>
  );
}

export function EasyStrategyGraph({ model, toolbar, onSaveCurrentBlock }: EasyStrategyGraphProps) {
  const [selectedNodeId, setSelectedNodeId] = useState(model.nodes[0]?.id ?? "");
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [nodeMeasurements, setNodeMeasurements] = useState<Record<string, NodeMeasurement>>({});
  const nodeElementsRef = useRef(new Map<string, HTMLButtonElement>());
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const updateNodeMeasurement = useCallback((nodeId: string, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * 10) / 10);
    const height = Math.max(1, Math.round(rect.height * 10) / 10);

    setNodeMeasurements((prev) => {
      const previous = prev[nodeId];
      if (previous && Math.abs(previous.width - width) < 0.5 && Math.abs(previous.height - height) < 0.5) {
        return prev;
      }
      return { ...prev, [nodeId]: { width, height } };
    });
  }, []);

  const registerNodeElement = useCallback(
    (nodeId: string, element: HTMLButtonElement | null) => {
      const previous = nodeElementsRef.current.get(nodeId);
      if (previous && previous !== element) {
        resizeObserverRef.current?.unobserve(previous);
      }

      if (!element) {
        nodeElementsRef.current.delete(nodeId);
        return;
      }

      element.dataset.easyNodeId = nodeId;
      nodeElementsRef.current.set(nodeId, element);
      resizeObserverRef.current?.observe(element);
      updateNodeMeasurement(nodeId, element);
    },
    [updateNodeMeasurement],
  );

  useEffect(() => {
    setSelectedNodeId(model.nodes[0]?.id ?? "");
    setFocusedNodeId(null);
    setDetailTab("overview");
    setParamValues(
      Object.fromEntries(
        model.nodes.flatMap((node) =>
          node.params.map((param) => [`${node.id}:${param.key}`, param.value] as const),
        ),
      ),
    );
    setNodeMeasurements({});
  }, [model]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        const nodeId = element.dataset.easyNodeId;
        if (nodeId) {
          updateNodeMeasurement(nodeId, element);
        }
      }
    });

    resizeObserverRef.current = observer;
    nodeElementsRef.current.forEach((element) => observer.observe(element));

    return () => {
      observer.disconnect();
      resizeObserverRef.current = null;
    };
  }, [model.nodes, updateNodeMeasurement]);

  const measuredNodes = useMemo<MeasuredEasyViewNode[]>(
    () =>
      model.nodes.map((node) => {
        const measurement = nodeMeasurements[node.id];
        if (!measurement) return node;
        return {
          ...node,
          measuredWidth: measurement.width,
          measuredHeight: measurement.height,
        };
      }),
    [model.nodes, nodeMeasurements],
  );

  const measuredCanvasWidth = useMemo(
    () =>
      Math.max(
        model.canvasWidth,
        ...measuredNodes.map((node) => node.x + getMeasuredNodeWidth(node) + 180),
      ),
    [measuredNodes, model.canvasWidth],
  );
  const measuredCanvasHeight = useMemo(
    () =>
      Math.max(
        model.canvasHeight,
        ...measuredNodes.map((node) => node.y + getMeasuredNodeHeight(node) + 100),
      ),
    [measuredNodes, model.canvasHeight],
  );
  const measuredModel = useMemo<MeasuredEasyViewModel>(
    () => ({
      ...model,
      nodes: measuredNodes,
      canvasWidth: measuredCanvasWidth,
      canvasHeight: measuredCanvasHeight,
    }),
    [measuredCanvasHeight, measuredCanvasWidth, measuredNodes, model],
  );
  const hasMeasuredAllNodes = model.nodes.length === 0 || model.nodes.every((node) => nodeMeasurements[node.id]);

  const selectedNode = useMemo(
    () => model.nodes.find((node) => node.id === selectedNodeId) ?? model.nodes[0],
    [model.nodes, selectedNodeId],
  );

  const editableNodes = model.nodes.filter((node) => isEasyViewParamEditable(node));
  const selectedEditable = selectedNode ? isEasyViewParamEditable(selectedNode) : false;
  const edgeLabelPlacements = useMemo(
    () => (hasMeasuredAllNodes ? buildEdgeLabelPlacements(measuredModel) : new Map<string, EdgeLabelPlacement>()),
    [hasMeasuredAllNodes, measuredModel],
  );
  const nodeTitleById = useMemo(
    () => new Map(model.nodes.map((node) => [node.id, node.title] as const)),
    [model.nodes],
  );
  const selectedIncoming = useMemo(
    () => model.edges.filter((edge) => edge.target === selectedNode?.id),
    [model.edges, selectedNode?.id],
  );
  const selectedOutgoing = useMemo(
    () => model.edges.filter((edge) => edge.source === selectedNode?.id),
    [model.edges, selectedNode?.id],
  );
  const focusedNodeIds = useMemo(() => {
    if (!focusedNodeId) return new Set<string>();
    const ids = new Set<string>([focusedNodeId]);
    model.edges.forEach((edge) => {
      if (edge.source === focusedNodeId || edge.target === focusedNodeId) {
        ids.add(edge.source);
        ids.add(edge.target);
      }
    });
    return ids;
  }, [focusedNodeId, model.edges]);
  const focusedEdgeIds = useMemo(() => {
    if (!focusedNodeId) return new Set<string>();
    return new Set(
      model.edges
        .filter((edge) => edge.source === focusedNodeId || edge.target === focusedNodeId)
        .map((edge) => edge.id),
    );
  }, [focusedNodeId, model.edges]);
  const isFocusActive = Boolean(focusedNodeId);
  const incomingSummary = selectedIncoming.length > 0
    ? selectedIncoming.map((edge) => `${nodeTitleById.get(edge.source) ?? edge.source} (${getEdgeLabelText(edge.label) || edge.kind})`).join(", ")
    : "이전 블록 없음";
  const outgoingSummary = selectedOutgoing.length > 0
    ? selectedOutgoing.map((edge) => `${nodeTitleById.get(edge.target) ?? edge.target} (${getEdgeLabelText(edge.label) || edge.kind})`).join(", ")
    : "다음 블록 없음";
  const showTradingCriterion = selectedNode?.kind === "cex" || selectedNode?.kind === "dex";
  const handleSaveCurrentBlock = () => {
    if (!selectedNode) return;
    onSaveCurrentBlock?.(selectedNode);
  };

  if (model.nodes.length === 0) {
    return (
      <div className="grid h-full min-h-0 grid-rows-[minmax(420px,1fr)_clamp(154px,22vh,220px)]">
        <div className="relative overflow-auto border-b border-white/70 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.95),transparent_34rem),linear-gradient(135deg,#f8fafc_0%,#eef4fb_45%,#e9eef5_100%)]">
          {toolbar ? <div className="absolute left-3 top-2 z-20">{toolbar}</div> : null}
          <div className="flex h-full min-h-[420px] items-center justify-center p-6">
            <div className="w-full max-w-xl rounded-[32px] border border-white/80 bg-white/[0.82] p-7 text-center shadow-[0_30px_90px_rgba(15,23,42,0.12)] backdrop-blur-2xl">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[20px] bg-blue-500/10 text-blue-600 shadow-inner">
                <Rocket className="h-7 w-7" />
              </div>
              <h3 className="mt-4 text-lg font-black text-slate-950">아직 쉬운 보기에 올라온 전략이 없습니다</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                AI에게 전략을 요청하거나 추천 템플릿을 선택하면 거래소 연결을 바탕으로 블록과 간선이 여기 생성됩니다.
              </p>
              <div className="mt-5 grid gap-2 text-left sm:grid-cols-3">
                <div className="rounded-3xl border border-white/80 bg-white/70 px-3 py-3 shadow-[0_12px_32px_rgba(15,23,42,0.06)]">
                  <div className="flex items-center gap-2 text-sm font-black text-blue-900">
                    <PlayCircle className="h-4 w-4" />
                    AI로 시작
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-600">자연어로 전략을 설명하면 쉬운 보기와 코드가 함께 만들어집니다.</p>
                </div>
                <div className="rounded-3xl border border-white/80 bg-white/70 px-3 py-3 shadow-[0_12px_32px_rgba(15,23,42,0.06)]">
                  <div className="flex items-center gap-2 text-sm font-black text-sky-900">
                    <SlidersHorizontal className="h-4 w-4" />
                    템플릿 선택
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-600">추천 템플릿으로 빠르게 시작한 뒤 파라미터만 조정할 수 있습니다.</p>
                </div>
                <div className="rounded-3xl border border-white/80 bg-white/70 px-3 py-3 shadow-[0_12px_32px_rgba(15,23,42,0.06)]">
                  <div className="flex items-center gap-2 text-sm font-black text-emerald-900">
                    <BarChart3 className="h-4 w-4" />
                    생성 후 검증
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-600">전략이 만들어지면 쉬운 보기에서 백테스트와 드라이런 흐름까지 이어집니다.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid min-h-0 grid-cols-[minmax(160px,220px)_minmax(0,1fr)] bg-white/[0.78] backdrop-blur-2xl">
          <div className="border-r border-white/70 p-3">
            <div className="text-xs font-bold text-slate-600">다음 단계</div>
            <div className="mt-2 grid gap-2">
              {[
                "거래소 연결 상태 확인",
                "AI 전략 생성 또는 추천 템플릿 선택",
                "생성 후 파라미터 조정",
              ].map((step) => (
                <div key={step} className="rounded-2xl border border-white/80 bg-white/70 px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm">
                  {step}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-center p-6">
            <div className="max-w-lg rounded-[28px] border border-dashed border-slate-300/80 bg-white/70 px-6 py-5 text-center shadow-sm">
              <div className="text-sm font-black text-slate-900">전략이 생성되면 여기서 블록 개요와 파라미터를 볼 수 있습니다.</div>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                쉬운 보기에서는 실행 파라미터를 빠르게 조정하고, 구조를 바꾸고 싶을 때만 고급 보기로 넘어가면 됩니다.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(420px,1fr)_clamp(154px,22vh,220px)]">
      <div className="relative overflow-auto border-b border-white/70 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.95),transparent_34rem),linear-gradient(135deg,#f8fafc_0%,#eef4fb_45%,#e9eef5_100%)]">
        {toolbar ? <div className="absolute left-3 top-2 z-20">{toolbar}</div> : null}
        <div
          className="relative h-full min-h-[420px] min-w-full"
          onClick={() => setFocusedNodeId(null)}
          style={{ minWidth: measuredModel.canvasWidth, minHeight: measuredModel.canvasHeight }}
        >
          {hasMeasuredAllNodes ? (
            <svg
              className="pointer-events-none absolute left-0 top-0 z-0 h-full w-full"
              viewBox={`0 0 ${measuredModel.canvasWidth} ${measuredModel.canvasHeight}`}
              preserveAspectRatio="xMinYMin meet"
            >
              <defs>
                {Object.entries(EDGE_STYLE).map(([kind, style]) => (
                  <marker
                    key={kind}
                    id={`easy-arrow-${kind}`}
                    viewBox="0 0 14 14"
                    refX="0"
                    refY="7"
                    markerWidth="14"
                    markerHeight="14"
                    markerUnits="userSpaceOnUse"
                    orient="auto"
                  >
                    <path d="M 0 0 L 14 7 L 0 14 z" fill={style.stroke} />
                  </marker>
                ))}
              </defs>
              {measuredModel.edges.map((edge) => {
                const source = measuredModel.nodes.find((node) => node.id === edge.source);
                const target = measuredModel.nodes.find((node) => node.id === edge.target);
                if (!source || !target) return null;
                const style = EDGE_STYLE[edge.kind];
                const routePoints = getEasyViewEdgeRoutePoints(source, target, measuredModel.nodes, edge, measuredModel.edges);
                const labelPlacement = edgeLabelPlacements.get(edge.id);
                const splitRoute = labelPlacement ? splitRouteAtLabel(routePoints, labelPlacement) : null;
                const isFocusedEdge = focusedEdgeIds.has(edge.id);
                const isDimmedEdge = isFocusActive && !isFocusedEdge;
                const edgeOpacity = isDimmedEdge ? 0.13 : 1;
                const edgeStrokeWidth = isFocusedEdge ? 4.8 : 3.2;
                return (
                  <g key={edge.id} opacity={edgeOpacity}>
                    {isFocusedEdge ? (
                      <path
                        d={roundedPathFromPoints(routePoints)}
                        fill="none"
                        stroke={style.stroke}
                        strokeWidth="10"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity="0.22"
                      />
                    ) : null}
                    {splitRoute ? (
                      <>
                        <path
                          d={roundedPathFromPoints(splitRoute.incoming)}
                          fill="none"
                          stroke={style.stroke}
                          strokeWidth={edgeStrokeWidth}
                          strokeDasharray={style.dash}
                          strokeLinecap="butt"
                          strokeLinejoin="round"
                        />
                        <path
                          d={roundedPathFromPoints(splitRoute.outgoing)}
                          fill="none"
                          stroke={style.stroke}
                          strokeWidth={edgeStrokeWidth}
                          strokeDasharray={style.dash}
                          strokeLinecap="butt"
                          strokeLinejoin="round"
                          markerEnd={`url(#easy-arrow-${edge.kind})`}
                        />
                      </>
                    ) : (
                      <path
                        d={roundedPathFromPoints(routePoints)}
                        fill="none"
                        stroke={style.stroke}
                        strokeWidth={edgeStrokeWidth}
                        strokeDasharray={style.dash}
                        strokeLinecap="butt"
                        strokeLinejoin="round"
                        markerEnd={`url(#easy-arrow-${edge.kind})`}
                      />
                    )}
                  </g>
                );
              })}
            </svg>
          ) : null}

          {hasMeasuredAllNodes ? measuredModel.edges.map((edge) => {
            const labelPlacement = edgeLabelPlacements.get(edge.id);
            if (!labelPlacement) return null;
            const style = EDGE_STYLE[edge.kind];
            const isDimmedLabel = isFocusActive && !focusedEdgeIds.has(edge.id);
            return (
              <div
                key={`label-${edge.id}`}
                className="pointer-events-none absolute z-10 inline-flex items-center justify-center rounded-full border bg-white/85 text-[10px] font-black text-slate-600 shadow-[0_10px_28px_rgba(15,23,42,0.10)] backdrop-blur-xl"
                style={{
                  left: labelPlacement.x - labelPlacement.width / 2,
                  top: labelPlacement.y - labelPlacement.height / 2,
                  width: labelPlacement.width,
                  height: labelPlacement.height,
                  borderColor: `${style.stroke}52`,
                  opacity: isDimmedLabel ? 0.18 : 1,
                }}
              >
                {labelPlacement.label}
              </div>
            );
          }) : null}

          <div className="absolute left-8 top-[84px] z-20 rounded-full border border-white/80 bg-white/85 px-3 py-1 text-[11px] font-black text-emerald-700 shadow-[0_12px_30px_rgba(15,23,42,0.10)] backdrop-blur-xl">
            시작
          </div>

          {model.nodes.map((node) => {
            const isSelected = selectedNodeId === node.id;
            const isFocusedNode = focusedNodeId === node.id;
            const isFocusRelated = !isFocusActive || focusedNodeIds.has(node.id);
            const isAbstracted = Boolean(node.isAbstracted || (node.sourceBlockIds?.length ?? 0) > 1);
            const isCompact = !isAbstracted && (node.kind === "condition" || node.kind === "risk");
            return (
              <button
                key={node.id}
                ref={(element) => registerNodeElement(node.id, element)}
                data-easy-node-id={node.id}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedNodeId(node.id);
                  setFocusedNodeId(node.id);
                  setDetailTab("overview");
                }}
                className={cn(
                  "absolute z-20 rounded-[26px] border text-left shadow-[0_18px_52px_rgba(15,23,42,0.10)] backdrop-blur-2xl transition-all hover:-translate-y-1 hover:shadow-[0_26px_70px_rgba(15,23,42,0.14)]",
                  isCompact ? "px-3 py-2.5" : "p-3.5",
                  KIND_STYLE[node.kind],
                  isSelected && "border-blue-300 ring-[6px] ring-blue-500/10",
                  isFocusedNode && "z-30 ring-[6px] ring-blue-500/15 shadow-[0_30px_80px_rgba(0,122,255,0.18)]",
                  isFocusActive && !isFocusRelated && "opacity-25 grayscale",
                )}
                style={{
                  left: node.x,
                  top: node.y,
                  width: node.w,
                  minHeight: getNodeVisualHeight(node),
                  filter: isFocusedNode ? "drop-shadow(0 0 18px rgba(0, 122, 255, 0.24))" : undefined,
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {!isCompact ? <NodeIcon kind={node.kind} /> : null}
                    <div className="min-w-0">
                      <div className={cn("truncate font-black text-slate-900", isCompact ? "text-[11px]" : "text-xs")}>
                        {node.title}
                      </div>
                      <div className="truncate text-[11px] text-slate-500">{node.subtitle}</div>
                    </div>
                  </div>
                  {!isCompact ? (
                    <span className="rounded-full bg-slate-900/[0.05] px-2 py-0.5 text-[10px] font-bold text-slate-500">
                      {node.index}
                    </span>
                  ) : null}
                </div>
                {!isCompact ? (
                  <div className="mt-2 flex items-center justify-between">
                    {node.kind === "start" ? (
                      <div className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-1 text-[9px] font-bold text-amber-700">
                        <RefreshCw className="h-2.5 w-2.5 animate-spin" /> 무한 루프 주기
                      </div>
                    ) : (
                      <StatusBadge status={node.status} />
                    )}
                    <span className={cn("text-[10px] font-bold", node.editableInEasyView ? "text-blue-600" : "text-slate-400")}>
                      {isAbstracted ? `요약 ${node.sourceBlockIds?.length ?? 1}` : node.editableInEasyView ? "파라미터" : "읽기 전용"}
                    </span>
                  </div>
                ) : null}
                {!isCompact && isAbstracted ? (
                  <div className="mt-2 overflow-hidden text-[11px] font-medium leading-4 text-slate-600 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
                    {node.description}
                  </div>
                ) : null}
                {node.kind === "stream" ? <StreamMiniChart node={node} /> : null}
              </button>
            );
          })}

          <div className="absolute right-4 top-[92px] flex w-[116px] flex-col gap-2" onClick={(event) => event.stopPropagation()}>
            {[
              { label: "백테스트", icon: BarChart3, tone: "blue" },
              { label: "튜닝하기", icon: SlidersHorizontal, tone: "slate" },
              { label: "드라이런", icon: PlayCircle, tone: "cyan" },
              { label: "실전 실행", icon: Rocket, tone: "emerald" },
            ].map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.label}
                  type="button"
                  className={cn(
                    "inline-flex h-11 items-center justify-center gap-2 rounded-2xl border bg-white/85 text-sm font-black shadow-[0_14px_36px_rgba(15,23,42,0.10)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-white",
                    action.tone === "blue" && "border-blue-200 text-blue-700",
                    action.tone === "slate" && "border-slate-200 text-slate-700",
                    action.tone === "cyan" && "border-cyan-200 text-cyan-700",
                    action.tone === "emerald" && "border-emerald-200 text-emerald-700",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {action.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid min-h-0 grid-cols-[minmax(160px,220px)_minmax(0,1fr)] bg-white/[0.78] backdrop-blur-2xl">
        <div className="border-r border-white/70 p-2.5">
          <div className="mb-2 text-xs font-bold text-slate-600">쉬운 보기에서 수정 가능</div>
          <div className="grid gap-1.5">
            {editableNodes.map((node) => (
              <button
                key={node.id}
                type="button"
                onClick={() => {
                  setSelectedNodeId(node.id);
                  setDetailTab("params");
                }}
                className={cn(
                  "rounded-2xl border p-2.5 text-left text-xs shadow-sm transition",
                  selectedNodeId === node.id ? "border-blue-200 bg-blue-500/10 text-blue-800" : "border-white/80 bg-white/70 hover:bg-white",
                )}
              >
                <div className="font-black text-slate-900">{node.title}</div>
                <div className="mt-0.5 truncate text-[11px] text-slate-500">{node.subtitle}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex h-12 items-center justify-between border-b border-white/70 px-3">
            <div className="flex rounded-full bg-slate-900/[0.05] p-1">
              {[
                { id: "overview", label: "개요" },
                { id: "params", label: "파라미터" },
                { id: "code", label: "코드" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setDetailTab(tab.id as DetailTab)}
                  className={cn(
                    "h-8 rounded-full px-3 text-xs font-bold transition",
                    detailTab === tab.id ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-800",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {onSaveCurrentBlock ? (
                <button
                  type="button"
                  onClick={handleSaveCurrentBlock}
                  disabled={!selectedNode}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-slate-950 px-3 text-[11px] font-black text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <Save className="h-3.5 w-3.5 text-emerald-300" />
                  현재 블록 저장
                </button>
              ) : null}
              <div className="hidden items-center gap-1 rounded-full bg-white/70 px-2.5 py-1.5 text-[10px] font-bold text-slate-500 shadow-sm md:flex">
                <Code2 className="h-3 w-3" />
                코드에서 생성됨
              </div>
            </div>
          </div>

          <div className="h-[calc(100%-48px)] overflow-auto p-3">
            {detailTab === "overview" ? (
              <div
                className={cn(
                  "grid h-full gap-3",
                  showTradingCriterion
                    ? "grid-cols-[minmax(180px,1.15fr)_minmax(220px,1.4fr)_minmax(190px,1fr)_minmax(190px,1fr)]"
                    : "grid-cols-[minmax(180px,1fr)_minmax(260px,1.65fr)_minmax(220px,1.1fr)]",
                )}
              >
                <div className="rounded-2xl border border-white/80 bg-white/70 p-3 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-bold text-slate-500">선택 블록</div>
                    {selectedNode ? <StatusBadge status={selectedNode.status} /> : null}
                  </div>
                  <div className="mt-2 text-sm font-black text-slate-900">{selectedNode?.title}</div>
                  <div className="mt-1 text-[11px] font-bold text-blue-600">{getNodeKindLabel(selectedNode?.kind)}</div>
                  <p className="mt-2 text-xs leading-5 text-slate-600">{selectedNode?.description}</p>
                </div>
                <div className="rounded-2xl border border-white/80 bg-white/70 p-3 shadow-sm">
                  <div className="text-xs font-bold text-slate-500">이 전략에서 하는 일</div>
                  <p className="mt-2 text-xs leading-5 text-slate-600">
                    {selectedNode?.roleDescription ?? selectedNode?.description ?? "선택한 블록의 전략 내 역할을 표시합니다."}
                  </p>
                  <div className="mt-3 rounded-xl bg-slate-900/[0.04] px-2.5 py-2 text-[11px] font-semibold leading-5 text-slate-600">
                    이전: {incomingSummary}
                  </div>
                  <div className="mt-1.5 rounded-xl bg-slate-900/[0.04] px-2.5 py-2 text-[11px] font-semibold leading-5 text-slate-600">
                    다음: {outgoingSummary}
                  </div>
                </div>
                {showTradingCriterion ? (
                  <div className="rounded-2xl border border-white/80 bg-white/70 p-3 shadow-sm">
                    <div className="text-xs font-bold text-slate-500">매매 기준</div>
                    <p className="mt-2 text-xs leading-5 text-slate-600">
                      {selectedNode?.conditionText || "연결된 매매 기준이 충족될 때 실행됩니다."}
                    </p>
                  </div>
                ) : null}
                <div className="rounded-2xl border border-white/80 bg-white/70 p-3 shadow-sm">
                  <div className="text-xs font-bold text-slate-500">입출력</div>
                  <p className="mt-2 text-xs leading-5 text-slate-600">
                    {selectedNode?.inputSummary ?? "받는 입력: 연결된 이전 블록"}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-slate-600">
                    {selectedNode?.outputSummary ?? "내보내는 값: 연결된 다음 블록"}
                  </p>
                </div>
              </div>
            ) : null}

            {detailTab === "params" ? (
              selectedEditable ? (
                <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3">
                  {selectedNode.params.map((param) => {
                    const key = `${selectedNode.id}:${param.key}`;
                    return (
                      <label key={param.key} className="block">
                        <div className="mb-1 text-xs font-bold text-slate-700">{param.label}</div>
                        {param.options ? (
                          <select
                            value={paramValues[key] ?? param.value}
                            onChange={(event) =>
                              setParamValues((prev) => ({ ...prev, [key]: event.target.value }))
                            }
                            disabled={param.readonly}
                            className="h-10 w-full rounded-xl border border-slate-200 bg-white/85 px-2 text-sm font-semibold outline-none focus:border-blue-300 disabled:bg-slate-100 disabled:text-slate-500"
                          >
                            {param.options.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className={`flex h-10 rounded-xl border border-slate-200 bg-white/85 ${param.readonly ? "bg-slate-100" : ""}`}>
                            <input
                              value={paramValues[key] ?? param.value}
                              onChange={(event) =>
                                setParamValues((prev) => ({ ...prev, [key]: event.target.value }))
                              }
                              readOnly={param.readonly}
                              disabled={param.readonly}
                              className="min-w-0 flex-1 rounded-l-xl px-2 text-sm font-semibold outline-none focus:ring-1 focus:ring-blue-300 disabled:bg-slate-100 disabled:text-slate-500"
                            />
                            {param.unit ? (
                              <span className="inline-flex items-center border-l border-slate-200 px-2 text-xs font-bold text-slate-400">
                                {param.unit}
                              </span>
                            ) : null}
                          </div>
                        )}
                        <div className="mt-1 truncate text-[11px] text-slate-500">{param.helper}</div>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 text-center text-sm font-semibold text-slate-500">
                  이 블록은 파이프라인 구조에 속합니다. 쉬운 보기에서는 CEX/DEX 실행 파라미터만 조절하고, 구조 변경은 고급 보기에서 합니다.
                </div>
              )
            ) : null}

            {detailTab === "code" ? (
              <pre className="h-full overflow-auto rounded-2xl bg-slate-950 p-3 text-xs leading-5 text-emerald-200 shadow-inner">
                {model.code}
              </pre>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
