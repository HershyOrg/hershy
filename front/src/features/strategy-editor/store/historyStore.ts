import {
  readHistoryState,
  writeHistoryState,
} from "@/shared/store/clientStateStore";
import type {
  HistorySnapshot,
  HistorySnapshotCodeMeta,
  HistorySnapshotGroup,
  HistoryStoreState,
  PersistedHistoryStoreState,
} from "@/shared/types/domain";

export type {
  HistorySnapshot,
  HistorySnapshotCodeMeta,
  HistorySnapshotGroup,
} from "@/shared/types/domain";

type Listener = () => void;

const TRANSIENT_GRAPH_DATA_KEYS = new Set([
  "chartSeries",
  "chartSource",
  "chartUpdatedAt",
  "chartWarning",
  "conditionMet",
  "isHighlighted",
  "revealTick",
  "runtimeCode",
  "runtimeCodeLabel",
  "transition",
]);
const TRANSIENT_NODE_KEYS = new Set([
  "dragging",
  "hidden",
  "internals",
  "measured",
  "positionAbsolute",
  "resizing",
  "selected",
  "zIndex",
]);
const TRANSIENT_EDGE_KEYS = new Set([
  "selected",
]);

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function clonePersistableGraphValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(clonePersistableGraphValue);
  }

  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    Object.keys(source).forEach((key) => {
      if (TRANSIENT_GRAPH_DATA_KEYS.has(key)) return;
      next[key] = clonePersistableGraphValue(source[key]);
    });
    return next;
  }

  return value;
}

function clonePersistableGraphEntry(entry: any, transientKeys: Set<string>) {
  const next: Record<string, unknown> = {};

  Object.keys(entry).forEach((key) => {
    if (transientKeys.has(key)) return;
    next[key] = clonePersistableGraphValue(entry[key]);
  });

  return next;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "undefined";
}

function isTriggerFormulaSourceHandle(sourceHandle: unknown) {
  return typeof sourceHandle === "string" && /-trigger-.+-out$/.test(sourceHandle);
}

function isConditionJunctionSourceHandle(sourceHandle: unknown) {
  return typeof sourceHandle === "string" && sourceHandle.endsWith("-condition-out");
}

function shouldUseConditionMergeEdge(edge: any, targetNode: any) {
  const isConditionJunctionTarget =
    targetNode?.type === "conditionJunction" ||
    (typeof edge.target === "string" &&
      edge.target.startsWith("condition-junction-") &&
      typeof edge.targetHandle === "string" &&
      edge.targetHandle.includes("-input-"));
  const isActionTarget = targetNode
    ? targetNode.type === "actionNode" || targetNode.type === "timelineFrame"
    : typeof edge.target === "string" &&
      (edge.target.startsWith("action-") ||
        (typeof edge.targetHandle === "string" && edge.targetHandle.startsWith("action-")));

  return isConditionJunctionTarget ||
    (isActionTarget &&
      (isTriggerFormulaSourceHandle(edge.sourceHandle) || isConditionJunctionSourceHandle(edge.sourceHandle)));
}

function normalizePersistedEdgeTypes(nodes: any[], edges: any[]) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  return edges.map((edge) => {
    const targetNode = nodesById.get(edge.target);
    if (!shouldUseConditionMergeEdge(edge, targetNode)) return edge;

    const data = edge.data && typeof edge.data === "object" ? edge.data : {};
    const isActionTarget = targetNode
      ? targetNode.type === "actionNode" || targetNode.type === "timelineFrame"
      : typeof edge.target === "string" &&
        (edge.target.startsWith("action-") ||
          (typeof edge.targetHandle === "string" && edge.targetHandle.startsWith("action-")));

    return {
      ...edge,
      type: "conditionMerge",
      data: {
        ...data,
        ...(isActionTarget ? { delay: 0, waitForResult: true } : {}),
        logicMode: data.logicMode === "OR" ? "OR" : "AND",
      },
    };
  });
}

function hasParentCycle(node: any, nodesById: Map<string, any>) {
  const visited = new Set<string>([node.id]);
  let parentId = node.parentId;

  while (typeof parentId === "string" && parentId.length > 0) {
    if (visited.has(parentId)) return true;
    visited.add(parentId);
    parentId = nodesById.get(parentId)?.parentId;
  }

  return false;
}

function orderParentNodesFirst(nodes: any[]) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const ordered: any[] = [];
  const visited = new Set<string>();

  const visit = (node: any) => {
    if (visited.has(node.id)) return;
    const parent = typeof node.parentId === "string" ? nodesById.get(node.parentId) : null;
    if (parent) visit(parent);
    visited.add(node.id);
    ordered.push(node);
  };

  nodes.forEach(visit);
  return ordered;
}

function cloneGraph(nodes: any[], edges: any[]) {
  const seenNodeIds = new Set<string>();
  const clonedNodes = nodes.reduce<any[]>((nextNodes, node) => {
    if (
      !node ||
      typeof node !== "object" ||
      typeof node.id !== "string" ||
      node.id.trim().length === 0 ||
      seenNodeIds.has(node.id)
    ) {
      return nextNodes;
    }

    seenNodeIds.add(node.id);
    nextNodes.push(clonePersistableGraphEntry(node, TRANSIENT_NODE_KEYS));
    return nextNodes;
  }, []);
  const validNodeIds = new Set(clonedNodes.map((node) => node.id));
  const nodesById = new Map(clonedNodes.map((node) => [node.id, node]));
  const parentSafeNodes = clonedNodes.map((node) => {
    if (
      typeof node.parentId !== "string" ||
      node.parentId.length === 0 ||
      (validNodeIds.has(node.parentId) && !hasParentCycle(node, nodesById))
    ) {
      return node;
    }

    const nextNode = { ...node };
    delete nextNode.parentId;
    delete nextNode.expandParent;
    if (nextNode.extent === "parent") {
      delete nextNode.extent;
    }
    return nextNode;
  });
  const orderedNodes = orderParentNodesFirst(parentSafeNodes);
  const nodeIds = new Set(orderedNodes.map((node) => node.id));
  const seenEdgeIds = new Set<string>();
  const clonedEdges = edges.reduce<any[]>((nextEdges, edge) => {
    if (
      !edge ||
      typeof edge !== "object" ||
      typeof edge.id !== "string" ||
      edge.id.trim().length === 0 ||
      typeof edge.source !== "string" ||
      typeof edge.target !== "string" ||
      !nodeIds.has(edge.source) ||
      !nodeIds.has(edge.target) ||
      seenEdgeIds.has(edge.id)
    ) {
      return nextEdges;
    }

    seenEdgeIds.add(edge.id);
    nextEdges.push(clonePersistableGraphEntry(edge, TRANSIENT_EDGE_KEYS));
    return nextEdges;
  }, []);

  return {
    nodes: orderedNodes,
    edges: normalizePersistedEdgeTypes(orderedNodes, clonedEdges),
  };
}

function graphSignature(nodes: any[], edges: any[]) {
  return JSON.stringify({ nodes, edges });
}

function readOptionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function normalizeCodeMeta(value: unknown): HistorySnapshotCodeMeta | undefined {
  if (!value || typeof value !== "object") return undefined;
  const meta = value as HistorySnapshotCodeMeta;
  const next: HistorySnapshotCodeMeta = {};

  const strategyTitle = readOptionalString(meta.strategyTitle);
  const strategySummary = readOptionalString(meta.strategySummary);
  const generatedCode = readOptionalString(meta.generatedCode);
  const programCode = readOptionalString(meta.programCode);
  const graphSignature = readOptionalString(meta.graphSignature);
  const programCodeSignature = readOptionalString(meta.programCodeSignature);
  const aiSummary = readOptionalString(meta.aiSummary);
  const agentSteps = Array.isArray(meta.agentSteps)
    ? meta.agentSteps.filter((step): step is string => typeof step === "string")
    : undefined;

  if (strategyTitle !== undefined) next.strategyTitle = strategyTitle;
  if (strategySummary !== undefined) next.strategySummary = strategySummary;
  if (generatedCode !== undefined) next.generatedCode = generatedCode;
  if (programCode !== undefined) next.programCode = programCode;
  if (meta.strategyGraph !== undefined) next.strategyGraph = cloneValue(meta.strategyGraph);
  if (graphSignature !== undefined) next.graphSignature = graphSignature;
  if (programCodeSignature !== undefined) next.programCodeSignature = programCodeSignature;
  if (aiSummary !== undefined) next.aiSummary = aiSummary;
  if (agentSteps !== undefined) next.agentSteps = cloneValue(agentSteps);

  return Object.keys(next).length > 0 ? next : undefined;
}

function mergeCodeMeta(
  current: HistorySnapshotCodeMeta | undefined,
  patch?: HistorySnapshotCodeMeta | null,
) {
  if (patch === undefined) return normalizeCodeMeta(current);
  if (patch === null) return undefined;
  return normalizeCodeMeta({ ...(current ?? {}), ...patch });
}

function codeMetaSignature(value: HistorySnapshotCodeMeta | undefined) {
  return stableStringify(normalizeCodeMeta(value) ?? null);
}

class HistoryStore {
  private snapshots: HistorySnapshot[] = [];
  private activeId: string | null = null;
  private openTabs: string[] = [];
  private hiddenGroups: HistorySnapshotGroup[] = [];
  private listeners: Set<Listener> = new Set();
  private isInitialized = false;

  private undoStack: HistoryStoreState[] = [];
  private redoStack: HistoryStoreState[] = [];

  constructor() {
    this.hydrateFromStorage();
  }

  private normalizeLoadedState(state: PersistedHistoryStoreState): HistoryStoreState | null {
    if (!Array.isArray(state.snapshots)) return null;

    const snapshots = state.snapshots
      .filter((snapshot) =>
        snapshot &&
        typeof snapshot.id === "string" &&
        typeof snapshot.name === "string" &&
        Array.isArray(snapshot.nodes) &&
        Array.isArray(snapshot.edges),
      )
      .map((snapshot) => this.cloneSnapshot({
        ...snapshot,
        parentId: typeof snapshot.parentId === "string" ? snapshot.parentId : null,
        timestamp: typeof snapshot.timestamp === "number" ? snapshot.timestamp : Date.now(),
      }));

    if (snapshots.length === 0) return null;

    const snapshotIds = new Set(snapshots.map((snapshot) => snapshot.id));
    const activeId = state.activeId && snapshotIds.has(state.activeId)
      ? state.activeId
      : snapshots[snapshots.length - 1].id;
    const openTabs = Array.isArray(state.openTabs)
      ? state.openTabs.filter((id) => snapshotIds.has(id))
      : [];
    if (activeId && !openTabs.includes(activeId)) {
      openTabs.push(activeId);
    }

    const hiddenGroups = Array.isArray(state.hiddenGroups)
      ? state.hiddenGroups
        .filter((group) => group && typeof group.id === "string" && Array.isArray(group.snapshotIds))
        .map((group) => ({
          id: group.id,
          snapshotIds: group.snapshotIds.filter((id) => snapshotIds.has(id)),
        }))
        .filter((group) => group.snapshotIds.length > 0)
      : [];

    return {
      snapshots,
      activeId,
      openTabs,
      hiddenGroups,
    };
  }

  private hydrateFromStorage() {
    try {
      const parsed = readHistoryState();
      if (!parsed) return;
      const loaded = this.normalizeLoadedState(parsed);
      if (!loaded) return;

      this.snapshots = loaded.snapshots;
      this.activeId = loaded.activeId;
      this.openTabs = loaded.openTabs;
      this.hiddenGroups = loaded.hiddenGroups;
      this.isInitialized = true;
    } catch (error) {
      console.warn("[historyStore] failed to restore persisted strategy history", error);
    }
  }

  private persistToStorage() {
    try {
      const payload: PersistedHistoryStoreState = {
        version: 1,
        savedAt: Date.now(),
        snapshots: this.snapshots.map((snapshot) => this.cloneSnapshot(snapshot)),
        activeId: this.activeId,
        openTabs: cloneValue(this.openTabs),
        hiddenGroups: cloneValue(this.hiddenGroups),
      };
      writeHistoryState(payload);
    } catch (error) {
      console.warn("[historyStore] failed to persist strategy history", error);
    }
  }

  private dispatchSnapshotLoad(snapshot: HistorySnapshot | null) {
    if (typeof window === "undefined") return;

    if (!snapshot) {
      window.dispatchEvent(
        new CustomEvent("loadSnapshot", {
          detail: {
            nodes: [],
            edges: [],
          },
        }),
      );
      return;
    }

    window.dispatchEvent(
      new CustomEvent("loadSnapshot", {
        detail: this.cloneSnapshot(snapshot),
      }),
    );
  }

  private dispatchSnapshotSaved(snapshot: HistorySnapshot) {
    if (typeof window === "undefined") return;

    window.dispatchEvent(
      new CustomEvent("historySnapshotSaved", {
        detail: this.cloneSnapshot(snapshot),
      }),
    );
  }

  private ensureTabOpen(id: string) {
    if (!this.openTabs.includes(id)) {
      this.openTabs.push(id);
    }
  }

  getSnapshotById(id: string | null) {
    if (!id) return null;
    return this.snapshots.find((snapshot) => snapshot.id === id) ?? null;
  }

  private buildNextSnapshotName(parentId: string | null, fallbackName = "New Strategy Template") {
    if (!parentId) {
      const rootSnapshots = this.snapshots.filter(
        (snapshot) => snapshot.parentId === null && snapshot.name.startsWith(fallbackName),
      );

      return rootSnapshots.length > 0 ? `${fallbackName}-${rootSnapshots.length + 1}` : fallbackName;
    }

    const parent = this.snapshots.find((snapshot) => snapshot.id === parentId);
    if (!parent) {
      return fallbackName;
    }

    let baseName = parent.name.replace(/-\d+.*$/, "");
    if (!baseName.trim()) {
      baseName = fallbackName;
    }

    const children = this.snapshots.filter((snapshot) => snapshot.parentId === parentId);

    if (children.length === 0) {
      const match = parent.name.match(/-(\d+)$/);
      if (match) {
        return `${baseName}-${parseInt(match[1], 10) + 1}`;
      }
      return `${baseName}-1`;
    }

    const alphabet = "abcdefghijklmnopqrstuvwxyz";
    const existingBranchLetters = children
      .map((child) => {
        const match = child.name.match(/-([a-z])$/);
        return match ? match[1] : null;
      })
      .filter(Boolean) as string[];

    let nextLetter = "a";
    for (const char of alphabet) {
      if (!existingBranchLetters.includes(char)) {
        nextLetter = char;
        break;
      }
    }

    const parentNumMatch = parent.name.match(/-(\d+)/);
    const parentNumStr = parentNumMatch ? `-${parentNumMatch[1]}` : "-1";
    return `${baseName}${parentNumStr}-${nextLetter}`;
  }

  private saveHistoryState() {
    this.undoStack.push({
      snapshots: cloneValue(this.snapshots),
      activeId: this.activeId,
      openTabs: cloneValue(this.openTabs),
      hiddenGroups: cloneValue(this.hiddenGroups),
    });
    this.redoStack = [];
    // Keep max 20 states
    if (this.undoStack.length > 20) {
      this.undoStack.shift();
    }
  }

  undo() {
    if (this.undoStack.length === 0) return;
    const currentState = {
      snapshots: cloneValue(this.snapshots),
      activeId: this.activeId,
      openTabs: cloneValue(this.openTabs),
      hiddenGroups: cloneValue(this.hiddenGroups),
    };
    this.redoStack.push(currentState);

    const prevState = this.undoStack.pop()!;
    this.snapshots = prevState.snapshots;
    this.activeId = prevState.activeId;
    this.openTabs = prevState.openTabs;
    this.hiddenGroups = prevState.hiddenGroups;
    this.notify();
    this.dispatchSnapshotLoad(this.getSnapshotById(this.activeId));
  }

  redo() {
    if (this.redoStack.length === 0) return;
    const currentState = {
      snapshots: cloneValue(this.snapshots),
      activeId: this.activeId,
      openTabs: cloneValue(this.openTabs),
      hiddenGroups: cloneValue(this.hiddenGroups),
    };
    this.undoStack.push(currentState);

    const nextState = this.redoStack.pop()!;
    this.snapshots = nextState.snapshots;
    this.activeId = nextState.activeId;
    this.openTabs = nextState.openTabs;
    this.hiddenGroups = nextState.hiddenGroups;
    this.notify();
    this.dispatchSnapshotLoad(this.getSnapshotById(this.activeId));
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.persistToStorage();
    this.listeners.forEach(l => l());
  }

  getHiddenGroups(): HistorySnapshotGroup[] {
    return cloneValue(this.hiddenGroups);
  }

  getOpenTabs(): string[] {
    return cloneValue(this.openTabs);
  }

  getActiveSnapshot() {
    const snapshot = this.getSnapshotById(this.activeId);
    return snapshot ? this.cloneSnapshot(snapshot) : null;
  }

  openTab(id: string) {
    this.ensureTabOpen(id);
    this.setActiveId(id);
  }

  closeTab(id: string) {
    this.openTabs = this.openTabs.filter(tabId => tabId !== id);
    if (this.activeId === id) {
      if (this.openTabs.length > 0) {
        const nextId = this.openTabs[this.openTabs.length - 1];
        this.activeId = nextId;
        this.notify();
        this.dispatchSnapshotLoad(this.getSnapshotById(nextId));
      } else {
        this.activeId = null; // No tabs open
        this.notify();
        this.dispatchSnapshotLoad(null);
      }
    } else {
      this.notify();
    }
  }


  private cloneSnapshot(snapshot: HistorySnapshot): HistorySnapshot {
    const { nodes, edges } = cloneGraph(snapshot.nodes, snapshot.edges);
    const { codeMeta: rawCodeMeta, ...rest } = snapshot;
    const codeMeta = normalizeCodeMeta(rawCodeMeta);

    return {
      ...rest,
      nodes,
      edges,
      ...(codeMeta ? { codeMeta } : {}),
    };
  }

  init(initialSnapshot: HistorySnapshot) {
    if (this.isInitialized || this.snapshots.length > 0) {
      this.isInitialized = true;
      return;
    }

    const baseSnapshot = this.cloneSnapshot(initialSnapshot);
    this.snapshots = [baseSnapshot];
    this.activeId = baseSnapshot.id;
    this.openTabs = [this.activeId];
    this.isInitialized = true;
    this.notify();
    this.dispatchSnapshotLoad(this.getSnapshotById(this.activeId));
  }

  getSnapshots() {
    return this.snapshots.map((snapshot) => this.cloneSnapshot(snapshot));
  }

  getActiveId() {
    return this.activeId;
  }

  setActiveId(id: string) {
    if (id) {
      this.ensureTabOpen(id);
    }
    this.activeId = id;
    this.notify();
    this.dispatchSnapshotLoad(this.getSnapshotById(id));
  }

  updateSnapshotName(id: string, name: string) {
    const snap = this.snapshots.find(s => s.id === id);
    if (snap) {
      snap.name = name;
      this.notify();
    }
  }

  updateActiveSnapshot(nodes: any[], edges: any[], codeMeta?: HistorySnapshotCodeMeta | null) {
    if (!this.activeId) return;

    const snap = this.snapshots.find((snapshot) => snapshot.id === this.activeId);
    if (!snap) return;

    const nextCodeMeta = mergeCodeMeta(snap.codeMeta, codeMeta);
    const cloned = cloneGraph(nodes, edges);
    const graphUnchanged = graphSignature(snap.nodes, snap.edges) === graphSignature(cloned.nodes, cloned.edges);
    const codeMetaUnchanged = codeMeta === undefined || codeMetaSignature(snap.codeMeta) === codeMetaSignature(nextCodeMeta);

    if (graphUnchanged && codeMetaUnchanged) {
      return;
    }

    snap.nodes = cloned.nodes;
    snap.edges = cloned.edges;
    if (codeMeta !== undefined) {
      if (nextCodeMeta) {
        snap.codeMeta = nextCodeMeta;
      } else {
        delete snap.codeMeta;
      }
    }
    this.notify();
  }

  updateActiveSnapshotCodeMeta(codeMeta: HistorySnapshotCodeMeta | null) {
    if (!this.activeId) return;

    const snap = this.snapshots.find((snapshot) => snapshot.id === this.activeId);
    if (!snap) return;

    const nextCodeMeta = mergeCodeMeta(snap.codeMeta, codeMeta);
    if (codeMetaSignature(snap.codeMeta) === codeMetaSignature(nextCodeMeta)) {
      return;
    }

    if (nextCodeMeta) {
      snap.codeMeta = nextCodeMeta;
    } else {
      delete snap.codeMeta;
    }
    this.notify();
  }

  saveSnapshot(nodes: any[], edges: any[], codeMeta?: HistorySnapshotCodeMeta | null) {
    if (!this.activeId) return;

    this.updateActiveSnapshot(nodes, edges, codeMeta);

    const previousActiveId = this.activeId;
    const parent = this.snapshots.find((snapshot) => snapshot.id === previousActiveId);
    if (!parent) return;

    const nextName = this.buildNextSnapshotName(previousActiveId, "Strategy Template");
    const nextCodeMeta = mergeCodeMeta(parent.codeMeta, codeMeta);

    const newSnap: HistorySnapshot = {
      id: `snapshot-${Date.now()}`,
      name: nextName,
      parentId: previousActiveId,
      ...cloneGraph(nodes, edges),
      ...(nextCodeMeta ? { codeMeta: nextCodeMeta } : {}),
      timestamp: Date.now()
    };

    this.snapshots.push(newSnap);

    const activeTabIndex = this.openTabs.indexOf(previousActiveId);
    if (activeTabIndex >= 0) {
      this.openTabs[activeTabIndex] = newSnap.id;
    } else {
      this.ensureTabOpen(newSnap.id);
    }

    this.activeId = newSnap.id;
    this.notify();
    this.dispatchSnapshotSaved(newSnap);

    return this.cloneSnapshot(newSnap);
  }

  createStrategyDraft(options?: {
    parentId?: string | null;
    name?: string;
    cloneFromParent?: boolean;
    codeMeta?: HistorySnapshotCodeMeta | null;
  }) {
    const parentId =
      options && Object.prototype.hasOwnProperty.call(options, "parentId")
        ? (options.parentId ?? null)
        : this.activeId;
    const cloneFromParent = options?.cloneFromParent ?? Boolean(parentId);
    const parentSnapshot = this.getSnapshotById(parentId);
    const graph =
      cloneFromParent && parentSnapshot
        ? cloneGraph(parentSnapshot.nodes, parentSnapshot.edges)
        : { nodes: [], edges: [] };
    const nextCodeMeta = mergeCodeMeta(
      cloneFromParent && parentSnapshot ? parentSnapshot.codeMeta : undefined,
      options?.codeMeta,
    );

    const newSnap: HistorySnapshot = {
      id: `snapshot-${Date.now()}`,
      name: options?.name?.trim() || this.buildNextSnapshotName(parentId, "New Strategy Template"),
      parentId: parentId ?? null,
      nodes: graph.nodes,
      edges: graph.edges,
      ...(nextCodeMeta ? { codeMeta: nextCodeMeta } : {}),
      timestamp: Date.now(),
    };

    this.snapshots.push(newSnap);
    this.ensureTabOpen(newSnap.id);
    this.activeId = newSnap.id;
    this.notify();
    this.dispatchSnapshotLoad(newSnap);

    return this.cloneSnapshot(newSnap);
  }

  createEmptyStrategy(parentId: string | null = this.activeId, name?: string, codeMeta?: HistorySnapshotCodeMeta | null) {
    return this.createStrategyDraft({
      parentId,
      name,
      cloneFromParent: false,
      codeMeta,
    });
  }

  createBranchDraft(parentId: string | null = this.activeId, name?: string, codeMeta?: HistorySnapshotCodeMeta | null) {
    return this.createStrategyDraft({
      parentId,
      name,
      cloneFromParent: true,
      codeMeta,
    });
  }

  deleteSnapshots(ids: string[]) {
    this.saveHistoryState();
    const idSet = new Set(ids);
    this.snapshots = this.snapshots.filter(s => !idSet.has(s.id));
    this.openTabs = this.openTabs.filter(id => !idSet.has(id));
    if (this.activeId && idSet.has(this.activeId)) {
      this.activeId = this.openTabs.length > 0 ? this.openTabs[this.openTabs.length - 1] : null;
    }

    // Check hidden groups
    this.hiddenGroups = this.hiddenGroups.map(g => ({
      ...g,
      snapshotIds: g.snapshotIds.filter(id => !idSet.has(id))
    })).filter(g => g.snapshotIds.length > 0);

    this.notify();
  }

  hideSnapshots(snapshotIds: string[]) {
    if (snapshotIds.length === 0) return;
    this.saveHistoryState();

    // remove these from existing groups if any
    const idSet = new Set(snapshotIds);
    this.hiddenGroups = this.hiddenGroups.map(g => ({
      ...g,
      snapshotIds: g.snapshotIds.filter(id => !idSet.has(id))
    })).filter(g => g.snapshotIds.length > 0);

    this.hiddenGroups.push({
      id: `hidden_history_group_${Date.now()}`,
      snapshotIds,
    });
    this.notify();
  }

  restoreHiddenGroup(groupId: string, extractSnapshotId?: string) {
    this.saveHistoryState();
    const group = this.hiddenGroups.find(g => g.id === groupId);
    if (!group) return;

    if (extractSnapshotId) {
      group.snapshotIds = group.snapshotIds.filter(id => id !== extractSnapshotId);
      if (group.snapshotIds.length === 0) {
        this.hiddenGroups = this.hiddenGroups.filter(g => g.id !== groupId);
      }
    } else {
      this.hiddenGroups = this.hiddenGroups.filter(g => g.id !== groupId);
    }
    this.notify();
  }

  // Clones snapshots and reparents them starting from activeId or targetParentId
  cloneSnapshots(snapshotsToClone: HistorySnapshot[], targetParentId: string | null) {
    if (snapshotsToClone.length === 0) return;
    this.saveHistoryState();

    const idMapping = new Map<string, string>();
    const now = Date.now();

    // Map old IDs to newly generated IDs
    snapshotsToClone.forEach((s, idx) => {
      idMapping.set(s.id, `snapshot-${now}-${idx}`);
    });

    const newSnapshots: HistorySnapshot[] = [];

    snapshotsToClone.forEach(s => {
      const isRootOfSelection = !s.parentId || !idMapping.has(s.parentId);
      const parentId = isRootOfSelection ? targetParentId : idMapping.get(s.parentId!);

      const newSnap = {
        ...this.cloneSnapshot(s),
        id: idMapping.get(s.id)!,
        name: `${s.name} (Copy)`,
        parentId: parentId ?? null,
        timestamp: Date.now() + newSnapshots.length, // Ensure predictable ordering
      };

      newSnapshots.push(newSnap);
    });

    this.snapshots.push(...newSnapshots);
    this.notify();
  }
}

export const historyStore = new HistoryStore();
