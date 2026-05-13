"use client";

import { useEffect } from "react";
import { GitBranch, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFSM, FSM_STATE_LABELS, FSM_STATE_STYLES, type FSMState } from "./FSMContext";

const ALL_STATES: FSMState[] = ["IDLE", "ACTIVE", "REBALANCING", "CLOSED"];

export function FSMSimulationPanel() {
  const { currentState, setCurrentState, showFSMEdges, setShowFSMEdges } = useFSM();
  const s = FSM_STATE_STYLES[currentState];

  // Auto-revert REBALANCING to ACTIVE after 2.5s (simulate execution time)
  useEffect(() => {
    if (currentState === "REBALANCING") {
      const t = setTimeout(() => setCurrentState("ACTIVE"), 2500);
      return () => clearTimeout(t);
    }
  }, [currentState, setCurrentState]);

  return (
    <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700 rounded-xl shadow-2xl p-3 w-52 select-none">
      {/* Header */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <GitBranch className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs font-bold text-slate-200">FSM 시뮬레이션</span>
        </div>
        <button
          onClick={() => setShowFSMEdges(!showFSMEdges)}
          className="p-1 hover:bg-slate-700 rounded transition-colors"
          title={showFSMEdges ? "관계도 숨기기" : "관계도 보기"}
        >
          {showFSMEdges
            ? <Eye className="w-3.5 h-3.5 text-slate-400" />
            : <EyeOff className="w-3.5 h-3.5 text-slate-600" />
          }
        </button>
      </div>

      {/* Current State Badge */}
      <div className={cn("flex items-center gap-2 px-2.5 py-2 rounded-lg border mb-2.5", s.bg, s.border)}>
        <span className="relative flex h-2 w-2 shrink-0">
          <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", s.dot)} />
          <span className={cn("relative inline-flex rounded-full h-2 w-2", s.dot)} />
        </span>
        <span className={cn("text-xs font-semibold", s.text)}>
          {currentState} — {FSM_STATE_LABELS[currentState]}
        </span>
      </div>

      {/* State Selector Buttons */}
      <div className="grid grid-cols-2 gap-1">
        {ALL_STATES.map((state) => {
          const style = FSM_STATE_STYLES[state];
          const isActive = currentState === state;
          return (
            <button
              key={state}
              onClick={() => setCurrentState(state)}
              className={cn(
                "text-[10px] font-bold py-1.5 px-2 rounded-lg border transition-all",
                isActive
                  ? cn(style.bg, style.text, style.border, "ring-1 ring-offset-1 ring-offset-slate-900", style.border)
                  : "bg-slate-800/60 text-slate-500 border-slate-700 hover:bg-slate-700 hover:text-slate-200 hover:border-slate-500"
              )}
            >
              {state}
            </button>
          );
        })}
      </div>

      <p className="text-[9px] text-slate-600 mt-2 text-center">
        상태 클릭 시 시퀀스 활성/비활성 변경
      </p>
    </div>
  );
}
