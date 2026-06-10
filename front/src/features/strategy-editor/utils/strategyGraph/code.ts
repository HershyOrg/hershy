import type { StrategyGraphPayload } from "./types";

function normalizePayloadText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizePayloadNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function strategyGraphToCode(strategyGraph: StrategyGraphPayload): string {
  const name = normalizePayloadText(strategyGraph.strategy?.name, "AI generated strategy");
  const blocks = Array.isArray(strategyGraph.blocks) ? strategyGraph.blocks : [];
  const connections = Array.isArray(strategyGraph.connections) ? strategyGraph.connections : [];
  const payload = {
    schemaVersion: normalizePayloadNumber(strategyGraph.schemaVersion, 1),
    kind: normalizePayloadText(strategyGraph.kind, "hershy-strategy-graph"),
    strategy: {
      id: normalizePayloadText(strategyGraph.strategy?.id, "ai-generated-strategy"),
      name,
    },
    generatedAt: normalizePayloadText(strategyGraph.generatedAt, new Date().toISOString()),
    summary: strategyGraph.summary && typeof strategyGraph.summary === "object"
      ? strategyGraph.summary
      : {
        blocks: blocks.length,
        connections: connections.length,
      },
    metadata: strategyGraph.metadata && typeof strategyGraph.metadata === "object" ? strategyGraph.metadata : {},
    blocks,
    connections,
  };

  return JSON.stringify(payload, null, 2);
}
