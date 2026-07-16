import React, { useState, useEffect } from "react";
import { useReactFlow } from "@xyflow/react";
import { Info, X, Edit2, Check, Sparkles } from "@/shared/components/icons";

// Generate different explanations for group sequences and individual nodes.
// Tailored for a v2 delta-neutral yield farming domain.
const generateMockExplanation = (label: string = "", isGroup: boolean) => {
  const lowerLabel = label.toLowerCase();
  
  // 1. Group or strategy explanation.
  if (isGroup) {
    if (lowerLabel.includes("liquidity") || lowerLabel.includes("lp") || lowerLabel.includes("supply") || lowerLabel.includes("v2")) {
      return "This sequence interacts with a DEX v2 router to deposit an asset pair into a liquidity pool and generate fee-based target APR as the base return pipeline.";
    }
    if (lowerLabel.includes("hedge") || lowerLabel.includes("short")) {
      return "This sequence is a delta-neutral hedging pipeline that offsets primary asset price movement and impermanent-loss risk during LP supply.\n\nUsing oracle data, it opens an exchange short sized to the supplied volatile asset exposure, keeping the yield farming zone stable regardless of price direction.";
    }
    if (lowerLabel.includes("rebalancing") || lowerLabel.includes("rebalance") || lowerLabel.includes("adjust")) {
      return "This sequence manages delta rebalancing whenever asset price changes skew the pool ratio.\n\nIt automatically increases or decreases short position size to keep exposure close to neutral.";
    }
    if (lowerLabel.includes("farm") || lowerLabel.includes("yield") || lowerLabel.includes("reward")) {
      return "This farming pipeline stakes received LP tokens into additional farms to earn protocol reward or governance tokens.";
    }
    return `This sequence manages «${label}» inside the broader yield farming architecture.\n\nIt owns a complete DeFi logic flow from trigger handling through on-chain transaction execution and hedge management.`;
  }

  // 2. Individual node explanation.
  if (lowerLabel.includes("swap") || lowerLabel.includes("exchange")) {
    return `This node handles token-ratio alignment through an on-chain swap.\n\nBefore adding 50:50 liquidity to a v2 pool, it asks the smart contract to convert excess assets into the target asset.`;
  }
  if (lowerLabel.includes("supply") || lowerLabel.includes("mint") || lowerLabel.includes("add") || lowerLabel.includes("deposit")) {
    return `This node performs the add-liquidity action.\n\nIt calls the DEX smart contract, deposits tokens into the on-chain pool, and receives LP tokens as proof of the position.`;
  }
  if (lowerLabel.includes("short") || lowerLabel.includes("sell") || lowerLabel.includes("cex")) {
    return `This node places the defensive order that offsets volatility.\n\nThrough the exchange API, it opens a market short sized to match the volatile on-chain asset exposure.`;
  }
  if (lowerLabel.includes("trigger") || lowerLabel.includes("condition") || lowerLabel.includes("if") || lowerLabel.includes("price") || lowerLabel.includes("ratio")) {
    return `This node monitors on-chain and off-chain data to control entry.\n\nIt checks whether pool ratio, spread, or funding conditions meet the threshold for starting or closing the target APR strategy.`;
  }
  if (lowerLabel.includes("monitor") || lowerLabel.includes("pnl") || lowerLabel.includes("profit")) {
    return `This node monitors overall delta exposure and farm health.\n\nIt tracks short-position margin, liquidation risk, and accumulated fee revenue, then activates rebalancing when thresholds break.`;
  }
  
  return `This node processes data and routes on-chain or off-chain communication.\n\nIt calculates wallet capital, pool state, and related upstream data, then passes the flow to the correct contract call or API action.`;
};

export function withExplanation(WrappedComponent: React.ComponentType<any>) {
  function ExplanationWrapper(props: any) {
    const { id, selected, data, type } = props;
    const { setNodes } = useReactFlow();
    const [manualShow, setManualShow] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editText, setEditText] = useState("");

    // Reset manually opened popups when node focus is cleared.
    useEffect(() => {
      if (!selected) {
        setManualShow(false);
        setIsEditing(false);
      }
    }, [selected]);

    // Detect group nodes, which represent strategies or sequences.
    const isGroup = type === "groupNode";
    
    // Popup behavior:
    // group nodes show immediately on selection;
    // individual nodes show a button first and open only after that button is clicked.
    const showPopup = isGroup ? selected : (selected && manualShow);

    // label for title
    const label = data?.label || data?.functionName || data?.name || "This item";
    // explanation text depending on node type & label keywords
    const explanation = data?.explanation || generateMockExplanation(label, isGroup);

    const handleSave = (e: React.MouseEvent) => {
      e.stopPropagation();
      setNodes((nds) => 
        nds.map((n) => 
          n.id === id ? { ...n, data: { ...n.data, explanation: editText } } : n
        )
      );
      setIsEditing(false);
    };

    const handleAiSummary = (e: React.MouseEvent) => {
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent("aiExplainGroup", { detail: { groupId: id, label } }));
    };

    return (
      <>
        <WrappedComponent {...props} />

        {/* 1. Info button for individual nodes only. */}
        {selected && !isGroup && !manualShow && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setManualShow(true);
            }}
            className="absolute -top-3 -right-3 z-[110] p-1.5 bg-blue-500 text-white rounded-full shadow-md hover:bg-blue-600 transition-colors pointer-events-auto"
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        )}

        {/* 2. Popover panel. */}
        {showPopup && (
          <div className="absolute top-1/2 left-full z-[120] w-[340px] -translate-y-1/2 translate-x-4 cursor-default rounded-xl border border-slate-200/80 bg-white/95 p-4 text-sm shadow-xl backdrop-blur-sm pointer-events-auto nodrag nowheel dark:border-slate-700/80 dark:bg-slate-950/95 dark:shadow-[0_18px_48px_rgba(0,0,0,0.42)]">
            <div className="absolute top-1/2 -left-2 -translate-y-1/2 border-y-[6px] border-r-[8px] border-y-transparent border-r-white dark:border-r-slate-950" />
            
            <div className="flex items-center justify-between mb-2">
              <h4 className="max-w-[140px] truncate rounded-md bg-indigo-50 px-2 py-1 text-xs font-bold text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-200">
                {isGroup ? `[Sequence] ${label}` : `[Node] ${label}`}
              </h4>
              <div className="flex items-center gap-1">
                {isGroup && !isEditing && (
                  <button
                    onClick={handleAiSummary}
                    className="flex items-center gap-1 rounded bg-indigo-100 px-1.5 py-1 text-[10px] text-indigo-600 transition-colors hover:bg-indigo-200 dark:bg-indigo-400/10 dark:text-indigo-200 dark:hover:bg-indigo-400/20"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>AI Summary</span>
                  </button>
                )}
                {!isEditing && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditText(explanation);
                      setIsEditing(true);
                    }}
                    className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                )}
                {isEditing && (
                  <button
                    onClick={handleSave}
                    className="rounded p-1 text-green-500 transition-colors hover:bg-green-50 hover:text-green-700 dark:text-green-300 dark:hover:bg-green-400/10 dark:hover:text-green-200"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                )}
                {/* Individual nodes can close the popup manually. */}
                {!isGroup && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setManualShow(false);
                      setIsEditing(false);
                    }}
                    className="ml-1 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            
            {isEditing ? (
              <textarea 
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="h-32 w-full resize-none rounded border border-slate-300 p-2 text-[13px] focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-indigo-400"
                autoFocus
              />
            ) : (
              <p className="flex flex-col gap-2 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-600 word-break dark:text-slate-300">
                {explanation}
              </p>
            )}
          </div>
        )}
      </>
    );
  }

  ExplanationWrapper.displayName = `WithExplanation(${WrappedComponent.displayName || WrappedComponent.name || "Node"})`;
  return React.memo(ExplanationWrapper);
}
