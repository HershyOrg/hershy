"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  Boxes,
  Clock3,
  GitBranch,
  GitCommitHorizontal,
  Network,
  Play,
  RefreshCw,
  Search,
  Square,
} from "lucide-react";
import { NodeEditor, type NodeEditorInitialGraph } from "@/components/node-editor/NodeEditor";
import { getEtfDcaStrategyNodes, getPepeHedgeStrategyNodes } from "@/lib/demo-data";
import { historyStore, type HistorySnapshot } from "@/lib/historyStore";
import { runningStore } from "@/lib/runningStore";
import { cn } from "@/lib/utils";

type HistoryViewState = {
  snapshots: HistorySnapshot[];
  activeSnapshot: HistorySnapshot | null;
  openTabs: string[];
};

const ROOT_KEY = "__root__";
const DEMO_BASE_TIMESTAMP = Date.UTC(2026, 4, 29, 9, 0, 0);

function formatSnapshotTime(timestamp: number) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
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
    siblings.sort((left, right) => left.timestamp - right.timestamp);
  });

  const ordered: HistorySnapshot[] = [];
  const depthMap = new Map<string, number>();

  const visit = (parentId: string | null, depth: number) => {
    const key = parentId ?? ROOT_KEY;
    const children = childrenByParent.get(key) ?? [];

    children.forEach((child) => {
      depthMap.set(child.id, depth);
      ordered.push(child);
      visit(child.id, depth + 1);
    });
  };

  visit(null, 0);

  const knownIds = new Set(ordered.map((snapshot) => snapshot.id));
  snapshots
    .filter((snapshot) => !knownIds.has(snapshot.id))
    .sort((left, right) => left.timestamp - right.timestamp)
    .forEach((snapshot) => {
      depthMap.set(snapshot.id, 0);
      ordered.push(snapshot);
    });

  return { ordered, depthMap, childrenByParent };
}

function createDemoSnapshots(): HistorySnapshot[] {
  const hedgeGraph = getPepeHedgeStrategyNodes();
  const dcaGraph = getEtfDcaStrategyNodes();

  return [
    {
      id: "advanced-demo-hedge",
      name: "Terminal demo: LP hedge flow",
      parentId: null,
      nodes: hedgeGraph.nodes,
      edges: hedgeGraph.edges,
      timestamp: DEMO_BASE_TIMESTAMP,
    },
    {
      id: "advanced-demo-dca",
      name: "Terminal demo: DCA allocation flow",
      parentId: "advanced-demo-hedge",
      nodes: dcaGraph.nodes,
      edges: dcaGraph.edges,
      timestamp: DEMO_BASE_TIMESTAMP + 1000 * 60 * 42,
    },
  ];
}

function readHistoryViewState(): HistoryViewState {
  return {
    snapshots: historyStore.getSnapshots(),
    activeSnapshot: historyStore.getActiveSnapshot(),
    openTabs: historyStore.getOpenTabs(),
  };
}

function getSnapshotGraph(snapshot: HistorySnapshot | null): NodeEditorInitialGraph | null {
  if (!snapshot) return null;

  return {
    nodes: snapshot.nodes as NodeEditorInitialGraph["nodes"],
    edges: snapshot.edges as NodeEditorInitialGraph["edges"],
  };
}

type WorkbenchNode = NodeEditorInitialGraph["nodes"][number];

function isSolidStrategyBlock(node: WorkbenchNode) {
  const data = node.data as Record<string, unknown> | undefined;
  return node.type === "groupNode" && data?.styleType === "solid";
}

function removeStrategyBlockContainers(graph: NodeEditorInitialGraph | null): NodeEditorInitialGraph | null {
  if (!graph) return null;

  const removedIds = new Set(graph.nodes.filter(isSolidStrategyBlock).map((node) => node.id));
  if (removedIds.size === 0) return graph;

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));

  const liftThroughRemovedParents = (node: WorkbenchNode) => {
    let parentId = node.parentId;
    const position = { ...node.position };

    while (parentId && removedIds.has(parentId)) {
      const parent = nodesById.get(parentId);
      if (!parent) break;
      position.x += parent.position.x;
      position.y += parent.position.y;
      parentId = parent.parentId;
    }

    return { parentId, position };
  };

  const nodes = graph.nodes
    .filter((node) => !removedIds.has(node.id))
    .map((node) => {
      const { parentId, position } = liftThroughRemovedParents(node);
      if (parentId === node.parentId) {
        return { ...node, position };
      }

      const nextNode = { ...node, position };
      if (parentId) {
        nextNode.parentId = parentId;
      } else {
        delete nextNode.parentId;
      }
      delete nextNode.extent;
      delete nextNode.expandParent;
      return nextNode;
    });

  const edges = graph.edges.filter((edge) => !removedIds.has(edge.source) && !removedIds.has(edge.target));

  return { nodes, edges };
}

function formatDelta(value: number) {
  return value > 0 ? `+${value}` : `${value}`;
}

function ActivityStrip({
  snapshots,
  selectedSnapshotId,
}: {
  snapshots: HistorySnapshot[];
  selectedSnapshotId: string | null;
}) {
  const width = 300;
  const height = 48;
  const maxWeight = Math.max(1, ...snapshots.map((snapshot) => snapshot.nodes.length + snapshot.edges.length));
  const points = snapshots.map((snapshot, index) => {
    const x = snapshots.length <= 1 ? width / 2 : (index / (snapshots.length - 1)) * width;
    const weight = snapshot.nodes.length + snapshot.edges.length;
    const y = height - 8 - (weight / maxWeight) * (height - 18);
    return { snapshot, x, y };
  });
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");

  return (
    <svg className="h-12 w-full overflow-visible" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <path d="M 0 38 L 300 38" stroke="rgba(132,142,156,0.22)" strokeWidth="1" />
      {path ? <path d={path} fill="none" stroke="#f0b90b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /> : null}
      {points.map((point) => (
        <circle
          key={point.snapshot.id}
          cx={point.x}
          cy={point.y}
          r={point.snapshot.id === selectedSnapshotId ? 4.6 : 2.9}
          fill={point.snapshot.id === selectedSnapshotId ? "#fcd535" : "#848e9c"}
        />
      ))}
    </svg>
  );
}

export function StrategyLibraryAdvancedWorkbench() {
  const demoSnapshots = useMemo(() => createDemoSnapshots(), []);
  const [historyState, setHistoryState] = useState<HistoryViewState>({
    snapshots: [],
    activeSnapshot: null,
    openTabs: [],
  });
  const runningEntries = useSyncExternalStore(
    (listener) => runningStore.subscribe(listener),
    () => runningStore.getSnapshot(),
    () => runningStore.getSnapshot(),
  );
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [timelineQuery, setTimelineQuery] = useState("");

  const refreshHistoryState = useCallback(() => {
    setHistoryState(readHistoryViewState());
  }, []);

  const selectSnapshot = useCallback((snapshotId: string, shouldUseDemoData: boolean) => {
    setSelectedSnapshotId(snapshotId);

    if (!shouldUseDemoData && historyStore.getSnapshotById(snapshotId)) {
      historyStore.setActiveId(snapshotId);
    }
  }, []);

  const createEditableDraft = useCallback(() => {
    const draft = historyStore.createEmptyStrategy(null, "고급 보기 작업 초안");
    if (draft) {
      setSelectedSnapshotId(draft.id);
    }
  }, []);

  const saveEditableSnapshot = useCallback(() => {
    window.dispatchEvent(new CustomEvent("saveHistorySnapshot"));
  }, []);

  useEffect(() => {
    refreshHistoryState();
    const unsubscribe = historyStore.subscribe(refreshHistoryState);
    return () => {
      unsubscribe();
    };
  }, [refreshHistoryState]);

  useEffect(() => {
    const handleHistorySnapshotSaved = (event: Event) => {
      const snapshot = (event as CustomEvent<HistorySnapshot>).detail;
      if (snapshot?.id) {
        setSelectedSnapshotId(snapshot.id);
      }
    };

    window.addEventListener("historySnapshotSaved", handleHistorySnapshotSaved);
    return () => window.removeEventListener("historySnapshotSaved", handleHistorySnapshotSaved);
  }, []);

  const usingDemoData = historyState.snapshots.length === 0;
  const snapshots = usingDemoData ? demoSnapshots : historyState.snapshots;
  const activeSnapshot = usingDemoData ? demoSnapshots[demoSnapshots.length - 1] : historyState.activeSnapshot;
  const openTabs = usingDemoData ? [activeSnapshot?.id ?? ""] : historyState.openTabs;
  const { ordered, depthMap, childrenByParent } = useMemo(() => orderSnapshots(snapshots), [snapshots]);
  const snapshotMap = useMemo(() => new Map(snapshots.map((snapshot) => [snapshot.id, snapshot])), [snapshots]);
  const selectedSnapshot =
    (selectedSnapshotId ? snapshotMap.get(selectedSnapshotId) : null) ??
    activeSnapshot ??
    ordered[ordered.length - 1] ??
    null;
  const selectedParent = selectedSnapshot?.parentId ? snapshotMap.get(selectedSnapshot.parentId) ?? null : null;
  const selectedChildren = selectedSnapshot ? childrenByParent.get(selectedSnapshot.id) ?? [] : [];
  const selectedGraph = useMemo(
    () => removeStrategyBlockContainers(getSnapshotGraph(selectedSnapshot)),
    [selectedSnapshot],
  );
  const selectedParentGraph = useMemo(
    () => removeStrategyBlockContainers(getSnapshotGraph(selectedParent)),
    [selectedParent],
  );
  const visibleNodes = selectedGraph?.nodes.filter((node) => !node.hidden) ?? [];
  const visibleEdges = selectedGraph?.edges ?? [];
  const nodeDelta = selectedGraph && selectedParentGraph ? selectedGraph.nodes.length - selectedParentGraph.nodes.length : 0;
  const edgeDelta = selectedGraph && selectedParentGraph ? selectedGraph.edges.length - selectedParentGraph.edges.length : 0;
  const selectedSnapshotRunning = Boolean(
    selectedSnapshot && runningEntries.some((entry) => entry.snapshotId === selectedSnapshot.id),
  );
  const branchPointCount = [...childrenByParent.values()].filter((children) => children.length > 1).length;
  const normalizedTimelineQuery = timelineQuery.trim().toLowerCase();
  const displayedSnapshots = normalizedTimelineQuery
    ? ordered.filter((snapshot) =>
      [
        snapshot.name,
        formatSnapshotTime(snapshot.timestamp),
        `${snapshot.nodes.length}`,
        `${snapshot.edges.length}`,
      ].some((value) => value.toLowerCase().includes(normalizedTimelineQuery)),
    )
    : ordered;

  useEffect(() => {
    if (selectedSnapshotId && snapshots.some((snapshot) => snapshot.id === selectedSnapshotId)) return;
    setSelectedSnapshotId(activeSnapshot?.id ?? ordered[ordered.length - 1]?.id ?? null);
  }, [activeSnapshot?.id, ordered, selectedSnapshotId, snapshots]);

  return (
    <div className="dark h-screen overflow-hidden bg-[#0b0e11] text-[#eaecef]">
      <div className="grid h-full min-h-0 grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-r border-[#2b3139] bg-[#181a20]">
          <div className="border-b border-[#2b3139] bg-[#181a20] px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-[#f0b90b]">
                  <Network className="h-3.5 w-3.5" />
                  Strategy Terminal
                </div>
                <h1 className="mt-2 truncate text-xl font-black tracking-tight text-[#eaecef]">전략 터미널</h1>
              </div>
              <Link
                href="/"
                className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-[#2b3139] bg-[#1e2329] px-3 text-xs font-bold text-[#eaecef] hover:border-[#f0b90b] hover:text-[#fcd535]"
              >
                <Boxes className="h-3.5 w-3.5" />
                메인
              </Link>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-md border border-[#2b3139] bg-[#0b0e11] px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#848e9c]">Versions</div>
                <div className="mt-1 text-lg font-black">{snapshots.length}</div>
              </div>
              <div className="rounded-md border border-[#2b3139] bg-[#0b0e11] px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#848e9c]">Branches</div>
                <div className="mt-1 text-lg font-black">{branchPointCount}</div>
              </div>
              <div className="rounded-md border border-[#2b3139] bg-[#0b0e11] px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#848e9c]">Source</div>
                <div className="mt-1 truncate text-sm font-black">{usingDemoData ? "Demo" : "History"}</div>
              </div>
            </div>

            <div className="mt-4 rounded-md border border-[#2b3139] bg-[#0b0e11] px-3 py-2">
              <ActivityStrip snapshots={ordered} selectedSnapshotId={selectedSnapshot?.id ?? null} />
            </div>

            <div className="mt-3 flex items-center gap-2 rounded-md border border-[#2b3139] bg-[#0b0e11] px-3 py-2 text-[#b7bdc6]">
              <Search className="h-4 w-4 text-[#848e9c]" />
              <input
                value={timelineQuery}
                onChange={(event) => setTimelineQuery(event.target.value)}
                placeholder="Search versions..."
                className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#eaecef] placeholder:text-[#5e6673] focus:outline-none"
              />
              <button
                type="button"
                onClick={refreshHistoryState}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#848e9c] hover:bg-[#1e2329] hover:text-[#fcd535]"
                aria-label="Refresh history"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-3">
            {displayedSnapshots.length === 0 ? (
              <div className="rounded-md border border-dashed border-[#2b3139] bg-[#0b0e11] px-4 py-8 text-center text-sm font-semibold text-[#848e9c]">
                검색 결과가 없습니다.
              </div>
            ) : displayedSnapshots.map((snapshot, index) => {
              const depth = depthMap.get(snapshot.id) ?? 0;
              const isCurrent = activeSnapshot?.id === snapshot.id;
              const isSelected = selectedSnapshot?.id === snapshot.id;
              const childCount = childrenByParent.get(snapshot.id)?.length ?? 0;

              return (
                <button
                  key={snapshot.id}
                  type="button"
                  onClick={() => selectSnapshot(snapshot.id, usingDemoData)}
                  className={cn(
                    "group relative grid w-full grid-cols-[76px_48px_minmax(0,1fr)] items-start rounded-md px-2 py-2 text-left transition-colors",
                    isSelected ? "bg-[#1e2329] text-[#eaecef] shadow-[inset_3px_0_0_#f0b90b]" : "text-[#b7bdc6] hover:bg-[#1e2329]",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-1.5 pt-1">
                    {isCurrent ? (
                      <span className="h-2.5 w-2.5 rounded-sm border border-[#f0b90b] bg-[#fcd535]" />
                    ) : (
                      <span className="h-2.5 w-2.5 rounded-sm border border-[#474d57] bg-[#0b0e11]" />
                    )}
                    <span className="truncate text-xs font-black">{depth === 0 ? "main" : `flow/${depth}`}</span>
                  </div>

                  <div className="relative flex justify-center">
                    {index < displayedSnapshots.length - 1 ? (
                      <span className={cn("absolute top-5 h-12 w-[2px]", isSelected ? "bg-[#f0b90b]/60" : "bg-[#474d57]")} />
                    ) : null}
                    <span
                      className={cn(
                        "mt-1 h-3.5 w-3.5 rounded-full border-2",
                        isSelected
                          ? "border-[#fcd535] bg-[#f0b90b]"
                          : isCurrent
                            ? "border-emerald-300 bg-emerald-400"
                            : "border-[#5e6673] bg-[#0b0e11]",
                      )}
                      style={{ marginLeft: `${Math.min(depth, 4) * 8}px` }}
                    />
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="truncate text-sm font-black">{snapshot.name}</div>
                      {openTabs.includes(snapshot.id) ? (
                        <span className="shrink-0 rounded-sm bg-[#f0b90b]/15 px-2 py-0.5 text-[9px] font-black text-[#fcd535]">
                          open
                        </span>
                      ) : null}
                    </div>
                    <div className={cn("mt-1 text-[11px] font-semibold", isSelected ? "text-[#fcd535]/80" : "text-[#848e9c]")}>
                      {formatSnapshotTime(snapshot.timestamp)} · 노드 {snapshot.nodes.length} · 간선 {snapshot.edges.length}
                    </div>
                    <div className="mt-1 flex gap-1">
                      <span className={cn("rounded-sm px-2 py-0.5 text-[9px] font-bold", isSelected ? "bg-[#f0b90b]/12 text-[#fcd535]" : "bg-[#2b3139] text-[#b7bdc6]")}>
                        {depth === 0 ? "root" : childCount > 0 ? "branch" : "save"}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="flex min-h-0 flex-col bg-[#0b0e11] text-[#eaecef]">
          <header className="shrink-0 border-b border-[#2b3139] bg-[#181a20] px-5 py-4">
            {selectedSnapshot ? (
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-sm border border-[#f0b90b]/50 bg-[#f0b90b]/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-[#fcd535]">
                      <Network className="h-3.5 w-3.5" />
                      Live workspace
                    </span>
                    {usingDemoData ? (
                      <span className="rounded-sm border border-[#f0b90b]/40 bg-[#f0b90b]/10 px-3 py-1 text-[11px] font-bold text-[#fcd535]">
                        히스토리가 없어서 데모 그래프를 표시 중
                      </span>
                    ) : null}
                  </div>
                  <h2 className="mt-2 truncate text-2xl font-black tracking-tight">{selectedSnapshot.name}</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-[#848e9c]">
                    <span className="inline-flex items-center gap-1">
                      <Clock3 className="h-3.5 w-3.5" />
                      {formatSnapshotTime(selectedSnapshot.timestamp)}
                    </span>
                    <span>부모: {selectedParent?.name ?? "없음"}</span>
                    <span>자식: {selectedChildren.length}개</span>
                    <span className={nodeDelta >= 0 ? "text-emerald-600" : "text-rose-600"}>노드 {formatDelta(nodeDelta)}</span>
                    <span className={edgeDelta >= 0 ? "text-emerald-600" : "text-rose-600"}>간선 {formatDelta(edgeDelta)}</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-start justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedSnapshot) return;

                      if (runningStore.isSnapshotRunning(selectedSnapshot.id)) {
                        runningStore.stopSnapshot(selectedSnapshot.id);
                        return;
                      }

                      runningStore.startNode(
                        selectedSnapshot.id,
                        `workspace-run-${selectedSnapshot.id}`,
                        selectedSnapshot.name || "전략",
                      );
                    }}
                    className={cn(
                      "inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-black transition-colors",
                      selectedSnapshotRunning
                        ? "border border-[#0ecb81]/50 bg-[#0ecb81]/10 text-[#0ecb81] hover:border-[#f6465d]/60 hover:bg-[#f6465d]/10 hover:text-[#f6465d]"
                        : "bg-[#0ecb81] text-[#0b0e11] hover:bg-[#32d993]",
                    )}
                  >
                    {selectedSnapshotRunning ? (
                      <Square className="h-4 w-4 fill-current" />
                    ) : (
                      <Play className="h-4 w-4 fill-current" />
                    )}
                    {selectedSnapshotRunning ? "정지" : "실행"}
                  </button>
                  <button
                    type="button"
                    onClick={createEditableDraft}
                    className="inline-flex h-10 items-center gap-2 rounded-md border border-[#2b3139] bg-[#1e2329] px-3 text-sm font-bold text-[#eaecef] hover:border-[#f0b90b] hover:text-[#fcd535]"
                  >
                    <Boxes className="h-4 w-4 text-[#f0b90b]" />
                    빈 전략
                  </button>
                  <button
                    type="button"
                    onClick={saveEditableSnapshot}
                    className="inline-flex h-10 items-center gap-2 rounded-md bg-[#f0b90b] px-3 text-sm font-black text-[#0b0e11] hover:bg-[#fcd535]"
                  >
                    <GitCommitHorizontal className="h-4 w-4" />
                    버전 저장
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="w-28 rounded-md border border-[#2b3139] bg-[#0b0e11] px-3 py-2">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#848e9c]">
                      <GitCommitHorizontal className="h-3.5 w-3.5 text-[#f0b90b]" />
                      노드
                    </div>
                    <div className="mt-1 text-2xl font-black">{visibleNodes.length}</div>
                  </div>
                  <div className="w-28 rounded-md border border-[#2b3139] bg-[#0b0e11] px-3 py-2">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#848e9c]">
                      <GitBranch className="h-3.5 w-3.5 text-[#0ecb81]" />
                      간선
                    </div>
                    <div className="mt-1 text-2xl font-black">{visibleEdges.length}</div>
                  </div>
                  <div className="w-28 rounded-md border border-[#2b3139] bg-[#0b0e11] px-3 py-2">
                    <div className="text-[11px] font-bold text-[#848e9c]">모드</div>
                    <div className="mt-2 text-sm font-black text-[#eaecef]">Edit</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm font-bold text-[#848e9c]">선택된 전략 버전이 없습니다.</div>
            )}
          </header>

          <section className="min-h-0 flex-1 bg-[#0b0e11] p-3">
            <div className="h-full min-h-[620px] overflow-hidden rounded-md border border-[#2b3139] bg-[#0b0e11]">
              {selectedGraph && selectedSnapshot ? (
                <NodeEditor
                  key={`${selectedSnapshot.id}-${selectedSnapshot.timestamp}`}
                  initialGraph={selectedGraph}
                  initialGraphVersion={selectedSnapshot.timestamp}
                  programCode=""
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm font-semibold text-[#848e9c]">
                  고급 보기로 표시할 노드가 없습니다.
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
