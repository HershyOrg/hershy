import React, { memo } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";
import { Layers } from "lucide-react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { HistorySnapshot } from "@/lib/historyStore";

export interface HiddenHistoryGroupNodeData {
  snapshots: HistorySnapshot[];
  onRestore: (snapshotId: string) => void;
}

export const HiddenHistoryGroupNode = memo(({ data, isConnectable }: NodeProps) => {
  const { snapshots, onRestore } = data as unknown as HiddenHistoryGroupNodeData;
  const count = snapshots ? snapshots.length : 0;

  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={isConnectable}
        className="!left-[-12px] !top-1/2 !h-4 !w-4 !-translate-y-1/2 !border-[3px] !border-white !bg-slate-300 !shadow-md opacity-20 pointer-events-none"
      />
      
      <HoverCard openDelay={200} closeDelay={100}>
        <HoverCardTrigger asChild>
          <div className="w-12 h-12 bg-white border-[3px] border-indigo-500 rounded-full flex flex-col items-center justify-center shadow-[0_12px_32px_rgba(79,70,229,0.18)] cursor-pointer hover:bg-indigo-50 hover:scale-110 transition-all duration-200 group">
            <Layers className="w-4 h-4 text-indigo-400 group-hover:text-indigo-600 mb-0.5" />
            <span className="text-[11px] font-bold text-indigo-600 leading-none">{count}</span>
          </div>
        </HoverCardTrigger>
        <HoverCardContent className="w-64 p-3 bg-white/95 backdrop-blur-md shadow-xl border-slate-200 rounded-xl" side="bottom">
          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-100">
            <Layers className="w-4 h-4 text-indigo-500" />
            <span className="text-sm font-semibold text-slate-800">숨겨진 버전 ({count})</span>
          </div>
          <div className="flex flex-col gap-1 max-h-[240px] overflow-y-auto">
            {snapshots?.map((s) => (
              <button
                key={s.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onRestore?.(s.id);
                }}
                className="flex items-center justify-between p-2 rounded-md hover:bg-indigo-50 text-left transition-colors group"
                title="클릭하여 이 버전만 압축 해제하기"
              >
                <div className="flex flex-col w-full min-w-0">
                  <span className="text-xs font-medium text-slate-700 truncate">{s.name}</span>
                  <span className="text-[10px] text-slate-400 group-hover:text-indigo-400 mt-1">클릭하여 복구</span>
                </div>
              </button>
            ))}
          </div>
        </HoverCardContent>
      </HoverCard>

      <Handle
        type="source"
        position={Position.Right}
        isConnectable={isConnectable}
        className="!right-[-12px] !top-1/2 !h-4 !w-4 !-translate-y-1/2 !border-[3px] !border-white !bg-slate-300 !shadow-md opacity-20 pointer-events-none"
      />
    </>
  );
});

HiddenHistoryGroupNode.displayName = "HiddenHistoryGroupNode";
