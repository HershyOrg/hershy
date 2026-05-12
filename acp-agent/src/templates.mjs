import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_BASE_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));

const TEMPLATE_REGISTRY = {
  'simple-counter': {
    description: 'Minimal watcher counter program',
    dir: 'examples/simple-counter',
    dockerfile: 'Dockerfile',
    srcFiles: ['main.go', 'go.mod', 'go.sum']
  },
  'watcher-server': {
    description: 'Watcher API sample server',
    dir: 'examples/watcher-server',
    dockerfile: 'Dockerfile',
    srcFiles: ['main.go', 'go.mod', 'go.sum']
  },
  'trading-long': {
    description: 'Trading simulation watcher program',
    dir: 'examples/trading-long',
    dockerfile: 'Dockerfile',
    srcFiles: [
      'main.go',
      'commands.go',
      'stats.go',
      'trading_sim.go',
      'binance_stream.go',
      'go.mod',
      'go.sum'
    ]
  }
};

async function readText(path) {
  return readFile(path, 'utf8');
}

function templateSpecOrThrow(templateName) {
  const spec = TEMPLATE_REGISTRY[templateName];
  if (!spec) {
    const available = Object.keys(TEMPLATE_REGISTRY).join(', ');
    throw new Error(`unknown template '${templateName}' (available: ${available})`);
  }
  return spec;
}

export function listTemplates() {
  return Object.entries(TEMPLATE_REGISTRY).map(([name, spec]) => ({
    name,
    description: spec.description,
    source_dir: spec.dir,
    src_files: [...spec.srcFiles]
  }));
}

export async function loadTemplate(templateName, options = {}) {
  const spec = templateSpecOrThrow(templateName);
  const baseDir = resolve(options.baseDir || DEFAULT_BASE_DIR);
  const templateDir = resolve(baseDir, spec.dir);

  const srcFiles = {};
  for (const filename of spec.srcFiles) {
    const filePath = resolve(templateDir, filename);
    srcFiles[filename] = await readText(filePath);
  }

  const dockerfile = await readText(resolve(templateDir, spec.dockerfile));

  return {
    template_name: templateName,
    description: spec.description,
    source_dir: templateDir,
    dockerfile,
    src_files: srcFiles
  };
}
