import type { Node, Edge } from "@xyflow/react";

export type TriggerType = "TIME" | "CLICK" | "IF";
export type ViewMode = "node" | "code";
export type ActionType = "CEX" | "DEX";
export type OrderSide = "BUY" | "SELL";

export type BlockData = Record<string, unknown> & {
  id: string;
  name: string;
  description?: string;
  type: "input" | "output";
  connectedFrom?: string; // source node.block info
  visualizationFormat?: "chart" | "ladder" | "log" | string;
  visualFormat?: string;
  visualType?: string;
  chartType?: string;
  ladderSide?: "upper" | "lower" | string;
  ladderRows?: unknown[];
  ladderValues?: unknown[];
}

export type IndicatorCondition = Record<string, unknown> & {
  metric?: string;
  operator: ">" | ">=" | "<" | "<=";
  threshold: number;
  label?: string;
}

export type ChartComparisonValue = Record<string, unknown> & {
  id: string;
  label?: string;
  value: number;
  color?: string;
  enabled?: boolean;
}

export type NodeChartPoint = {
  time: number;
  value: number;
  volume?: number;
}

export type RuntimeArtifactData = {
  runtimeCode?: string;
  runtimeCodeLabel?: string;
  chartSeries?: NodeChartPoint[];
  chartSource?: string;
  chartUpdatedAt?: string;
  chartSymbol?: string;
  chartWarning?: string;
}

// Indicator Logic Node - function logic is represented as charted data blocks.
export type FunctionNodeData = Record<string, unknown> & RuntimeArtifactData & {
  label: string;
  description?: string;
  functionName: string;
  code: string;
  inputBlocks: BlockData[];
  outputBlocks: BlockData[];
  inputDescription?: string;
  logicDescription?: string;
  outputDescription?: string;
  condition?: IndicatorCondition;
  conditionMet?: boolean;
  showChartComparison?: boolean;
  chartComparisonValues?: ChartComparisonValue[];
  isExpanded?: boolean;
  viewMode?: ViewMode;
  outputBlocksExpanded?: boolean;
  nodeWidth?: number;
  chartPaneHeight?: number;
}

// TIME Trigger Node
export type TimeTriggerData = Record<string, unknown> & RuntimeArtifactData & {
  label: string;
  triggerMode?: "TIME" | "CLICK";
  interval: number; // seconds
  isActive: boolean;
  shortcut?: string | null;
  isRecording?: boolean;
  linkedCondition?: string; // if connected to IF/CLICK, activates when condition met
  outputBlocks?: BlockData[];
}

// CLICK Trigger Node
export type ClickTriggerData = Record<string, unknown> & {
  label: string;
  shortcut: string | null;
  isRecording: boolean; // for shortcut recording mode
  outputBlocks?: BlockData[];
}

// IF Trigger Node - now with expandable detail view
export type IfTriggerData = Record<string, unknown> & {
  label: string;
  functionName: string; // e.g., "checkCondition()"
  condition: string;
  inputBlocks: BlockData[]; // parameters for condition check
  // Each branch has its own output block (true/false)
  branches: {
    id: string;
    name: string;
    result: boolean; // default false, switches to true when condition met
    outputBlock: BlockData;
  }[];
  isExpanded?: boolean;
  viewMode?: ViewMode;
  code?: string;
}

// Branch Node - routes execution based on conditions (with code view for IF logic)
export type BranchNodeData = Record<string, unknown> & {
  label: string;
  functionName?: string; // e.g., "checkCondition()"
  inputBlocks?: BlockData[]; // parameters for condition check
  branches: {
    id: string;
    name: string;
    active: boolean;
    condition?: string;
    code?: string; // IF condition code for this branch
  }[];
  isExpanded?: boolean;
  showCode?: boolean; // toggle to show IF code view
  code?: string; // main condition code
}

// Action Node - CEX Trading
export type CEXActionData = Record<string, unknown> & RuntimeArtifactData & {
  label: string;
  actionType: "CEX";
  exchange: string; // Binance, Bybit, etc.
  symbol: string; // BTC/USDT, ETH/USDT, etc.
  side: OrderSide;
  orderType: "MARKET" | "LIMIT";
  timeInForce?: "GTC" | "FAK" | "FOK" | "IOC";
  amount: string; // quantity or percentage
  amountType: "FIXED" | "PERCENT";
  price?: string; // for limit orders
  polymarketMarketTitle?: string;
  polymarketOutcomeLabel?: string;
  tokenId?: string;
  size?: string;
  polymarketOrderType?: "GTC" | "FAK" | "FOK";
  postOnly?: boolean | string;
  chainId?: number | string;
  // Parameters (shown when expanded)
  inputBlocks: BlockData[];
  // Return value - trade success status
  outputBlocks: BlockData[]; // e.g., [{ id: "success", name: "success", type: "output" }]
  isExpanded?: boolean;
}

// Action Node - DEX Trading
export type DEXActionData = Record<string, unknown> & RuntimeArtifactData & {
  label: string;
  actionType: "DEX";
  contractAddress: string;
  functionName: string; // e.g., "swap()", "addLiquidity()"
  chainId: number;
  // Parameters shown when expanded
  inputBlocks: BlockData[];
  // Return values
  outputBlocks: BlockData[];
  isExpanded?: boolean;
  abi?: string; // optional ABI for the contract function
  contractAbi?: string;
  evmFunctionName?: string;
  evmFunctionSignature?: string;
  evmFunctionStateMutability?: string;
}

export type ActionNodeData = CEXActionData | DEXActionData;

// Merged Function Node - combines multiple sequential function nodes
export type MergedFunctionNodeData = Record<string, unknown> & {
  label: string;
  // Original nodes that were merged (preserved for unmerge)
  mergedNodes: {
    id: string;
    data: FunctionNodeData;
    position: { x: number; y: number };
  }[];
  // Original edges between merged nodes
  internalEdges: Edge[];
  // Combined input blocks (from first node)
  inputBlocks: BlockData[];
  // Combined output blocks (from last node)
  outputBlocks: BlockData[];
  isExpanded?: boolean;
}

export type FunctionNode = Node<FunctionNodeData, "functionNode">;
export type MergedFunctionNode = Node<MergedFunctionNodeData, "mergedFunction">;
export type TimeTriggerNode = Node<TimeTriggerData, "timeTrigger">;
export type ClickTriggerNode = Node<ClickTriggerData, "clickTrigger">;
export type IfTriggerNode = Node<IfTriggerData, "ifTrigger">;
export type BranchNode = Node<BranchNodeData, "branchNode">;
export type ActionNode = Node<ActionNodeData, "actionNode">;
export type TimelineFrameNode = Node<TimelineFrameData, "timelineFrame">;
export type DelayEdge = Edge<DelayEdgeData>;

// Streaming Node - data polling or WebSocket streaming
export type StreamingNodeData = Record<string, unknown> & RuntimeArtifactData & {
  label: string;
  method: "POLLING" | "WEBSOCKET";
  url: string;
  intervalMs?: number; // Used only if method === "POLLING"
  isActive: boolean;
  streamKind?: "url" | "evm-rpc" | "cex-market" | "polymarket-market";
  streamChain?: string;
  streamMethod?: string;
  streamParamsJson?: string;
  responseSchema?: string;
  // Output blocks mapped to data fields returned by the endpoint
  outputBlocks: BlockData[];
  isExpanded?: boolean;
  apiReference?: string;
  authMode?: "NONE" | "API_KEY_SIGNATURE" | "USER_STREAM";
  authToken?: string;
  requestHint?: string;
}

export type StreamingNode = Node<StreamingNodeData, "streamingNode">;

// Monitoring Node - attaches to a frame to format and view logs/values
export type MonitoringNodeData = Record<string, unknown> & {
  label: string;
  format: "logs" | "values" | "chart";
  condition?: IndicatorCondition;
  showChartComparison?: boolean;
  chartComparisonValues?: ChartComparisonValue[];
  // Store what is selected from the connected node
  selectedVariables: string[]; // Could be block IDs or log output keys
}

export type MonitoringNode = Node<MonitoringNodeData, "monitoringNode">;

// Timeline reference type - what triggers the action timing
export type TimelineReferenceType =
  | "sequence_start"    // n seconds from when timeline sequence starts
  | "action_executed"   // n seconds from when a specific action starts executing
  | "action_returned";  // n seconds from when a specific action returns result

export type TimelineReference = Record<string, unknown> & {
  type: TimelineReferenceType;
  referenceActionId?: string; // for action_executed and action_returned
  delayMs: number; // milliseconds delay from reference point
}

// Timeline Item - contains action data embedded (not just reference)
export type TimelineItem = Record<string, unknown> & {
  actionNodeId: string;
  actionData: ActionNodeData; // Embedded action data (since node is removed from canvas)
  startTime: number; // ms from trigger (for visual positioning)
  waitForResult: boolean; // if true, wait for prev action result before starting
  reference: TimelineReference;
}

// Timeline Frame - groups multiple actions with timing
export type TimelineFrameData = Record<string, unknown> & {
  label: string;
  // Actions arranged in timeline (with their relative timing)
  timelineItems: TimelineItem[];
  totalDuration: number; // ms
  isExpanded?: boolean;
}

// Delay Edge Data - for chaining with delays
export type DelayEdgeData = Record<string, unknown> & {
  delay: number; // milliseconds
  waitForResult: boolean; // if false, execute in parallel after delay
  label?: string;
}

export type CustomEdgeData = Record<string, unknown> & {
  sourceBlockId?: string;
  targetBlockId?: string;
  isBranchConnection?: boolean;
  // Delay/chaining data
  delay?: number;
  waitForResult?: boolean;
}

export type CustomEdgeType = Edge<CustomEdgeData>;

// Focus Mode Context
export type FocusState = Record<string, unknown> & {
  isActive: boolean;
  focusedNodeId: string | null;
  connectedNodeIds: string[];
  inputBlockIds: string[];
  outputBlockIds: string[];
}

// Legacy types for backward compatibility
export type NodeFrameData = Record<string, unknown> & {
  label: string;
  triggerType: TriggerType;
  functionName: string;
  code: string;
  blocks: BlockData[];
  branches: {
    id: string;
    name: string;
    active: boolean;
    condition?: string;
  }[];
  timeInterval?: number;
  isExpanded?: boolean;
}

export type NodeFrameNode = Node<NodeFrameData, "nodeFrame">;

// --- Phase 2: Redesign Action Nodes ---

export type DetectNodeData = Record<string, unknown> & {
  label: string;
  isExpanded?: boolean;
  sourceType: "exchange" | "onchain" | "wallet";
  targetSymbol?: string;
  triggerCondition?: string;
}

export type WaitNodeData = Record<string, unknown> & {
  label: string;
  isExpanded?: boolean;
  conditionType: "funding_rate" | "price_target" | "time_delay";
  threshold?: string;
}

export type ExecuteNodeData = Record<string, unknown> & {
  label: string;
  isExpanded?: boolean;
  actionType: "buy" | "sell" | "lend" | "borrow";
  exchange: "binance" | "okx" | "uniswap" | "aave";
  amount?: string;
  leverage?: number;
}

export type CloseNodeData = Record<string, unknown> & {
  label: string;
  isExpanded?: boolean;
  closeCondition: "target_profit" | "stop_loss" | "time_limit";
  value?: string;
}

export type DetectNode = Node<DetectNodeData, "detectNode">;
export type WaitNode = Node<WaitNodeData, "waitNode">;
export type ExecuteNode = Node<ExecuteNodeData, "executeNode">;
export type CloseNode = Node<CloseNodeData, "closeNode">;
