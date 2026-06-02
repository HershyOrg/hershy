"use client";

import { BarChart3, Bot, ChevronLeft, ChevronRight, FileCode2, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sparkline } from "./shared";
import type { MarketRow } from "./types";

type PageRightRailProps = {
  marketUpdatedAt: string;
  marketWarning: string;
  marketRows: MarketRow[];
  isAgentRunning: boolean;
  onCancelAgentRun: () => void;
  strategySummary: string;
  programCode: string;
  showGuide: boolean;
  guideItems: string[];
  guideDone: Set<number>;
  onOpenGuide: () => void;
  onSelectGuideStep: (index: number) => void;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
};

export function PageRightRail({
  marketUpdatedAt,
  marketWarning,
  marketRows,
  isAgentRunning,
  onCancelAgentRun,
  strategySummary,
  programCode,
  showGuide,
  guideItems,
  guideDone,
  onOpenGuide,
  onSelectGuideStep,
  isCollapsed,
  onToggleCollapsed,
}: PageRightRailProps) {
  if (isCollapsed) {
    return (
      <aside className="hidden min-h-0 w-[52px] shrink-0 flex-col items-center gap-2 border-l border-slate-200 bg-white px-2 py-2 xl:flex dark:border-slate-800 dark:bg-slate-950">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="오른쪽 패널 펼치기"
          title="오른쪽 패널 펼치기"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="mt-1 grid gap-2">
          {[
            { id: "market", icon: BarChart3, label: "시장 개요", tone: "text-orange-600 bg-orange-50 border-orange-200 dark:bg-orange-400/10 dark:border-orange-400/25" },
            { id: "agent", icon: Bot, label: "전략 요약", tone: isAgentRunning ? "text-violet-700 bg-violet-50 border-violet-200 dark:text-violet-200 dark:bg-violet-400/10 dark:border-violet-400/25" : "text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-200 dark:bg-emerald-400/10 dark:border-emerald-400/25" },
            { id: "code", icon: FileCode2, label: "프로그램 코드", tone: programCode ? "text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-200 dark:bg-emerald-400/10 dark:border-emerald-400/25" : "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-200 dark:bg-amber-400/10 dark:border-amber-400/25" },
            { id: "guide", icon: ListChecks, label: "시작 가이드", tone: "text-slate-600 bg-slate-50 border-slate-200 dark:text-slate-300 dark:bg-slate-900 dark:border-slate-700" },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={item.id === "guide" ? onOpenGuide : onToggleCollapsed}
                aria-label={item.label}
                title={item.label}
                className={cn("relative inline-flex h-9 w-9 items-center justify-center rounded-lg border", item.tone)}
              >
                <Icon className="h-4 w-4" />
                {item.id === "agent" && isAgentRunning ? (
                  <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-violet-500" />
                ) : null}
              </button>
            );
          })}
        </div>
      </aside>
    );
  }

  return (
    <aside className="hidden min-h-0 w-full flex-col gap-2 overflow-y-auto border-l border-slate-200 bg-white p-2 xl:flex dark:border-slate-800 dark:bg-slate-950">
      <div className="flex h-9 shrink-0 items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-2 dark:border-slate-800 dark:bg-slate-900/70">
        <div className="min-w-0 text-xs font-black text-slate-700 dark:text-slate-200">상태</div>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="오른쪽 패널 접기"
          title="오른쪽 패널 접기"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <section className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-900/70">
        <div className="mb-1.5 flex items-center justify-between">
          <h2 className="text-xs font-black">시장 개요</h2>
          <span className="text-[10px] text-slate-500 dark:text-slate-400">
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
          <div className="mb-1.5 rounded bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">
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
                <div className="truncate text-[11px] font-bold text-slate-800 dark:text-slate-200">{row.symbol}</div>
                <div className="truncate text-[10px] text-slate-500 dark:text-slate-400">{row.price}</div>
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

      <section className="rounded-lg border border-violet-200 bg-violet-50 p-2.5 dark:border-violet-400/30 dark:bg-violet-400/10">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-black text-violet-900 dark:text-violet-100">전략 요약</div>
          <div className="flex items-center gap-2">
            {isAgentRunning ? (
              <button
                type="button"
                onClick={onCancelAgentRun}
                className="rounded-full border border-violet-300 bg-white px-2 py-1 text-[10px] font-bold text-violet-700 transition-colors hover:bg-violet-100 dark:border-violet-400/30 dark:bg-slate-950 dark:text-violet-200 dark:hover:bg-slate-900"
              >
                중단
              </button>
            ) : null}
            <span className="text-[10px] font-bold text-violet-700 dark:text-violet-300">
              {isAgentRunning ? "작성 중" : "AI"}
            </span>
          </div>
        </div>
        <div className="rounded-lg border border-violet-200 bg-white/75 px-2.5 py-2 text-[11px] leading-5 text-violet-900 dark:border-violet-400/20 dark:bg-slate-950/50 dark:text-violet-100">
          {isAgentRunning
            ? "전략 블록과 실행 조건을 읽고 요약을 작성하는 중입니다."
            : strategySummary || "아직 생성된 전략 요약이 없습니다."}
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

      {showGuide ? (
        <section className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800 dark:bg-slate-900/70">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-black">시작 가이드</div>
            <button type="button" onClick={onOpenGuide} className="text-[10px] font-bold text-violet-700 dark:text-violet-300">
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
                      : "border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400",
                  )}
                >
                  {index + 1}
                </span>
                <span className="truncate font-semibold text-slate-700 dark:text-slate-300">{item}</span>
                <ChevronRight className="h-3 w-3 text-slate-400" />
              </button>
            ))}
          </div>
        </section>
      ) : null}

    </aside>
  );
}
