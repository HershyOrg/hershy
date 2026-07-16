import dagre from "dagre";
import type { Node, Edge } from "@xyflow/react";

const DEFAULT_NODE_WIDTH = 320;
const DEFAULT_NODE_HEIGHT = 130;
const GROUP_MIN_WIDTH = 360;
const GROUP_MIN_HEIGHT = 220;
const GROUP_PADDING_LEFT = 48;
const GROUP_PADDING_TOP = 72;
const GROUP_PADDING_RIGHT = 72;
const GROUP_PADDING_BOTTOM = 48;
const RANK_SEPARATION = 220;
const NODE_SEPARATION = 120;
const EDGE_SEPARATION = 90;
const SIBLING_GAP = 96;
const STRATEGY_GROUP_LANE_GAP = 96;
const STRATEGY_GROUP_STACK_GAP = 42;

function getBlockCount(data: Record<string, unknown> | undefined, key: string) {
  const value = data?.[key];
  return Array.isArray(value) ? value.length : 0;
}

function estimateNodeSize(node: Node) {
  const data = node.data as Record<string, unknown> | undefined;
  const inputCount = Math.max(getBlockCount(data, "inputBlocks"), 1);
  const outputCount = Math.max(getBlockCount(data, "outputBlocks"), 1);
  const expanded = data?.isExpanded !== false && data?.isExpanded !== undefined;
  const viewMode = String(data?.viewMode ?? "");

  if (node.type === "actionNode") {
    return expanded
      ? { width: 420, height: 560 + inputCount * 34 + outputCount * 28 }
      : { width: 220, height: 118 + Math.max(0, inputCount - 1) * 16 };
  }
  if (node.type === "functionNode") {
    return expanded
      ? { width: 640, height: viewMode === "code" ? 650 : 590 + inputCount * 34 + outputCount * 34 }
      : { width: 310, height: 282 + inputCount * 18 + outputCount * 18 };
  }
  if (node.type === "streamingNode") {
    const compact = data?.isExpanded === false;
    return compact
      ? { width: 260, height: 172 + Math.min(outputCount, 4) * 42 }
      : { width: 260, height: 520 + outputCount * 42 };
  }
  if (node.type === "monitoringNode") {
    return { width: 420, height: 500 + Math.max(0, outputCount - 1) * 36 };
  }
  if (node.type === "codeEditor") {
    return { width: 430, height: 360 };
  }
  if (node.type === "branchNode") {
    return { width: 460, height: 180 };
  }
  if (node.type === "conditionJunction") {
    return { width: 96, height: Math.max(72, 24 + inputCount * 32) };
  }
  if (node.type === "timelineFrame") {
    return { width: 560, height: 380 };
  }
  if (node.type === "clickTrigger") {
    return { width: 180, height: 184 };
  }
  if (node.type === "timeTrigger") {
    return { width: 300, height: 170 };
  }
  if (node.type === "groupNode") {
    return { width: GROUP_MIN_WIDTH, height: GROUP_MIN_HEIGHT };
  }
  return { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function getNodeSize(node: Node) {
  const style = node.style as Record<string, unknown> | undefined;
  const measured = node.measured as { width?: number; height?: number } | undefined;
  let width =
    (node.type === "groupNode" ? toNumber(style?.width) : undefined) ??
    toNumber(measured?.width) ??
    toNumber(style?.width) ??
    toNumber(node.width);
  let height =
    (node.type === "groupNode" ? toNumber(style?.height) : undefined) ??
    toNumber(measured?.height) ??
    toNumber(style?.height) ??
    toNumber(node.height);

  const estimate = estimateNodeSize(node);
  if (node.type === "groupNode") {
    width = width || estimate.width;
    height = height || estimate.height;
  } else {
    width = Math.max(width || 0, estimate.width);
    height = Math.max(height || 0, estimate.height);
  }

  if (!width || !height) {
    if (node.type === "groupNode") {
      width = width || GROUP_MIN_WIDTH;
      height = height || GROUP_MIN_HEIGHT;
    } else {
      switch (node.type) {
        case "actionNode":
        case "functionNode":
        case "streamingNode":
        case "monitoringNode":
          width = width || 340;
          height = height || 128;
          break;
        case "branchNode":
          width = width || 460;
          height = height || 180;
          break;
        case "conditionJunction":
          width = width || 96;
          height = height || 72;
          break;
        case "timelineFrame":
          width = width || 560;
          height = height || 380;
          break;
        case "clickTrigger":
        case "timeTrigger":
          width = width || 300;
          height = height || 96;
          break;
        default:
          width = width || DEFAULT_NODE_WIDTH;
          height = height || DEFAULT_NODE_HEIGHT;
          break;
      }
    }
  }

  return { width: Number(width), height: Number(height) };
}

function shouldPreserveStrategyStack(parentId: string | undefined, parentNode: Node | undefined, childNodes: Node[]) {
  const parentData = parentNode?.data as Record<string, unknown> | undefined;
  const label = String(parentData?.label ?? "");
  const isStrategyLike =
    parentId === "g_strategy" ||
    parentData?.styleType === "solid" ||
    label.includes("Strategy");
  const isSequenceStack = childNodes.length > 0 && childNodes.every((node) => node.type === "groupNode");

  return isStrategyLike && isSequenceStack;
}

function isSolidGroup(node: Node | undefined) {
  return node?.type === "groupNode" &&
    (node.data as Record<string, unknown> | undefined)?.styleType === "solid";
}

function isWorkflowGroup(node: Node) {
  return node.type === "groupNode" &&
    (node.data as Record<string, unknown> | undefined)?.styleType !== "solid";
}

function getStrategyGroupLanePriority(node: Node) {
  const data = node.data as Record<string, unknown> | undefined;
  const styleType = String(data?.styleType ?? "");
  const sequenceType = String(data?.sequenceType ?? "").toLowerCase();
  if (styleType === "pipeline" || sequenceType === "data-pipeline" || sequenceType === "pipeline" || data?.sharedDataPipeline === true) {
    return 0;
  }
  if (sequenceType === "monitoring") return 2;
  return 1;
}

function getStrategyGroupOrder(node: Node) {
  const data = node.data as Record<string, unknown> | undefined;
  const rawOrder = data?.order;
  if (typeof rawOrder === "number" && Number.isFinite(rawOrder)) return rawOrder;
  if (typeof rawOrder === "string") {
    const parsed = Number.parseFloat(rawOrder);
    if (Number.isFinite(parsed)) return parsed;
  }
  const legacyOrder = ["g_init", "g_trigger1", "g_trigger2", "g_trigger3", "g_emergency"].indexOf(node.id);
  return legacyOrder >= 0 ? legacyOrder + 1 : 0;
}

function compareStrategyGroupsForLeftToRightLayout(left: Node, right: Node) {
  return getStrategyGroupLanePriority(left) - getStrategyGroupLanePriority(right) ||
    getStrategyGroupOrder(left) - getStrategyGroupOrder(right) ||
    left.position.x - right.position.x ||
    left.position.y - right.position.y ||
    left.id.localeCompare(right.id);
}

function arrangeStrategyGroupsInLaneColumns(strategyGroups: Node[]) {
  const ordered = strategyGroups.sort(compareStrategyGroupsForLeftToRightLayout);
  const occupiedLanes = Array.from(new Set(ordered.map(getStrategyGroupLanePriority))).sort((left, right) => left - right);
  const laneWidths = new Map<number, number>();
  ordered.forEach((group) => {
    const { width } = getNodeSize(group);
    const lane = getStrategyGroupLanePriority(group);
    laneWidths.set(lane, Math.max(laneWidths.get(lane) ?? 0, width));
  });

  const laneXByPriority = new Map<number, number>();
  let cursorX = 56;
  occupiedLanes.forEach((lane) => {
    laneXByPriority.set(lane, cursorX);
    cursorX += (laneWidths.get(lane) ?? GROUP_MIN_WIDTH) + STRATEGY_GROUP_LANE_GAP;
  });

  const laneCursorYByPriority = new Map<number, number>(occupiedLanes.map((lane) => [lane, 72]));
  let maxX = 0;
  let maxY = 0;
  ordered.forEach((group) => {
    const lane = getStrategyGroupLanePriority(group);
    const { width, height } = getNodeSize(group);
    const x = laneXByPriority.get(lane) ?? 56;
    const y = laneCursorYByPriority.get(lane) ?? 72;
    group.position.x = x;
    group.position.y = y;
    laneCursorYByPriority.set(lane, y + height + STRATEGY_GROUP_STACK_GAP);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  });

  return { maxX, maxY };
}

function arrangeLooseNodesBelowGroups(looseNodes: Node[], startY: number) {
  if (looseNodes.length === 0) return { maxX: 0, maxY: startY };

  arrangeDisconnectedSiblingsLeftToRight(looseNodes);

  let maxX = 0;
  let maxY = startY;
  looseNodes.forEach((node) => {
    const { width, height } = getNodeSize(node);
    node.position.x += 56;
    node.position.y += startY;
    maxX = Math.max(maxX, node.position.x + width);
    maxY = Math.max(maxY, node.position.y + height);
  });

  return { maxX, maxY };
}

function arrangeSolidGroupChildren(childNodes: Node[]) {
  const workflowGroups = childNodes.filter(isWorkflowGroup);
  if (workflowGroups.length === 0) return false;

  const looseNodes = childNodes.filter((node) => !isWorkflowGroup(node));
  const groupBounds = arrangeStrategyGroupsInLaneColumns(workflowGroups);
  const looseBounds = arrangeLooseNodesBelowGroups(
    looseNodes,
    workflowGroups.length > 0 ? groupBounds.maxY + STRATEGY_GROUP_STACK_GAP * 2 : 72,
  );

  return {
    maxX: Math.max(groupBounds.maxX, looseBounds.maxX),
    maxY: Math.max(groupBounds.maxY, looseBounds.maxY),
  };
}

function separateOverlappingSiblings(nodes: Node[], direction = "LR") {
  if (nodes.length < 2) return;

  const horizontal = direction === "LR" || direction === "RL";
  const rankBucketSize = horizontal ? Math.max(120, RANK_SEPARATION * 0.55) : Math.max(120, NODE_SEPARATION);
  const groups = new Map<number, Node[]>();

  nodes.forEach((node) => {
    const axisValue = horizontal ? node.position.x : node.position.y;
    const bucket = Math.round(axisValue / rankBucketSize);
    const group = groups.get(bucket) ?? [];
    group.push(node);
    groups.set(bucket, group);
  });

  groups.forEach((group) => {
    group.sort((a, b) => {
      const primary = horizontal ? a.position.y - b.position.y : a.position.x - b.position.x;
      return primary || a.id.localeCompare(b.id);
    });

    let cursor = Number.NEGATIVE_INFINITY;
    group.forEach((node) => {
      const { width, height } = getNodeSize(node);
      if (horizontal) {
        node.position.y = Math.max(node.position.y, cursor);
        cursor = node.position.y + height + SIBLING_GAP;
      } else {
        node.position.x = Math.max(node.position.x, cursor);
        cursor = node.position.x + width + SIBLING_GAP;
      }
    });
  });
}

function compareNodesByCurrentCanvasOrder(left: Node, right: Node) {
  return left.position.x - right.position.x ||
    left.position.y - right.position.y ||
    left.id.localeCompare(right.id);
}

function arrangeDisconnectedSiblingsLeftToRight(nodes: Node[]) {
  let cursorX = 0;

  [...nodes]
    .sort(compareNodesByCurrentCanvasOrder)
    .forEach((node) => {
      const { width } = getNodeSize(node);
      node.position.x = cursorX;
      node.position.y = 0;
      cursorX += width + RANK_SEPARATION;
    });
}

function getDirectChildIdForParent(
  nodeId: string,
  parentId: string | undefined,
  nodesById: Map<string, Node>,
) {
  let current = nodesById.get(nodeId);

  while (current) {
    if (current.parentId === parentId) return current.id;
    if (!current.parentId) return parentId === undefined ? current.id : "";
    current = nodesById.get(current.parentId);
  }

  return "";
}

function getBounds(nodes: Node[]) {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: GROUP_MIN_WIDTH, maxY: GROUP_MIN_HEIGHT };
  }

  return nodes.reduce(
    (bounds, node) => {
      const { width, height } = getNodeSize(node);
      return {
        minX: Math.min(bounds.minX, node.position.x),
        minY: Math.min(bounds.minY, node.position.y),
        maxX: Math.max(bounds.maxX, node.position.x + width),
        maxY: Math.max(bounds.maxY, node.position.y + height),
      };
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

export function getLayoutedElements(nodes: Node[], edges: Edge[], direction = "LR") {
  // Deep copy for initialization.
  const newNodes = nodes.map((node) => ({
    ...node,
    position: { ...node.position },
    style: { ...node.style }
  }));

  // Build a parent-child tree map.
  const childrenMap = new Map<string | undefined, Node[]>();
  const nodeById = new Map(newNodes.map((node) => [node.id, node]));
  newNodes.forEach((node) => {
    const parent = node.parentId;
    if (!childrenMap.has(parent)) {
      childrenMap.set(parent, []);
    }
    childrenMap.get(parent)!.push(node);
  });

  // Compute depth so the deepest groups with children are laid out first.
  const depthMap = new Map<string | undefined, number>();

  function calculateDepth(id: string | undefined): number {
    if (id === undefined) return 0;
    if (depthMap.has(id)) return depthMap.get(id)!;

    const node = newNodes.find((n) => n.id === id);
    if (!node) {
      depthMap.set(id, 0);
      return 0;
    }
    const depth = 1 + calculateDepth(node.parentId);
    depthMap.set(id, depth);
    return depth;
  }

  // Sort group IDs by descending depth, from deepest child groups to parents.
  const groupIds = Array.from(childrenMap.keys());
  groupIds.sort((a, b) => calculateDepth(b) - calculateDepth(a));

  // Apply Dagre layout bottom-up through the tree.
  groupIds.forEach((parentId) => {
    const childNodes = childrenMap.get(parentId)!;
    if (childNodes.length === 0) return;
    const parentNodeObj = newNodes.find((n) => n.id === parentId);
    // Preserve manual placement only for sequence group stacks. Regular blocks
    // inside AI-created solid strategy groups are easy to overlap, so Dagre lays them out again.
    const preserveStrategyStack = shouldPreserveStrategyStack(parentId, parentNodeObj, childNodes);
    const solidGroupLayout = isSolidGroup(parentNodeObj)
      ? arrangeSolidGroupChildren(childNodes)
      : false;

    if (!solidGroupLayout && !preserveStrategyStack) {
      const dagreGraph = new dagre.graphlib.Graph();
      dagreGraph.setDefaultEdgeLabel(() => ({}));

      // Configure Dagre graph spacing.
      dagreGraph.setGraph({
        rankdir: direction,
        ranksep: RANK_SEPARATION,
        nodesep: NODE_SEPARATION,
        edgesep: EDGE_SEPARATION,
        marginx: 40,
        marginy: 40,
        ranker: "network-simplex",
        acyclicer: "greedy",
      });

      const childIds = new Set(childNodes.map((n) => n.id));

      // Register child nodes in this group, including group nodes resized by earlier passes.
      childNodes.forEach((node) => {
        const { width, height } = getNodeSize(node);
        dagreGraph.setNode(node.id, { width, height });
      });

      // Project nested child edges into direct child edges at the current level.
      let projectedEdgeCount = 0;
      edges.forEach((edge) => {
        if (edge.hidden) return;
        const sourceChildId = getDirectChildIdForParent(edge.source, parentId, nodeById);
        const targetChildId = getDirectChildIdForParent(edge.target, parentId, nodeById);

        if (
          sourceChildId &&
          targetChildId &&
          sourceChildId !== targetChildId &&
          childIds.has(sourceChildId) &&
          childIds.has(targetChildId)
        ) {
          dagreGraph.setEdge(sourceChildId, targetChildId, {
            minlen: 1,
            weight: 1,
          });
          projectedEdgeCount += 1;
        }
      });

      // Automatically arrange individual subtrees.
      if (direction === "LR" && projectedEdgeCount === 0 && childNodes.length > 1) {
        arrangeDisconnectedSiblingsLeftToRight(childNodes);
      } else {
        dagre.layout(dagreGraph);

        // Extract minimum coordinates and add padding relative to (0, 0).
        childNodes.forEach((node) => {
          const nodeWithPosition = dagreGraph.node(node.id);
          node.position = {
            x: nodeWithPosition.x - nodeWithPosition.width / 2,
            y: nodeWithPosition.y - nodeWithPosition.height / 2,
          };
        });
      }

      separateOverlappingSiblings(childNodes, direction);
    }

    let { minX, minY, maxX, maxY } = getBounds(childNodes);

    // Guard against empty groups to avoid Infinity bounds.
    if (minX === Infinity) {
      minX = 0; minY = 0; maxX = GROUP_MIN_WIDTH; maxY = GROUP_MIN_HEIGHT;
    }

    // Force parent size to wrap all internal children.
    if (parentNodeObj) {
      const boundingWidth = (maxX - minX) + GROUP_PADDING_LEFT + GROUP_PADDING_RIGHT;
      const boundingHeight = (maxY - minY) + GROUP_PADDING_TOP + GROUP_PADDING_BOTTOM;

      const finalWidth = Math.max(boundingWidth, GROUP_MIN_WIDTH);
      const finalHeight = Math.max(boundingHeight, GROUP_MIN_HEIGHT);

      parentNodeObj.style = {
        ...parentNodeObj.style,
        width: finalWidth,
        height: finalHeight,
      };

      // Update the Node object's width/height so React Flow can read them.
      parentNodeObj.width = finalWidth;
      parentNodeObj.height = finalHeight;
    }

    // Apply final coordinates. Child nodes are parent-relative; root nodes start from top-left workspace padding.
    childNodes.forEach((node) => {
      node.position.x = node.position.x - minX + GROUP_PADDING_LEFT;
      node.position.y = node.position.y - minY + GROUP_PADDING_TOP;
    });

  });


  return newNodes;
}
