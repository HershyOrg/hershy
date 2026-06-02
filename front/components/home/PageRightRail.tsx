"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
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
            { id: "market", mark: "M", label: "시장 개요", tone: "text-orange-700 border-orange-200 dark:text-orange-300 dark:border-orange-400/25" },
            { id: "agent", mark: "A", label: "전략 요약", tone: isAgentRunning ? "text-violet-700 border-violet-200 dark:text-violet-200 dark:border-violet-400/25" : "text-emerald-700 border-emerald-200 dark:text-emerald-200 dark:border-emerald-400/25" },
            { id: "code", mark: "C", label: "프로그램 코드", tone: programCode ? "text-emerald-700 border-emerald-200 dark:text-emerald-200 dark:border-emerald-400/25" : "text-amber-700 border-amber-200 dark:text-amber-200 dark:border-amber-400/25" },
            { id: "guide", mark: "G", label: "시작 가이드", tone: "text-slate-600 border-slate-200 dark:text-slate-300 dark:border-slate-700" },
          ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={item.id === "guide" ? onOpenGuide : onToggleCollapsed}
                aria-label={item.label}
                title={item.label}
                className={cn("relative inline-flex h-9 w-9 items-center justify-center border bg-white text-[11px] font-black dark:bg-slate-950", item.tone)}
              >
                {item.mark}
                {item.id === "agent" && isAgentRunning ? (
                  <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-violet-500" />
                ) : null}
              </button>
          ))}
        </div>
      </aside>
    );
  }

  return (
    <aside className="hidden min-h-0 w-full flex-col overflow-y-auto border-l border-slate-200 bg-white px-3 xl:flex dark:border-slate-800 dark:bg-slate-950">
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-slate-200 dark:border-slate-800">
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
      <section className="border-b border-slate-200 py-3 dark:border-slate-800">
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
                  "text-[10px] font-black",
                  row.tone === "up" ? "text-orange-600" : "text-slate-500",
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

      <section className="border-b border-slate-200 py-3 dark:border-slate-800">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-black text-slate-900 dark:text-slate-100">전략 요약</div>
          <div className="flex items-center gap-2">
            {isAgentRunning ? (
              <button
                type="button"
                onClick={onCancelAgentRun}
                className="border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
              >
                중단
              </button>
            ) : null}
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
              {isAgentRunning ? "작성 중" : "AI"}
            </span>
          </div>
        </div>
        <div className="border-l-2 border-slate-200 px-2.5 py-1 text-[11px] leading-5 text-slate-700 dark:border-slate-700 dark:text-slate-300">
          {isAgentRunning
            ? "전략 블록과 실행 조건을 읽고 요약을 작성하는 중입니다."
            : strategySummary || "아직 생성된 전략 요약이 없습니다."}
        </div>
      </section>

      <section className="border-b border-slate-200 py-3 dark:border-slate-800">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-black text-slate-900 dark:text-slate-100">관리자 Hershy Program 코드</div>
          <span className={cn("text-[10px] font-bold", programCode ? "text-emerald-600 dark:text-emerald-300" : "text-amber-600 dark:text-amber-300")}>
            {programCode ? "program" : "not generated"}
          </span>
        </div>
        <pre className="max-h-44 overflow-auto border border-slate-800 bg-slate-950 p-2 text-[10px] leading-4 text-emerald-200">
          {programCode ||
            "아직 generated_strategy.go program 코드가 없습니다.\nAI 전략 생성이 서버 검증과 코드 생성을 통과하면 이 영역에 실제 Hershy Go program 코드가 표시됩니다."}
        </pre>
      </section>

      {showGuide ? (
        <section className="border-b border-slate-200 py-3 dark:border-slate-800">
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
                className="grid h-7 grid-cols-[20px_1fr] items-center gap-1 border-l-2 border-transparent text-left text-xs hover:border-slate-300"
              >
                <span
                  className={cn(
                    "text-[10px] font-bold tabular-nums",
                    guideDone.has(index)
                      ? "text-violet-700"
                      : "text-slate-500 dark:text-slate-400",
                  )}
                >
                  {index + 1}
                </span>
                <span className="truncate font-semibold text-slate-700 dark:text-slate-300">{item}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

    </aside>
  );
}
