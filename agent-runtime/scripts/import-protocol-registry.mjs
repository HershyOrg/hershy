#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONT_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(FRONT_ROOT, '..', '..');

loadEnvFiles([
  path.join(FRONT_ROOT, '.env.local'),
  path.join(FRONT_ROOT, '.env'),
  path.join(REPO_ROOT, '.env.local'),
  path.join(REPO_ROOT, '.env'),
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

function stripEnvQuotes(value) {
  const trimmed = String(value || '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFiles(filePaths) {
  for (const filePath of filePaths) {
    if (!fsSync.existsSync(filePath)) {
      continue;
    }
    const content = fsSync.readFileSync(filePath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }
      const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
      const separatorIndex = normalized.indexOf('=');
      if (separatorIndex <= 0) {
        continue;
      }
      const key = normalized.slice(0, separatorIndex).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }
      process.env[key] = stripEnvQuotes(normalized.slice(separatorIndex + 1));
    }
  }
}

function createPool(args) {
  const connectionString = args.databaseUrl || process.env.KG_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('KG_DATABASE_URL or DATABASE_URL is required');
  }
  return new Pool({ connectionString });
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function tokenEstimate(text) {
  return Math.max(1, Math.ceil(String(text || '').split(/\s+/).filter(Boolean).length * 1.25));
}

function makeRevisionInternalURI(internalURI, revisionNumber, contentHash) {
  return `${internalURI}?rev=${revisionNumber}-${String(contentHash || '').slice(0, 12)}`;
}

function slugify(value, fallback = 'registry') {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function getRegistryKey(registry) {
  const provider = slugify(registry.source?.provider || 'defillama');
  const chain = registry.selection?.chain;
  return chain ? `${provider}-${slugify(chain)}` : provider;
}

function formatUSD(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 'unknown';
  }
  return `$${Math.round(number).toLocaleString('en-US')}`;
}

function buildProtocolMetadata(protocol, registry) {
  const registryKey = getRegistryKey(registry);
  return {
    rank: protocol.rank,
    registryRank: protocol.rank,
    registryKey,
    registry: {
      provider: registry.source?.provider || 'defillama',
      endpoint: registry.source?.endpoint || '',
      generatedAt: registry.generatedAt,
      rank: protocol.rank,
      ranking: registry.selection?.ranking || 'current_tvl_desc',
      chain: registry.selection?.chain || '',
    },
    tvl: protocol.tvl,
    selectedChain: protocol.selectedChain || registry.selection?.chain || '',
    selectedChainTvl: protocol.selectedChainTvl || 0,
    selectedChainRelatedTvls: protocol.selectedChainRelatedTvls || {},
    primaryChain: protocol.primaryChain,
    chains: protocol.chains,
    chainTvls: protocol.chainTvls,
    addressResearchStatus: protocol.addressResearchStatus,
    ingestStatus: protocol.ingestStatus,
    symbol: protocol.symbol,
    twitter: protocol.twitter,
    defillamaId: protocol.defillamaId,
  };
}

function buildProtocolSummary(protocol, registry) {
  const chainTvls = protocol.chainTvls && typeof protocol.chainTvls === 'object' ? protocol.chainTvls : {};
  const selectedChain = protocol.selectedChain || registry.selection?.chain || '';
  const selectedRelatedTvls = protocol.selectedChainRelatedTvls && typeof protocol.selectedChainRelatedTvls === 'object'
    ? protocol.selectedChainRelatedTvls
    : {};
  const topChainTvls = Object.entries(chainTvls)
    .filter(([chain, tvl]) => chain && Number.isFinite(Number(tvl)))
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 8)
    .map(([chain, tvl]) => `${chain}: ${formatUSD(tvl)}`)
    .join(', ');
  const selectedBreakdown = Object.entries(selectedRelatedTvls)
    .map(([chain, tvl]) => `${chain}: ${formatUSD(tvl)}`)
    .join(', ');

  return [
    `Protocol: ${protocol.name}`,
    `DeFiLlama slug: ${protocol.slug}`,
    `Registry rank: ${protocol.rank}`,
    ...(selectedChain ? [
      `Selected chain: ${selectedChain}`,
      `Selected chain TVL: ${formatUSD(protocol.selectedChainTvl)}`,
      `Selected chain breakdown: ${selectedBreakdown || 'unknown'}`,
    ] : []),
    `Category: ${protocol.category || 'unknown'}`,
    `Current TVL: ${formatUSD(protocol.tvl)}`,
    `Primary chain by TVL: ${protocol.primaryChain || 'unknown'}`,
    `Known chains: ${(protocol.chains || []).join(', ') || 'unknown'}`,
    `Top chain TVL breakdown: ${topChainTvls || 'unknown'}`,
    `Website: ${protocol.url || 'unknown'}`,
    `Symbol: ${protocol.symbol || 'unknown'}`,
    `Twitter: ${protocol.twitter || 'unknown'}`,
    `Registry source: ${registry.source?.provider || 'defillama'} ${registry.source?.endpoint || ''}`,
    `Address research status: ${protocol.addressResearchStatus || 'pending'}`,
    `Ingest status: ${protocol.ingestStatus || 'not_ready'}`,
    'Verified deployment addresses are not confirmed by this registry. Research official docs, repositories, governance posts, and explorers before contract ingestion.',
  ].join('\n');
}

async function upsertRegistryArtifact(client, input) {
  const contentHash = sha256Hex(input.rawText);
  const result = await client.query(
    `INSERT INTO artifacts (entity_id, type, uri, content_hash, raw_text, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (type, uri, content_hash) DO UPDATE SET
       entity_id = COALESCE(excluded.entity_id, artifacts.entity_id),
       metadata = artifacts.metadata || excluded.metadata,
       fetched_at = now()
     RETURNING id`,
    [
      input.entityID,
      input.type,
      input.uri,
      contentHash,
      input.rawText,
      input.metadata || {},
    ],
  );
  return { id: result.rows[0].id, contentHash };
}

async function upsertRegistryKnowledgePage(client, input) {
  const body = String(input.body || '').trim();
  const internalURI = String(input.internalURI || '').trim();
  if (!body || !internalURI) {
    throw new Error('registry knowledge page needs body and internalURI');
  }
  const modifiedAt = new Date().toISOString();
  const contentHash = sha256Hex(body);
  const existing = await client.query(
    `SELECT pages.*,
            revisions.internal_uri AS current_revision_internal_uri,
            revisions.revision_number AS current_revision_number
     FROM knowledge_pages pages
     LEFT JOIN knowledge_page_revisions revisions ON revisions.id = pages.current_revision_id
     WHERE pages.internal_uri = $1
     LIMIT 1`,
    [internalURI],
  );

  if (!existing.rows[0]) {
    const page = await client.query(
      `INSERT INTO knowledge_pages (
         entity_id, page_kind, internal_uri, title, content_hash,
         previous_internal_uri, modified_at, metadata
       )
       VALUES ($1, $2, $3, $4, $5, NULL, $6, $7::jsonb)
       RETURNING id`,
      [
        input.entityID,
        input.pageKind,
        internalURI,
        input.title,
        contentHash,
        modifiedAt,
        input.metadata || {},
      ],
    );
    const revisionURI = makeRevisionInternalURI(internalURI, 1, contentHash);
    const revision = await client.query(
      `INSERT INTO knowledge_page_revisions (
         page_id, revision_number, internal_uri, previous_internal_uri,
         title, body, content_hash, artifact_id, modified_at, metadata
       )
       VALUES ($1, 1, $2, NULL, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING id`,
      [
        page.rows[0].id,
        revisionURI,
        input.title,
        body,
        contentHash,
        input.artifactID || null,
        modifiedAt,
        input.metadata || {},
      ],
    );
    await client.query(
      `UPDATE knowledge_pages
       SET current_revision_id = $2,
           updated_at = now()
       WHERE id = $1`,
      [page.rows[0].id, revision.rows[0].id],
    );
    return {
      pageID: page.rows[0].id,
      revisionID: revision.rows[0].id,
      internalURI,
      revisionInternalURI: revisionURI,
      previousInternalURI: '',
      modifiedAt,
      changed: true,
    };
  }

  const page = existing.rows[0];
  if (page.content_hash === contentHash) {
    await client.query(
      `UPDATE knowledge_pages
       SET entity_id = COALESCE($2, entity_id),
           title = $3,
           metadata = knowledge_pages.metadata || $4::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [page.id, input.entityID, input.title, input.metadata || {}],
    );
    return {
      pageID: page.id,
      revisionID: page.current_revision_id,
      internalURI,
      revisionInternalURI: page.current_revision_internal_uri,
      previousInternalURI: page.previous_internal_uri || '',
      modifiedAt: page.modified_at,
      changed: false,
    };
  }

  const previousRevisionURI = page.current_revision_internal_uri || page.previous_internal_uri || '';
  const nextRevisionNumber = Number(page.current_revision_number || 0) + 1;
  const revisionURI = makeRevisionInternalURI(internalURI, nextRevisionNumber, contentHash);
  if (page.current_revision_id) {
    await client.query(
      `UPDATE knowledge_page_revisions
       SET is_current = false,
           valid_to = $2,
           superseded_by_internal_uri = $3
       WHERE id = $1`,
      [page.current_revision_id, modifiedAt, revisionURI],
    );
    await client.query(
      `UPDATE chunks
       SET is_current = false,
           valid_to = $2,
           updated_at = now()
       WHERE page_revision_id = $1`,
      [page.current_revision_id, modifiedAt],
    );
  }

  const revision = await client.query(
    `INSERT INTO knowledge_page_revisions (
       page_id, revision_number, internal_uri, previous_internal_uri,
       title, body, content_hash, artifact_id, modified_at, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     RETURNING id`,
    [
      page.id,
      nextRevisionNumber,
      revisionURI,
      previousRevisionURI || null,
      input.title,
      body,
      contentHash,
      input.artifactID || null,
      modifiedAt,
      input.metadata || {},
    ],
  );
  await client.query(
    `UPDATE knowledge_pages
     SET entity_id = COALESCE($2, entity_id),
         title = $3,
         current_revision_id = $4,
         content_hash = $5,
         previous_internal_uri = $6,
         modified_at = $7,
         metadata = knowledge_pages.metadata || $8::jsonb,
         updated_at = now()
     WHERE id = $1`,
    [
      page.id,
      input.entityID,
      input.title,
      revision.rows[0].id,
      contentHash,
      previousRevisionURI || null,
      modifiedAt,
      input.metadata || {},
    ],
  );
  return {
    pageID: page.id,
    revisionID: revision.rows[0].id,
    internalURI,
    revisionInternalURI: revisionURI,
    previousInternalURI: previousRevisionURI,
    modifiedAt,
    changed: true,
  };
}

async function upsertRegistryChunk(client, input) {
  const text = String(input.text || '').trim();
  const contentHash = sha256Hex(text);
  const result = await client.query(
    `INSERT INTO chunks (
       artifact_id, entity_id, page_id, page_revision_id,
       chunk_type, text, content_hash, heading_path, token_count,
       is_current, modified_at, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $11::jsonb)
     ON CONFLICT (page_revision_id, chunk_type, content_hash)
       WHERE page_revision_id IS NOT NULL AND content_hash <> ''
     DO UPDATE SET
       entity_id = COALESCE(excluded.entity_id, chunks.entity_id),
       text = excluded.text,
       heading_path = excluded.heading_path,
       token_count = excluded.token_count,
       is_current = true,
       modified_at = excluded.modified_at,
       metadata = chunks.metadata || excluded.metadata,
       updated_at = now()
     RETURNING id`,
    [
      input.artifactID,
      input.entityID,
      input.pageID,
      input.pageRevisionID,
      input.chunkType,
      text,
      contentHash,
      input.headingPath || [],
      tokenEstimate(text),
      input.modifiedAt,
      input.metadata || {},
    ],
  );
  return result.rows[0].id;
}

async function upsertProtocolRegistrySummary(client, protocol, registry, metadata, ids) {
  const body = buildProtocolSummary(protocol, registry);
  const registryKey = getRegistryKey(registry);
  const artifact = await upsertRegistryArtifact(client, {
    entityID: ids.entityID,
    type: 'protocol_registry_summary',
    uri: `defillama:protocol:${protocol.slug}:${registryKey}:candidate-summary`,
    rawText: body,
    metadata,
  });
  const page = await upsertRegistryKnowledgePage(client, {
    entityID: ids.entityID,
    artifactID: artifact.id,
    pageKind: 'protocol_registry_summary',
    internalURI: `kg://protocols/${protocol.slug}/registry/${registryKey}-candidate`,
    title: `${protocol.name} ${registryKey} protocol registry candidate summary`,
    body,
    metadata,
  });
  const chunkID = await upsertRegistryChunk(client, {
    entityID: ids.entityID,
    artifactID: artifact.id,
    pageID: page.pageID,
    pageRevisionID: page.revisionID,
    chunkType: 'protocol_registry_summary',
    text: body,
    headingPath: [protocol.name, 'registry', `${registryKey} candidate`],
    modifiedAt: page.modifiedAt,
    metadata: {
      ...metadata,
      pageInternalURI: page.internalURI,
      pageRevisionInternalURI: page.revisionInternalURI,
      previousInternalURI: page.previousInternalURI,
      modifiedAt: page.modifiedAt,
      isLatestPage: true,
    },
  });
  return { chunkID, pageChanged: page.changed };
}

async function upsertCandidateProtocol(client, protocol, registry) {
  const existing = await client.query(
    `SELECT id, entity_id FROM protocols WHERE slug = $1 LIMIT 1`,
    [protocol.slug],
  );
  const metadata = buildProtocolMetadata(protocol, registry);

  if (existing.rows[0]) {
    await client.query(
      `UPDATE entities
       SET canonical_name = $2,
           aliases = (SELECT ARRAY(SELECT DISTINCT unnest(entities.aliases || $3::text[]))),
           metadata = entities.metadata || $4::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [
        existing.rows[0].entity_id,
        protocol.name,
        [protocol.slug, protocol.symbol].filter(Boolean),
        metadata,
      ],
    );
    const protocolResult = await client.query(
      `UPDATE protocols
       SET name = $2,
           website = COALESCE($3, website),
           category = COALESCE($4, category),
           status = CASE WHEN status = 'researched' THEN status ELSE 'candidate' END,
           metadata = protocols.metadata || $5::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [
        existing.rows[0].id,
        protocol.name,
        protocol.url || null,
        protocol.category || null,
        metadata,
      ],
    );
    const summary = await upsertProtocolRegistrySummary(client, protocol, registry, metadata, {
      protocolID: existing.rows[0].id,
      entityID: existing.rows[0].entity_id,
    });
    return { action: 'updated', protocolID: protocolResult.rows[0]?.id || existing.rows[0].id, ...summary };
  }

  const entity = await client.query(
    `INSERT INTO entities (type, canonical_name, aliases, metadata, confidence)
     VALUES ('protocol', $1, $2::text[], $3::jsonb, 0.75)
     RETURNING id`,
    [
      protocol.name,
      [protocol.slug, protocol.symbol].filter(Boolean),
      metadata,
    ],
  );
  const protocolResult = await client.query(
    `INSERT INTO protocols (
       entity_id, name, slug, website, category, status, metadata
     )
     VALUES ($1, $2, $3, $4, $5, 'candidate', $6::jsonb)`,
    [
      entity.rows[0].id,
      protocol.name,
      protocol.slug,
      protocol.url || null,
      protocol.category || null,
      metadata,
    ],
  );
  const summary = await upsertProtocolRegistrySummary(client, protocol, registry, metadata, {
    protocolID: protocolResult.rows[0]?.id,
    entityID: entity.rows[0].id,
  });
  return { action: 'inserted', protocolID: protocolResult.rows[0]?.id, ...summary };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const registryPath = path.resolve(FRONT_ROOT, args.registry || args.config || 'protocols/registries/defillama-top-100.json');
  const registry = JSON.parse(await fs.readFile(registryPath, 'utf8'));
  const pool = createPool(args);
  let inserted = 0;
  let updated = 0;
  let chunks = 0;
  let changedPages = 0;
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const protocol of registry.protocols || []) {
        const result = await upsertCandidateProtocol(client, protocol, registry);
        if (result.action === 'inserted') {
          inserted += 1;
        } else {
          updated += 1;
        }
        if (result.chunkID) {
          chunks += 1;
        }
        if (result.pageChanged) {
          changedPages += 1;
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
  console.log(JSON.stringify({
    ok: true,
    registry: path.relative(FRONT_ROOT, registryPath),
    protocols: registry.protocols?.length || 0,
    inserted,
    updated,
    chunks,
    changedPages,
  }, null, 2));
}

main().catch((error) => {
  console.error(`import-protocol-registry: ${error?.message || error}`);
  process.exitCode = 1;
});
