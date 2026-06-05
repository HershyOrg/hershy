import type {
  ClientAppState,
  ClientUserProfile,
  PersistedHistoryStoreState,
  PersistedStrategyBuilderState,
  ThemePreference,
} from "@/lib/domain";

const CLIENT_STATE_STORAGE_KEY = "hershy.client-state.v1";
const LEGACY_HISTORY_STORAGE_KEY = "thirdeye.strategy-history.v1";
const LEGACY_STRATEGY_BUILDER_STORAGE_KEY = "thirdeye.strategy-builder-state.v2";
const LEGACY_START_GUIDE_COMPLETED_STORAGE_PREFIX = "hershy-start-guide-completed:";
const LEGACY_USER_CONTEXT_STORAGE_KEY = "hershy-user-id";
const LEGACY_USER_LOGIN_NAME_STORAGE_KEY = "hershy-user-login-name";
const LEGACY_THEME_STORAGE_KEY = "hershy-theme";
const DEPRECATED_XRP_SEED_PATTERN = /XRPUSDT|XRPUSDT\.P|\bXRP\b/i;

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function createEmptyState(): ClientAppState {
  return {
    version: 1,
    savedAt: Date.now(),
  };
}

function normalizeClientState(value: unknown): ClientAppState {
  if (!value || typeof value !== "object") return createEmptyState();
  const state = value as Partial<ClientAppState>;
  return {
    ...state,
    version: 1,
    savedAt: typeof state.savedAt === "number" ? state.savedAt : Date.now(),
  };
}

function readJSON<T>(storage: Storage, key: string): T | null {
  const raw = storage.getItem(key);
  if (!raw || DEPRECATED_XRP_SEED_PATTERN.test(raw)) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function readRawState(storage: Storage): ClientAppState {
  const raw = storage.getItem(CLIENT_STATE_STORAGE_KEY);
  if (!raw) return createEmptyState();
  try {
    return normalizeClientState(JSON.parse(raw));
  } catch {
    return createEmptyState();
  }
}

function writeRawState(storage: Storage, state: ClientAppState) {
  storage.setItem(
    CLIENT_STATE_STORAGE_KEY,
    JSON.stringify({
      ...state,
      version: 1,
      savedAt: Date.now(),
    }),
  );
}

function migrateLegacyState(storage: Storage, state: ClientAppState) {
  let changed = false;

  if (!state.theme?.preference) {
    const theme = storage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (theme === "dark" || theme === "light" || theme === "system") {
      state.theme = { preference: theme };
      changed = true;
    }
  }

  if (!state.user?.userId) {
    const userId = storage.getItem(LEGACY_USER_CONTEXT_STORAGE_KEY) || "";
    const displayName = storage.getItem(LEGACY_USER_LOGIN_NAME_STORAGE_KEY) || "";
    if (userId || displayName) {
      state.user = {
        userId,
        displayName,
        isLoggedIn: Boolean(displayName),
      };
      changed = true;
    }
  }

  if (!state.strategyBuilder) {
    const strategyBuilder = readJSON<PersistedStrategyBuilderState>(storage, LEGACY_STRATEGY_BUILDER_STORAGE_KEY);
    if (strategyBuilder?.version === 2) {
      state.strategyBuilder = strategyBuilder;
      changed = true;
    }
  }

  if (!state.history) {
    const history = readJSON<PersistedHistoryStoreState>(storage, LEGACY_HISTORY_STORAGE_KEY);
    if (history?.version === 1) {
      state.history = history;
      changed = true;
    }
  }

  const completedByUserId = { ...(state.guide?.completedByUserId ?? {}) };
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(LEGACY_START_GUIDE_COMPLETED_STORAGE_PREFIX)) continue;
    const userId = key.slice(LEGACY_START_GUIDE_COMPLETED_STORAGE_PREFIX.length) || "guest";
    if (storage.getItem(key) === "1") {
      completedByUserId[userId] = true;
      changed = true;
    }
  }
  if (Object.keys(completedByUserId).length > 0) {
    state.guide = { completedByUserId };
  }

  [
    LEGACY_THEME_STORAGE_KEY,
    LEGACY_USER_CONTEXT_STORAGE_KEY,
    LEGACY_USER_LOGIN_NAME_STORAGE_KEY,
    LEGACY_STRATEGY_BUILDER_STORAGE_KEY,
    LEGACY_HISTORY_STORAGE_KEY,
  ].forEach((key) => storage.removeItem(key));
  Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((key): key is string => Boolean(key?.startsWith(LEGACY_START_GUIDE_COMPLETED_STORAGE_PREFIX)))
    .forEach((key) => storage.removeItem(key));

  return changed;
}

export function readClientAppState(): ClientAppState {
  if (!canUseStorage()) return createEmptyState();
  const storage = window.localStorage;
  const state = readRawState(storage);
  if (migrateLegacyState(storage, state)) {
    writeRawState(storage, state);
  }
  return cloneValue(state);
}

function updateClientAppState(mutator: (state: ClientAppState) => void) {
  if (!canUseStorage()) return;
  const storage = window.localStorage;
  const state = readRawState(storage);
  migrateLegacyState(storage, state);
  mutator(state);
  writeRawState(storage, state);
}

export function readThemePreference(): ThemePreference | undefined {
  return readClientAppState().theme?.preference;
}

export function writeThemePreference(preference: ThemePreference) {
  updateClientAppState((state) => {
    state.theme = { preference };
  });
}

export function readGuideCompleted(userId: string) {
  return Boolean(readClientAppState().guide?.completedByUserId?.[userId || "guest"]);
}

export function writeGuideCompleted(userId: string) {
  updateClientAppState((state) => {
    state.guide = {
      completedByUserId: {
        ...(state.guide?.completedByUserId ?? {}),
        [userId || "guest"]: true,
      },
    };
  });
}

export function readStrategyBuilderState() {
  return readClientAppState().strategyBuilder ?? null;
}

export function writeStrategyBuilderState(strategyBuilder: PersistedStrategyBuilderState) {
  updateClientAppState((state) => {
    state.strategyBuilder = strategyBuilder;
  });
}

export function clearStrategyBuilderState() {
  updateClientAppState((state) => {
    state.strategyBuilder = null;
  });
}

export function readHistoryState() {
  return readClientAppState().history ?? null;
}

export function writeHistoryState(history: PersistedHistoryStoreState) {
  updateClientAppState((state) => {
    state.history = history;
  });
}

export function readStoredUserProfile(): Partial<ClientUserProfile> | null {
  return readClientAppState().user ?? null;
}

export function writeStoredUserProfile(user: Partial<ClientUserProfile>) {
  updateClientAppState((state) => {
    state.user = {
      ...(state.user ?? {}),
      ...user,
    };
  });
}

export function clearStoredUserProfile() {
  updateClientAppState((state) => {
    state.user = {};
  });
}
