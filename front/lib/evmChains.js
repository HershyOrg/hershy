export const EVM_CHAINS = [
  { id: 'eth-mainnet', label: 'Ethereum Mainnet' },
  { id: 'base-mainnet', label: 'Base Mainnet' },
  { id: 'arb-mainnet', label: 'Arbitrum One' },
  { id: 'opt-mainnet', label: 'Optimism Mainnet' },
  { id: 'polygon-mainnet', label: 'Polygon PoS' },
  { id: 'bsc-mainnet', label: 'BNB Smart Chain' },
];

export const DEFAULT_EVM_CHAIN = EVM_CHAINS[0].id;

export const normalizeEVMAddress = (value) => (
  typeof value === 'string' ? value.trim() : ''
);

export const isValidEVMAddress = (value) => (
  /^0x[a-fA-F0-9]{40}$/.test(normalizeEVMAddress(value))
);

export const getEVMChainLabel = (chainId) => (
  EVM_CHAINS.find((chain) => chain.id === chainId)?.label || chainId
);

export async function fetchVerifiedContractABI({ chain, address, explorerApiKey = '' }) {
  const trimmedExplorerAPIKey = typeof explorerApiKey === 'string' ? explorerApiKey.trim() : '';
  const response = await fetch('/api/evm/abi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chain,
      address,
      explorer_api_key: trimmedExplorerAPIKey
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `ABI lookup failed (${response.status})`);
  }
  return payload;
}
