import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FRONT_PORT = resolvePort(process.env.FRONT_PORT || process.env.PORT, 9090);
const HOST_API_BASE = normalizeBaseURL(process.env.HOST_API_BASE || 'http://localhost:9000');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const app = express();

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

app.get('/api/config', (_req, res) => {
  res.json({
    host_api_base: HOST_API_BASE,
    front_port: FRONT_PORT,
  });
});

app.post('/api/ai/strategy-draft', express.json({ limit: '2mb' }), async (req, res) => {
  const prompt = normalizeText(req.body?.prompt);
  if (!prompt) {
    sendError(res, 400, 'prompt is required');
    return;
  }

  const currentStrategy = req.body?.current_strategy && typeof req.body.current_strategy === 'object'
    ? req.body.current_strategy
    : null;

  const provider = resolveAIProvider();
  try {
    let generated;
    if (provider === 'ollama') {
      generated = await generateStrategyWithOllama(prompt, currentStrategy);
    } else if (provider === 'gemini') {
      generated = await generateStrategyWithGemini(prompt, currentStrategy);
    } else if (provider === 'openai') {
      generated = await generateStrategyWithOpenAI(prompt, currentStrategy);
    } else {
      sendError(res, 400, `unsupported AI_PROVIDER: ${provider}`);
      return;
    }

    res.json({
      strategy: generated.strategy,
      source: generated.source,
      model: generated.model,
      message: 'AI strategy draft generated',
    });
  } catch (error) {
    if (error instanceof UpstreamHTTPError) {
      let status = 502;
      if (error.status === 429) {
        status = 429;
      } else if (error.status === 401 || error.status === 403) {
        status = 401;
      } else if (error.status === 400) {
        status = 400;
      }
      sendError(res, status, `ai generation failed: ${error.message}`);
      return;
    }
    sendError(res, 502, `ai generation failed: ${error?.message || 'unknown error'}`);
  }
});

app.use('/api/host', express.raw({ type: '*/*', limit: '32mb' }), async (req, res) => {
  const targetURL = `${HOST_API_BASE}${req.url}`;
  try {
    const headers = buildForwardHeaders(req.headers);
    const method = req.method.toUpperCase();
    const response = await fetch(targetURL, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD'
        ? undefined
        : (req.body && req.body.length > 0 ? req.body : undefined),
      redirect: 'manual',
    });

    for (const [key, value] of response.headers.entries()) {
      if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
        continue;
      }
      res.setHeader(key, value);
    }

    res.status(response.status);
    const payload = Buffer.from(await response.arrayBuffer());
    res.send(payload);
  } catch (error) {
    sendError(res, 502, `host proxy request failed: ${error?.message || targetURL}`);
  }
});

let vite;
if (!IS_PRODUCTION) {
  const { createServer } = await import('vite');
  vite = await createServer({
    root: __dirname,
    appType: 'spa',
    server: {
      middlewareMode: true,
    },
  });
  app.use(vite.middlewares);
} else {
  const distDir = path.resolve(__dirname, 'dist');
  app.use(express.static(distDir, { index: false }));
}

app.use('/api', (_req, res) => {
  sendError(res, 404, 'api route not found');
});

app.use('*', async (req, res, next) => {
  try {
    const indexPath = IS_PRODUCTION
      ? path.resolve(__dirname, 'dist/index.html')
      : path.resolve(__dirname, 'index.html');

    let html = await fs.readFile(indexPath, 'utf8');
    if (!IS_PRODUCTION && vite) {
      html = await vite.transformIndexHtml(req.originalUrl, html);
    }

    res.status(200).set({ 'Content-Type': 'text/html; charset=utf-8' }).end(html);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  sendError(res, 500, error?.message || 'internal server error');
});

app.listen(FRONT_PORT, () => {
  console.log(`[front] standalone server listening on http://localhost:${FRONT_PORT}`);
  console.log(`[front] host proxy target: ${HOST_API_BASE}`);
  console.log(`[front] mode: ${IS_PRODUCTION ? 'production' : 'development'}`);
});

class UpstreamHTTPError extends Error {
  constructor(provider, status, body) {
    super(`${provider} status=${status} body=${trimForLog(body, 800)}`);
    this.provider = provider;
    this.status = status;
    this.body = body;
  }
}

function resolvePort(raw, fallback) {
  const parsed = Number.parseInt(String(raw || '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBaseURL(raw) {
  const value = String(raw || '').trim();
  return value.replace(/\/+$/, '') || 'http://localhost:9000';
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sendError(res, code, message) {
  res.status(code).json({
    error: statusText(code),
    code,
    message,
  });
}

function statusText(code) {
  const table = {
    400: 'Bad Request',
    401: 'Unauthorized',
    404: 'Not Found',
    405: 'Method Not Allowed',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
  };
  return table[code] || 'Error';
}

function buildForwardHeaders(rawHeaders) {
  const headers = {};
  for (const [key, value] of Object.entries(rawHeaders || {})) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) {
      continue;
    }
    if (Array.isArray(value)) {
      headers[key] = value.join(', ');
      continue;
    }
    if (typeof value === 'string') {
      headers[key] = value;
    }
  }
  return headers;
}

function resolveAIProvider() {
  const provider = normalizeText(process.env.AI_PROVIDER).toLowerCase();
  if (!provider) {
    if (normalizeText(process.env.OLLAMA_BASE_URL) || normalizeText(process.env.OLLAMA_MODEL)) {
      return 'ollama';
    }
    if (normalizeText(process.env.GOOGLE_API_KEY) || normalizeText(process.env.GEMINI_API_KEY)) {
      return 'gemini';
    }
    if (normalizeText(process.env.OPENAI_API_KEY)) {
      return 'openai';
    }
    return 'ollama';
  }
  if (provider === 'ollama' || provider === 'local' || provider === 'oss') {
    return 'ollama';
  }
  if (provider === 'google' || provider === 'gemini' || provider === 'gemini-api') {
    return 'gemini';
  }
  if (provider === 'openai') {
    return 'openai';
  }
  return provider;
}

function resolveTimeoutSeconds(envKey, fallbackSeconds) {
  const raw = normalizeText(process.env[envKey]);
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackSeconds;
}

function resolveGeminiAPIKey() {
  return normalizeText(process.env.GOOGLE_API_KEY) || normalizeText(process.env.GEMINI_API_KEY);
}

async function fetchTextOrThrow(provider, endpoint, requestInit, timeoutSeconds) {
  const response = await fetch(endpoint, {
    ...requestInit,
    signal: AbortSignal.timeout(timeoutSeconds * 1000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new UpstreamHTTPError(provider, response.status, text);
  }
  return text;
}

function buildAISystemPrompt() {
  return String.raw`
You generate strategy JSON for Hershy runner.
Return only valid JSON (no markdown).

Required top-level object:
{
  "schemaVersion": 1,
  "kind": "hershy-strategy-graph",
  "strategy": {"id": "string", "name": "string"},
  "generatedAt": "ISO8601",
  "summary": {"blocks": number, "connections": number, "byType": {"streaming": number, "normal": number, "trigger": number, "action": number, "monitoring": number}},
  "blocks": [...],
  "connections": [...]
}

Validation constraints:
- at least 1 streaming block
- at least 1 trigger block
- at least 1 action block
- each action should have at least one incoming trigger-action connection
- include position {x,y} for each block
`.trim();
}

function buildAIUserPrompt(prompt, currentStrategy) {
  let text = `User request:\n${normalizeText(prompt)}`;
  if (currentStrategy && typeof currentStrategy === 'object') {
    text += `\n\nCurrent strategy JSON (optional context):\n${trimForLog(stringifyJSON(currentStrategy), 12000)}`;
  }
  text += '\n\nReturn a complete strategy graph JSON object.';
  return text;
}

function trimForLog(text, limit) {
  if (typeof text !== 'string') {
    return '';
  }
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}...(truncated)`;
}

function stringifyJSON(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

function parseJSON(rawText, label) {
  try {
    return JSON.parse(rawText);
  } catch (error) {
    throw new Error(`decode ${label}: ${error.message}`);
  }
}

function extractMessageContent(content) {
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((item) => (item && typeof item === 'object' && typeof item.text === 'string' ? item.text : ''))
    .join('')
    .trim();
}

function parseChatCompletionContent(rawText) {
  const parsed = parseJSON(rawText, 'chat completion');
  const firstChoice = Array.isArray(parsed.choices) ? parsed.choices[0] : null;
  if (!firstChoice || typeof firstChoice !== 'object') {
    throw new Error('chat completion returned no choices');
  }
  const content = extractMessageContent(firstChoice.message?.content);
  if (!content) {
    throw new Error('chat completion content is empty');
  }
  return content;
}

function parseOllamaChatContent(rawText) {
  const parsed = parseJSON(rawText, 'ollama response');
  const content = normalizeText(parsed?.message?.content);
  if (!content) {
    throw new Error('ollama content is empty');
  }
  return content;
}

function parseGeminiContent(rawText) {
  const parsed = parseJSON(rawText, 'gemini response');
  const firstCandidate = Array.isArray(parsed.candidates) ? parsed.candidates[0] : null;
  const parts = Array.isArray(firstCandidate?.content?.parts) ? firstCandidate.content.parts : [];
  const content = parts
    .map((part) => (part && typeof part === 'object' && typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim();

  if (!content) {
    throw new Error('gemini content is empty');
  }
  return content;
}

function parseStrategyGraph(rawText) {
  let text = normalizeText(rawText);
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    text = normalizeText(fenced[1]);
  }

  const parsed = parseJSON(text, 'strategy JSON');
  if (parsed?.kind === 'hershy-strategy-graph') {
    return parsed;
  }
  if (parsed?.strategy?.kind === 'hershy-strategy-graph') {
    return parsed.strategy;
  }
  throw new Error('response is not hershy-strategy-graph');
}

async function generateStrategyWithOllama(prompt, currentStrategy) {
  const baseURL = normalizeBaseURL(process.env.OLLAMA_BASE_URL || 'http://localhost:11434');
  const endpoint = normalizeText(process.env.OLLAMA_ENDPOINT) || `${baseURL}/api/chat`;
  const model = normalizeText(process.env.OLLAMA_MODEL) || 'gpt-oss:20b';
  const wireAPI = normalizeText(process.env.OLLAMA_WIRE_API).toLowerCase()
    || (endpoint.includes('/v1/') ? 'openai' : 'ollama');

  const payload = wireAPI === 'openai'
    ? {
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: buildAISystemPrompt() },
        { role: 'user', content: buildAIUserPrompt(prompt, currentStrategy) },
      ],
    }
    : {
      model,
      stream: false,
      format: 'json',
      options: { temperature: 0.2 },
      messages: [
        { role: 'system', content: buildAISystemPrompt() },
        { role: 'user', content: buildAIUserPrompt(prompt, currentStrategy) },
      ],
    };

  const headers = { 'Content-Type': 'application/json' };
  const apiKey = normalizeText(process.env.OLLAMA_API_KEY);
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const rawText = await fetchTextOrThrow(
    'ollama',
    endpoint,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    },
    resolveTimeoutSeconds('OLLAMA_TIMEOUT_SEC', 180),
  );

  const content = wireAPI === 'openai'
    ? parseChatCompletionContent(rawText)
    : parseOllamaChatContent(rawText);

  return {
    strategy: parseStrategyGraph(content),
    model,
    source: 'ollama-chat',
  };
}

async function generateStrategyWithGemini(prompt, currentStrategy) {
  const apiKey = resolveGeminiAPIKey();
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY or GEMINI_API_KEY is not set');
  }

  const model = normalizeText(process.env.GEMINI_MODEL) || 'gemini-2.0-flash';
  const baseURL = normalizeBaseURL(process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta');
  const endpoint = normalizeText(process.env.GEMINI_ENDPOINT)
    || `${baseURL}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const payload = {
    systemInstruction: {
      parts: [{ text: buildAISystemPrompt() }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: buildAIUserPrompt(prompt, currentStrategy) }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
    },
  };

  const rawText = await fetchTextOrThrow(
    'gemini',
    endpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    resolveTimeoutSeconds('GEMINI_TIMEOUT_SEC', 45),
  );

  return {
    strategy: parseStrategyGraph(parseGeminiContent(rawText)),
    model,
    source: 'google-gemini-generate-content',
  };
}

async function generateStrategyWithOpenAI(prompt, currentStrategy) {
  const apiKey = normalizeText(process.env.OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const baseURL = normalizeBaseURL(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1');
  const endpoint = normalizeText(process.env.OPENAI_CHAT_ENDPOINT) || `${baseURL}/chat/completions`;
  const model = normalizeText(process.env.OPENAI_MODEL) || 'gpt-4o-mini';

  const payload = {
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: buildAISystemPrompt() },
      { role: 'user', content: buildAIUserPrompt(prompt, currentStrategy) },
    ],
    response_format: { type: 'json_object' },
  };

  const rawText = await fetchTextOrThrow(
    'openai',
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    },
    resolveTimeoutSeconds('OPENAI_TIMEOUT_SEC', 35),
  );

  return {
    strategy: parseStrategyGraph(parseChatCompletionContent(rawText)),
    model,
    source: 'openai-chat-completions',
  };
}
