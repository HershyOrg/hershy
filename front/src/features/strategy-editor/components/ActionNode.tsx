"use client";

import { memo, useCallback, useEffect, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { Handle, Position, NodeProps, useReactFlow, useEdges } from "@xyflow/react";
import type { ActionNodeData, CEXActionData, DEXActionData, BlockData } from "../types/editorTypes";
import { cn } from "@/shared/utils/utils";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import {
  encodeFunctionData,
  getAddress,
  parseAbi,
} from "viem";
import {
  BSC_CHAIN_ID,
  BSC_EXPLORER_URL,
  executeBscCall,
} from "@/features/scw-onboarding/utils/bscCallExecutor";
import {
  SUPPORTED_CEX_TRADE_EXCHANGES,
  isPolymarketExchangeName,
} from "@/shared/api/exchangeCatalog.mjs";
import {
  Maximize2, 
  Minimize2, 
  Plus, 
  X,
  Building2,
  Globe,
  CheckCircle2,
  ExternalLink,
  Loader2
} from "@/shared/components/icons";

const CEX_TIME_IN_FORCE_OPTIONS = [
  { value: "GTC", label: "GTC" },
  { value: "FAK", label: "FAK / IOC" },
  { value: "FOK", label: "FOK" },
] as const;

const BSC_USDT_TOKEN = getAddress("0x55d398326f99059fF775485246999027B3197955");
const BSC_ETH_TOKEN = getAddress("0x2170Ed0880ac9A755fd29B2688956BD959F933F8");
const BSC_UNISWAP_V3_ROUTER = getAddress("0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2");
const DEX_DEMO_AMOUNT = BigInt("1000000000000000000");
const BSC_ETH_USDT_POOL_FEE = 3000;

const UNISWAP_V3_ROUTER_ABI = parseAbi([
  "function exactInputSingle((address,address,uint24,address,uint256,uint256,uint160) params) payable returns (uint256 amountOut)",
]);

const actionLabelClass =
  "text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
const actionFieldClass =
  "nodrag nowheel mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:ring-1 focus:ring-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-600 dark:focus:border-slate-500 dark:focus:ring-slate-700";
const actionMonoFieldClass = cn(actionFieldClass, "font-mono");
const actionPanelClass =
  "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/70";
const actionCardClass =
  "border-slate-200 bg-white text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100";
const actionHandleClass =
  "advanced-port advanced-port--input !border-slate-500 !bg-slate-400 dark:!border-slate-400 dark:!bg-slate-500";
const actionOutputHandleClass =
  "advanced-port advanced-port--output !border-emerald-600 !bg-emerald-500 dark:!border-emerald-400 dark:!bg-emerald-500";
const actionTypeBadgeClass =
  "rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-black text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300";
const actionIconClass =
  "h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400";

function normalizeCEXTimeInForceValue(value: unknown): NonNullable<CEXActionData["timeInForce"]> {
  const text = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (text === "FOK") return "FOK";
  if (text === "FAK" || text === "IOC") return "FAK";
  return "GTC";
}

function bscTxUrl(hash: string) {
  return `${BSC_EXPLORER_URL}/tx/${hash}`;
}

function getDexExecutionErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/insufficient|fund|gas|balance/i.test(message)) {
    return `${message}\nBSC 실행 지갑에 BNB 가스가 필요합니다.`;
  }
  return message;
}

type ABIInput = {
  name?: string;
  type?: string;
  internalType?: string;
  components?: ABIInput[];
};

type ABIFunction = {
  type?: string;
  name?: string;
  inputs?: ABIInput[];
  stateMutability?: string;
};

function sanitizeParamId(value: string, fallback: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || fallback;
}

function createUniqueBlockId(prefix: string, blocks: Array<{ id?: string }>, seed = String(Date.now())) {
  const existingIds = new Set(blocks.map((block) => block.id).filter(Boolean));
  let id = `${prefix}-${seed}`;
  let attempt = 1;

  while (existingIds.has(id)) {
    id = `${prefix}-${seed}-${attempt}`;
    attempt += 1;
  }

  return id;
}

function parseABIText(value: unknown): ABIFunction[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is ABIFunction => Boolean(item && typeof item === "object"));
  }
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parseABIText(parsed);
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { abi?: unknown }).abi)) {
      return parseABIText((parsed as { abi?: unknown }).abi);
    }
  } catch {
    return [];
  }
  return [];
}

function parseFunctionSignature(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  const match = text.match(/^([A-Za-z_$][\w$]*)\s*\((.*)\)$/);
  if (!match) {
    return { name: text.replace(/\(.*/, "").trim(), types: [] as string[], signature: "" };
  }
  const types = match[2].trim()
    ? match[2].split(",").map((part) => part.trim()).filter(Boolean)
    : [];
  return { name: match[1], types, signature: `${match[1]}(${types.join(",")})` };
}

function getABIFunctionSignature(fn: ABIFunction) {
  const types = Array.isArray(fn.inputs) ? fn.inputs.map((input) => input.type || "unknown") : [];
  return `${fn.name || "function"}(${types.join(",")})`;
}

function findABIFunction(functionName: string, abiFunctions: ABIFunction[]) {
  const parsed = parseFunctionSignature(functionName);
  const targetName = parsed.name || functionName;
  const functionItems = abiFunctions.filter((item) => item.type === "function" && item.name);
  if (functionItems.length === 0) return null;

  const exactSignature = parsed.signature
    ? functionItems.find((item) => getABIFunctionSignature(item) === parsed.signature)
    : null;
  if (exactSignature) return exactSignature;

  return functionItems.find((item) => item.name === targetName) ?? functionItems[0] ?? null;
}

function buildSignatureInputs(functionName: string): ABIInput[] {
  const parsed = parseFunctionSignature(functionName);
  return parsed.types.map((type, index) => ({
    name: `param${index + 1}`,
    type,
  }));
}

function buildDEXParameterBlocks(functionName: string, abiText: unknown, currentBlocks: BlockData[]) {
  const abiFunctions = parseABIText(abiText);
  const abiFunction = findABIFunction(functionName, abiFunctions);
  const inputs = abiFunction?.inputs?.length ? abiFunction.inputs : buildSignatureInputs(functionName);
  if (!inputs.length) return { blocks: [] as BlockData[], method: abiFunction, abiFunctions };

  const currentByName = new Map(currentBlocks.map((block) => [block.name, block]));
  const nextBlocks = inputs.map((input, index) => {
    const paramName = input.name?.trim() || `param${index + 1}`;
    const abiType = input.type || input.internalType || "unknown";
    const existing = currentByName.get(paramName);
    return {
      ...(existing ?? {}),
      id: existing?.id ?? `abi-${index + 1}-${sanitizeParamId(paramName, `param-${index + 1}`)}`,
      name: paramName,
      description: abiType,
      type: "input" as const,
      abiType,
      autoGenerated: "abi",
    };
  });
  const generatedNames = new Set(nextBlocks.map((block) => block.name));
  const manualBlocks = currentBlocks.filter((block) =>
    block.autoGenerated !== "abi" && !generatedNames.has(block.name),
  );

  return { blocks: [...nextBlocks, ...manualBlocks], method: abiFunction, abiFunctions };
}

function getParameterBlockSignature(blocks: BlockData[]) {
  return blocks.map((block) =>
    [
      block.id,
      block.name,
      block.description ?? "",
      String(block.abiType ?? ""),
      String(block.autoGenerated ?? ""),
    ].join(":"),
  ).join("|");
}

function ActionNodeComponent({ id, data, selected }: NodeProps) {
  const typedData = data as ActionNodeData;
  const { authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const isCEX = typedData.actionType === "CEX";
  const cexData = typedData as CEXActionData;
  const dexData = typedData as DEXActionData;
  const primaryWallet = wallets[0] ?? null;
  const ownerAddress = primaryWallet?.address || user?.wallet?.address || "";
  const isPolymarketCEX = isCEX && isPolymarketExchangeName(cexData.exchange);
  const dexABIText = typeof dexData.contractAbi === "string"
    ? dexData.contractAbi
    : typeof dexData.abi === "string"
      ? dexData.abi
      : "";
  const dexFunctionSignature = parseFunctionSignature(dexData.functionName || "");
  const dexParameterInfo = isCEX
    ? { blocks: [] as BlockData[], method: null as ABIFunction | null, abiFunctions: [] as ABIFunction[] }
    : buildDEXParameterBlocks(dexData.functionName || "", dexABIText, typedData.inputBlocks ?? []);
  const dexFunctionOptions = dexParameterInfo.abiFunctions
    .filter((item) => item.type === "function" && item.name)
    .map((item) => ({
      name: item.name || "",
      signature: getABIFunctionSignature(item),
      stateMutability: item.stateMutability || "",
    }));
  const { setNodes, getNodes } = useReactFlow();
  const edges = useEdges();
  const [isExpanded, setIsExpanded] = useState(typedData.isExpanded || false);
  const [isDexExecuting, setIsDexExecuting] = useState(false);
  const [dexExecutionError, setDexExecutionError] = useState("");
  const primaryOutputBlock = typedData.outputBlocks[0];
  const runtimeCode = typeof typedData.runtimeCode === "string" ? typedData.runtimeCode : "";

  useEffect(() => {
    setIsExpanded(Boolean(typedData.isExpanded));
  }, [typedData.isExpanded]);

  useEffect(() => {
    if (isCEX || dexParameterInfo.blocks.length === 0) return;
    const currentBlocks = typedData.inputBlocks ?? [];
    if (getParameterBlockSignature(currentBlocks) === getParameterBlockSignature(dexParameterInfo.blocks)) return;

    const parsedSignature = parseFunctionSignature(dexData.functionName || "");
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                inputBlocks: dexParameterInfo.blocks,
                contractAbi: dexABIText,
                abi: dexABIText,
                evmFunctionName: dexParameterInfo.method?.name || parsedSignature.name,
                evmFunctionSignature: dexParameterInfo.method
                  ? getABIFunctionSignature(dexParameterInfo.method)
                  : parsedSignature.signature,
                evmFunctionStateMutability: dexParameterInfo.method?.stateMutability || "",
              },
            }
          : node,
      ),
    );
  }, [
    dexABIText,
    dexData.functionName,
    dexParameterInfo.blocks,
    dexParameterInfo.method,
    id,
    isCEX,
    setNodes,
    typedData.inputBlocks,
  ]);

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

  const handleFillDexAdapterExample = useCallback(() => {
    if (!ownerAddress) {
      setDexExecutionError("BSC swap 예시 calldata를 만들려면 먼저 SCW 지갑을 연결해야 합니다.");
      return;
    }

    const account = getAddress(ownerAddress);
    const swapCalldata = encodeFunctionData({
      abi: UNISWAP_V3_ROUTER_ABI,
      functionName: "exactInputSingle",
      args: [[
        BSC_USDT_TOKEN,
        BSC_ETH_TOKEN,
        BSC_ETH_USDT_POOL_FEE,
        account,
        DEX_DEMO_AMOUNT,
        BigInt(0),
        BigInt(0),
      ]],
    });

    handleUpdateFields({
      contractAddress: BSC_UNISWAP_V3_ROUTER,
      chainId: BSC_CHAIN_ID,
      functionName: "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
      calldata: swapCalldata,
      valueWei: "0",
    });
    setDexExecutionError("");
  }, [handleUpdateFields, ownerAddress]);

  const handleExecuteDexCall = useCallback(async () => {
    if (isCEX) return;
    if (!authenticated || !primaryWallet || !ownerAddress) {
      setDexExecutionError("먼저 사이드바에서 SCW 지갑을 연결해야 합니다.");
      return;
    }

    setIsDexExecuting(true);
    setDexExecutionError("");
    try {
      const result = await executeBscCall({
        wallet: primaryWallet,
        accountAddress: ownerAddress,
        to: dexData.contractAddress,
        data: dexData.calldata || "0x",
        valueWei: dexData.valueWei || "0",
      });
      handleUpdateFields({
        chainId: result.chainId,
        txHash: result.txHash,
        watchToken: result.watchToken,
      });
    } catch (error) {
      setDexExecutionError(getDexExecutionErrorMessage(error));
    } finally {
      setIsDexExecuting(false);
    }
  }, [
    authenticated,
    dexData.calldata,
    dexData.contractAddress,
    dexData.valueWei,
    handleUpdateFields,
    isCEX,
    ownerAddress,
    primaryWallet,
  ]);

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
          polymarketOrderType: normalizeCEXTimeInForceValue(cexData.polymarketOrderType || cexData.timeInForce),
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
        timeInForce: normalizeCEXTimeInForceValue(cexData.timeInForce || cexData.polymarketOrderType),
      });
    },
    [cexData.amount, cexData.chainId, cexData.polymarketOrderType, cexData.postOnly, cexData.price, cexData.side, cexData.size, cexData.timeInForce, cexData.tokenId, handleUpdateFields]
  );

  const handleDEXFunctionNameChange = useCallback(
    (functionName: string) => {
      const method = findABIFunction(functionName, parseABIText(dexABIText));
      const parsedSignature = parseFunctionSignature(functionName);
      handleUpdateFields({
        functionName,
        evmFunctionName: method?.name || parsedSignature.name,
        evmFunctionSignature: method ? getABIFunctionSignature(method) : parsedSignature.signature,
        evmFunctionStateMutability: method?.stateMutability || "",
      });
    },
    [dexABIText, handleUpdateFields],
  );

  const handleDEXABIChange = useCallback(
    (abiText: string) => {
      const method = findABIFunction(dexData.functionName || "", parseABIText(abiText));
      const parsedSignature = parseFunctionSignature(dexData.functionName || "");
      handleUpdateFields({
        abi: abiText,
        contractAbi: abiText,
        evmFunctionName: method?.name || parsedSignature.name,
        evmFunctionSignature: method ? getABIFunctionSignature(method) : parsedSignature.signature,
        evmFunctionStateMutability: method?.stateMutability || "",
      });
    },
    [dexData.functionName, handleUpdateFields],
  );

  const handleActionTypeChange = useCallback(
    (actionType: "CEX" | "DEX") => {
      if (typedData.actionType === actionType) return;

      if (actionType === "CEX") {
        const current = typedData as Partial<CEXActionData>;
        handleUpdateFields({
          actionType: "CEX",
          exchange: current.exchange || "Binance",
          symbol: current.symbol || "BTC/USDT",
          side: current.side || "BUY",
          orderType: current.orderType || "MARKET",
          timeInForce: normalizeCEXTimeInForceValue(current.timeInForce),
          amount: current.amount || "0.1",
          amountType: current.amountType || "FIXED",
        });
        return;
      }

      const current = typedData as Partial<DEXActionData>;
      handleUpdateFields({
        actionType: "DEX",
        contractAddress: current.contractAddress || "0x...",
        functionName: current.functionName || "swap()",
        chainId: current.chainId || 1,
        abi: current.abi || current.contractAbi || "",
        contractAbi: current.contractAbi || current.abi || "",
      });
    },
    [handleUpdateFields, typedData],
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
                  {
                    id: createUniqueBlockId("ib", (node.data as ActionNodeData).inputBlocks),
                    name: "param",
                    description: "",
                    type: "input" as const,
                  },
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
      } catch {
        console.error("Failed to parse dropped input block data");
      }
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const renderInputBlocks = () => {
    const inputBlocks = typedData.inputBlocks ?? [];
    return (
      <div className={cn(
        "grid gap-1 border-b p-2",
        actionPanelClass
      )}>
        <div className={cn(actionLabelClass, "mb-1")}>
          Input Blocks <span className="font-normal opacity-70">(blocks only)</span>
        </div>
        {inputBlocks.length === 0 ? (
          <div className="text-xs italic text-slate-400 dark:text-slate-500">
            No input parameters
          </div>
        ) : inputBlocks.map((block) => {
          const connectedInfos = getConnectedSourceInfo(block.id);
          const dragName = connectedInfos.length > 0 ? connectedInfos[0] ?? block.name : block.name;
          
          return (
            <div
              key={block.id}
              data-connect-target-node={id}
              data-connect-target-handle={`${id}-input-${block.id}-in`}
              className="nodrag group relative cursor-grab rounded-md border border-slate-200 bg-white px-2 py-1.5 shadow-sm active:cursor-grabbing dark:border-slate-700 dark:bg-slate-950"
              draggable
              onDragStart={(e) => handleDragStart(e, dragName)}
            >
              <Handle
                type="target"
                position={Position.Left}
                id={`${id}-input-${block.id}-in`}
                className={cn("!h-2 !w-2", actionHandleClass)}
                data-port-kind="input"
                style={{ left: -5 }}
              />
              <input
                type="text"
                value={block.name}
                onChange={(e) => handleBlockChange("input", block.id, { name: e.target.value })}
                className="w-full bg-transparent text-xs font-semibold text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-600"
                placeholder="Block name"
              />
              <input
                type="text"
                value={block.description ?? ""}
                onChange={(e) =>
                  handleBlockChange("input", block.id, { description: e.target.value })
                }
                className="mt-0.5 w-full bg-transparent text-[11px] text-slate-500 outline-none placeholder:text-slate-400 dark:text-slate-400 dark:placeholder:text-slate-600"
                placeholder="One-line block description"
              />
              {block.abiType ? (
                <div className="mt-1 inline-flex rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[9px] font-black text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  {String(block.abiType)}
                </div>
              ) : null}
              {!isCEX ? (
                <input
                  type="text"
                  value={typeof block.value === "string" || typeof block.value === "number" ? String(block.value) : ""}
                  onChange={(e) => handleBlockChange("input", block.id, { value: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-200 bg-slate-50 px-1.5 py-1 font-mono text-[10px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-600"
                  placeholder={`${block.name} value`}
                />
              ) : null}
              {block.connectedFrom ? (
                <div className="mt-1 truncate rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  {String(block.connectedFrom)}
                </div>
              ) : null}
              <button
                onClick={() => handleRemoveInputBlock(block.id)}
                className="absolute right-4 top-1.5 rounded p-0.5 text-rose-500 opacity-0 transition-colors hover:bg-rose-50 group-hover:opacity-100 dark:hover:bg-rose-400/10"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        <button
          onClick={handleAddInputBlock}
          className="mt-1 flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-slate-300 px-2 py-1 text-[10px] font-semibold text-slate-500 transition-colors hover:border-slate-400 hover:bg-white hover:text-slate-700 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-950 dark:hover:text-slate-200"
        >
          <Plus className="h-3 w-3" />
          Add Block
        </button>
      </div>
    );
  };

  // Collapsed View
  if (!isExpanded) {
    return (
      <div
        data-connect-target-node={id}
        data-connect-target-handle={`${id}-collapsed-in`}
        className={cn(
          "relative min-w-[184px] overflow-hidden rounded-md border shadow-sm transition-all",
          actionCardClass,
          selected && "border-slate-400 ring-2 ring-slate-200 dark:border-slate-500 dark:ring-slate-700"
        )}
      >
        <Handle
          type="target"
          position={Position.Left}
          id={`${id}-collapsed-in`}
          className="advanced-port advanced-port--node advanced-port--input"
          data-port-kind="node-input"
          style={{ top: "50%", left: -9 }}
        />
        <Handle
          type="source"
          position={Position.Right}
          id={`${id}-collapsed-out`}
          className="advanced-port advanced-port--node advanced-port--output"
          data-port-kind="node-output"
          style={{ top: "50%", right: -9 }}
        />

        {/* Hidden legacy handles keep old saved graphs readable without inviting node-level wiring. */}
        <Handle
          type="target"
          position={Position.Left}
          id={`${id}-func-in`}
          className={cn(
            "!w-2.5 !h-2.5",
            actionHandleClass
          )}
          data-port-kind="legacy-input"
          style={{ top: "50%", left: -5, opacity: 0, pointerEvents: "none" }}
        />
        {typedData.inputBlocks?.map((block, index) => (
          <Handle
            key={block.id}
            type="target"
            position={Position.Left}
            id={`${id}-input-${block.id}-in`}
            className={cn(
              "!h-2 !w-2 opacity-0",
              actionHandleClass
            )}
            data-port-kind="legacy-input"
            style={{
              top: `calc(50% + ${(index - (typedData.inputBlocks.length - 1) / 2) * 10}px)`,
              left: -5,
              pointerEvents: "none",
            }}
          />
        ))}

        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-1.5">
            {isCEX ? (
              <Building2 className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
            ) : (
              <Globe className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
            )}
            <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">Action</span>
            <span className={actionTypeBadgeClass}>
              {typedData.actionType}
            </span>
          </div>
          <button
            onClick={handleToggleExpand}
            className="rounded p-0.5 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <Maximize2 className="h-3 w-3" />
          </button>
        </div>

        {/* Function Name / Action Summary */}
        <div className="border-b border-slate-100 px-2.5 py-2 text-[11px] font-medium dark:border-slate-800">
          <textarea
            value={typedData.label}
            onChange={handleLabelChange}
            className="w-full resize-none border-none bg-transparent text-left font-semibold text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-600"
            rows={2}
            placeholder="Enter action description"
          />
        </div>

        {/* Output Block */}
        <div className="relative px-2 py-1.5 rounded-b-sm">
          <div className="text-[10px] font-semibold text-slate-700 dark:text-slate-300">
            {primaryOutputBlock?.name || "success"}
          </div>
          <div className="mt-0.5 min-h-[13px] text-[10px] text-slate-400 dark:text-slate-500">
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
                  actionOutputHandleClass
                )}
                data-port-kind="legacy-output"
                style={{ right: -5, opacity: 0, pointerEvents: "none" }}
              />
              <Handle
                type="source"
                position={Position.Right}
                id={`${id}-success-out`}
                className="!h-1 !w-1 !border-transparent !bg-transparent"
                data-port-kind="legacy-output"
                style={{ right: -5, pointerEvents: "none" }}
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
        "relative w-[420px] overflow-hidden rounded-md border shadow-xl transition-all",
        actionCardClass,
        selected && "border-slate-400 ring-2 ring-slate-200 dark:border-slate-500 dark:ring-slate-700"
      )}
    >
      {/* Hidden legacy node handle; expanded actions should wire through input blocks. */}
      <Handle
        type="target"
        position={Position.Left}
        id={`${id}-func-in`}
        className={cn(
          "!w-3 !h-3",
          actionHandleClass
        )}
        data-port-kind="legacy-input"
        style={{ top: 36, left: -6, opacity: 0, pointerEvents: "none" }}
      />
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex min-w-0 items-center gap-2">
          {isCEX ? (
            <Building2 className={actionIconClass} />
          ) : (
            <Globe className={actionIconClass} />
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">
              {typedData.label || "Action"}
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Execution block
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <div className="flex rounded-md border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-950">
            {(["DEX", "CEX"] as const).map((actionType) => (
              <button
                key={actionType}
                type="button"
                onClick={() => handleActionTypeChange(actionType)}
                className={cn(
                  "rounded px-2 py-0.5 text-[10px] font-black transition-colors",
                  typedData.actionType === actionType
                    ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100",
                )}
              >
                {actionType}
              </button>
            ))}
          </div>
          <button
            onClick={handleToggleExpand}
            className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <Minimize2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {renderInputBlocks()}

      {/* CEX Specific Fields */}
	      {isCEX && (
	        <div className="border-b border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
	          <div className="grid grid-cols-2 gap-2">
	            {/* Exchange */}
	            <div className={isPolymarketCEX ? "col-span-2" : ""}>
	              <label className={actionLabelClass}>Exchange</label>
	              <select
	                value={cexData.exchange}
	                onChange={(e) => handleCEXExchangeChange(e.target.value)}
	                className={actionFieldClass}
	              >
	                {SUPPORTED_CEX_TRADE_EXCHANGES.map((exchange) => (
	                  <option key={exchange.id} value={exchange.name}>{exchange.name}</option>
	                ))}
	              </select>
	            </div>
	
	            {!isPolymarketCEX && (
	              <div>
	                <label className={actionLabelClass}>Symbol</label>
	                <input
	                  type="text"
	                  value={cexData.symbol}
	                  onChange={(e) => handleUpdateField("symbol", e.target.value)}
	                  className={actionMonoFieldClass}
	                  placeholder="BTC/USDT"
	                />
	              </div>
	            )}
	          </div>

	          {isPolymarketCEX ? (
	            <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-900/70">
	              <div className="mb-2 flex items-center justify-between gap-2">
	                <span className={actionLabelClass}>Polymarket CLOB</span>
	                <span className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
	                  Chain {cexData.chainId || 137}
	                </span>
	              </div>
	              <div className="grid grid-cols-2 gap-2">
	                <div>
	                  <label className={actionLabelClass}>Market Label</label>
	                  <input
	                    type="text"
	                    value={cexData.polymarketMarketTitle || ""}
	                    onChange={(e) => handleUpdateField("polymarketMarketTitle", e.target.value)}
	                    className={actionFieldClass}
	                    placeholder="e.g. Fed 25bp Cut"
	                  />
	                </div>
	                <div>
	                  <label className={actionLabelClass}>Outcome</label>
	                  <input
	                    type="text"
	                    value={cexData.polymarketOutcomeLabel || ""}
	                    onChange={(e) => handleUpdateField("polymarketOutcomeLabel", e.target.value)}
	                    className={actionFieldClass}
	                    placeholder="YES"
	                  />
	                </div>
	                <div className="col-span-2">
	                  <label className={actionLabelClass}>Outcome Token ID</label>
	                  <input
	                    type="text"
	                    value={cexData.tokenId || ""}
	                    onChange={(e) => handleUpdateField("tokenId", e.target.value)}
	                    className={actionMonoFieldClass}
	                    placeholder="Polymarket token_id"
	                  />
	                </div>
	                <div>
	                  <label className={actionLabelClass}>Side</label>
	                  <div className="flex gap-1 mt-1">
	                    {(["BUY", "SELL"] as const).map((side) => (
	                      <button
	                        key={side}
	                        onClick={() => handleUpdateField("side", side)}
	                        className={cn(
	                          "flex-1 rounded-md border px-2 py-1.5 text-xs font-semibold transition-colors",
	                          cexData.side === side
	                            ? side === "BUY" ? "border-emerald-600 bg-emerald-600 text-white" : "border-rose-600 bg-rose-600 text-white"
	                            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
	                        )}
	                      >
	                        {side}
	                      </button>
	                    ))}
	                  </div>
	                </div>
	                <div>
	                  <label className={actionLabelClass}>Order Type</label>
	                  <select
	                    value={cexData.polymarketOrderType || "GTC"}
	                    onChange={(e) => handleUpdateField("polymarketOrderType", e.target.value)}
	                    className={actionFieldClass}
	                  >
	                    <option value="GTC">GTC</option>
	                    <option value="FAK">FAK</option>
	                    <option value="FOK">FOK</option>
	                  </select>
	                </div>
	                <div>
	                  <label className={actionLabelClass}>Price</label>
	                  <input
	                    type="number"
	                    min="0"
	                    max="1"
	                    step="0.01"
	                    value={cexData.price || ""}
	                    onChange={(e) => handleUpdateField("price", e.target.value)}
	                    className={actionMonoFieldClass}
	                    placeholder="0.52"
	                  />
	                </div>
	                <div>
	                  <label className={actionLabelClass}>Size</label>
	                  <input
	                    type="number"
	                    min="0"
	                    step="0.01"
	                    value={cexData.size || ""}
	                    onChange={(e) => handleUpdateField("size", e.target.value)}
	                    className={actionMonoFieldClass}
	                    placeholder="10"
	                  />
	                </div>
	                <div>
	                  <label className={actionLabelClass}>Post Only</label>
	                  <select
	                    value={String(cexData.postOnly ?? false)}
	                    onChange={(e) => handleUpdateField("postOnly", e.target.value === "true")}
	                    className={actionFieldClass}
	                  >
	                    <option value="false">Off</option>
	                    <option value="true">On</option>
	                  </select>
	                </div>
	                <div>
	                  <label className={actionLabelClass}>Chain ID</label>
	                  <input
	                    type="number"
	                    value={cexData.chainId || 137}
	                    onChange={(e) => handleUpdateField("chainId", parseInt(e.target.value, 10) || 137)}
	                    className={actionMonoFieldClass}
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
              <label className={cn(actionLabelClass, "flex items-center justify-between")}>
                Amount <span className="text-[8px] font-normal text-slate-400 dark:text-slate-500">(Drop block here)</span>
              </label>
              <div className="flex flex-col mt-1 gap-1">
                {(() => {
                  const val = (typedData as CEXActionData).amount;
                  if (typeof val === "string" && val.startsWith("{{") && val.endsWith("}}")) {
                    const varName = val.slice(2, -2);
                    return (
                      <div className="flex w-full items-center justify-between rounded-md border border-slate-200 bg-white px-2 py-1 shadow-inner dark:border-slate-700 dark:bg-slate-950">
                        <div className="flex max-w-[130px] items-center gap-1.5 truncate rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[10px] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                          <div className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-400 shadow-sm dark:bg-slate-500" />
                          <span className="truncate">{varName}</span>
                        </div>
                        <button
                          onClick={() => handleUpdateField("amount", "")}
                          className="rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-rose-500 dark:hover:bg-slate-900"
                          title="Remove block"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  }
                  return (
                    <input
                      type="text"
                      value={val}
                      onChange={(e) => handleUpdateField("amount", e.target.value)}
                      className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:ring-1 focus:ring-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-600 dark:focus:border-slate-500 dark:focus:ring-slate-700"
                      placeholder="e.g. 500 or Drop block"
                    />
                  );
                })()}
              </div>
            </div>
            
            {/* Side */}
            <div>
              <label className={actionLabelClass}>Side</label>
              <div className="flex gap-1 mt-1">
                <button
                  onClick={() => handleUpdateField("side", "BUY")}
                  className={cn(
                    "flex-1 rounded-md border px-2 py-1.5 text-xs font-semibold transition-colors",
                    (typedData as CEXActionData).side === "BUY"
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
                  )}
                >
                  BUY
                </button>
                <button
                  onClick={() => handleUpdateField("side", "SELL")}
                  className={cn(
                    "flex-1 rounded-md border px-2 py-1.5 text-xs font-semibold transition-colors",
                    (typedData as CEXActionData).side === "SELL"
                      ? "border-rose-600 bg-rose-600 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
                  )}
                >
                  SELL
                </button>
              </div>
            </div>

            {/* Order Type */}
            <div>
              <label className={actionLabelClass}>Order Type</label>
              <select
                value={(typedData as CEXActionData).orderType}
                onChange={(e) => handleUpdateField("orderType", e.target.value)}
                className={actionFieldClass}
              >
                <option value="MARKET">Market</option>
                <option value="LIMIT">Limit</option>
              </select>
            </div>

            {/* Fill Policy */}
            <div>
              <label className={actionLabelClass}>Fill Policy</label>
              <select
                value={normalizeCEXTimeInForceValue((typedData as CEXActionData).timeInForce)}
                onChange={(e) => handleUpdateField("timeInForce", e.target.value)}
                className={actionFieldClass}
              >
                {CEX_TIME_IN_FORCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            {/* Amount Type */}
            <div>
              <label className={actionLabelClass}>Amount Type</label>
              <select
                value={(typedData as CEXActionData).amountType}
                onChange={(e) => handleUpdateField("amountType", e.target.value)}
                className={actionFieldClass}
              >
                <option value="FIXED">Fixed</option>
                <option value="PERCENT">Percent (%)</option>
              </select>
            </div>

            {/* Price (for limit orders) */}
            {(typedData as CEXActionData).orderType === "LIMIT" && (
              <div className="col-span-2">
                <label className={actionLabelClass}>Limit Price</label>
                <input
                  type="text"
                  value={(typedData as CEXActionData).price || ""}
                  onChange={(e) => handleUpdateField("price", e.target.value)}
                  className={actionMonoFieldClass}
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
        <div className="border-b border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
          <div className="space-y-2">
            {/* Contract Address */}
            <div>
              <label className={actionLabelClass}>Contract Address / to</label>
              <input
                type="text"
                value={(typedData as DEXActionData).contractAddress}
                onChange={(e) => handleUpdateField("contractAddress", e.target.value)}
                className={actionMonoFieldClass}
                placeholder="0x..."
              />
            </div>

            {/* Function Name */}
            <div>
              <label className={actionLabelClass}>Function Name</label>
              <input
                type="text"
                value={(typedData as DEXActionData).functionName}
                onChange={(e) => handleDEXFunctionNameChange(e.target.value)}
                className={actionMonoFieldClass}
                placeholder="swap(address,uint256)"
              />
            </div>

            {dexFunctionOptions.length > 0 ? (
              <div>
                <label className={actionLabelClass}>ABI Function</label>
                <select
                  value={dexParameterInfo.method ? getABIFunctionSignature(dexParameterInfo.method) : dexFunctionSignature.signature}
                  onChange={(event) => handleDEXFunctionNameChange(event.target.value)}
                  className={actionMonoFieldClass}
                >
                  {dexFunctionOptions.map((option) => (
                    <option key={option.signature} value={option.signature}>
                      {option.signature}{option.stateMutability ? ` · ${option.stateMutability}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div>
              <label className={actionLabelClass}>Contract ABI</label>
              <textarea
                value={dexABIText}
                onChange={(event) => handleDEXABIChange(event.target.value)}
                className="nodrag nowheel mt-1 min-h-[76px] w-full resize-y rounded-md border border-slate-200 bg-white px-2 py-1.5 font-mono text-[10px] leading-4 text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:ring-1 focus:ring-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-600 dark:focus:border-slate-500 dark:focus:ring-slate-700"
                placeholder='[{"type":"function","name":"swap","inputs":[...]}]'
              />
              {dexParameterInfo.blocks.length > 0 ? (
                <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  <span className="truncate">
                    {dexParameterInfo.method
                      ? `${getABIFunctionSignature(dexParameterInfo.method)}`
                      : `${dexData.functionName || "function"} signature`}
                  </span>
                  <span className="shrink-0 rounded border border-slate-200 bg-white px-1.5 py-0.5 font-black dark:border-slate-700 dark:bg-slate-950">
                    params {dexParameterInfo.blocks.length}
                  </span>
                </div>
              ) : null}
            </div>

            {/* Chain ID */}
            <div>
              <label className={actionLabelClass}>Chain</label>
              <select
                value={(typedData as DEXActionData).chainId}
                onChange={(e) => handleUpdateField("chainId", parseInt(e.target.value))}
                className={actionFieldClass}
              >
                <option value={56}>BSC (56)</option>
                <option value={1}>Ethereum (1)</option>
                <option value={137}>Polygon (137)</option>
                <option value={42161}>Arbitrum (42161)</option>
                <option value={10}>Optimism (10)</option>
                <option value={8453}>Base (8453)</option>
              </select>
            </div>

            <div className="rounded border border-cyan-200 bg-cyan-50/80 p-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-wide text-cyan-700">
                    BSC Call
                  </div>
                  <div className="text-[10px] font-semibold text-cyan-500">
                    Watch 입력값은 이 DEX 블록에서 관리합니다.
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-white px-2 py-0.5 font-mono text-[10px] font-black text-cyan-700">
                  {BSC_CHAIN_ID}
                </span>
              </div>

              <div>
                <label className="text-[10px] font-semibold text-cyan-700 uppercase">calldata / data</label>
                <textarea
                  value={dexData.calldata || ""}
                  onChange={(event) => handleUpdateField("calldata", event.target.value)}
                  className="nodrag nowheel mt-1 min-h-[76px] w-full resize-y rounded border border-cyan-200 bg-white px-2 py-1.5 font-mono text-[10px] leading-4 text-cyan-950 outline-none focus:ring-1 focus:ring-cyan-400"
                  placeholder="0x encoded calldata"
                />
              </div>

              <div className="mt-2">
                <label className="text-[10px] font-semibold text-cyan-700 uppercase">valueWei</label>
                <input
                  type="text"
                  value={dexData.valueWei || "0"}
                  onChange={(event) => handleUpdateField("valueWei", event.target.value)}
                  className="w-full mt-1 px-2 py-1.5 text-xs bg-white border border-cyan-200 rounded focus:outline-none focus:ring-1 focus:ring-cyan-400 font-mono"
                  placeholder="0"
                />
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleFillDexAdapterExample}
                  disabled={isDexExecuting}
                  className="rounded border border-cyan-300 bg-white px-2 py-1.5 text-[10px] font-bold text-cyan-700 transition-colors hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  BSC swap 예시
                </button>
                <button
                  type="button"
                  onClick={() => void handleExecuteDexCall()}
                  disabled={isDexExecuting}
                  className="inline-flex items-center justify-center gap-1 rounded bg-cyan-600 px-2 py-1.5 text-[10px] font-black text-white transition-colors hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isDexExecuting ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                  실행
                </button>
              </div>

              {dexData.txHash ? (
                <a
                  href={bscTxUrl(dexData.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 flex items-center justify-between gap-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[10px] leading-4 text-emerald-700 hover:bg-emerald-100"
                >
                  <span className="font-bold">txHash / watchToken</span>
                  <span className="inline-flex min-w-0 items-center gap-1 font-mono">
                    <span className="truncate">{dexData.watchToken || dexData.txHash}</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </span>
                </a>
              ) : null}

              {dexExecutionError ? (
                <div className="mt-2 whitespace-pre-wrap rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] leading-4 text-rose-700">
                  {dexExecutionError}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Output Section */}
      <div className="bg-white p-3 dark:bg-slate-950">
        <div className={cn(actionLabelClass, "mb-2")}>
          Output (Return Value)
        </div>
        <div className="space-y-2">
          {typedData.outputBlocks.map((block, index) => (
            <div
              key={block.id}
              className="relative rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/70"
            >
              <input
                type="text"
                value={block.name}
                onChange={(e) => handleBlockChange("output", block.id, { name: e.target.value })}
                className="w-full bg-transparent text-xs font-semibold text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-600"
                placeholder="Block name"
              />
              <input
                type="text"
                value={block.description ?? ""}
                onChange={(e) =>
                  handleBlockChange("output", block.id, { description: e.target.value })
                }
                className="mt-0.5 w-full bg-transparent text-[11px] text-slate-500 outline-none placeholder:text-slate-400 dark:text-slate-400 dark:placeholder:text-slate-600"
                placeholder="One-line block description"
              />
              <Handle
                type="source"
                position={Position.Right}
                id={`${id}-block-${block.id}-out`}
                className={cn(
                  "!w-3 !h-3",
                  actionOutputHandleClass
                )}
                data-port-kind="output"
                style={{ right: -10 }}
              />
              {index === 0 ? (
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`${id}-success-out`}
                  className="!h-1 !w-1 !border-transparent !bg-transparent"
                  data-port-kind="legacy-output"
                  style={{ right: -10, pointerEvents: "none" }}
                />
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {runtimeCode ? (
        <div className="border-t border-slate-200 bg-slate-950 p-3 dark:border-slate-800">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            generated_strategy.go
          </div>
          <pre className="max-h-32 overflow-auto rounded-md border border-slate-800 bg-black/30 p-2 text-[10px] leading-4 text-slate-100">
            {runtimeCode}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

export const ActionNode = memo(ActionNodeComponent);
