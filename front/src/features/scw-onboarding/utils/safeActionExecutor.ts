import type { ConnectedWallet, EIP1193Provider } from "@privy-io/react-auth";
import {
  concatHex,
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  numberToHex,
  padHex,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import type {
  ScwActionExecutionResult,
  ScwTransactionAction,
} from "../types/scwOnboardingTypes";

const SAFE_ABI = parseAbi([
  "function nonce() view returns (uint256)",
  "function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce) view returns (bytes32)",
  "function approveHash(bytes32 hashToApprove)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool success)",
]);

const BSC_CHAIN_ID = 56;

function normalizeAddress(value: string, label: string): Address {
  if (!isAddress(value)) {
    throw new Error(`${label} is not a valid EVM address`);
  }

  return getAddress(value);
}

function normalizeHex(value: string, label: string): Hex {
  if (!/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new Error(`${label} is not valid hex data`);
  }

  return value as Hex;
}

function createChain(chainId: number, rpcUrl: string) {
  return defineChain({
    id: chainId,
    name: chainId === BSC_CHAIN_ID ? "BNB Smart Chain" : `EVM ${chainId}`,
    nativeCurrency: chainId === BSC_CHAIN_ID
      ? { decimals: 18, name: "BNB", symbol: "BNB" }
      : { decimals: 18, name: "Native Token", symbol: "ETH" },
    rpcUrls: {
      default: { http: [rpcUrl] },
    },
    blockExplorers: chainId === BSC_CHAIN_ID
      ? {
          default: {
            name: "BscScan",
            url: "https://bscscan.com",
          },
        }
      : undefined,
  });
}

function approvedHashSignature(owner: Address): Hex {
  return concatHex([
    padHex(owner, { size: 32 }),
    padHex("0x", { size: 32 }),
    "0x01",
  ]);
}

async function ensureWalletChain(wallet: ConnectedWallet, provider: EIP1193Provider, chainId: number, rpcUrl: string) {
  const targetChainId = numberToHex(chainId);

  if (wallet.chainId === `eip155:${chainId}` || wallet.chainId === targetChainId) {
    return;
  }

  try {
    await wallet.switchChain(chainId);
    return;
  } catch {
    // Fall back to raw EIP-1193 methods for wallets that do not expose Privy's switch helper.
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: targetChainId }],
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error
      ? Number((error as { code?: unknown }).code)
      : undefined;
    if (chainId !== BSC_CHAIN_ID || code !== 4902) {
      throw error;
    }

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: targetChainId,
          chainName: "BNB Smart Chain",
          nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
          rpcUrls: [rpcUrl],
          blockExplorerUrls: ["https://bscscan.com"],
        },
      ],
    });
  }
}

function getActionKind(actionId: string) {
  const normalized = actionId.toLowerCase();

  if (normalized.includes("deploy")) return "deploy";
  if (normalized.includes("module")) return "enable_module";
  if (normalized.includes("grant") || normalized.includes("session")) return "grant_session_key";

  return normalized;
}

export function getConfirmKindForAction(actionId: string) {
  return getActionKind(actionId);
}

type ExecuteScwOnboardingActionInput = {
  wallet: ConnectedWallet;
  ownerAddress: string;
  action: ScwTransactionAction;
  rpcUrl: string;
  chainId: number;
};

export async function executeScwOnboardingAction({
  wallet,
  ownerAddress,
  action,
  rpcUrl,
  chainId,
}: ExecuteScwOnboardingActionInput): Promise<ScwActionExecutionResult> {
  const initialProvider = await wallet.getEthereumProvider();
  await ensureWalletChain(wallet, initialProvider, chainId, rpcUrl);
  const provider = await wallet.getEthereumProvider();

  const chain = createChain(action.chain_id ?? chainId, rpcUrl);
  const owner = normalizeAddress(ownerAddress, "owner address");
  const to = normalizeAddress(action.to, "action target");
  const data = normalizeHex(action.data, "action data");
  const value = BigInt(action.value || "0");
  const walletClient = createWalletClient({
    account: owner,
    chain,
    transport: custom(provider),
  });
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  if (!action.safe) {
    const txHash = await walletClient.sendTransaction({
      account: owner,
      chain,
      to,
      data,
      value,
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    return {
      txHash,
      mode: "direct",
    };
  }

  const safe = normalizeAddress(action.safe, "safe address");
  const operation = action.operation ?? 0;
  const safeTxGas = BigInt(0);
  const baseGas = BigInt(0);
  const gasPrice = BigInt(0);
  const nonce = await publicClient.readContract({
    address: safe,
    abi: SAFE_ABI,
    functionName: "nonce",
  });
  const safeTxHash = await publicClient.readContract({
    address: safe,
    abi: SAFE_ABI,
    functionName: "getTransactionHash",
    args: [
      to,
      value,
      data,
      operation,
      safeTxGas,
      baseGas,
      gasPrice,
      zeroAddress,
      zeroAddress,
      nonce,
    ],
  });
  const approvalTxHash = await walletClient.writeContract({
    account: owner,
    chain,
    address: safe,
    abi: SAFE_ABI,
    functionName: "approveHash",
    args: [safeTxHash],
  });
  await publicClient.waitForTransactionReceipt({ hash: approvalTxHash });

  const execData = encodeFunctionData({
    abi: SAFE_ABI,
    functionName: "execTransaction",
    args: [
      to,
      value,
      data,
      operation,
      safeTxGas,
      baseGas,
      gasPrice,
      zeroAddress,
      zeroAddress,
      approvedHashSignature(owner),
    ],
  });
  const safeExecTxHash = await walletClient.sendTransaction({
    account: owner,
    chain,
    to: safe,
    data: execData,
    value: BigInt(0),
  });
  await publicClient.waitForTransactionReceipt({ hash: safeExecTxHash });

  return {
    txHash: safeExecTxHash,
    approvalTxHash,
    safeExecTxHash,
    mode: "safe",
  };
}
