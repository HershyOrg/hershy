#!/usr/bin/env node
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listWorkflowRuns, readWorkflowRunTrace } from '../server/agenticWorkflowPersistence.mjs';

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

const args = parseArgs(process.argv.slice(2));
const command = normalizeCommand(args._[0] || args.command || 'show');

try {
  if (args.help || args.h) {
    printHelp();
  } else if (command === 'list') {
    const runs = await listWorkflowRuns({
      databaseUrl: args.databaseUrl,
      limit: args.limit,
    });
    if (args.json) {
      printJSON(runs);
    } else {
      printRunList(runs);
    }
  } else {
    const trace = await readWorkflowRunTrace({
      databaseUrl: args.databaseUrl,
      runID: args.runId || args.id,
    });
    if (!trace) {
      throw new Error('workflow run was not found');
    }
    if (args.json) {
      printJSON(selectTraceSection(command, trace));
    } else {
      printTraceSection(command, trace);
    }
  }
} catch (error) {
  console.error(`agentic-workflow-trace: ${error?.message || error}`);
  process.exitCode = 1;
}

function normalizeCommand(value) {
  const command = String(value || '').trim().toLowerCase();
  if (command === 'run-history' || command === 'runs') {
    return 'list';
  }
  if (command === 'evidence-trace') {
    return 'evidence';
  }
  if (command === 'label-trace') {
    return 'labels';
  }
  if (command === 'adapter-decision-trace' || command === 'adapter-decisions') {
    return 'adapters';
  }
  if (command === 'reasoning-trace') {
    return 'reasoning';
  }
  return command || 'show';
}

function selectTraceSection(command, trace) {
  if (command === 'evidence') {
    return trace.evidenceTrace;
  }
  if (command === 'labels') {
    return trace.labelTrace;
  }
  if (command === 'capabilities') {
    return trace.capabilityTrace;
  }
  if (command === 'research') {
    return trace.researchTrace;
  }
  if (command === 'tools') {
    return trace.toolCandidates;
  }
  if (command === 'adapters') {
    return trace.adapterDecisionTrace;
  }
  if (command === 'reasoning') {
    return trace.reasoningTrace;
  }
  if (command === 'graphs') {
    return trace.workflowGraphs;
  }
  return trace;
}

function printTraceSection(command, trace) {
  if (command === 'evidence') {
    printRunHeader(trace);
    printEvidence(trace.evidenceTrace);
    return;
  }
  if (command === 'labels') {
    printRunHeader(trace);
    printLabels(trace.labelTrace);
    return;
  }
  if (command === 'capabilities') {
    printRunHeader(trace);
    printCapabilities(trace.capabilityTrace);
    return;
  }
  if (command === 'research') {
    printRunHeader(trace);
    printResearchTasks(trace.researchTrace);
    return;
  }
  if (command === 'tools') {
    printRunHeader(trace);
    printToolCandidates(trace.toolCandidates);
    return;
  }
  if (command === 'adapters') {
    printRunHeader(trace);
    printAdapterDecisions(trace.adapterDecisionTrace);
    return;
  }
  if (command === 'reasoning') {
    printRunHeader(trace);
    printReasoning(trace.reasoningTrace);
    return;
  }
  if (command === 'graphs') {
    printRunHeader(trace);
    printGraphs(trace.workflowGraphs);
    return;
  }

  printRunHeader(trace);
  printCounts(trace);
  printLabels(trace.labelTrace.slice(0, 12));
  printEvidence(trace.evidenceTrace.slice(0, 10));
  printReasoning(trace.reasoningTrace);
  printAdapterDecisions(trace.adapterDecisionTrace);
  printGraphs(trace.workflowGraphs);
}

function printRunList(runs) {
  if (!runs.length) {
    console.log('No workflow runs found.');
    return;
  }
  console.log(`Run History (${runs.length})`);
  for (const run of runs) {
    console.log(`\n- ${run.id}`);
    console.log(`  status: ${run.status} | phase: ${run.current_phase || 'unknown'} | created: ${formatDate(run.created_at)}`);
    console.log(`  prompt: ${clip(run.prompt, 140)}`);
    console.log(`  traces: labels=${run.label_count}, evidence=${run.evidence_count}, tasks=${run.research_task_count}, tools=${run.tool_candidate_count}, adapters=${run.adapter_selection_count}, graphs=${run.graph_count}`);
  }
}

function printRunHeader(trace) {
  const run = trace.run;
  console.log(`Run: ${run.id}`);
  console.log(`Status: ${run.status} | Phase: ${run.current_phase || 'unknown'} | Created: ${formatDate(run.created_at)}`);
  console.log(`Prompt: ${clip(run.prompt, 220)}`);
}

function printCounts(trace) {
  console.log('\nCounts');
  console.log(`- Evidence: ${trace.evidenceTrace.length}`);
  console.log(`- Labels: ${trace.labelTrace.length}`);
  console.log(`- Capabilities: ${trace.capabilityTrace.length}`);
  console.log(`- Research tasks: ${trace.researchTrace.length}`);
  console.log(`- Tool candidates: ${trace.toolCandidates.length}`);
  console.log(`- Adapter decisions: ${trace.adapterDecisionTrace.length}`);
  console.log(`- Workflow graphs: ${trace.workflowGraphs.length}`);
}

function printEvidence(items) {
  console.log(`\nEvidence Trace (${items.length})`);
  if (!items.length) {
    console.log('- none');
    return;
  }
  for (const item of items) {
    const source = item.source_uri || item.internal_uri || 'internal';
    const previous = item.previous_internal_uri ? ` | previous: ${item.previous_internal_uri}` : '';
    console.log(`- ${item.evidence_type}: ${clip(item.title || source, 120)}`);
    console.log(`  score: trust=${formatScore(item.source_trust_score)}, fresh=${formatScore(item.freshness_score)}, relevant=${formatScore(item.relevance_score)}`);
    console.log(`  source: ${source}${previous}`);
    if (item.summary) {
      console.log(`  summary: ${clip(item.summary, 180)}`);
    }
  }
}

function printReasoning(items) {
  console.log(`\nReasoning Trace (${items.length})`);
  if (!items.length) {
    console.log('- none');
    return;
  }
  for (const item of items) {
    const source = item.source_uri || item.internal_uri || 'run-scoped';
    console.log(`- ${item.evidence_type}: ${clip(item.title || source, 120)}`);
    console.log(`  scope: workflow_run | canonical KG write: false`);
    console.log(`  source: ${source}`);
    if (item.summary) {
      console.log(`  summary: ${clip(item.summary, 220)}`);
    }
  }
}

function printLabels(items) {
  console.log(`\nLabel Trace (${items.length})`);
  if (!items.length) {
    console.log('- none');
    return;
  }
  for (const item of items) {
    console.log(`- ${item.label} [${item.label_type}]`);
    console.log(`  source: ${item.source} | scope: ${item.scope} | confidence=${formatScore(item.confidence)} | importance=${formatScore(item.importance)} | status=${item.status}`);
  }
}

function printCapabilities(items) {
  console.log(`\nCapability Trace (${items.length})`);
  if (!items.length) {
    console.log('- none');
    return;
  }
  for (const item of items) {
    const labelText = (item.labels || []).map((label) => label.label).filter(Boolean).slice(0, 8).join(', ');
    console.log(`- ${item.name} [${item.capability_type}, ${item.safety_level}]`);
    if (item.description) {
      console.log(`  reason: ${clip(item.description, 180)}`);
    }
    if (labelText) {
      console.log(`  labels: ${labelText}`);
    }
  }
}

function printResearchTasks(items) {
  console.log(`\nResearch Trace (${items.length})`);
  if (!items.length) {
    console.log('- none');
    return;
  }
  for (const item of items) {
    console.log(`- ${item.task_type}: ${clip(item.query || '(no query)', 160)}`);
    console.log(`  status: ${item.status} | priority: ${item.priority} | created: ${formatDate(item.created_at)}`);
  }
}

function printToolCandidates(items) {
  console.log(`\nTool Candidate Trace (${items.length})`);
  if (!items.length) {
    console.log('- none');
    return;
  }
  for (const item of items) {
    console.log(`- ${item.tool_name}`);
    console.log(`  capability: ${item.capability_name || 'unknown'} | adapter: ${item.adapter_name || 'unknown'} | safety: ${item.safety_level} | status: ${item.status}`);
    if (item.candidate_reason) {
      console.log(`  reason: ${clip(item.candidate_reason, 180)}`);
    }
  }
}

function printAdapterDecisions(items) {
  console.log(`\nAdapter Decision Trace (${items.length})`);
  if (!items.length) {
    console.log('- none');
    return;
  }
  for (const item of items) {
    const fallbackCount = Array.isArray(item.fallback_tool_candidate_ids) ? item.fallback_tool_candidate_ids.length : 0;
    console.log(`- ${item.capability_name || 'unknown capability'}`);
    console.log(`  selected: ${item.selected_tool_name || 'unknown'} | safety: ${item.safety_status} | confidence=${formatScore(item.confidence)} | fallbacks=${fallbackCount}`);
    console.log(`  reason: ${clip(item.selection_reason, 220)}`);
  }
}

function printGraphs(items) {
  console.log(`\nWorkflow Graph Trace (${items.length})`);
  if (!items.length) {
    console.log('- none');
    return;
  }
  for (const item of items) {
    const validation = item.validation_result || {};
    console.log(`- ${item.id}`);
    console.log(`  status: ${item.graph_status} | nodes=${item.node_count || 0} | edges=${item.edge_count || 0} | validation=${validation.ok === true ? 'ok' : validation.skipped ? 'skipped' : 'failed'}`);
  }
}

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
    parsed[key] = normalizeArgValue(value);
  }
  return parsed;
}

function normalizeArgValue(value) {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return value;
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

function clip(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 'n/a';
  }
  return number.toFixed(2);
}

function formatDate(value) {
  if (!value) {
    return 'unknown';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toISOString();
}

function printJSON(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printHelp() {
  console.log(`
Usage:
  npm run strategy:trace -- list
  npm run strategy:trace -- show --run-id <uuid>
  npm run strategy:trace -- evidence --run-id <uuid>
  npm run strategy:trace -- reasoning --run-id <uuid>
  npm run strategy:trace -- labels --run-id <uuid>
  npm run strategy:trace -- adapters --run-id <uuid>

Commands:
  list           Run History: recent agent loop executions.
  show           Combined trace for the latest run or --run-id.
  evidence       Evidence Trace: web/KG/API evidence used by the run.
  reasoning      Reasoning Trace: run-scoped AI judgments, not canonical KG writes.
  labels         Label Trace: adaptive labels created during the run.
  capabilities   Capability Trace: stable capabilities suggested by labels.
  research       Research Trace: web/KG/API research tasks.
  tools          Tool Candidate Trace: candidate tools/adapters.
  adapters       Adapter Decision Trace: selected adapter per capability.
  graphs         Workflow Graph Trace: saved graph status and validation.

Options:
  --run-id <uuid>       Workflow run ID. Defaults to latest run for trace commands.
  --limit 20            Run list limit.
  --json                Print JSON.
  --database-url <url>  Override KG_DATABASE_URL / DATABASE_URL.
`.trim());
}
