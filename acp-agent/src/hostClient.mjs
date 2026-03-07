function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HostApiError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = 'HostApiError';
    this.status = context.status;
    this.path = context.path;
    this.body = context.body;
  }
}

export class HershyHostClient {
  constructor({
    baseUrl,
    pollIntervalMs = 2500,
    apiToken = '',
    fetchImpl = globalThis.fetch
  }) {
    if (!baseUrl) {
      throw new Error('baseUrl is required');
    }
    if (typeof fetchImpl !== 'function') {
      throw new Error('global fetch is not available in this Node runtime');
    }

    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.pollIntervalMs = pollIntervalMs;
    this.apiToken = String(apiToken || '').trim();
    this.fetchImpl = fetchImpl;
  }

  async request(method, path, body) {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json'
    };
    if (this.apiToken) {
      headers['X-Hershy-Api-Token'] = this.apiToken;
    }

    const response = await this.fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text };
    }

    if (!response.ok) {
      const message =
        parsed?.message || parsed?.error || `Host API request failed (${response.status})`;
      throw new HostApiError(message, {
        status: response.status,
        path,
        body: parsed
      });
    }

    return parsed;
  }

  createProgram(payload) {
    return this.request('POST', '/programs', payload);
  }

  startProgram(programId) {
    return this.request('POST', `/programs/${encodeURIComponent(programId)}/start`);
  }

  stopProgram(programId) {
    return this.request('POST', `/programs/${encodeURIComponent(programId)}/stop`);
  }

  restartProgram(programId) {
    return this.request('POST', `/programs/${encodeURIComponent(programId)}/restart`);
  }

  getProgram(programId) {
    return this.request('GET', `/programs/${encodeURIComponent(programId)}`);
  }

  getLogs(programId) {
    return this.request('GET', `/programs/${encodeURIComponent(programId)}/logs`);
  }

  getSource(programId) {
    return this.request('GET', `/programs/${encodeURIComponent(programId)}/source`);
  }

  async waitUntilReady(programId, timeoutMs) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const state = await this.getProgram(programId);
      const normalizedState = String(state?.state || '').toLowerCase();

      if (normalizedState === 'ready') {
        return state;
      }

      if (normalizedState === 'error') {
        throw new HostApiError(`program entered Error state: ${state.error_msg || 'unknown'}`, {
          status: 500,
          path: `/programs/${programId}`,
          body: state
        });
      }

      await sleep(this.pollIntervalMs);
    }

    throw new HostApiError(`timed out waiting for Ready state: ${programId}`, {
      status: 408,
      path: `/programs/${programId}`
    });
  }
}
