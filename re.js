"use client";

import React, { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Circle,
  Play,
  RotateCcw,
  ShieldCheck,
  StepForward,
  TrendingUp,
} from "lucide-react";

const STEPS = [
  {
    id: 0,
    title: "Market Data",
    subtitle: "BTC price + volume stream",
    detail: "가격과 거래량 데이터가 전략으로 들어옵니다.",
    accent: "blue",
  },
  {
    id: 1,
    title: "Condition A",
    subtitle: "Price > Moving Average",
    detail: "현재 가격이 이동평균선 위에 있는지 확인합니다.",
    accent: "indigo",
  },
  {
    id: 2,
    title: "Condition B",
    subtitle: "Volume > Avg Volume",
    detail: "거래량이 평균보다 높은지 확인합니다.",
    accent: "cyan",
  },
  {
    id: 3,
    title: "AND Gate",
    subtitle: "A and B must both pass",
    detail: "두 조건이 모두 참이면 매수 신호가 생성됩니다.",
    accent: "amber",
  },
  {
    id: 4,
    title: "Action",
    subtitle: "Create BUY order",
    detail: "전략이 주문 생성 단계로 넘어갑니다.",
    accent: "emerald",
  },
  {
    id: 5,
    title: "Risk Rule",
    subtitle: "Stop loss / Take profit",
    detail: "진입 후 손절과 익절 조건을 함께 설정합니다.",
    accent: "rose",
  },
];

const accentClasses = {
  blue: "border-blue-300 bg-blue-50 text-blue-700",
  indigo: "border-indigo-300 bg-indigo-50 text-indigo-700",
  cyan: "border-cyan-300 bg-cyan-50 text-cyan-700",
  amber: "border-amber-300 bg-amber-50 text-amber-700",
  emerald: "border-emerald-300 bg-emerald-50 text-emerald-700",
  rose: "border-rose-300 bg-rose-50 text-rose-700",
};

function AppButton({ children, onClick, variant = "solid", disabled = false }) {
  const baseClass =
    "inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45";
  const variantClass =
    variant === "outline"
      ? "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
      : "bg-slate-950 text-white hover:bg-slate-800";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${baseClass} ${variantClass}`}
    >
      {children}
    </button>
  );
}

function Panel({ children, className = "" }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      {children}
    </section>
  );
}

function NodeCard({ item, active, passed }) {
  const stateClass = active
    ? "border-slate-950 bg-white shadow-md"
    : passed
      ? "border-slate-300 bg-white"
      : "border-slate-200 bg-slate-50 opacity-70";

  return (
    <motion.div
      layout
      animate={{ scale: active ? 1.03 : 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 22 }}
      className={`relative min-h-[116px] rounded-lg border p-4 ${stateClass}`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-slate-900">
          {passed ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
        </div>
        <div className="min-w-0">
          <div
            className={`mb-2 inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
              accentClasses[item.accent]
            }`}
          >
            {item.title}
          </div>
          <div className="text-sm font-semibold tracking-tight text-slate-950">{item.subtitle}</div>
        </div>
      </div>

      {active ? (
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: "100%" }}
          transition={{ duration: 0.85 }}
          className="absolute bottom-0 left-0 h-1 rounded-b-lg bg-slate-950"
        />
      ) : null}
    </motion.div>
  );
}

function FlowArrow({ active }) {
  return (
    <div className="flex items-center justify-center text-slate-800">
      <motion.div
        animate={{ opacity: active ? 1 : 0.25, x: active ? [0, 5, 0] : 0 }}
        transition={{ repeat: active ? Infinity : 0, duration: 0.9 }}
        className="hidden md:block"
      >
        <ArrowRight className="h-6 w-6" />
      </motion.div>
      <motion.div
        animate={{ opacity: active ? 1 : 0.25, y: active ? [0, 5, 0] : 0 }}
        transition={{ repeat: active ? Infinity : 0, duration: 0.9 }}
        className="block rotate-90 md:hidden"
      >
        <ArrowRight className="h-6 w-6" />
      </motion.div>
    </div>
  );
}

function MiniChart({ currentStep }) {
  const pricePoints = useMemo(
    () => [
      [20, 120],
      [80, 110],
      [140, 130],
      [200, 95],
      [260, 88],
      [320, 72],
      [380, 65],
      [440, 52],
      [500, 48],
    ],
    [],
  );

  const pricePath = pricePoints
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x},${y}`)
    .join(" ");
  const movingAveragePath =
    "M20,125 L80,120 L140,116 L200,108 L260,99 L320,88 L380,78 L440,67 L500,58";
  const revealAmount = Math.min(1, (currentStep + 1) / STEPS.length);

  return (
    <Panel>
      <div className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-950">Chart Overlay</div>
            <div className="text-xs text-slate-500">Price, moving average, and entry signal</div>
          </div>
          <TrendingUp className="h-5 w-5 text-emerald-600" />
        </div>

        <svg viewBox="0 0 540 170" className="h-56 w-full overflow-visible rounded-lg bg-slate-50 p-2">
          {[40, 80, 120].map((y) => (
            <line
              key={y}
              x1="10"
              x2="520"
              y1={y}
              y2={y}
              stroke="currentColor"
              className="text-slate-200"
              strokeWidth="1"
            />
          ))}

          <motion.path
            d={movingAveragePath}
            fill="none"
            stroke="currentColor"
            className="text-indigo-400"
            strokeWidth="3"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: currentStep >= 1 ? revealAmount : 0 }}
            transition={{ duration: 0.8 }}
          />

          <motion.path
            d={pricePath}
            fill="none"
            stroke="currentColor"
            className="text-slate-950"
            strokeWidth="4"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: revealAmount }}
            transition={{ duration: 0.8 }}
          />

          {currentStep >= 4 ? (
            <motion.g
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 300 }}
            >
              <circle cx="440" cy="52" r="9" fill="currentColor" className="text-emerald-500" />
              <rect x="400" y="12" width="88" height="28" rx="6" fill="#047857" />
              <text x="444" y="31" textAnchor="middle" fontSize="13" fill="white" fontWeight="700">
                BUY
              </text>
            </motion.g>
          ) : null}

          {currentStep >= 5 ? (
            <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <line x1="360" x2="515" y1="35" y2="35" stroke="#059669" strokeDasharray="6 6" strokeWidth="2" />
              <text x="522" y="39" fontSize="12" fill="#059669">
                TP
              </text>
              <line x1="360" x2="515" y1="95" y2="95" stroke="#e11d48" strokeDasharray="6 6" strokeWidth="2" />
              <text x="522" y="99" fontSize="12" fill="#e11d48">
                SL
              </text>
            </motion.g>
          ) : null}
        </svg>
      </div>
    </Panel>
  );
}

export default function TradingLogicAnimationExample() {
  const [step, setStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const runId = useRef(0);
  const currentItem = STEPS[step];

  const handleNext = () => {
    runId.current += 1;
    setIsPlaying(false);
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  };

  const handleReset = () => {
    runId.current += 1;
    setIsPlaying(false);
    setStep(0);
  };

  const handlePlay = async () => {
    if (isPlaying) return;

    const currentRunId = runId.current + 1;
    runId.current = currentRunId;
    setIsPlaying(true);
    setStep(0);

    for (let index = 1; index < STEPS.length; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 850));
      if (runId.current !== currentRunId) return;
      setStep(index);
    }

    if (runId.current === currentRunId) {
      setIsPlaying(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 p-5 text-slate-950 md:p-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              <Activity className="h-4 w-4 text-blue-600" />
              Trading Logic Animation
            </div>
            <h1 className="text-2xl font-bold tracking-tight md:text-4xl">
              조건, 판단, 주문 흐름 시뮬레이션
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              자연어 전략이 데이터 입력, 조건 판단, 주문 실행, 리스크 규칙으로 이어지는 과정을 단계별로 확인합니다.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <AppButton onClick={handlePlay} disabled={isPlaying}>
              <Play className="mr-2 h-4 w-4" />
              {isPlaying ? "Playing" : "Play"}
            </AppButton>
            <AppButton onClick={handleNext} variant="outline">
              <StepForward className="mr-2 h-4 w-4" />
              Next
            </AppButton>
            <AppButton onClick={handleReset} variant="outline">
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset
            </AppButton>
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <Panel>
            <div className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-950">Visual Logic Flow</div>
                  <div className="text-xs text-slate-500">Moving average breakout example</div>
                </div>
                <div className="rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                  Step {step + 1} / {STEPS.length}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
                <NodeCard item={STEPS[0]} active={step === 0} passed={step > 0} />
                <FlowArrow active={step >= 1} />
                <NodeCard item={STEPS[1]} active={step === 1} passed={step > 1} />
                <FlowArrow active={step >= 2} />
                <NodeCard item={STEPS[2]} active={step === 2} passed={step > 2} />
              </div>

              <div className="my-4 flex justify-center">
                <motion.div
                  animate={{ opacity: step >= 3 ? 1 : 0.25, y: step >= 3 ? [0, 6, 0] : 0 }}
                  transition={{ repeat: step >= 3 ? Infinity : 0, duration: 1 }}
                  className="rotate-90 text-slate-800"
                >
                  <ArrowRight className="h-6 w-6" />
                </motion.div>
              </div>

              <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
                <NodeCard item={STEPS[3]} active={step === 3} passed={step > 3} />
                <FlowArrow active={step >= 4} />
                <NodeCard item={STEPS[4]} active={step === 4} passed={step > 4} />
                <FlowArrow active={step >= 5} />
                <NodeCard item={STEPS[5]} active={step === 5} passed={step > 5} />
              </div>
            </div>
          </Panel>

          <div className="space-y-5">
            <MiniChart currentStep={step} />

            <Panel>
              <div className="p-5">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-950">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  Current Explanation
                </div>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentItem.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.18 }}
                    className="rounded-lg bg-slate-50 p-4"
                  >
                    <div className="text-lg font-bold text-slate-950">{currentItem.title}</div>
                    <div className="mt-2 text-sm leading-6 text-slate-600">{currentItem.detail}</div>
                  </motion.div>
                </AnimatePresence>
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </main>
  );
}
