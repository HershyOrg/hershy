import React, { memo } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";
import { Layers } from "lucide-react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

export interface HiddenGroupNodeData {
  hiddenNodes: any[];
  onRestoreNode?: (nodeId: string) => void;
}

export const HiddenGroupNode = memo(({ data, isConnectable }: NodeProps) => {
  const { hiddenNodes, onRestoreNode } = data as unknown as HiddenGroupNodeData;
  const count = hiddenNodes ? hiddenNodes.length : 0;

  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={isConnectable}
        className="opacity-0 pointer-events-none"
      />
      
      <HoverCard openDelay={200} closeDelay={100}>
        <HoverCardTrigger asChild>
          <div className="w-8 h-8 bg-white border-2 border-indigo-500 rounded-full flex items-center justify-center shadow-md cursor-pointer hover:bg-indigo-50 hover:scale-110 transition-all duration-200">
            <span className="text-[11px] font-bold text-indigo-600">{count}</span>
          </div>
        </HoverCardTrigger>
        <HoverCardContent className="w-64 p-3 bg-white/95 backdrop-blur-md shadow-xl border-slate-200 rounded-xl" side="bottom">
          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-100">
            <Layers className="w-4 h-4 text-indigo-500" />
            <span className="text-sm font-semibold text-slate-800">숨겨진 노드 ({count})</span>
          </div>
          <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto">
            {hiddenNodes?.map((n) => (
              <button
                key={n.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onRestoreNode?.(n.id);
                }}
                className="flex items-center justify-between p-2 rounded-md hover:bg-indigo-50 text-left transition-colors group"
                title="클릭하여 이 노드만 꺼내기"
              >
                <div className="flex flex-col w-full min-w-0">
                  <span className="text-xs font-medium text-slate-700 truncate">{n.data?.label || n.type}</span>
                  <span className="text-[10px] text-slate-400 group-hover:text-indigo-400">클릭하여 복구</span>
                </div>
              </button>
            ))}
            {count === 0 && (
              <span className="text-xs text-slate-500 italic p-1">숨겨진 노드가 없습니다.</span>
            )}
          </div>
        </HoverCardContent>
      </HoverCard>

      <Handle
        type="source"
        position={Position.Right}
        isConnectable={isConnectable}
        className="opacity-0 pointer-events-none"
      />
    </>
  );
});

HiddenGroupNode.displayName = "HiddenGroupNode";
