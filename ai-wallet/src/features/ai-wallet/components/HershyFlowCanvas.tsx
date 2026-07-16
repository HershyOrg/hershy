import { useMemo } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import type { GeneratedPlan, HershyGraphNode } from "@/features/ai-wallet/types/walletTypes";
import { formatUsd } from "@/features/ai-wallet/utils/formatters";
import { Activity, CheckCircle2, Play, Route, Search, ShieldCheck } from "@/shared/components/icons";
import { cn } from "@/shared/utils/utils";
import "@xyflow/react/dist/style.css";

type HershyFlowCanvasProps = {
  plan: GeneratedPlan | null;
  isExecuting: boolean;
  onExecute: () => void;
};

const nodeColorByKind: Record<HershyGraphNode["kind"], string> = {
  input: "#2775ca",
  rag: "#16a34a",
  plan: "#f6851b",
  guard: "#8b5cf6",
  execute: "#0f766e",
  settle: "#475569",
};

function createNodeLabel(node: HershyGraphNode) {
  return (
    <div className="flow-node-label">
      <div className="flow-node-label__top">
        <span className="flow-node-label__dot" style={{ backgroundColor: nodeColorByKind[node.kind] }} />
        <span>step</span>
      </div>
      <strong>{node.label}</strong>
      <p>{node.description}</p>
      <span className={cn("flow-node-label__status", `flow-node-label__status--${node.status}`)}>
        {node.status}
      </span>
    </div>
  );
}

export function HershyFlowCanvas({ plan, isExecuting, onExecute }: HershyFlowCanvasProps) {
  const nodes = useMemo<Node[]>(() => {
    if (!plan) return [];

    return plan.graph.nodes.map((node) => ({
      id: node.id,
      position: {
        x: node.x,
        y: node.y,
      },
      data: {
        label: createNodeLabel(node),
      },
      style: {
        width: 210,
        border: `1px solid ${nodeColorByKind[node.kind]}44`,
        borderRadius: 8,
        color: "#16171a",
        background: "#ffffff",
        boxShadow: "0 16px 32px rgba(22, 23, 26, 0.08)",
      },
    }));
  }, [plan]);

  const edges = useMemo<Edge[]>(() => {
    if (!plan) return [];

    return plan.graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      label: edge.label,
      animated: edge.to === "execute" && plan.approvalStatus !== "executed",
      markerEnd: {
        type: MarkerType.ArrowClosed,
      },
      style: {
        stroke: "#7c818c",
        strokeWidth: 1.8,
      },
      labelStyle: {
        fill: "#62666f",
        fontSize: 11,
        fontWeight: 600,
      },
    }));
  }, [plan]);

  if (!plan) {
    return (
      <section className="panel graph-panel graph-panel--empty">
        <Route size={30} />
        <p>아직 생성된 플랜이 없습니다.</p>
      </section>
    );
  }

  return (
    <section className="panel graph-panel" aria-label="Thirdeye workflow">
      <div className="panel__header graph-panel__header">
        <div>
          <p className="panel__eyebrow">Workflow</p>
          <h2>{plan.title}</h2>
        </div>
        <div className={cn("risk-chip", `risk-chip--${plan.riskLevel}`)}>
          <CheckCircle2 size={14} />
          <span>{plan.approvalStatus === "executed" ? "completed" : "ready"}</span>
        </div>
      </div>

      <div className="graph-summary">
        <div className="graph-summary__item">
          <ShieldCheck size={17} />
          <span>{plan.workflowActions?.map((action) => action.source).join(", ") ?? plan.allowedAction.protocol}</span>
        </div>
        <div className="graph-summary__item">
          <Search size={17} />
          <span>{plan.analysisSignals?.slice(0, 2).join(" · ") ?? "Options assembled"}</span>
        </div>
        <div className="graph-summary__item">
          <Activity size={17} />
          <span>{plan.totalLabel ?? plan.lockedAssets.map((asset) => formatUsd(asset.usdValue)).join(", ")}</span>
        </div>
      </div>

      <div className="flow-shell">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.42}
          maxZoom={1.4}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={28} color="#d6d9df" />
          <MiniMap pannable zoomable nodeStrokeWidth={3} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      <div className="action-contract">
        <div className="action-contract__main">
          <p className="panel__eyebrow">Proposed purchase</p>
          <h3>{plan.title}</h3>
          <p>{plan.summary}</p>
        </div>
        <div className="action-contract__meta">
          <div>
            <span>Source</span>
            <strong>{plan.workflowActions?.[0]?.source ?? "Thirdeye"}</strong>
          </div>
          <div>
            <span>Total</span>
            <strong>{plan.totalLabel ?? formatUsd(plan.lockedAssets.reduce((sum, asset) => sum + asset.usdValue, 0))}</strong>
          </div>
        </div>
      </div>

      <div className="parameter-grid">
        {(plan.workflowActions ?? []).map((action) => (
          <div className="parameter-grid__item" key={action.id}>
            <span>{action.timing}</span>
            <strong>{action.title}</strong>
          </div>
        ))}
      </div>

      <div className="execute-bar">
        <div>
          <p>승인된 예산</p>
          <strong>
            {plan.totalLabel ?? plan.lockedAssets.map((asset) => `${asset.symbol} ${formatUsd(asset.usdValue)}`).join(", ")}
          </strong>
        </div>
        <button type="button" className="primary-button" onClick={onExecute} disabled={isExecuting || plan.approvalStatus === "executed"}>
          {plan.approvalStatus === "executed" ? <CheckCircle2 size={18} /> : <Play size={18} />}
          <span>{plan.approvalStatus === "executed" ? "완료됨" : isExecuting ? "진행 중" : "구매 확정"}</span>
        </button>
      </div>
    </section>
  );
}
