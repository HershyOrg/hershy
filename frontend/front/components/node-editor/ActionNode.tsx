"use client";

import { memo, useCallback, useEffect, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { Handle, Position, NodeProps, useReactFlow, useEdges } from "@xyflow/react";
import type { ActionNodeData, CEXActionData, DEXActionData, BlockData } from "./types";
import { cn } from "@/lib/utils";
import {
  SUPPORTED_CEX_TRADE_EXCHANGES,
  isPolymarketExchangeName,
} from "@/src/lib/exchangeCatalog.mjs";
import {
  Maximize2, 
  Minimize2, 
  Plus, 
  X,
  Building2,
  Globe
} from "lucide-react";

function ActionNodeComponent({ id, data, selected }: NodeProps) {
  const typedData = data as ActionNodeData;
  const isCEX = typedData.actionType === "CEX";
  const cexData = typedData as CEXActionData;
  const isPolymarketCEX = isCEX && isPolymarketExchangeName(cexData.exchange);
  const { setNodes, getNodes } = useReactFlow();
  const edges = useEdges();
  const [isExpanded, setIsExpanded] = useState(typedData.isExpanded || false);
  const primaryOutputBlock = typedData.outputBlocks[0];
  const runtimeCode = typeof typedData.runtimeCode === "string" ? typedData.runtimeCode : "";

  useEffect(() => {
    setIsExpanded(Boolean(typedData.isExpanded));
  }, [typedData.isExpanded]);

  // Get connected source info for input blocks
  const getConnectedSourceInfo = useCallback(
    (blockId: string) => {
      const allNodes = getNodes();
      const connectedEdges = edges.filter(
        (edge) => edge.target === id && edge.targetHandle?.includes(blockId)
      );

      return connectedEdges.map((edge) => {
        const sourceNode = allNodes.find((n) => n.id === edge.source);
        if (!sourceNode) return null;

        const sourceLabel =
          (sourceNode.data as { label?: string; functionName?: string })?.label ||
          (sourceNode.data as { label?: string; functionName?: string })?.functionName ||
          sourceNode.id;

        const blockId = edge.sourceHandle?.match(/-block-(.+)-out$/)?.[1];
        const sourceBlocks = (sourceNode.data as { outputBlocks?: BlockData[] })?.outputBlocks ?? [];
        const blockName = sourceBlocks.find((block) => block.id === blockId)?.name || blockId || "out";

        return `${sourceLabel}.${blockName}`;
      }).filter(Boolean);
    },
    [edges, getNodes, id]
  );

  const handleToggleExpand = useCallback(() => {
    const newExpanded = !isExpanded;
    setIsExpanded(newExpanded);

    window.dispatchEvent(
      new CustomEvent("nodeFocus", {
        detail: { nodeId: newExpanded ? id : null },
      })
    );

    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, isExpanded: newExpanded } }
          : node
      )
    );
  }, [id, isExpanded, setNodes]);

  const handleLabelChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, label: e.target.value } } : node
        )
      );
    },
    [id, setNodes]
  );

  const handleUpdateField = useCallback(
    (field: string, value: string | number | boolean) => {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? { ...node, data: { ...node.data, [field]: value } }
            : node
        )
      );
    },
    [id, setNodes]
  );

  const handleUpdateFields = useCallback(
    (patch: Record<string, string | number | boolean>) => {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? { ...node, data: { ...node.data, ...patch } }
            : node
        )
      );
    },
    [id, setNodes]
  );

  const handleCEXExchangeChange = useCallback(
    (exchange: string) => {
      if (isPolymarketExchangeName(exchange)) {
        const postOnly = typeof cexData.postOnly === "boolean"
          ? cexData.postOnly
          : String(cexData.postOnly || "").toLowerCase() === "true";
        handleUpdateFields({
          exchange,
          dexProtocol: "polymarket",
          executionMode: "api",
          apiUrl: "https://clob.polymarket.com",
          chainId: cexData.chainId || 137,
          side: cexData.side || "BUY",
          polymarketOrderType: cexData.polymarketOrderType || "GTC",
          postOnly,
          tokenId: cexData.tokenId || "",
          price: cexData.price || "",
          size: cexData.size || cexData.amount || "",
        });
        return;
      }

      handleUpdateFields({
        exchange,
        dexProtocol: "generic",
        executionMode: "address",
        apiUrl: "",
      });
    },
    [cexData.amount, cexData.chainId, cexData.polymarketOrderType, cexData.postOnly, cexData.price, cexData.side, cexData.size, cexData.tokenId, handleUpdateFields]
  );

  const handleAddInputBlock = useCallback(() => {
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                inputBlocks: [
                  ...(node.data as ActionNodeData).inputBlocks,
                  { id: `ib-${Date.now()}`, name: "param", description: "", type: "input" as const },
                ],
              },
            }
          : node
      )
    );
  }, [id, setNodes]);

  const handleRemoveInputBlock = useCallback(
    (blockId: string) => {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  inputBlocks: (node.data as ActionNodeData).inputBlocks.filter(
                    (b: BlockData) => b.id !== blockId
                  ),
                },
              }
            : node
        )
      );
    },
    [id, setNodes]
  );

  const handleBlockChange = useCallback(
    (blockType: "input" | "output", blockId: string, patch: Partial<BlockData>) => {
      const key = blockType === "input" ? "inputBlocks" : "outputBlocks";
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  [key]: ((node.data as ActionNodeData)[key] as BlockData[]).map((block) =>
                    block.id === blockId ? { ...block, ...patch } : block
                  ),
                },
              }
            : node
        )
      );
    },
    [id, setNodes]
  );



  const handleDragStart = (e: DragEvent, sourceInfo: string) => {
    e.dataTransfer.setData("application/json", JSON.stringify({ type: "INPUT_BLOCK", name: sourceInfo }));
    e.dataTransfer.effectAllowed = "copy";
  };

  const handleDropOnField = (e: DragEvent, fieldName: string) => {
    e.preventDefault();
    const dataStr = e.dataTransfer.getData("application/json");
    if (dataStr) {
      try {
        const payload = JSON.parse(dataStr);
        if (payload.type === "INPUT_BLOCK") {
          handleUpdateField(fieldName, `{{${payload.name}}}`);
        }
      } catch (err) {
        console.error("Failed to parse dropped input block data");
      }
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const renderInputBlocks = () => {
    if (!typedData.inputBlocks || typedData.inputBlocks.length === 0) return null;
    return (
      <div className={cn(
        "p-2 border-b grid gap-1",
        isCEX ? "border-amber-200 bg-amber-50/50" : "border-cyan-200 bg-cyan-50/50"
      )}>
        <div className={cn(
          "text-[10px] font-semibold uppercase mb-1",
          isCEX ? "text-amber-700" : "text-cyan-700"
        )}>Input Blocks</div>
        {typedData.inputBlocks.map((block) => {
          const connectedInfos = getConnectedSourceInfo(block.id);
          const dragName = connectedInfos.length > 0 ? connectedInfos[0] ?? block.name : block.name;
          
          return (
            <div
              key={block.id}
              data-connect-target-node={id}
              data-connect-target-handle={`${id}-input-${block.id}-in`}
              className="nodrag relative group px-2 py-1.5 bg-white border border-gray-200 rounded shadow-sm cursor-grab active:cursor-grabbing"
              draggable
              onDragStart={(e) => handleDragStart(e, dragName)}
            >
              <Handle
                type="target"
                position={Position.Left}
                id={`${id}-input-${block.id}-in`}
                className="!w-2 !h-2 !bg-blue-400 !border-blue-500"
                style={{ left: -5 }}
              />
              <input
                type="text"
                value={block.name}
                onChange={(e) => handleBlockChange("input", block.id, { name: e.target.value })}
                className="w-full bg-transparent text-xs font-semibold text-blue-800 outline-none placeholder:text-blue-300"
                placeholder="블록 이름"
              />
              <input
                type="text"
                value={block.description ?? ""}
                onChange={(e) =>
                  handleBlockChange("input", block.id, { description: e.target.value })
                }
                className="mt-0.5 w-full bg-transparent text-[11px] text-blue-500 outline-none placeholder:text-blue-300"
                placeholder="블록 설명 한 줄"
              />
              {block.connectedFrom ? (
                <div className="mt-1 truncate rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                  {String(block.connectedFrom)}
                </div>
              ) : null}
              <button
                onClick={() => handleRemoveInputBlock(block.id)}
                className="absolute right-4 top-1.5 opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-50 rounded"
              >
                <X className="w-3 h-3 text-red-500" />
              </button>
            </div>
          );
        })}
        <button
          onClick={handleAddInputBlock}
          className={cn(
            "w-full mt-1 px-2 py-1 text-[10px] flex items-center justify-center gap-1 rounded border border-dashed transition-colors",
            isCEX 
              ? "text-amber-600 border-amber-300 hover:bg-amber-100" 
              : "text-cyan-600 border-cyan-300 hover:bg-cyan-100"
          )}
        >
          <Plus className="w-3 h-3" />
          Add Input Block
        </button>
      </div>
    );
  };

  // Collapsed View
  if (!isExpanded) {
    return (
      <div
        className={cn(
          "min-w-[160px] border-2 rounded-md shadow-sm transition-all",
          isCEX ? "bg-amber-50 border-amber-400" : "bg-cyan-50 border-cyan-400",
          selected && (isCEX ? "border-amber-500 ring-2 ring-amber-200" : "border-cyan-500 ring-2 ring-cyan-200")
        )}
      >
        {/* Input Handle */}
        <Handle
          type="target"
          position={Position.Left}
          id={`${id}-func-in`}
          className={cn(
            "!w-2.5 !h-2.5",
            isCEX ? "!bg-amber-400 !border-amber-500" : "!bg-cyan-400 !border-cyan-500"
          )}
          style={{ top: "50%", left: -5 }}
        />
        {typedData.inputBlocks?.map((block, index) => (
          <Handle
            key={block.id}
            type="target"
            position={Position.Left}
            id={`${id}-input-${block.id}-in`}
            className={cn(
              "!h-2 !w-2 opacity-0",
              isCEX ? "!border-amber-500 !bg-amber-400" : "!border-cyan-500 !bg-cyan-400"
            )}
            style={{
              top: `calc(50% + ${(index - (typedData.inputBlocks.length - 1) / 2) * 10}px)`,
              left: -5,
            }}
          />
        ))}

        {/* Header */}
        <div className={cn(
          "flex items-center justify-between gap-2 px-2 py-1.5 rounded-t-sm",
          isCEX ? "bg-amber-500" : "bg-cyan-500"
        )}>
          <div className="flex items-center gap-1.5">
            {isCEX ? (
              <Building2 className="w-3.5 h-3.5 text-white" />
            ) : (
              <Globe className="w-3.5 h-3.5 text-white" />
            )}
            <span className="text-xs font-semibold text-white">{isCEX ? "CEX" : "DEX"}</span>
          </div>
          <button
            onClick={handleToggleExpand}
            className={cn(
              "p-0.5 rounded transition-colors",
              isCEX ? "hover:bg-amber-600" : "hover:bg-cyan-600"
            )}
          >
            <Maximize2 className="w-3 h-3 text-white" />
          </button>
        </div>

        {/* Function Name / Action Summary */}
        <div className={cn(
          "px-2 py-1.5 text-[11px] font-medium border-b",
          isCEX ? "text-amber-900 border-amber-200 bg-amber-100/50" : "text-cyan-900 border-cyan-200 bg-cyan-100/50"
        )}>
          <textarea
            value={typedData.label}
            onChange={handleLabelChange}
            className="w-full bg-transparent border-none text-center resize-none focus:outline-none placeholder:text-gray-400"
            rows={2}
            placeholder="동작 설명 입력"
          />
        </div>

        {/* Output Block */}
        <div className="relative px-2 py-1.5 rounded-b-sm">
          <div className={cn(
            "text-[10px] font-semibold",
            isCEX ? "text-amber-700" : "text-cyan-700"
          )}>
            {primaryOutputBlock?.name || "success"}
          </div>
          <div className={cn(
            "mt-0.5 min-h-[13px] text-[10px]",
            isCEX ? "text-amber-500" : "text-cyan-500"
          )}>
            {primaryOutputBlock?.description || ""}
          </div>
          {primaryOutputBlock ? (
            <>
              <Handle
                type="source"
                position={Position.Right}
                id={`${id}-block-${primaryOutputBlock.id}-out`}
                className={cn(
                  "!w-2.5 !h-2.5",
                  isCEX ? "!bg-amber-500 !border-amber-600" : "!bg-cyan-500 !border-cyan-600"
                )}
                style={{ right: -5 }}
              />
              <Handle
                type="source"
                position={Position.Right}
                id={`${id}-success-out`}
                className="!h-1 !w-1 !border-transparent !bg-transparent"
                style={{ right: -5 }}
              />
            </>
          ) : null}
        </div>
      </div>
    );
  }

  // Expanded View
  return (
    <div
      className={cn(
        "w-[420px] border-2 rounded-lg shadow-xl transition-all ring-4",
        isCEX 
          ? "bg-amber-50 border-amber-400 ring-amber-300/50" 
          : "bg-cyan-50 border-cyan-400 ring-cyan-300/50",
        selected && (isCEX ? "border-amber-500" : "border-cyan-500")
      )}
    >
      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Left}
        id={`${id}-func-in`}
        className={cn(
          "!w-3 !h-3",
          isCEX ? "!bg-amber-400 !border-amber-500" : "!bg-cyan-400 !border-cyan-500"
        )}
        style={{ top: 36, left: -6 }}
      />

      {/* Header */}
      <div className={cn(
        "flex items-center justify-between gap-2 px-3 py-2 rounded-t-md",
        isCEX ? "bg-amber-500" : "bg-cyan-500"
      )}>
        <div className="flex items-center gap-2">
          {isCEX ? (
            <Building2 className="w-4 h-4 text-white" />
          ) : (
            <Globe className="w-4 h-4 text-white" />
          )}
          <span className="text-sm font-bold text-white">
            {isCEX ? "CEX Trade" : "DEX Trade"} - {typedData.label}
          </span>
        </div>
        <button
          onClick={handleToggleExpand}
          className={cn(
            "p-1 rounded transition-colors",
            isCEX ? "hover:bg-amber-600" : "hover:bg-cyan-600"
          )}
        >
          <Minimize2 className="w-4 h-4 text-white" />
        </button>
      </div>

      {renderInputBlocks()}

      {/* CEX Specific Fields */}
	      {isCEX && (
	        <div className="p-3 border-b border-amber-200">
	          <div className="grid grid-cols-2 gap-2">
	            {/* Exchange */}
	            <div className={isPolymarketCEX ? "col-span-2" : ""}>
	              <label className="text-[10px] font-semibold text-amber-700 uppercase">Exchange</label>
	              <select
	                value={cexData.exchange}
	                onChange={(e) => handleCEXExchangeChange(e.target.value)}
	                className="w-full mt-1 px-2 py-1.5 text-xs bg-white border border-amber-200 rounded focus:outline-none focus:ring-1 focus:ring-amber-400"
	              >
	                {SUPPORTED_CEX_TRADE_EXCHANGES.map((exchange) => (
	                  <option key={exchange.id} value={exchange.name}>{exchange.name}</option>
	                ))}
	              </select>
	            </div>
	
	            {!isPolymarketCEX && (
	              <div>
	                <label className="text-[10px] font-semibold text-amber-700 uppercase">Symbol</label>
	                <input
	                  type="text"
	                  value={cexData.symbol}
	                  onChange={(e) => handleUpdateField("symbol", e.target.value)}
	                  className="w-full mt-1 px-2 py-1.5 text-xs bg-white border border-amber-200 rounded focus:outline-none focus:ring-1 focus:ring-amber-400 font-mono"
	                  placeholder="BTC/USDT"
	                />
	              </div>
	            )}
	          </div>

	          {isPolymarketCEX ? (
	            <div className="mt-2 rounded border border-cyan-200 bg-cyan-50/80 p-2">
	              <div className="mb-2 flex items-center justify-between gap-2">
	                <span className="text-[10px] font-bold uppercase tracking-wide text-cyan-700">Polymarket CLOB</span>
	                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-cyan-700">
	                  Chain {cexData.chainId || 137}
	                </span>
	              </div>
	              <div className="grid grid-cols-2 gap-2">
	                <div>
	                  <label className="text-[10px] font-semibold text-cyan-700 uppercase">Market Label</label>
	                  <input
	                    type="text"
	                    value={cexData.polymarketMarketTitle || ""}
	                    onChange={(e) => handleUpdateField("polymarketMarketTitle", e.target.value)}
	                    className="w-full mt-1 px-2 py-1.5 text-xs bg-white border border-cyan-200 rounded focus:outline-none focus:ring-1 focus:ring-cyan-400"
	                    placeholder="e.g. Fed 25bp Cut"
	                  />
	                </div>
	                <div>
	                  <label className="text-[10px] font-semibold text-cyan-700 uppercase">Outcome</label>
	                  <input
	                    type="text"
	                    value={cexData.polymarketOutcomeLabel || ""}
	                    onChange={(e) => handleUpdateField("polymarketOutcomeLabel", e.target.value)}
	                    className="w-full mt-1 px-2 py-1.5 text-xs bg-white border border-cyan-200 rounded focus:outline-none focus:ring-1 focus:ring-cyan-400"
	                    placeholder="YES"
	                  />
	                </div>
	                <div className="col-span-2">
	                  <label className="text-[10px] font-semibold text-cyan-700 uppercase">Outcome Token ID</label>
	                  <input
	                    type="text"
	                    value={cexData.tokenId || ""}
	                    onChange={(e) => handleUpdateField("tokenId", e.target.value)}
	                    className="w-full mt-1 px-2 py-1.5 text-xs bg-white border border-cyan-200 rounded focus:outline-none focus:ring-1 focus:ring-cyan-400 font-mono"
	                    placeholder="Polymarket token_id"
	                  />
	                </div>
	                <div>
	                  <label className="text-[10px] font-semibold text-cyan-700 uppercase">Side</label>
	                  <div className="flex gap-1 mt-1">
	                    {(["BUY", "SELL"] as const).map((side) => (
	                      <button
	                        key={side}
	                        onClick={() => handleUpdateField("side", side)}
	                        className={cn(
	                          "flex-1 px-2 py-1.5 text-xs font-semibold rounded transition-colors",
	                          cexData.side === side
	                            ? side === "BUY" ? "bg-green-500 text-white" : "bg-red-500 text-white"
	                            : "bg-white border border-cyan-200 text-cyan-700 hover:bg-cyan-100"
	                        )}
	                      >
	                        {side}
	                      </button>
	                    ))}
	                  </div>
	                </div>
	                <div>
	                  <label className="text-[10px] font-semibold text-cyan-700 uppercase">Order Type</label>
	                  <select
	                    value={cexData.polymarketOrderType || "GTC"}
	                    onChange={(e) => handleUpdateField("polymarketOrderType", e.target.value)}
	                    className="w-full mt-1 px-2 py-1.5 text-xs bg-white border border-cyan-200 rounded focus:outline-none focus:ring-1 focus:ring-cyan-400"
	                  >
	                    <option value="GTC">GTC</option>
	                    <option value="FAK">FAK</option>
	                    <option value="FOK">FOK</option>
	                  </select>
	                </div>
	                <div>
	                  <label className="text-[10px] font-semibold text-cyan-700 uppercase">Price</label>
	                  <input
	                    type="number"
	                    min="0"
	                    max="1"
	                    step="0.01"
	                    value={cexData.price || ""}
	                    onChange={(e) => handleUpdateField("price", e.target.value)}
	                    className="w-full mt-1 px-2 py-1.5 text-xs bg-white border border-cyan-200 rounded focus:outline-none focus:ring-1 focus:ring-cyan-400 font-mono"
	                    placeholder="0.52"
	                  />
	                </div>
	                <div>
	                  <label className="text-[10px] font-semibold text-cyan-700 uppercase">Size</label>
	                  <input
	                    type="number"
	                    min="0"
	                    step="0.01"
	                    value={cexData.size || ""}
	                    onChange={(e) => handleUpdateField("size", e.target.value)}
	                    className="w-full mt-1 px-2 py-1.5 text-xs bg-white border border-cyan-200 rounded focus:outline-none focus:ring-1 focus:ring-cyan-400 font-mono"
	                    placeholder="10"
	                  />
	                </div>
	                <div>
	                  <label className="text-[10px] font-semibold text-cyan-700 uppercase">Post Only</label>
	                  <select
	                    value={String(cexData.postOnly ?? false)}
	                    onChange={(e) => handleUpdateField("postOnly", e.target.value === "true")}
	                    className="w-full mt-1 px-2 py-1.5 text-xs bg-white border border-cyan-200 rounded focus:outline-none focus:ring-1 focus:ring-cyan-400"
	                  >
	                    <option value="false">Off</option>
	                    <option value="true">On</option>
	                  </select>
	                </div>
	                <div>
	                  <label className="text-[10px] font-semibold text-cyan-700 uppercase">Chain ID</label>
	                  <input
	                    type="number"
	                    value={cexData.chainId || 137}
	                    onChange={(e) => handleUpdateField("chainId", parseInt(e.target.value, 10) || 137)}
	                    className="w-full mt-1 px-2 py-1.5 text-xs bg-white border border-cyan-200 rounded focus:outline-none focus:ring-1 focus:ring-cyan-400 font-mono"
	                    placeholder="137"
	                  />
	                </div>
	              </div>
	            </div>
	          ) : (
	          <div className="grid grid-cols-2 gap-2 mt-2">
	            {/* Amount with Drag and Drop Support */}
	            <div 
              onDragOver={handleDragOver}
              onDrop={(e) => handleDropOnField(e, "amount")}
            >
              <label className="text-[10px] font-semibold text-amber-700 uppercase flex items-center justify-between">
                Amount <span className="text-[8px] text-amber-500 font-normal">(Drop block here)</span>
              </label>
              <div className="flex flex-col mt-1 gap-1">
                {(() => {
                  const val = (typedData as CEXActionData).amount;
                  if (typeof val === "string" && val.startsWith("{{") && val.endsWith("}}")) {
                    const varName = val.slice(2, -2);
                    return (
                      <div className="flex items-center justify-between w-full px-2 py-1 bg-white border border-amber-300 rounded shadow-inner">
                        <div className="flex items-center gap-1.5 bg-amber-100 text-amber-900 border border-amber-200 px-2 py-0.5 rounded font-mono text-[10px] truncate max-w-[130px]">
                          <div className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0 shadow-sm" />
                          <span className="truncate">{varName}</span>
                        </div>
                        <button
                          onClick={() => handleUpdateField("amount", "")}
                          className="p-0.5 hover:bg-amber-100 rounded text-amber-500 transition-colors"
                          title="Remove block"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  }
                  return (
                    <input
                      type="text"
                      value={val}
                      onChange={(e) => handleUpdateField("amount", e.target.value)}
                      className="w-full px-2 py-1.5 text-xs bg-white border border-amber-200 rounded focus:outline-none focus:ring-1 focus:ring-amber-400 font-mono"
                      placeholder="e.g. 500 or Drop block"
                    />
                  );
                })()}
              </div>
            </div>
            
            {/* Side */}
            <div>
              <label className="text-[10px] font-semibold text-amber-700 uppercase">Side</label>
              <div className="flex gap-1 mt-1">
                <button
                  onClick={() => handleUpdateField("side", "BUY")}
                  className={cn(
                    "flex-1 px-2 py-1.5 text-xs font-semibold rounded transition-colors",
                    (typedData as CEXActionData).side === "BUY"
                      ? "bg-green-500 text-white"
                      : "bg-white border border-amber-200 text-amber-600 hover:bg-green-50"
                  )}
                >
                  BUY
                </button>
                <button
                  onClick={() => handleUpdateField("side", "SELL")}
                  className={cn(
                    "flex-1 px-2 py-1.5 text-xs font-semibold rounded transition-colors",
                    (typedData as CEXActionData).side === "SELL"
                      ? "bg-red-500 text-white"
                      : "bg-white border border-amber-200 text-amber-600 hover:bg-red-50"
                  )}
                >
                  SELL
                </button>
              </div>
            </div>

            {/* Order Type */}
            <div>
              <label className="text-[10px] font-semibold text-amber-700 uppercase">Order Type</label>
              <select
                value={(typedData as CEXActionData).orderType}
                onChange={(e) => handleUpdateField("orderType", e.target.value)}
                className="w-full mt-1 px-2 py-1.5 text-xs bg-white border border-amber-200 rounded focus:outline-none focus:ring-1 focus:ring-amber-400"
              >
                <option value="MARKET">Market</option>
                <option value="LIMIT">Limit</option>
              </select>
            </div>

            {/* Amount Type */}
            <div>
              <label className="text-[10px] font-semibold text-amber-700 uppercase">Amount Type</label>
              <select
                value={(typedData as CEXActionData).amountType}
                onChange={(e) => handleUpdateField("amountType", e.target.value)}
                className="w-full mt-1 px-2 py-1.5 text-xs bg-white border border-amber-200 rounded focus:outline-none focus:ring-1 focus:ring-amber-400"
              >
                <option value="FIXED">Fixed</option>
                <option value="PERCENT">Percent (%)</option>
              </select>
            </div>

            {/* Price (for limit orders) */}
            {(typedData as CEXActionData).orderType === "LIMIT" && (
              <div className="col-span-2">
                <label className="text-[10px] font-semibold text-amber-700 uppercase">Limit Price</label>
                <input
                  type="text"
                  value={(typedData as CEXActionData).price || ""}
                  onChange={(e) => handleUpdateField("price", e.target.value)}
                  className="w-full mt-1 px-2 py-1.5 text-xs bg-white border border-amber-200 rounded focus:outline-none focus:ring-1 focus:ring-amber-400 font-mono"
                  placeholder="50000"
                />
	              </div>
	            )}
	          </div>
	          )}
	        </div>
	      )}

      {/* DEX Specific Fields */}
      {!isCEX && (
        <div className="p-3 border-b border-cyan-200">
          <div className="space-y-2">
            {/* Contract Address */}
            <div>
              <label className="text-[10px] font-semibold text-cyan-700 uppercase">Contract Address</label>
              <input
                type="text"
                value={(typedData as DEXActionData).contractAddress}
                onChange={(e) => handleUpdateField("contractAddress", e.target.value)}
                className="w-full mt-1 px-2 py-1.5 text-xs bg-white border border-cyan-200 rounded focus:outline-none focus:ring-1 focus:ring-cyan-400 font-mono"
                placeholder="0x..."
              />
            </div>

            {/* Function Name */}
            <div>
              <label className="text-[10px] font-semibold text-cyan-700 uppercase">Function Name</label>
              <input
                type="text"
                value={(typedData as DEXActionData).functionName}
                onChange={(e) => handleUpdateField("functionName", e.target.value)}
                className="w-full mt-1 px-2 py-1.5 text-xs bg-white border border-cyan-200 rounded focus:outline-none focus:ring-1 focus:ring-cyan-400 font-mono"
                placeholder="swap()"
              />
            </div>

            {/* Chain ID */}
            <div>
              <label className="text-[10px] font-semibold text-cyan-700 uppercase">Chain</label>
              <select
                value={(typedData as DEXActionData).chainId}
                onChange={(e) => handleUpdateField("chainId", parseInt(e.target.value))}
                className="w-full mt-1 px-2 py-1.5 text-xs bg-white border border-cyan-200 rounded focus:outline-none focus:ring-1 focus:ring-cyan-400"
              >
                <option value={1}>Ethereum (1)</option>
                <option value={56}>BSC (56)</option>
                <option value={137}>Polygon (137)</option>
                <option value={42161}>Arbitrum (42161)</option>
                <option value={10}>Optimism (10)</option>
                <option value={8453}>Base (8453)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Input Parameters Section */}
      <div className={cn(
        "p-3 border-b",
        isCEX ? "border-amber-200 bg-amber-100/50" : "border-cyan-200 bg-cyan-100/50"
      )}>
        <div className={cn(
          "text-[10px] font-semibold mb-2 uppercase tracking-wide",
          isCEX ? "text-amber-700" : "text-cyan-700"
        )}>
          Input Blocks <span className="font-normal opacity-70">(blocks only)</span>
        </div>
        <div className="space-y-1.5">
          {typedData.inputBlocks.length === 0 ? (
            <div className={cn(
              "text-xs italic",
              isCEX ? "text-amber-400" : "text-cyan-400"
            )}>
              No input parameters
            </div>
          ) : (
            typedData.inputBlocks.map((block) => {
              return (
                <div
                  key={block.id}
                  data-connect-target-node={id}
                  data-connect-target-handle={`${id}-input-${block.id}-in`}
                  className="relative group bg-white rounded px-2 py-1.5 border border-current"
                  style={{ borderColor: isCEX ? "#fbbf24" : "#22d3ee" }}
                >
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={`${id}-input-${block.id}-in`}
                    className={cn(
                      "!w-2 !h-2",
                      isCEX ? "!bg-amber-400 !border-amber-500" : "!bg-cyan-400 !border-cyan-500"
                    )}
                    style={{ left: -9 }}
                  />
                  <input
                    type="text"
                    value={block.name}
                    onChange={(e) => handleBlockChange("input", block.id, { name: e.target.value })}
                    className={cn(
                      "w-full bg-transparent text-xs font-semibold outline-none placeholder:text-gray-400",
                      isCEX 
                        ? "text-amber-800"
                        : "text-cyan-800"
                    )}
                    placeholder="블록 이름"
                  />
                  <input
                    type="text"
                    value={block.description ?? ""}
                    onChange={(e) =>
                      handleBlockChange("input", block.id, { description: e.target.value })
                    }
                    className={cn(
                      "mt-0.5 w-full bg-transparent text-[11px] outline-none placeholder:text-gray-400",
                      isCEX ? "text-amber-600" : "text-cyan-600"
                    )}
                    placeholder="블록 설명 한 줄"
                  />
                  {block.connectedFrom ? (
                    <div className={cn(
                      "mt-1 truncate rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold",
                      isCEX ? "text-amber-700" : "text-cyan-700"
                    )}>
                      {String(block.connectedFrom)}
                    </div>
                  ) : null}
                  <button
                    onClick={() => handleRemoveInputBlock(block.id)}
                    className="absolute right-4 top-1.5 opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-50 rounded transition-opacity"
                  >
                    <X className="w-3 h-3 text-red-500" />
                  </button>
                </div>
              );
            })
          )}
          <button
            onClick={handleAddInputBlock}
            className={cn(
              "w-full px-2 py-1 text-[10px] flex items-center justify-center gap-1 rounded border border-dashed transition-colors",
              isCEX 
                ? "text-amber-600 hover:text-amber-700 hover:bg-amber-100 border-amber-300" 
                : "text-cyan-600 hover:text-cyan-700 hover:bg-cyan-100 border-cyan-300"
            )}
          >
            <Plus className="w-3 h-3" />
            Add Block
          </button>
        </div>
      </div>

      {/* Output Section */}
      <div className="p-3">
        <div className={cn(
          "text-[10px] font-semibold mb-2 uppercase tracking-wide",
          isCEX ? "text-amber-700" : "text-cyan-700"
        )}>
          Output (반환값)
        </div>
        <div className="space-y-2">
          {typedData.outputBlocks.map((block, index) => (
            <div
              key={block.id}
              className={cn(
                "relative rounded px-3 py-2 border",
                isCEX ? "bg-amber-100 border-amber-300" : "bg-cyan-100 border-cyan-300"
              )}
            >
              <input
                type="text"
                value={block.name}
                onChange={(e) => handleBlockChange("output", block.id, { name: e.target.value })}
                className={cn(
                  "w-full bg-transparent text-xs font-semibold outline-none placeholder:text-gray-400",
                  isCEX ? "text-amber-800" : "text-cyan-800"
                )}
                placeholder="블록 이름"
              />
              <input
                type="text"
                value={block.description ?? ""}
                onChange={(e) =>
                  handleBlockChange("output", block.id, { description: e.target.value })
                }
                className={cn(
                  "mt-0.5 w-full bg-transparent text-[11px] outline-none placeholder:text-gray-400",
                  isCEX ? "text-amber-600" : "text-cyan-600"
                )}
                placeholder="블록 설명 한 줄"
              />
              <Handle
                type="source"
                position={Position.Right}
                id={`${id}-block-${block.id}-out`}
                className={cn(
                  "!w-3 !h-3",
                  isCEX ? "!bg-amber-500 !border-amber-600" : "!bg-cyan-500 !border-cyan-600"
                )}
                style={{ right: -10 }}
              />
              {index === 0 ? (
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`${id}-success-out`}
                  className="!h-1 !w-1 !border-transparent !bg-transparent"
                  style={{ right: -10 }}
                />
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {runtimeCode ? (
        <div className={cn("border-t p-3", isCEX ? "border-amber-200 bg-amber-950" : "border-cyan-200 bg-cyan-950")}>
          <div className={cn("mb-1 text-[10px] font-semibold uppercase", isCEX ? "text-amber-200" : "text-cyan-200")}>
            generated_strategy.go
          </div>
          <pre className="max-h-32 overflow-auto rounded bg-black/30 p-2 text-[10px] leading-4 text-slate-100">
            {runtimeCode}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

export const ActionNode = memo(ActionNodeComponent);
