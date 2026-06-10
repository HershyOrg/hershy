import { memo, useCallback } from "react";
import { Handle, NodeProps, Position } from "@xyflow/react";
import type { BlockData } from "../types/editorTypes";
import { cn } from "@/shared/utils/utils";

const NODE_WIDTH = 96;

function ConditionJunctionNodeComponent({ id, data }: NodeProps) {
  const record = data as Record<string, unknown>;
  const inputBlocks = Array.isArray((data as { inputBlocks?: unknown }).inputBlocks)
    ? ((data as { inputBlocks: BlockData[] }).inputBlocks)
    : [
      { id: "range-1", name: "A", type: "input" as const },
      { id: "range-2", name: "B", type: "input" as const },
    ];
  const height = Math.max(72, 24 + inputBlocks.length * 32);
  const centerY = height / 2;
  const mode = record.mode === "OR" ? "OR" : "AND";
  const isPassthrough = inputBlocks.length <= 1 || record.passthrough === true;
  const title = typeof record.conditionExpression === "string"
    ? record.conditionExpression
    : inputBlocks.map((block) => block.description || block.name).join(` ${mode} `);

  const handleToggleMode = useCallback(() => {
    if (isPassthrough) return;
    window.dispatchEvent(
      new CustomEvent("conditionJunctionModeChange", {
        detail: {
          nodeId: id,
          mode: mode === "OR" ? "AND" : "OR",
        },
      }),
    );
  }, [id, isPassthrough, mode]);

  return (
    <div
      className={cn(
        "relative rounded-md border bg-[#181a20] shadow-[0_8px_22px_rgba(0,0,0,0.35)]",
        mode === "OR" ? "border-[#f0b90b]" : "border-[#5e6673]",
      )}
      style={{ width: NODE_WIDTH, height }}
      title={title}
    >
      {inputBlocks.map((block, index) => {
        const y = inputBlocks.length <= 1
          ? centerY
          : 16 + index * ((height - 32) / Math.max(inputBlocks.length - 1, 1));

        return (
          <div key={block.id}>
            <Handle
              type="target"
              position={Position.Left}
              id={`${id}-input-${block.id}-in`}
              className="!h-2.5 !w-2.5 !border-[#0b0e11] !bg-[#fcd535]"
              style={{ left: -5, top: y }}
            />
            <div
              className="pointer-events-none absolute left-2 max-w-[36px] -translate-y-1/2 truncate text-[9px] font-semibold uppercase leading-none text-[#848e9c]"
              style={{ top: y }}
            >
              {block.name}
            </div>
          </div>
        );
      })}
      <Handle
        type="target"
        position={Position.Left}
        id={`${id}-input-append-in`}
        className="!h-2 !w-2 !border-[#0b0e11] !bg-[#848e9c]"
        style={{ left: -4, top: height - 8, opacity: 0 }}
      />
      <button
        type="button"
        className={cn(
          "nodrag nopan absolute left-1/2 top-1/2 flex h-9 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-sm border text-[11px] font-black tracking-wide transition-colors",
          isPassthrough
            ? "cursor-default border-[#2b3139] bg-[#2b3139] text-[#b7bdc6]"
            : mode === "OR"
              ? "border-[#f0b90b] bg-[#2a2110] text-[#fcd535] hover:bg-[#3a2d12]"
              : "border-[#5e6673] bg-[#0b0e11] text-[#eaecef] hover:bg-[#1f2329]",
        )}
        onClick={handleToggleMode}
        aria-label={isPassthrough ? "Condition passthrough" : `Toggle ${mode} condition operator`}
      >
        {isPassthrough ? "PASS" : mode}
      </button>
      <Handle
        type="source"
        position={Position.Right}
        id={`${id}-condition-out`}
        className="!h-2.5 !w-2.5 !border-[#0b0e11] !bg-[#0ecb81]"
        style={{ right: -5, top: centerY }}
      />
    </div>
  );
}

export const ConditionJunctionNode = memo(ConditionJunctionNodeComponent);
