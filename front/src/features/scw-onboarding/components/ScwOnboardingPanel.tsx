import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import { useCreateWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { usePrivyRuntime } from "@/shared/providers/PrivyAppProvider";
import { BSC_CHAIN_ID } from "../utils/bscCallExecutor";
import {
  confirmScwOnboardingAction,
  createNewScwPolicyId,
  createScwPolicyId,
  fetchScwOnboardingList,
  fetchScwOnboardingStatus,
  prepareScwOnboarding,
} from "../api/scwOnboardingClient";
import { getScwChainId, getScwRpcUrl } from "@/shared/config/scwConfig";
import type { HexString, ScwNextAction, ScwOnboardingStatus } from "../types/scwOnboardingTypes";
import {
  executeScwOnboardingAction,
  getConfirmKindForAction,
  readSafeProxyCreationAddress,
} from "../utils/safeActionExecutor";

type ScwOnboardingPanelProps = {
  onManage?: () => void;
};

type ScwOnboardingManagerModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

function shortAddress(value?: string) {
  if (!value) return "-";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function sameAddress(a?: string, b?: string) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

function isPrivyEmbeddedWallet(wallet: { walletClientType?: string } | null | undefined) {
  return wallet?.walletClientType === "privy";
}

function smartWalletAddressFromUser(user: unknown) {
  const maybeUser = user as { smartWallet?: { address?: string } } | null;
  return maybeUser?.smartWallet?.address || "";
}

function bscScanAddressUrl(address?: string) {
  return address ? `https://bscscan.com/address/${address}` : "";
}

function formatScwError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "SCW request failed");
  if (message.includes("safe singleton address required")) {
    return "온보딩 서버가 Safe 주소 없이 실행 중입니다. --safe-singleton, --safe-factory, --safe-fallback-handler 값을 넣고 서버를 다시 켜주세요.";
  }
  if (message.includes("Failed to fetch")) {
    return "온보딩 서버에 연결할 수 없습니다. 127.0.0.1:18081 서버가 켜져 있는지 확인해주세요.";
  }
  return message;
}

function getScwTestVerdict(status: ScwOnboardingStatus | null) {
  if (!status) {
    return {
      label: "미검증",
      className: "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400",
      description: "SCW validate를 실행하면 서버 저장 상태와 온체인 상태를 확인합니다.",
    };
  }

  const hasAddress = Boolean(status.smart_wallet_address);
  const isDeployed = Boolean(status.smart_wallet_deployed || (status.smart_wallet_code_size ?? 0) > 0);
  const moduleReady = Boolean(status.module_enabled);
  const sessionReady = Boolean(status.session_policy_active || status.session_policy_valid || status.ready_for_relay);

  if (!hasAddress) {
    return {
      label: "주소 없음",
      className: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-200",
      description: "서버가 이 policy의 SCW 주소를 찾지 못했습니다. 먼저 현재 SCW를 저장하세요.",
    };
  }

  if (!isDeployed) {
    return {
      label: "미배포",
      className: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200",
      description: "SCW 주소는 저장됐지만 온체인 코드가 아직 없습니다. 배포 또는 첫 트랜잭션이 필요할 수 있습니다.",
    };
  }

  if (!moduleReady || !sessionReady) {
    return {
      label: "부분 유효",
      className: "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-400/25 dark:bg-cyan-400/10 dark:text-cyan-200",
      description: "SCW는 배포되어 있습니다. 자동 실행까지 쓰려면 module/session 권한 상태를 추가 확인해야 합니다.",
    };
  }

  return {
    label: "유효",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-200",
    description: "SCW 배포와 module/session 정책이 유효합니다.",
  };
}

function StatusCheckRow({ label, value }: { label: string; value?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className={value ? "text-emerald-600 dark:text-emerald-300" : "text-slate-400"}>
        {value ? "OK" : "-"}
      </span>
    </div>
  );
}

function findDeployAction(actions: ScwNextAction[] = []) {
  return actions.find((action) => action.id.toLowerCase().includes("deploy"));
}

function ScwSetupCard({ providerError = "" }: { providerError?: string }) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-3 text-[11px] leading-5 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
      <div className="font-black text-slate-800 dark:text-slate-100">
        {providerError ? "Privy 초기화 실패" : "Privy 설정 필요"}
      </div>
      <div className="mt-1 font-mono text-[10px]">VITE_PRIVY_APP_ID</div>
      <div className="mt-1">
        {providerError || "설정 후 지갑 연결 관리에서 SCW 온보딩을 진행할 수 있습니다."}
      </div>
    </div>
  );
}

function ScwOnboardingSetupSummary({ onManage, providerError = "" }: ScwOnboardingPanelProps & { providerError?: string }) {
  return (
    <section className="border-b border-slate-200 py-3 dark:border-slate-800">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
          <ShieldCheck className="h-3.5 w-3.5" />
          트레이딩 지갑
        </div>
        <span className="border border-slate-200 px-1.5 py-0.5 text-[9px] font-black uppercase text-slate-500 dark:border-slate-700 dark:text-slate-400">
          setup
        </span>
      </div>
      <div className="rounded border border-slate-200 bg-slate-50 px-2 py-2 text-[10px] leading-4 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
        <div className="font-bold text-slate-800 dark:text-slate-100">
          {providerError ? "Privy 초기화 실패" : "Privy 설정 필요"}
        </div>
        <div className="mt-1 truncate font-mono">VITE_PRIVY_APP_ID</div>
      </div>
      <button
        type="button"
        onClick={onManage}
        className="mt-2 h-8 w-full border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
      >
        지갑 연결 관리
      </button>
    </section>
  );
}

function ScwOnboardingSummary({ onManage }: ScwOnboardingPanelProps) {
  const { authenticated, error: privyError, ready, user } = usePrivy();
  const { client } = useSmartWallets();
  const { wallets } = useWallets();
  const primaryWallet = wallets[0] ?? null;
  const ownerAddress = primaryWallet?.address || user?.wallet?.address || "";
  const smartWalletAddress = client?.account?.address || smartWalletAddressFromUser(user);
  const statusLabel = !ready
    ? "확인 중"
    : privyError
      ? "오류"
      : !authenticated
        ? "로그인 필요"
        : smartWalletAddress
          ? "준비됨"
          : "SCW 필요";
  const statusTone = smartWalletAddress
    ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200"
    : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200";

  return (
    <section className="border-b border-slate-200 py-3 dark:border-slate-800">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
          <ShieldCheck className="h-3.5 w-3.5" />
          트레이딩 지갑
        </div>
        <span className={["border px-1.5 py-0.5 text-[9px] font-black uppercase", statusTone].join(" ")}>
          {statusLabel}
        </span>
      </div>

      <div className="rounded border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-950">
        <div className="grid grid-cols-[42px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[10px]">
          <span className="font-bold text-slate-400">Owner</span>
          <span className="truncate font-mono font-black text-slate-800 dark:text-slate-100">
            {shortAddress(ownerAddress)}
          </span>
          <span className="font-bold text-slate-400">SCW</span>
          <span className="truncate font-mono font-black text-slate-800 dark:text-slate-100">
            {shortAddress(smartWalletAddress)}
          </span>
        </div>
        <div className="mt-1.5 truncate text-[9px] font-semibold text-slate-400">
          BSC {BSC_CHAIN_ID} · Privy Safe
        </div>
      </div>

      {privyError ? (
        <div className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] leading-4 text-rose-700 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-200">
          {privyError.message}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onManage}
        className="mt-2 h-8 w-full border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
      >
        지갑 연결 관리
      </button>
    </section>
  );
}

function ScwOnboardingManagerContent() {
  const { authenticated, connectWallet, error: privyError, login, logout, ready, user } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { wallets, ready: walletsReady } = useWallets();
  const { client, getClientForChain } = useSmartWallets();
  const primaryWallet = wallets[0] ?? null;
  const embeddedWallet = wallets.find(isPrivyEmbeddedWallet) ?? null;
  const ownerAddress = primaryWallet?.address || user?.wallet?.address || "";
  const smartWalletAddress = client?.account?.address || smartWalletAddressFromUser(user);
  const [managedWallets, setManagedWallets] = useState<ScwOnboardingStatus[]>([]);
  const [scwActionsByPolicy, setScwActionsByPolicy] = useState<Record<string, ScwNextAction[]>>({});
  const [selectedPolicyId, setSelectedPolicyId] = useState("");
  const [scwRegistryError, setScwRegistryError] = useState("");
  const [scwRegistryNotice, setScwRegistryNotice] = useState("");
  const [isScwListLoading, setIsScwListLoading] = useState(false);
  const [isScwCreating, setIsScwCreating] = useState(false);
  const [isCurrentScwSyncing, setIsCurrentScwSyncing] = useState(false);
  const [isDeploymentRecovering, setIsDeploymentRecovering] = useState(false);
  const [pendingPermissionActionId, setPendingPermissionActionId] = useState("");
  const [isScwTesting, setIsScwTesting] = useState(false);
  const [deploymentTxHash, setDeploymentTxHash] = useState("");
  const [scwTestStatus, setScwTestStatus] = useState<ScwOnboardingStatus | null>(null);
  const activeSavedWallet = selectedPolicyId
    ? managedWallets.find((wallet) => wallet.policy_id === selectedPolicyId)
    : managedWallets.find((wallet) => sameAddress(wallet.smart_wallet_address, smartWalletAddress));
  const activeScwAddress = activeSavedWallet?.smart_wallet_address || (selectedPolicyId ? "" : smartWalletAddress);
  const activePolicyId = activeSavedWallet?.policy_id || selectedPolicyId || (activeScwAddress ? createScwPolicyId(activeScwAddress) : "");
  const currentScwPolicyId = smartWalletAddress ? createScwPolicyId(smartWalletAddress) : "";
  const activeActions = activePolicyId ? scwActionsByPolicy[activePolicyId] ?? [] : [];
  const permissionActions = activeActions.filter((action) => {
    const id = action.id.toLowerCase();
    return id.includes("module") || id.includes("grant") || id.includes("session");
  });
  const canPreparePermissionActions = Boolean(activePolicyId && activeScwAddress && permissionActions.length === 0);
  const isActiveScwSaved = managedWallets.some((wallet) =>
    wallet.policy_id === activePolicyId || sameAddress(wallet.smart_wallet_address, activeScwAddress),
  );
  const scwTestVerdict = getScwTestVerdict(scwTestStatus);
  const walletStage = !authenticated
    ? "login"
    : !embeddedWallet
      ? "owner"
      : smartWalletAddress
        ? "ready"
        : "create";
  const walletStageLabel = walletStage === "ready"
    ? "READY"
    : walletStage === "login"
      ? "LOGIN"
      : walletStage === "owner"
        ? "OWNER"
        : "CREATE";
  const walletStageHint = walletStage === "ready"
    ? isActiveScwSaved
      ? "선택한 SCW가 온보딩 서버에 저장되어 있습니다."
      : "현재 Privy SCW를 저장하거나 새 SCW를 생성하세요."
    : walletStage === "login"
      ? "Privy 로그인 후 SCW를 만들 수 있습니다."
      : walletStage === "owner"
        ? "SCW 생성을 위한 Privy owner wallet을 먼저 만듭니다."
        : "현재 Privy SCW를 동기화하거나 신규 Safe SCW를 생성합니다.";
  const currentScwButtonLabel = !authenticated
    ? "Privy 로그인"
    : !embeddedWallet
      ? "Owner Wallet 생성"
      : currentScwPolicyId && managedWallets.some((wallet) => wallet.policy_id === currentScwPolicyId)
        ? "현재 SCW 다시 저장"
        : "현재 SCW 서버 저장";

  const refreshScwList = useCallback(async (nextSelectedPolicyId?: string) => {
    if (!ownerAddress) {
      setManagedWallets([]);
      setScwActionsByPolicy({});
      setSelectedPolicyId("");
      return [];
    }

    setIsScwListLoading(true);
    setScwRegistryError("");
    setScwRegistryNotice("");
    try {
      const response = await fetchScwOnboardingList(ownerAddress, { includeActions: true });
      const items = response.items ?? [];
      const wallets = items
        .map((item) => item.status)
        .filter((status): status is ScwOnboardingStatus => Boolean(status?.policy_id || status?.smart_wallet_address));
      const actionsByPolicy = items.reduce<Record<string, ScwNextAction[]>>((acc, item) => {
        if (item.status?.policy_id) {
          acc[item.status.policy_id] = item.next_actions ?? [];
        }
        return acc;
      }, {});
      setManagedWallets(wallets);
      setScwActionsByPolicy(actionsByPolicy);
      setSelectedPolicyId((current) => {
        if (nextSelectedPolicyId && wallets.some((wallet) => wallet.policy_id === nextSelectedPolicyId)) return nextSelectedPolicyId;
        if (current && wallets.some((wallet) => wallet.policy_id === current)) return current;
        const currentPrivyWallet = wallets.find((wallet) => sameAddress(wallet.smart_wallet_address, smartWalletAddress));
        if (currentPrivyWallet?.policy_id) return currentPrivyWallet.policy_id;
        return wallets[0]?.policy_id || "";
      });
      return wallets;
    } catch (error) {
      setScwRegistryError(formatScwError(error));
      return [];
    } finally {
      setIsScwListLoading(false);
    }
  }, [ownerAddress, smartWalletAddress]);

  useEffect(() => {
    void refreshScwList();
  }, [refreshScwList]);

  useEffect(() => {
    if (!ownerAddress || !smartWalletAddress) return;
    void prepareScwOnboarding(ownerAddress, smartWalletAddress, currentScwPolicyId)
      .then(() => refreshScwList(currentScwPolicyId))
      .catch((error) => {
        setScwRegistryError(formatScwError(error));
      });
  }, [currentScwPolicyId, ownerAddress, refreshScwList, smartWalletAddress]);

  useEffect(() => {
    setScwTestStatus(null);
  }, [activePolicyId, activeScwAddress]);

  async function handleSyncCurrentScw() {
    if (!ready) return;
    if (!authenticated) {
      login();
      return;
    }
    if (!ownerAddress) {
      setScwRegistryError("Privy owner wallet is not ready yet.");
      return;
    }

    setIsCurrentScwSyncing(true);
    setScwRegistryError("");
    setScwRegistryNotice("");
    try {
      if (!embeddedWallet) {
        await createWallet();
        setScwRegistryNotice("Privy owner wallet을 만들었습니다. 잠시 후 SCW 생성 버튼을 한 번 더 눌러주세요.");
        return;
      }

      const smartWalletClient = client || await getClientForChain({ id: BSC_CHAIN_ID });
      const nextScwAddress = smartWalletClient?.account?.address;
      if (!nextScwAddress) {
        throw new Error(
          "Privy smart wallet client is not ready. BSC smart wallet dashboard 설정과 bundler URL을 확인해주세요.",
        );
      }

      const policyId = createScwPolicyId(nextScwAddress);
      await prepareScwOnboarding(ownerAddress, nextScwAddress, policyId);
      await refreshScwList(policyId);
      setScwRegistryNotice(
        managedWallets.some((wallet) => wallet.policy_id === policyId)
          ? "현재 Privy SCW를 다시 동기화했습니다."
          : "현재 Privy SCW가 온보딩 서버에 저장되었습니다.",
      );
    } catch (error) {
      setScwRegistryError(formatScwError(error));
    } finally {
      setIsCurrentScwSyncing(false);
    }
  }

  async function handleCreateNewScw() {
    if (!ready) return;
    if (!authenticated) {
      login();
      return;
    }
    if (!ownerAddress) {
      setScwRegistryError("Privy owner wallet is not ready yet.");
      return;
    }

    setIsScwCreating(true);
    setScwRegistryError("");
    setScwRegistryNotice("");
    let submittedTxHash = "";
    try {
      if (!embeddedWallet) {
        await createWallet();
        setScwRegistryNotice("Privy owner wallet을 만들었습니다. 잠시 후 새 SCW 생성을 한 번 더 눌러주세요.");
        return;
      }

      const newPolicyId = createNewScwPolicyId();
      const prepared = await prepareScwOnboarding(ownerAddress, undefined, newPolicyId);
      const deployAction = findDeployAction(prepared.next_actions);
      if (!deployAction) {
        await refreshScwList(newPolicyId);
        setScwRegistryNotice("새 SCW 생성 요청을 저장했습니다. 배포 action이 준비되면 목록에서 validate하세요.");
        return;
      }

      if (!primaryWallet) {
        await refreshScwList(newPolicyId);
        setScwRegistryNotice("새 SCW 배포 action을 만들었습니다. owner wallet 연결 후 다시 실행해주세요.");
        return;
      }

      const execution = await executeScwOnboardingAction({
        wallet: primaryWallet,
        ownerAddress,
        action: deployAction.action,
        rpcUrl: getScwRpcUrl(),
        chainId: getScwChainId(),
      });
      submittedTxHash = execution.txHash;
      const deployedScwAddress = await readSafeProxyCreationAddress({
        chainId: getScwChainId(),
        factoryAddress: deployAction.action.to,
        rpcUrl: getScwRpcUrl(),
        txHash: execution.txHash,
      });

      const confirmed = await confirmScwOnboardingAction({
        owner_address: ownerAddress,
        policy_id: newPolicyId,
        kind: getConfirmKindForAction(deployAction.id),
        tx_hash: execution.txHash,
        smart_wallet_address: deployedScwAddress || prepared.status?.smart_wallet_address || deployAction.action.safe || undefined,
      });
      await refreshScwList(confirmed.status?.policy_id || newPolicyId);
      setScwTestStatus(confirmed.status || null);
      setScwRegistryNotice("새 SCW 배포 트랜잭션이 완료되고 서버에 등록되었습니다.");
    } catch (error) {
      const message = formatScwError(error);
      setScwRegistryError(submittedTxHash ? `${message} (tx: ${shortAddress(submittedTxHash)})` : message);
    } finally {
      setIsScwCreating(false);
    }
  }

  async function handleSyncSelectedScw() {
    if (!ownerAddress || !activePolicyId) return;

    setScwRegistryError("");
    setScwRegistryNotice("");
    try {
      await prepareScwOnboarding(ownerAddress, activeScwAddress || undefined, activePolicyId);
      await refreshScwList(activePolicyId);
      setScwRegistryNotice("선택한 SCW를 서버 상태와 동기화했습니다.");
    } catch (error) {
      setScwRegistryError(formatScwError(error));
    }
  }

  async function handleTestSelectedScw() {
    if (!ownerAddress || !activePolicyId) {
      setScwRegistryError("검증할 SCW가 없습니다. 먼저 SCW를 저장하세요.");
      return;
    }

    setIsScwTesting(true);
    setScwRegistryError("");
    setScwRegistryNotice("");
    try {
      const response = await fetchScwOnboardingStatus(ownerAddress, activeScwAddress || undefined, activePolicyId);
      const status = response.status || null;
      setScwTestStatus(status);
      if (status) {
        setManagedWallets((current) => {
          const next = current.map((wallet) =>
            sameAddress(wallet.smart_wallet_address, status.smart_wallet_address) || wallet.policy_id === status.policy_id
              ? { ...wallet, ...status }
              : wallet,
          );
          return next.some((wallet) => wallet.policy_id === status.policy_id || sameAddress(wallet.smart_wallet_address, status.smart_wallet_address))
            ? next
            : [...next, status];
        });
      }
    } catch (error) {
      setScwTestStatus(null);
      setScwRegistryError(formatScwError(error));
    } finally {
      setIsScwTesting(false);
    }
  }

  async function handleRecoverDeploymentFromTx() {
    const txHash = deploymentTxHash.trim();
    if (!ownerAddress || !activePolicyId) {
      setScwRegistryError("복구할 SCW policy가 없습니다.");
      return;
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      setScwRegistryError("BSC 배포 tx hash를 0x 형식으로 입력해주세요.");
      return;
    }

    setIsDeploymentRecovering(true);
    setScwRegistryError("");
    setScwRegistryNotice("");
    try {
      const prepared = await prepareScwOnboarding(ownerAddress, activeScwAddress || undefined, activePolicyId);
      const deployAction = findDeployAction(prepared.next_actions);
      if (!deployAction) {
        throw new Error("이 policy에서 deploy action을 찾지 못했습니다.");
      }
      const deployedScwAddress = await readSafeProxyCreationAddress({
        chainId: getScwChainId(),
        factoryAddress: deployAction.action.to,
        rpcUrl: getScwRpcUrl(),
        txHash: txHash as HexString,
      });
      if (!deployedScwAddress) {
        throw new Error("tx receipt에서 Safe ProxyCreation 이벤트를 찾지 못했습니다.");
      }

      const confirmed = await confirmScwOnboardingAction({
        owner_address: ownerAddress,
        policy_id: activePolicyId,
        kind: getConfirmKindForAction(deployAction.id),
        tx_hash: txHash as HexString,
        smart_wallet_address: deployedScwAddress,
      });
      await refreshScwList(activePolicyId);
      setScwTestStatus(confirmed.status || null);
      setDeploymentTxHash("");
      setScwRegistryNotice(`배포된 SCW ${shortAddress(deployedScwAddress)}를 서버에 반영했습니다.`);
    } catch (error) {
      setScwRegistryError(formatScwError(error));
    } finally {
      setIsDeploymentRecovering(false);
    }
  }

  async function handleExecutePermissionAction(nextAction: ScwNextAction) {
    if (!ownerAddress || !activePolicyId || !activeScwAddress) {
      setScwRegistryError("권한 action을 실행할 SCW가 없습니다.");
      return;
    }
    if (!primaryWallet) {
      setScwRegistryError("owner wallet 연결이 필요합니다.");
      return;
    }
    if (!nextAction.action) {
      setScwRegistryError("실행할 action data가 없습니다.");
      return;
    }

    setPendingPermissionActionId(nextAction.id);
    setScwRegistryError("");
    setScwRegistryNotice("");
    try {
      const execution = await executeScwOnboardingAction({
        wallet: primaryWallet,
        ownerAddress,
        action: nextAction.action,
        rpcUrl: getScwRpcUrl(),
        chainId: getScwChainId(),
      });

      const confirmed = await confirmScwOnboardingAction({
        owner_address: ownerAddress,
        policy_id: activePolicyId,
        kind: getConfirmKindForAction(nextAction.id),
        tx_hash: execution.txHash,
        smart_wallet_address: activeScwAddress,
      });
      await refreshScwList(activePolicyId);
      setScwTestStatus(confirmed.status || null);
      setScwRegistryNotice(`${nextAction.label || nextAction.id} 실행이 완료되었습니다.`);
    } catch (error) {
      setScwRegistryError(formatScwError(error));
    } finally {
      setPendingPermissionActionId("");
    }
  }

  return (
    <div className="space-y-3">
      {!ready ? (
        <div className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Privy 초기화 중
        </div>
      ) : null}

      {privyError ? (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-200">
          Privy 오류: {privyError.message}
        </div>
      ) : null}

      {ready && !authenticated ? (
        <button
          type="button"
          onClick={() => login()}
          className="h-10 w-full rounded-lg border border-cyan-300 bg-cyan-50 text-sm font-black text-cyan-800 shadow-sm shadow-cyan-900/5 hover:bg-cyan-100 dark:border-cyan-400/25 dark:bg-cyan-400/10 dark:text-cyan-100"
        >
          Privy로 지갑 시작하기
        </button>
      ) : null}

      {ready && authenticated ? (
        <>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-black text-slate-900 dark:text-slate-50">
                  {walletStage === "ready" ? "SCW 연결 완료" : "SCW 준비"}
                </div>
                <div className="mt-0.5 truncate text-[11px] font-semibold text-slate-400">
                  BSC {BSC_CHAIN_ID} · Privy Safe
                </div>
              </div>
              <span
                className={[
                  "shrink-0 rounded border px-2 py-1 text-[10px] font-black",
                  walletStage === "ready"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200"
                    : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200",
                ].join(" ")}
              >
                {walletStageLabel}
              </span>
            </div>

            <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
              <span className="font-bold text-slate-400">Owner</span>
              <span className="truncate font-mono font-black text-slate-800 dark:text-slate-100">
                {ownerAddress || "-"}
              </span>
              <span className="font-bold text-slate-400">SCW</span>
              <span className="truncate font-mono font-black text-slate-800 dark:text-slate-100">
                {activeScwAddress || (selectedPolicyId ? "배포 대기" : "-")}
              </span>
            </div>

            <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold leading-5 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              {walletStageHint}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => void handleSyncCurrentScw()}
              disabled={isCurrentScwSyncing || isScwCreating || !ready}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-cyan-300 bg-cyan-50 text-sm font-black text-cyan-800 transition hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-cyan-400/25 dark:bg-cyan-400/10 dark:text-cyan-100"
            >
              {isCurrentScwSyncing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {currentScwButtonLabel}
            </button>

            <button
              type="button"
              onClick={() => void handleCreateNewScw()}
              disabled={isScwCreating || isCurrentScwSyncing || !ready}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 text-sm font-black text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-100"
            >
              {isScwCreating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              새 SCW 생성
            </button>

            {!walletsReady || !primaryWallet ? (
              <button
                type="button"
                onClick={() => connectWallet()}
                className="h-10 rounded-md border border-slate-200 bg-white text-sm font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
              >
                외부 지갑 연결
              </button>
            ) : (
              <button
                type="button"
                onClick={() => logout()}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white text-sm font-bold text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
              >
                <Wallet className="h-4 w-4" />
                로그아웃
              </button>
            )}
          </div>

          {scwRegistryNotice ? (
            <div className="flex gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold leading-5 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-200">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {scwRegistryNotice}
            </div>
          ) : null}

          {scwRegistryError ? (
            <div className="flex gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold leading-5 text-rose-700 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-200">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {scwRegistryError}
            </div>
          ) : null}

          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-black text-slate-800 dark:text-slate-100">내 SCW</div>
                <div className="mt-0.5 text-[11px] font-semibold text-slate-400">
                  owner 기준 저장된 트레이딩 지갑 목록
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {activePolicyId ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleSyncSelectedScw()}
                      className="h-7 rounded border border-slate-200 px-2 text-[10px] font-black text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-900"
                    >
                      sync
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleTestSelectedScw()}
                      disabled={isScwTesting}
                      className="inline-flex h-7 items-center gap-1 rounded border border-cyan-200 px-2 text-[10px] font-black text-cyan-700 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-cyan-400/25 dark:text-cyan-200 dark:hover:bg-cyan-400/10"
                    >
                      {isScwTesting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      validate
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={() => void refreshScwList()}
                  disabled={isScwListLoading}
                  className="inline-flex h-7 items-center gap-1 rounded border border-slate-200 px-2 text-[10px] font-black text-slate-500 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-900"
                >
                  <RefreshCw className={["h-3 w-3", isScwListLoading ? "animate-spin" : ""].join(" ")} />
                  {managedWallets.length}
                </button>
              </div>
            </div>

            {managedWallets.length > 0 ? (
              <div className="space-y-2">
                <select
                  value={selectedPolicyId}
                  onChange={(event) => setSelectedPolicyId(event.target.value)}
                  className="h-9 w-full rounded border border-slate-200 bg-slate-50 px-3 font-mono text-xs text-slate-700 outline-none focus:border-cyan-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <option value="">현재 SCW</option>
                  {managedWallets.map((wallet) => (
                    <option key={wallet.policy_id || wallet.smart_wallet_address} value={wallet.policy_id || ""}>
                      {wallet.smart_wallet_address ? shortAddress(wallet.smart_wallet_address) : "배포 대기"} · {wallet.state || "saved"}
                    </option>
                  ))}
                </select>
                <div className="rounded bg-slate-50 px-3 py-2 font-mono text-[11px] font-semibold leading-5 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  policy {activePolicyId || "-"}
                </div>
                {permissionActions.length > 0 ? (
                  <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-2 text-xs font-semibold text-cyan-800 dark:border-cyan-400/25 dark:bg-cyan-400/10 dark:text-cyan-100">
                    <div className="mb-1.5 font-black">권한 실행</div>
                    <div className="space-y-1.5">
                      {permissionActions.map((action) => (
                        <button
                          key={action.id}
                          type="button"
                          onClick={() => void handleExecutePermissionAction(action)}
                          disabled={Boolean(pendingPermissionActionId)}
                          className="flex min-h-9 w-full items-center justify-between gap-2 rounded border border-cyan-300 bg-white/70 px-2 py-1.5 text-left text-[11px] font-black text-cyan-800 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-cyan-400/25 dark:bg-slate-950/30 dark:text-cyan-100 dark:hover:bg-slate-950/50"
                        >
                          <span className="min-w-0">
                            <span className="block truncate">{action.label || action.id}</span>
                            {action.description ? (
                              <span className="block truncate text-[9px] font-semibold opacity-70">
                                {action.description}
                              </span>
                            ) : null}
                          </span>
                          {pendingPermissionActionId === action.id ? (
                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                          ) : (
                            <span className="shrink-0 text-[9px] uppercase opacity-70">run</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : canPreparePermissionActions ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs font-semibold text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-100">
                    <div className="mb-1 text-[11px] font-black">권한 action이 아직 없습니다</div>
                    <div className="mb-2 text-[10px] leading-4 opacity-80">
                      배포된 SCW 주소로 module/session action을 생성해야 합니다.
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleSyncSelectedScw()}
                      className="inline-flex h-8 items-center justify-center rounded border border-amber-300 bg-white/70 px-2 text-[10px] font-black text-amber-800 hover:bg-white dark:border-amber-400/25 dark:bg-slate-950/30 dark:text-amber-100 dark:hover:bg-slate-950/50"
                    >
                      권한 action 생성
                    </button>
                  </div>
                ) : activePolicyId ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                    실행 가능한 권한 action이 없습니다. `validate`로 module/session 상태를 확인하세요.
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs font-semibold leading-5 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                저장된 SCW가 없습니다. 현재 Privy SCW를 저장하거나 새 SCW를 생성하세요.
              </div>
            )}

            {scwTestStatus ? (
              <div className={["mt-3 rounded-lg border px-3 py-2 text-xs font-semibold leading-5", scwTestVerdict.className].join(" ")}>
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className="font-black">SCW Validate 결과</span>
                  <span className="rounded bg-white/60 px-2 py-0.5 text-[10px] font-black dark:bg-slate-950/40">
                    {scwTestVerdict.label}
                  </span>
                </div>
                <div>{scwTestVerdict.description}</div>
                <div className="mt-2 grid gap-1 rounded bg-white/50 px-2 py-1.5 font-mono text-[10px] dark:bg-slate-950/30">
                  <div className="truncate">scw {shortAddress(scwTestStatus.smart_wallet_address || activeScwAddress)}</div>
                  <div className="truncate">state {scwTestStatus.state || "-"}</div>
                  <div className="truncate">policy {scwTestStatus.policy_id || activePolicyId}</div>
                  <div className="truncate">code_size {scwTestStatus.smart_wallet_code_size ?? "-"}</div>
                </div>
                <div className="mt-2 grid gap-1 font-mono text-[10px]">
                  <StatusCheckRow label="bundle" value={scwTestStatus.bundle_exists} />
                  <StatusCheckRow
                    label="deployed"
                    value={Boolean(scwTestStatus.smart_wallet_deployed || (scwTestStatus.smart_wallet_code_size ?? 0) > 0)}
                  />
                  <StatusCheckRow label="module" value={scwTestStatus.module_enabled} />
                  <StatusCheckRow
                    label="session"
                    value={Boolean(scwTestStatus.session_policy_active || scwTestStatus.session_policy_valid || scwTestStatus.ready_for_relay)}
                  />
                </div>
                {scwTestStatus.error ? (
                  <div className="mt-2 rounded border border-current/20 bg-white/50 px-2 py-1.5 font-mono text-[10px] leading-4 dark:bg-slate-950/30">
                    error {scwTestStatus.error}
                  </div>
                ) : null}
                {!scwTestStatus.smart_wallet_address ? (
                  <div className="mt-2 rounded border border-current/20 bg-white/50 p-2 dark:bg-slate-950/30">
                    <div className="mb-1 text-[10px] font-black">배포 tx hash로 주소 복구</div>
                    <div className="flex flex-col gap-1.5 sm:flex-row">
                      <input
                        value={deploymentTxHash}
                        onChange={(event) => setDeploymentTxHash(event.target.value)}
                        placeholder="0x..."
                        spellCheck={false}
                        className="min-w-0 flex-1 rounded border border-current/20 bg-white/70 px-2 py-1.5 font-mono text-[10px] outline-none focus:border-current/50 dark:bg-slate-950/40"
                      />
                      <button
                        type="button"
                        onClick={() => void handleRecoverDeploymentFromTx()}
                        disabled={isDeploymentRecovering || !deploymentTxHash.trim()}
                        className="inline-flex h-8 items-center justify-center gap-1 rounded border border-current/25 bg-white/60 px-2 text-[10px] font-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-950/40 dark:hover:bg-slate-950/60"
                      >
                        {isDeploymentRecovering ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                        복구
                      </button>
                    </div>
                  </div>
                ) : null}
                {bscScanAddressUrl(scwTestStatus.smart_wallet_address || activeScwAddress) ? (
                  <a
                    href={bscScanAddressUrl(scwTestStatus.smart_wallet_address || activeScwAddress)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex h-7 items-center rounded border border-current/25 bg-white/50 px-2 text-[10px] font-black hover:bg-white/80 dark:bg-slate-950/30 dark:hover:bg-slate-950/50"
                  >
                    BscScan에서 보기
                  </a>
                ) : null}
                {scwTestStatus.checked_at ? (
                  <div className="mt-2 text-[10px] opacity-70">checked {scwTestStatus.checked_at}</div>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function ScwOnboardingPanel({ onManage }: ScwOnboardingPanelProps) {
  const { isConfigured, providerError } = usePrivyRuntime();

  if (!isConfigured) {
    return <ScwOnboardingSetupSummary onManage={onManage} providerError={providerError} />;
  }

  return <ScwOnboardingSummary onManage={onManage} />;
}

export function ScwOnboardingManagerModal({ isOpen, onClose }: ScwOnboardingManagerModalProps) {
  const { isConfigured, providerError } = usePrivyRuntime();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
      <section className="flex max-h-[86vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
              Trading Wallet
            </div>
            <h2 className="mt-1 text-xl font-black tracking-[-0.02em] text-slate-950 dark:text-slate-50">
              지갑 연결 관리
            </h2>
            <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
              Privy owner와 BSC SCW 온보딩 상태를 여기서 관리합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-900 dark:hover:text-slate-200"
            title="지갑 연결 관리 닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto p-5">
          {isConfigured ? (
            <ScwOnboardingManagerContent />
          ) : (
            <ScwSetupCard providerError={providerError} />
          )}
        </div>
      </section>
    </div>
  );
}
