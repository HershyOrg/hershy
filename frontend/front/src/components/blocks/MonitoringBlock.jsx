import { useEffect, useRef, useState } from 'react';
import './MonitoringBlock.css';

const MonitoringBlock = ({
  blockId,
  name = "Price_Table_Monitor",
  type = "table", // "table" or "search"
  connectedStream = "Binance_BTC_Stream",
  fields = ["timestamp", "price", "volume", "change"],
  onRemoveStream,
  onUpdateBlock
}) => {
  const resolvedFields = Array.isArray(fields) ? fields : [];
  const [fieldOrder, setFieldOrder] = useState(resolvedFields);
  const dragIndexRef = useRef(null);

  useEffect(() => {
    setFieldOrder(resolvedFields);
  }, [resolvedFields]);

  const updateFieldOrder = (nextOrder) => {
    setFieldOrder(nextOrder);
    onUpdateBlock?.(blockId, { fields: nextOrder });
  };

  const handleBlockDragStart = (event) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-block-source', JSON.stringify({
      blockId,
      blockName: name,
      blockType: 'monitoring'
    }));
    event.dataTransfer.setData('text/plain', name || blockId);
  };

  const handleFieldDragStart = (event, field, index) => {
    event.stopPropagation();
    dragIndexRef.current = type === 'table' ? index : null;
    event.dataTransfer.effectAllowed = type === 'table' ? 'copyMove' : 'copy';
    event.dataTransfer.setData('text/plain', String(index));
    event.dataTransfer.setData('application/x-block-source', JSON.stringify({
      blockId,
      blockName: name,
      blockType: 'monitoring',
      field
    }));
  };

  const getIcon = () => {
    if (type === "search") {
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M7.33333 12.6667C10.2789 12.6667 12.6667 10.2789 12.6667 7.33333C12.6667 4.38781 10.2789 2 7.33333 2C4.38781 2 2 4.38781 2 7.33333C2 10.2789 4.38781 12.6667 7.33333 12.6667Z" stroke="#94A3B8" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M14 14L11.1333 11.1333" stroke="#94A3B8" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      );
    }
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 2V14" stroke="#94A3B8" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M12.6667 2H3.33333C2.59695 2 2 2.59695 2 3.33333V12.6667C2 13.403 2.59695 14 3.33333 14H12.6667C13.403 14 14 13.403 14 12.6667V3.33333C14 2.59695 13.403 2 12.6667 2Z" stroke="#94A3B8" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M2 6H14" stroke="#94A3B8" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M2 10H14" stroke="#94A3B8" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  };

  return (
    <div className="monitoring-block">
      <div className="monitoring-block-header">
        <div className="monitoring-block-header-content">
          <div className="monitoring-block-title-row">
            <div className="monitoring-block-indicator" />
            <input
              className="monitoring-block-title-input"
              value={name}
              onChange={(event) => onUpdateBlock?.(blockId, { name: event.target.value })}
              placeholder="블록 이름"
            />
          </div>
          <p className="monitoring-block-subtitle">
            {type === "table" ? "📊 테이블 모니터링" : "🔍 검색 모니터링"}
          </p>
        </div>
        <button
          type="button"
          className="monitoring-block-drag"
          draggable
          onDragStart={handleBlockDragStart}
          aria-label="모니터링 블록 연결"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M5.25 7H8.75" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M4.0835 9.3335C3.013 9.3335 2.16683 8.48733 2.16683 7.41683C2.16683 6.34633 3.013 5.50016 4.0835 5.50016H5.8335" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M9.9165 5.50016C10.987 5.50016 11.8332 6.34633 11.8332 7.41683C11.8332 8.48733 10.987 9.3335 9.9165 9.3335H8.1665" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      <div className="monitoring-block-streams">
        <div className="monitoring-block-streams-header">
          <span className="monitoring-block-streams-title">연결된 스트림</span>
        </div>
        {connectedStream && (
          <div className="monitoring-connected-stream">
            <div className="monitoring-stream-info">
              <div className="monitoring-stream-dot" />
              <span className="monitoring-stream-name">{connectedStream}</span>
            </div>
            <button className="monitoring-stream-remove" onClick={onRemoveStream}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M9 3L3 9" stroke="#EF4444" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M3 3L9 9" stroke="#EF4444" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        )}
      </div>

      <div className="monitoring-block-fields">
        <div className="monitoring-block-fields-header">
          <span className="monitoring-block-fields-title">필드 순서</span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M1.03125 6.17418C0.989582 6.06192 0.989582 5.93844 1.03125 5.82618C1.4371 4.84211 2.12601 4.0007 3.01064 3.40863C3.89527 2.81656 4.93577 2.50049 6.00025 2.50049C7.06473 2.50049 8.10524 2.81656 8.98987 3.40863C9.87449 4.0007 10.5634 4.84211 10.9693 5.82618C11.0109 5.93844 11.0109 6.06192 10.9693 6.17418C10.5634 7.15825 9.87449 7.99966 8.98987 8.59173C8.10524 9.1838 7.06473 9.49987 6.00025 9.49987C4.93577 9.49987 3.89527 9.1838 3.01064 8.59173C2.12601 7.99966 1.4371 7.15825 1.03125 6.17418Z" stroke="#64748B" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M6 7.5C6.82843 7.5 7.5 6.82843 7.5 6C7.5 5.17157 6.82843 4.5 6 4.5C5.17157 4.5 4.5 5.17157 4.5 6C4.5 6.82843 5.17157 7.5 6 7.5Z" stroke="#64748B" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div className="monitoring-block-fields-list">
          {fieldOrder.map((field, index) => (
            <div
              key={`${field}-${index}`}
              className="monitoring-field-item"
              draggable
              onDragStart={(event) => handleFieldDragStart(event, field, index)}
              onDragOver={(event) => {
                if (type !== 'table') {
                  return;
                }
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                if (type !== 'table') {
                  return;
                }
                event.preventDefault();
                const fromIndex = dragIndexRef.current;
                if (fromIndex === null || fromIndex === index) {
                  return;
                }
                const nextOrder = [...fieldOrder];
                const [moved] = nextOrder.splice(fromIndex, 1);
                nextOrder.splice(index, 0, moved);
                dragIndexRef.current = null;
                updateFieldOrder(nextOrder);
              }}
              onDragEnd={() => {
                dragIndexRef.current = null;
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M4.5 6.5C4.77614 6.5 5 6.27614 5 6C5 5.72386 4.77614 5.5 4.5 5.5C4.22386 5.5 4 5.72386 4 6C4 6.27614 4.22386 6.5 4.5 6.5Z" stroke="#64748B" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M4.5 3C4.77614 3 5 2.77614 5 2.5C5 2.22386 4.77614 2 4.5 2C4.22386 2 4 2.22386 4 2.5C4 2.77614 4.22386 3 4.5 3Z" stroke="#64748B" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M4.5 10C4.77614 10 5 9.77614 5 9.5C5 9.22386 4.77614 9 4.5 9C4.22386 9 4 9.22386 4 9.5C4 9.77614 4.22386 10 4.5 10Z" stroke="#64748B" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M7.5 6.5C7.77614 6.5 8 6.27614 8 6C8 5.72386 7.77614 5.5 7.5 5.5C7.22386 5.5 7 5.72386 7 6C7 6.27614 7.22386 6.5 7.5 6.5Z" stroke="#64748B" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M7.5 3C7.77614 3 8 2.77614 8 2.5C8 2.22386 7.77614 2 7.5 2C7.22386 2 7 2.22386 7 2.5C7 2.77614 7.22386 3 7.5 3Z" stroke="#64748B" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M7.5 10C7.77614 10 8 9.77614 8 9.5C8 9.22386 7.77614 9 7.5 9C7.22386 9 7 9.22386 7 9.5C7 9.77614 7.22386 10 7.5 10Z" stroke="#64748B" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="monitoring-field-name">{field}</span>
              <span className="monitoring-field-order">{index + 1}</span>
            </div>
          ))}
        </div>
        <div className="monitoring-block-fields-footer">
          <span className="monitoring-block-hint">드래그하여 순서 변경</span>
        </div>
      </div>

      <div className="connection-point connection-point-top" />
      <div className="connection-point connection-point-right" />
      <div className="connection-point connection-point-bottom" />
      <div className="connection-point connection-point-left" />
    </div>
  );
};

export default MonitoringBlock;
