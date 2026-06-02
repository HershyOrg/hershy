import crypto from 'node:crypto';
import { createKGPool } from './protocolKnowledgeGraphLoop.mjs';

const PERSISTENCE_VERSION = 'agentic-workflow-persistence-v1';

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLabel(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 240);
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function jsonParam(value, fallback = {}) {
  return JSON.stringify(value === undefined ? fallback : value);
}

function arrayParam(values) {
  return values || [];
}

function persistenceDisabled(options = {}) {
  const raw = options.persistWorkflowRun ?? process.env.AGENT_WORKFLOW_PERSIST_RUNS;
  return raw === false || String(raw || '').toLowerCase() === 'false' || String(raw || '') === '0';
}

function hasDatabaseURL(options = {}) {
  return Boolean(normalizeText(options.databaseUrl || process.env.KG_DATABASE_URL || process.env.DATABASE_URL));
}

function classifyCapabilityType(name) {
  const value = normalizeText(name).toLowerCase();
  if (value.includes('discovery') || value.includes('retrieval')) {
    return 'retrieval';
  }
  if (value.includes('read')) {
    return 'read';
  }
  if (value.includes('simulation')) {
    return 'simulation';
  }
  if (value.includes('ranking') || value.includes('filtering')) {
    return 'ranking';
  }
  if (value.includes('approval')) {
    return 'approval';
  }
  if (value.includes('validation')) {
    return 'validation';
  }
  if (value.includes('planning')) {
    return 'planning';
  }
  return 'workflow';
}

function safetyLevelForCapability(name) {
  const value = normalizeText(name).toLowerCase();
  if (value.includes('approval')) {
    return 'approval_required';
  }
  if (value.includes('simulation')) {
    return 'simulation_only';
  }
  if (value.includes('order') || value.includes('action') || value.includes('execution')) {
    return 'approval_required';
  }
  return 'read_only';
}

function statusFromValidation(validation) {
  if (validation?.ok === true) {
    return 'approval_pending';
  }
  if (validation?.skipped) {
    return 'planned';
  }
  return 'blocked';
}

async function insertWorkflowRun(client, result) {
  const metadata = {
    persistenceVersion: PERSISTENCE_VERSION,
    webDiscoveryStatus: result.webDiscovery?.status || 'unknown',
    apiResearchStatus: result.apiResearch?.status || 'unknown',
    kgResearchStatus: result.research?.status || 'unknown',
    selectedAlgorithm: result.workflowPlan?.selectedAlgorithm?.id || '',
    executionDomain: result.workflowPlan?.executionDomain?.id || '',
  };
  const { rows } = await client.query(
    `INSERT INTO workflow_runs (
       prompt, status, intent_sketch, current_phase,
       planner_version, labeler_version, validator_version,
       reproducibility_seed, trace_id, metadata
     )
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10::jsonb)
     RETURNING id`,
    [
      result.prompt,
      statusFromValidation(result.validation),
      jsonParam(result.workflowPlan?.intent, {}),
      'approval_gate',
      'strategyWorkflowAlgorithms-v1',
      'adaptiveLabels-v1',
      'strategy-runner-validator',
      sha256Hex(JSON.stringify({
        prompt: result.prompt,
        workflow: result.workflowPlan?.workflow || [],
        labels: result.workflowPlan?.adaptiveLabels || [],
      })).slice(0, 32),
      result.prompt ? `workflow-${sha256Hex(result.prompt).slice(0, 16)}` : null,
      jsonParam(metadata),
    ],
  );
  return rows[0].id;
}

async function insertEvidence(client, runID, result) {
  const inserted = [];
  const insertOne = async (evidence) => {
    const contentHash = evidence.contentHash || sha256Hex([
      evidence.evidenceType,
      evidence.sourceURI,
      evidence.internalURI,
      evidence.title,
      evidence.summary,
      evidence.rawContent,
      JSON.stringify(evidence.metadata || {}),
    ].join('\n'));
    const { rows } = await client.query(
      `INSERT INTO workflow_evidence (
         run_id, evidence_type, source_uri, internal_uri, previous_internal_uri,
         title, content_hash, raw_content, normalized_content, summary,
         source_trust_score, freshness_score, relevance_score,
         source_updated_at, valid_from, valid_to, metadata
       )
       VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10,
         $11, $12, $13,
         $14, $15, $16, $17::jsonb
       )
       RETURNING id`,
      [
        runID,
        evidence.evidenceType,
        evidence.sourceURI || null,
        evidence.internalURI || null,
        evidence.previousInternalURI || null,
        evidence.title || null,
        contentHash,
        evidence.rawContent || null,
        evidence.normalizedContent || null,
        evidence.summary || null,
        evidence.sourceTrustScore ?? 0.5,
        evidence.freshnessScore ?? 0.5,
        evidence.relevanceScore ?? 0.5,
        evidence.sourceUpdatedAt || null,
        evidence.validFrom || null,
        evidence.validTo || null,
        jsonParam(evidence.metadata || {}),
      ],
    );
    inserted.push({ ...evidence, id: rows[0].id });
    return rows[0].id;
  };

  for (const source of result.evidenceBundle?.webSources || []) {
    await insertOne({
      evidenceType: 'web_search_result',
      sourceURI: source.url,
      title: source.title,
      summary: source.snippet,
      rawContent: source.snippet,
      metadata: source,
      sourceTrustScore: source.category === 'api_or_docs' || source.category === 'github' ? 0.75 : 0.5,
      relevanceScore: 0.65,
    });
  }
  for (const source of result.evidenceBundle?.apiSources || []) {
    await insertOne({
      evidenceType: 'api_docs_page',
      sourceURI: source.url,
      title: source.title,
      summary: source.description || source.textPreview,
      rawContent: source.textPreview,
      metadata: source,
      sourceTrustScore: 0.75,
      relevanceScore: 0.7,
    });
  }
  for (const chunk of result.evidenceBundle?.chunks || []) {
    await insertOne({
      evidenceType: 'kg_chunk',
      internalURI: chunk.internalUri,
      previousInternalURI: chunk.previousInternalUri,
      title: chunk.canonicalName || chunk.chunkType,
      summary: chunk.text,
      rawContent: chunk.text,
      metadata: chunk,
      sourceTrustScore: 0.85,
      freshnessScore: chunk.previousInternalUri ? 0.7 : 0.9,
      relevanceScore: Math.max(0.5, Math.min(Number(chunk.score || 0) / 5, 1)),
    });
  }
  for (const entity of result.evidenceBundle?.entities || []) {
    await insertOne({
      evidenceType: 'kg_entity',
      title: entity.canonicalName || entity.type,
      summary: entity.address ? `${entity.type} ${entity.canonicalName || ''} ${entity.address}` : `${entity.type} ${entity.canonicalName || ''}`,
      metadata: entity,
      sourceTrustScore: 0.85,
      relevanceScore: 0.7,
    });
  }
  for (const edge of result.evidenceBundle?.edges || []) {
    await insertOne({
      evidenceType: 'kg_edge',
      title: edge.relationType,
      summary: `${edge.srcName || edge.srcType} ${edge.relationType} ${edge.dstName || edge.dstType}`,
      metadata: edge,
      sourceTrustScore: 0.85,
      relevanceScore: 0.65,
    });
  }
  for (const analysis of result.evidenceBundle?.contractAnalyses || []) {
    await insertOne({
      evidenceType: 'agent_reasoning_contract_analysis',
      internalURI: `workflow://${runID}/contract-analysis/${analysis.id || analysis.address || analysis.contractName || 'analysis'}`,
      title: analysis.contractName || analysis.address || 'Contract AI analysis',
      summary: [
        analysis.reasoningSummary,
        analysis.strategyRelevance,
        analysis.riskFindings?.length ? `Risks: ${analysis.riskFindings.join('; ')}` : '',
        analysis.unknowns?.length ? `Unknowns: ${analysis.unknowns.join('; ')}` : '',
      ].filter(Boolean).join('\n'),
      rawContent: jsonParam(analysis),
      normalizedContent: jsonParam(analysis),
      metadata: {
        ...analysis,
        reasoningScope: 'workflow_run',
        canonicalKGWrite: false,
        contractReasoning: result.evidenceBundle?.contractReasoning || {},
      },
      sourceTrustScore: 0.6,
      freshnessScore: 0.75,
      relevanceScore: 0.8,
    });
  }
  return inserted;
}

async function insertAdaptiveLabels(client, runID, workflowPlan) {
  const labelIDs = new Map();
  for (const label of workflowPlan?.adaptiveLabels || []) {
    const normalized = normalizeLabel(label.label);
    if (!normalized) {
      continue;
    }
    const { rows } = await client.query(
      `INSERT INTO adaptive_labels (
         run_id, label, normalized_label, label_type, scope, source,
         confidence, importance, evidence_ids, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid[], $10::jsonb)
       ON CONFLICT (run_id, normalized_label, source)
       DO UPDATE SET
         confidence = GREATEST(adaptive_labels.confidence, excluded.confidence),
         importance = GREATEST(adaptive_labels.importance, excluded.importance),
         metadata = adaptive_labels.metadata || excluded.metadata,
         updated_at = now()
       RETURNING id`,
      [
        runID,
        label.label,
        normalized,
        label.type || label.labelType || label.source || 'run_label',
        label.scope || 'run',
        label.source || 'unknown',
        Number(label.confidence || 0.5),
        Number(label.importance || label.confidence || 0.5),
        [],
        jsonParam(label),
      ],
    );
    labelIDs.set(`${normalized}:${label.source || 'unknown'}`, rows[0].id);
    labelIDs.set(normalized, rows[0].id);
  }
  return labelIDs;
}

async function upsertCapabilities(client, workflowPlan) {
  const capabilityIDs = new Map();
  for (const capability of workflowPlan?.capabilityPlan || []) {
    const name = normalizeText(capability.id || capability.name);
    if (!name) {
      continue;
    }
    const { rows } = await client.query(
      `INSERT INTO capabilities (
         name, description, capability_type,
         input_schema, output_schema, safety_level,
         version, metadata
       )
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8::jsonb)
       ON CONFLICT (name)
       DO UPDATE SET
         description = COALESCE(excluded.description, capabilities.description),
         metadata = capabilities.metadata || excluded.metadata,
         updated_at = now()
       RETURNING id`,
      [
        name,
        capability.reason || capability.description || capability.label || '',
        capability.capabilityType || classifyCapabilityType(name),
        jsonParam(capability.inputSchema || {}),
        jsonParam(capability.outputSchema || {}),
        capability.safetyLevel || safetyLevelForCapability(name),
        capability.version || '1',
        jsonParam(capability),
      ],
    );
    capabilityIDs.set(name, rows[0].id);
  }
  return capabilityIDs;
}

async function insertCapabilityLabelLinks(client, runID, workflowPlan, capabilityIDs, labelIDs) {
  for (const capability of workflowPlan?.capabilityPlan || []) {
    const capabilityID = capabilityIDs.get(normalizeText(capability.id || capability.name));
    if (!capabilityID) {
      continue;
    }
    for (const label of capability.adaptiveLabels || []) {
      const labelID = labelIDs.get(`${normalizeLabel(label.label)}:${label.source || 'unknown'}`) || labelIDs.get(normalizeLabel(label.label));
      if (!labelID) {
        continue;
      }
      await client.query(
        `INSERT INTO capability_label_links (
           run_id, capability_id, label_id, relation, score, confidence, evidence_ids, metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7::uuid[], $8::jsonb)
         ON CONFLICT (run_id, capability_id, label_id, relation)
         DO UPDATE SET
           score = GREATEST(capability_label_links.score, excluded.score),
           confidence = GREATEST(capability_label_links.confidence, excluded.confidence),
           metadata = capability_label_links.metadata || excluded.metadata`,
        [
          runID,
          capabilityID,
          labelID,
          'suggests',
          Number(label.confidence || 0.5),
          Number(label.confidence || 0.5),
          [],
          jsonParam({ capability: capability.id, label }),
        ],
      );
    }
  }
}

async function insertResearchTasks(client, runID, result) {
  const tasks = [];
  for (const search of result.webDiscovery?.searches || []) {
    tasks.push({
      taskType: 'web_search',
      query: search.query,
      status: search.results?.length ? 'completed' : 'failed_or_empty',
      priority: 80,
      input: { provider: search.provider, query: search.query },
      output: search,
    });
  }
  const kgSearchByQuery = new Map((result.research?.searches || []).map((search) => [normalizeText(search.query), search]));
  for (const task of result.workflowPlan?.researchTasks || []) {
    const output = kgSearchByQuery.get(normalizeText(task.query)) || {};
    tasks.push({
      taskType: task.kind || 'kg_search',
      query: task.query,
      status: output.query ? 'completed' : result.research?.status === 'skipped' ? 'skipped' : 'failed_or_empty',
      priority: task.priority === 'high' ? 90 : task.priority === 'medium' ? 60 : 40,
      input: task,
      output,
    });
  }
  for (const task of result.webDiscovery?.implementationResearchTasks?.apiTasks || []) {
    const output = (result.apiResearch?.pages || []).find((page) => page.url === task.url) || {};
    tasks.push({
      taskType: task.kind || 'api_or_docs_research',
      query: task.url,
      status: output.url ? 'completed' : result.apiResearch?.status === 'skipped' ? 'skipped' : 'failed_or_empty',
      priority: 70,
      input: task,
      output,
    });
  }

  for (const task of tasks) {
    await client.query(
      `INSERT INTO workflow_research_tasks (
         run_id, task_type, query, status, priority, input, output, evidence_ids, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::uuid[], $9::jsonb)`,
      [
        runID,
        task.taskType,
        task.query || null,
        task.status,
        task.priority,
        jsonParam(task.input || {}),
        jsonParam(task.output || {}),
        [],
        jsonParam(task.metadata || {}),
      ],
    );
  }
}

async function insertToolCandidates(client, runID, workflowPlan, capabilityIDs) {
  const toolCandidates = [];
  const capabilityEntries = Array.from(capabilityIDs.entries());
  const defaultCapabilityID = capabilityEntries[0]?.[1] || null;
  for (const tool of workflowPlan?.toolContract || []) {
    const toolName = normalizeText(tool);
    if (!toolName) {
      continue;
    }
    const matchedCapability = capabilityEntries.find(([name]) => {
      const lower = toolName.toLowerCase();
      return lower.includes(name.split('_')[0]) || name.split('_').some((part) => part.length > 4 && lower.includes(part));
    });
    const capabilityID = matchedCapability?.[1] || defaultCapabilityID;
    const { rows } = await client.query(
      `INSERT INTO tool_candidates (
         run_id, capability_id, tool_name, adapter_name, adapter_version,
         candidate_reason, supporting_evidence_ids, safety_level, status, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::uuid[], $8, $9, $10::jsonb)
       RETURNING id`,
      [
        runID,
        capabilityID,
        toolName,
        toolName.split('(')[0],
        'planned',
        'Generated from workflow tool contract; adapter selection remains evidence-gated.',
        [],
        toolName.includes('place') || toolName.includes('execute') ? 'approval_required' : 'read_only',
        'candidate',
        jsonParam({ tool }),
      ],
    );
    toolCandidates.push({
      id: rows[0].id,
      capabilityID,
      toolName,
      safetyLevel: toolName.includes('place') || toolName.includes('execute') ? 'approval_required' : 'read_only',
    });
  }
  return toolCandidates;
}

async function insertAdapterSelections(client, runID, toolCandidates) {
  const selections = [];
  const byCapability = new Map();
  for (const candidate of toolCandidates || []) {
    if (!candidate.capabilityID) {
      continue;
    }
    const list = byCapability.get(candidate.capabilityID) || [];
    list.push(candidate);
    byCapability.set(candidate.capabilityID, list);
  }

  for (const [capabilityID, candidates] of byCapability.entries()) {
    const selected = candidates.find((candidate) => candidate.safetyLevel === 'read_only') || candidates[0];
    if (!selected) {
      continue;
    }
    const fallbackIDs = candidates
      .filter((candidate) => candidate.id !== selected.id)
      .map((candidate) => candidate.id);
    const { rows } = await client.query(
      `INSERT INTO adapter_selections (
         run_id, capability_id, selected_tool_candidate_id,
         selection_reason, confidence, evidence_ids,
         fallback_tool_candidate_ids, safety_status, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6::uuid[], $7::uuid[], $8, $9::jsonb)
       RETURNING id`,
      [
        runID,
        capabilityID,
        selected.id,
        'Provisional MVP adapter selection from generated tool candidates; execution still requires validation, evidence, and approval gates.',
        0.5,
        [],
        fallbackIDs,
        selected.safetyLevel,
        jsonParam({
          selectedToolName: selected.toolName,
          fallbackCount: fallbackIDs.length,
          selectionMode: 'provisional_mvp',
        }),
      ],
    );
    selections.push(rows[0].id);
  }
  return selections;
}

async function insertWorkflowPlanAndGraph(client, runID, result, capabilityIDs, labelIDs, evidenceRows, adapterSelectionIDs) {
  const capabilityUUIDs = Array.from(capabilityIDs.values());
  const labelUUIDs = Array.from(labelIDs.values());
  const evidenceUUIDs = evidenceRows.map((item) => item.id);
  const adapterUUIDs = adapterSelectionIDs || [];
  const { rows: planRows } = await client.query(
    `INSERT INTO workflow_plans (
       run_id, plan_status, plan_json, assumptions, open_questions, risk_notes,
       label_ids, capability_ids, evidence_ids, metadata
     )
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::uuid[], $8::uuid[], $9::uuid[], $10::jsonb)
     RETURNING id`,
    [
      runID,
      result.validation?.ok ? 'validated' : 'draft',
      jsonParam(result.workflowPlan || {}),
      jsonParam(result.strategyPackage?.logicIR?.assumptions || []),
      jsonParam(result.strategyPackage?.logicIR?.unresolved || []),
      jsonParam(result.evidenceBundle?.warnings || []),
      arrayParam(labelUUIDs),
      arrayParam(capabilityUUIDs),
      arrayParam(evidenceUUIDs),
      jsonParam({
        initialWorkflowPlan: result.initialWorkflowPlan || {},
        strategyConcretization: result.workflowPlan?.strategyConcretization || {},
      }),
    ],
  );
  const workflowPlanID = planRows[0].id;
  const graph = result.strategy || {};
  const blocks = Array.isArray(graph.blocks) ? graph.blocks : [];
  const connections = Array.isArray(graph.connections) ? graph.connections : [];
  const { rows: graphRows } = await client.query(
    `INSERT INTO workflow_graphs (
       run_id, workflow_plan_id, graph_status, graph_json,
       node_count, edge_count,
       used_capability_ids, used_adapter_selection_ids, used_evidence_ids, used_label_ids,
       validation_result, metadata
     )
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::uuid[], $8::uuid[], $9::uuid[], $10::uuid[], $11::jsonb, $12::jsonb)
     RETURNING id`,
    [
      runID,
      workflowPlanID,
      statusFromValidation(result.validation),
      jsonParam(graph),
      blocks.length,
      connections.length,
      arrayParam(capabilityUUIDs),
      arrayParam(adapterUUIDs),
      arrayParam(evidenceUUIDs),
      arrayParam(labelUUIDs),
      jsonParam(result.validation || {}),
      jsonParam({ summary: graph.summary || {} }),
    ],
  );
  return { workflowPlanID, workflowGraphID: graphRows[0].id };
}

export async function persistAgenticWorkflowRun(result, options = {}) {
  if (persistenceDisabled(options)) {
    return { status: 'skipped', reason: 'persistence disabled' };
  }
  if (!hasDatabaseURL(options)) {
    return { status: 'skipped', reason: 'KG_DATABASE_URL or DATABASE_URL is not configured' };
  }

  const pool = options.pool || createKGPool(options);
  const ownsPool = !options.pool;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const runID = await insertWorkflowRun(client, result);
    const evidenceRows = await insertEvidence(client, runID, result);
    const labelIDs = await insertAdaptiveLabels(client, runID, result.workflowPlan);
    const capabilityIDs = await upsertCapabilities(client, result.workflowPlan);
    await insertCapabilityLabelLinks(client, runID, result.workflowPlan, capabilityIDs, labelIDs);
    await insertResearchTasks(client, runID, result);
    const toolCandidates = await insertToolCandidates(client, runID, result.workflowPlan, capabilityIDs);
    const adapterSelectionIDs = await insertAdapterSelections(client, runID, toolCandidates);
    const { workflowPlanID, workflowGraphID } = await insertWorkflowPlanAndGraph(
      client,
      runID,
      result,
      capabilityIDs,
      labelIDs,
      evidenceRows,
      adapterSelectionIDs,
    );
    await client.query('COMMIT');
    return {
      status: 'completed',
      runID,
      workflowPlanID,
      workflowGraphID,
      evidenceCount: evidenceRows.length,
      labelCount: labelIDs.size,
      capabilityCount: capabilityIDs.size,
      toolCandidateCount: toolCandidates.length,
      adapterSelectionCount: adapterSelectionIDs.length,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return {
      status: 'failed',
      message: error?.message || String(error),
    };
  } finally {
    client.release();
    if (ownsPool) {
      await pool.end();
    }
  }
}

async function withWorkflowPool(options, fn) {
  if (!hasDatabaseURL(options)) {
    throw new Error('KG_DATABASE_URL or DATABASE_URL is required');
  }
  const pool = options.pool || createKGPool(options);
  const ownsPool = !options.pool;
  try {
    return await fn(pool);
  } finally {
    if (ownsPool) {
      await pool.end();
    }
  }
}

export async function listWorkflowRuns(options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 10), 100));
  return withWorkflowPool(options, async (pool) => {
    const { rows } = await pool.query(
      `SELECT
         wr.id,
         wr.prompt,
         wr.status,
         wr.current_phase,
         wr.created_at,
         wr.updated_at,
         wr.metadata,
         COALESCE(label_counts.count, 0)::int AS label_count,
         COALESCE(evidence_counts.count, 0)::int AS evidence_count,
         COALESCE(task_counts.count, 0)::int AS research_task_count,
         COALESCE(tool_counts.count, 0)::int AS tool_candidate_count,
         COALESCE(adapter_counts.count, 0)::int AS adapter_selection_count,
         COALESCE(graph_counts.count, 0)::int AS graph_count
       FROM workflow_runs wr
       LEFT JOIN LATERAL (
         SELECT count(*) FROM adaptive_labels WHERE run_id = wr.id
       ) label_counts ON true
       LEFT JOIN LATERAL (
         SELECT count(*) FROM workflow_evidence WHERE run_id = wr.id
       ) evidence_counts ON true
       LEFT JOIN LATERAL (
         SELECT count(*) FROM workflow_research_tasks WHERE run_id = wr.id
       ) task_counts ON true
       LEFT JOIN LATERAL (
         SELECT count(*) FROM tool_candidates WHERE run_id = wr.id
       ) tool_counts ON true
       LEFT JOIN LATERAL (
         SELECT count(*) FROM adapter_selections WHERE run_id = wr.id
       ) adapter_counts ON true
       LEFT JOIN LATERAL (
         SELECT count(*) FROM workflow_graphs WHERE run_id = wr.id
       ) graph_counts ON true
       ORDER BY wr.created_at DESC
       LIMIT $1`,
      [limit],
    );
    return rows;
  });
}

export async function readWorkflowRunTrace(options = {}) {
  const runID = normalizeText(options.runID || options.runId || options.id);
  return withWorkflowPool(options, async (pool) => {
    let effectiveRunID = runID;
    if (!effectiveRunID) {
      const latest = await pool.query('SELECT id FROM workflow_runs ORDER BY created_at DESC LIMIT 1');
      effectiveRunID = latest.rows[0]?.id;
    }
    if (!effectiveRunID) {
      return null;
    }

    const [
      run,
      labels,
      evidence,
      tasks,
      capabilities,
      toolCandidates,
      adapterSelections,
      plans,
      graphs,
    ] = await Promise.all([
      pool.query('SELECT * FROM workflow_runs WHERE id = $1', [effectiveRunID]),
      pool.query(
        `SELECT id, label, normalized_label, label_type, scope, source, confidence,
                importance, status, metadata, created_at
         FROM adaptive_labels
         WHERE run_id = $1
         ORDER BY importance DESC, confidence DESC, created_at ASC`,
        [effectiveRunID],
      ),
      pool.query(
        `SELECT id, evidence_type, source_uri, internal_uri, previous_internal_uri,
                title, summary, source_trust_score, freshness_score,
                relevance_score, metadata, created_at
         FROM workflow_evidence
         WHERE run_id = $1
         ORDER BY relevance_score DESC, created_at ASC`,
        [effectiveRunID],
      ),
      pool.query(
        `SELECT id, task_type, query, status, priority, input, output, created_at, updated_at
         FROM workflow_research_tasks
         WHERE run_id = $1
         ORDER BY priority DESC, created_at ASC`,
        [effectiveRunID],
      ),
      pool.query(
        `SELECT c.id, c.name, c.description, c.capability_type, c.safety_level,
                c.metadata,
                COALESCE(json_agg(
                  json_build_object(
                    'label', al.label,
                    'source', al.source,
                    'relation', cll.relation,
                    'score', cll.score,
                    'confidence', cll.confidence
                  )
                ) FILTER (WHERE al.id IS NOT NULL), '[]') AS labels
         FROM capabilities c
         JOIN capability_label_links cll ON cll.capability_id = c.id
         LEFT JOIN adaptive_labels al ON al.id = cll.label_id
         WHERE cll.run_id = $1
         GROUP BY c.id
         ORDER BY c.name ASC`,
        [effectiveRunID],
      ),
      pool.query(
        `SELECT tc.id, tc.capability_id, c.name AS capability_name,
                tc.tool_name, tc.adapter_name, tc.adapter_version,
                tc.candidate_reason, tc.safety_level, tc.status, tc.metadata,
                tc.created_at
         FROM tool_candidates tc
         LEFT JOIN capabilities c ON c.id = tc.capability_id
         WHERE tc.run_id = $1
         ORDER BY c.name ASC NULLS LAST, tc.created_at ASC`,
        [effectiveRunID],
      ),
      pool.query(
        `SELECT ad.id, ad.capability_id, c.name AS capability_name,
                ad.selected_tool_candidate_id,
                tc.tool_name AS selected_tool_name,
                ad.selection_reason, ad.confidence,
                ad.fallback_tool_candidate_ids, ad.safety_status,
                ad.metadata, ad.selected_at
         FROM adapter_selections ad
         LEFT JOIN capabilities c ON c.id = ad.capability_id
         LEFT JOIN tool_candidates tc ON tc.id = ad.selected_tool_candidate_id
         WHERE ad.run_id = $1
         ORDER BY c.name ASC NULLS LAST, ad.selected_at ASC`,
        [effectiveRunID],
      ),
      pool.query(
        `SELECT id, plan_status, plan_json, assumptions, open_questions,
                risk_notes, metadata, created_at
         FROM workflow_plans
         WHERE run_id = $1
         ORDER BY created_at DESC`,
        [effectiveRunID],
      ),
      pool.query(
        `SELECT id, workflow_plan_id, graph_status, node_count, edge_count,
                validation_result, metadata, created_at
         FROM workflow_graphs
         WHERE run_id = $1
         ORDER BY created_at DESC`,
        [effectiveRunID],
      ),
    ]);

    const runRow = run.rows[0];
    if (!runRow) {
      return null;
    }

    return {
      run: runRow,
      evidenceTrace: evidence.rows,
      labelTrace: labels.rows,
      capabilityTrace: capabilities.rows,
      researchTrace: tasks.rows,
      toolCandidates: toolCandidates.rows,
      adapterDecisionTrace: adapterSelections.rows,
      workflowPlans: plans.rows,
      workflowGraphs: graphs.rows,
      reasoningTrace: evidence.rows.filter((item) => String(item.evidence_type || '').includes('reasoning')),
    };
  });
}
