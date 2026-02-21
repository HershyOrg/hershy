export const AUTH_PROVIDER_META = {
  binance: {
    id: 'binance',
    label: 'Binance',
    description: 'Binance Spot 주문용 사전인증',
    credentials: [
      {
        key: 'apiKey',
        label: 'API Key',
        placeholder: 'binance-api-key',
        secret: false,
        required: true
      },
      {
        key: 'hmacSecret',
        label: 'HMAC Secret',
        placeholder: 'binance-hmac-secret',
        secret: true,
        required: true
      }
    ]
  },
  polymarket: {
    id: 'polymarket',
    label: 'Polymarket',
    description: 'Polymarket CLOB 주문용 사전인증 (L1/L2)',
    credentials: [
      {
        key: 'privateKey',
        label: 'L1 Private Key',
        placeholder: '0x...',
        secret: true,
        required: true
      },
      {
        key: 'funder',
        label: 'L1 Funder',
        placeholder: '0x...',
        secret: false,
        required: true
      },
      {
        key: 'apiKey',
        label: 'L2 API Key (선택)',
        placeholder: 'polymarket-api-key',
        secret: false,
        required: false
      },
      {
        key: 'apiSecret',
        label: 'L2 API Secret (선택)',
        placeholder: 'polymarket-api-secret',
        secret: true,
        required: false
      },
      {
        key: 'apiPassphrase',
        label: 'L2 API Passphrase (선택)',
        placeholder: 'polymarket-api-passphrase',
        secret: true,
        required: false
      },
      {
        key: 'chainId',
        label: 'Chain ID (선택)',
        placeholder: '137',
        secret: false,
        required: false
      }
    ]
  },
  evm: {
    id: 'evm',
    label: 'EVM Web3',
    description: 'EVM 컨트랙트 호출/트랜잭션용 사전인증',
    credentials: [
      {
        key: 'eoaPrivateKey',
        label: 'EOA Private Key',
        placeholder: '0x...',
        secret: true,
        required: true
      },
      {
        key: 'rpcUrl',
        label: 'RPC URL (선택)',
        placeholder: 'https://eth-mainnet.g.alchemy.com/v2/...',
        secret: false,
        required: false
      },
      {
        key: 'alchemyApiKey',
        label: 'Alchemy API Key (선택)',
        placeholder: 'alchemy-api-key',
        secret: true,
        required: false
      },
      {
        key: 'explorerApiKey',
        label: 'Explorer API Key (선택)',
        placeholder: 'etherscan-family-api-key',
        secret: true,
        required: false
      }
    ]
  }
};

export const AUTH_PROVIDER_IDS = Object.keys(AUTH_PROVIDER_META);

const buildCredentialDefaults = (providerId) => {
  const meta = AUTH_PROVIDER_META[providerId];
  const credentialDefs = Array.isArray(meta?.credentials) ? meta.credentials : [];
  return credentialDefs.reduce((acc, field) => {
    acc[field.key] = '';
    return acc;
  }, {});
};

export const createEmptyProviderAuth = (providerId) => ({
  credentials: buildCredentialDefaults(providerId),
  authenticated: false,
  verifiedAt: null
});

export const createEmptyActionAuthState = () => (
  AUTH_PROVIDER_IDS.reduce((acc, providerId) => {
    acc[providerId] = createEmptyProviderAuth(providerId);
    return acc;
  }, {})
);

const normalizeText = (value) => (
  typeof value === 'string' ? value.trim().toLowerCase() : ''
);

const isFilled = (value) => (
  typeof value === 'string' && value.trim() !== ''
);

const hasPolymarketL2Bundle = (credentials = {}) => {
  const apiKey = isFilled(credentials.apiKey);
  const apiSecret = isFilled(credentials.apiSecret);
  const apiPassphrase = isFilled(credentials.apiPassphrase);
  const anyFilled = apiKey || apiSecret || apiPassphrase;
  const allFilled = apiKey && apiSecret && apiPassphrase;
  return {
    anyFilled,
    allFilled
  };
};

const hasEVMRPCConfig = (credentials = {}) => (
  isFilled(credentials.rpcUrl) || isFilled(credentials.alchemyApiKey)
);

export const resolveActionAuthRequirement = (action = {}) => {
  const actionType = normalizeText(action.actionType || 'cex');

  if (actionType === 'cex') {
    const exchange = normalizeText(action.exchange);
    if (exchange === 'binance') {
      return AUTH_PROVIDER_META.binance;
    }
    return null;
  }

  if (actionType === 'dex') {
    const protocol = normalizeText(action.dexProtocol);
    const apiUrl = normalizeText(action.apiUrl);
    if (protocol === 'polymarket' || apiUrl.includes('polymarket')) {
      return AUTH_PROVIDER_META.polymarket;
    }
    if (protocol === 'evm' || protocol === 'evm-contract') {
      return AUTH_PROVIDER_META.evm;
    }
  }

  return null;
};

export const getProviderCredentials = (authState, providerId) => {
  const defaults = buildCredentialDefaults(providerId);
  const raw = authState?.[providerId] || {};
  const credentials = {
    ...defaults,
    ...(raw?.credentials || {})
  };

  // Backward compatibility for previous single-field shape.
  if ('credentialId' in raw && !credentials.apiKey && typeof raw?.credentialId === 'string') {
    credentials.apiKey = raw.credentialId;
  }
  if ('apiKey' in defaults && !credentials.apiKey && typeof raw?.apiKey === 'string') {
    credentials.apiKey = raw.apiKey;
  }
  if ('hmacSecret' in defaults && !credentials.hmacSecret && typeof raw?.hmacSecret === 'string') {
    credentials.hmacSecret = raw.hmacSecret;
  }
  if ('privateKey' in defaults && !credentials.privateKey && typeof raw?.privateKey === 'string') {
    credentials.privateKey = raw.privateKey;
  }
  if ('funder' in defaults && !credentials.funder && typeof raw?.funder === 'string') {
    credentials.funder = raw.funder;
  }
  if ('apiSecret' in defaults && !credentials.apiSecret && typeof raw?.apiSecret === 'string') {
    credentials.apiSecret = raw.apiSecret;
  }
  if ('apiPassphrase' in defaults && !credentials.apiPassphrase && typeof raw?.apiPassphrase === 'string') {
    credentials.apiPassphrase = raw.apiPassphrase;
  }
  if ('chainId' in defaults && !credentials.chainId && typeof raw?.chainId === 'string') {
    credentials.chainId = raw.chainId;
  }
  if ('explorerApiKey' in defaults && !credentials.explorerApiKey && typeof raw?.explorerApiKey === 'string') {
    credentials.explorerApiKey = raw.explorerApiKey;
  }

  return credentials;
};

export const hasRequiredProviderCredentials = (authState, providerId) => {
  const meta = AUTH_PROVIDER_META[providerId];
  const credentialDefs = Array.isArray(meta?.credentials) ? meta.credentials : [];
  if (credentialDefs.length === 0) {
    return false;
  }

  const credentials = getProviderCredentials(authState, providerId);

  const requiredFields = credentialDefs.filter((field) => field.required !== false);
  const hasRequired = requiredFields.every((field) => isFilled(credentials[field.key]));
  if (!hasRequired) {
    return false;
  }

  if (providerId === 'polymarket') {
    const l2State = hasPolymarketL2Bundle(credentials);
    if (l2State.anyFilled && !l2State.allFilled) {
      return false;
    }
  }
  if (providerId === 'evm') {
    return hasEVMRPCConfig(credentials);
  }

  return true;
};

export const isProviderAuthorized = (authState, providerId) => (
  Boolean(authState?.[providerId]?.authenticated)
  && hasRequiredProviderCredentials(authState, providerId)
);
