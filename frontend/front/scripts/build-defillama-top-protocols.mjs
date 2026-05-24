#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_JSON_OUT = 'protocols/registries/defillama-top-100.json';
const DEFAULT_MD_OUT = 'docs/rag/defillama-top-100-protocols.md';
const PROTOCOLS_URL = 'https://api.llama.fi/protocols';

const DEFAULT_EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Chain',
  'Interface',
  'Services',
  'Gaming',
  'Luck Games',
  'Physical TCG',
  'Ponzi',
  'Telegram Bot',
  'Wallets',
  'Domains',
  'Meme',
  'Foundation',
  'DAO Service Provider',
  'Security Extension',
  'Block Builders',
]);

function parseArgs(rawArgs) {
  const parsed = { _: [] };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith('--')) {
      parsed._.push(arg);
      continue;
    }
    const eqIndex = arg.indexOf('=');
    const key = camelCase(arg.slice(2, eqIndex > -1 ? eqIndex : undefined));
    const value = eqIndex > -1 ? arg.slice(eqIndex + 1) : rawArgs[index + 1];
    if (eqIndex === -1 && (value === undefined || String(value).startsWith('--'))) {
      parsed[key] = true;
      continue;
    }
    if (eqIndex === -1) {
      index += 1;
    }
    parsed[key] = value;
  }
  return parsed;
}

function camelCase(value) {
  return String(value || '').replace(/-([a-z])/g, (_match, chr) => chr.toUpperCase());
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function slugify(value, fallback = 'registry') {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function normalizeChainFilter(value) {
  const raw = String(value || '').trim();
  const normalized = raw.toLowerCase().replace(/[_-]+/g, ' ');
  if (!normalized) {
    return '';
  }
  if (['base', 'base mainnet', 'basechain', 'base chain', '8453'].includes(normalized)) {
    return 'Base';
  }
  if (['eth', 'ethereum', 'mainnet', '1'].includes(normalized)) {
    return 'Ethereum';
  }
  if (['arb', 'arbitrum', 'arbitrum one', '42161'].includes(normalized)) {
    return 'Arbitrum';
  }
  if (['op', 'optimism', '10'].includes(normalized)) {
    return 'Optimism';
  }
  if (['bsc', 'bnb', 'binance', 'bnb chain', 'binance smart chain', '56'].includes(normalized)) {
    return 'Binance';
  }
  if (['polygon', 'matic', '137'].includes(normalized)) {
    return 'Polygon';
  }
  return raw;
}

function pickPrimaryChain(protocol) {
  const chainTvls = protocol.chainTvls && typeof protocol.chainTvls === 'object' ? protocol.chainTvls : {};
  const declaredChains = Array.isArray(protocol.chains) ? protocol.chains : [];
  const chainEntry = declaredChains
    .map((chain) => [chain, toNumber(chainTvls[chain])])
    .filter(([chain]) => chain)
    .sort((a, b) => toNumber(b[1]) - toNumber(a[1]))[0];
  if (chainEntry?.[0]) {
    return chainEntry[0];
  }
  return declaredChains.length > 0 ? declaredChains[0] : '';
}

function relatedChainTvls(protocol, chain) {
  const chainTvls = protocol.chainTvls && typeof protocol.chainTvls === 'object' ? protocol.chainTvls : {};
  if (!chain) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(chainTvls)
      .filter(([key, value]) => (key === chain || key.startsWith(`${chain}-`)) && toNumber(value) > 0)
      .sort((a, b) => toNumber(b[1]) - toNumber(a[1])),
  );
}

function formatUSD(value) {
  const number = toNumber(value);
  if (number >= 1_000_000_000) {
    return `$${(number / 1_000_000_000).toFixed(2)}B`;
  }
  if (number >= 1_000_000) {
    return `$${(number / 1_000_000).toFixed(2)}M`;
  }
  return `$${Math.round(number).toLocaleString('en-US')}`;
}

function normalizeProtocol(protocol, rank, options = {}) {
  const chainTvls = protocol.chainTvls && typeof protocol.chainTvls === 'object' ? protocol.chainTvls : {};
  const selectedChain = options.chain || '';
  const selectedChainTvl = selectedChain ? toNumber(chainTvls[selectedChain]) : 0;
  return {
    rank,
    name: protocol.name,
    slug: protocol.slug,
    category: protocol.category || '',
    tvl: toNumber(protocol.tvl),
    selectedChain,
    selectedChainTvl,
    selectedChainRelatedTvls: relatedChainTvls(protocol, selectedChain),
    primaryChain: pickPrimaryChain(protocol),
    chains: Array.isArray(protocol.chains) ? protocol.chains : [],
    chainTvls,
    url: protocol.url || '',
    twitter: protocol.twitter || '',
    symbol: protocol.symbol || '',
    defillamaId: protocol.id ?? null,
    source: {
      provider: 'defillama',
      endpoint: PROTOCOLS_URL,
    },
    addressResearchStatus: 'pending',
    ingestStatus: 'not_ready_missing_verified_deployment_addresses',
    notes: selectedChain
      ? `Selected by current DeFiLlama ${selectedChain} chain TVL ranking after excluding non-DeFi or non-contract-first categories. Verify official deployment addresses before ingest.`
      : 'Selected by current DeFiLlama TVL ranking after excluding non-DeFi or non-contract-first categories. Verify official deployment addresses before ingest.',
  };
}

function buildMarkdown(registry) {
  const chain = registry.selection.chain || '';
  const title = chain
    ? `# DeFiLlama ${chain} Top 100 Protocol Registry`
    : '# DeFiLlama Top 100 Protocol Registry';
  const tvlHeading = chain ? `${chain} TVL` : 'TVL';
  const lines = [
    title,
    '',
    `Generated: ${registry.generatedAt}`,
    `Source: ${registry.source.endpoint}`,
    ...(chain ? [`Chain filter: ${chain}`] : []),
    '',
    'This registry is for address research prioritization. Do not ingest a protocol until official deployment addresses are verified.',
    '',
    `| Rank | Protocol | Category | Primary Chain | ${tvlHeading} | Chains | Status |`,
    '| ---: | --- | --- | --- | ---: | --- | --- |',
  ];
  for (const protocol of registry.protocols) {
    lines.push([
      protocol.rank,
      protocol.name.replace(/\|/g, '\\|'),
      protocol.category.replace(/\|/g, '\\|'),
      protocol.primaryChain || '-',
      formatUSD(chain ? protocol.selectedChainTvl : protocol.tvl),
      protocol.chains.slice(0, 6).join(', ').replace(/\|/g, '\\|'),
      protocol.addressResearchStatus,
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const limit = Math.max(1, Math.min(Number(args.limit) || 100, 500));
  const chain = normalizeChainFilter(args.chain || args.chainFilter || '');
  const defaultJsonOut = chain
    ? `protocols/registries/defillama-${slugify(chain)}-top-100.json`
    : DEFAULT_JSON_OUT;
  const defaultMarkdownOut = chain
    ? `docs/rag/defillama-${slugify(chain)}-top-100-protocols.md`
    : DEFAULT_MD_OUT;
  const jsonOut = path.resolve(FRONT_ROOT, args.out || defaultJsonOut);
  const markdownOut = path.resolve(FRONT_ROOT, args.markdown || args.md || defaultMarkdownOut);
  const extraExcluded = String(args.excludeCategories || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const excludedCategories = new Set([...DEFAULT_EXCLUDED_CATEGORIES, ...extraExcluded]);

  const response = await fetch(PROTOCOLS_URL, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`DeFiLlama protocols fetch failed: ${response.status} ${await response.text()}`);
  }
  const rows = await response.json();
  const selected = rows
    .filter((protocol) => protocol && protocol.name && protocol.slug)
    .filter((protocol) => toNumber(protocol.tvl) > 0)
    .filter((protocol) => !chain || toNumber(protocol.chainTvls?.[chain]) > 0)
    .filter((protocol) => !excludedCategories.has(protocol.category || ''))
    .sort((a, b) => (
      chain
        ? toNumber(b.chainTvls?.[chain]) - toNumber(a.chainTvls?.[chain])
        : toNumber(b.tvl) - toNumber(a.tvl)
    ))
    .slice(0, limit)
    .map((protocol, index) => normalizeProtocol(protocol, index + 1, { chain }));

  const registry = {
    generatedAt: new Date().toISOString(),
    selection: {
      limit,
      ranking: chain ? `${chain.toLowerCase()}_chain_tvl_desc` : 'current_tvl_desc',
      chain,
      excludedCategories: [...excludedCategories].sort(),
      manualReviewRequired: true,
    },
    source: {
      provider: 'defillama',
      endpoint: PROTOCOLS_URL,
      totalFetched: rows.length,
    },
    protocols: selected,
  };

  await fs.mkdir(path.dirname(jsonOut), { recursive: true });
  await fs.writeFile(jsonOut, `${JSON.stringify(registry, null, 2)}\n`);
  await fs.mkdir(path.dirname(markdownOut), { recursive: true });
  await fs.writeFile(markdownOut, buildMarkdown(registry));

  console.log(JSON.stringify({
    ok: true,
    protocols: selected.length,
    chain: chain || null,
    jsonOut: path.relative(FRONT_ROOT, jsonOut),
    markdownOut: path.relative(FRONT_ROOT, markdownOut),
    source: PROTOCOLS_URL,
  }, null, 2));
}

main().catch((error) => {
  console.error(`build-defillama-top-protocols: ${error?.message || error}`);
  process.exitCode = 1;
});
