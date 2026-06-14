import { useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, ShieldCheck, Wallet } from "lucide-react";
import { usePrivy, useWallets, type ConnectedWallet, type EIP1193Provider } from "@privy-io/react-auth";
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  numberToHex,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { createScwChain, getScwRpcUrl } from "@/shared/config/scwConfig";
import { cn } from "@/shared/utils/utils";
import { usePrivyRuntime } from "@/shared/providers/PrivyAppProvider";

const MANTLE_SEPOLIA_CHAIN_ID = 5003;
const MANTLE_SEPOLIA_RPC_URL = "https://rpc.sepolia.mantle.xyz";
const MANTLE_SEPOLIA_EXPLORER_URL = "https://explorer.sepolia.mantle.xyz";

const INPUT_TOKEN = getAddress("0x65CB9F57D82262F110831c9050b1a50A351dF9C7");
const OUTPUT_TOKEN = getAddress("0xdbb2E0E5c99aaf00638f35867df0F59ED4521E2C");
const MOCK_ROUTER = getAddress("0xE923d4dF4B7BF9e9423693cf9A02D87b7F1b5187");
const DEX_CALL_ADAPTER = getAddress("0x2ba41Cac5C209e0e252480a0d003B44dC33CDDfb");

const TRADE_AMOUNT = BigInt("1000000000000000000");
const MINT_AMOUNT = BigInt("10000000000000000000");

const MOCK_ERC20_ABI = parseAbi([
  "function mint(address to,uint256 amount)",
]);

const ERC20_ABI = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);

const MOCK_ROUTER_ABI = parseAbi([
  "function mockSwap(address inputToken,address outputToken,address recipient,uint256 amountIn,uint256 amountOut)",
]);

const DEX_CALL_ADAPTER_ABI = parseAbi([
  "function callDex(uint256 amountIn,uint256 minAmountOut,bytes routerCalldata)",
]);

function shortAddress(value?: string) {
  if (!value) return "-";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function txUrl(hash: string) {
  return `${MANTLE_SEPOLIA_EXPLORER_URL}/tx/${hash}`;
}

function getProviderErrorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  if (typeof code === "number") return code;
  if (typeof code === "string") return Number(code);
  return undefined;
}

function getErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/insufficient|fund|gas|balance/i.test(message)) {
    return `${message}\nPrivy EOA에 Mantle Sepolia MNT가 필요합니다: https://faucet.sepolia.mantle.xyz`;
  }
  return message;
}

async function ensureMantleSepolia(wallet: ConnectedWallet, provider: EIP1193Provider, rpcUrl: string) {
  const targetChainId = numberToHex(MANTLE_SEPOLIA_CHAIN_ID);

  if (wallet.chainId === `eip155:${MANTLE_SEPOLIA_CHAIN_ID}` || wallet.chainId === targetChainId) {
    return;
  }

  try {
    await wallet.switchChain(MANTLE_SEPOLIA_CHAIN_ID);
    return;
  } catch {
    // Some embedded wallet providers only expose the raw EIP-1193 chain methods.
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: targetChainId }],
    });
  } catch (error) {
    if (getProviderErrorCode(error) !== 4902) {
      throw error;
    }

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: targetChainId,
          chainName: "Mantle Sepolia Testnet",
          nativeCurrency: { decimals: 18, name: "MNT", symbol: "MNT" },
          rpcUrls: [rpcUrl],
          blockExplorerUrls: [MANTLE_SEPOLIA_EXPLORER_URL],
        },
      ],
    });
  }
}

function StatusPill({ authenticated, finalTxHash }: { authenticated: boolean; finalTxHash: string }) {
  const ready = authenticated && !finalTxHash;
  const done = Boolean(finalTxHash);
  const label = done ? "TX READY" : ready ? "EOA READY" : "LOGIN";

  return (
    <span
      className={cn(
        "inline-flex items-center border px-1.5 py-0.5 text-[9px] font-black uppercase",
        done
          ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200"
          : ready
            ? "border-cyan-300 bg-cyan-50 text-cyan-700 dark:border-cyan-400/30 dark:bg-cyan-400/10 dark:text-cyan-200"
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
          {providerError || "설정 후 Privy EOA로 Mantle Sepolia adapter tx를 실행할 수 있습니다."}
        </div>
      </div>
    </section>
  );
}

function TxLine({ label, txHash }: { label: string; txHash: string }) {
  if (!txHash) return null;

  return (
    <a
      href={txUrl(txHash)}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between gap-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[10px] leading-4 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-200 dark:hover:bg-emerald-400/15"
    >
      <span className="font-bold">{label}</span>
      <span className="inline-flex min-w-0 items-center gap-1 font-mono">
        <span className="truncate">{shortAddress(txHash)}</span>
        <ExternalLink className="h-3 w-3 shrink-0" />
      </span>
    </a>
  );
}

function ScwOnboardingPanelContent() {
  const { authenticated, connectWallet, error: privyError, login, logout, ready, user } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const primaryWallet = wallets[0] ?? null;
  const ownerAddress = primaryWallet?.address || user?.wallet?.address || "";
  const rpcUrl = getScwRpcUrl() || MANTLE_SEPOLIA_RPC_URL;
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [mintTxHash, setMintTxHash] = useState("");
  const [approveTxHash, setApproveTxHash] = useState("");
  const [adapterTxHash, setAdapterTxHash] = useState("");
  const [outputBalance, setOutputBalance] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  async function runAdapterSmokeTest() {
    if (!primaryWallet || !ownerAddress) {
      setError("실행할 Privy EOA 지갑을 먼저 연결해야 합니다.");
      return;
    }

    setError("");
    setPhase("Mantle Sepolia 전환 중");
    setMintTxHash("");
    setApproveTxHash("");
    setAdapterTxHash("");
    setOutputBalance("");
    setIsRunning(true);

    try {
      const initialProvider = await primaryWallet.getEthereumProvider();
      await ensureMantleSepolia(primaryWallet, initialProvider, rpcUrl);
      const provider = await primaryWallet.getEthereumProvider();
      const account = getAddress(ownerAddress);
      const chain = createScwChain(MANTLE_SEPOLIA_CHAIN_ID, rpcUrl);
      const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl),
      });
      const walletClient = createWalletClient({
        account,
        chain,
        transport: custom(provider),
      });

      setPhase(`inputToken mint ${formatEther(MINT_AMOUNT)}개`);
      const mintHash = await walletClient.writeContract({
        account,
        chain,
        address: INPUT_TOKEN,
        abi: MOCK_ERC20_ABI,
        functionName: "mint",
        args: [account, MINT_AMOUNT],
      });
      setMintTxHash(mintHash);
      await publicClient.waitForTransactionReceipt({ hash: mintHash });

      setPhase(`adapter approve ${formatEther(TRADE_AMOUNT)}개`);
      const approveHash = await walletClient.writeContract({
        account,
        chain,
        address: INPUT_TOKEN,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [DEX_CALL_ADAPTER, TRADE_AMOUNT],
      });
      setApproveTxHash(approveHash);
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      setPhase("router calldata 생성");
      const routerCalldata = encodeFunctionData({
        abi: MOCK_ROUTER_ABI,
        functionName: "mockSwap",
        args: [
          INPUT_TOKEN,
          OUTPUT_TOKEN,
          account,
          TRADE_AMOUNT,
          TRADE_AMOUNT,
        ],
      });

      setPhase("DexCallAdapter.callDex 실행");
      const adapterHash = await walletClient.writeContract({
        account,
        chain,
        address: DEX_CALL_ADAPTER,
        abi: DEX_CALL_ADAPTER_ABI,
        functionName: "callDex",
        args: [TRADE_AMOUNT, TRADE_AMOUNT, routerCalldata as Hex],
      });
      setAdapterTxHash(adapterHash);
      await publicClient.waitForTransactionReceipt({ hash: adapterHash });

      const nextOutputBalance = await publicClient.readContract({
        address: OUTPUT_TOKEN,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [account as Address],
      });
      setOutputBalance(formatEther(nextOutputBalance));
      setPhase("완료");
    } catch (caught) {
      setError(getErrorMessage(caught));
      setPhase("실패");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <section className="border-b border-slate-200 py-3 dark:border-slate-800">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
          <ShieldCheck className="h-3.5 w-3.5" />
          트레이딩 지갑
        </div>
        <StatusPill authenticated={authenticated} finalTxHash={adapterTxHash} />
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
          Privy로 EOA 연결
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
              <span className="font-mono font-bold text-slate-800 dark:text-slate-100">Mantle Sepolia 5003</span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
              <span className="font-semibold text-slate-500 dark:text-slate-400">Adapter</span>
              <span className="font-mono font-bold text-slate-800 dark:text-slate-100">
                {shortAddress(DEX_CALL_ADAPTER)}
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

          <button
            type="button"
            onClick={() => void runAdapterSmokeTest()}
            disabled={!primaryWallet || isRunning}
            className="inline-flex h-9 w-full items-center justify-center gap-1.5 border border-cyan-300 bg-cyan-50 text-[11px] font-black text-cyan-800 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-cyan-400/30 dark:bg-cyan-400/10 dark:text-cyan-100 dark:hover:bg-cyan-400/15"
          >
            {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Mantle EOA 테스트 실행
          </button>

          <div className="rounded bg-slate-50 px-2 py-1.5 text-[10px] font-semibold leading-4 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            {phase || "mint -> approve -> adapter.callDex 순서로 실행합니다."}
          </div>

          <div className="space-y-1">
            <TxLine label="Mint" txHash={mintTxHash} />
            <TxLine label="Approve" txHash={approveTxHash} />
            <TxLine label="Watch txHash" txHash={adapterTxHash} />
          </div>

          {adapterTxHash ? (
            <div className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[10px] leading-4 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-200">
              <div className="font-bold">ThirdEye/Watch에 넘길 최종 txHash</div>
              <div className="truncate font-mono">{adapterTxHash}</div>
              {outputBalance ? <div className="mt-0.5">outputToken balance: {outputBalance}</div> : null}
            </div>
          ) : null}

          {error ? (
            <div className="whitespace-pre-wrap rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] leading-4 text-rose-700 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-200">
              {error}
            </div>
          ) : null}

          <div className="space-y-0.5 text-[9px] font-semibold text-slate-400 dark:text-slate-500">
            <div className="truncate">RPC {rpcUrl}</div>
            <div className="truncate">input {shortAddress(INPUT_TOKEN)} · output {shortAddress(OUTPUT_TOKEN)}</div>
            <div className="truncate">router {shortAddress(MOCK_ROUTER)}</div>
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
