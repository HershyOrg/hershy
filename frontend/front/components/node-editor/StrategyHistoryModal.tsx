"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import dagre from "dagre";
import {
  Background,
  BaseEdge,
  Controls,
  Edge,
  EdgeProps,
  Handle,
  MarkerType,
  Node,
  NodeProps,
  Position,
  ReactFlow,
  getSmoothStepPath,
  useNodesState,
  useEdgesState,
  SelectionMode,
} from "@xyflow/react";
import { Clock3, GitBranch, GitCommitHorizontal, GitMerge, Sparkles, X, GitBranchPlus, Play, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { HistorySnapshot, HistorySnapshotGroup, historyStore } from "@/lib/historyStore";
import { runningStore, RunningEntry } from "@/lib/runningStore";
import { cn } from "@/lib/utils";
import { ContextMenu } from "./ContextMenu";
import { HiddenHistoryGroupNode } from "./HiddenHistoryGroupNode";

const ROOT_KEY = "__root__";
const CARD_WIDTH = 360;
const CARD_HEIGHT = 250;
const PREVIEW_WIDTH = 312;
const PREVIEW_HEIGHT = 132;
const EMPTY_RUNNING_ENTRIES: RunningEntry[] = [];

type HistoryBranchNodeData = {
  snapshot: HistorySnapshot;
  isActive: boolean;
  isRunning: boolean;
  hasParent: boolean;
  hasChildren: boolean;
  onSelect: (snapshotId: string) => void;
  onToggleRun: (snapshotId: string) => void;
};

type HistoryBranchFlowNode = Node<HistoryBranchNodeData, "historyBranch">;

type PreviewNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type?: string;
  label?: string;
};

type PreviewEdge = {
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
};

function getNodeDimensions(node: any) {
  const width =
    Number(node?.measured?.width ?? node?.style?.width ?? node?.width) ||
    (node?.type === "branchNode" ? 420 : node?.type === "timelineFrame" ? 520 : 300);
  const height =
    Number(node?.measured?.height ?? node?.style?.height ?? node?.height) ||
    (node?.type === "branchNode" ? 150 : node?.type === "timelineFrame" ? 350 : 120);

  return { width, height };
}

function getPreviewPalette(node: any) {
  switch (node?.type) {
    case "groupNode":
      return {
        fill: "rgba(15, 23, 42, 0.12)",
        stroke: "rgba(15, 23, 42, 0.24)",
        accent: "rgba(15, 23, 42, 0.2)",
      };
    case "branchNode":
      return {
        fill: "rgba(245, 158, 11, 0.24)",
        stroke: "rgba(217, 119, 6, 0.72)",
        accent: "rgba(245, 158, 11, 0.4)",
      };
    case "actionNode":
      return {
        fill: "rgba(14, 165, 233, 0.24)",
        stroke: "rgba(2, 132, 199, 0.72)",
        accent: "rgba(14, 165, 233, 0.4)",
      };
    case "clickTrigger":
    case "timeTrigger":
      return {
        fill: "rgba(16, 185, 129, 0.24)",
        stroke: "rgba(5, 150, 105, 0.72)",
        accent: "rgba(16, 185, 129, 0.38)",
      };
    case "monitoringNode":
      return {
        fill: "rgba(168, 85, 247, 0.2)",
        stroke: "rgba(126, 34, 206, 0.66)",
        accent: "rgba(168, 85, 247, 0.34)",
      };
    default:
      return {
        fill: "rgba(99, 102, 241, 0.2)",
        stroke: "rgba(79, 70, 229, 0.66)",
        accent: "rgba(99, 102, 241, 0.34)",
      };
  }
}

function buildPreview(snapshot: HistorySnapshot) {
  const visibleNodes = snapshot.nodes.filter((node: any) => !node?.hidden);

  if (visibleNodes.length === 0) {
    return { nodes: [] as PreviewNode[], edges: [] as PreviewEdge[] };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  visibleNodes.forEach((node: any) => {
    const { width, height } = getNodeDimensions(node);
    const x = Number(node?.position?.x) || 0;
    const y = Number(node?.position?.y) || 0;

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  });

  const contentWidth = Math.max(maxX - minX, 1);
  const contentHeight = Math.max(maxY - minY, 1);
  const padding = 18;
  const scale = Math.min(
    (PREVIEW_WIDTH - padding * 2) / contentWidth,
    (PREVIEW_HEIGHT - padding * 2) / contentHeight,
    0.42,
  );

  const offsetX = (PREVIEW_WIDTH - contentWidth * scale) / 2;
  const offsetY = (PREVIEW_HEIGHT - contentHeight * scale) / 2;

  const previewNodes = visibleNodes.map((node: any) => {
    const { width, height } = getNodeDimensions(node);
    const x = offsetX + ((Number(node?.position?.x) || 0) - minX) * scale;
    const y = offsetY + ((Number(node?.position?.y) || 0) - minY) * scale;

    return {
      id: node.id,
      x,
      y,
      width: Math.max(width * scale, 12),
      height: Math.max(height * scale, 7),
      type: node.type,
      label: node?.data?.label,
    };
  });

  const previewNodeMap = new Map(previewNodes.map((node) => [node.id, node]));
  const previewEdges = snapshot.edges
    .map((edge: any) => {
      const source = previewNodeMap.get(edge.source);
      const target = previewNodeMap.get(edge.target);

      if (!source || !target) return null;

      return {
        id: edge.id ?? `${edge.source}-${edge.target}`,
        sourceX: source.x + source.width,
        sourceY: source.y + source.height / 2,
        targetX: target.x,
        targetY: target.y + target.height / 2,
      };
    })
    .filter(Boolean) as PreviewEdge[];

  return { nodes: previewNodes, edges: previewEdges };
}

function orderSnapshots(snapshots: HistorySnapshot[]) {
  const childrenByParent = new Map<string, HistorySnapshot[]>();

  snapshots.forEach((snapshot) => {
    const key = snapshot.parentId ?? ROOT_KEY;
    const siblings = childrenByParent.get(key) ?? [];
    siblings.push(snapshot);
    childrenByParent.set(key, siblings);
  });

  childrenByParent.forEach((siblings) => {
    siblings.sort((a, b) => a.timestamp - b.timestamp);
  });

  const ordered: HistorySnapshot[] = [];
  const visit = (parentId: string | null) => {
    const key = parentId ?? ROOT_KEY;
    const children = childrenByParent.get(key) ?? [];

    children.forEach((child) => {
      ordered.push(child);
      visit(child.id);
    });
  };

  visit(null);

  const seen = new Set(ordered.map((snapshot) => snapshot.id));
  snapshots
    .filter((snapshot) => !seen.has(snapshot.id))
    .sort((a, b) => a.timestamp - b.timestamp)
    .forEach((snapshot) => ordered.push(snapshot));

  return ordered;
}

function getActivePath(snapshotMap: Map<string, HistorySnapshot>, activeId: string | null) {
  const path = new Set<string>();
  let cursor = activeId;

  while (cursor) {
    path.add(cursor);
    cursor = snapshotMap.get(cursor)?.parentId ?? null;
  }

  return path;
}

function formatSnapshotTime(timestamp: number) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

const StrategyPreview = memo(function StrategyPreview({
  snapshot,
  isActive,
  isRunning,
}: {
  snapshot: HistorySnapshot;
  isActive: boolean;
  isRunning: boolean;
}) {
  const { nodes, edges } = useMemo(() => buildPreview(snapshot), [snapshot]);

  return (
    <div
      className={cn(
        "relative h-[148px] overflow-hidden rounded-[22px] border transition-all duration-300",
        isRunning
          ? "border-emerald-400/80 bg-emerald-950/[0.06] shadow-[0_0_32px_rgba(52,211,153,0.4)]"
          : isActive
            ? "border-indigo-300/80 bg-slate-950/[0.08] shadow-[0_0_28px_rgba(99,102,241,0.2)]"
            : "border-slate-200/90 bg-slate-950/[0.05] group-hover/branch:border-indigo-300/80 group-hover/branch:shadow-[0_0_34px_rgba(99,102,241,0.28)]",
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(99,102,241,0.24),transparent_45%),radial-gradient(circle_at_85%_80%,rgba(14,165,233,0.16),transparent_32%)]" />
      <div
        className={cn(
          "absolute inset-0 transition-all duration-300",
          "saturate-100",
        )}
      >
        <svg
          viewBox={`0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}`}
          className="absolute inset-[8px] h-[132px] w-[312px]"
          aria-hidden="true"
        >
          {edges.map((edge) => {
            const midX = edge.sourceX + (edge.targetX - edge.sourceX) * 0.5;

            return (
              <path
                key={edge.id}
                d={`M ${edge.sourceX} ${edge.sourceY} C ${midX} ${edge.sourceY}, ${midX} ${edge.targetY}, ${edge.targetX} ${edge.targetY}`}
                fill="none"
                stroke="rgba(71, 85, 105, 0.45)"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            );
          })}
        </svg>

        <div className="absolute inset-[8px]">
          {nodes.map((node) => {
            const palette = getPreviewPalette(node);

            return (
              <div
                key={node.id}
                className="absolute overflow-hidden rounded-[10px] border"
                style={{
                  left: node.x,
                  top: node.y,
                  width: node.width,
                  height: node.height,
                  background: palette.fill,
                  borderColor: palette.stroke,
                  boxShadow: `0 0 0 1px ${palette.accent} inset`,
                }}
              >
                <div
                  className="absolute left-[10%] top-[28%] h-[18%] rounded-full"
                  style={{
                    width: Math.max(node.width * 0.38, 8),
                    background: palette.stroke,
                    opacity: 0.9,
                  }}
                />
                <div
                  className="absolute bottom-[22%] left-[10%] h-[14%] rounded-full"
                  style={{
                    width: Math.max(node.width * 0.58, 12),
                    background: "rgba(255,255,255,0.45)",
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="absolute inset-0 rounded-[22px] ring-1 ring-inset ring-white/35" />
    </div>
  );
});

const HistoryBranchNode = memo(function HistoryBranchNode({
  data,
}: NodeProps<HistoryBranchFlowNode>) {
  const { snapshot, isActive, isRunning, hasParent, hasChildren, onSelect, onToggleRun } = data;
  const isRootSnapshot = snapshot.parentId === null;

  return (
    <div className="group/branch relative w-[360px]">
      {hasParent ? (
        <Handle
          type="target"
          position={Position.Left}
          isConnectable={false}
          className={cn(
            "!left-[-12px] !top-1/2 !h-4 !w-4 !-translate-y-1/2 !border-[3px] !border-white !shadow-md",
            isRunning ? "!bg-emerald-500" : isActive ? "!bg-indigo-500" : "!bg-slate-300 group-hover/branch:!bg-indigo-400",
          )}
        />
      ) : null}

      <div
        role="button"
        tabIndex={0}
        className={cn(
          "nodrag nopan relative flex w-full flex-col gap-4 rounded-[28px] border p-4 text-left transition-all duration-200 active:opacity-55",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2",
          isRunning
            ? "border-emerald-400 bg-white shadow-[0_0_0_2px_rgba(52,211,153,0.3),0_18px_60px_rgba(52,211,153,0.28)] ring-2 ring-emerald-300/50"
            : isActive
              ? "border-indigo-400 bg-white shadow-[0_18px_60px_rgba(79,70,229,0.22)]"
              : "border-slate-200 bg-white/92 shadow-[0_12px_32px_rgba(15,23,42,0.08)] hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-[0_18px_42px_rgba(79,70,229,0.16)]",
        )}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onSelect(snapshot.id);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          onSelect(snapshot.id);
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div className="flex items-center gap-2">
              {isRootSnapshot ? (
                <GitCommitHorizontal className="h-4 w-4 text-slate-500" />
              ) : (
                <GitBranch className="h-4 w-4 text-indigo-500" />
              )}
              <span className="truncate text-sm font-semibold text-slate-900">{snapshot.name}</span>
            </div>
            <p className="text-xs leading-5 text-slate-500">
              {isRootSnapshot ? "기준 전략 스냅샷" : "분기 전략 스냅샷"}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isRunning && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-[11px] font-bold text-emerald-700 animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                LIVE
              </span>
            )}
            {isActive && !isRunning ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700">
                <Sparkles className="h-3 w-3" />
                현재 분기
              </span>
            ) : null}
            {/* Run/Stop toggle */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleRun(snapshot.id);
              }}
              title={isRunning ? "전략 정지" : "이 버전으로 실행"}
              className={cn(
                "nodrag nopan p-1.5 rounded-full border transition-all",
                isRunning
                  ? "bg-emerald-50 border-emerald-300 text-emerald-600 hover:bg-red-50 hover:border-red-300 hover:text-red-500"
                  : "bg-slate-50 border-slate-200 text-slate-400 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-600"
              )}
            >
              {isRunning ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            </button>
          </div>
        </div>

        <StrategyPreview snapshot={snapshot} isActive={isActive} isRunning={isRunning} />

        <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <Clock3 className="h-3.5 w-3.5" />
            {formatSnapshotTime(snapshot.timestamp)}
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
            {snapshot.nodes.length} nodes
          </span>
        </div>
      </div>

      {hasChildren ? (
        <Handle
          type="source"
          position={Position.Right}
          isConnectable={false}
          className={cn(
            "!right-[-12px] !top-1/2 !h-4 !w-4 !-translate-y-1/2 !border-[3px] !border-white !shadow-md",
            isRunning ? "!bg-emerald-500" : isActive ? "!bg-indigo-500" : "!bg-slate-300 group-hover/branch:!bg-indigo-400",
          )}
        />
      ) : null}
    </div>
  );
});

const HistoryBranchEdge = memo(function HistoryBranchEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
}: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 22,
    offset: 28,
  });

  return <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />;
});

const historyNodeTypes = {
  historyBranch: HistoryBranchNode,
  hiddenHistoryGroup: HiddenHistoryGroupNode,
};

const historyEdgeTypes = {
  historyBranchEdge: HistoryBranchEdge,
};

export function StrategyHistoryModal({
  isOpen,
  onClose,
  runningEntries = EMPTY_RUNNING_ENTRIES,
}: {
  isOpen: boolean;
  onClose: () => void;
  runningEntries?: RunningEntry[];
}) {
  const [snapshots, setSnapshots] = useState<HistorySnapshot[]>([]);
  const [hiddenGroups, setHiddenGroups] = useState<HistorySnapshotGroup[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<HistorySnapshot[] | null>(null);

  // Strategy picker: shown when a snapshot has multiple solid GroupNodes
  const [strategyPicker, setStrategyPicker] = useState<{
    snapshotId: string;
    strategies: Array<{ id: string; label: string }>;
  } | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    selectedNodes: Node[];
  } | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    setSnapshots(historyStore.getSnapshots());
    setHiddenGroups(historyStore.getHiddenGroups());
    setActiveId(historyStore.getActiveId());

    const unsubscribe = historyStore.subscribe(() => {
      setSnapshots(historyStore.getSnapshots());
      setHiddenGroups(historyStore.getHiddenGroups());
      setActiveId(historyStore.getActiveId());
    });

    return () => {
      unsubscribe();
    };
  }, [isOpen]);

  const handleSelectSnapshot = useCallback(
    (snapshotId: string) => {
      window.dispatchEvent(new CustomEvent("persistActiveHistorySnapshot"));
      historyStore.setActiveId(snapshotId);
      onClose();
    },
    [onClose],
  );

  const handleToggleRun = useCallback((snapshotId: string) => {
    // If ALL nodes in this snapshot are currently running, stop them all
    if (runningStore.isSnapshotRunning(snapshotId)) {
      runningStore.stopSnapshot(snapshotId);
      return;
    }

    // Find solid GroupNodes in the snapshot's canvas
    const snapshot = snapshots.find(s => s.id === snapshotId);
    const solidNodes = (snapshot?.nodes ?? []).filter(
      (n: any) => n.type === "groupNode" && n.data?.styleType === "solid"
    );

    if (solidNodes.length === 0) return;

    if (solidNodes.length === 1) {
      // Only one strategy block — run it directly
      runningStore.startNode(snapshotId, solidNodes[0].id, solidNodes[0].data?.label ?? "전략");
    } else {
      // Multiple strategy blocks — show picker
      setStrategyPicker({
        snapshotId,
        strategies: solidNodes.map((n: any) => ({ id: n.id, label: n.data?.label ?? n.id })),
      });
    }
  }, [snapshots]);

  const buildGraph = useCallback(() => {
    const orderedSnapshots = orderSnapshots(snapshots);
    const snapshotMap = new Map(orderedSnapshots.map((snapshot) => [snapshot.id, snapshot]));
    const activePath = getActivePath(snapshotMap, activeId);

    const hiddenSnapshotsSet = new Set<string>();
    const hiddenGroupIdBySnapshot = new Map<string, string>();
    hiddenGroups.forEach(g => {
      g.snapshotIds.forEach(id => {
        hiddenSnapshotsSet.add(id);
        hiddenGroupIdBySnapshot.set(id, g.id);
      });
    });

    const parentIdsWithChildren = new Set(
      orderedSnapshots.map((snapshot) => snapshot.parentId).filter(Boolean) as string[],
    );
    const graph = new dagre.graphlib.Graph();

    graph.setDefaultEdgeLabel(() => ({}));
    graph.setGraph({
      rankdir: "LR",
      ranksep: 120,
      nodesep: 58,
      marginx: 80,
      marginy: 70,
    });

    // Add unhidden snapshots to dagre
    orderedSnapshots.forEach((snapshot) => {
      if (!hiddenSnapshotsSet.has(snapshot.id)) {
        graph.setNode(snapshot.id, { width: CARD_WIDTH, height: CARD_HEIGHT });
      }
    });

    // Add hidden groups to dagre
    hiddenGroups.forEach(group => {
      graph.setNode(group.id, { width: 48, height: 48 });
    });

    // Add edges to dagre
    orderedSnapshots.forEach((snapshot) => {
      if (snapshot.parentId) {
        const sourceId = hiddenSnapshotsSet.has(snapshot.parentId) ? hiddenGroupIdBySnapshot.get(snapshot.parentId)! : snapshot.parentId;
        const targetId = hiddenSnapshotsSet.has(snapshot.id) ? hiddenGroupIdBySnapshot.get(snapshot.id)! : snapshot.id;

        if (sourceId !== targetId) {
          graph.setEdge(sourceId, targetId);
        }
      }
    });

    dagre.layout(graph);

    const flowNodes: Node[] = [];

    // Create unhidden nodes
    orderedSnapshots.forEach((snapshot) => {
      if (hiddenSnapshotsSet.has(snapshot.id)) return;
      const position = graph.node(snapshot.id);
      if (!position) return;

      flowNodes.push({
        id: snapshot.id,
        type: "historyBranch",
        position: {
          x: position.x - CARD_WIDTH / 2,
          y: position.y - CARD_HEIGHT / 2,
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        draggable: false,
        selectable: true,
        connectable: false,
        deletable: false,
        data: {
          snapshot,
          isActive: snapshot.id === activeId,
          isRunning: runningEntries.some(e => e.snapshotId === snapshot.id),
          hasParent: Boolean(snapshot.parentId),
          hasChildren: parentIdsWithChildren.has(snapshot.id),
          onSelect: handleSelectSnapshot,
          onToggleRun: handleToggleRun,
        },
        style: {
          width: CARD_WIDTH,
          background: "transparent",
          border: "none",
          overflow: "visible",
        },
      });
    });

    // Create hidden group nodes
    hiddenGroups.forEach((group) => {
      const position = graph.node(group.id);
      if (!position) return;

      flowNodes.push({
        id: group.id,
        type: "hiddenHistoryGroup",
        position: {
          x: position.x - 24,
          y: position.y - 24,
        },
        draggable: false,
        selectable: false,
        connectable: false,
        deletable: false,
        data: {
          snapshots: group.snapshotIds.map(id => snapshotMap.get(id)!).filter(Boolean),
          onRestore: (snapshotId: string) => {
            historyStore.restoreHiddenGroup(group.id, snapshotId);
          }
        } as any,
      });
    });

    const flowEdges: Edge[] = graph.edges().map(e => {
      const v = e.v;
      const w = e.w;

      // approximate isOnActivePath: if both source and target contain active nodes
      let sourceActive = v === activeId || activePath.has(v);
      let targetActive = w === activeId || activePath.has(w);

      if (v.startsWith('hidden_history_group')) {
        const g = hiddenGroups.find(x => x.id === v);
        if (g && g.snapshotIds.some(id => id === activeId || activePath.has(id))) sourceActive = true;
      }
      if (w.startsWith('hidden_history_group')) {
        const g = hiddenGroups.find(x => x.id === w);
        if (g && g.snapshotIds.some(id => id === activeId || activePath.has(id))) targetActive = true;
      }

      const isOnActivePath = sourceActive && targetActive;

      return {
        id: `edge-${v}-${w}`,
        source: v,
        target: w,
        type: "historyBranchEdge",
        animated: isOnActivePath,
        style: {
          stroke: isOnActivePath ? "#6366f1" : "#94a3b8",
          strokeWidth: isOnActivePath ? 3.6 : 2.2,
          opacity: isOnActivePath ? 0.98 : 0.7,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isOnActivePath ? "#6366f1" : "#94a3b8",
        },
      };
    });

    setNodes(prev => {
      // preserve selection state if possible
      const selectedIds = new Set(prev.filter(n => n.selected).map(n => n.id));
      return flowNodes.map(n => ({ ...n, selected: selectedIds.has(n.id) }));
    });
    setEdges(flowEdges);
  }, [snapshots, hiddenGroups, activeId, runningEntries, handleSelectSnapshot, handleToggleRun, setNodes, setEdges]);

  useEffect(() => {
    if (isOpen) buildGraph();
  }, [isOpen, snapshots, hiddenGroups, activeId, buildGraph]);

  const handleHideNodes = useCallback(() => {
    const selectedBranches = nodes.filter((n) => n.selected && n.type === "historyBranch");
    const selectedGroups = nodes.filter((n) => n.selected && n.type === "hiddenHistoryGroup");

    if (selectedBranches.length === 0 && selectedGroups.length <= 1) {
      setContextMenu(null);
      return;
    }

    const allSnapshotIds: string[] = selectedBranches.map(n => (n.data as any).snapshot.id);

    selectedGroups.forEach(g => {
      const gData = g.data as any;
      if (gData.snapshots) {
        gData.snapshots.forEach((s: any) => allSnapshotIds.push(s.id));
      }
      historyStore.restoreHiddenGroup(g.id);
    });

    historyStore.hideSnapshots(allSnapshotIds);
    setContextMenu(null);
  }, [nodes]);

  const handleDeleteSelected = useCallback(() => {
    const selectedNodes = nodes.filter((n) => n.selected && n.type === "historyBranch");
    if (selectedNodes.length > 0) {
      historyStore.deleteSnapshots(selectedNodes.map(n => (n.data as any).snapshot.id));
    }
    setContextMenu(null);
  }, [nodes]);

  const handleCopy = useCallback(() => {
    const selectedNodes = nodes.filter((n) => n.selected && n.type === "historyBranch");
    if (selectedNodes.length > 0) {
      setClipboard(selectedNodes.map(n => (n.data as any).snapshot));
    }
    setContextMenu(null);
  }, [nodes]);

  const handlePaste = useCallback(() => {
    if (clipboard && clipboard.length > 0) {
      const selectedNodes = nodes.filter(n => n.selected);
      const targetParentId = selectedNodes.length === 0 ? null : activeId;
      historyStore.cloneSnapshots(clipboard, targetParentId);
    }
    setContextMenu(null);
  }, [clipboard, activeId, nodes]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Always intercept these keys so NodeEditor never sees them while modal is open
      const isModalKey =
        e.key === "Escape" ||
        e.key === "Tab" ||
        ((e.ctrlKey || e.metaKey) && ["z", "y", "c", "v"].includes(e.key.toLowerCase()));

      if (isModalKey) {
        e.stopPropagation();
      }

      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          historyStore.redo();
        } else {
          historyStore.undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        historyStore.redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        handleCopy();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        handlePaste();
      } else if (e.key === "Tab") {
        if (
          e.target instanceof HTMLElement &&
          (e.target.tagName.toLowerCase() === "input" ||
            e.target.tagName.toLowerCase() === "textarea")
        ) {
          return;
        }
        e.preventDefault();
        handleHideNodes();
      }
    };

    // capture: true so this fires before any React/ReactFlow bubbling handlers
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [isOpen, onClose, handleCopy, handlePaste, handleHideNodes]);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent, node?: Node) => {
      event.preventDefault();

      if (node && !node.selected) {
        setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === node.id })));
      }

      setNodes((currentNodes) => {
        const selectedNodes = currentNodes.filter(n => n.selected || n.id === node?.id);
        setContextMenu({
          x: event.clientX,
          y: event.clientY,
          selectedNodes: selectedNodes,
        });
        return currentNodes;
      });
    },
    [setNodes]
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999]">
      <div className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative h-dvh w-screen overflow-hidden"
      >
        <div className="flex h-full w-full flex-col overflow-hidden bg-[radial-gradient(circle_at_top,rgba(99,102,241,0.14),transparent_30%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)]">
          <div className="shrink-0 border-b border-slate-200/80 bg-white/90 px-6 py-5 backdrop-blur">
            <div className="flex items-start justify-between gap-6">
              <div className="space-y-2 text-left">
                <h2 className="flex items-center gap-2 text-xl font-semibold text-slate-950">
                  <GitMerge className="h-6 w-6 text-indigo-500" />
                  전략 히스토리 및 분기 트래킹
                </h2>
                <p className="max-w-3xl text-sm leading-6 text-slate-600">
                  분기 카드를 눌렀다 떼면 해당 시점의 전략으로 이동합니다. 닫기 버튼이나 <Kbd>Esc</Kbd>로 전체 화면을 닫을 수 있습니다.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  className="gap-2 rounded-full px-5 shadow-sm bg-indigo-600 hover:bg-indigo-700 text-white"
                  onClick={() => {
                    historyStore.createEmptyStrategy(null);
                    onClose();
                  }}
                >
                  <Sparkles className="h-4 w-4" />
                  새 루트 전략 시작
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2 rounded-full bg-white/90 px-5 shadow-sm"
                  onClick={() => {
                    historyStore.createBranchDraft(historyStore.getActiveId());
                    onClose();
                  }}
                >
                  <GitBranchPlus className="h-4 w-4" />
                  현재 전략에서 새 분기
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2 rounded-full bg-white/80 px-4 shadow-sm"
                  onClick={onClose}
                >
                  <X className="h-4 w-4" />
                  닫기
                  <Kbd>Esc</Kbd>
                </Button>
              </div>
            </div>
          </div>

          <div className="relative min-h-0 flex-1">
            {snapshots.length === 0 ? (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
                저장된 전략 히스토리가 아직 없습니다.
              </div>
            ) : (
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={historyNodeTypes}
                edgeTypes={historyEdgeTypes}
                onNodeClick={(_, node) => {
                  if (node.type === "historyBranch") {
                    handleSelectSnapshot(node.id);
                  }
                }}
                onNodeContextMenu={handleContextMenu}
                onPaneContextMenu={(event) => {
                  event.preventDefault();
                  setContextMenu({
                    x: event.clientX,
                    y: event.clientY,
                    selectedNodes: [],
                  });
                }}
                onPaneClick={() => {
                  setContextMenu(null);
                  // Deselect all nodes when clicking empty canvas
                  setNodes((nds) => nds.map((n) => ({ ...n, selected: false })));
                }}
                fitView
                fitViewOptions={{ padding: 0.16, minZoom: 0.6 }}
                minZoom={0.4}
                maxZoom={1.8}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={true}
                selectionMode={SelectionMode.Partial}
                selectionOnDrag={true}
                panOnDrag={true}
                panOnScroll={false}
                selectNodesOnDrag={false}
                deleteKeyCode={["Backspace", "Delete"]}
                onNodesDelete={handleDeleteSelected}
                multiSelectionKeyCode="Shift"
                className="h-full w-full"
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={24} color="#cbd5e1" />
                <Controls showInteractive={false} position="bottom-right" />
              </ReactFlow>
            )}
          </div>
        </div>

        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            canGroup={contextMenu.selectedNodes.some(n => n.type === 'historyBranch')}
            onHideNodes={handleHideNodes}
            onCopy={handleCopy}
            onPaste={clipboard ? handlePaste : undefined}
            onDelete={handleDeleteSelected}
          />
        )}

        {/* Strategy Picker — shown when a snapshot has multiple solid GroupNodes */}
        {strategyPicker && (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm rounded-2xl"
            onClick={() => setStrategyPicker(null)}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 w-[360px] max-w-full"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-slate-800">실행할 전략 선택</h3>
                <button
                  type="button"
                  onClick={() => setStrategyPicker(null)}
                  className="p-1 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-slate-500 mb-4">
                이 버전 캔버스에 여러 전략이 있습니다. 실행할 전략을 선택해 주세요.
              </p>
              <div className="flex flex-col gap-2">
                {strategyPicker.strategies.map(({ id, label }) => {
                  const alreadyRunning = runningEntries.some(e => e.nodeId === id);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        runningStore.toggleNode(strategyPicker.snapshotId, id, label);
                        setStrategyPicker(null);
                      }}
                      className={cn(
                        "flex items-center justify-between gap-3 w-full px-4 py-3 rounded-xl border text-left text-sm font-medium transition-all",
                        alreadyRunning
                          ? "bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-red-50 hover:border-red-300 hover:text-red-600"
                          : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700"
                      )}
                    >
                      <span>{label}</span>
                      {alreadyRunning ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200 animate-pulse">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          LIVE — 정지
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                          <Play className="w-3 h-3 fill-current" />
                          실행
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
