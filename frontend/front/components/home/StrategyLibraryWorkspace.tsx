"use client";

import { useEffect, useState } from "react";
import {
  Clock3,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  PlayCircle,
  Plus,
  Save,
  Search,
  Sparkles,
} from "lucide-react";
import { NodeEditor, type NodeEditorInitialGraph } from "@/components/node-editor/NodeEditor";
import { EasyStrategyGraph } from "@/components/strategy-builder/EasyStrategyGraph";
import {
  advancedGraphToStrategyGraph,
  createEasyViewFromStrategyGraph,
  type EasyViewModel,
} from "@/lib/easyViewAgent";
import { cn } from "@/lib/utils";
import type { HistorySnapshot } from "@/lib/historyStore";

type StrategyLibraryWorkspaceProps = {
  snapshots: HistorySnapshot[];
  activeSnapshot: HistorySnapshot | null;
  openTabs: string[];
  programCode: string;
  onOpenHistory: () => void;
  onCreateTemplate: () => void;
  onCreateBranch: () => void;
  onSaveVersion: () => void;
  onCheckoutTemplate: (snapshotId: string) => void;
};

type NodeViewMode = "easy" | "advanced";

const ROOT_KEY = "__root__";

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

  const visit = (parentId: string | null, depth: number, depthMap: Map<string, number>) => {
    const key = parentId ?? ROOT_KEY;
    const children = childrenByParent.get(key) ?? [];

    children.forEach((child) => {
      depthMap.set(child.id, depth);
      ordered.push(child);
      visit(child.id, depth + 1, depthMap);
    });
  };

  const depthMap = new Map<string, number>();
  visit(null, 0, depthMap);

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

function formatDelta(value: number) {
  if (value > 0) return `+${value}`;
  return `${value}`;
}

function getVisibleNodes(snapshot?: HistorySnapshot | null) {
  return (snapshot?.nodes ?? []).filter((node: any) => !node?.hidden);
}

function getSnapshotGraph(snapshot: HistorySnapshot | null): NodeEditorInitialGraph | null {
  if (!snapshot || snapshot.nodes.length === 0) return null;
  return {
    nodes: snapshot.nodes as NodeEditorInitialGraph["nodes"],
    edges: snapshot.edges as NodeEditorInitialGraph["edges"],
  };
}

function getSnapshotEasyView(snapshot: HistorySnapshot | null): EasyViewModel | null {
  const graph = getSnapshotGraph(snapshot);
  if (!graph) return null;

  try {
    return createEasyViewFromStrategyGraph(advancedGraphToStrategyGraph(graph, snapshot?.name ?? "저장된 전략"));
  } catch {
    return null;
  }
}

function VersionActivityStrip({
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
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");

  return (
    <svg className="h-12 w-full overflow-visible" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <path d="M 0 38 L 300 38" stroke="rgba(148,163,184,0.18)" strokeWidth="1" />
      {path ? <path d={path} fill="none" stroke="#f0abfc" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /> : null}
      {points.map((point) => (
        <circle
          key={point.snapshot.id}
          cx={point.x}
          cy={point.y}
          r={point.snapshot.id === selectedSnapshotId ? 4.6 : 2.9}
          fill={point.snapshot.id === selectedSnapshotId ? "#22d3ee" : "#a78bfa"}
        />
      ))}
    </svg>
  );
}

export function StrategyLibraryWorkspace({
  snapshots,
  activeSnapshot,
  openTabs,
  programCode,
  onOpenHistory,
  onCreateTemplate,
  onCreateBranch,
  onSaveVersion,
  onCheckoutTemplate,
}: StrategyLibraryWorkspaceProps) {
  const { ordered, depthMap, childrenByParent } = orderSnapshots(snapshots);
  const snapshotMap = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const branchPointCount = [...childrenByParent.values()].filter((children) => children.length > 1).length;
  const rootCount = childrenByParent.get(ROOT_KEY)?.length ?? 0;
  const leafCount = ordered.filter((snapshot) => (childrenByParent.get(snapshot.id)?.length ?? 0) === 0).length;

  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(
    activeSnapshot?.id ?? ordered[ordered.length - 1]?.id ?? null,
  );
  const [nodeViewMode, setNodeViewMode] = useState<NodeViewMode>("easy");
  const [timelineQuery, setTimelineQuery] = useState("");

  useEffect(() => {
    if (selectedSnapshotId && snapshots.some((snapshot) => snapshot.id === selectedSnapshotId)) return;
    setSelectedSnapshotId(activeSnapshot?.id ?? ordered[ordered.length - 1]?.id ?? null);
  }, [activeSnapshot?.id, ordered, selectedSnapshotId, snapshots]);

  const selectedSnapshot = (selectedSnapshotId ? snapshotMap.get(selectedSnapshotId) : null)
    ?? activeSnapshot
    ?? ordered[ordered.length - 1]
    ?? null;
  const selectedParent = selectedSnapshot?.parentId ? snapshotMap.get(selectedSnapshot.parentId) ?? null : null;
  const selectedChildren = selectedSnapshot ? childrenByParent.get(selectedSnapshot.id) ?? [] : [];
  const nodeDelta = selectedSnapshot && selectedParent ? selectedSnapshot.nodes.length - selectedParent.nodes.length : 0;
  const edgeDelta = selectedSnapshot && selectedParent ? selectedSnapshot.edges.length - selectedParent.edges.length : 0;
  const visibleNodes = getVisibleNodes(selectedSnapshot);
  const visibleEdges = selectedSnapshot?.edges ?? [];
  const selectedGraph = getSnapshotGraph(selectedSnapshot);
  const selectedEasyView = getSnapshotEasyView(selectedSnapshot);
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

  return (
    <div className="h-full overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.14),transparent_30%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] text-slate-950">
      <div className="flex h-full flex-col gap-3 p-4 lg:p-5">
        <section className="shrink-0 rounded-[24px] border border-slate-200 bg-white/90 px-4 py-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-800">
                  Strategy History
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600">
                  저장 버전 {snapshots.length}개
                </span>
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700">
                  갈림길 {branchPointCount}개
                </span>
              </div>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">
                GitLens처럼 버전을 훑고, 실제 노드를 바로 확인합니다.
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onSaveVersion}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-black text-white hover:bg-slate-800"
              >
                <Save className="h-4 w-4 text-emerald-300" />
                현재 버전 저장
              </button>
              <button
                type="button"
                onClick={onCreateBranch}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                <GitBranch className="h-4 w-4 text-amber-500" />
                새 흐름
              </button>
              <button
                type="button"
                onClick={onCreateTemplate}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                <Plus className="h-4 w-4 text-cyan-500" />
                새 전략
              </button>
            </div>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500">
                <GitCommitHorizontal className="h-4 w-4 text-cyan-600" />
                저장 버전
              </div>
              <div className="mt-1 text-2xl font-black">{snapshots.length}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500">
                <GitBranch className="h-4 w-4 text-amber-600" />
                시작 전략
              </div>
              <div className="mt-1 text-2xl font-black">{rootCount}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500">
                <GitMerge className="h-4 w-4 text-emerald-600" />
                최신 흐름
              </div>
              <div className="mt-1 text-2xl font-black">{leafCount}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500">
                <Sparkles className="h-4 w-4 text-violet-600" />
                실행 코드
              </div>
              <div className="mt-1 text-2xl font-black">{programCode ? "있음" : "초안"}</div>
            </div>
          </div>
        </section>

        <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[380px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-hidden rounded-[24px] border border-slate-800 bg-[#111014] text-white shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
            <div className="border-b border-white/10 bg-[#18161c] px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[11px] font-black text-slate-400">
                    strategy-history <span className="px-1 text-slate-600">›</span> main <span className="px-1 text-slate-600">›</span> Fetch
                  </div>
                  <h3 className="mt-1 text-lg font-black tracking-tight">버전 타임라인</h3>
                </div>
                <button
                  type="button"
                  onClick={onOpenHistory}
                  className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 text-xs font-bold text-slate-200 hover:bg-white/10"
                >
                  <Clock3 className="h-3.5 w-3.5" />
                  전체
                </button>
              </div>

              <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-slate-300">
                <Search className="h-4 w-4 text-slate-500" />
                <input
                  value={timelineQuery}
                  onChange={(event) => setTimelineQuery(event.target.value)}
                  placeholder="Search versions..."
                  className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-100 placeholder:text-slate-600 focus:outline-none"
                />
              </div>

              <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                <VersionActivityStrip snapshots={ordered} selectedSnapshotId={selectedSnapshot?.id ?? null} />
              </div>

              <div className="mt-3 grid grid-cols-[92px_64px_minmax(0,1fr)] border-t border-white/10 pt-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                <span>Branch / Tag</span>
                <span>Graph</span>
                <span>Version</span>
              </div>
            </div>

            {ordered.length === 0 ? (
              <div className="m-3 rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-8 text-center">
                <div className="text-sm font-black text-white">저장된 전략이 없습니다</div>
                <p className="mt-2 text-xs leading-5 text-slate-400">현재 전략을 저장하면 여기에 작은 버전 그래프가 생깁니다.</p>
                <button
                  type="button"
                  onClick={onCreateTemplate}
                  className="mt-4 inline-flex h-9 items-center gap-2 rounded-xl bg-white px-3 text-xs font-black text-slate-950"
                >
                  <Plus className="h-4 w-4" />
                  첫 전략 만들기
                </button>
              </div>
            ) : (
              <div className="max-h-[calc(100vh-344px)] overflow-auto p-2">
                {displayedSnapshots.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-8 text-center text-sm font-semibold text-slate-400">
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
                      onClick={() => setSelectedSnapshotId(snapshot.id)}
                      className={cn(
                        "group relative grid w-full grid-cols-[92px_64px_minmax(0,1fr)] items-start rounded-xl px-2 py-2 text-left transition-colors",
                        isSelected ? "bg-[#132d35] text-slate-50 shadow-[inset_3px_0_0_#22d3ee]" : "text-slate-200 hover:bg-white/10",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-1.5 pt-1">
                        {isCurrent ? (
                          <span className="h-2.5 w-2.5 rounded-sm border border-cyan-300 bg-cyan-400" />
                        ) : (
                          <span className="h-2.5 w-2.5 rounded-sm border border-slate-600 bg-slate-900" />
                        )}
                        <span className="truncate text-xs font-black">{depth === 0 ? "main" : `flow/${depth}`}</span>
                      </div>

                      <div className="relative flex justify-center">
                        {index < displayedSnapshots.length - 1 ? (
                          <span className={cn(
                            "absolute top-5 h-12 w-[2px]",
                            isSelected ? "bg-cyan-400/55" : "bg-slate-700",
                          )} />
                        ) : null}
                        <span
                          className={cn(
                            "mt-1 h-3.5 w-3.5 rounded-full border-2",
                            isSelected
                              ? "border-cyan-200 bg-cyan-400"
                              : isCurrent
                                ? "border-emerald-300 bg-emerald-400"
                                : "border-slate-500 bg-slate-950",
                          )}
                          style={{ marginLeft: `${Math.min(depth, 4) * 9}px` }}
                        />
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="truncate text-sm font-black">{snapshot.name}</div>
                          {isCurrent ? (
                            <span className={cn(
                              "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black",
                              isSelected ? "bg-emerald-400/20 text-emerald-100" : "bg-emerald-400/20 text-emerald-200",
                            )}>
                              현재
                            </span>
                          ) : null}
                        </div>
                        <div className={cn("mt-1 text-[11px] font-semibold", isSelected ? "text-cyan-100/75" : "text-slate-400")}>
                          {formatSnapshotTime(snapshot.timestamp)} · 노드 {snapshot.nodes.length} · 간선 {snapshot.edges.length}
                        </div>
                        <div className="mt-1 flex gap-1">
                          <span className={cn(
                            "rounded-full px-2 py-0.5 text-[9px] font-bold",
                            isSelected ? "bg-white/10 text-cyan-100" : "bg-white/10 text-slate-300",
                          )}>
                            {depth === 0 ? "시작" : childCount > 0 ? "갈림" : "저장"}
                          </span>
                          {openTabs.includes(snapshot.id) ? (
                            <span className={cn(
                              "rounded-full px-2 py-0.5 text-[9px] font-bold",
                              isSelected ? "bg-indigo-400/20 text-indigo-100" : "bg-indigo-400/20 text-indigo-200",
                            )}>
                              작업 중
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </aside>

          <main className="min-h-0 overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
            {selectedSnapshot ? (
              <div className="flex h-full min-h-0 flex-col">
                <div className="shrink-0 border-b border-slate-200 bg-[linear-gradient(135deg,#ffffff_0%,#f8fafc_100%)] px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">선택한 버전</div>
                      <h3 className="mt-1 truncate text-2xl font-black text-slate-950">{selectedSnapshot.name}</h3>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
                        <span>{formatSnapshotTime(selectedSnapshot.timestamp)}</span>
                        <span>부모: {selectedParent?.name ?? "없음"}</span>
                        <span>자식: {selectedChildren.length}개</span>
                        <span className={nodeDelta >= 0 ? "text-emerald-600" : "text-rose-600"}>노드 {formatDelta(nodeDelta)}</span>
                        <span className={edgeDelta >= 0 ? "text-emerald-600" : "text-rose-600"}>간선 {formatDelta(edgeDelta)}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onCheckoutTemplate(selectedSnapshot.id)}
                        className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-black text-white hover:bg-slate-800"
                      >
                        <PlayCircle className="h-4 w-4 text-cyan-300" />
                        이 버전을 빌더에서 열기
                      </button>
                      <button
                        type="button"
                        onClick={onSaveVersion}
                        className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"
                      >
                        <Save className="h-4 w-4 text-emerald-600" />
                        현재 상태 저장
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-4">
                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                      <div className="text-[11px] font-bold text-slate-500">실제 노드</div>
                      <div className="mt-1 text-2xl font-black">{visibleNodes.length}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                      <div className="text-[11px] font-bold text-slate-500">간선</div>
                      <div className="mt-1 text-2xl font-black">{visibleEdges.length}</div>
                    </div>
	                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
	                      <div className="text-[11px] font-bold text-slate-500">쉬운 보기 항목</div>
	                      <div className="mt-1 text-2xl font-black">{selectedEasyView?.nodes.length ?? 0}</div>
	                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                      <div className="text-[11px] font-bold text-slate-500">열린 탭</div>
                      <div className="mt-1 text-2xl font-black">{openTabs.length}</div>
                    </div>
                  </div>

                  <div className="mt-4 inline-flex rounded-2xl border border-slate-200 bg-slate-100 p-1">
                    {([
                      ["easy", "쉬운 보기 노드"],
                      ["advanced", "고급 보기 노드"],
                    ] as const).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setNodeViewMode(mode)}
                        className={cn(
                          "h-9 rounded-xl px-4 text-sm font-black transition-colors",
                          nodeViewMode === mode ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

	                <div className="min-h-0 flex-1 overflow-hidden p-5">
	                  {nodeViewMode === "easy" ? (
	                    <div className="h-full min-h-[620px] overflow-hidden rounded-[28px] border border-slate-200 bg-slate-50">
	                      {selectedEasyView ? (
	                        <EasyStrategyGraph model={selectedEasyView} />
	                      ) : (
	                        <div className="flex h-full items-center justify-center text-sm font-semibold text-slate-500">
	                          쉬운 보기로 변환할 노드가 없습니다.
	                        </div>
	                      )}
	                    </div>
	                  ) : (
	                    <div className="h-full min-h-[620px] overflow-hidden rounded-[28px] border border-slate-200 bg-slate-950">
	                      {selectedGraph ? (
	                        <NodeEditor
	                          key={selectedSnapshot.id}
	                          initialGraph={selectedGraph}
	                          initialGraphVersion={selectedSnapshot.timestamp}
	                          programCode={programCode}
	                          previewMode
	                        />
	                      ) : (
	                        <div className="flex h-full items-center justify-center text-sm font-semibold text-slate-400">
	                          고급 보기로 표시할 노드가 없습니다.
	                        </div>
	                      )}
	                    </div>
	                  )}
	                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center p-8 text-center">
                <div>
                  <div className="text-xl font-black text-slate-950">선택된 전략 버전이 없습니다</div>
                  <p className="mt-2 text-sm text-slate-500">전략을 저장하거나 왼쪽에서 버전을 선택해 주세요.</p>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
