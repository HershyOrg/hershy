"use client";

import { memo, useCallback } from "react";
import type { ChangeEvent } from "react";
import { Handle, Position, NodeProps, useReactFlow } from "@xyflow/react";
import type { StreamingNodeData, BlockData, NodeChartPoint } from "./types";
import { MetricChart } from "./MetricChart";
import { cn } from "@/lib/utils";
import { Activity, Globe2, Maximize2, Minimize2, Plus, X } from "lucide-react";

function StreamingNodeComponent({
  id,
  data,
  selected,
}: NodeProps<import("@xyflow/react").Node<StreamingNodeData>>) {
  const { setNodes } = useReactFlow();
  const outputBlocks = data.outputBlocks ?? [];
  const isCompact = data.isExpanded === false;
  const chartSeries = Array.isArray(data.chartSeries)
    ? (data.chartSeries as NodeChartPoint[])
      .map((point) => ({ time: point.time as any, value: point.value }))
      .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value))
    : [];
  const chartSource = typeof data.chartSource === "string" ? data.chartSource : "";
  const chartWarning = typeof data.chartWarning === "string" ? data.chartWarning : "";
  const runtimeCode = typeof data.runtimeCode === "string" ? data.runtimeCode : "";

  const updateNodeData = useCallback(
    (nextData: Partial<StreamingNodeData>) => {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, ...nextData } } : node
        )
      );
    },
    [id, setNodes]
  );

  const handleToggleActive = useCallback(() => {
    updateNodeData({ isActive: !data.isActive });
  }, [data.isActive, updateNodeData]);

  const handleToggleCompact = useCallback(() => {
    updateNodeData({ isExpanded: isCompact });
  }, [isCompact, updateNodeData]);

  const handleLabelChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      updateNodeData({ label: event.target.value });
    },
    [updateNodeData]
  );

  const handleAddOutputBlock = useCallback(() => {
    updateNodeData({
      outputBlocks: [
        ...outputBlocks,
        {
          id: `ob-${Date.now()}`,
          name: "data",
          description: "",
          type: "output",
        },
      ],
    });
  }, [outputBlocks, updateNodeData]);

  const handleRemoveBlock = useCallback(
    (blockId: string) => {
      updateNodeData({
        outputBlocks: outputBlocks.filter((block: BlockData) => block.id !== blockId),
      });
    },
    [outputBlocks, updateNodeData]
  );

  const handleBlockChange = useCallback(
    (blockId: string, patch: Partial<BlockData>) => {
      updateNodeData({
        outputBlocks: outputBlocks.map((block) =>
          block.id === blockId ? { ...block, ...patch } : block
        ),
      });
    },
    [outputBlocks, updateNodeData]
  );

  const endpointLabel = data.method === "WEBSOCKET" ? "WSS" : "API";
  const visibleBlocks = outputBlocks.slice(0, isCompact ? 4 : outputBlocks.length);

  return (
    <div
      className={cn(
        "w-[260px] overflow-hidden rounded-md border-2 bg-white shadow-sm transition-all",
        selected ? "border-emerald-400 ring-2 ring-emerald-200" : "border-slate-200",
        data.isActive && "border-emerald-500"
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        id={`${id}-func-in`}
        className="!h-2.5 !w-2.5 !border-emerald-600 !bg-emerald-500"
        style={{ left: -5, top: 24 }}
      />

      <div className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50 px-3 py-2">
        <Activity className="h-4 w-4 shrink-0 text-emerald-600" />
        <input
          type="text"
          value={data.label}
          onChange={handleLabelChange}
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-emerald-900 outline-none"
          placeholder="스트리밍 노드"
        />
        <button
          type="button"
          onClick={handleToggleActive}
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
            data.isActive
              ? "border-emerald-300 bg-emerald-100 text-emerald-700"
              : "border-slate-200 bg-white text-slate-500"
          )}
        >
          {data.isActive ? "LIVE" : "OFF"}
        </button>
        <button
          type="button"
          onClick={handleToggleCompact}
          className="rounded p-0.5 text-emerald-700 transition-colors hover:bg-emerald-100"
          title={isCompact ? "Expand streaming node" : "Simplify streaming node"}
        >
          {isCompact ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
        </button>
      </div>

      {isCompact ? (
        <div className="relative px-3 py-2 text-[11px] text-emerald-700">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold uppercase tracking-wide">
              {data.method === "WEBSOCKET" ? "WebSocket" : "Polling"}
            </div>
            {data.method === "POLLING" && data.intervalMs ? (
              <div className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                {data.intervalMs}ms
              </div>
            ) : null}
          </div>
          <div className="mt-1 flex items-center gap-1 rounded border border-emerald-100 bg-white px-1.5 py-1">
            <Globe2 className="h-3 w-3 shrink-0 text-emerald-600" />
            <span className="shrink-0 font-bold text-emerald-700">{endpointLabel}</span>
            <span className="truncate font-mono text-[10px] text-slate-600" title={data.url}>
              {data.url || "endpoint not set"}
            </span>
          </div>
          {chartSeries.length > 0 ? (
            <div className="mt-2 h-[76px] overflow-hidden rounded border border-emerald-100 bg-white">
              <MetricChart series={chartSeries.slice(-48)} compact height={76} baseColor="#059669" activeColor="#10b981" />
            </div>
          ) : chartWarning ? (
            <div className="mt-2 rounded border border-amber-100 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">
              chart fetch failed
            </div>
          ) : null}
          <div className="mt-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            생성 가능한 데이터 블록
          </div>
          <div className="mt-1 grid gap-1">
            {visibleBlocks.length === 0 ? (
              <div className="rounded border border-dashed border-slate-200 px-2 py-1 text-slate-400">
                output block 없음
              </div>
            ) : (
              visibleBlocks.map((block) => (
                <div key={block.id} className="relative rounded border border-emerald-100 bg-white px-2 py-1">
                  <div className="truncate text-xs font-semibold text-slate-800">{block.name}</div>
                  <div className="truncate text-[10px] text-slate-500">
                    {block.description || "스트리밍 응답 필드"}
                  </div>
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={`${id}-block-${block.id}-out`}
                    className="!h-2.5 !w-2.5 !border-emerald-600 !bg-emerald-500"
                    style={{ right: -8 }}
                  />
                </div>
              ))
            )}
            {outputBlocks.length > visibleBlocks.length ? (
              <div className="text-[10px] font-semibold text-slate-400">
                +{outputBlocks.length - visibleBlocks.length} more
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <>
      <div className="border-b border-slate-100 px-3 py-2">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
            데이터 소스
          </span>
          <select
            value={data.method}
            onChange={(event) => updateNodeData({ method: event.target.value as StreamingNodeData["method"] })}
            className="rounded border border-emerald-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 outline-none"
          >
            <option value="WEBSOCKET">WebSocket</option>
            <option value="POLLING">Polling API</option>
          </select>
        </div>
        <label className="block">
          <div className="mb-1 text-[10px] font-bold text-slate-500">{endpointLabel} endpoint</div>
          <input
            value={data.url}
            onChange={(event) => updateNodeData({ url: event.target.value })}
            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-[11px] text-slate-700 outline-none focus:border-emerald-300"
            placeholder={data.method === "WEBSOCKET" ? "wss://..." : "https://..."}
          />
        </label>
        <div className="mt-2 grid grid-cols-[96px_minmax(0,1fr)] gap-2">
          <label className="block">
            <div className="mb-1 text-[10px] font-bold text-slate-500">interval</div>
            <input
              type="number"
              value={data.intervalMs ?? 1000}
              onChange={(event) => updateNodeData({ intervalMs: Number(event.target.value) })}
              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 outline-none focus:border-emerald-300"
            />
          </label>
          <label className="block">
            <div className="mb-1 text-[10px] font-bold text-slate-500">request hint</div>
            <input
              value={data.requestHint ?? data.apiReference ?? ""}
              onChange={(event) => updateNodeData({ requestHint: event.target.value })}
              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 outline-none focus:border-emerald-300"
              placeholder="응답 구조, 구독 채널, 필요한 인증 정보"
            />
          </label>
        </div>
        <div className="mt-2 overflow-hidden rounded-md border border-emerald-100 bg-white">
          <div className="flex items-center justify-between border-b border-emerald-100 px-2 py-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">
              Live chart
            </span>
            <span className="truncate text-[10px] font-semibold text-slate-500">
              {chartSource || data.chartSymbol || "시장 데이터 대기"}
            </span>
          </div>
          <div className="h-[118px]">
            {chartSeries.length > 0 ? (
              <MetricChart series={chartSeries} compact height={118} baseColor="#059669" activeColor="#10b981" />
            ) : (
              <div className="flex h-full items-center justify-center px-3 text-center text-[11px] font-semibold text-slate-400">
                {chartWarning || "심볼을 확인하면 실제 kline 차트를 표시합니다."}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
          생성 가능한 데이터 블록
        </span>
        <button
          type="button"
          onClick={handleAddOutputBlock}
          className="rounded p-0.5 text-emerald-600 transition-colors hover:bg-emerald-50"
          title="Add output block"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="divide-y divide-slate-100">
        {outputBlocks.length === 0 ? (
          <div className="px-3 py-2 text-xs text-slate-400">출력 블록 없음</div>
        ) : (
          outputBlocks.map((block) => (
            <div key={block.id} className="nodrag relative group px-3 py-2">
              <input
                type="text"
                value={block.name}
                onChange={(event) => handleBlockChange(block.id, { name: event.target.value })}
                className="w-full bg-transparent text-xs font-semibold text-slate-800 outline-none"
                placeholder="블록 이름"
              />
              <input
                type="text"
                value={block.description ?? ""}
                onChange={(event) =>
                  handleBlockChange(block.id, { description: event.target.value })
                }
                className="mt-0.5 w-full bg-transparent text-[11px] text-slate-500 outline-none placeholder:text-slate-300"
                placeholder="블록 설명 한 줄"
              />
              <button
                type="button"
                onClick={() => handleRemoveBlock(block.id)}
                className="absolute right-4 top-2 rounded p-0.5 text-rose-500 opacity-0 transition-opacity hover:bg-rose-50 group-hover:opacity-100"
                title="Remove output block"
              >
                <X className="h-3 w-3" />
              </button>
              <Handle
                type="source"
                position={Position.Right}
                id={`${id}-block-${block.id}-out`}
                className="!h-2.5 !w-2.5 !border-emerald-600 !bg-emerald-500"
                style={{ right: -5 }}
              />
            </div>
          ))
        )}
      </div>
      {runtimeCode ? (
        <div className="border-t border-slate-100 bg-slate-950 p-2">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
            generated_strategy.go
          </div>
          <pre className="max-h-28 overflow-auto rounded bg-black/30 p-2 text-[10px] leading-4 text-emerald-100">
            {runtimeCode}
          </pre>
        </div>
      ) : null}
        </>
      )}
    </div>
  );
}

export const StreamingNode = memo(StreamingNodeComponent);
