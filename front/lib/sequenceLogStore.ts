type Listener = () => void;

export type SequenceLogLevel = "info" | "success" | "warning";

export type SequenceLogEntry = {
  id: string;
  timestamp: number;
  dateLabel: string;
  timeLabel: string;
  strategyLabel: string;
  sequenceLabel: string;
  stateLabel: string;
  message: string;
  level: SequenceLogLevel;
};

type AddSequenceLogInput = {
  strategyLabel: string;
  sequenceLabel: string;
  stateLabel: string;
  message: string;
  level?: SequenceLogLevel;
  timestamp?: number;
};

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

class SequenceLogStore {
  private entries: SequenceLogEntry[] = [];
  private listeners: Set<Listener> = new Set();
  private cachedSnapshot: SequenceLogEntry[] = [];

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.cachedSnapshot = [...this.entries];
    this.listeners.forEach((listener) => listener());
  }

  getSnapshot() {
    return this.cachedSnapshot;
  }

  addEntry(input: AddSequenceLogInput) {
    const timestamp = input.timestamp ?? Date.now();
    const entry: SequenceLogEntry = {
      id: `sequence-log-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp,
      dateLabel: formatDate(timestamp),
      timeLabel: formatTime(timestamp),
      strategyLabel: input.strategyLabel,
      sequenceLabel: input.sequenceLabel,
      stateLabel: input.stateLabel,
      message: input.message,
      level: input.level ?? "info",
    };

    this.entries = [entry, ...this.entries];
    this.notify();
    return entry;
  }

  clear() {
    if (this.entries.length === 0) return;
    this.entries = [];
    this.notify();
  }
}

export const sequenceLogStore = new SequenceLogStore();
