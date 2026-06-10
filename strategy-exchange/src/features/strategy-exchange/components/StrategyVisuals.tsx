import { useMemo } from "react";
import { NodeEditor } from "@/features/strategy-editor/components/NodeEditor";
import {
  buildEasyPath,
  getEasyEdgeColor,
  getEasyEdgeDash,
  getEasyEdgeKind,
  getEasyNodeKind,
} from "../animations/graphPaths";
import type { Strategy } from "../types/strategyTypes";
import { getHershyCanvasGraph } from "../utils/strategyCanvasGraph";
import { LightweightReturnChart } from "./LightweightReturnChart";

function getStrategyNode(strategy: Strategy, id: string) {
  const node = strategy.nodes.find((candidate) => candidate.id === id);
  if (!node) {
    throw new Error(`Missing graph node: ${id}`);
  }
  return node;
}

export function StrategyGraph({ strategy }: { strategy: Strategy }) {
  return (
    <div className="graph-frame easy-strategy-thumbnail" aria-label={`${strategy.title} strategy graph`}>
      <svg viewBox="0 0 340 156" role="img">
        <defs>
          <marker
            id={`easy-arrow-${strategy.id}`}
            viewBox="0 0 12 12"
            refX="10"
            refY="6"
            markerWidth="8"
            markerHeight="8"
            markerUnits="userSpaceOnUse"
            orient="auto"
          >
            <path d="M 1 1 L 11 6 L 1 11 L 4.1 6 z" className="easy-edge-arrow" />
          </marker>
        </defs>
        <g className="edge-layer">
          {strategy.edges.map((edge) => {
            const from = getStrategyNode(strategy, edge.from);
            const to = getStrategyNode(strategy, edge.to);
            const kind = getEasyEdgeKind(edge.label);
            const color = getEasyEdgeColor(kind);
            const fromPoint = { x: from.x + 36, y: from.y };
            const toPoint = { x: to.x - 36, y: to.y };
            const midX = (from.x + to.x) / 2;
            const midY = (from.y + to.y) / 2;
            return (
              <g key={`${edge.from}-${edge.to}`}>
                <path
                  d={buildEasyPath(fromPoint, toPoint)}
                  className="easy-edge-line"
                  stroke={color}
                  strokeDasharray={getEasyEdgeDash(kind)}
                  markerEnd={`url(#easy-arrow-${strategy.id})`}
                />
                <g transform={`translate(${midX} ${midY - 5})`}>
                  <rect className={`easy-edge-label-chip ${kind}`} x="-27" y="-8" width="54" height="16" />
                  <text className="easy-edge-label" dominantBaseline="middle">
                    {edge.label}
                  </text>
                </g>
              </g>
            );
          })}
          {strategy.nodes.map((node) => (
            <g
              key={node.id}
              className={`easy-node ${getEasyNodeKind(node.label, node.id)}`}
              transform={`translate(${node.x} ${node.y})`}
            >
              <rect x="-36" y="-18" width="72" height="36" className="easy-node-box" />
              <rect x="-36" y="-18" width="72" height="3" className="easy-node-accent" />
              <text className="easy-node-title" y="-2" dominantBaseline="middle">
                {node.label}
              </text>
              <text className="easy-node-status" y="10" dominantBaseline="middle">
                {getEasyNodeKind(node.label, node.id)}
              </text>
            </g>
          ))}
        </g>
      </svg>
      <div className="pnl-hover-layer" aria-hidden="true">
        <LightweightReturnChart
          className="pnl-hover-chart"
          series={strategy.pnlSeries}
          baseValue={strategy.deployedCapital}
          compact
          height={132}
          positive={strategy.realizedPnl >= 0}
          lineColor="#d0ad4f"
        />
      </div>
    </div>
  );
}

export function PnlMiniChart({ strategy }: { strategy: Strategy }) {
  const positive = strategy.realizedPnl >= 0;

  return (
    <div className="profile-pnl-chart" aria-label={`${strategy.title} PnL graph`}>
      <LightweightReturnChart
        className="profile-pnl-lightweight-chart"
        series={strategy.pnlSeries}
        baseValue={strategy.deployedCapital}
        compact
        height={82}
        positive={positive}
      />
    </div>
  );
}

export function HershyCanvasPreview({ strategy }: { strategy: Strategy }) {
  const graph = useMemo(() => getHershyCanvasGraph(strategy), [strategy]);

  return (
    <div className="hershy-canvas-shell" aria-label={`${strategy.title} Hershy Canvas`}>
      <NodeEditor
        key={strategy.id}
        initialGraph={graph}
        initialGraphVersion={strategy.pnlSeries.length + strategy.title.length}
        previewMode
      />
    </div>
  );
}
