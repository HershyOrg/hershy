"use client";

import { ChevronRight, ExternalLink, Search } from "lucide-react";
import type { EasyViewModel } from "@/lib/easyViewAgent";
import type { HistorySnapshot } from "@/lib/historyStore";
import { cn } from "@/lib/utils";
import { Sparkline } from "./shared";
import type { AgentActivity, MarketRow } from "./types";

type PageRightRailProps = {
  marketUpdatedAt: string;
  marketWarning: string;
  marketRows: MarketRow[];
  easyViewModel: EasyViewModel;
  aiSummary: string;
  activeSnapshot: HistorySnapshot | null;
  isSummarizing: boolean;
  onAiSummary: () => void;
  isAgentRunning: boolean;
  onCancelAgentRun: () => void;
  connectedExchangeCount: number;
  visibleAgentActivities: AgentActivity[];
  programCode: string;
  guideItems: string[];
  guideDone: Set<number>;
  onOpenGuide: () => void;
  onSelectGuideStep: (index: number) => void;
};

export function PageRightRail({
  marketUpdatedAt,
  marketWarning,
  marketRows,
  easyViewModel,
  aiSummary,
  activeSnapshot,
  isSummarizing,
  onAiSummary,
  isAgentRunning,
  onCancelAgentRun,
  connectedExchangeCount,
  visibleAgentActivities,
  programCode,
  guideItems,
  guideDone,
  onOpenGuide,
  onSelectGuideStep,
}: PageRightRailProps) {
  return (
    <aside className="hidden min-h-0 flex-col gap-2 overflow-y-auto border-l border-slate-200 bg-white p-2 xl:flex">
      <section className="rounded-lg border border-slate-200 bg-white p-2.5">
        <div className="mb-1.5 flex items-center justify-between">
          <h2 className="text-xs font-black">시장 개요</h2>
          <span className="text-[10px] text-slate-500">
            {marketUpdatedAt
              ? new Date(marketUpdatedAt).toLocaleTimeString("ko-KR", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })
              : "로딩"}
          </span>
        </div>
        {marketWarning ? (
          <div className="mb-1.5 rounded bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">
            public ticker fallback
          </div>
        ) : null}
        <div className="grid gap-1">
          {marketRows.map((row) => (
            <div key={row.symbol} className="grid h-8 grid-cols-[20px_1fr_52px_40px] items-center gap-1.5">
              <div
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black text-white",
                  row.tone === "up" ? "bg-orange-500" : "bg-slate-900",
                )}
              >
                {row.icon}
              </div>
              <div className="min-w-0">
                <div className="truncate text-[11px] font-bold text-slate-800">{row.symbol}</div>
                <div className="truncate text-[10px] text-slate-500">{row.price}</div>
              </div>
              <Sparkline tone={row.tone} />
              <div
                className={cn(
                  "text-right text-[10px] font-bold",
                  row.tone === "up" ? "text-emerald-600" : "text-rose-600",
                )}
              >
                {row.change}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h2 className="text-xs font-black">{easyViewModel.title}</h2>
            <div className="text-[10px] text-slate-500">1분 전</div>
          </div>
          <Search className="h-4 w-4 text-slate-400" />
        </div>
        <div className="flex items-end gap-2">
          <div className="text-2xl font-black text-emerald-600">0.180%</div>
          <div className="pb-1 text-[11px] font-bold text-emerald-500">+0.042%</div>
        </div>
        <svg viewBox="0 0 224 76" className="mt-2 h-[74px] w-full rounded-lg bg-slate-50">
          <polyline
            points="0,54 12,46 24,52 36,40 48,43 60,34 72,38 84,27 96,29 108,21 120,27 132,17 144,23 156,15 168,19 180,11 192,16 204,9 216,14 224,10"
            fill="none"
            stroke="#8b5cf6"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line x1="0" x2="224" y1="40" y2="40" stroke="#cbd5e1" strokeDasharray="4 4" />
          <text x="2" y="70" className="fill-slate-500 text-[9px]">
            10:30
          </text>
          <text x="92" y="70" className="fill-slate-500 text-[9px]">
            11:00
          </text>
          <text x="184" y="70" className="fill-slate-500 text-[9px]">
            12:00
          </text>
        </svg>
      </section>

      <section className="rounded-lg border border-slate-200 p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-black">현재 전략 요약</div>
          <button onClick={onAiSummary} className="text-[10px] font-bold text-violet-700">
            {isSummarizing ? "요약 중" : "AI 요약"}
          </button>
        </div>
        <div className="text-[15px] font-black leading-5">{easyViewModel.title}</div>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{easyViewModel.summary}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">백테스트 가능</span>
          <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">드라이런 준비됨</span>
        </div>
        <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-violet-700">{aiSummary}</p>
        <dl className="mt-2 grid grid-cols-[72px_1fr] gap-y-1 text-xs">
          <dt className="text-slate-500">전략 유형</dt>
          <dd className="text-right font-bold">{easyViewModel.strategyType}</dd>
          <dt className="text-slate-500">시간 프레임</dt>
          <dd className="text-right font-bold">{easyViewModel.timeframe}</dd>
          <dt className="text-slate-500">마지막 수정</dt>
          <dd className="text-right font-bold" suppressHydrationWarning>
            {activeSnapshot?.timestamp
              ? new Date(activeSnapshot.timestamp).toLocaleString("ko-KR")
              : easyViewModel.lastModified}
          </dd>
        </dl>
      </section>

      <section className="rounded-lg border border-violet-200 bg-violet-50 p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-black text-violet-900">에이전트 루프</div>
          <div className="flex items-center gap-2">
            {isAgentRunning ? (
              <button
                type="button"
                onClick={onCancelAgentRun}
                className="rounded-full border border-violet-300 bg-white px-2 py-1 text-[10px] font-bold text-violet-700 transition-colors hover:bg-violet-100"
              >
                중단
              </button>
            ) : null}
            <span className="text-[10px] font-bold text-violet-700">
              {isAgentRunning ? "생성 중" : "완료"}
            </span>
          </div>
        </div>
        <div className="mb-2 rounded-lg border border-violet-200 bg-white/70 px-2 py-1.5 text-[10px] leading-4 text-violet-800">
          연결 거래소 {connectedExchangeCount}개를 먼저 확인한 뒤에만 실행 가능한 venue를 선택합니다.
        </div>
        <div className="grid gap-1.5">
          {visibleAgentActivities.map((activity, index) => (
            <div
              key={`${activity.id}-${index}`}
              className="grid grid-cols-[18px_1fr] gap-1 text-[11px] leading-4 text-violet-900"
            >
              <span
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded-full bg-white text-[9px] font-black",
                  activity.status === "error"
                    ? "text-rose-600"
                    : activity.status === "done"
                      ? "text-emerald-600"
                      : "text-violet-700",
                )}
              >
                {index + 1}
              </span>
              <span>
                {activity.label}
                {activity.stage ? (
                  <span className="ml-1 text-[10px] font-bold text-violet-500">· {activity.stage}</span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-950 p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-black text-slate-100">관리자 Hershy Program 코드</div>
          <span className={cn("text-[10px] font-bold", programCode ? "text-emerald-300" : "text-amber-300")}>
            {programCode ? "program" : "not generated"}
          </span>
        </div>
        <pre className="max-h-44 overflow-auto rounded-md border border-slate-800 bg-black/40 p-2 text-[10px] leading-4 text-emerald-200">
          {programCode ||
            "아직 generated_strategy.go program 코드가 없습니다.\nAI 전략 생성이 서버 검증과 코드 생성을 통과하면 이 영역에 실제 Hershy Go program 코드가 표시됩니다."}
        </pre>
      </section>

      <section className="rounded-lg border border-slate-200 p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-black">시작 가이드</div>
          <button type="button" onClick={onOpenGuide} className="text-[10px] font-bold text-violet-700">
            열기
          </button>
        </div>
        <div className="grid gap-1.5">
          {guideItems.map((item, index) => (
            <button
              key={item}
              type="button"
              onClick={() => onSelectGuideStep(index)}
              className="grid h-7 grid-cols-[20px_1fr_12px] items-center gap-1 text-left text-xs"
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold",
                  guideDone.has(index)
                    ? "border-violet-300 bg-violet-50 text-violet-700"
                    : "border-slate-200 text-slate-500",
                )}
              >
                {index + 1}
              </span>
              <span className="truncate font-semibold text-slate-700">{item}</span>
              <ChevronRight className="h-3 w-3 text-slate-400" />
            </button>
          ))}
        </div>
      </section>

      <button className="mt-auto inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50">
        <ExternalLink className="h-3.5 w-3.5" />
        전략 리포트 열기
      </button>
    </aside>
  );
}
