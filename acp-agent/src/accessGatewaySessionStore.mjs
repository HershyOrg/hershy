function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function sanitizeSessionId(raw) {
  const value = String(raw || '').trim();
  if (!value) {
    throw new Error('session_id is required');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('session_id must be URL-safe base64url characters');
  }
  return value;
}

function normalizeEndpointPath(endpointRaw) {
  const endpoint = String(endpointRaw || '').trim();
  if (!endpoint) {
    return '/';
  }
  return endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
}

function trimTrailingSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

function buildWsSessionBaseUrl(gatewayWsUrl, sessionId) {
  const base = trimTrailingSlash(gatewayWsUrl);
  if (!base) {
    throw new Error('gatewayWsUrl is required for session websocket');
  }
  return `${base}/${encodeURIComponent(sessionId)}`;
}

function buildHttpSessionBaseUrl(gatewayHttpUrl, sessionId) {
  const base = trimTrailingSlash(gatewayHttpUrl);
  if (!base) {
    return '';
  }
  return `${base}/${encodeURIComponent(sessionId)}`;
}

export function createAccessGatewaySessionStore() {
  const sessions = new Map();
  const expiryTimers = new Map();

  function clearExpiryTimer(sessionId) {
    const timer = expiryTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      expiryTimers.delete(sessionId);
    }
  }

  function deleteSession(sessionId) {
    clearExpiryTimer(sessionId);
    sessions.delete(sessionId);
  }

  function scheduleExpiry(session) {
    clearExpiryTimer(session.session_id);
    if (!session.expires_at_sec || session.expires_at_sec <= 0) {
      return;
    }

    const delayMs = Math.max(0, session.expires_at_sec * 1000 - Date.now());
    const timer = setTimeout(() => {
      deleteSession(session.session_id);
    }, delayMs);
    expiryTimers.set(session.session_id, timer);
  }

  function registerSession({
    sessionId,
    programId,
    serverId,
    requestedEndpoints,
    requesterX25519Pubkey,
    issuedAtSec,
    expiresAtSec,
    gatewayWsUrl,
    gatewayHttpUrl = ''
  }) {
    const normalizedSessionId = sanitizeSessionId(sessionId);
    const endpoints = Array.isArray(requestedEndpoints)
      ? requestedEndpoints.map((endpoint) => normalizeEndpointPath(endpoint))
      : [];
    if (endpoints.length === 0) {
      throw new Error('requestedEndpoints must include at least one endpoint');
    }

    const issued = Number.parseInt(String(issuedAtSec || 0), 10);
    const expires = Number.parseInt(String(expiresAtSec || 0), 10);

    if (!Number.isInteger(issued) || issued <= 0) {
      throw new Error('issuedAtSec must be a positive integer');
    }
    if (Number.isInteger(expires) && expires > 0 && expires <= issued) {
      throw new Error('expiresAtSec must be greater than issuedAtSec');
    }

    const session = {
      session_id: normalizedSessionId,
      program_id: String(programId),
      server_id: String(serverId),
      requester_x25519_pubkey: String(requesterX25519Pubkey || '').trim(),
      requested_endpoints: endpoints,
      issued_at_sec: issued,
      expires_at_sec: Number.isInteger(expires) ? expires : 0,
      ws_url: buildWsSessionBaseUrl(gatewayWsUrl, normalizedSessionId),
      http_url: buildHttpSessionBaseUrl(gatewayHttpUrl, normalizedSessionId)
    };

    if (!session.requester_x25519_pubkey) {
      throw new Error('requesterX25519Pubkey is required');
    }

    sessions.set(normalizedSessionId, session);
    scheduleExpiry(session);

    return {
      session_id: session.session_id,
      ws_url: session.ws_url,
      http_url: session.http_url || null,
      issued_at: new Date(session.issued_at_sec * 1000).toISOString(),
      expires_at:
        session.expires_at_sec > 0
          ? new Date(session.expires_at_sec * 1000).toISOString()
          : null
    };
  }

  function getSession(sessionId) {
    const normalizedSessionId = sanitizeSessionId(sessionId);
    const session = sessions.get(normalizedSessionId);
    if (!session) {
      return null;
    }

    if (session.expires_at_sec > 0 && nowSec() >= session.expires_at_sec) {
      deleteSession(normalizedSessionId);
      return null;
    }

    return {
      ...session,
      requested_endpoints: [...session.requested_endpoints]
    };
  }

  function size() {
    return sessions.size;
  }

  function close() {
    for (const timer of expiryTimers.values()) {
      clearTimeout(timer);
    }
    expiryTimers.clear();
    sessions.clear();
  }

  return {
    registerSession,
    getSession,
    deleteSession,
    size,
    close
  };
}
