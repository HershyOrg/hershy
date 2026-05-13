const flattenJsonFields = (value, prefix = '') => {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return prefix ? [prefix] : [];
    }
    const first = value[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      return flattenJsonFields(first, prefix);
    }
    return prefix ? [prefix] : [];
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return prefix ? [prefix] : [];
    }
    return keys.flatMap((key) => {
      const nextPrefix = prefix ? `${prefix}::${key}` : key;
      return flattenJsonFields(value[key], nextPrefix);
    });
  }

  return prefix ? [prefix] : [];
};

export const parseJsonFields = (rawValue) => {
  const trimmed = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);
    return flattenJsonFields(parsed);
  } catch {
    return [];
  }
};

const normalizeFields = (fields) => (
  Array.isArray(fields)
    ? fields.filter((field) => typeof field === 'string' && field.trim() !== '')
    : []
);

export async function sampleStreamDefinition({
  streamKind = 'url',
  apiUrl = '',
  streamChain = '',
  streamMethod = '',
  streamParamsJson = '[]',
  responseSchema = '',
  fields = [],
  authContext = null
} = {}) {
  const response = await fetch('/api/stream/sample', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stream_kind: streamKind,
      source_url: apiUrl,
      stream_chain: streamChain,
      stream_method: streamMethod,
      stream_params_json: streamParamsJson,
      response_schema: responseSchema,
      fields: normalizeFields(fields),
      auth_context: authContext && typeof authContext === 'object' ? authContext : undefined
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `stream sample failed (${response.status})`);
  }
  return payload;
}
