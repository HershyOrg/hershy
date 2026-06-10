import type { StrategyLogicDraft, UserStrategyLogic } from "../types/strategyTypes";

const strategyLogicKey = "strategy-exchange-user-logics";

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  const saved = window.localStorage.getItem(key);
  return saved ? (JSON.parse(saved) as T) : null;
}

function writeLogics(logics: UserStrategyLogic[]) {
  window.localStorage.setItem(strategyLogicKey, JSON.stringify(logics));
}

export function readUserStrategyLogics() {
  return readJson<UserStrategyLogic[]>(strategyLogicKey) ?? [];
}

export function launchUserStrategyLogic(draft: StrategyLogicDraft) {
  const now = new Date().toISOString();
  const logic: UserStrategyLogic = {
    id: `logic-${Date.now()}`,
    name: draft.name.trim(),
    description: draft.description.trim(),
    strategyText: draft.strategyText.trim(),
    baseLogicId: draft.baseLogicId || undefined,
    createdAt: now,
    updatedAt: now,
  };

  const logics = [logic, ...readUserStrategyLogics()];
  writeLogics(logics);
  return logic;
}
