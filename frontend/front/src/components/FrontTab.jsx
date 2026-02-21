import { useEffect, useMemo, useRef, useState } from 'react';
import './FrontTab.css';
import './front/FrontActionCard.css';
import { StreamingSearchMonitor, StreamingTableMonitor } from './monitors/StreamingMonitor';
import KeyValueCard from './front/KeyValueCard';
import { isProviderAuthorized, resolveActionAuthRequirement } from '../lib/actionAuth';

const getActionParamStatus = (params) => {
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

const formatTriggerType = (triggerType) => {
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

const sourceKey = (source) => (
  source ? `${source.blockId || ''}:${source.field || ''}` : ''
);

const normalizeSource = (source) => {
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

const mergeSources = (sources, source) => {
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

const getSourceLabel = (source, blocks) => {
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

const mergeOrder = (prev, items) => {
  const next = prev.filter((id) => items.some((item) => item.id === id));
  items.forEach((item) => {
    if (!next.includes(item.id)) {
      next.push(item.id);
    }
  });
  return next;
};

const DEFAULT_CARD_WIDTH = 320;
const DEFAULT_CARD_HEIGHT = 240;
const MIN_CARD_WIDTH = 200;
const MIN_CARD_HEIGHT = 140;
const GRID_GAP = 16;
const FRONT_CANVAS_PADDING = 12;
const DEFAULT_COLUMNS = 3;
const SNAPSHOT_PAGE_SIZE = 4;

const getDefaultLayout = (index) => {
  const col = index % DEFAULT_COLUMNS;
  const row = Math.floor(index / DEFAULT_COLUMNS);
  return {
    x: col * (DEFAULT_CARD_WIDTH + GRID_GAP),
    y: row * (DEFAULT_CARD_HEIGHT + GRID_GAP),
    width: DEFAULT_CARD_WIDTH,
    height: DEFAULT_CARD_HEIGHT
  };
};

const formatSnapshotTime = (value) => {
  if (!value) {
    return '';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString('ko-KR');
};

const buildSnapshotEntries = (block, fields) => {
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

export default function FrontTab({
  blocks = [],
  connections = [],
  onUpdateBlock,
  authState = {}
}) {
  const triggerBlocks = useMemo(
    () => blocks.filter((block) => block.type === 'trigger'),
    [blocks]
  );
  const actionBlocks = useMemo(
    () => blocks.filter((block) => block.type === 'action'),
    [blocks]
  );
  const monitoringBlocks = useMemo(
    () => blocks.filter((block) => block.type === 'monitoring'),
    [blocks]
  );
  const streamingBlocks = useMemo(
    () => blocks.filter((block) => block.type === 'streaming'),
    [blocks]
  );

  const triggerActionLinks = useMemo(() => (
    connections.filter((connection) => connection.kind === 'trigger-action')
  ), [connections]);

  const dashboardItems = useMemo(() => {
    const items = [];
    monitoringBlocks.forEach((block) => {
      items.push({ id: `monitor:${block.id}`, kind: 'monitor', block });
    });
    triggerBlocks.forEach((block) => {
      items.push({ id: `trigger:${block.id}`, kind: 'trigger', block });
    });
    actionBlocks.forEach((block) => {
      items.push({ id: `action:${block.id}`, kind: 'action', block });
    });
    return items;
  }, [monitoringBlocks, triggerBlocks, actionBlocks]);

  const itemsById = useMemo(() => {
    const map = new Map();
    dashboardItems.forEach((item) => map.set(item.id, item));
    return map;
  }, [dashboardItems]);

  const [dashboardOrder, setDashboardOrder] = useState([]);
  const [snapshotPageById, setSnapshotPageById] = useState({});
  const [searchQueryById, setSearchQueryById] = useState({});
  const [compactActions, setCompactActions] = useState({});
  const dashboardRef = useRef(null);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const resizeRef = useRef(null);

  useEffect(() => {
    setDashboardOrder((prev) => mergeOrder(prev, dashboardItems));
  }, [dashboardItems]);

  useEffect(() => {
    const handlePointerMove = (event) => {
      if (resizeRef.current) {
        const { blockId, startX, startY, startWidth, startHeight, axis } = resizeRef.current;
        const allowX = axis !== 'y';
        const allowY = axis !== 'x';
        const nextWidth = Math.max(
          MIN_CARD_WIDTH,
          allowX ? startWidth + (event.clientX - startX) : startWidth
        );
        const nextHeight = Math.max(
          MIN_CARD_HEIGHT,
          allowY ? startHeight + (event.clientY - startY) : startHeight
        );
        onUpdateBlock?.(blockId, {
          frontSize: {
            width: Math.round(nextWidth),
            height: Math.round(nextHeight)
          }
        });
        return;
      }

      if (dragRef.current) {
        const { blockId, startX, startY, originX, originY } = dragRef.current;
        const nextX = Math.max(0, originX + (event.clientX - startX));
        const nextY = Math.max(0, originY + (event.clientY - startY));
        onUpdateBlock?.(blockId, {
          frontPosition: {
            x: Math.round(nextX),
            y: Math.round(nextY)
          }
        });
      }
    };

    const handlePointerUp = () => {
      resizeRef.current = null;
      dragRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [onUpdateBlock]);

  const orderedItems = dashboardOrder
    .map((id) => itemsById.get(id))
    .filter(Boolean);

  const getBlockLayout = (block, index) => {
    const fallback = getDefaultLayout(index);
    return {
      x: block?.frontPosition?.x ?? fallback.x,
      y: block?.frontPosition?.y ?? fallback.y,
      width: block?.frontSize?.width ?? fallback.width,
      height: block?.frontSize?.height ?? fallback.height
    };
  };

  const layoutData = useMemo(() => {
    const map = new Map();
    let maxX = 0;
    let maxY = 0;
    orderedItems.forEach((item, index) => {
      if (!item?.block) {
        return;
      }
      const layout = getBlockLayout(item.block, index);
      map.set(item.id, layout);
      maxX = Math.max(maxX, layout.x + layout.width);
      maxY = Math.max(maxY, layout.y + layout.height);
    });
    return {
      map,
      width: Math.max(maxX + FRONT_CANVAS_PADDING * 2, DEFAULT_CARD_WIDTH),
      height: Math.max(maxY + FRONT_CANVAS_PADDING * 2, DEFAULT_CARD_HEIGHT)
    };
  }, [orderedItems]);

  const linkPaths = useMemo(() => {
    if (triggerActionLinks.length === 0) {
      return [];
    }
    return triggerActionLinks
      .map((link) => {
        const triggerLayout = layoutData.map.get(`trigger:${link.fromId}`);
        const actionLayout = layoutData.map.get(`action:${link.toId}`);
        if (!triggerLayout || !actionLayout) {
          return null;
        }
        const startX = triggerLayout.x + triggerLayout.width;
        const startY = triggerLayout.y + triggerLayout.height / 2;
        const endX = actionLayout.x;
        const endY = actionLayout.y + actionLayout.height / 2;
        const midX = startX + (endX - startX) / 2;
        const d = `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} L ${endX} ${endY}`;
        return {
          id: link.id || `${link.fromId}-${link.toId}`,
          d
        };
      })
      .filter(Boolean);
  }, [layoutData, triggerActionLinks]);

  useEffect(() => {
    orderedItems.forEach((item, index) => {
      if (!item?.block) {
        return;
      }
      const fallback = getDefaultLayout(index);
      const updates = {};
      if (!item.block.frontPosition) {
        updates.frontPosition = { x: fallback.x, y: fallback.y };
      }
      if (!item.block.frontSize) {
        updates.frontSize = { width: fallback.width, height: fallback.height };
      }
      if (Object.keys(updates).length > 0) {
        onUpdateBlock?.(item.block.id, updates);
      }
    });
  }, [orderedItems, onUpdateBlock]);

  const updateActionParam = (actionId, paramIndex, updates) => {
    const actionBlock = actionBlocks.find((block) => block.id === actionId);
    if (!actionBlock) {
      return;
    }
    const params = Array.isArray(actionBlock.parameters) ? actionBlock.parameters : [];
    const nextParams = params.map((param, index) => (
      index === paramIndex
        ? {
            ...param,
            ...updates,
            sources: Array.isArray(updates.sources)
              ? updates.sources
              : mergeSources(Array.isArray(param.sources) ? param.sources : [], normalizeSource(updates.source ?? param.source))
          }
        : param
    ));
    onUpdateBlock?.(actionId, { parameters: nextParams });
  };

  const updateContractAddress = (actionId, updates) => {
    const actionBlock = actionBlocks.find((block) => block.id === actionId);
    if (!actionBlock) {
      return;
    }
    const baseSources = Array.isArray(actionBlock.contractAddressSources)
      ? actionBlock.contractAddressSources
      : [];
    const nextSource = normalizeSource(updates.contractAddressSource ?? actionBlock.contractAddressSource);
    const nextSources = Array.isArray(updates.contractAddressSources)
      ? updates.contractAddressSources
      : mergeSources(baseSources, nextSource);
    onUpdateBlock?.(actionId, { ...updates, contractAddressSources: nextSources });
  };

  const applyMonitoringValue = (monitorBlock, field, mode, snapshotValueOverride, snapshotId) => {
    const resolvedMode = mode || 'live';
    const snapshotValue = snapshotValueOverride ?? monitorBlock?.previewValues?.[field] ?? '스냅샷값';
    const matchesSource = (source) => (
      source?.blockId === monitorBlock.id
      && (!source?.field || source.field === field)
    );
    actionBlocks.forEach((action) => {
      const params = Array.isArray(action.parameters) ? action.parameters : [];
      let changed = false;
      const nextParams = params.map((param) => {
        const sourceMatch = matchesSource(param?.source)
          ? param.source
          : (Array.isArray(param?.sources) ? param.sources.find(matchesSource) : null);
        if (!sourceMatch) {
          return param;
        }
        changed = true;
        const nextSource = { ...sourceMatch, field, mode: resolvedMode };
        if (resolvedMode === 'snapshot' && snapshotId) {
          nextSource.snapshotId = snapshotId;
        }
        return {
          ...param,
          source: nextSource,
          value: resolvedMode === 'snapshot' ? snapshotValue : '',
          valueOrigin: resolvedMode === 'snapshot' ? 'front' : null
        };
      });
      const updates = {};
      if (changed) {
        updates.parameters = nextParams;
      }
      const addressSources = Array.isArray(action.contractAddressSources)
        ? action.contractAddressSources
        : [];
      const addressMatch = matchesSource(action?.contractAddressSource)
        ? action.contractAddressSource
        : addressSources.find(matchesSource);
      if (addressMatch) {
        const nextContractSource = { ...addressMatch, field, mode: resolvedMode };
        if (resolvedMode === 'snapshot' && snapshotId) {
          nextContractSource.snapshotId = snapshotId;
        }
        updates.contractAddressSource = nextContractSource;
        updates.contractAddress = resolvedMode === 'snapshot' ? snapshotValue : '';
      }
      if (Object.keys(updates).length > 0) {
        onUpdateBlock?.(action.id, updates);
      }
    });
  };

  const handleDragStart = (blockId, layout) => (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      blockId,
      startX: event.clientX,
      startY: event.clientY,
      originX: layout.x,
      originY: layout.y
    };
  };

  const handleResizeStart = (blockId, layout, axis = 'both') => (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = {
      blockId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: layout.width,
      startHeight: layout.height,
      axis
    };
  };

  const renderMonitoringItem = (block) => {
    const sourceBlock = streamingBlocks.find((stream) => stream.id === block.connectedStreamId);
    const sourceName = block.connectedStream || sourceBlock?.name || 'SOURCE';
    const fields = Array.isArray(block.fields) ? block.fields : [];
    const updateSpeed = sourceBlock?.updateMode === 'live'
      ? '실시간'
      : `${sourceBlock?.updateInterval || 1000}ms`;
    const visibleFields = `${fields.length}/${fields.length || 0}`;
    const snapshotView = block.snapshotView || (block.monitorType === 'search' ? 'card' : 'list');
    const snapshotEntries = buildSnapshotEntries(block, fields);
    const searchQuery = searchQueryById[block.id] || '';
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const filteredEntries = block.monitorType === 'search' && normalizedQuery
      ? snapshotEntries.filter((entry) => (
          fields.some((field) => {
            const value = entry.values?.[field];
            return String(value ?? '').toLowerCase().includes(normalizedQuery);
          })
        ))
      : snapshotEntries;
    const totalRecords = filteredEntries.length;
    const totalPages = Math.max(1, Math.ceil(totalRecords / SNAPSHOT_PAGE_SIZE));
    const currentPage = Math.min(snapshotPageById[block.id] || 1, totalPages);
    const startIndex = (currentPage - 1) * SNAPSHOT_PAGE_SIZE;
    const pagedEntries = filteredEntries.slice(startIndex, startIndex + SNAPSHOT_PAGE_SIZE);
    const sharedProps = {
      name: block.name || block.id,
      source: sourceName,
      visibleFields,
      updateSpeed,
      totalRecords,
      totalPages,
      currentPage,
      viewMode: snapshotView,
      onViewModeChange: (nextView) => (
        onUpdateBlock?.(block.id, { snapshotView: nextView })
      ),
      onPageChange: (nextPage) => (
        setSnapshotPageById((prev) => ({ ...prev, [block.id]: nextPage }))
      )
    };
    const searchProps = {
      searchQuery,
      onSearchChange: (nextQuery) => {
        setSearchQueryById((prev) => ({ ...prev, [block.id]: nextQuery }));
        setSnapshotPageById((prev) => ({ ...prev, [block.id]: 1 }));
      }
    };
    const mappedFieldSet = new Set();
    actionBlocks.forEach((action) => {
      (Array.isArray(action.parameters) ? action.parameters : []).forEach((param) => {
        if (param?.source?.blockId === block.id && param.source.field) {
          mappedFieldSet.add(param.source.field);
        }
      });
      if (action?.contractAddressSource?.blockId === block.id && action.contractAddressSource.field) {
        mappedFieldSet.add(action.contractAddressSource.field);
      }
    });
    const mappedFields = Array.from(mappedFieldSet).filter((field) => fields.includes(field));
    const hasSingleMappedField = mappedFields.length === 1;
    const singleMappedField = hasSingleMappedField ? mappedFields[0] : null;

    const isSnapshotSelected = (entryId) => (
      actionBlocks.some((action) => (
        (Array.isArray(action.parameters) ? action.parameters : []).some((param) => (
          param?.source?.blockId === block.id
          && param?.source?.mode === 'snapshot'
          && param?.source?.snapshotId === entryId
        ))
        || (
          action?.contractAddressSource?.blockId === block.id
          && action?.contractAddressSource?.mode === 'snapshot'
          && action?.contractAddressSource?.snapshotId === entryId
        )
      ))
    );
    const handleSnapshotFieldSelect = (entry, field, event) => {
      event?.stopPropagation();
      applyMonitoringValue(block, field, 'snapshot', entry.values?.[field], entry.id);
    };
    const handleSnapshotEntrySelect = (entry) => {
      if (!singleMappedField) {
        return;
      }
      handleSnapshotFieldSelect(entry, singleMappedField);
    };

    return (
      <div className="front-dashboard-card">
        <div className="front-dashboard-card-header">
          <span className="front-dashboard-card-title">모니터링</span>
          <span className="front-dashboard-card-subtitle">{block.name || block.id}</span>
        </div>
        {block.monitorType === 'search' ? (
          <StreamingSearchMonitor {...sharedProps} {...searchProps} />
        ) : (
          <StreamingTableMonitor {...sharedProps} />
        )}
        {fields.length > 0 && snapshotEntries.length > 0 && (
          <div className="front-monitoring-fields">
            <p className="front-monitoring-fields-title">표시 필드</p>
            {pagedEntries.length === 0 ? (
              <div className="front-snapshot-empty">검색 결과가 없습니다.</div>
            ) : snapshotView === 'list' ? (
              <div className="front-snapshot-list">
                {pagedEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className={`front-snapshot-item${isSnapshotSelected(entry.id) ? ' is-selected' : ''}${hasSingleMappedField ? ' is-single-mapped' : ''}`}
                    onClick={hasSingleMappedField ? () => handleSnapshotEntrySelect(entry) : undefined}
                    role={hasSingleMappedField ? 'button' : undefined}
                    tabIndex={hasSingleMappedField ? 0 : undefined}
                    onKeyDown={(event) => {
                      if (!hasSingleMappedField) {
                        return;
                      }
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleSnapshotEntrySelect(entry);
                      }
                    }}
                  >
                    <div className="front-snapshot-header">
                      <span className="front-snapshot-badge">#{entry.index}</span>
                      <span className="front-snapshot-time">{entry.timestamp}</span>
                    </div>
                    <div className="front-snapshot-body">
                      {fields.map((field) => (
                        <div
                          key={`${entry.id}-${field}`}
                          className="front-snapshot-field"
                          role="button"
                          tabIndex={0}
                          onClick={(event) => handleSnapshotFieldSelect(entry, field, event)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              handleSnapshotFieldSelect(entry, field, event);
                            }
                          }}
                        >
                          <KeyValueCard
                            label={field}
                            value={String(entry.values?.[field] ?? '--')}
                            layout="stack"
                            className="front-snapshot-key-value"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="front-snapshot-card-grid">
                {pagedEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className={`front-snapshot-card${isSnapshotSelected(entry.id) ? ' is-selected' : ''}${hasSingleMappedField ? ' is-single-mapped' : ''}`}
                    onClick={hasSingleMappedField ? () => handleSnapshotEntrySelect(entry) : undefined}
                    role={hasSingleMappedField ? 'button' : undefined}
                    tabIndex={hasSingleMappedField ? 0 : undefined}
                    onKeyDown={(event) => {
                      if (!hasSingleMappedField) {
                        return;
                      }
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleSnapshotEntrySelect(entry);
                      }
                    }}
                  >
                    <div className="front-snapshot-card-header">
                      <span className="front-snapshot-badge">#{entry.index}</span>
                      <span className="front-snapshot-time">{entry.timestamp}</span>
                    </div>
                    <div className="front-snapshot-card-body">
                      {fields.map((field) => (
                        <button
                          key={`${entry.id}-${field}`}
                          type="button"
                          className="front-snapshot-card-row"
                          onClick={(event) => handleSnapshotFieldSelect(entry, field, event)}
                        >
                          <span className="front-snapshot-card-label">{field}</span>
                          <span className="front-snapshot-card-value">
                            {String(entry.values?.[field] ?? '--')}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderTriggerItem = (block) => {
    const enabled = block.frontEnabled ?? false;
    const resolvedTriggerType = formatTriggerType(block.triggerType || 'manual');

    return (
      <div className="front-dashboard-card front-trigger-card">
        <div className="front-trigger-card__panel">
          <div className="front-trigger-card__header">
            <span
              className="front-trigger-card__status"
              style={{ background: enabled ? '#10B981' : '#64748B' }}
            />
            <span className="front-trigger-card__tag">TRIGGER</span>
          </div>
          <div className="front-trigger-card__body">
            <div className="front-trigger-card__title">{block.name || block.id}</div>
            <div className="front-trigger-card__description">{resolvedTriggerType}</div>
            <button
              type="button"
              className={`front-trigger-card__toggle${enabled ? ' active' : ''}`}
              onClick={() => onUpdateBlock?.(block.id, { frontEnabled: !enabled })}
            >
              {enabled ? '활성화됨' : '비활성'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderActionItem = (action) => {
    const params = Array.isArray(action.parameters) ? action.parameters : [];
    const contractSources = mergeSources(
      Array.isArray(action.contractAddressSources) ? action.contractAddressSources : [],
      normalizeSource(action.contractAddressSource)
    );
    const contractSourceKey = sourceKey(action.contractAddressSource);
    const hasMultipleContractCandidates = contractSources.length > 1;
    const activeContractSource = action.contractAddressSource;
    const contractStreamingSource = activeContractSource?.blockType === 'streaming' && !activeContractSource?.field
      ? streamingBlocks.find((block) => block.id === activeContractSource.blockId)
      : null;
    const contractStreamingFields = contractStreamingSource?.fields || [];
    const connectedTriggers = triggerActionLinks
      .filter((link) => link.toId === action.id)
      .map((link) => triggerBlocks.find((block) => block.id === link.fromId))
      .filter(Boolean);
    const hasActiveTrigger = connectedTriggers.some((trigger) => trigger.frontEnabled);
    const isTriggerArmed = connectedTriggers.length === 0 ? true : hasActiveTrigger;

    const isDeterministicStreamSource = (source) => (
      source?.blockType === 'streaming' && !source?.field && source?.mode !== 'snapshot'
    );
    const isParamSourceComplete = (source) => {
      if (!source) {
        return false;
      }
      if (source.blockType === 'monitoring' && !source.field) {
        return false;
      }
      if (source.blockType === 'streaming' && !source.field) {
        return true;
      }
      return true;
    };
    const isContractSourceComplete = (source) => {
      if (!source) {
        return false;
      }
      if ((source.blockType === 'streaming' || source.blockType === 'monitoring') && !source.field) {
        return false;
      }
      return true;
    };
    const hasValue = (value) => (
      value !== undefined && value !== null && String(value).trim() !== ''
    );
    const authRequirement = resolveActionAuthRequirement(action);
    const isAuthReady = !authRequirement || isProviderAuthorized(authState, authRequirement.id);
    const actionStatus = getActionParamStatus(action.parameters);
    const requiresContract = action.actionType === 'dex' && action.executionMode === 'address';
    const isContractResolved = hasValue(action.contractAddress) || isContractSourceComplete(activeContractSource);
    const isActionReady = actionStatus.isReady && (!requiresContract || isContractResolved) && isAuthReady;
    const statusColor = isTriggerArmed
      ? (isActionReady ? '#10B981' : (isAuthReady ? '#F59E0B' : '#EF4444'))
      : '#64748B';
    const actionTag = action.actionType ? action.actionType.toUpperCase() : 'F1';
    const actionDescription = !isTriggerArmed
      ? '조건 비활성'
      : (!isAuthReady
          ? `사전인증 필요 (${authRequirement?.label})`
      : (!isActionReady && requiresContract && !isContractResolved
          ? '컨트랙트 주소 미입력'
          : (isActionReady ? '실행 준비 완료' : `미입력 ${actionStatus.missingCount}개`)));
    const isCompact = Boolean(compactActions[action.id]);
    const isActionEnabled = isActionReady && isTriggerArmed;
    const contractNeedsInput = !isContractResolved;
    const showContractField = action.actionType === 'dex'
      && action.executionMode === 'address'
      && (!isCompact || contractNeedsInput);
    const isParamResolved = (param) => hasValue(param?.value) || isParamSourceComplete(param?.source);
    const paramMeta = params.map((param, index) => {
      const candidateSources = mergeSources(
        Array.isArray(param.sources) ? param.sources : [],
        normalizeSource(param.source)
      );
      const hasMultipleCandidates = candidateSources.length > 1;
      const isFixedBySourceType = param?.source?.blockType === 'normal' || isDeterministicStreamSource(param?.source);
      const isFixedByBackendValue = param?.valueOrigin === 'backend' && hasValue(param?.value);
      const isFixedForCompact = !hasMultipleCandidates && (isFixedBySourceType || isFixedByBackendValue);
      return {
        param,
        index,
        candidateSources,
        hasMultipleCandidates,
        isParamResolved: isParamResolved(param),
        isFixedForCompact
      };
    });
    const visibleParams = isCompact
      ? paramMeta.filter((meta) => !(meta.isFixedForCompact && meta.isParamResolved))
      : paramMeta;
    const emptyParamMessage = params.length === 0
      ? '파라미터가 없습니다.'
      : '프론트 입력 항목이 없습니다.';

    return (
      <div className="front-dashboard-card front-dashboard-card--action">
        <div className={`front-action-card${isTriggerArmed ? '' : ' is-inactive'}`}>
          <div className="front-action-card__header">
            <span className="front-action-card__status" style={{ background: statusColor }} />
            <div className="front-action-card__header-actions">
              <button
                type="button"
                className={`front-action-card__compact-btn${isCompact ? ' is-active' : ''}`}
                onClick={() => (
                  setCompactActions((prev) => ({ ...prev, [action.id]: !prev[action.id] }))
                )}
              >
                {isCompact ? '전체 보기' : '간소화'}
              </button>
              <span className="front-action-card__tag">{actionTag}</span>
            </div>
          </div>
          <div className="front-action-card__body">
            <div className="front-action-card__title">{action.name || action.id}</div>
            <div className="front-action-card__description">{actionDescription}</div>

            <div className="front-action-card__fields">
              {showContractField && (
                <div className="front-action-card__field">
                  <span className="front-action-card__field-label">컨트랙트 주소</span>
                  {isContractResolved ? (
                    <div className="front-action-card__field-value front-action-card__field-value--readonly">
                      <span className="front-action-card__field-text">
                        {activeContractSource
                          ? getSourceLabel(activeContractSource, blocks)
                          : String(action.contractAddress)}
                      </span>
                      <span className="front-action-card__field-badge">고정</span>
                    </div>
                  ) : activeContractSource ? (
                    <div className="front-action-card__field-value front-action-card__field-value--mapped">
                      <span className="front-action-card__field-text">
                        {getSourceLabel(activeContractSource, blocks)}
                      </span>
                      <button
                        type="button"
                        className="front-action-card__field-clear"
                        onClick={() => updateContractAddress(action.id, { contractAddressSource: null, contractAddress: '' })}
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <input
                      className="front-action-card__field-input"
                      placeholder="직접 입력"
                      value={action.contractAddress || ''}
                      onChange={(event) => (
                        updateContractAddress(action.id, {
                          contractAddress: event.target.value,
                          contractAddressSource: null
                        })
                      )}
                    />
                  )}
                  {contractNeedsInput && contractSources.length > 0 && (
                    <div className="front-action-param-candidates">
                      <div className="front-action-param-candidates-header">
                        <span className="front-action-param-candidates-label">연결 후보</span>
                        {hasMultipleContractCandidates && contractSourceKey && (
                          <button
                            type="button"
                            className="front-action-param-candidates-clear"
                            onClick={() => updateContractAddress(action.id, { contractAddressSource: null, contractAddress: '' })}
                            aria-label="연결 해제"
                          >
                            ×
                          </button>
                        )}
                      </div>
                      <div className="front-action-param-candidates-list">
                        {contractSources.map((source) => {
                          const key = sourceKey(source);
                          const isActive = contractSourceKey === key;
                          return (
                            <button
                              key={key}
                              type="button"
                              className={`front-action-param-candidate front-action-param-candidate--${source.blockType || 'default'}${isActive ? ' is-active' : ''}`}
                              onClick={() => (
                                updateContractAddress(action.id, {
                                  contractAddress: '',
                                  contractAddressSource: { ...source, mode: 'live' }
                                })
                              )}
                            >
                              {getSourceLabel(source, blocks)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {contractNeedsInput && contractStreamingSource && (
                    <div className="front-action-param-sources">
                      <span className="front-action-param-sources-label">스트리밍 필드 선택</span>
                      <div className="front-action-param-source-fields">
                        {contractStreamingFields.map((field) => (
                          <button
                            key={field}
                            type="button"
                            className="front-action-param-chip"
                            onClick={() => (
                              updateContractAddress(action.id, {
                                contractAddress: '',
                                contractAddressSource: { ...activeContractSource, field }
                              })
                            )}
                          >
                            {field}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {visibleParams.length === 0 ? (
                <p className="front-action-card__description">{emptyParamMessage}</p>
              ) : (
                visibleParams.map(({ param, index, candidateSources, hasMultipleCandidates, isParamResolved, isFixedForCompact }) => {
                  const sourceLabel = getSourceLabel(param.source, blocks);
                  const selectedKey = sourceKey(param.source);
                  const streamingSource = param?.source?.blockType === 'streaming' && !param?.source?.field
                    ? streamingBlocks.find((block) => block.id === param.source.blockId)
                    : null;
                  const streamingFields = streamingSource?.fields || [];
                  const resolvedLabel = param.source
                    ? sourceLabel
                    : String(param.value ?? '');
                  const showReadOnly = isFixedForCompact && isParamResolved;
                  const showCandidates = !showReadOnly && candidateSources.length > 0;
                  const showStreamingFields = !showReadOnly && streamingSource;

                  return (
                    <div key={`${param.name}-${index}`} className="front-action-card__field">
                      <span className="front-action-card__field-label">{param.name}</span>
                      {showReadOnly ? (
                        <div className="front-action-card__field-value front-action-card__field-value--readonly">
                          <span className="front-action-card__field-text">{resolvedLabel}</span>
                          <span className="front-action-card__field-badge">고정</span>
                        </div>
                      ) : param.source ? (
                        <div className="front-action-card__field-value front-action-card__field-value--mapped">
                          <span className="front-action-card__field-text">{sourceLabel}</span>
                          <button
                            type="button"
                            className="front-action-card__field-clear"
                            onClick={() => updateActionParam(action.id, index, { source: null, value: '', valueOrigin: null })}
                          >
                            ×
                          </button>
                        </div>
                      ) : (
                        <input
                          className="front-action-card__field-input"
                          placeholder="직접 입력"
                          value={param.value || ''}
                          onChange={(event) => (
                            updateActionParam(action.id, index, { value: event.target.value, source: null, valueOrigin: 'front' })
                          )}
                        />
                      )}
                      {showCandidates && (
                        <div className="front-action-param-candidates">
                          <div className="front-action-param-candidates-header">
                            <span className="front-action-param-candidates-label">연결 후보</span>
                            {hasMultipleCandidates && selectedKey && (
                              <button
                                type="button"
                                className="front-action-param-candidates-clear"
                                onClick={() => updateActionParam(action.id, index, { source: null, value: '', valueOrigin: null })}
                                aria-label="연결 해제"
                              >
                                ×
                              </button>
                            )}
                          </div>
                          <div className="front-action-param-candidates-list">
                            {candidateSources.map((source) => {
                              const key = sourceKey(source);
                              const isActive = selectedKey === key;
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  className={`front-action-param-candidate front-action-param-candidate--${source.blockType || 'default'}${isActive ? ' is-active' : ''}`}
                                  onClick={() => (
                                    updateActionParam(action.id, index, {
                                      value: '',
                                      source: { ...source, mode: 'live' },
                                      valueOrigin: null
                                    })
                                  )}
                                >
                                  {getSourceLabel(source, blocks)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {showStreamingFields && (
                        <div className="front-action-param-sources">
                          <span className="front-action-param-sources-label">스트리밍 필드 선택</span>
                          <div className="front-action-param-source-fields">
                            {streamingFields.map((field) => (
                              <button
                                key={field}
                                type="button"
                                className="front-action-param-chip"
                                onClick={() => (
                                  updateActionParam(action.id, index, {
                                    source: { ...param.source, field },
                                    value: '',
                                    valueOrigin: null
                                  })
                                )}
                              >
                                {field}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <button
              type="button"
              className="front-action-card__cta"
              disabled={!isActionEnabled}
            >
              {action.name || action.id}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="front-tab">
      <div className="front-dashboard" ref={dashboardRef}>
        <div
          className="front-dashboard-canvas"
          ref={canvasRef}
          style={{
            width: `${layoutData.width}px`,
            height: `${layoutData.height}px`
          }}
        >
          <svg
            className="front-dashboard-links"
            aria-hidden="true"
            width={layoutData.width}
            height={layoutData.height}
          >
            <defs>
              <marker
                id="front-arrow-trigger"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="8"
                markerHeight="8"
                orient="auto"
              >
                <path d="M0 0 L8 4 L0 8 Z" fill="#A78BFA" />
              </marker>
            </defs>
            {linkPaths.map((link) => (
              <path
                key={link.id}
                className="front-dashboard-link"
                d={link.d}
                markerEnd="url(#front-arrow-trigger)"
              />
            ))}
          </svg>
          {orderedItems.length === 0 && (
            <div className="front-empty">
              <p>표시할 프론트 구성 요소가 없습니다.</p>
            </div>
          )}
          {orderedItems.map((item, index) => {
            const layout = layoutData.map.get(item.id) || getBlockLayout(item.block, index);
            return (
            <div
              key={item.id}
              className="front-dashboard-item"
              style={{
                left: `${layout.x}px`,
                top: `${layout.y}px`,
                width: `${layout.width}px`,
                height: `${layout.height}px`
              }}
            >
              <button
                type="button"
                className="front-dashboard-drag"
                onPointerDown={handleDragStart(item.block.id, layout)}
                aria-label="카드 이동"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M4.5 3.5H4.506" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M4.5 7H4.506" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M4.5 10.5H4.506" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M9.5 3.5H9.506" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M9.5 7H9.506" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M9.5 10.5H9.506" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
              <button
                type="button"
                className="front-dashboard-resize front-dashboard-resize--both"
                onPointerDown={handleResizeStart(item.block.id, layout, 'both')}
                aria-label="카드 크기 조절"
              />
              <button
                type="button"
                className="front-dashboard-resize front-dashboard-resize--x"
                onPointerDown={handleResizeStart(item.block.id, layout, 'x')}
                aria-label="카드 가로 크기 조절"
              />
              <button
                type="button"
                className="front-dashboard-resize front-dashboard-resize--y"
                onPointerDown={handleResizeStart(item.block.id, layout, 'y')}
                aria-label="카드 세로 크기 조절"
              />
              {item.kind === 'monitor' && renderMonitoringItem(item.block)}
              {item.kind === 'trigger' && renderTriggerItem(item.block)}
              {item.kind === 'action' && renderActionItem(item.block)}
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
