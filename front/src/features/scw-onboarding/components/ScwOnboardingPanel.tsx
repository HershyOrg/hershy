import { Loader2, ShieldCheck, Wallet } from "lucide-react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { getScwRpcUrl } from "@/shared/config/scwConfig";
import { usePrivyRuntime } from "@/shared/providers/PrivyAppProvider";
import {
  MANTLE_SEPOLIA_CHAIN_ID,
  MANTLE_SEPOLIA_RPC_URL,
} from "../utils/mantleCallExecutor";

function shortAddress(value?: string) {
  if (!value) return "-";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
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
          {providerError || "설정 후 사이드바에서는 지갑 연결 상태만 확인합니다."}
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
  const rpcUrl = getScwRpcUrl() || MANTLE_SEPOLIA_RPC_URL;

  return (
    <section className="border-b border-slate-200 py-3 dark:border-slate-800">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
          <ShieldCheck className="h-3.5 w-3.5" />
          트레이딩 지갑
        </div>
        <span className="border border-cyan-300 bg-cyan-50 px-1.5 py-0.5 text-[9px] font-black uppercase text-cyan-700 dark:border-cyan-400/30 dark:bg-cyan-400/10 dark:text-cyan-200">
          EOA
        </span>
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
          Privy EOA 연결
        </button>
      ) : null}

      {ready && authenticated ? (
        <div className="space-y-2">
          <div className="rounded border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-950">
            <div className="flex items-center justify-between gap-2 text-[10px]">
              <span className="font-semibold text-slate-500 dark:text-slate-400">EOA</span>
              <span className="font-mono font-bold text-slate-800 dark:text-slate-100">{shortAddress(ownerAddress)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
              <span className="font-semibold text-slate-500 dark:text-slate-400">Chain</span>
              <span className="font-mono font-bold text-slate-800 dark:text-slate-100">Mantle Sepolia {MANTLE_SEPOLIA_CHAIN_ID}</span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
              <span className="font-semibold text-slate-500 dark:text-slate-400">Role</span>
              <span className="font-mono font-bold text-slate-800 dark:text-slate-100">wallet only</span>
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

          <div className="space-y-0.5 text-[9px] font-semibold text-slate-400 dark:text-slate-500">
            <div className="truncate">RPC {rpcUrl}</div>
            <div>DEX call 입력은 캔버스의 DEX 블록에서 실행합니다.</div>
            <div>faucet https://faucet.sepolia.mantle.xyz</div>
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
