const DEFAULT_WEB_RESULT_LIMIT = 5;
const DEFAULT_WEB_QUERY_LIMIT = 4;
const DEFAULT_PAGE_FETCH_LIMIT = 4;
const DEFAULT_FETCH_TIMEOUT_MS = 8_000;

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values) {
  return Array.from(new Set((values || []).map(normalizeText).filter(Boolean)));
}

function slugify(value, fallback = 'label') {
  const slug = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function truncateText(value, maxLength = 800) {
  const text = String(value || '');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

const LABEL_STOPWORDS = new Set([
  'with',
  'from',
  'that',
  'this',
  'into',
  'workflow',
  'implementation',
  'official',
  'documentation',
  'docs',
  'api',
  'reference',
  'search',
  'find',
  'make',
  '만들어줘',
  '만들어서',
  '찾아줘',
  '해서',
  '에서',
  '그리고',
  '있는',
  '없는',
  '싶어',
  '최적',
  '최적의',
  '보내줘',
  '공급하고',
  '구현',
  '워크플로우',
]);

function labelFromText(label, source, reason, evidence = [], confidence = 0.5) {
  const normalized = normalizeText(label);
  if (!normalized) {
    return null;
  }
  return {
    id: `${source}-${slugify(normalized)}`,
    label: normalized,
    source,
    reason,
    confidence,
    evidence,
  };
}

function extractPromptLabelCandidates(text) {
  const raw = normalizeText(text);
  const english = raw.match(/[A-Za-z][A-Za-z0-9_/-]{2,}/g) || [];
  const korean = raw.match(/[가-힣][가-힣A-Za-z0-9_/-]{1,}/g) || [];
  const tickers = raw.match(/\b[A-Z]{2,8}\b/g) || [];
  return uniqueStrings([...tickers, ...english, ...korean])
    .map((item) => item.replace(/(하고|해서|에서|으로|에게|부터|까지|처럼|하게|해줘)$/u, ''))
    .filter((item) => !LABEL_STOPWORDS.has(item.toLowerCase()))
    .filter((item) => item.length >= 2)
    .slice(0, 14);
}

function extractTitleKeywords(text) {
  const raw = normalizeText(text);
  const words = raw.match(/[A-Za-z][A-Za-z0-9_/-]{3,}|[가-힣][가-힣A-Za-z0-9_/-]{2,}/g) || [];
  return uniqueStrings(words)
    .filter((item) => !LABEL_STOPWORDS.has(item.toLowerCase()))
    .slice(0, 6);
}

function isFalseValue(value) {
  return value === false || String(value || '').toLowerCase() === 'false' || String(value || '').toLowerCase() === '0';
}

function htmlDecode(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, ' ')
    .replace(/&nbsp;/g, ' ');
}

function stripTags(value) {
  return htmlDecode(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function resolveWebSearchProvider(options = {}) {
  const explicit = normalizeText(options.webSearchProvider || options.webProvider || process.env.AGENT_WEB_SEARCH_PROVIDER).toLowerCase();
  if (explicit) {
    return explicit;
  }
  if (normalizeText(options.braveSearchApiKey || process.env.BRAVE_SEARCH_API_KEY)) {
    return 'brave';
  }
  if (normalizeText(options.tavilyApiKey || process.env.TAVILY_API_KEY)) {
    return 'tavily';
  }
  if (normalizeText(options.serperApiKey || process.env.SERPER_API_KEY)) {
    return 'serper';
  }
  return 'duckduckgo';
}

function buildWebResearchQueries(prompt, workflowPlan, options = {}) {
  const intent = workflowPlan?.intent || {};
  const algorithm = workflowPlan?.selectedAlgorithm || {};
  const domain = workflowPlan?.executionDomain || {};
  const chainLabel = normalizeText(intent.chainLabel);
  const assets = Array.isArray(intent.assetGroups) ? intent.assetGroups.join(' ') : '';
  const algorithmTitle = normalizeText(algorithm.title);
  const baseQuery = normalizeText(prompt);
  const queries = [
    baseQuery,
    `${baseQuery} workflow implementation docs API`,
  ];

  if (domain.kgModuleEnabled || domain.id === 'onchain_only' || domain.id === 'hybrid_cex_onchain') {
    queries.push(`${chainLabel} ${assets} ${algorithmTitle} protocol docs contracts addresses API`);
    queries.push(`${chainLabel} ${baseQuery} official docs github explorer`);
  }

  if (domain.id === 'cex_only' || domain.id === 'hybrid_cex_onchain') {
    queries.push(`${assets || baseQuery} exchange API docs websocket order market data`);
  }

  if (algorithm.id === 'dex_lp_pool_selection') {
    queries.push(`${chainLabel} ${assets} liquidity pool DEX docs factory router gauge`);
  } else if (algorithm.id === 'dex_arbitrage_scan') {
    queries.push(`${chainLabel} ${assets} DEX router quoter arbitrage pool docs`);
  } else if (algorithm.id === 'yield_allocator') {
    queries.push(`${chainLabel} ${assets} yield vault lending market docs cap pause oracle`);
  } else if (algorithm.id === 'generic_agentic_workflow') {
    queries.push(`${baseQuery} official documentation API reference`);
  }

  const optionQueries = Array.isArray(options.webQueries)
    ? options.webQueries
    : String(options.webQueries || '')
      .split('|')
      .map((item) => item.trim())
      .filter(Boolean);
  return uniqueStrings([...optionQueries, ...queries]).slice(0, Math.max(1, Number(options.webQueryLimit || process.env.AGENT_WEB_QUERY_LIMIT || DEFAULT_WEB_QUERY_LIMIT)));
}

async function braveSearch(query, options = {}) {
  const apiKey = normalizeText(options.braveSearchApiKey || process.env.BRAVE_SEARCH_API_KEY);
  if (!apiKey) {
    throw new Error('BRAVE_SEARCH_API_KEY is required for Brave web search');
  }
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(Math.max(1, Math.min(Number(options.webResultLimit) || DEFAULT_WEB_RESULT_LIMIT, 20))));
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
    signal: AbortSignal.timeout(Number(options.webSearchTimeoutMs || process.env.AGENT_WEB_SEARCH_TIMEOUT_MS || DEFAULT_FETCH_TIMEOUT_MS)),
  });
  if (!response.ok) {
    throw new Error(`Brave search failed: HTTP ${response.status}`);
  }
  const data = await response.json();
  return (data.web?.results || []).map((item) => ({
    title: normalizeText(item.title),
    url: normalizeText(item.url),
    snippet: stripTags(item.description || item.extra_snippets?.join(' ') || ''),
    publishedAt: normalizeText(item.age),
    provider: 'brave',
  }));
}

async function tavilySearch(query, options = {}) {
  const apiKey = normalizeText(options.tavilyApiKey || process.env.TAVILY_API_KEY);
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY is required for Tavily web search');
  }
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: options.tavilySearchDepth || 'basic',
      max_results: Math.max(1, Math.min(Number(options.webResultLimit) || DEFAULT_WEB_RESULT_LIMIT, 20)),
      include_answer: false,
      include_raw_content: false,
    }),
    signal: AbortSignal.timeout(Number(options.webSearchTimeoutMs || process.env.AGENT_WEB_SEARCH_TIMEOUT_MS || DEFAULT_FETCH_TIMEOUT_MS)),
  });
  if (!response.ok) {
    throw new Error(`Tavily search failed: HTTP ${response.status}`);
  }
  const data = await response.json();
  return (data.results || []).map((item) => ({
    title: normalizeText(item.title),
    url: normalizeText(item.url),
    snippet: stripTags(item.content || ''),
    score: Number(item.score || 0),
    provider: 'tavily',
  }));
}

async function serperSearch(query, options = {}) {
  const apiKey = normalizeText(options.serperApiKey || process.env.SERPER_API_KEY);
  if (!apiKey) {
    throw new Error('SERPER_API_KEY is required for Serper web search');
  }
  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
    },
    body: JSON.stringify({
      q: query,
      num: Math.max(1, Math.min(Number(options.webResultLimit) || DEFAULT_WEB_RESULT_LIMIT, 20)),
    }),
    signal: AbortSignal.timeout(Number(options.webSearchTimeoutMs || process.env.AGENT_WEB_SEARCH_TIMEOUT_MS || DEFAULT_FETCH_TIMEOUT_MS)),
  });
  if (!response.ok) {
    throw new Error(`Serper search failed: HTTP ${response.status}`);
  }
  const data = await response.json();
  return (data.organic || []).map((item) => ({
    title: normalizeText(item.title),
    url: normalizeText(item.link),
    snippet: stripTags(item.snippet || ''),
    provider: 'serper',
  }));
}

function normalizeDuckDuckGoURL(rawUrl) {
  const url = htmlDecode(rawUrl);
  if (url.startsWith('//duckduckgo.com/l/?') || url.startsWith('https://duckduckgo.com/l/?')) {
    const parsed = new URL(url.startsWith('//') ? `https:${url}` : url);
    const target = parsed.searchParams.get('uddg');
    return target ? decodeURIComponent(target) : url;
  }
  return url;
}

async function duckDuckGoSearch(query, options = {}) {
  const url = new URL('https://duckduckgo.com/html/');
  url.searchParams.set('q', query);
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'Mozilla/5.0 HershyAgenticWorkflow/1.0',
    },
    signal: AbortSignal.timeout(Number(options.webSearchTimeoutMs || process.env.AGENT_WEB_SEARCH_TIMEOUT_MS || DEFAULT_FETCH_TIMEOUT_MS)),
  });
  if (!response.ok) {
    throw new Error(`DuckDuckGo search failed: HTTP ${response.status}`);
  }
  const html = await response.text();
  const results = [];
  const resultRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let match = resultRegex.exec(html);
  while (match && results.length < Math.max(1, Math.min(Number(options.webResultLimit) || DEFAULT_WEB_RESULT_LIMIT, 20))) {
    results.push({
      title: stripTags(match[2]),
      url: normalizeDuckDuckGoURL(match[1]),
      snippet: stripTags(match[3]),
      provider: 'duckduckgo',
    });
    match = resultRegex.exec(html);
  }
  return results;
}

async function runSingleWebSearch(query, provider, options = {}) {
  if (provider === 'brave') {
    return braveSearch(query, options);
  }
  if (provider === 'tavily') {
    return tavilySearch(query, options);
  }
  if (provider === 'serper') {
    return serperSearch(query, options);
  }
  if (provider === 'duckduckgo') {
    return duckDuckGoSearch(query, options);
  }
  throw new Error(`unsupported web search provider: ${provider}`);
}

function classifySource(url, title = '') {
  const text = `${url} ${title}`.toLowerCase();
  if (/etherscan|basescan|arbiscan|optimistic\.etherscan|polygonscan|bscscan/.test(text)) {
    return 'explorer';
  }
  if (/github\.com/.test(text)) {
    return 'github';
  }
  if (/docs|documentation|developer|api|reference/.test(text)) {
    return 'api_or_docs';
  }
  if (/defillama|coingecko|coinmarketcap|dune|flipside|thegraph|subgraph/.test(text)) {
    return 'data_api';
  }
  if (/medium|mirror|blog|governance|forum/.test(text)) {
    return 'governance_or_blog';
  }
  return 'web';
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function extractAddresses(text) {
  return uniqueStrings(String(text || '').match(/0x[a-fA-F0-9]{40}/g) || []);
}

function buildCandidateTargets(results) {
  const candidates = [];
  const addressHints = [];
  for (const result of results) {
    const domain = extractDomain(result.url);
    const category = classifySource(result.url, result.title);
    const addresses = extractAddresses(`${result.title} ${result.url} ${result.snippet}`);
    addressHints.push(...addresses);
    candidates.push({
      title: result.title,
      url: result.url,
      domain,
      category,
      reason: category === 'api_or_docs'
        ? 'Likely documentation/API source for implementation research'
        : category === 'explorer'
          ? 'Likely explorer source for on-chain contract evidence'
          : category === 'github'
            ? 'Likely repository source for code/API integration details'
            : 'Potential background source for workflow concretization',
    });
  }
  return {
    sourceCandidates: uniqueByURL(candidates).slice(0, 20),
    apiCandidates: uniqueByURL(candidates.filter((item) => ['api_or_docs', 'data_api', 'github'].includes(item.category))).slice(0, 10),
    onchainCandidates: uniqueByURL(candidates.filter((item) => item.category === 'explorer')).slice(0, 10),
    addressHints: uniqueStrings(addressHints),
  };
}

function uniqueLabels(labels) {
  const seen = new Set();
  const out = [];
  for (const item of labels || []) {
    if (!item?.label) {
      continue;
    }
    const key = normalizeText(item.label).toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
  }
  return out;
}

function buildAdaptiveLabels(prompt, workflowPlan, webDiscovery) {
  const labels = [];
  const algorithmTitle = workflowPlan?.selectedAlgorithm?.title;
  const domainTitle = workflowPlan?.executionDomain?.title;
  const intent = workflowPlan?.intent || {};
  const promptEvidence = [{ type: 'prompt', value: prompt }];

  labels.push(labelFromText(algorithmTitle, 'planner', 'Initial planner-selected workflow shape.', promptEvidence, 0.45));
  labels.push(labelFromText(domainTitle, 'planner', 'Broad execution domain inferred before external evidence.', promptEvidence, 0.45));

  for (const asset of intent.assetGroups || []) {
    labels.push(labelFromText(asset, 'prompt', 'Asset or market symbol extracted from the user prompt.', promptEvidence, 0.75));
  }
  if (intent.chainLabel) {
    labels.push(labelFromText(intent.chainLabel, 'prompt', 'Chain or environment hint extracted from the user prompt.', promptEvidence, 0.7));
  }
  for (const candidate of extractPromptLabelCandidates(prompt)) {
    labels.push(labelFromText(candidate, 'prompt', 'Concept extracted directly from the user prompt.', promptEvidence, 0.6));
  }

  for (const source of (webDiscovery?.results || []).slice(0, 12)) {
    const evidence = [{ type: 'web_result', title: source.title, url: source.url, query: source.query }];
    if (source.category) {
      labels.push(labelFromText(source.category.replace(/_/g, ' '), 'web-category', 'Source type inferred from web result URL/title.', evidence, 0.55));
    }
    const domain = extractDomain(source.url);
    if (domain) {
      labels.push(labelFromText(domain, 'web-domain', 'Domain surfaced by strategy web discovery.', evidence, 0.6));
    }
    for (const keyword of extractTitleKeywords(`${source.title} ${source.snippet}`)) {
      labels.push(labelFromText(keyword, 'web-keyword', 'Keyword surfaced by current web search evidence.', evidence, 0.5));
    }
  }

  for (const candidate of webDiscovery?.candidateTargets?.apiCandidates || []) {
    labels.push(labelFromText(candidate.domain || candidate.title, 'api-candidate', 'Potential API/docs integration target discovered by web research.', [{ type: 'url', url: candidate.url, title: candidate.title }], 0.65));
  }
  for (const candidate of webDiscovery?.candidateTargets?.onchainCandidates || []) {
    labels.push(labelFromText(candidate.domain || candidate.title, 'onchain-candidate', 'Potential on-chain/explorer evidence target discovered by web research.', [{ type: 'url', url: candidate.url, title: candidate.title }], 0.65));
  }

  return uniqueLabels(labels.filter(Boolean)).slice(0, 28);
}

function uniqueByURL(items) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const key = normalizeText(item.url);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
  }
  return out;
}

function buildImplementationResearchTasks(prompt, workflowPlan, webDiscovery) {
  const domain = workflowPlan?.executionDomain || {};
  const intent = workflowPlan?.intent || {};
  const candidates = webDiscovery?.candidateTargets || {};
  const topTitles = (candidates.sourceCandidates || [])
    .slice(0, 6)
    .map((item) => item.title)
    .filter(Boolean)
    .join(' ');
  const kgTasks = [];
  if (domain.kgModuleEnabled) {
    kgTasks.push({
      kind: 'implementation_kg_search',
      query: truncateText(`${intent.chainLabel || ''} ${prompt} ${topTitles}`.trim(), 500),
      priority: 'high',
      useProtocolKG: true,
      expectedEvidence: [
        'current KG page URI',
        'verified contract/entity chunks',
        'deployment chain/address',
      ],
    });
    if ((candidates.addressHints || []).length > 0) {
      kgTasks.push({
        kind: 'implementation_contract_lookup',
        query: candidates.addressHints.slice(0, 5).join(' '),
        priority: 'high',
        useProtocolKG: true,
        expectedEvidence: [
          'contract entity',
          'source chunk',
          'proxy/admin/owner facts when available',
        ],
      });
    }
  }

  return {
    kgTasks,
    apiTasks: (candidates.apiCandidates || []).slice(0, 6).map((item) => ({
      kind: 'api_or_docs_research',
      url: item.url,
      title: item.title,
      domain: item.domain,
      expectedEvidence: ['docs title', 'API surface hints', 'implementation constraints'],
    })),
    onchainTasks: (candidates.onchainCandidates || []).slice(0, 6).map((item) => ({
      kind: 'explorer_research',
      url: item.url,
      title: item.title,
      domain: item.domain,
      expectedEvidence: ['contract page', 'verified source', 'deployment metadata'],
    })),
  };
}

export async function runStrategyWebResearch(promptInput, workflowPlan, options = {}) {
  const prompt = normalizeText(promptInput);
  if (!prompt) {
    return { status: 'skipped', reason: 'prompt is empty', searches: [], results: [], warnings: [] };
  }
  if (isFalseValue(options.webSearch ?? process.env.AGENT_WEB_SEARCH_ENABLED)) {
    return { status: 'skipped', reason: 'web search disabled', searches: [], results: [], warnings: [] };
  }

  const provider = resolveWebSearchProvider(options);
  const queries = buildWebResearchQueries(prompt, workflowPlan, options);
  const searches = [];
  const warnings = [];
  for (const query of queries) {
    try {
      const results = await runSingleWebSearch(query, provider, options);
      searches.push({
        query,
        provider,
        results: results.map((result) => ({
          ...result,
          query,
          category: classifySource(result.url, result.title),
        })),
      });
    } catch (error) {
      warnings.push({ query, provider, message: error?.message || String(error) });
    }
  }

  const results = uniqueByURL(searches.flatMap((search) => search.results || []));
  const candidateTargets = buildCandidateTargets(results);
  const implementationResearchTasks = buildImplementationResearchTasks(prompt, workflowPlan, {
    candidateTargets,
  });

  return {
    status: results.length > 0 ? 'completed' : warnings.length > 0 ? 'failed_or_empty' : 'empty',
    provider,
    queries,
    searches,
    results,
    candidateTargets,
    implementationResearchTasks,
    warnings,
    generatedAt: new Date().toISOString(),
  };
}

export function concretizeWorkflowPlanWithWebResearch(workflowPlan, webDiscovery) {
  if (!workflowPlan || typeof workflowPlan !== 'object') {
    return workflowPlan;
  }
  const webCompleted = webDiscovery?.status === 'completed';
  const implementationTasks = webDiscovery?.implementationResearchTasks || {};
  const adaptiveLabels = buildAdaptiveLabels(workflowPlan.intent?.userPrompt || '', workflowPlan, webDiscovery);
  const mergedResearchTasks = [
    ...(workflowPlan.researchTasks || []),
    ...(implementationTasks.kgTasks || []),
  ];
  const workflow = Array.isArray(workflowPlan.workflow) ? [...workflowPlan.workflow] : [];
  const hasWebStep = workflow.some((step) => step.id === 'web-discovery');
  if (!hasWebStep) {
    const insertIndex = workflow.findIndex((step) => step.phase !== 'intent');
    const webStep = {
      id: 'web-discovery',
      title: 'Web Strategy Discovery',
      phase: 'research',
      output: 'current external sources, official docs/API candidates, implementation assumptions',
    };
    if (insertIndex >= 0) {
      workflow.splice(insertIndex, 0, webStep);
    } else {
      workflow.push(webStep);
    }
  }

  const hasImplementationResearch = workflow.some((step) => step.id === 'implementation-research');
  if (!hasImplementationResearch) {
    const insertIndex = workflow.findIndex((step) => ['logic', 'solver', 'strategy-generation'].includes(step.phase));
    const researchStep = {
      id: 'implementation-research',
      title: 'Implementation Research',
      phase: 'retrieval',
      output: 'on-chain KG evidence, DB matches, API/docs constraints, missing tool report',
    };
    if (insertIndex >= 0) {
      workflow.splice(insertIndex, 0, researchStep);
    } else {
      workflow.push(researchStep);
    }
  }

  return {
    ...workflowPlan,
    selectedAlgorithm: {
      ...workflowPlan.selectedAlgorithm,
      reason: webCompleted
        ? `${workflowPlan.selectedAlgorithm?.reason || 'Selected workflow.'} Web research was used to concretize implementation targets.`
        : workflowPlan.selectedAlgorithm?.reason,
    },
    algorithmContract: {
      ...(workflowPlan.algorithmContract || {}),
      deterministicCore: uniqueStrings([
        'Interpret the user prompt into a concrete workflow objective.',
        'Run web search to discover current docs, APIs, protocols, and implementation constraints.',
        'Use web findings to decide what on-chain, DB, and API research must run before graph generation.',
        ...((workflowPlan.algorithmContract || {}).deterministicCore || []),
      ]),
    },
    researchTasks: mergedResearchTasks,
    toolContract: uniqueStrings([
      'web_search(query)',
      'fetch_web_page(url)',
      'research_api_docs(url)',
      ...(workflowPlan.toolContract || []),
    ]),
    adaptiveLabels,
    capabilityPlan: (workflowPlan.capabilityPlan || []).map((capability) => ({
      ...capability,
      adaptiveLabels: adaptiveLabels
        .filter((label) => {
          const text = `${capability.id} ${capability.label} ${capability.reason}`.toLowerCase();
          return text.includes(label.label.toLowerCase()) || label.source === 'prompt' || label.source === 'planner';
        })
        .slice(0, 8),
    })),
    workflow,
    strategyConcretization: {
      status: webDiscovery?.status || 'skipped',
      provider: webDiscovery?.provider || '',
      sourceCount: webDiscovery?.results?.length || 0,
      candidateSources: webDiscovery?.candidateTargets?.sourceCandidates || [],
      apiCandidates: webDiscovery?.candidateTargets?.apiCandidates || [],
      onchainCandidates: webDiscovery?.candidateTargets?.onchainCandidates || [],
      implementationResearchTasks: implementationTasks,
      warnings: webDiscovery?.warnings || [],
    },
  };
}

async function fetchPageSummary(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,text/plain',
      'User-Agent': 'Mozilla/5.0 HershyAgenticWorkflow/1.0',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(Number(options.pageFetchTimeoutMs || process.env.AGENT_WEB_PAGE_FETCH_TIMEOUT_MS || DEFAULT_FETCH_TIMEOUT_MS)),
  });
  const contentType = normalizeText(response.headers.get('content-type'));
  const text = await response.text();
  const title = stripTags((text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const description = stripTags(
    (text.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) || [])[1] ||
    (text.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) || [])[1] ||
    '',
  );
  return {
    url,
    status: response.status,
    ok: response.ok,
    contentType,
    title,
    description,
    textPreview: truncateText(stripTags(text), 1200),
    fetchedAt: new Date().toISOString(),
  };
}

export async function runAPISourceResearch(webDiscovery, options = {}) {
  if (isFalseValue(options.fetchWebPages ?? process.env.AGENT_WEB_FETCH_PAGES)) {
    return { status: 'skipped', reason: 'web page fetch disabled', pages: [], warnings: [] };
  }
  const apiCandidates = webDiscovery?.candidateTargets?.apiCandidates || [];
  const limit = Math.max(0, Math.min(Number(options.apiFetchLimit || process.env.AGENT_WEB_PAGE_FETCH_LIMIT || DEFAULT_PAGE_FETCH_LIMIT), 10));
  const pages = [];
  const warnings = [];
  for (const candidate of apiCandidates.slice(0, limit)) {
    try {
      pages.push({
        candidate,
        ...(await fetchPageSummary(candidate.url, options)),
      });
    } catch (error) {
      warnings.push({ url: candidate.url, message: error?.message || String(error) });
    }
  }
  return {
    status: pages.length > 0 ? 'completed' : apiCandidates.length > 0 ? 'failed_or_empty' : 'skipped',
    pages,
    warnings,
  };
}
