export const DEFAULT_POLYMARKET_CHAIN_ID = '137';

export const POLYMARKET_SIDE_OPTIONS = [
  { value: 'BUY', label: '매수' },
  { value: 'SELL', label: '매도' },
];

export const POLYMARKET_ORDER_TYPE_OPTIONS = [
  { value: 'GTC', label: 'GTC' },
  { value: 'FAK', label: 'FAK' },
  { value: 'FOK', label: 'FOK' },
];

export const POLYMARKET_PARAM_DEFS = [
  { name: 'tokenId', placeholder: 'Polymarket token_id' },
  { name: 'side', placeholder: 'BUY/SELL' },
  { name: 'price', placeholder: '0.52' },
  { name: 'size', placeholder: '10' },
  { name: 'orderType', placeholder: 'GTC/FAK/FOK' },
  { name: 'postOnly', placeholder: 'true/false (optional)' },
];

const stringifyParamValue = (value, fallback = '') => {
  if (value === true) {
    return 'true';
  }
  if (value === false) {
    return 'false';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return fallback;
  }
  return String(value);
};

export function buildPolymarketParams(values = {}) {
  const tokenId = stringifyParamValue(values.tokenId, '');
  const side = stringifyParamValue(values.side, 'BUY') || 'BUY';
  const price = stringifyParamValue(values.price, '');
  const size = stringifyParamValue(values.size, '');
  const orderType = stringifyParamValue(values.orderType, 'GTC') || 'GTC';
  const postOnly = stringifyParamValue(values.postOnly, 'false') || 'false';

  return POLYMARKET_PARAM_DEFS.map((definition) => ({
    name: definition.name,
    placeholder: definition.placeholder,
    value: ({
      tokenId,
      side,
      price,
      size,
      orderType,
      postOnly,
    })[definition.name] || '',
    source: null,
    sources: [],
  }));
}

export function getActionParam(parameters = [], name, fallback = null) {
  return (Array.isArray(parameters) ? parameters : []).find((param) => param?.name === name) || fallback;
}

export function getActionParamValue(parameters = [], name, fallback = '') {
  const parameter = getActionParam(parameters, name);
  return stringifyParamValue(parameter?.value, fallback);
}

export function updateNamedActionParam(parameters = [], name, updates = {}) {
  const definitions = new Map(POLYMARKET_PARAM_DEFS.map((definition) => [definition.name, definition]));
  const resolved = Array.isArray(parameters) ? [...parameters] : [];
  const index = resolved.findIndex((param) => param?.name === name);
  const definition = definitions.get(name);
  const current = index >= 0
    ? resolved[index]
    : {
        name,
        value: '',
        placeholder: definition?.placeholder || '',
        source: null,
        sources: [],
      };
  const next = {
    ...current,
    ...updates,
    name,
    placeholder: updates.placeholder || current.placeholder || definition?.placeholder || '',
  };
  if (!Array.isArray(next.sources)) {
    next.sources = Array.isArray(current.sources) ? current.sources : [];
  }
  if (index >= 0) {
    resolved[index] = next;
  } else {
    resolved.push(next);
  }
  return resolved;
}
