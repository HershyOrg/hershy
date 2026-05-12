type Listener = () => void;

export type RunningEntry = {
  snapshotId: string;
  /** The solid GroupNode id inside the canvas */
  nodeId: string;
  /** Display name of the strategy block */
  label: string;
};

class RunningStore {
  private entries: RunningEntry[] = [];
  private listeners: Set<Listener> = new Set();
  private cachedSnapshot: RunningEntry[] = [];

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify() {
    this.cachedSnapshot = [...this.entries];
    this.listeners.forEach((l) => l());
  }

  /** Stable reference — safe to use as useSyncExternalStore getSnapshot */
  getSnapshot(): RunningEntry[] {
    return this.cachedSnapshot;
  }

  isSnapshotRunning(snapshotId: string): boolean {
    return this.entries.some((e) => e.snapshotId === snapshotId);
  }

  isNodeRunning(nodeId: string): boolean {
    return this.entries.some((e) => e.nodeId === nodeId);
  }

  getRunningNodeIds(snapshotId: string): string[] {
    return this.entries.filter((e) => e.snapshotId === snapshotId).map((e) => e.nodeId);
  }

  getRunningSnapshotIds(): string[] {
    return [...new Set(this.entries.map((e) => e.snapshotId))];
  }

  startNode(snapshotId: string, nodeId: string, label: string) {
    if (!this.entries.some((e) => e.nodeId === nodeId)) {
      this.entries = [...this.entries, { snapshotId, nodeId, label }];
      this.notify();
    }
  }

  stopNode(nodeId: string) {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.nodeId !== nodeId);
    if (this.entries.length !== before) this.notify();
  }

  toggleNode(snapshotId: string, nodeId: string, label: string) {
    if (this.isNodeRunning(nodeId)) {
      this.stopNode(nodeId);
    } else {
      this.startNode(snapshotId, nodeId, label);
    }
  }

  stopSnapshot(snapshotId: string) {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.snapshotId !== snapshotId);
    if (this.entries.length !== before) this.notify();
  }

  hasAnyRunning() {
    return this.entries.length > 0;
  }
}

export const runningStore = new RunningStore();
