export const MAX_SNAPSHOT_RECORDS = 30;

const buildSnapshotValue = (field, seq, previousValues = {}) => {
  const lower = field.toLowerCase();
  if (lower.includes('time') || lower.includes('date')) {
    return new Date().toISOString();
  }
  if (lower.includes('symbol')) {
    return 'BTCUSDT';
  }
  if (lower.includes('address')) {
    return `0x${Math.random().toString(16).slice(2, 10)}`;
  }
  const prevRaw = previousValues[field];
  const prevNumber = Number(prevRaw);
  if (Number.isFinite(prevNumber)) {
    const jitter = (Math.random() - 0.5) * Math.max(1, Math.abs(prevNumber) * 0.02);
    return Number((prevNumber + jitter).toFixed(4));
  }
  if (
    lower.includes('price')
    || lower.includes('amount')
    || lower.includes('volume')
    || lower.includes('value')
    || lower.includes('rate')
  ) {
    const nextValue = 100 + seq * 0.7 + Math.random() * 5;
    return Number(nextValue.toFixed(4));
  }
  if (lower.includes('id')) {
    return `${seq}`;
  }
  return `${field}-${seq}`;
};

export const buildSnapshotValues = (fields, seq, previousValues) => (
  fields.reduce((acc, field) => {
    acc[field] = buildSnapshotValue(field, seq, previousValues);
    return acc;
  }, {})
);
