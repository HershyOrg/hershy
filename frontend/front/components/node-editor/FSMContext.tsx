"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { historyStore } from "@/lib/historyStore";
import { runningStore, type RunningEntry } from "@/lib/runningStore";
import { sequenceLogStore } from "@/lib/sequenceLogStore";
import {
  detectStrategyKind,
  extractDcaPlan,
  getPrimaryStrategyLabel,
  type StrategyKind,
} from "@/lib/strategyMeta";

export type FSMState = "IDLE" | "ACTIVE" | "REBALANCING" | "CLOSED";

export const FSM_STATE_LABELS: Record<FSMState, string> = {
  IDLE: "대기 중",
  ACTIVE: "운영 중",
  REBALANCING: "리밸런싱 중",
  CLOSED: "종료됨",
};

export const FSM_STATE_STYLES: Record<
  FSMState,
  { bg: string; text: string; border: string; dot: string; hex: string }
> = {
  IDLE:        { bg: "bg-slate-700/60",   text: "text-slate-200",   border: "border-slate-500",   dot: "bg-slate-400",   hex: "#64748b" },
  ACTIVE:      { bg: "bg-emerald-900/60", text: "text-emerald-300", border: "border-emerald-500", dot: "bg-emerald-400", hex: "#10b981" },
  REBALANCING: { bg: "bg-amber-900/60",   text: "text-amber-300",   border: "border-amber-500",   dot: "bg-amber-400",   hex: "#f59e0b" },
  CLOSED:      { bg: "bg-red-900/60",     text: "text-red-300",     border: "border-red-500",     dot: "bg-red-400",     hex: "#ef4444" },
};

interface FSMContextValue {
  currentState: FSMState;
  setCurrentState: (s: FSMState) => void;
  showFSMEdges: boolean;
  setShowFSMEdges: (v: boolean) => void;
  isAvailable: (requiredStates?: FSMState[]) => boolean;
}

const FSMContext = createContext<FSMContextValue>({
  currentState: "IDLE",
  setCurrentState: () => {},
  showFSMEdges: false,
  setShowFSMEdges: () => {},
  isAvailable: () => true,
});

const INIT_TO_ACTIVE_DELAY_MS = 1500;
const REBALANCE_INTERVAL_MS = 10000;
const REBALANCE_TO_ACTIVE_DELAY_MS = 2200;
const CLOSED_TO_IDLE_DELAY_MS = 1600;

function getFallbackSequenceLabel(state: FSMState) {
  switch (state) {
    case "IDLE":
      return "초기 진입 시퀀스";
    case "ACTIVE":
      return "운영 유지 시퀀스";
    case "REBALANCING":
      return "리밸런싱 시퀀스";
    case "CLOSED":
      return "긴급 종료 시퀀스";
  }
}

function resolveSequenceLabel(snapshotId: string, state: FSMState) {
  const snapshot = historyStore.getSnapshots().find((item) => item.id === snapshotId);
  const sequenceNodes = (snapshot?.nodes ?? []).filter((node: any) => {
    return node.type === "groupNode" && node.parentId && node.data?.styleType !== "solid";
  });

  const byPredicate = (predicate: (node: any) => boolean) => {
    return sequenceNodes.find(predicate)?.data?.label as string | undefined;
  };

  const rebalanceLabels =
    state === "REBALANCING"
      ? sequenceNodes
          .filter((node) => {
            const executing = node.data?.executingStates ?? [];
            return executing.includes("REBALANCING");
          })
          .map((node) => node.data?.label)
          .filter(Boolean)
      : [];

  const byState =
    state === "IDLE"
      ? byPredicate((node) => node.data?.styleType === "dashed-init")
      : state === "ACTIVE"
        ? byPredicate((node) => {
            const required = node.data?.requiredStates ?? [];
            const executing = node.data?.executingStates ?? [];
            return (
              node.data?.styleType === "dashed-trigger" &&
              required.includes("ACTIVE") &&
              !required.includes("CLOSED") &&
              !executing.includes("REBALANCING")
            );
          })
        : state === "REBALANCING"
          ? rebalanceLabels.join(" / ")
          : byPredicate((node) => node.data?.styleType === "dashed-emergency");

  return byState ?? getFallbackSequenceLabel(state);
}

function logSequenceEntries(
  entries: RunningEntry[],
  state: FSMState,
  messageBuilder: (entry: RunningEntry, sequenceLabel: string) => string,
  level: "info" | "success" | "warning",
) {
  entries.forEach((entry) => {
    const sequenceLabel = resolveSequenceLabel(entry.snapshotId, state);
    sequenceLogStore.addEntry({
      strategyLabel: entry.label,
      sequenceLabel,
      stateLabel: state,
      message: messageBuilder(entry, sequenceLabel),
      level,
    });
  });
}

function getStrategySnapshot(snapshotId: string) {
  return historyStore.getSnapshots().find((item) => item.id === snapshotId) ?? null;
}

function getEntryStrategyKind(entry: RunningEntry): StrategyKind {
  return detectStrategyKind(getStrategySnapshot(entry.snapshotId));
}

function logDcaCycleEntries(entries: RunningEntry[]) {
  entries.forEach((entry) => {
    const snapshot = getStrategySnapshot(entry.snapshotId);
    const plan = extractDcaPlan(snapshot);
    const strategyLabel = getPrimaryStrategyLabel(snapshot);

    if (plan.allocations.length === 0) {
      sequenceLogStore.addEntry({
        strategyLabel,
        sequenceLabel: "월간 DCA 실행",
        stateLabel: "BUY",
        message: `${strategyLabel} 정기 매수 배치를 실행했습니다.`,
        level: "success",
      });
      return;
    }

    plan.allocations.forEach((allocation) => {
      const orderAmount = (plan.monthlyBudget * allocation.weight) / 100;
      sequenceLogStore.addEntry({
        strategyLabel,
        sequenceLabel: "월간 DCA 실행",
        stateLabel: "BUY",
        message: `${allocation.asset} ${allocation.weight}% 비중으로 $${orderAmount.toFixed(0)} 매수 주문을 실행했습니다.`,
        level: "success",
      });
    });
  });
}

export function FSMProvider({ children }: { children: ReactNode }) {
  const [currentState, setCurrentState] = useState<FSMState>("IDLE");
  const [showFSMEdges, setShowFSMEdges] = useState(false);
  const runningEntries = useSyncExternalStore(
    (listener) => runningStore.subscribe(listener),
    () => runningStore.getSnapshot(),
    () => runningStore.getSnapshot(),
  );
  const hasRunning = runningEntries.length > 0;
  const wasRunningRef = useRef(false);
  const previousEntriesRef = useRef<RunningEntry[]>([]);
  const initTimeoutRef = useRef<number | null>(null);
  const rebalanceIntervalRef = useRef<number | null>(null);
  const rebalanceTimeoutRef = useRef<number | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);

  const clearAutomationTimers = () => {
    if (initTimeoutRef.current !== null) {
      window.clearTimeout(initTimeoutRef.current);
      initTimeoutRef.current = null;
    }
    if (rebalanceIntervalRef.current !== null) {
      window.clearInterval(rebalanceIntervalRef.current);
      rebalanceIntervalRef.current = null;
    }
    if (rebalanceTimeoutRef.current !== null) {
      window.clearTimeout(rebalanceTimeoutRef.current);
      rebalanceTimeoutRef.current = null;
    }
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };

  const isAvailable = (requiredStates?: FSMState[]) => {
    if (!requiredStates || requiredStates.length === 0) return true;
    return requiredStates.includes(currentState);
  };

  useEffect(() => {
    const wasRunning = wasRunningRef.current;
    const previousEntries = previousEntriesRef.current;

    if (hasRunning && !wasRunning) {
      clearAutomationTimers();
      const hasNonDcaStrategy = runningEntries.some((entry) => getEntryStrategyKind(entry) !== "dca");
      setShowFSMEdges(hasNonDcaStrategy);
      setCurrentState("IDLE");
      logSequenceEntries(runningEntries, "IDLE", (entry, sequenceLabel) => {
        if (getEntryStrategyKind(entry) === "dca") {
          return `${entry.label} 실행 시작. 월간 적립 준비를 시작합니다.`;
        }
        return `${entry.label} 실행 시작. ${sequenceLabel}에 진입했습니다.`;
      }, "success");

      initTimeoutRef.current = window.setTimeout(() => {
        setCurrentState("ACTIVE");
        logSequenceEntries(runningEntries, "ACTIVE", (entry, sequenceLabel) => {
          if (getEntryStrategyKind(entry) === "dca") {
            return `적립 전략이 활성화됐습니다. 다음 월간 매수 배치를 대기합니다.`;
          }
          return `${sequenceLabel}가 운영 상태로 전환됐습니다.`;
        }, "info");
        rebalanceIntervalRef.current = window.setInterval(() => {
          const currentEntries = runningStore.getSnapshot();
          const dcaEntries = currentEntries.filter((entry) => getEntryStrategyKind(entry) === "dca");
          const nonDcaEntries = currentEntries.filter((entry) => getEntryStrategyKind(entry) !== "dca");

          if (dcaEntries.length > 0) {
            logDcaCycleEntries(dcaEntries);
          }

          if (nonDcaEntries.length > 0) {
            setCurrentState("REBALANCING");
            logSequenceEntries(
              nonDcaEntries,
              "REBALANCING",
              (_entry, sequenceLabel) => `${sequenceLabel}가 데모 리밸런싱 작업을 시작했습니다.`,
              "warning",
            );
            if (rebalanceTimeoutRef.current !== null) {
              window.clearTimeout(rebalanceTimeoutRef.current);
            }
            rebalanceTimeoutRef.current = window.setTimeout(() => {
              setCurrentState(runningStore.hasAnyRunning() ? "ACTIVE" : "CLOSED");
              if (runningStore.hasAnyRunning()) {
                logSequenceEntries(
                  runningStore.getSnapshot().filter((entry) => getEntryStrategyKind(entry) !== "dca"),
                  "ACTIVE",
                  (_entry, sequenceLabel) => `${sequenceLabel}로 복귀해 운영을 이어갑니다.`,
                  "info",
                );
              }
              rebalanceTimeoutRef.current = null;
            }, REBALANCE_TO_ACTIVE_DELAY_MS);
          } else {
            setCurrentState("ACTIVE");
          }
        }, REBALANCE_INTERVAL_MS);
        initTimeoutRef.current = null;
      }, INIT_TO_ACTIVE_DELAY_MS);
    }

    if (!hasRunning && wasRunning) {
      clearAutomationTimers();
      const hasNonDcaStrategy = previousEntries.some((entry) => getEntryStrategyKind(entry) !== "dca");
      setShowFSMEdges(hasNonDcaStrategy);
      setCurrentState("CLOSED");
      logSequenceEntries(previousEntries, "CLOSED", (entry, sequenceLabel) => {
        if (getEntryStrategyKind(entry) === "dca") {
          return `월간 적립 전략 실행을 종료합니다. 다음 배치는 예약되지 않습니다.`;
        }
        return `${sequenceLabel}를 거쳐 전략 실행을 종료합니다.`;
      }, "warning");

      closeTimeoutRef.current = window.setTimeout(() => {
        setCurrentState("IDLE");
        setShowFSMEdges(false);
        closeTimeoutRef.current = null;
      }, CLOSED_TO_IDLE_DELAY_MS);
    }

    wasRunningRef.current = hasRunning;
    previousEntriesRef.current = runningEntries;
  }, [hasRunning]);

  useEffect(() => {
    return () => {
      clearAutomationTimers();
    };
  }, []);

  return (
    <FSMContext.Provider value={{ currentState, setCurrentState, showFSMEdges, setShowFSMEdges, isAvailable }}>
      {children}
    </FSMContext.Provider>
  );
}

export function useFSM() {
  return useContext(FSMContext);
}
