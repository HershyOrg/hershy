function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBaseURL(raw, fallback = 'http://localhost:11434') {
  const value = normalizeText(raw);
  return (value || fallback).replace(/\/+$/, '');
}

function truncateText(value, maxLength = 1200) {
  const text = String(value || '');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function stringifyJSON(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

function parseJSONContent(rawText, label = 'AI JSON') {
  let text = normalizeText(rawText);
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    text = normalizeText(fenced[1]);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // Fall through to the clearer error below.
      }
    }
    throw new Error(`decode ${label}: ${error.message}`);
  }
}

function normalizeAIProviderAlias(rawProvider) {
  const provider = normalizeText(rawProvider).toLowerCase();
  if (!provider) {
    return '';
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
  if (provider === 'deepseek' || provider === 'deepseek-api') {
    return 'deepseek';
  }
  return provider;
}

function layerEnv(layer, key) {
  if (!layer || !key) {
    return '';
  }
  return normalizeText(process.env[`AI_${String(layer).toUpperCase()}_${key}`]);
}

function parseBoolText(raw) {
  const text = normalizeText(raw).toLowerCase();
  if (!text) {
    return null;
  }
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) {
    return true;
  }
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) {
    return false;
  }
  return null;
}

function resolveLayerBool(layer, key) {
  const fromLayer = parseBoolText(layerEnv(layer, key));
  if (fromLayer !== null) {
    return fromLayer;
  }
  return parseBoolText(process.env[key]);
}

function resolveAIProvider(layer = 'contract_reasoning') {
  const explicit = normalizeAIProviderAlias(layerEnv(layer, 'PROVIDER') || process.env.AI_PROVIDER);
  if (explicit) {
    return explicit;
  }
  if (normalizeText(process.env.OLLAMA_BASE_URL) || normalizeText(process.env.OLLAMA_MODEL)) {
    return 'ollama';
  }
  if (normalizeText(process.env.GOOGLE_API_KEY) || normalizeText(process.env.GEMINI_API_KEY)) {
    return 'gemini';
  }
  if (normalizeText(process.env.DEEPSEEK_API_KEY)) {
    return 'deepseek';
  }
  if (normalizeText(process.env.OPENAI_API_KEY)) {
    return 'openai';
  }
  return 'ollama';
}

function resolveTimeoutSeconds(layer, providerTimeoutEnvKey, fallbackSeconds) {
  const direct = Number.parseInt(layerEnv(layer, providerTimeoutEnvKey), 10);
  if (Number.isFinite(direct) && direct > 0) {
    return direct;
  }
  const generic = Number.parseInt(layerEnv(layer, 'TIMEOUT_SEC'), 10);
  if (Number.isFinite(generic) && generic > 0) {
    return generic;
  }
  const envValue = Number.parseInt(normalizeText(process.env[providerTimeoutEnvKey]), 10);
  return Number.isFinite(envValue) && envValue > 0 ? envValue : fallbackSeconds;
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

function parseChatCompletionMessage(rawText) {
  const parsed = JSON.parse(rawText);
  const firstChoice = Array.isArray(parsed.choices) ? parsed.choices[0] : null;
  const content = extractMessageContent(firstChoice?.message?.content);
  if (!content) {
    throw new Error('chat completion content is empty');
  }
  return content;
}

function parseOllamaChatContent(rawText) {
  const parsed = JSON.parse(rawText);
  const content = normalizeText(parsed?.message?.content);
  if (!content) {
    throw new Error('ollama content is empty');
  }
  return content;
}

function parseGeminiContent(rawText) {
  const parsed = JSON.parse(rawText);
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

function isTimeoutError(error) {
  const name = normalizeText(error?.name).toLowerCase();
  const code = normalizeText(error?.code).toLowerCase();
  const message = normalizeText(error?.message).toLowerCase();
  return name === 'timeouterror' || code === 'abort_err' || code === 'etimedout' || message.includes('timeout');
}

async function fetchTextOrThrow(provider, endpoint, requestInit, timeoutSeconds) {
  const hasTimeout = Number.isFinite(timeoutSeconds) && timeoutSeconds > 0;
  let response;
  try {
    response = await fetch(endpoint, {
      ...requestInit,
      signal: hasTimeout ? AbortSignal.timeout(timeoutSeconds * 1000) : undefined,
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new Error(`${provider} request timed out after ${timeoutSeconds}s`);
    }
    throw new Error(`${provider} request failed: ${error?.message || 'network error'}`);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${provider} status=${response.status} body=${truncateText(text, 800)}`);
  }
  return text;
}

async function callOpenAICompatibleJSON({ provider, layer, systemPrompt, userPrompt, apiKey, baseURL, endpoint, model, timeoutSeconds }) {
  if (!apiKey && provider !== 'ollama') {
    throw new Error(`${provider.toUpperCase()} API key is not set`);
  }
  const payload = {
    model,
    temperature: 0.1,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
  };
  if (provider === 'deepseek') {
    const thinkingEnabled = resolveLayerBool(layer, 'DEEPSEEK_THINKING');
    payload.thinking = { type: thinkingEnabled === false ? 'disabled' : 'enabled' };
    payload.reasoning_effort = layerEnv(layer, 'DEEPSEEK_REASONING_EFFORT')
      || layerEnv(layer, 'REASONING_EFFORT')
      || normalizeText(process.env.DEEPSEEK_REASONING_EFFORT)
      || 'high';
  }
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const rawText = await fetchTextOrThrow(
    provider,
    endpoint || `${baseURL}/chat/completions`,
    { method: 'POST', headers, body: JSON.stringify(payload) },
    timeoutSeconds,
  );
  return { text: parseChatCompletionMessage(rawText), provider, model };
}

async function callOllamaJSON(layer, systemPrompt, userPrompt) {
  const baseURL = normalizeBaseURL(layerEnv(layer, 'OLLAMA_BASE_URL') || process.env.OLLAMA_BASE_URL, 'http://localhost:11434');
  const endpoint = layerEnv(layer, 'OLLAMA_ENDPOINT') || normalizeText(process.env.OLLAMA_ENDPOINT) || `${baseURL}/api/chat`;
  const model = layerEnv(layer, 'OLLAMA_MODEL') || layerEnv(layer, 'MODEL') || normalizeText(process.env.OLLAMA_MODEL) || 'gpt-oss:20b';
  const wireAPI = normalizeText(layerEnv(layer, 'OLLAMA_WIRE_API') || process.env.OLLAMA_WIRE_API).toLowerCase()
    || (endpoint.includes('/v1/') ? 'openai' : 'ollama');
  if (wireAPI === 'openai') {
    return callOpenAICompatibleJSON({
      provider: 'ollama',
      layer,
      systemPrompt,
      userPrompt,
      apiKey: layerEnv(layer, 'OLLAMA_API_KEY') || normalizeText(process.env.OLLAMA_API_KEY),
      baseURL,
      endpoint,
      model,
      timeoutSeconds: resolveTimeoutSeconds(layer, 'OLLAMA_TIMEOUT_SEC', 120),
    });
  }
  const rawText = await fetchTextOrThrow(
    'ollama',
    endpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        options: { temperature: 0.1, think: resolveLayerBool(layer, 'OLLAMA_THINK') === true },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    },
    resolveTimeoutSeconds(layer, 'OLLAMA_TIMEOUT_SEC', 120),
  );
  return { text: parseOllamaChatContent(rawText), provider: 'ollama', model };
}

async function callGeminiJSON(layer, systemPrompt, userPrompt) {
  const apiKey = layerEnv(layer, 'GOOGLE_API_KEY')
    || layerEnv(layer, 'GEMINI_API_KEY')
    || normalizeText(process.env.GOOGLE_API_KEY)
    || normalizeText(process.env.GEMINI_API_KEY);
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY or GEMINI_API_KEY is not set');
  }
  const model = layerEnv(layer, 'GEMINI_MODEL') || layerEnv(layer, 'MODEL') || normalizeText(process.env.GEMINI_MODEL) || 'gemini-2.0-flash';
  const baseURL = normalizeBaseURL(layerEnv(layer, 'GEMINI_BASE_URL') || process.env.GEMINI_BASE_URL, 'https://generativelanguage.googleapis.com/v1beta');
  const endpoint = layerEnv(layer, 'GEMINI_ENDPOINT') || normalizeText(process.env.GEMINI_ENDPOINT)
    || `${baseURL}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const rawText = await fetchTextOrThrow(
    'gemini',
    endpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
      }),
    },
    resolveTimeoutSeconds(layer, 'GEMINI_TIMEOUT_SEC', 90),
  );
  return { text: parseGeminiContent(rawText), provider: 'gemini', model };
}

async function callReasoningJSON(layer, systemPrompt, userPrompt) {
  const provider = resolveAIProvider(layer);
  if (provider === 'ollama') {
    return callOllamaJSON(layer, systemPrompt, userPrompt);
  }
  if (provider === 'gemini') {
    return callGeminiJSON(layer, systemPrompt, userPrompt);
  }
  if (provider === 'openai') {
    const baseURL = normalizeBaseURL(layerEnv(layer, 'OPENAI_BASE_URL') || process.env.OPENAI_BASE_URL, 'https://api.openai.com/v1');
    return callOpenAICompatibleJSON({
      provider,
      layer,
      systemPrompt,
      userPrompt,
      apiKey: layerEnv(layer, 'OPENAI_API_KEY') || normalizeText(process.env.OPENAI_API_KEY),
      baseURL,
      endpoint: layerEnv(layer, 'OPENAI_CHAT_ENDPOINT') || normalizeText(process.env.OPENAI_CHAT_ENDPOINT) || `${baseURL}/chat/completions`,
      model: layerEnv(layer, 'OPENAI_MODEL') || layerEnv(layer, 'MODEL') || normalizeText(process.env.OPENAI_MODEL) || 'gpt-4o-mini',
      timeoutSeconds: resolveTimeoutSeconds(layer, 'OPENAI_TIMEOUT_SEC', 90),
    });
  }
  if (provider === 'deepseek') {
    const baseURL = normalizeBaseURL(layerEnv(layer, 'DEEPSEEK_BASE_URL') || process.env.DEEPSEEK_BASE_URL, 'https://api.deepseek.com');
    return callOpenAICompatibleJSON({
      provider,
      layer,
      systemPrompt,
      userPrompt,
      apiKey: layerEnv(layer, 'DEEPSEEK_API_KEY') || normalizeText(process.env.DEEPSEEK_API_KEY),
      baseURL,
      endpoint: layerEnv(layer, 'DEEPSEEK_CHAT_ENDPOINT') || normalizeText(process.env.DEEPSEEK_CHAT_ENDPOINT) || `${baseURL}/chat/completions`,
      model: layerEnv(layer, 'DEEPSEEK_MODEL') || layerEnv(layer, 'MODEL') || normalizeText(process.env.DEEPSEEK_MODEL) || 'deepseek-v4-flash',
      timeoutSeconds: resolveTimeoutSeconds(layer, 'DEEPSEEK_TIMEOUT_SEC', 180),
    });
  }
  throw new Error(`unsupported AI provider for ${layer}: ${provider}`);
}

function contractReasoningDisabled(options = {}) {
  const raw = options.contractReasoning ?? process.env.AGENT_CONTRACT_REASONING_ENABLED;
  return raw === false || String(raw || '').toLowerCase() === 'false' || String(raw || '') === '0';
}

function plainLanguageDescriptionsDisabled(options = {}) {
  const raw = options.plainLanguageDescriptions ?? process.env.AGENT_PLAIN_LANGUAGE_DESCRIPTIONS_ENABLED;
  return raw === false || String(raw || '').toLowerCase() === 'false' || String(raw || '') === '0';
}

function plainLanguageAIConfigured(options = {}) {
  if (options.plainLanguageDescriptions === true) return true;
  return Boolean(
    layerEnv('plain_language_copy', 'PROVIDER') ||
    normalizeText(process.env.AI_PROVIDER) ||
    normalizeText(process.env.OPENAI_API_KEY) ||
    normalizeText(process.env.GOOGLE_API_KEY) ||
    normalizeText(process.env.GEMINI_API_KEY) ||
    normalizeText(process.env.DEEPSEEK_API_KEY) ||
    normalizeText(process.env.OLLAMA_BASE_URL) ||
    normalizeText(process.env.OLLAMA_MODEL),
  );
}

function strategySummaryDisabled(options = {}) {
  const raw = options.strategySummary ?? process.env.AGENT_STRATEGY_SUMMARY_ENABLED;
  return raw === false || String(raw || '').toLowerCase() === 'false' || String(raw || '') === '0';
}

function strategySummaryAIConfigured(options = {}) {
  if (options.strategySummary === true) return true;
  return Boolean(
    layerEnv('strategy_summary', 'PROVIDER') ||
    normalizeText(process.env.AI_PROVIDER) ||
    normalizeText(process.env.OPENAI_API_KEY) ||
    normalizeText(process.env.GOOGLE_API_KEY) ||
    normalizeText(process.env.GEMINI_API_KEY) ||
    normalizeText(process.env.DEEPSEEK_API_KEY) ||
    normalizeText(process.env.OLLAMA_BASE_URL) ||
    normalizeText(process.env.OLLAMA_MODEL),
  );
}

function collectPlainLanguageDescriptionTargets(strategyGraph = {}, options = {}) {
  const maxBlocks = Math.max(1, Math.min(Number(options.plainLanguageDescriptionBlockLimit || process.env.AGENT_PLAIN_LANGUAGE_DESCRIPTION_BLOCK_LIMIT || 16), 40));
  const blocks = Array.isArray(strategyGraph.blocks) ? strategyGraph.blocks : [];
  return blocks
    .filter((block) => normalizeText(block?.type).toLowerCase() === 'normal')
    .slice(0, maxBlocks)
    .map((block) => {
      const config = block?.config && typeof block.config === 'object' ? block.config : {};
      return {
        id: normalizeText(block.id),
        label: normalizeText(config.name || config.label || config.title || block.id),
        role: normalizeText(config.overviewDescription || config.description || config.summary),
        inputs: Array.isArray(config.inputBlocks || config.inputs)
          ? (config.inputBlocks || config.inputs).map((item) => typeof item === 'string' ? item : normalizeText(item?.name || item?.id)).filter(Boolean)
          : [],
        outputs: Array.isArray(config.outputBlocks || config.outputs)
          ? (config.outputBlocks || config.outputs).map((item) => typeof item === 'string' ? item : normalizeText(item?.name || item?.id)).filter(Boolean)
          : [],
        expressionHint: truncateText(normalizeText(config.expression || config.formula || config.logic || config.code), 300),
      };
    })
    .filter((block) => block.id);
}

function normalizePlainLanguageDescriptionResult(raw, responseMeta, requestedBlocks) {
  const parsed = raw && typeof raw === 'object' ? raw : {};
  const descriptions = Array.isArray(parsed.descriptions) ? parsed.descriptions : [];
  const requestedIds = new Set(requestedBlocks.map((block) => block.id));
  return {
    status: descriptions.length > 0 ? 'completed' : 'empty',
    provider: responseMeta.provider,
    model: responseMeta.model,
    generatedAt: new Date().toISOString(),
    descriptions: descriptions
      .map((item) => {
        const record = item && typeof item === 'object' ? item : {};
        return {
          id: normalizeText(record.id),
          logicDescription: normalizeText(record.logicDescription || record.logic_description || record.description),
        };
      })
      .filter((item) => requestedIds.has(item.id) && item.logicDescription),
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String).slice(0, 12) : [],
  };
}

export async function runPlainLanguageLogicDescriptionStage({ prompt, workflowPlan, strategyGraph }, options = {}) {
  if (plainLanguageDescriptionsDisabled(options)) {
    return { status: 'skipped', reason: 'plain-language descriptions disabled', descriptions: [], warnings: [] };
  }
  if (!plainLanguageAIConfigured(options)) {
    return { status: 'skipped', reason: 'no AI provider configured for plain-language descriptions', descriptions: [], warnings: [] };
  }

  const targets = collectPlainLanguageDescriptionTargets(strategyGraph, options);
  if (targets.length === 0) {
    return { status: 'skipped', reason: 'no normal indicator blocks to describe', descriptions: [], warnings: [] };
  }

  const layer = 'plain_language_copy';
  const systemPrompt = [
    'You write Korean UI copy for trading strategy blocks.',
    'The reader is a non-developer. Explain the meaning, not the implementation.',
    'Return JSON only.',
    'Do not copy raw ids, camelCase, snake_case, formulas, code operators, internal workflow wording, or variable names.',
    'Do not mention "Agent loop", "workflow", "runtime", "config", "resolver", "input", or "output" except the fixed heading text below.',
    'Each logicDescription must be exactly three lines with these headings:',
    '1. 어떤 데이터를 받아와서: ...',
    '2. 어떤 동작을 수행하고: ...',
    '3. 어떤 output을 내는지: ...',
    'Use everyday Korean such as 현재 시세, 지갑 잔고, 예상 수익, 거래 비용, 위험 신호, 실행 준비 상태.',
  ].join('\n');
  const userPrompt = [
    `User request:\n${prompt}`,
    `Selected strategy:\n${stringifyJSON({
      algorithm: workflowPlan?.selectedAlgorithm?.title || workflowPlan?.selectedAlgorithm?.id,
      objective: workflowPlan?.algorithmContract?.objective,
      executionDomain: workflowPlan?.executionDomain?.title || workflowPlan?.executionDomain?.id,
    })}`,
    `Blocks to describe:\n${stringifyJSON(targets)}`,
    `Return this JSON shape:
{
  "descriptions": [
    {
      "id": "same block id",
      "logicDescription": "1. 어떤 데이터를 받아와서: ...\\n2. 어떤 동작을 수행하고: ...\\n3. 어떤 output을 내는지: ..."
    }
  ],
  "warnings": []
}`,
  ].join('\n\n');

  try {
    const response = await callReasoningJSON(layer, systemPrompt, userPrompt);
    const parsed = parseJSONContent(response.text, 'plain-language logic descriptions');
    return normalizePlainLanguageDescriptionResult(parsed, response, targets);
  } catch (error) {
    return {
      status: 'failed',
      reason: error?.message || String(error),
      descriptions: [],
      warnings: [error?.message || String(error)],
    };
  }
}

function collectStrategySummaryContext({ workflowPlan, strategyGraph, evidenceBundle, executionReadiness }) {
  const blocks = Array.isArray(strategyGraph?.blocks) ? strategyGraph.blocks : [];
  const connections = Array.isArray(strategyGraph?.connections) ? strategyGraph.connections : [];
  const metadata = strategyGraph?.metadata && typeof strategyGraph.metadata === 'object' ? strategyGraph.metadata : {};
  const workflowGroups = Array.isArray(metadata.workflowGroups) ? metadata.workflowGroups : [];
  const blockSummary = blocks.slice(0, 32).map((block) => {
    const config = block?.config && typeof block.config === 'object' ? block.config : {};
    return {
      id: normalizeText(block?.id),
      type: normalizeText(block?.type),
      name: normalizeText(config.name || block?.id),
      actionType: normalizeText(config.actionType || config.dexProtocol),
      functionName: normalizeText(config.functionName || config.evmFunctionName),
      contractAddress: normalizeText(config.contractAddress),
      paperStatus: normalizeText(config.paperStatus),
      liveExecutable: config.liveExecutable === true,
      checkContextFrom: normalizeText(config.checkContextFrom),
    };
  });
  return {
    strategy: {
      title: normalizeText(strategyGraph?.strategy?.name || metadata.strategyBlock?.title),
      id: normalizeText(strategyGraph?.strategy?.id),
      kind: normalizeText(metadata.strategyKind),
      algorithm: workflowPlan?.selectedAlgorithm?.title || workflowPlan?.selectedAlgorithm?.id || '',
      objective: workflowPlan?.algorithmContract?.objective || '',
      executionDomain: workflowPlan?.executionDomain?.title || workflowPlan?.executionDomain?.id || '',
    },
    graph: {
      blockCount: blocks.length,
      connectionCount: connections.length,
      workflowGroups: workflowGroups.map((group) => ({
        id: normalizeText(group?.id),
        title: normalizeText(group?.title),
        type: normalizeText(group?.sequenceType || group?.type),
        lane: normalizeText(group?.lane),
        nodes: Array.isArray(group?.nodeIds) ? group.nodeIds.length : 0,
      })),
      blocks: blockSummary,
    },
    contractResolution: evidenceBundle?.contractResolution || metadata.contractResolution || null,
    executionReadiness: executionReadiness || metadata.executionReadiness || null,
    validation: metadata.agentLoopContractValidation || null,
  };
}

function normalizeStrategySummaryResult(raw, responseMeta) {
  const parsed = raw && typeof raw === 'object' ? raw : {};
  const keyPoints = Array.isArray(parsed.keyPoints || parsed.key_points)
    ? (parsed.keyPoints || parsed.key_points).map(String).map(normalizeText).filter(Boolean).slice(0, 4)
    : [];
  const riskNotes = Array.isArray(parsed.riskNotes || parsed.risk_notes)
    ? (parsed.riskNotes || parsed.risk_notes).map(String).map(normalizeText).filter(Boolean).slice(0, 4)
    : [];
  return {
    status: normalizeText(parsed.summaryText || parsed.summary || parsed.strategySummary) ? 'completed' : 'empty',
    provider: responseMeta.provider,
    model: responseMeta.model,
    generatedAt: new Date().toISOString(),
    source: 'ai-model',
    title: normalizeText(parsed.title),
    summaryText: normalizeText(parsed.summaryText || parsed.summary || parsed.strategySummary),
    keyPoints,
    executionReadinessText: normalizeText(parsed.executionReadinessText || parsed.execution_readiness || parsed.readiness),
    riskNotes,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String).slice(0, 12) : [],
  };
}

export async function runStrategySummaryStage({ prompt, workflowPlan, strategyGraph, evidenceBundle, executionReadiness }, options = {}) {
  if (strategySummaryDisabled(options)) {
    return { status: 'skipped', reason: 'strategy summary disabled', warnings: [] };
  }
  if (!strategySummaryAIConfigured(options)) {
    return { status: 'skipped', reason: 'no AI provider configured for strategy summary', warnings: [] };
  }

  const layer = 'strategy_summary';
  const context = collectStrategySummaryContext({ workflowPlan, strategyGraph, evidenceBundle, executionReadiness });
  const systemPrompt = [
    'You write Korean summaries for trading strategy graphs.',
    'The reader is a non-developer who wants to understand what this strategy does and whether it can actually execute.',
    'Return JSON only.',
    'Do not include hidden reasoning, raw implementation dumps, or long trace logs.',
    'Be concrete about missing execution prerequisites. Do not invent contract addresses, balances, or live readiness.',
    'Use warm, plain Korean. Keep the summaryText within 2-3 sentences.',
  ].join('\n');
  const userPrompt = [
    `User request:\n${prompt}`,
    `Strategy context:\n${stringifyJSON(context)}`,
    `Return this JSON shape:
{
  "title": "짧은 한국어 제목",
  "summaryText": "전략이 무엇을 보고, 어떤 조건에서 무엇을 실행하는지 2-3문장으로 설명",
  "keyPoints": ["핵심 포인트 1", "핵심 포인트 2", "핵심 포인트 3"],
  "executionReadinessText": "실행 가능 여부와 아직 필요한 준비",
  "riskNotes": ["주의점 1", "주의점 2"],
  "warnings": []
}`,
  ].join('\n\n');

  try {
    const response = await callReasoningJSON(layer, systemPrompt, userPrompt);
    const parsed = parseJSONContent(response.text, 'strategy summary');
    return normalizeStrategySummaryResult(parsed, response);
  } catch (error) {
    return {
      status: 'failed',
      reason: error?.message || String(error),
      warnings: [error?.message || String(error)],
    };
  }
}

function collectContractEvidence(evidenceBundle = {}, options = {}) {
  const maxChunks = Math.max(4, Math.min(Number(options.contractReasoningChunkLimit || process.env.AGENT_CONTRACT_REASONING_CHUNK_LIMIT || 18), 40));
  const chunks = Array.isArray(evidenceBundle.chunks) ? evidenceBundle.chunks : [];
  const contractChunks = chunks.filter((chunk) => {
    const type = normalizeText(chunk.chunkType || chunk.chunk_type).toLowerCase();
    return type.includes('contract_summary')
      || type.startsWith('abi_')
      || type.startsWith('solidity_');
  });
  const selectedChunks = (contractChunks.length ? contractChunks : chunks).slice(0, maxChunks);
  const contracts = Array.isArray(evidenceBundle.contracts) ? evidenceBundle.contracts : [];
  const entities = Array.isArray(evidenceBundle.entities) ? evidenceBundle.entities : [];
  return {
    contracts: contracts.slice(0, 20),
    entities: entities
      .filter((entity) => normalizeText(entity.type).toLowerCase() === 'contract' || entity.address)
      .slice(0, 20),
    chunks: selectedChunks.map((chunk) => ({
      id: chunk.id,
      chunkType: chunk.chunkType || chunk.chunk_type,
      contractName: chunk.canonicalName || chunk.canonical_name,
      address: chunk.address,
      internalUri: chunk.internalUri || chunk.internal_uri,
      previousInternalUri: chunk.previousInternalUri || chunk.previous_internal_uri,
      score: chunk.score,
      text: truncateText(chunk.text, 1600),
    })),
  };
}

function normalizeAnalysisResult(raw, responseMeta, evidence) {
  const parsed = raw && typeof raw === 'object' ? raw : {};
  const analyses = Array.isArray(parsed.analyses) ? parsed.analyses : [];
  return {
    status: analyses.length > 0 ? 'completed' : 'empty',
    provider: responseMeta.provider,
    model: responseMeta.model,
    generatedAt: new Date().toISOString(),
    analyses: analyses.map((analysis, index) => {
      const record = analysis && typeof analysis === 'object' ? analysis : {};
      return {
        id: normalizeText(record.id) || `contract-analysis-${index + 1}`,
        contractName: normalizeText(record.contractName || record.contract_name),
        address: normalizeText(record.address),
        chainId: record.chainId || record.chain_id || null,
        role: normalizeText(record.role),
        reasoningSummary: normalizeText(record.reasoningSummary || record.reasoning_summary || record.summary),
        adminAndGovernance: normalizeText(record.adminAndGovernance || record.admin_and_governance),
        proxyAndUpgradeability: normalizeText(record.proxyAndUpgradeability || record.proxy_and_upgradeability),
        feesCapsLeveragePause: normalizeText(record.feesCapsLeveragePause || record.fees_caps_leverage_pause),
        oracleAndFeeds: normalizeText(record.oracleAndFeeds || record.oracle_and_feeds),
        assetFlow: normalizeText(record.assetFlow || record.asset_flow),
        strategyRelevance: normalizeText(record.strategyRelevance || record.strategy_relevance),
        riskFindings: Array.isArray(record.riskFindings || record.risk_findings) ? (record.riskFindings || record.risk_findings).map(String).slice(0, 12) : [],
        unknowns: Array.isArray(record.unknowns) ? record.unknowns.map(String).slice(0, 12) : [],
        evidenceChunkIds: Array.isArray(record.evidenceChunkIds || record.evidence_chunk_ids)
          ? (record.evidenceChunkIds || record.evidence_chunk_ids).map(String)
          : evidence.chunks.map((chunk) => chunk.id).filter(Boolean).slice(0, 8),
      };
    }),
    globalFindings: Array.isArray(parsed.globalFindings || parsed.global_findings) ? (parsed.globalFindings || parsed.global_findings).map(String).slice(0, 12) : [],
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String).slice(0, 12) : [],
  };
}

export async function runContractReasoningAnalysis({ prompt, workflowPlan, evidenceBundle }, options = {}) {
  if (contractReasoningDisabled(options)) {
    return { status: 'skipped', reason: 'contract reasoning disabled', analyses: [], warnings: [] };
  }
  const evidence = collectContractEvidence(evidenceBundle, options);
  if (evidence.chunks.length === 0 && evidence.contracts.length === 0 && evidence.entities.length === 0) {
    return { status: 'skipped', reason: 'no contract evidence to analyze', analyses: [], warnings: [] };
  }

  const layer = 'contract_reasoning';
  const systemPrompt = [
    'You are a smart-contract reasoning worker inside an agentic trading workflow builder.',
    'Analyze only the supplied evidence. Do not invent contract addresses, owners, fees, oracle feeds, pause state, or protocol relationships.',
    'Return JSON only. Do not include hidden chain-of-thought; provide concise evidence-backed reasoning summaries.',
    'If a field is not proven by evidence, say unknown and add it to unknowns.',
  ].join('\n');
  const userPrompt = [
    `User request:\n${prompt}`,
    `Selected workflow:\n${stringifyJSON({
      selectedAlgorithm: workflowPlan?.selectedAlgorithm,
      executionDomain: workflowPlan?.executionDomain,
      researchTasks: workflowPlan?.researchTasks,
    })}`,
    `Evidence:\n${stringifyJSON(evidence)}`,
    `Return this JSON shape:
{
  "analyses": [
    {
      "contractName": "string",
      "address": "string or unknown",
      "chainId": 8453,
      "role": "router|factory|pool|voter|oracle|vault|governance|unknown",
      "reasoningSummary": "short evidence-backed explanation",
      "adminAndGovernance": "owner/admin/governance facts or unknown",
      "proxyAndUpgradeability": "proxy/implementation facts or unknown",
      "feesCapsLeveragePause": "fee/cap/leverage/pause facts or unknown",
      "oracleAndFeeds": "oracle/feed facts or unknown",
      "assetFlow": "how assets can move or unknown",
      "strategyRelevance": "how this matters to the requested workflow",
      "riskFindings": ["evidence-backed risks only"],
      "unknowns": ["missing facts that should be researched next"],
      "evidenceChunkIds": ["chunk ids used"]
    }
  ],
  "globalFindings": ["cross-contract observations"],
  "warnings": ["source freshness/conflict warnings"]
}`,
  ].join('\n\n');

  try {
    const response = await callReasoningJSON(layer, systemPrompt, userPrompt);
    const parsed = parseJSONContent(response.text, 'contract reasoning analysis');
    return normalizeAnalysisResult(parsed, response, evidence);
  } catch (error) {
    return {
      status: 'failed',
      reason: error?.message || String(error),
      analyses: [],
      warnings: [error?.message || String(error)],
    };
  }
}
