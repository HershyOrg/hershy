import { useEffect, useRef, useState } from 'react';
import ActionBlock from './blocks/ActionBlock';
import MonitoringBlock from './blocks/MonitoringBlock';
import NormalBlock from './blocks/NormalBlock';
import StreamingBlock from './blocks/StreamingBlock';
import TriggerBlock from './blocks/TriggerBlock';
import { Button } from './ui/button';

const INTERACTIVE_SELECTOR = 'input, textarea, select, button, [draggable]';
const CONNECTOR_SELECTOR = '.connection-point';
const CONNECTION_SIDES = ['top', 'right', 'bottom', 'left'];
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.8;
const ZOOM_STEP = 0.1;
const ZOOM_BIG_STEP = 0.25;
const WORLD_HALF = 50000;
const WORLD_SIZE = WORLD_HALF * 2;
const WORLD_DRAG_LIMIT = WORLD_HALF - 200;

const clampZoom = (value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
const applyZoomDelta = (current, delta) => clampZoom(Number((current + delta).toFixed(2)));

const toSurface = (value) => value + WORLD_HALF;
const toWorld = (value) => value - WORLD_HALF;
const clampWorld = (value) => Math.max(-WORLD_DRAG_LIMIT, Math.min(WORLD_DRAG_LIMIT, value));

const getPointerPosition = (event, container, zoom = 1) => {
  const rect = container.getBoundingClientRect();
  return {
    x: toWorld(container.scrollLeft + (event.clientX - rect.left) / zoom),
    y: toWorld(container.scrollTop + (event.clientY - rect.top) / zoom)
  };
};

const getRectFromPoints = (start, end) => {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  };
};

const rectsIntersect = (a, b) => (
  a.x < b.x + b.width
  && a.x + a.width > b.x
  && a.y < b.y + b.height
  && a.y + a.height > b.y
);

const getConnectorSide = (element) => {
  if (!element) {
    return null;
  }

  for (const side of CONNECTION_SIDES) {
    if (element.classList.contains(`connection-point-${side}`)) {
      return side;
    }
  }

  return null;
};

const ROUTE_PADDING = 14;
const ROUTE_GAP = 8;
const TURN_PENALTY = 20;
const EDGE_CORNER_RADIUS = 10;
const EDGE_PORT_SPACING = 6;
const EDGE_PORT_LEAD = 16;

const toObstacleRect = (rect) => ({
  id: rect.id,
  left: rect.x - ROUTE_PADDING,
  top: rect.y - ROUTE_PADDING,
  right: rect.x + rect.width + ROUTE_PADDING,
  bottom: rect.y + rect.height + ROUTE_PADDING
});

const pointInsideRect = (point, rect) => (
  point.x >= rect.left
  && point.x <= rect.right
  && point.y >= rect.top
  && point.y <= rect.bottom
);

const segmentIntersectsRect = (a, b, rect) => {
  if (a.x === b.x) {
    if (a.x < rect.left || a.x > rect.right) {
      return false;
    }
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    return maxY >= rect.top && minY <= rect.bottom;
  }

  if (a.y === b.y) {
    if (a.y < rect.top || a.y > rect.bottom) {
      return false;
    }
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    return maxX >= rect.left && minX <= rect.right;
  }

  return false;
};

const buildRoutingGraph = (start, end, obstacles) => {
  const xSet = new Set([start.x, end.x]);
  const ySet = new Set([start.y, end.y]);

  obstacles.forEach((rect) => {
    xSet.add(rect.left - ROUTE_GAP);
    xSet.add(rect.right + ROUTE_GAP);
    ySet.add(rect.top - ROUTE_GAP);
    ySet.add(rect.bottom + ROUTE_GAP);
  });

  const xs = Array.from(xSet).sort((a, b) => a - b);
  const ys = Array.from(ySet).sort((a, b) => a - b);
  const nodes = [];
  const nodeIndex = new Map();

  xs.forEach((x) => {
    ys.forEach((y) => {
      const point = { x, y };
      if (obstacles.some((rect) => pointInsideRect(point, rect))) {
        return;
      }
      const key = `${x}:${y}`;
      nodeIndex.set(key, nodes.length);
      nodes.push(point);
    });
  });

  const ensureNode = (point) => {
    const key = `${point.x}:${point.y}`;
    if (!nodeIndex.has(key)) {
      nodeIndex.set(key, nodes.length);
      nodes.push(point);
    }
    return nodeIndex.get(key);
  };

  const startIndex = ensureNode(start);
  const endIndex = ensureNode(end);

  const neighbors = Array.from({ length: nodes.length }, () => []);
  const nodesByX = new Map();
  const nodesByY = new Map();

  nodes.forEach((node, idx) => {
    if (!nodesByX.has(node.x)) {
      nodesByX.set(node.x, []);
    }
    nodesByX.get(node.x).push({ idx, y: node.y });

    if (!nodesByY.has(node.y)) {
      nodesByY.set(node.y, []);
    }
    nodesByY.get(node.y).push({ idx, x: node.x });
  });

  const connectList = (list, axis) => {
    list.sort((a, b) => a[axis] - b[axis]);
    for (let i = 0; i < list.length - 1; i += 1) {
      const current = list[i];
      const next = list[i + 1];
      const a = nodes[current.idx];
      const b = nodes[next.idx];
      const blocked = obstacles.some((rect) => segmentIntersectsRect(a, b, rect));
      if (!blocked) {
        neighbors[current.idx].push(next.idx);
        neighbors[next.idx].push(current.idx);
      }
    }
  };

  nodesByX.forEach((list) => connectList(list, 'y'));
  nodesByY.forEach((list) => connectList(list, 'x'));

  return {
    nodes,
    neighbors,
    startIndex,
    endIndex
  };
};

const aStarRoute = ({ nodes, neighbors, startIndex, endIndex }) => {
  const heuristic = (idx) => (
    Math.abs(nodes[idx].x - nodes[endIndex].x)
    + Math.abs(nodes[idx].y - nodes[endIndex].y)
  );

  const open = [];
  const bestCost = new Map();
  const cameFrom = new Map();

  const startKey = `${startIndex}:n`;
  open.push({
    key: startKey,
    idx: startIndex,
    dir: 'n',
    g: 0,
    f: heuristic(startIndex)
  });
  bestCost.set(startKey, 0);

  const pickLowest = () => {
    let bestIdx = 0;
    for (let i = 1; i < open.length; i += 1) {
      if (open[i].f < open[bestIdx].f) {
        bestIdx = i;
      }
    }
    return open.splice(bestIdx, 1)[0];
  };

  const getDirection = (from, to) => (
    from.x === to.x ? 'v' : 'h'
  );

  while (open.length > 0) {
    const current = pickLowest();
    if (current.idx === endIndex) {
      const path = [];
      let cursor = current.key;
      while (cursor) {
        const [idx] = cursor.split(':');
        path.push(nodes[Number(idx)]);
        cursor = cameFrom.get(cursor);
      }
      return path.reverse();
    }

    neighbors[current.idx].forEach((neighborIdx) => {
      const from = nodes[current.idx];
      const to = nodes[neighborIdx];
      const dir = getDirection(from, to);
      const turnCost = current.dir !== 'n' && current.dir !== dir ? TURN_PENALTY : 0;
      const distance = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
      const gScore = current.g + distance + turnCost;
      const key = `${neighborIdx}:${dir}`;

      if (!bestCost.has(key) || gScore < bestCost.get(key)) {
        bestCost.set(key, gScore);
        cameFrom.set(key, current.key);
        open.push({
          key,
          idx: neighborIdx,
          dir,
          g: gScore,
          f: gScore + heuristic(neighborIdx)
        });
      }
    });
  }

  return null;
};

const simplifyPath = (points) => {
  if (!points || points.length <= 2) {
    return points || [];
  }

  const simplified = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = simplified[simplified.length - 1];
    const current = points[i];
    const next = points[i + 1];
    if ((prev.x === current.x && current.x === next.x)
      || (prev.y === current.y && current.y === next.y)) {
      continue;
    }
    simplified.push(current);
  }
  simplified.push(points[points.length - 1]);
  return simplified;
};

const buildRoundedSvgPath = (points, radius = EDGE_CORNER_RADIUS) => {
  if (!points || points.length === 0) {
    return '';
  }

  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    const segA = {
      x: curr.x - prev.x,
      y: curr.y - prev.y
    };
    const segB = {
      x: next.x - curr.x,
      y: next.y - curr.y
    };

    const lenA = Math.abs(segA.x) + Math.abs(segA.y);
    const lenB = Math.abs(segB.x) + Math.abs(segB.y);
    const localRadius = Math.min(radius, lenA / 2, lenB / 2);

    if (localRadius < 0.5) {
      path += ` L ${curr.x} ${curr.y}`;
      continue;
    }

    const unitA = {
      x: segA.x === 0 ? 0 : Math.sign(segA.x),
      y: segA.y === 0 ? 0 : Math.sign(segA.y)
    };
    const unitB = {
      x: segB.x === 0 ? 0 : Math.sign(segB.x),
      y: segB.y === 0 ? 0 : Math.sign(segB.y)
    };

    const startCurve = {
      x: curr.x - unitA.x * localRadius,
      y: curr.y - unitA.y * localRadius
    };
    const endCurve = {
      x: curr.x + unitB.x * localRadius,
      y: curr.y + unitB.y * localRadius
    };

    path += ` L ${startCurve.x} ${startCurve.y}`;
    path += ` Q ${curr.x} ${curr.y} ${endCurve.x} ${endCurve.y}`;
  }

  const last = points[points.length - 1];
  path += ` L ${last.x} ${last.y}`;
  return path;
};

const getOrthogonalPath = (start, end, obstacles) => {
  const graph = buildRoutingGraph(start, end, obstacles);
  const route = aStarRoute(graph);
  if (!route) {
    return [start, end];
  }
  return simplifyPath(route);
};

const getPortOffsetPoint = (point, side, offset) => {
  if (!offset) {
    return point;
  }

  if (side === 'top' || side === 'bottom') {
    return { x: point.x + offset, y: point.y };
  }

  return { x: point.x, y: point.y + offset };
};

const getSideUnit = (side) => {
  switch (side) {
    case 'top':
      return { x: 0, y: -1 };
    case 'right':
      return { x: 1, y: 0 };
    case 'bottom':
      return { x: 0, y: 1 };
    case 'left':
      return { x: -1, y: 0 };
    default:
      return { x: 1, y: 0 };
  }
};

const getSideLeadPoint = (point, side, distance = EDGE_PORT_LEAD) => {
  const unit = getSideUnit(side);
  return {
    x: point.x + unit.x * distance,
    y: point.y + unit.y * distance
  };
};

export default function Canvas({
  blocks = [],
  connections = [],
  selectedBlockIds = [],
  autoFitRequestId = 0,
  centerViewRequestId = 0,
  centerViewBlockIds = [],
  onBlockDimensionsChange,
  onViewportChange,
  onPositionChange,
  onConnect,
  onUpdateBlock,
  onCreateStreamFieldBlock,
  onRemoveStream,
  onSelectBlock,
  onSelectBlocks,
  onClearSelection,
  onSaveSelection
}) {
  const canvasRef = useRef(null);
  const blockRefs = useRef({});
  const dragStateRef = useRef(null);
  const panStateRef = useRef(null);
  const handledAutoFitRequestRef = useRef(0);
  const handledCenterRequestRef = useRef(0);
  const initializedScrollRef = useRef(false);
  const [draggingId, setDraggingId] = useState(null);
  const [connecting, setConnecting] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [selectionRect, setSelectionRect] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [isPanning, setIsPanning] = useState(false);

  const estimateBlockSizeByType = (blockType) => {
    switch (blockType) {
      case 'action':
        return { width: 400, height: 320 };
      case 'streaming':
        return { width: 360, height: 280 };
      case 'monitoring':
        return { width: 340, height: 250 };
      case 'trigger':
        return { width: 340, height: 240 };
      case 'normal':
        return { width: 320, height: 200 };
      default:
        return { width: 340, height: 240 };
    }
  };
  const applyZoomAtClientPoint = (nextZoom, clientX, clientY) => {
    const container = canvasRef.current;
    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const prevZoom = zoom;

    const worldX = container.scrollLeft + localX / prevZoom;
    const worldY = container.scrollTop + localY / prevZoom;

    const nextWorldX = toWorld(worldX);
    const nextWorldY = toWorld(worldY);
    const nextScrollLeft = toSurface(nextWorldX - localX / nextZoom);
    const nextScrollTop = toSurface(nextWorldY - localY / nextZoom);

    setZoom(nextZoom);
    requestAnimationFrame(() => {
      container.scrollLeft = Math.max(0, nextScrollLeft);
      container.scrollTop = Math.max(0, nextScrollTop);
    });
  };

  const zoomByDelta = (delta) => {
    const container = canvasRef.current;
    if (!container) {
      return;
    }

    const nextZoom = applyZoomDelta(zoom, delta);
    if (nextZoom === zoom) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

    applyZoomAtClientPoint(nextZoom, clientX, clientY);
  };

  const selectionStateRef = useRef(null);
  const hasBlocks = blocks.length > 0;

  const setBlockRef = (blockId) => (node) => {
    if (node) {
      blockRefs.current[blockId] = node;
    } else {
      delete blockRefs.current[blockId];
    }
  };

  useEffect(() => {
    const container = canvasRef.current;
    if (!container || initializedScrollRef.current) {
      return;
    }

    initializedScrollRef.current = true;
    requestAnimationFrame(() => {
      container.scrollLeft = Math.max(0, WORLD_HALF - container.clientWidth / 2);
      container.scrollTop = Math.max(0, WORLD_HALF - container.clientHeight / 2);
    });
  }, []);

  useEffect(() => {
    if (typeof onBlockDimensionsChange !== 'function') {
      return;
    }

    const rafId = requestAnimationFrame(() => {
      const measured = {};
      blocks.forEach((block) => {
        const node = blockRefs.current[block.id];
        if (!node) {
          return;
        }
        measured[block.id] = {
          width: node.offsetWidth,
          height: node.offsetHeight
        };
      });
      onBlockDimensionsChange(measured);
    });

    return () => cancelAnimationFrame(rafId);
  }, [blocks, onBlockDimensionsChange]);

  useEffect(() => {
    if (typeof onViewportChange !== 'function') {
      return undefined;
    }

    const container = canvasRef.current;
    if (!container) {
      return undefined;
    }

    const emitViewport = () => {
      onViewportChange({
        width: container.clientWidth,
        height: container.clientHeight
      });
    };

    const rafId = requestAnimationFrame(emitViewport);
    let resizeObserver;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => emitViewport());
      resizeObserver.observe(container);
    } else {
      window.addEventListener('resize', emitViewport);
    }

    return () => {
      cancelAnimationFrame(rafId);
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else {
        window.removeEventListener('resize', emitViewport);
      }
    };
  }, [onViewportChange]);

  const getConnectorPoint = (blockId, side) => {
    const blockElement = blockRefs.current[blockId];
    const container = canvasRef.current;

    if (!blockElement || !container) {
      return null;
    }

    const connector = blockElement.querySelector(`.connection-point-${side}`);
    if (!connector) {
      return null;
    }

    const connectorRect = connector.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    return {
      x: toWorld(container.scrollLeft + (connectorRect.left - containerRect.left + connectorRect.width / 2) / zoom),
      y: toWorld(container.scrollTop + (connectorRect.top - containerRect.top + connectorRect.height / 2) / zoom)
    };
  };

  const getBlockRect = (blockId) => {
    const blockElement = blockRefs.current[blockId];
    const container = canvasRef.current;

    if (!blockElement || !container) {
      return null;
    }

    const blockRect = blockElement.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    return {
      x: toWorld(container.scrollLeft + (blockRect.left - containerRect.left) / zoom),
      y: toWorld(container.scrollTop + (blockRect.top - containerRect.top) / zoom),
      width: blockRect.width / zoom,
      height: blockRect.height / zoom
    };
  };

  const startSelection = (event) => {
    if (event.button !== 0 || !canvasRef.current || connecting) {
      return;
    }

    if (event.target.closest('.canvas-block') || event.target.closest(CONNECTOR_SELECTOR)) {
      return;
    }

    event.preventDefault();

    const pointer = getPointerPosition(event, canvasRef.current, zoom);
    selectionStateRef.current = {
      pointerId: event.pointerId,
      start: pointer
    };
    setSelectionRect({ x: pointer.x, y: pointer.y, width: 0, height: 0 });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateSelection = (event) => {
    const selectionState = selectionStateRef.current;
    if (!selectionState || selectionState.pointerId !== event.pointerId) {
      return;
    }

    const pointer = getPointerPosition(event, canvasRef.current, zoom);
    const rect = getRectFromPoints(selectionState.start, pointer);
    setSelectionRect(rect);
  };

  const finishSelection = (event) => {
    const selectionState = selectionStateRef.current;
    if (!selectionState || selectionState.pointerId !== event.pointerId) {
      return;
    }

    event.currentTarget.releasePointerCapture(event.pointerId);
    const pointer = getPointerPosition(event, canvasRef.current, zoom);
    const rect = getRectFromPoints(selectionState.start, pointer);
    selectionStateRef.current = null;
    setSelectionRect(null);

    if (!rect || rect.width < 4 || rect.height < 4) {
      if (!event.shiftKey) {
        onClearSelection?.();
      }
      return;
    }

    const selected = blocks
      .map((block) => ({ id: block.id, rect: getBlockRect(block.id) }))
      .filter((block) => block.rect && rectsIntersect(rect, block.rect))
      .map((block) => block.id);

    onSelectBlocks?.(selected, { additive: event.shiftKey });
  };

  const handleContextMenu = (event) => {
    if (!canvasRef.current || selectedBlockIds.length === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const pointer = getPointerPosition(event, canvasRef.current, zoom);
    setContextMenu({ x: pointer.x, y: pointer.y });
  };

  const handleCanvasPointerDown = (event) => {
    if (event.target.closest('.canvas-context-menu')) {
      return;
    }

    if (contextMenu) {
      setContextMenu(null);
    }

    if (event.button !== 0 || !canvasRef.current || connecting) {
      return;
    }

    if (event.target.closest('.canvas-block') || event.target.closest(CONNECTOR_SELECTOR)) {
      return;
    }

    if (event.shiftKey) {
      startSelection(event);
      return;
    }

    event.preventDefault();
    const container = canvasRef.current;
    panStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startScrollLeft: container.scrollLeft,
      startScrollTop: container.scrollTop,
      moved: false
    };
    setIsPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleCanvasPointerMove = (event) => {
    const panState = panStateRef.current;
    if (panState && panState.pointerId === event.pointerId && canvasRef.current) {
      const container = canvasRef.current;
      const deltaX = event.clientX - panState.startClientX;
      const deltaY = event.clientY - panState.startClientY;
      if (!panState.moved && (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2)) {
        panState.moved = true;
      }

      const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const nextScrollLeft = panState.startScrollLeft - deltaX / zoom;
      const nextScrollTop = panState.startScrollTop - deltaY / zoom;
      container.scrollLeft = Math.min(maxScrollLeft, Math.max(0, nextScrollLeft));
      container.scrollTop = Math.min(maxScrollTop, Math.max(0, nextScrollTop));
      return;
    }

    updateSelection(event);
  };

  const handleCanvasPointerUp = (event) => {
    const panState = panStateRef.current;
    if (panState && panState.pointerId === event.pointerId) {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (!panState.moved) {
        onClearSelection?.();
      }
      panStateRef.current = null;
      setIsPanning(false);
      return;
    }

    finishSelection(event);
  };

  const handleConnectorPointerDown = (event, block) => {
    if (event.button !== 0) {
      return;
    }

    const connector = event.target.closest(CONNECTOR_SELECTOR);
    const side = getConnectorSide(connector);

    if (!side) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const container = canvasRef.current;
    if (!container) {
      return;
    }

    const pointer = getPointerPosition(event, container, zoom);
    setConnecting({ fromId: block.id, fromSide: side, pointer });
  };

  const handlePointerDown = (event, block) => {
    if (event.button !== 0) {
      return;
    }

    if (event.target.closest(CONNECTOR_SELECTOR)) {
      handleConnectorPointerDown(event, block);
      return;
    }

    const isInteractiveTarget = Boolean(event.target.closest(INTERACTIVE_SELECTOR));
    const isBlockSelected = selectedBlockIds.includes(block.id);

    // First click on inner controls should select the block only.
    // Inner controls become interactive only after the block is already selected.
    if (isInteractiveTarget && !isBlockSelected) {
      onSelectBlock?.(block.id, {
        toggle: event.metaKey || event.ctrlKey,
        additive: event.shiftKey
      });
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (isInteractiveTarget) {
      return;
    }

    onSelectBlock?.(block.id, {
      toggle: event.metaKey || event.ctrlKey,
      additive: event.shiftKey
    });

    event.preventDefault();

    const container = canvasRef.current;
    if (!container) {
      return;
    }

    const pointer = getPointerPosition(event, container, zoom);
    const originX = block.position?.x ?? 0;
    const originY = block.position?.y ?? 0;
    dragStateRef.current = {
      id: block.id,
      pointerId: event.pointerId,
      startX: pointer.x,
      startY: pointer.y,
      originX,
      originY
    };

    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingId(block.id);
  };

  const handlePointerMove = (event) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const container = canvasRef.current;
    if (!container) {
      return;
    }

    const pointer = getPointerPosition(event, container, zoom);
    const nextX = clampWorld(dragState.originX + (pointer.x - dragState.startX));
    const nextY = clampWorld(dragState.originY + (pointer.y - dragState.startY));

    onPositionChange?.(dragState.id, { x: nextX, y: nextY });
  };

  const handlePointerUp = (event) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    dragStateRef.current = null;
    setDraggingId(null);

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  useEffect(() => {
    if (!connecting) {
      return;
    }

    const handleMove = (event) => {
      const container = canvasRef.current;
      if (!container) {
        return;
      }

      const pointer = getPointerPosition(event, container, zoom);
      setConnecting((prev) => (prev ? { ...prev, pointer } : prev));
    };

    const handleUp = (event) => {
      const elements = document.elementsFromPoint(event.clientX, event.clientY);
      const connector = elements.find((element) => (
        element?.classList && element.classList.contains('connection-point')
      ));

      if (connector) {
        const side = getConnectorSide(connector);
        const blockElement = connector.closest('.canvas-block');
        const blockId = blockElement?.dataset?.blockId;

        if (blockId && side && blockId !== connecting.fromId) {
          onConnect?.({
            fromId: connecting.fromId,
            fromSide: connecting.fromSide,
            toId: blockId,
            toSide: side
          });
        }
      }

      setConnecting(null);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [connecting?.fromId, connecting?.fromSide, onConnect, zoom]);

  useEffect(() => {
    if (
      !autoFitRequestId
      || blocks.length === 0
      || handledAutoFitRequestRef.current === autoFitRequestId
    ) {
      return undefined;
    }

    handledAutoFitRequestRef.current = autoFitRequestId;

    const rafId = requestAnimationFrame(() => {
      const container = canvasRef.current;
      if (!container) {
        return;
      }

      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;

      const targetBlocks = Array.isArray(centerViewBlockIds) && centerViewBlockIds.length > 0
        ? blocks.filter((block) => centerViewBlockIds.includes(block.id))
        : blocks;

      if (targetBlocks.length === 0) {
        return;
      }

      targetBlocks.forEach((block) => {
        const posX = block.position?.x ?? 0;
        const posY = block.position?.y ?? 0;
        const node = blockRefs.current[block.id];
        const estimated = estimateBlockSizeByType(block.type);
        const width = node?.offsetWidth || estimated.width;
        const height = node?.offsetHeight || estimated.height;

        minX = Math.min(minX, posX);
        minY = Math.min(minY, posY);
        maxX = Math.max(maxX, posX + width);
        maxY = Math.max(maxY, posY + height);
      });

      if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
        return;
      }

      const defaultPaddingX = 100;
      const defaultPaddingY = 100;
      const compactPaddingX = 10;
      const compactPaddingY = 10;
      const computeFitMetrics = (paddingX, paddingY) => {
        const boundsWidth = Math.max(1, maxX - minX + paddingX * 2);
        const boundsHeight = Math.max(1, maxY - minY + paddingY * 2);
        const viewportWidth = Math.max(1, container.clientWidth - paddingX * 2);
        const viewportHeight = Math.max(1, container.clientHeight - paddingY * 2);
        const widthRatio = viewportWidth / boundsWidth;
        const heightRatio = viewportHeight / boundsHeight;
        return {
          fitZoom: Math.min(1, widthRatio, heightRatio),
          widthRatio,
          heightRatio
        };
      };

      let appliedPaddingX = defaultPaddingX;
      let appliedPaddingY = defaultPaddingY;
      const defaultMetrics = computeFitMetrics(defaultPaddingX, defaultPaddingY);

      // 1) Start from full padding, 2) shrink only insufficient axis, 3) re-fit UI.
      if (defaultMetrics.widthRatio < 1) {
        appliedPaddingX = compactPaddingX;
      }
      if (defaultMetrics.heightRatio < 1) {
        appliedPaddingY = compactPaddingY;
      }

      const fitMetrics = computeFitMetrics(appliedPaddingX, appliedPaddingY);
      const fitZoom = fitMetrics.fitZoom;

      const nextZoom = clampZoom(Number(fitZoom.toFixed(2)));
      if (nextZoom < zoom) {
        setZoom(nextZoom);
      }

      requestAnimationFrame(() => {
        const scrollPaddingX = Math.max(0, appliedPaddingX - 4);
        const scrollPaddingY = Math.max(0, appliedPaddingY - 4);
        container.scrollLeft = Math.max(0, toSurface(minX) - scrollPaddingX);
        container.scrollTop = Math.max(0, toSurface(minY) - scrollPaddingY);
      });
    });

    return () => cancelAnimationFrame(rafId);
  }, [autoFitRequestId, blocks, zoom]);

  useEffect(() => {
    if (
      !centerViewRequestId
      || blocks.length === 0
      || handledCenterRequestRef.current === centerViewRequestId
    ) {
      return undefined;
    }

    handledCenterRequestRef.current = centerViewRequestId;

    const rafId = requestAnimationFrame(() => {
      const container = canvasRef.current;
      if (!container) {
        return;
      }

      const targetBlocks = Array.isArray(centerViewBlockIds) && centerViewBlockIds.length > 0
        ? blocks.filter((block) => centerViewBlockIds.includes(block.id))
        : blocks;

      if (targetBlocks.length === 0) {
        return;
      }

      let minCenterX = Number.POSITIVE_INFINITY;
      let minCenterY = Number.POSITIVE_INFINITY;
      let maxCenterX = Number.NEGATIVE_INFINITY;
      let maxCenterY = Number.NEGATIVE_INFINITY;

      targetBlocks.forEach((block) => {
        const posX = block.position?.x ?? 0;
        const posY = block.position?.y ?? 0;
        const node = blockRefs.current[block.id];
        const estimated = estimateBlockSizeByType(block.type);
        const width = node?.offsetWidth || estimated.width;
        const height = node?.offsetHeight || estimated.height;

        const centerX = posX + width / 2;
        const centerY = posY + height / 2;
        minCenterX = Math.min(minCenterX, centerX);
        minCenterY = Math.min(minCenterY, centerY);
        maxCenterX = Math.max(maxCenterX, centerX);
        maxCenterY = Math.max(maxCenterY, centerY);
      });

      if (!Number.isFinite(minCenterX) || !Number.isFinite(minCenterY) || !Number.isFinite(maxCenterX) || !Number.isFinite(maxCenterY)) {
        return;
      }

      const centerWorldX = (minCenterX + maxCenterX) / 2;
      const centerWorldY = (minCenterY + maxCenterY) / 2;
      const nextScrollLeft = toSurface(centerWorldX) - container.clientWidth / (2 * zoom);
      const nextScrollTop = toSurface(centerWorldY) - container.clientHeight / (2 * zoom);
      const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);

      container.scrollLeft = Math.min(maxScrollLeft, Math.max(0, nextScrollLeft));
      container.scrollTop = Math.min(maxScrollTop, Math.max(0, nextScrollTop));
    });

    return () => cancelAnimationFrame(rafId);
  }, [centerViewRequestId, centerViewBlockIds, blocks, zoom]);

  useEffect(() => {
    const container = canvasRef.current;
    if (!container) {
      return undefined;
    }

    const onNativeWheel = (event) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }

      event.preventDefault();
      const direction = event.deltaY > 0 ? -1 : 1;
      zoomByDelta(direction * ZOOM_STEP);
    };

    container.addEventListener('wheel', onNativeWheel, { passive: false });
    return () => container.removeEventListener('wheel', onNativeWheel);
  }, [zoom]);

  useEffect(() => {
    const isEditableTarget = (target) => {
      if (!target) {
        return false;
      }
      if (target.isContentEditable) {
        return true;
      }
      const tag = target.tagName?.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select';
    };

    const onKeyDown = (event) => {
      const container = canvasRef.current;
      if (container) {
        const targetInside = container.contains(event.target);
        const activeInside = container.contains(document.activeElement);
        if (!targetInside && !activeInside) {
          return;
        }
      }

      if (!(event.ctrlKey || event.metaKey) || isEditableTarget(event.target)) {
        return;
      }

      const key = event.key;
      const code = event.code;
      if (key === '+' || key === '=' || key === 'Add' || code === 'NumpadAdd' || code === 'Equal') {
        event.preventDefault();
        zoomByDelta(ZOOM_STEP);
        return;
      }

      if (key === '-' || key === '_' || key === 'Subtract' || code === 'NumpadSubtract' || code === 'Minus') {
        event.preventDefault();
        zoomByDelta(-ZOOM_STEP);
        return;
      }

      if (key === '0' || code === 'Digit0' || code === 'Numpad0') {
        event.preventDefault();
        const containerRect = canvasRef.current?.getBoundingClientRect();
        if (!containerRect) {
          setZoom(1);
          return;
        }
        applyZoomAtClientPoint(
          1,
          containerRect.left + containerRect.width / 2,
          containerRect.top + containerRect.height / 2
        );
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoom]);

  const blockRects = blocks
    .map((block) => {
      const rect = getBlockRect(block.id);
      if (!rect) {
        return null;
      }
      return { id: block.id, ...rect };
    })
    .filter(Boolean);

  const obstacleRects = blockRects.map(toObstacleRect);
  const blockRectById = new Map(blockRects.map((rect) => [rect.id, rect]));

  const connectionTotals = new Map();
  connections.forEach((connection) => {
    const fromSide = connection.fromSide || 'right';
    const toSide = connection.toSide || 'left';
    const fromKey = `${connection.fromId}:${fromSide}`;
    const toKey = `${connection.toId}:${toSide}`;
    connectionTotals.set(fromKey, (connectionTotals.get(fromKey) || 0) + 1);
    connectionTotals.set(toKey, (connectionTotals.get(toKey) || 0) + 1);
  });
  const connectionUsage = new Map();

  const connectionPaths = connections
    .map((connection) => {
      const fromSide = connection.fromSide || 'right';
      const toSide = connection.toSide || 'left';
      const startRaw = getConnectorPoint(connection.fromId, fromSide);
      const endRaw = getConnectorPoint(connection.toId, toSide);

      const fromKey = `${connection.fromId}:${fromSide}`;
      const toKey = `${connection.toId}:${toSide}`;
      const fromTotal = connectionTotals.get(fromKey) || 1;
      const toTotal = connectionTotals.get(toKey) || 1;
      const fromUsed = connectionUsage.get(fromKey) || 0;
      const toUsed = connectionUsage.get(toKey) || 0;
      connectionUsage.set(fromKey, fromUsed + 1);
      connectionUsage.set(toKey, toUsed + 1);

      const fromOffset = (fromUsed - (fromTotal - 1) / 2) * EDGE_PORT_SPACING;
      const toOffset = (toUsed - (toTotal - 1) / 2) * EDGE_PORT_SPACING;

      const start = startRaw ? getPortOffsetPoint(startRaw, fromSide, fromOffset) : null;
      const end = endRaw ? getPortOffsetPoint(endRaw, toSide, toOffset) : null;

      if (!start || !end) {
        return null;
      }

      const obstacles = obstacleRects.filter((rect) => (
        rect.id !== connection.fromId && rect.id !== connection.toId
      ));
      const startLead = getSideLeadPoint(start, fromSide);
      const endLead = getSideLeadPoint(end, toSide);
      const middle = getOrthogonalPath(startLead, endLead, obstacles);
      const points = [start, ...middle, end];
      const surfacePoints = points.map((point) => ({ x: toSurface(point.x), y: toSurface(point.y) }));

      return {
        id: connection.id || `${connection.fromId}-${connection.toId}`,
        d: buildRoundedSvgPath(surfacePoints),
        kind: connection.kind || 'default'
      };
    })
    .filter(Boolean);

  const previewPath = (() => {
    if (!connecting) {
      return null;
    }

    const fromSide = connecting.fromSide || 'right';
    const start = getConnectorPoint(connecting.fromId, fromSide);
    const end = connecting.pointer;

    if (!start || !end) {
      return null;
    }

    // Keep live drag preview fully freeform so cursor motion is reflected directly.
    const dx = end.x - start.x;
    const controlA = {
      x: start.x + dx * 0.35,
      y: start.y
    };
    const controlB = {
      x: end.x - dx * 0.35,
      y: end.y
    };

    const s = { x: toSurface(start.x), y: toSurface(start.y) };
    const c1 = { x: toSurface(controlA.x), y: toSurface(controlA.y) };
    const c2 = { x: toSurface(controlB.x), y: toSurface(controlB.y) };
    const e = { x: toSurface(end.x), y: toSurface(end.y) };

    return `M ${s.x} ${s.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${e.x} ${e.y}`;
  })();

  const renderBlock = (block) => {
    switch (block.type) {
      case 'action':
        return (
          <ActionBlock
            blockId={block.id}
            name={block.name}
            actionType={block.actionType}
            exchange={block.exchange}
            dexProtocol={block.dexProtocol}
            contractAddress={block.contractAddress}
            contractAbi={block.contractAbi}
            evmChain={block.evmChain}
            evmFunctionName={block.evmFunctionName}
            evmFunctionSignature={block.evmFunctionSignature}
            evmFunctionStateMutability={block.evmFunctionStateMutability}
            chainId={block.chainId}
            contractAddressSource={block.contractAddressSource}
            contractAddressSources={block.contractAddressSources}
            executionMode={block.executionMode}
            apiUrl={block.apiUrl}
            apiPayloadTemplate={block.apiPayloadTemplate}
            parameters={block.parameters}
            onUpdateBlock={onUpdateBlock}
          />
        );
      case 'monitoring':
        return (
          <MonitoringBlock
            blockId={block.id}
            name={block.name}
            type={block.monitorType || 'table'}
            connectedStream={block.connectedStream}
            fields={block.fields}
            onUpdateBlock={onUpdateBlock}
            onRemoveStream={() => onRemoveStream?.(block.id)}
          />
        );
      case 'normal':
        return (
          <NormalBlock
            blockId={block.id}
            name={block.name}
            value={block.value}
            onUpdateBlock={onUpdateBlock}
          />
        );
      case 'streaming':
        return (
          <StreamingBlock
            blockId={block.id}
            name={block.name}
            fields={block.fields}
            apiUrl={block.apiUrl}
            streamKind={block.streamKind}
            streamChain={block.streamChain}
            streamMethod={block.streamMethod}
            streamParamsJson={block.streamParamsJson}
            updateMode={block.updateMode}
            updateInterval={block.updateInterval}
            mutedFields={block.mutedFields}
            hideMutedFields={block.hideMutedFields}
            onUpdateBlock={onUpdateBlock}
            onCreateFieldStream={onCreateStreamFieldBlock}
          />
        );
      case 'trigger':
        return (
          <TriggerBlock
            blockId={block.id}
            name={block.name}
            triggerType={block.triggerType}
            interval={block.interval}
            conditionSummary={block.conditionSummary}
            logicOperator={block.logicOperator}
            onUpdateBlock={onUpdateBlock}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="canvas">
      {/* Canvas grid background */}
      <div className="canvas-grid"></div>
      <div
        className={`canvas-blocks${isPanning ? ' is-panning' : ''}`}
        ref={canvasRef}
        style={{ zoom }}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerCancel={handleCanvasPointerUp}
        onContextMenu={handleContextMenu}
      >
        <div className="canvas-surface" style={{ width: `${WORLD_SIZE}px`, height: `${WORLD_SIZE}px` }}>
          {!hasBlocks && (
            <div className="canvas-empty" style={{ left: `${toSurface(0)}px`, top: `${toSurface(0)}px`, position: 'absolute' }}>No blocks created.</div>
          )}
          {selectionRect && (
            <div
              className="canvas-selection-rect"
              style={{
                left: `${toSurface(selectionRect.x)}px`,
                top: `${toSurface(selectionRect.y)}px`,
                width: `${selectionRect.width}px`,
                height: `${selectionRect.height}px`
              }}
            />
          )}
          {contextMenu && (
            <div
              className="canvas-context-menu"
              style={{ left: `${toSurface(contextMenu.x)}px`, top: `${toSurface(contextMenu.y)}px` }}
            >
              <Button
                type="button"
                className="canvas-context-item"
                onClick={() => {
                  onSaveSelection?.();
                  setContextMenu(null);
                }}
              >
                저장하기
              </Button>
            </div>
          )}
          <svg className="canvas-connections" aria-hidden="true">
            <defs>
              {[
                { id: 'default', color: '#38BDF8' },
                { id: 'stream-monitor', color: '#22D3EE' },
                { id: 'trigger-action', color: '#A78BFA' },
                { id: 'action-input', color: '#FBBF24' }
              ].map((marker) => (
                <marker
                  key={marker.id}
                  id={`canvas-arrow-${marker.id}`}
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="8"
                  markerHeight="8"
                  orient="auto"
                >
                  <path d="M0 0 L8 4 L0 8 Z" fill={marker.color} />
                </marker>
              ))}
            </defs>
            {connectionPaths.map((connection) => (
              <path
                key={`${connection.id}-halo`}
                className={`canvas-connection-halo canvas-connection-halo--${connection.kind}`}
                d={connection.d}
              />
            ))}
            {connectionPaths.map((connection) => (
              <path
                key={connection.id}
                className={`canvas-connection-line canvas-connection-line--${connection.kind}`}
                d={connection.d}
                markerEnd={`url(#canvas-arrow-${connection.kind})`}
              />
            ))}
            {previewPath && (
              <path
                className="canvas-connection-line is-preview"
                d={previewPath}
              />
            )}
          </svg>
          {blocks.map((block) => (
            <div
              key={block.id}
              className={`canvas-block${draggingId === block.id ? ' is-dragging' : ''}${selectedBlockIds.includes(block.id) ? ' is-selected' : ''}`}
              data-block-id={block.id}
              ref={setBlockRef(block.id)}
              style={{ left: toSurface(block.position?.x ?? 0), top: toSurface(block.position?.y ?? 0) }}
              onPointerDown={(event) => handlePointerDown(event, block)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              {renderBlock(block)}
            </div>
          ))}
        </div>
      </div>
      <div className="canvas-zoom-controls">
        <Button
          type="button"
          className="canvas-zoom-btn"
          onClick={() => zoomByDelta(-ZOOM_STEP)}
          aria-label="축소"
        >
          -
        </Button>
        <Button
          type="button"
          className="canvas-zoom-btn"
          onClick={() => zoomByDelta(ZOOM_BIG_STEP)}
          aria-label="빠른 확대"
        >
          ++
        </Button>
        <Button
          type="button"
          className="canvas-zoom-btn canvas-zoom-label"
          onClick={() => {
            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) {
              setZoom(1);
              return;
            }
            applyZoomAtClientPoint(1, rect.left + rect.width / 2, rect.top + rect.height / 2);
          }}
          aria-label="줌 초기화"
        >
          {Math.round(zoom * 100)}%
        </Button>
        <Button
          type="button"
          className="canvas-zoom-btn"
          onClick={() => zoomByDelta(ZOOM_STEP)}
          aria-label="확대"
        >
          +
        </Button>
      </div>
    </div>
  );
}
