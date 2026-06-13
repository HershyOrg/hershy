import { Loader2, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { usePrivyRuntime } from "@/shared/providers/PrivyAppProvider";
import { cn } from "@/shared/utils/utils";
import { getScwOnboardingApiBase } from "../api/scwOnboardingClient";
import { useScwOnboarding } from "../hooks/useScwOnboarding";
import type { ScwOnboardingStatus } from "../types/scwOnboardingTypes";

function shortAddress(value?: string) {
  if (!value) return "-";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function StatusPill({ status }: { status: ScwOnboardingStatus | null }) {
  const ready = Boolean(status?.ready_for_relay);
  const label = ready ? "Relay ready" : status?.state || "Not ready";

  return (
    <span
      className={cn(
        "inline-flex items-center border px-1.5 py-0.5 text-[9px] font-black uppercase",
        ready
          ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200"
          : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200",
      )}
    >
      {label}
    </span>
  );
}

function ScwOnboardingSetupNotice({ providerError = "" }: { providerError?: string }) {
  return (
    <section className="border-b border-slate-200 py-3 dark:border-slate-800">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-bold text-slate-700 dark:text-slate-300">트레이딩 지갑</div>
        <span className="border border-slate-200 px-1.5 py-0.5 text-[9px] font-black uppercase text-slate-500 dark:border-slate-700 dark:text-slate-400">
          setup
        </span>
      </div>
      <div className="rounded border border-slate-200 bg-slate-50 px-2 py-2 text-[10px] leading-4 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
        <div className="font-bold text-slate-800 dark:text-slate-100">
          {providerError ? "Privy 초기화 실패" : "Privy 설정 필요"}
        </div>
        <div className="mt-1 font-mono">VITE_PRIVY_APP_ID</div>
        <div className="mt-1">
          {providerError || "설정 후 로그인 지갑으로 SCW 온보딩을 진행할 수 있습니다."}
        </div>
      </div>
    </section>
  );
}

function ScwOnboardingPanelContent() {
  const { authenticated, connectWallet, error: privyError, login, logout, ready, user } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const primaryWallet = wallets[0] ?? null;
  const ownerAddress = primaryWallet?.address || user?.wallet?.address || "";
  const {
    actions,
    chainId,
    error,
    executeAction,
    isLoading,
    lastExecution,
    pendingActionId,
    prepare,
    refresh,
    rpcUrl,
    status,
  } = useScwOnboarding({
    ownerAddress,
    wallet: primaryWallet,
  });

  const isBusy = isLoading || Boolean(pendingActionId);

  return (
    <section className="border-b border-slate-200 py-3 dark:border-slate-800">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
          <ShieldCheck className="h-3.5 w-3.5" />
          트레이딩 지갑
        </div>
        <StatusPill status={status} />
      </div>

      {!ready ? (
        <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          Privy 초기화 중
        </div>
      ) : null}

      {privyError ? (
        <div className="rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] leading-4 text-rose-700 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-200">
          Privy 오류: {privyError.message}
        </div>
      ) : null}

      {ready && !authenticated ? (
        <button
          type="button"
          onClick={() => login()}
          className="h-8 w-full border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
        >
          Privy로 지갑 연결
        </button>
      ) : null}

      {ready && authenticated ? (
        <div className="space-y-2">
          <div className="rounded border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-950">
            <div className="flex items-center justify-between gap-2 text-[10px]">
              <span className="font-semibold text-slate-500 dark:text-slate-400">Owner</span>
              <span className="font-mono font-bold text-slate-800 dark:text-slate-100">{shortAddress(ownerAddress)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
              <span className="font-semibold text-slate-500 dark:text-slate-400">SCW</span>
              <span className="font-mono font-bold text-slate-800 dark:text-slate-100">
                {shortAddress(status?.smart_wallet_address)}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
              <span className="font-semibold text-slate-500 dark:text-slate-400">Session</span>
              <span className="font-mono font-bold text-slate-800 dark:text-slate-100">
                {shortAddress(status?.session_key_address)}
              </span>
            </div>
          </div>

          {!walletsReady || !primaryWallet ? (
            <button
              type="button"
              onClick={() => connectWallet()}
              className="h-8 w-full border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
            >
              실행 지갑 연결
            </button>
          ) : null}

          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => void prepare()}
              disabled={!ownerAddress || isBusy}
              className="h-8 border border-slate-200 bg-white text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
            >
              준비
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={!ownerAddress || isBusy}
              className="inline-flex h-8 items-center justify-center gap-1 border border-slate-200 bg-white text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
            >
              {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              새로고침
            </button>
          </div>

          {actions.length > 0 ? (
            <div className="space-y-1.5">
              {actions.map((action) => {
                const isPending = pendingActionId === action.id;
                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => void executeAction(action)}
                    disabled={!primaryWallet || isBusy}
                    title={action.description}
                    className="w-full border border-cyan-200 bg-cyan-50 px-2 py-2 text-left text-[10px] font-bold text-cyan-800 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-cyan-400/25 dark:bg-cyan-400/10 dark:text-cyan-200 dark:hover:bg-cyan-400/15"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate">{action.label || action.id}</span>
                      {isPending ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : null}
                    </span>
                    {action.description ? (
                      <span className="mt-0.5 block truncate font-medium opacity-75">{action.description}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded bg-slate-50 px-2 py-1.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              {status?.ready_for_relay ? "자동매매 릴레이 준비 완료" : "필요한 다음 액션이 있으면 여기에 표시됩니다."}
            </div>
          )}

          {lastExecution ? (
            <div className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[10px] leading-4 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-200">
              <div className="font-bold">마지막 실행: {lastExecution.mode}</div>
              <div className="truncate font-mono">{lastExecution.txHash}</div>
            </div>
          ) : null}

          {error ? (
            <div className="rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] leading-4 text-rose-700 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-200">
              {error}
            </div>
          ) : null}

          <div className="space-y-0.5 text-[9px] font-semibold text-slate-400 dark:text-slate-500">
            <div className="truncate">API {getScwOnboardingApiBase()}</div>
            <div className="truncate">Chain {chainId} · RPC {rpcUrl}</div>
          </div>

          <button
            type="button"
            onClick={() => logout()}
            className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <Wallet className="h-3 w-3" />
            로그아웃
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function ScwOnboardingPanel() {
  const { isConfigured, providerError } = usePrivyRuntime();

  if (!isConfigured) {
    return <ScwOnboardingSetupNotice providerError={providerError} />;
  }

  return <ScwOnboardingPanelContent />;
}
