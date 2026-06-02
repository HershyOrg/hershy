#!/usr/bin/env node
import { inferStrategyWorkflow } from '../server/strategyWorkflowAlgorithms.mjs';

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

function splitCSV(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const prompt = String(args.prompt || args.query || args._.join(' ') || '').trim();
  if (!prompt) {
    throw new Error('prompt is required');
  }
  const plan = inferStrategyWorkflow(prompt, {
    chain: args.chain,
    assets: splitCSV(args.assets),
    riskProfile: args.riskProfile || args.risk,
  });
  console.log(JSON.stringify(plan, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`strategy-workflow-planner: ${error?.message || error}`);
  process.exitCode = 1;
}
