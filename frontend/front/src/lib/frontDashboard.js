export const DEFAULT_CARD_WIDTH = 320;
export const DEFAULT_CARD_HEIGHT = 240;
export const MIN_CARD_WIDTH = 200;
export const MIN_CARD_HEIGHT = 140;
export const GRID_GAP = 16;
export const FRONT_CANVAS_PADDING = 12;
export const DEFAULT_COLUMNS = 3;
export const SNAPSHOT_PAGE_SIZE = 4;

export const getActionParamStatus = (params) => {
  const resolved = Array.isArray(params) ? params : [];
  const missing = resolved.filter((param) => {
    const hasValue = param?.value !== undefined && param?.value !== null && String(param.value).trim() !== '';
    const hasSource = Boolean(param?.source);
    const needsField = param?.source
      && param.source.blockType === 'monitoring'
      && !param.source.field;
    return !(hasValue || (hasSource && !needsField));
  });
  return {
    isReady: missing.length === 0,
    missingCount: missing.length
  };
};

export const formatTriggerType = (triggerType) => {
  switch (triggerType) {
    case 'time':
      return '시간 조건';
    case 'condition':
      return '조건식';
    case 'manual':
      return '수동';
    default:
      return '조건';
  }
};

export const sourceKey = (source) => (
  source ? `${source.blockId || ''}:${source.field || ''}` : ''
);

export const normalizeSource = (source) => {
  if (!source) {
    return null;
  }
  return {
    blockId: source.blockId,
    blockName: source.blockName,
    blockType: source.blockType,
    field: source.field
  };
};

export const mergeSources = (sources, source) => {
  const resolved = Array.isArray(sources) ? sources : [];
  if (!source) {
    return resolved;
  }
  const key = sourceKey(source);
  if (resolved.some((item) => sourceKey(item) === key)) {
    return resolved;
  }
  return [...resolved, source];
};

export const getSourceLabel = (source, blocks) => {
  if (!source) {
    return '';
  }
  const block = blocks.find((item) => item.id === source.blockId);
  const name = source.blockName || block?.name || source.blockId;
  if (source.field) {
    const base = `${name}::${source.field}`;
    return source.mode === 'snapshot' ? `${base} (스냅샷)` : base;
  }
  return source.mode === 'snapshot' ? `${name} (스냅샷)` : name;
};

export const mergeOrder = (prev, items) => {
  const next = prev.filter((id) => items.some((item) => item.id === id));
  items.forEach((item) => {
    if (!next.includes(item.id)) {
      next.push(item.id);
    }
  });
  return next;
};

export const getDefaultLayout = (index) => {
  const col = index % DEFAULT_COLUMNS;
  const row = Math.floor(index / DEFAULT_COLUMNS);
  return {
    x: col * (DEFAULT_CARD_WIDTH + GRID_GAP),
    y: row * (DEFAULT_CARD_HEIGHT + GRID_GAP),
    width: DEFAULT_CARD_WIDTH,
    height: DEFAULT_CARD_HEIGHT
  };
};

export const formatSnapshotTime = (value) => {
  if (!value) {
    return '';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString('ko-KR');
};

export const buildSnapshotEntries = (block, fields) => {
  const records = Array.isArray(block.previewRecords)
    ? block.previewRecords
    : (Array.isArray(block.snapshots) ? block.snapshots : []);

  if (records.length > 0) {
    return records.map((record, index) => ({
      id: record.id || `${block.id}-snapshot-${index}`,
      index: record.seq ?? record.sequence ?? record.serial ?? record.index ?? index + 1,
      timestamp: formatSnapshotTime(
        record.timestamp || record.time || record.createdAt || record.updatedAt
      ),
      values: fields.reduce((acc, field) => {
        acc[field] = record[field] ?? record.values?.[field] ?? '--';
        return acc;
      }, {})
    }));
  }

  const fallbackValues = fields.reduce((acc, field) => {
    acc[field] = block.previewValues?.[field] ?? '--';
    return acc;
  }, {});

  return [{
    id: `${block.id}-snapshot-latest`,
    index: 1,
    timestamp: formatSnapshotTime(block.previewTimestamp || block.lastUpdated) || '방금',
    values: fallbackValues
  }];
};
