import { useEffect, useRef, useState } from 'react';
import ActionBlock from './blocks/ActionBlock';
import MonitoringBlock from './blocks/MonitoringBlock';
import NormalBlock from './blocks/NormalBlock';
import StreamingBlock from './blocks/StreamingBlock';
import TriggerBlock from './blocks/TriggerBlock';

const INTERACTIVE_SELECTOR = 'input, textarea, select, button, [draggable]';
const CONNECTOR_SELECTOR = '.connection-point';
const CONNECTION_SIDES = ['top', 'right', 'bottom', 'left'];

const getPointerPosition = (event, container) => {
  const rect = container.getBoundingClientRect();
  return {
    x: event.clientX - rect.left + container.scrollLeft,
    y: event.clientY - rect.top + container.scrollTop
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

const buildSvgPath = (points) => {
  if (!points || points.length === 0) {
    return '';
  }
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
};

const getOrthogonalPath = (start, end, obstacles) => {
  const graph = buildRoutingGraph(start, end, obstacles);
  const route = aStarRoute(graph);
  if (!route) {
    return [start, end];
  }
  return simplifyPath(route);
};

export default function Canvas({
  blocks = [],
  connections = [],
  selectedBlockIds = [],
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
  const [draggingId, setDraggingId] = useState(null);
  const [connecting, setConnecting] = useState(null);
  const [selectionRect, setSelectionRect] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const selectionStateRef = useRef(null);
  const hasBlocks = blocks.length > 0;

  const setBlockRef = (blockId) => (node) => {
    if (node) {
      blockRefs.current[blockId] = node;
    } else {
      delete blockRefs.current[blockId];
    }
  };

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
      x: connectorRect.left - containerRect.left + container.scrollLeft + connectorRect.width / 2,
      y: connectorRect.top - containerRect.top + container.scrollTop + connectorRect.height / 2
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
      x: blockRect.left - containerRect.left + container.scrollLeft,
      y: blockRect.top - containerRect.top + container.scrollTop,
      width: blockRect.width,
      height: blockRect.height
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

    const pointer = getPointerPosition(event, canvasRef.current);
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

    const pointer = getPointerPosition(event, canvasRef.current);
    const rect = getRectFromPoints(selectionState.start, pointer);
    setSelectionRect(rect);
  };

  const finishSelection = (event) => {
    const selectionState = selectionStateRef.current;
    if (!selectionState || selectionState.pointerId !== event.pointerId) {
      return;
    }

    event.currentTarget.releasePointerCapture(event.pointerId);
    const pointer = getPointerPosition(event, canvasRef.current);
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

    const pointer = getPointerPosition(event, canvasRef.current);
    setContextMenu({ x: pointer.x, y: pointer.y });
  };

  const handleCanvasPointerDown = (event) => {
    if (event.target.closest('.canvas-context-menu')) {
      return;
    }

    if (contextMenu) {
      setContextMenu(null);
    }

    startSelection(event);
  };

  const handleCanvasPointerMove = (event) => {
    updateSelection(event);
  };

  const handleCanvasPointerUp = (event) => {
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

    const pointer = getPointerPosition(event, container);
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

    if (event.target.closest(INTERACTIVE_SELECTOR)) {
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

    const pointer = getPointerPosition(event, container);
    const originX = block.position?.x ?? 0;
    const originY = block.position?.y ?? 0;
    const blockWidth = event.currentTarget.offsetWidth;
    const blockHeight = event.currentTarget.offsetHeight;
    const maxX = Math.max(0, container.scrollWidth - blockWidth);
    const maxY = Math.max(0, container.scrollHeight - blockHeight);

    dragStateRef.current = {
      id: block.id,
      pointerId: event.pointerId,
      startX: pointer.x,
      startY: pointer.y,
      originX,
      originY,
      maxX,
      maxY
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

    const pointer = getPointerPosition(event, container);
    const nextX = dragState.originX + (pointer.x - dragState.startX);
    const nextY = dragState.originY + (pointer.y - dragState.startY);
    const clampedX = Math.min(Math.max(0, nextX), dragState.maxX);
    const clampedY = Math.min(Math.max(0, nextY), dragState.maxY);

    onPositionChange?.(dragState.id, { x: clampedX, y: clampedY });
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

      const pointer = getPointerPosition(event, container);
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
  }, [connecting?.fromId, connecting?.fromSide, onConnect]);

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

  const connectionPaths = connections
    .map((connection) => {
      const start = getConnectorPoint(connection.fromId, connection.fromSide);
      const end = getConnectorPoint(connection.toId, connection.toSide);

      if (!start || !end) {
        return null;
      }

      const obstacles = obstacleRects.filter((rect) => (
        rect.id !== connection.fromId && rect.id !== connection.toId
      ));
      const points = getOrthogonalPath(start, end, obstacles);

      return {
        id: connection.id || `${connection.fromId}-${connection.toId}`,
        d: buildSvgPath(points),
        kind: connection.kind || 'default'
      };
    })
    .filter(Boolean);

  const previewPath = (() => {
    if (!connecting) {
      return null;
    }

    const start = getConnectorPoint(connecting.fromId, connecting.fromSide);
    const end = connecting.pointer;

    if (!start || !end) {
      return null;
    }

    const obstacles = obstacleRects.filter((rect) => rect.id !== connecting.fromId);
    const points = getOrthogonalPath(start, end, obstacles);
    return buildSvgPath(points);
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
        className="canvas-blocks"
        ref={canvasRef}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerCancel={handleCanvasPointerUp}
        onContextMenu={handleContextMenu}
      >
        {!hasBlocks && (
          <div className="canvas-empty">No blocks created.</div>
        )}
        {selectionRect && (
          <div
            className="canvas-selection-rect"
            style={{
              left: `${selectionRect.x}px`,
              top: `${selectionRect.y}px`,
              width: `${selectionRect.width}px`,
              height: `${selectionRect.height}px`
            }}
          />
        )}
        {contextMenu && (
          <div
            className="canvas-context-menu"
            style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          >
            <button
              type="button"
              className="canvas-context-item"
              onClick={() => {
                onSaveSelection?.();
                setContextMenu(null);
              }}
            >
              저장하기
            </button>
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
            style={{ left: block.position?.x ?? 0, top: block.position?.y ?? 0 }}
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
  );
}
