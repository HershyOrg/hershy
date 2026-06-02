const USER_CONTEXT_STORAGE_KEY = "hershy-user-id";
const USER_LOGIN_NAME_STORAGE_KEY = "hershy-user-login-name";

function sanitizeUserId(rawValue) {
  return String(rawValue || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function canUseLocalStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function generateUserId() {
  const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return sanitizeUserId(`web-${uuid}`) || `web-${Date.now()}`;
}

function normalizeLoginName(rawValue) {
  return String(rawValue || "").trim().slice(0, 80);
}

function hashText(value) {
  let hash = 5381;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

export function getOrCreateClientUserId() {
  if (!canUseLocalStorage()) {
    return "web-anonymous";
  }

  const existing = sanitizeUserId(window.localStorage.getItem(USER_CONTEXT_STORAGE_KEY));
  if (existing) {
    return existing;
  }

  const nextUserId = generateUserId();
  window.localStorage.setItem(USER_CONTEXT_STORAGE_KEY, nextUserId);
  return nextUserId;
}

export function getClientUserProfile() {
  const userId = getOrCreateClientUserId();
  if (!canUseLocalStorage()) {
    return {
      userId,
      displayName: "Guest",
      isLoggedIn: false,
    };
  }

  const displayName = normalizeLoginName(window.localStorage.getItem(USER_LOGIN_NAME_STORAGE_KEY));
  return {
    userId,
    displayName: displayName || "Guest",
    isLoggedIn: Boolean(displayName),
  };
}

export function loginClientUser(rawLoginName) {
  const displayName = normalizeLoginName(rawLoginName);
  if (!displayName) {
    throw new Error("login name is required");
  }

  const slug = sanitizeUserId(displayName) || "account";
  const userId = sanitizeUserId(`user-${slug}-${hashText(displayName)}`) || generateUserId();
  if (canUseLocalStorage()) {
    window.localStorage.setItem(USER_CONTEXT_STORAGE_KEY, userId);
    window.localStorage.setItem(USER_LOGIN_NAME_STORAGE_KEY, displayName);
  }
  return {
    userId,
    displayName,
    isLoggedIn: true,
  };
}

export function logoutClientUser() {
  if (canUseLocalStorage()) {
    window.localStorage.removeItem(USER_CONTEXT_STORAGE_KEY);
    window.localStorage.removeItem(USER_LOGIN_NAME_STORAGE_KEY);
  }
  return getClientUserProfile();
}

export function withUserContextHeaders(headers = {}) {
  const userId = getOrCreateClientUserId();
  return {
    ...headers,
    "X-Hershy-User-ID": userId,
  };
}

export function withUserContextPayload(payload = {}) {
  return {
    ...payload,
    user_id: getOrCreateClientUserId(),
  };
}
