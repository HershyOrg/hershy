import dagre from "dagre";
import { Node, Edge } from "@xyflow/react";

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

function shouldPreserveStrategyStack(parentId: string, parentNode: Node | undefined, childNodes: Node[]) {
  const parentData = parentNode?.data as Record<string, unknown> | undefined;
  const label = String(parentData?.label ?? "");
  const isStrategyLike =
    parentId === "g_strategy" ||
    parentData?.styleType === "solid" ||
    label.includes("Strategy");
  const isSequenceStack = childNodes.length > 0 && childNodes.every((node) => node.type === "groupNode");

  return isStrategyLike && isSequenceStack;
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
  // 깊은 복사 (초기화)
  const newNodes = nodes.map((node) => ({
    ...node,
    position: { ...node.position },
    style: { ...node.style }
  }));

  // 부모-자식 트리 맵 생성
  const childrenMap = new Map<string | undefined, Node[]>();
  newNodes.forEach((node) => {
    const parent = node.parentId;
    if (!childrenMap.has(parent)) {
      childrenMap.set(parent, []);
    }
    childrenMap.get(parent)!.push(node);
  });

  // 자식을 포함한 가장 깊은 그룹부터 정렬하기 위해 Depth 계산
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

  // 그룹 ID 목록을 Depth 내림차순(가장 깊은 자식 노드 그룹부터 상위 부모로)으로 정렬
  const groupIds = Array.from(childrenMap.keys());
  groupIds.sort((a, b) => calculateDepth(b) - calculateDepth(a));

  // 트리 상향식(Bottom-up)으로 Dagre 레이아웃 적용
  groupIds.forEach((parentId) => {
    // 올가미(전략) 단위 내부만 자동 정렬합니다. 최상위(올가미들 간의) 자동 정렬은 수행하지 않습니다.
    if (parentId === undefined) return;

    const childNodes = childrenMap.get(parentId)!;
    if (childNodes.length === 0) return;
    const parentNodeObj = newNodes.find((n) => n.id === parentId);
    const parentData = parentNodeObj?.data as Record<string, unknown> | undefined;
    const isCollapsedSequence = Boolean(parentData?.isCollapsed);
    // 시퀀스 그룹 스택만 수동 배치를 보존합니다. AI가 만든 solid 전략 그룹 안의 일반 블록들은
    // 좌표가 겹치기 쉬우므로 dagre로 다시 정렬합니다.
    const preserveStrategyStack = shouldPreserveStrategyStack(parentId, parentNodeObj, childNodes);

    if (isCollapsedSequence && parentNodeObj) {
      const collapsedWidth = Number(parentData?.collapsedWidth) || 188;
      const collapsedHeight = Number(parentData?.collapsedHeight) || 120;

      parentNodeObj.style = {
        ...parentNodeObj.style,
        width: collapsedWidth,
        height: collapsedHeight,
      };
      parentNodeObj.width = collapsedWidth;
      parentNodeObj.height = collapsedHeight;
      return;
    }

    if (!preserveStrategyStack) {
      const dagreGraph = new dagre.graphlib.Graph();
      dagreGraph.setDefaultEdgeLabel(() => ({}));

      // DAGRE 그래프 여백 설정
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

      // 이 그룹에 속한 자식 노드 세팅 (이전 단계에서 사이즈가 커진 그 룹노드 포함)
      childNodes.forEach((node) => {
        const { width, height } = getNodeSize(node);
        dagreGraph.setNode(node.id, { width, height });
      });

      // 이 그룹 내부 자식 노드들 간에 연결된 엣지만 세팅
      edges.forEach((edge) => {
        if (childIds.has(edge.source) && childIds.has(edge.target)) {
          dagreGraph.setEdge(edge.source, edge.target, {
            minlen: 1,
            weight: edge.type === "fsmEdge" ? 0.5 : 1,
          });
        }
      });

      // 개별 서브 트리에 대해 자동 정렬 수행
      dagre.layout(dagreGraph);

      // 최소 좌표를 추출하여 (0, 0) 기준으로 패딩 넣기
      childNodes.forEach((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        node.position = {
          x: nodeWithPosition.x - nodeWithPosition.width / 2,
          y: nodeWithPosition.y - nodeWithPosition.height / 2,
        };
      });

      separateOverlappingSiblings(childNodes, direction);
    }

    let { minX, minY, maxX, maxY } = getBounds(childNodes);

    // 빈 그룹일 경우 대비한 예외 처리 (Infinity 방지)
    if (minX === Infinity) {
      minX = 0; minY = 0; maxX = GROUP_MIN_WIDTH; maxY = GROUP_MIN_HEIGHT;
    }

    // 내부 자식들을 다 감쌀 수 있도록 부모 사이즈 강제 업데이트
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

      // Node 객체 자체의 width/height도 업데이트하여 React Flow가 인지하도록 함
      parentNodeObj.width = finalWidth;
      parentNodeObj.height = finalHeight;
    }

    // 최종 상대 좌표 적용: 모든 자식을 Bounding Box 기준 (0, 0)부터 시작하게 하고, 패딩만큼 밀어냄
    childNodes.forEach((node) => {
      node.position.x = node.position.x - minX + GROUP_PADDING_LEFT;
      node.position.y = node.position.y - minY + GROUP_PADDING_TOP;
    });

  });


  // FORCE Top-to-Bottom stacking for sequences inside g_strategy
  const strategyGroups = newNodes.filter(n => n.parentId === 'g_strategy');
  if (strategyGroups.length > 0) {
    // Use manual sorting order or fallback to their original Y position
    const order = ["g_init", "g_trigger1", "g_trigger2", "g_trigger3", "g_emergency"];
    strategyGroups.sort((a, b) => {
      const idxA = order.indexOf(a.id);
      const idxB = order.indexOf(b.id);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      return a.position.y - b.position.y;
    });

    let currentY = 72;
    const groupGap = 72;
    const placedRects: Array<{ left: number; top: number; right: number; bottom: number }> = [];

    // Indentation depth for each sequence to look like programming tabs
    const indentMap: Record<string, number> = {
      "g_init": 0,
      "g_trigger1": 1,
      "g_trigger2": 1,
      "g_trigger3": 1,
      "g_emergency": 2
    };

    for (const sg of strategyGroups) {
      const depth = indentMap[sg.id] || 0;
      const { width, height: h } = getNodeSize(sg);
      const x = 56 + depth * 152;
      let y = currentY;

      let hasOverlap = true;
      while (hasOverlap) {
        hasOverlap = false;

        for (const rect of placedRects) {
          const horizontalOverlap = x < rect.right + groupGap && x + width > rect.left - groupGap;
          const verticalOverlap = y < rect.bottom + groupGap && y + h > rect.top - groupGap;

          if (horizontalOverlap && verticalOverlap) {
            y = rect.bottom + groupGap;
            hasOverlap = true;
          }
        }
      }

      sg.position.x = x;
      sg.position.y = y;
      placedRects.push({ left: x, top: y, right: x + width, bottom: y + h });
      currentY = y + h + groupGap;
    }

    const gStrategy = newNodes.find(n => n.id === 'g_strategy');
    if (gStrategy) {
      let maxX = 0;
      let maxY = 0;

      strategyGroups.forEach((sg) => {
        const { width, height } = getNodeSize(sg);

        maxX = Math.max(maxX, sg.position.x + width);
        maxY = Math.max(maxY, sg.position.y + height);
      });

      const width = Math.max(maxX + 80, GROUP_MIN_WIDTH);
      const height = Math.max(maxY + 64, GROUP_MIN_HEIGHT);
      gStrategy.style = {
        ...gStrategy.style,
        width,
        height,
      };
      gStrategy.width = width;
      gStrategy.height = height;
    }
  }

  return newNodes;
}
