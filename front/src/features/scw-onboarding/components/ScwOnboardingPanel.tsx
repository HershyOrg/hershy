import { useEffect, useState } from "react";
import { KeyRound, Loader2, ShieldCheck, Wallet } from "lucide-react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { getScwRpcUrl } from "@/shared/config/scwConfig";
import { usePrivyRuntime } from "@/shared/providers/PrivyAppProvider";
import {
  deleteLocalWallet,
  fetchLocalWalletStatus,
  saveLocalWallet,
  type LocalWalletStatus,
} from "../api/localWalletClient";
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
          Privy
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
          Privy 지갑 연결
        </button>
      ) : null}

      {ready && authenticated ? (
        <div className="space-y-2">
          <div className="rounded border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-950">
            <div className="flex items-center justify-between gap-2 text-[10px]">
              <span className="font-semibold text-slate-500 dark:text-slate-400">Connected</span>
              <span className="font-mono font-bold text-slate-800 dark:text-slate-100">{shortAddress(ownerAddress)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
              <span className="font-semibold text-slate-500 dark:text-slate-400">Chain</span>
              <span className="font-mono font-bold text-slate-800 dark:text-slate-100">Mantle Sepolia {MANTLE_SEPOLIA_CHAIN_ID}</span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
              <span className="font-semibold text-slate-500 dark:text-slate-400">Role</span>
              <span className="font-mono font-bold text-slate-800 dark:text-slate-100">UI auth only</span>
            </div>
          </div>

          {!walletsReady || !primaryWallet ? (
            <button
              type="button"
              onClick={() => connectWallet()}
              className="h-8 w-full border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
            >
              Privy 지갑 연결
            </button>
          ) : null}

          <div className="space-y-0.5 text-[9px] font-semibold text-slate-400 dark:text-slate-500">
            <div className="truncate">RPC {rpcUrl}</div>
            <div>DEX call 입력은 캔버스의 DEX 블록에서 실행합니다.</div>
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

function LocalEoaWalletPanel() {
  const [localWallet, setLocalWallet] = useState<LocalWalletStatus | null>(null);
  const [localAddress, setLocalAddress] = useState("");
  const [localPrivateKey, setLocalPrivateKey] = useState("");
  const [localWalletError, setLocalWalletError] = useState("");
  const [isLocalWalletLoading, setIsLocalWalletLoading] = useState(false);

  async function refreshLocalWalletStatus() {
    setIsLocalWalletLoading(true);
    setLocalWalletError("");
    try {
      const status = await fetchLocalWalletStatus();
      setLocalWallet(status);
      if (status.address) {
        setLocalAddress(status.address);
      }
    } catch (error) {
      setLocalWalletError(error instanceof Error ? error.message : "로컬 지갑 상태 확인 실패");
    } finally {
      setIsLocalWalletLoading(false);
    }
  }

  async function handleSaveLocalWallet() {
    setIsLocalWalletLoading(true);
    setLocalWalletError("");
    try {
      const status = await saveLocalWallet({
        address: localAddress,
        privateKey: localPrivateKey,
      });
      setLocalWallet(status);
      setLocalPrivateKey("");
    } catch (error) {
      setLocalWalletError(error instanceof Error ? error.message : "로컬 지갑 저장 실패");
    } finally {
      setIsLocalWalletLoading(false);
    }
  }

  async function handleDeleteLocalWallet() {
    setIsLocalWalletLoading(true);
    setLocalWalletError("");
    try {
      const status = await deleteLocalWallet();
      setLocalWallet(status);
      setLocalPrivateKey("");
    } catch (error) {
      setLocalWalletError(error instanceof Error ? error.message : "로컬 지갑 삭제 실패");
    } finally {
      setIsLocalWalletLoading(false);
    }
  }

  useEffect(() => {
    void refreshLocalWalletStatus();
  }, []);

  return (
    <section className="border-b border-slate-200 py-3 dark:border-slate-800">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
          <KeyRound className="h-3.5 w-3.5" />
          로컬 EOA 로그인
        </div>
        <span className="border border-cyan-300 bg-cyan-50 px-1.5 py-0.5 text-[9px] font-black uppercase text-cyan-700 dark:border-cyan-400/30 dark:bg-cyan-400/10 dark:text-cyan-200">
          EOA
        </span>
      </div>

      <div className="space-y-2">
        <div className="rounded border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="text-[10px] font-black uppercase tracking-wide text-slate-600 dark:text-slate-300">
              EOA / Private Key
            </div>
            <span className="text-[9px] font-bold text-slate-400">
              {localWallet?.exists ? `saved ****${localWallet.privateKeyLast4 || "****"}` : "not saved"}
            </span>
          </div>
          <input
            value={localAddress}
            onChange={(event) => setLocalAddress(event.target.value)}
            spellCheck={false}
            placeholder="EOA address 0x..."
            className="mb-1 h-8 w-full border border-slate-200 bg-white px-2 font-mono text-[10px] text-slate-700 outline-none focus:border-cyan-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          />
          <input
            type="password"
            value={localPrivateKey}
            onChange={(event) => setLocalPrivateKey(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder={localWallet?.exists ? "새 PK 입력 시 교체" : "Private key 0x..."}
            className="h-8 w-full border border-slate-200 bg-white px-2 font-mono text-[10px] text-slate-700 outline-none focus:border-cyan-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          />
          <div className="mt-1 grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => void handleSaveLocalWallet()}
              disabled={isLocalWalletLoading || !localAddress.trim() || !localPrivateKey.trim()}
              className="h-7 border border-cyan-300 bg-cyan-50 text-[10px] font-bold text-cyan-700 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-cyan-400/25 dark:bg-cyan-400/10 dark:text-cyan-200"
            >
              {isLocalWalletLoading ? "저장 중" : "JSON 저장"}
            </button>
            <button
              type="button"
              onClick={() => void handleDeleteLocalWallet()}
              disabled={isLocalWalletLoading || !localWallet?.exists}
              className="h-7 border border-slate-200 bg-white text-[10px] font-bold text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              삭제
            </button>
          </div>
          {localWallet?.storageLabel ? (
            <div className="mt-1 truncate font-mono text-[9px] font-semibold text-slate-400">
              {localWallet.storageLabel}
            </div>
          ) : null}
          {localWalletError ? (
            <div className="mt-1 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] leading-4 text-rose-700 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-200">
              {localWalletError}
            </div>
          ) : null}
        </div>

        <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[9px] leading-4 text-amber-700 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-100">
          해커톤 로컬 테스트용입니다. 저장된 PK는 git에 들어가지 않는 <span className="font-mono">front/.local</span> JSON에만 보관됩니다.
        </div>
      </div>
    </section>
  );
}

export function ScwOnboardingPanel() {
  const { isConfigured, providerError } = usePrivyRuntime();

  if (!isConfigured) {
    return (
      <>
        <ScwOnboardingSetupNotice providerError={providerError} />
        <LocalEoaWalletPanel />
      </>
    );
  }

  return (
    <>
      <ScwOnboardingPanelContent />
      <LocalEoaWalletPanel />
    </>
  );
}
