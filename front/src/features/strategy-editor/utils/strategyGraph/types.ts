import type { Edge, Node } from "@xyflow/react";

export type StrategyGraphBlock = {
  id?: unknown;
  type?: unknown;
  config?: Record<string, unknown>;
};

export type StrategyGraphConnection = {
  id?: unknown;
  kind?: unknown;
  fromId?: unknown;
  toId?: unknown;
  sourceBlockId?: unknown;
  fromBlockId?: unknown;
  sourceOutputBlockId?: unknown;
  targetBlockId?: unknown;
  toBlockId?: unknown;
  targetInputBlockId?: unknown;
  label?: unknown;
  description?: unknown;
  sharedDataPipeline?: unknown;
  inlineTriggerId?: unknown;
  inlineTriggerCondition?: unknown;
  inlineTriggerSourceId?: unknown;
  logicMode?: unknown;
};

export type StrategyGraphPayload = {
  schemaVersion?: unknown;
  kind?: unknown;
  strategy?: {
    id?: unknown;
    name?: unknown;
  };
  generatedAt?: unknown;
  summary?: unknown;
  metadata?: Record<string, unknown>;
  blocks?: StrategyGraphBlock[];
  connections?: StrategyGraphConnection[];
};

export type StrategyWorkflowGroupSpec = {
  id: string;
  title: string;
  purpose: string;
  sequenceType?: string;
  order?: number;
  nodeIds: string[];
  canAbstract: boolean;
  mustStayVisibleNodeIds: string[];
  sharedDataPipeline?: boolean;
  checkEffect?: unknown;
};

export type AdvancedGraph = {
  nodes: Node[];
  edges: Edge[];
};

export type AdvancedGraphHarnessResult = {
  graph: AdvancedGraph;
  attempts: number;
  diagnostics: string[];
};
