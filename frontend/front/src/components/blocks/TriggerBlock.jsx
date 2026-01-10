import { useEffect, useRef, useState } from 'react';
import './TriggerBlock.css';

const TYPE_LABELS = {
  manual: '수동 클릭',
  time: '시간 기반',
  condition: '조건 기반'
};

const TYPE_SHORT_LABELS = {
  manual: '수동',
  time: '시간',
  condition: '조건'
};

const resolveIntervalLabel = (interval) => {
  const value = Number(interval);
  const resolved = Number.isFinite(value) && value > 0 ? Math.round(value) : 1000;
  return `${resolved} ms`;
};

const ROOT_GROUP_ID = 'root';

const normalizeFormula = (value) => {
  if (!value) {
    return '';
  }

  return value
    .replace(/\s*&&\s*/g, ' and ')
    .replace(/\s*\|\|\s*/g, ' or ')
    .replace(/\bAND\b/gi, 'and')
    .replace(/\bOR\b/gi, 'or')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
};

const toggleOperator = (operator) => (operator === 'AND' ? 'OR' : 'AND');

const updateGroup = (group, targetId, updater) => {
  if (group.id === targetId) {
    return updater(group);
  }

  return {
    ...group,
    items: group.items.map((item) => (
      item.type === 'group' ? updateGroup(item, targetId, updater) : item
    ))
  };
};

const findGroup = (group, targetId) => {
  if (group.id === targetId) {
    return group;
  }

  for (const item of group.items) {
    if (item.type === 'group') {
      const found = findGroup(item, targetId);
      if (found) {
        return found;
      }
    }
  }

  return null;
};

const rectsOverlap = (a, b) => (
  a.x < b.x + b.width
  && a.x + a.width > b.x
  && a.y < b.y + b.height
  && a.y + a.height > b.y
);

const TriggerBlock = ({
  blockId,
  name = 'Trigger_1',
  triggerType = 'manual',
  interval = 1000,
  conditionSummary = '',
  logicOperator = 'OR',
  onUpdateBlock
}) => {
  const [type, setType] = useState(triggerType);
  const [logic, setLogic] = useState(logicOperator);
  const [visualMode, setVisualMode] = useState(false);
  const [formula, setFormula] = useState(() => normalizeFormula(conditionSummary));
  const [intervalValue, setIntervalValue] = useState(() => String(interval ?? 1000));
  const formulaInputRef = useRef(null);
  const [visualTree, setVisualTree] = useState(() => ({
    id: ROOT_GROUP_ID,
    type: 'group',
    operator: logicOperator,
    rect: null,
    items: []
  }));
  const [visualViewport, setVisualViewport] = useState({ x: 0, y: 0, scale: 1 });
  const [activeLasso, setActiveLasso] = useState(null);
  const [visualMenu, setVisualMenu] = useState(null);
  const [overlapErrorId, setOverlapErrorId] = useState(null);
  const [toastMessage, setToastMessage] = useState('');
  const nextValueIndexRef = useRef(1);
  const nextValueIdRef = useRef(1);
  const nextGroupIdRef = useRef(1);
  const visualCanvasRef = useRef(null);
  const lassoStateRef = useRef(null);
  const panStateRef = useRef(null);
  const toastTimerRef = useRef(null);
  const longPressTimerRef = useRef(null);

  useEffect(() => {
    setType(triggerType);
  }, [triggerType]);

  useEffect(() => {
    setLogic(logicOperator);
  }, [logicOperator]);

  useEffect(() => {
    setFormula(normalizeFormula(conditionSummary));
  }, [conditionSummary]);

  useEffect(() => {
    setIntervalValue(String(interval ?? 1000));
  }, [interval]);

  useEffect(() => {
    setVisualTree((prev) => (
      prev.operator === logic ? prev : { ...prev, operator: logic }
    ));
  }, [logic]);

  useEffect(() => {
    if (type !== 'condition') {
      setVisualMode(false);
    }
  }, [type]);

  useEffect(() => {
    if (!visualMode) {
      setVisualMenu(null);
      setActiveLasso(null);
    }
  }, [visualMode]);

  const createValueLabel = (rawLabel) => {
    const trimmed = rawLabel?.trim();
    if (trimmed) {
      return trimmed;
    }

    const label = `value${nextValueIndexRef.current}`;
    nextValueIndexRef.current += 1;
    return label;
  };

  const createValueItem = (label) => ({
    id: `value-${nextValueIdRef.current++}`,
    type: 'value',
    label
  });

  const createGroupItem = (rect, operator = logic) => ({
    id: `group-${nextGroupIdRef.current++}`,
    type: 'group',
    operator,
    rect,
    items: []
  });

  const addValueToGroup = (groupId, rawLabel) => {
    const label = createValueLabel(rawLabel);
    const valueItem = createValueItem(label);

    setVisualTree((prev) => (
      updateGroup(prev, groupId, (group) => ({
        ...group,
        items: [...group.items, valueItem]
      }))
    ));
  };

  const openValueMenuAt = (groupId, clientX, clientY) => {
    if (!visualCanvasRef.current) {
      return;
    }

    const rect = visualCanvasRef.current.getBoundingClientRect();
    setVisualMenu({
      groupId,
      x: clientX - rect.left,
      y: clientY - rect.top
    });
  };

  const handleGroupContextMenu = (event, groupId) => {
    event.preventDefault();
    event.stopPropagation();
    openValueMenuAt(groupId, event.clientX, event.clientY);
  };

  const handleCreateFixedValue = (event) => {
    if (!visualMenu) {
      return;
    }

    event?.preventDefault();

    const rawLabel = typeof window !== 'undefined'
      ? window.prompt('고정값 이름 (비워두면 value1, value2로 자동 생성)', '')
      : '';

    addValueToGroup(visualMenu.groupId, rawLabel);
    setVisualMenu(null);
  };

  const handleLongPressStart = (event, groupId) => {
    if (event.pointerType !== 'touch') {
      return;
    }

    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }

    longPressTimerRef.current = setTimeout(() => {
      openValueMenuAt(groupId, event.clientX, event.clientY);
    }, 500);
  };

  const handleLongPressEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const getDefaultGroupRect = (group) => {
    const groupRects = group.items
      .filter((item) => item.type === 'group' && item.rect)
      .map((item) => item.rect);

    if (groupRects.length === 0) {
      return { x: 12, y: 36, width: 180, height: 90 };
    }

    const maxY = Math.max(...groupRects.map((rect) => rect.y + rect.height));
    return { x: 12, y: maxY + 16, width: 180, height: 90 };
  };

  const showOverlapError = (groupId) => {
    setOverlapErrorId(groupId);
    setToastMessage('겹침 불가 · 블록 복사/새 블록 생성 후 분리 배치');

    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }

    toastTimerRef.current = setTimeout(() => {
      setOverlapErrorId(null);
      setToastMessage('');
    }, 1800);
  };

  const handleAddGroup = (groupId, rectOverride) => {
    setVisualTree((prev) => {
      const parent = findGroup(prev, groupId);
      if (!parent) {
        return prev;
      }

      const rect = rectOverride || getDefaultGroupRect(parent);
      const hasOverlap = parent.items.some((item) => (
        item.type === 'group'
        && item.rect
        && rectsOverlap(rect, item.rect)
      ));

      if (hasOverlap) {
        showOverlapError(groupId);
        return prev;
      }

      const groupItem = createGroupItem(rect, parent.operator);
      return updateGroup(prev, groupId, (group) => ({
        ...group,
        items: [...group.items, groupItem]
      }));
    });
  };

  const handleToggleGroupOperator = (groupId) => {
    if (groupId === ROOT_GROUP_ID) {
      setLogic((prev) => {
        const next = toggleOperator(prev);
        onUpdateBlock?.(blockId, { logicOperator: next });
        return next;
      });
      return;
    }

    setVisualTree((prev) => (
      updateGroup(prev, groupId, (group) => ({
        ...group,
        operator: toggleOperator(group.operator)
      }))
    ));
  };

  const handleFormulaChange = (event) => {
    const nextValue = normalizeFormula(event.target.value);
    setFormula(nextValue);
    onUpdateBlock?.(blockId, { conditionSummary: nextValue });
  };

  const insertFormulaToken = (token) => {
    const input = formulaInputRef.current;
    if (!input) {
      setFormula((prev) => normalizeFormula(`${prev} ${token}`));
      return;
    }

    input.focus();
    const start = input.selectionStart ?? formula.length;
    const end = input.selectionEnd ?? formula.length;
    const nextValue = `${formula.slice(0, start)}${token}${formula.slice(end)}`;
    setFormula(normalizeFormula(nextValue));

    requestAnimationFrame(() => {
      input.selectionStart = input.selectionEnd = start + token.length;
    });
  };

  const handleFormulaDrop = (event) => {
    event.preventDefault();
    const name = event.dataTransfer.getData('application/x-block-name')
      || event.dataTransfer.getData('text/plain');

    if (!name) {
      return;
    }

    insertFormulaToken(`{${name}}`);
  };

  const handleFormulaDragOver = (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const clampScale = (value) => Math.min(2, Math.max(0.6, value));

  const handleVisualWheel = (event) => {
    if (!visualCanvasRef.current) {
      return;
    }

    event.preventDefault();
    const rect = visualCanvasRef.current.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const delta = event.deltaY > 0 ? -0.08 : 0.08;

    setVisualViewport((prev) => {
      const nextScale = clampScale(prev.scale + delta);
      const scaleRatio = nextScale / prev.scale;
      return {
        scale: nextScale,
        x: pointerX - (pointerX - prev.x) * scaleRatio,
        y: pointerY - (pointerY - prev.y) * scaleRatio
      };
    });
  };

  const handleVisualPointerDown = (event) => {
    if (!visualCanvasRef.current || event.button !== 0 || event.shiftKey) {
      return;
    }

    if (event.target.closest('button') || event.target.closest('.trigger-visual-context-menu')) {
      return;
    }

    setVisualMenu(null);

    panStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: visualViewport.x,
      originY: visualViewport.y
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleVisualPointerMove = (event) => {
    const panState = panStateRef.current;
    if (!panState || panState.pointerId !== event.pointerId) {
      return;
    }

    const dx = event.clientX - panState.startX;
    const dy = event.clientY - panState.startY;
    setVisualViewport((prev) => ({
      ...prev,
      x: panState.originX + dx,
      y: panState.originY + dy
    }));
  };

  const handleVisualPointerUp = (event) => {
    const panState = panStateRef.current;
    if (!panState || panState.pointerId !== event.pointerId) {
      return;
    }

    event.currentTarget.releasePointerCapture(event.pointerId);
    panStateRef.current = null;
  };

  const getLocalPoint = (event, element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / visualViewport.scale,
      y: (event.clientY - rect.top) / visualViewport.scale
    };
  };

  const handleLassoPointerDown = (event, groupId) => {
    if (!event.shiftKey || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    handleLongPressEnd();
    setVisualMenu(null);

    const start = getLocalPoint(event, event.currentTarget);
    lassoStateRef.current = {
      groupId,
      pointerId: event.pointerId,
      start,
      target: event.currentTarget
    };

    setActiveLasso({
      groupId,
      rect: { x: start.x, y: start.y, width: 0, height: 0 }
    });

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleLassoPointerMove = (event) => {
    const lassoState = lassoStateRef.current;
    if (!lassoState || lassoState.pointerId !== event.pointerId) {
      return;
    }

    const current = getLocalPoint(event, lassoState.target);
    const rect = {
      x: Math.min(lassoState.start.x, current.x),
      y: Math.min(lassoState.start.y, current.y),
      width: Math.abs(current.x - lassoState.start.x),
      height: Math.abs(current.y - lassoState.start.y)
    };

    setActiveLasso({ groupId: lassoState.groupId, rect });
  };

  const handleLassoPointerUp = (event) => {
    const lassoState = lassoStateRef.current;
    if (!lassoState || lassoState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture(event.pointerId);

    const current = getLocalPoint(event, lassoState.target);
    const rect = {
      x: Math.min(lassoState.start.x, current.x),
      y: Math.min(lassoState.start.y, current.y),
      width: Math.abs(current.x - lassoState.start.x),
      height: Math.abs(current.y - lassoState.start.y)
    };

    if (rect.width >= 14 && rect.height >= 14) {
      handleAddGroup(lassoState.groupId, rect);
    }

    lassoStateRef.current = null;
    setActiveLasso(null);
  };

  const subtitle = TYPE_LABELS[type] || TYPE_LABELS.manual;
  const intervalLabel = resolveIntervalLabel(intervalValue);
  const conditionPlaceholder = '조건 입력하거나 블록 드래그...';
  const visualRuleText = logic === 'OR'
    ? '필드 점선(OR): 최상위 올가미 중 하나만 참이면 OK'
    : '필드 실선(AND): 최상위 올가미가 모두 참이어야 OK';

  const renderVisualGroup = (group, isRoot = false) => {
    const isFloating = !isRoot && group.rect;
    const groupClassName = `trigger-visual-group${group.operator === 'OR' ? ' is-or' : ' is-and'}${isRoot ? ' is-root' : ''}${isFloating ? ' is-floating' : ''}${overlapErrorId === group.id ? ' has-overlap' : ''}`;
    const style = isFloating
      ? {
          left: `${group.rect.x}px`,
          top: `${group.rect.y}px`,
          width: `${group.rect.width}px`,
          height: `${group.rect.height}px`
        }
      : undefined;

    return (
      <div
        key={group.id}
        className={groupClassName}
        style={style}
        onPointerDown={(event) => handleLassoPointerDown(event, group.id)}
        onPointerMove={handleLassoPointerMove}
        onPointerUp={handleLassoPointerUp}
        onPointerCancel={handleLassoPointerUp}
        onContextMenu={(event) => handleGroupContextMenu(event, group.id)}
      >
        <div className="trigger-visual-group-header">
          <button
            type="button"
            className="trigger-visual-operator"
            onClick={() => handleToggleGroupOperator(group.id)}
          >
            {group.operator}
          </button>
          <button
            type="button"
            className="trigger-visual-add-group"
            onClick={(event) => {
              event.stopPropagation();
              handleAddGroup(group.id);
            }}
          >
            + 올가미
          </button>
        </div>
        <div
          className="trigger-visual-group-items"
          onContextMenu={(event) => handleGroupContextMenu(event, group.id)}
          onPointerDown={(event) => {
            if (!event.shiftKey) {
              event.stopPropagation();
            }
            handleLongPressStart(event, group.id);
          }}
          onPointerMove={handleLongPressEnd}
          onPointerUp={handleLongPressEnd}
          onPointerCancel={handleLongPressEnd}
        >
          {group.items.length === 0 ? (
            <p className="trigger-visual-empty">우클릭으로 고정값 추가</p>
          ) : (
            group.items.map((item) => (
              item.type === 'value' ? (
                <span key={item.id} className="trigger-visual-value">{item.label}</span>
              ) : (
                renderVisualGroup(item)
              )
            ))
          )}
        </div>
        {activeLasso && activeLasso.groupId === group.id && (
          <div
            className={`trigger-visual-lasso${group.operator === 'OR' ? ' is-or' : ' is-and'}`}
            style={{
              left: `${activeLasso.rect.x}px`,
              top: `${activeLasso.rect.y}px`,
              width: `${activeLasso.rect.width}px`,
              height: `${activeLasso.rect.height}px`
            }}
          />
        )}
        {overlapErrorId === group.id && (
          <div className="trigger-visual-overlap" />
        )}
      </div>
    );
  };

  return (
    <div className={`trigger-block trigger-block--${type}`}>
      <div className="trigger-block-header">
        <div className="trigger-block-title-row">
          <div className="trigger-block-indicator" />
          <input
            className="trigger-block-title-input"
            value={name}
            onChange={(event) => onUpdateBlock?.(blockId, { name: event.target.value })}
            placeholder="블록 이름"
          />
        </div>
        <p className="trigger-block-subtitle">트리거 블록 - {subtitle}</p>
      </div>

      <div className="trigger-block-toggle">
        {Object.entries(TYPE_SHORT_LABELS).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`trigger-type-btn${type === key ? ' active' : ''}`}
            onClick={() => {
              setType(key);
              onUpdateBlock?.(blockId, { triggerType: key });
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {type === 'manual' && (
        <div className="trigger-block-panel">
          <div className="trigger-block-panel-title">
            <span className="trigger-block-icon" aria-hidden="true">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6.29297 6.29297L9.49997 9.49997" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M1.84403 1.51853C1.7985 1.49934 1.74828 1.49416 1.69979 1.50365C1.6513 1.51314 1.60674 1.53687 1.57181 1.57181C1.53687 1.60674 1.51314 1.6513 1.50365 1.69979C1.49416 1.74828 1.49934 1.7985 1.51853 1.84403L4.76853 9.84353C4.78853 9.89192 4.8232 9.93283 4.86766 9.9605C4.91212 9.98817 4.96414 10.0012 5.01639 9.99779C5.06865 9.99437 5.11852 9.97466 5.15899 9.94143C5.19946 9.9082 5.2285 9.86312 5.24203 9.81253L6.02653 6.77103C6.06828 6.59345 6.15781 6.43068 6.28542 6.30034C6.41304 6.16999 6.57388 6.07703 6.75053 6.03153L9.81253 5.24203C9.86337 5.22883 9.90876 5.19995 9.94226 5.15949C9.97576 5.11904 9.99566 5.06905 9.99915 5.01664C10.0026 4.96423 9.98953 4.91206 9.96168 4.86752C9.93384 4.82298 9.89267 4.78835 9.84403 4.76853L1.84403 1.51853Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span>수동 실행</span>
          </div>
          <p className="trigger-block-panel-desc">프론트엔드에서 버튼을 클릭하여 실행</p>
        </div>
      )}

      {type === 'time' && (
        <div className="trigger-block-panel">
          <div className="trigger-block-panel-title">
            <span className="trigger-block-icon" aria-hidden="true">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6 11C8.76142 11 11 8.76142 11 6C11 3.23858 8.76142 1 6 1C3.23858 1 1 3.23858 1 6C1 8.76142 3.23858 11 6 11Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M6 3V6L8 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span>시간 간격</span>
          </div>
          <div className="trigger-block-time-editor">
            <label className="trigger-block-time-label">간격</label>
            <div className="trigger-block-time-input-row">
              <input
                type="number"
                className="trigger-block-time-input"
                min="1"
                value={intervalValue}
                onChange={(event) => {
                  setIntervalValue(event.target.value);
                  onUpdateBlock?.(blockId, { interval: Number(event.target.value) });
                }}
              />
              <span className="trigger-block-time-unit">ms</span>
            </div>
            <span className="trigger-block-time-hint">현재: {intervalLabel}</span>
          </div>
          <p className="trigger-block-panel-desc">프론트엔드에서 토글로 활성화/비활성화</p>
        </div>
      )}

      {type === 'condition' && (
        <div className={`trigger-block-panel condition${visualMode ? ' visual-mode' : ''}${logic === 'OR' ? ' is-or' : ' is-and'}`}>
          <div className="trigger-block-panel-header">
            <div className="trigger-block-panel-title">
              <span className="trigger-block-icon" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M3 1.5V7.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M9 4.5C9.82843 4.5 10.5 3.82843 10.5 3C10.5 2.17157 9.82843 1.5 9 1.5C8.17157 1.5 7.5 2.17157 7.5 3C7.5 3.82843 8.17157 4.5 9 4.5Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M3 10.5C3.82843 10.5 4.5 9.82843 4.5 9C4.5 8.17157 3.82843 7.5 3 7.5C2.17157 7.5 1.5 8.17157 1.5 9C1.5 9.82843 2.17157 10.5 3 10.5Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M9 4.5C9 5.69347 8.52589 6.83807 7.68198 7.68198C6.83807 8.52589 5.69347 9 4.5 9" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span>조건식</span>
            </div>
            <div className="trigger-block-panel-actions">
              <div className="trigger-logic-toggle">
                <button
                  type="button"
                  className={`trigger-logic-btn${logic === 'AND' ? ' active' : ''}`}
                  onClick={() => {
                    setLogic('AND');
                    onUpdateBlock?.(blockId, { logicOperator: 'AND' });
                  }}
                >
                  AND
                </button>
                <button
                  type="button"
                  className={`trigger-logic-btn${logic === 'OR' ? ' active' : ''}`}
                  onClick={() => {
                    setLogic('OR');
                    onUpdateBlock?.(blockId, { logicOperator: 'OR' });
                  }}
                >
                  OR
                </button>
              </div>
              <button
                type="button"
                className={`trigger-visual-btn${visualMode ? ' active' : ''}`}
                onClick={() => setVisualMode((prev) => !prev)}
                aria-pressed={visualMode}
                aria-label="조건 시각화 토글"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M10.6665 12L14.6665 8L10.6665 4" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M5.3335 4L1.3335 8L5.3335 12" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
          {visualMode ? (
            <div className="trigger-block-visual">
              <div className="trigger-block-visual-meta">
                <p className="trigger-block-visual-hint">Shift+드래그: 올가미 생성</p>
                <span className="trigger-block-visual-rule" title={visualRuleText}>
                  {visualRuleText}
                </span>
              </div>
              <div
                className="trigger-visual-canvas"
                ref={visualCanvasRef}
                onWheel={handleVisualWheel}
                onPointerDown={handleVisualPointerDown}
                onPointerMove={handleVisualPointerMove}
                onPointerUp={handleVisualPointerUp}
                onPointerCancel={handleVisualPointerUp}
              >
                <div
                  className="trigger-visual-canvas-content"
                  style={{
                    transform: `translate(${visualViewport.x}px, ${visualViewport.y}px) scale(${visualViewport.scale})`
                  }}
                >
                  {renderVisualGroup(visualTree, true)}
                </div>
                {visualMenu && (
                  <div
                    className="trigger-visual-context-menu"
                    style={{ left: `${visualMenu.x}px`, top: `${visualMenu.y}px` }}
                  >
                    <button type="button" className="trigger-visual-context-item" onClick={handleCreateFixedValue}>
                      고정값 생성
                    </button>
                  </div>
                )}
                {toastMessage && (
                  <div className="trigger-visual-toast">{toastMessage}</div>
                )}
              </div>
            </div>
          ) : (
            <div className="trigger-block-formula">
              <textarea
                ref={formulaInputRef}
                className="trigger-block-formula-input"
                placeholder={conditionPlaceholder}
                value={formula}
                onChange={handleFormulaChange}
                onDrop={handleFormulaDrop}
                onDragOver={handleFormulaDragOver}
                rows={2}
              />
            </div>
          )}
        </div>
      )}

      <div className="connection-point connection-point-top" />
      <div className="connection-point connection-point-right" />
      <div className="connection-point connection-point-bottom" />
      <div className="connection-point connection-point-left" />
    </div>
  );
};

export default TriggerBlock;
