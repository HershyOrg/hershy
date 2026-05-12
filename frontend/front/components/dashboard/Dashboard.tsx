"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, ArrowDownRight, ArrowUpRight, Wallet, Plus, Clock3, Radio, ScrollText, Workflow, CalendarClock, ShoppingCart, CircleDot } from "lucide-react";
import { sequenceLogStore } from "@/lib/sequenceLogStore";
import { runningStore } from "@/lib/runningStore";
import type { HistorySnapshot } from "@/lib/historyStore";
import {
  detectStrategyKind,
  extractDcaPlan,
  getPrimaryStrategyLabel,
} from "@/lib/strategyMeta";

const INITIAL_STRATEGIES = [
  {
    id: "strat-v2",
    name: "V2 유동성 봇 전략",
    initialCapital: 10000,
    assets: [
      { name: "ETH", amount: 2.5, value: 5000 },
      { name: "USDC", amount: 5000, value: 5000 },
    ],
  },
];

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884d8"];

function getLogTone(level: "info" | "success" | "warning") {
  switch (level) {
    case "success":
      return "border-emerald-200 bg-emerald-50/70 text-emerald-700";
    case "warning":
      return "border-amber-200 bg-amber-50/80 text-amber-700";
    default:
      return "border-sky-200 bg-sky-50/80 text-sky-700";
  }
}

export function Dashboard({ activeSnapshot }: { activeSnapshot?: HistorySnapshot | null }) {
  const [strategies, setStrategies] = useState(
    INITIAL_STRATEGIES.map((s) => ({
      ...s,
      currentCapital: s.initialCapital,
      pnl: 0,
    }))
  );
  const sequenceLogs = useSyncExternalStore(
    (listener) => sequenceLogStore.subscribe(listener),
    () => sequenceLogStore.getSnapshot(),
    () => sequenceLogStore.getSnapshot(),
  );
  const runningEntries = useSyncExternalStore(
    (listener) => runningStore.subscribe(listener),
    () => runningStore.getSnapshot(),
    () => runningStore.getSnapshot(),
  );
  const activeStrategyLabel = getPrimaryStrategyLabel(activeSnapshot);
  const activeStrategyKind = detectStrategyKind(activeSnapshot);
  const activeLogs = activeSnapshot
    ? sequenceLogs.filter((log) => log.strategyLabel === activeStrategyLabel)
    : sequenceLogs;
  const latestLog = activeLogs[0] ?? null;
  const hasRunningStrategies = runningEntries.length > 0;
  const hasActiveRunningStrategy = activeSnapshot
    ? runningEntries.some((entry) => entry.snapshotId === activeSnapshot.id || entry.label === activeStrategyLabel)
    : hasRunningStrategies;
  const dcaPlan = extractDcaPlan(activeSnapshot);
  const dcaAssets = dcaPlan.allocations.length > 0
    ? dcaPlan.allocations.map((allocation, index) => ({
        name: allocation.asset,
        amount: (dcaPlan.monthlyBudget * allocation.weight) / 1000 + index * 0.1 + 0.5,
        value: (dcaPlan.monthlyBudget * allocation.weight) / 100,
      }))
    : [];

  useEffect(() => {
    if (!hasActiveRunningStrategy) {
      return;
    }

    const pnlTimer = setInterval(() => {
      setStrategies((prev) =>
        prev.map((strat) => {
          const changePercent = (Math.random() - 0.5) * 0.2;
          const changeAmount = (strat.initialCapital * changePercent) / 100;
          const nextCapital = strat.currentCapital + changeAmount;
          return {
            ...strat,
            currentCapital: nextCapital,
            pnl: nextCapital - strat.initialCapital,
          };
        })
      );
    }, 1000);

    return () => clearInterval(pnlTimer);
  }, [hasActiveRunningStrategy]);

  useEffect(() => {
    if (!hasActiveRunningStrategy) {
      return;
    }

    const assetTimer = setInterval(() => {
      setStrategies((prev) =>
        prev.map((strat) => {
          const newAssets = strat.assets.map((asset) => {
            const fluctuation = (Math.random() - 0.5) * 0.1;
            let newValue = asset.value * (1 + fluctuation);
            if (newValue < 0) newValue = 0;
            if (newValue === 0 && Math.random() > 0.5) newValue = 1000;
            return {
              ...asset,
              value: newValue,
              amount: newValue / (asset.value / (asset.amount || 1) || 30000),
            };
          });
          const sumValue = newAssets.reduce((sum, a) => sum + a.value, 0);
          const scaledAssets = newAssets.map((a) => ({
            ...a,
            value: (a.value / sumValue) * strat.currentCapital,
          }));
          return { ...strat, assets: scaledAssets };
        })
      );
    }, 30000);

    return () => clearInterval(assetTimer);
  }, [hasActiveRunningStrategy]);

  return (
    <div className="flex flex-col gap-4 w-full h-full overflow-y-auto pb-4">
      <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
        <Card className="shadow-sm border border-border/50">
          <CardHeader className="pb-2 py-3 px-4">
            <CardDescription className="text-xs flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5" />
              현재 실행 중
            </CardDescription>
            <CardTitle className="text-2xl font-semibold">{runningEntries.length}</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0 text-xs text-muted-foreground">
            {runningEntries.length > 0
              ? runningEntries.map((entry) => entry.label).join(", ")
              : "실행 중인 전략이 없습니다."}
          </CardContent>
        </Card>

        <Card className="shadow-sm border border-border/50">
          <CardHeader className="pb-2 py-3 px-4">
            <CardDescription className="text-xs flex items-center gap-1.5">
              <Workflow className="w-3.5 h-3.5" />
              마지막 활성 시퀀스
            </CardDescription>
            <CardTitle className="text-base font-semibold truncate">
              {latestLog?.sequenceLabel ?? "아직 로그 없음"}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0 text-xs text-muted-foreground">
            {latestLog ? `${latestLog.dateLabel} ${latestLog.timeLabel}` : "전략을 실행하면 시퀀스 로그가 쌓입니다."}
          </CardContent>
        </Card>

        <Card className="shadow-sm border border-border/50">
          <CardHeader className="pb-2 py-3 px-4">
            <CardDescription className="text-xs flex items-center gap-1.5">
              <ScrollText className="w-3.5 h-3.5" />
              누적 시퀀스 로그
            </CardDescription>
            <CardTitle className="text-2xl font-semibold">{sequenceLogs.length}</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0 text-xs text-muted-foreground">
            init, active, rebalancing, closed 흐름을 시간순으로 기록합니다.
          </CardContent>
        </Card>
      </div>

      {hasActiveRunningStrategy ? (
        activeStrategyKind === "dca" ? (
          <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(320px,1fr))] items-start">
            <Card className="col-span-1 shadow-sm border border-border/50">
              <CardHeader className="pb-3 py-3 px-4 border-b border-border/10">
                <CardTitle className="text-base font-bold">{activeStrategyLabel}</CardTitle>
                <CardDescription className="mt-0.5 text-xs">월간 적립형 자동 매수 전략</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 px-4 py-4">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-border/20 bg-muted/30 p-3">
                    <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CalendarClock className="h-3.5 w-3.5" />
                      매수 주기
                    </div>
                    <div className="text-base font-semibold">{dcaPlan.cadenceLabel}</div>
                  </div>
                  <div className="rounded-xl border border-border/20 bg-muted/30 p-3">
                    <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Wallet className="h-3.5 w-3.5" />
                      월 적립금
                    </div>
                    <div className="text-base font-semibold">${dcaPlan.monthlyBudget.toLocaleString()}</div>
                  </div>
                </div>
                <div className="rounded-xl border border-border/20 bg-muted/30 p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ShoppingCart className="h-3.5 w-3.5" />
                    이번 배치 매수 설정
                  </div>
                  <div className="space-y-2">
                    {dcaPlan.allocations.map((allocation) => (
                      <div key={allocation.symbol} className="flex items-center justify-between rounded-lg bg-white/80 px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900">{allocation.asset}</p>
                          <p className="text-xs text-slate-500">{allocation.exchange} · {allocation.symbol}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-slate-900">{allocation.weight}%</p>
                          <p className="text-xs text-slate-500">${((dcaPlan.monthlyBudget * allocation.weight) / 100).toFixed(0)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="col-span-1 shadow-sm border border-border/50">
              <CardHeader className="pb-3 py-3 px-4 border-b border-border/10">
                <CardTitle className="text-base font-bold">누적 적립 비중</CardTitle>
                <CardDescription className="mt-0.5 text-xs">리밸런싱 없이 정해진 비중으로 정기 매수합니다.</CardDescription>
              </CardHeader>
              <CardContent className="px-4 py-4">
                <div className="flex flex-col">
                  <div className="h-[180px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={dcaAssets}
                          cx="50%"
                          cy="50%"
                          innerRadius={38}
                          outerRadius={68}
                          paddingAngle={4}
                          dataKey="value"
                        >
                          {dcaAssets.map((entry, index) => (
                            <Cell key={`dca-cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <RechartsTooltip
                          formatter={(value, name, props) => [
                            `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${props.payload.amount.toFixed(4)} 개)`,
                            name
                          ]}
                          contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)" }}
                        />
                        <Legend verticalAlign="bottom" height={24} iconType="circle" />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-3 space-y-2">
                    {dcaPlan.allocations.map((allocation) => (
                      <div key={`${allocation.symbol}-row`} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                        <div className="flex items-center gap-2">
                          <CircleDot className="h-3.5 w-3.5 text-indigo-500" />
                          <span className="font-medium text-slate-800">{allocation.asset}</span>
                        </div>
                        <span className="text-slate-600">{allocation.weight}% 비중 유지</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
        <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(320px,1fr))] items-start">
          {strategies.map((strat) => {
            const pnlPercent = ((strat.currentCapital - strat.initialCapital) / strat.initialCapital) * 100;
            const isProfitable = pnlPercent >= 0;

            return (
              <Card key={strat.id} className="col-span-1 shadow-sm border border-border/50">
                <CardHeader className="pb-3 py-3 px-4 border-b border-border/10">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base font-bold">{strat.name}</CardTitle>
                      <CardDescription className="mt-0.5 text-xs">초기 할당 유동량: ${strat.initialCapital.toLocaleString()}</CardDescription>
                    </div>
                    <div
                      className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${isProfitable ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                        }`}
                    >
                      {isProfitable ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                      {Math.abs(pnlPercent).toFixed(4)}%
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-4 px-4 pb-4">
                  <div className="grid grid-cols-2 gap-2 mb-2.5">
                    <div className="flex flex-col bg-muted/30 p-2.5 rounded-md border border-border/20">
                      <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-1">
                        <Wallet className="w-3.5 h-3.5" /> 현재 총 자산
                      </span>
                      <span className="text-base font-medium font-mono tracking-tight">${strat.currentCapital.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex flex-col bg-muted/30 p-2.5 rounded-md border border-border/20">
                      <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-1">
                        <Activity className="w-3.5 h-3.5" /> 수익금 (PNL)
                      </span>
                      <span className={`text-base font-medium font-mono tracking-tight ${isProfitable ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                        {isProfitable ? "+" : ""}${strat.pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col">
                    <h4 className="text-xs font-semibold mb-1 flex items-center justify-center text-muted-foreground">현재 자산 분포 비중</h4>
                    <div className="h-[100px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={strat.assets}
                            cx="50%"
                            cy="50%"
                            innerRadius={30}
                            outerRadius={45}
                            paddingAngle={5}
                            dataKey="value"
                          >
                            {strat.assets.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <RechartsTooltip
                            formatter={(value, name, props) => [
                              `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${props.payload.amount.toFixed(4)} 개)`,
                              name
                            ]}
                            contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)" }}
                          />
                          <Legend verticalAlign="bottom" height={24} iconType="circle" />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          <Card className="col-span-1 border-2 border-dashed border-border/50 bg-background/50 hover:bg-muted/30 transition-colors flex flex-col items-center justify-center min-h-[280px] cursor-pointer group">
            <div className="flex flex-col items-center gap-3 text-muted-foreground group-hover:text-foreground transition-colors">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center group-hover:scale-110 group-hover:bg-primary/10 transition-all">
                <Plus className="w-6 h-6 group-hover:text-primary transition-colors" />
              </div>
              <div className="flex flex-col items-center">
                <span className="font-semibold text-sm">새 대시보드 추가</span>
                <span className="text-xs opacity-70 mt-1">새로운 봇 전략의 성과를 트래킹하세요</span>
              </div>
            </div>
          </Card>
        </div>
        )
      ) : (
        <Card className="border-2 border-dashed border-border/50 bg-background/60 shadow-sm">
          <CardContent className="flex min-h-[240px] flex-col items-center justify-center gap-3 px-6 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Radio className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">전략이 아직 활성화되지 않았습니다</p>
              <p className="text-xs leading-6 text-muted-foreground">
                실행 버튼을 누르면 자산, PnL, 포트폴리오 대시보드가 여기 표시됩니다.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-sm border border-border/50">
        <CardHeader className="pb-3 py-3 px-4 border-b border-border/10">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base font-bold">
                {activeStrategyKind === "dca" ? "DCA 실행 로그" : "시퀀스 실행 로그"}
              </CardTitle>
              <CardDescription className="mt-0.5 text-xs">
                {activeStrategyKind === "dca"
                  ? "어느 시간대에 어떤 월간 매수 배치가 실행됐는지 기록합니다."
                  : "어느 시간대에 어떤 시퀀스가 동작했는지 실시간으로 기록합니다."}
              </CardDescription>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-600">
              <Clock3 className="h-3.5 w-3.5" />
              최신순 정렬
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-4 py-4">
          {activeLogs.length === 0 ? (
            <div className="flex min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 text-sm text-slate-500">
              {activeStrategyKind === "dca"
                ? "전략을 실행하면 월간 매수 배치 로그가 여기에 쌓입니다."
                : "전략을 실행하면 init, active, rebalancing, closed 시퀀스 로그가 여기에 쌓입니다."}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {activeLogs.map((log) => (
                <div
                  key={log.id}
                  className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm md:grid-cols-[120px_minmax(0,1fr)_auto]"
                >
                  <div className="flex flex-col justify-center rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    <span className="font-semibold text-slate-700">{log.timeLabel}</span>
                    <span>{log.dateLabel}</span>
                  </div>

                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                        {log.strategyLabel}
                      </span>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getLogTone(log.level)}`}>
                        {log.stateLabel}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-slate-900">{log.sequenceLabel}</p>
                    <p className="text-sm leading-6 text-slate-600">{log.message}</p>
                  </div>

                  <div className="flex items-start md:justify-end">
                    <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700">
                      sequence log
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
