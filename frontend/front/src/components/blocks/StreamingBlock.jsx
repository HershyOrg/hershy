import { useEffect, useState } from 'react';
import './StreamingBlock.css';
import { EVM_CHAINS } from '../../lib/evmChains';

const StreamingBlock = ({
  blockId,
  name = "Binance_BTC_Stream",
  fields = ["timestamp", "price", "volume"],
  apiUrl = '',
  streamKind = 'url',
  streamChain = '',
  streamMethod = 'eth_blockNumber',
  streamParamsJson = '[]',
  updateMode = "periodic", // "live" or "periodic"
  updateInterval = 1000,
  mutedFields,
  hideMutedFields,
  onUpdateBlock,
  onCreateFieldStream
}) => {
  const [mode, setMode] = useState(updateMode);
  const [interval, setInterval] = useState(updateInterval);
  const [sourceUrl, setSourceUrl] = useState(apiUrl);
  const [kind, setKind] = useState(streamKind || 'url');
  const [chain, setChain] = useState(streamChain);
  const [method, setMethod] = useState(streamMethod);
  const [paramsJson, setParamsJson] = useState(streamParamsJson);
  const [mutedFieldsState, setMutedFieldsState] = useState(() => (
    Array.isArray(mutedFields) ? mutedFields : []
  ));
  const [hideMutedFieldsState, setHideMutedFieldsState] = useState(Boolean(hideMutedFields));

  useEffect(() => {
    setMode(updateMode);
  }, [updateMode]);

  useEffect(() => {
    setInterval(updateInterval);
  }, [updateInterval]);

  useEffect(() => {
    setSourceUrl(apiUrl);
  }, [apiUrl]);

  useEffect(() => {
    setKind(streamKind || 'url');
  }, [streamKind]);

  useEffect(() => {
    setChain(streamChain);
  }, [streamChain]);

  useEffect(() => {
    setMethod(streamMethod);
  }, [streamMethod]);

  useEffect(() => {
    setParamsJson(streamParamsJson);
  }, [streamParamsJson]);

  useEffect(() => {
    if (Array.isArray(mutedFields)) {
      setMutedFieldsState(mutedFields);
    }
  }, [mutedFields]);

  useEffect(() => {
    if (typeof hideMutedFields === 'boolean') {
      setHideMutedFieldsState(hideMutedFields);
    }
  }, [hideMutedFields]);

  const resolvedFields = Array.isArray(fields) ? fields : [];
  const visibleFields = hideMutedFieldsState
    ? resolvedFields.filter((field) => !mutedFieldsState.includes(field))
    : resolvedFields;

  const toggleMutedField = (field) => {
    setMutedFieldsState((prev) => {
      const next = prev.includes(field)
        ? prev.filter((item) => item !== field)
        : [...prev, field];
      onUpdateBlock?.(blockId, { mutedFields: next });
      return next;
    });
  };

  const toggleHideMuted = () => {
    setHideMutedFieldsState((prev) => {
      const next = !prev;
      onUpdateBlock?.(blockId, { hideMutedFields: next });
      return next;
    });
  };

  const handleBlockDragStart = (event) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-block-source', JSON.stringify({
      blockId,
      blockName: name,
      blockType: 'streaming'
    }));
    event.dataTransfer.setData('text/plain', name || blockId);
  };

  const handleFieldDragStart = (event, field) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-block-source', JSON.stringify({
      blockId,
      blockName: name,
      blockType: 'streaming',
      field
    }));
    event.dataTransfer.setData('text/plain', `${name || blockId}::${field}`);
  };

  return (
    <div className="streaming-block">
      <div className="streaming-block-header">
        <div className="streaming-block-header-content">
          <div className="streaming-block-title-row">
            <div className="streaming-block-indicator" />
            <input
              className="streaming-block-title-input"
              value={name}
              onChange={(event) => onUpdateBlock?.(blockId, { name: event.target.value })}
              placeholder="블록 이름"
            />
          </div>
          <p className="streaming-block-subtitle">스트리밍 블록</p>
        </div>
        <div className="streaming-block-actions">
          <button
            className="streaming-block-drag"
            type="button"
            draggable
            onDragStart={handleBlockDragStart}
            aria-label="스트리밍 블록 연결"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5.25 7H8.75" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M4.0835 9.3335C3.013 9.3335 2.16683 8.48733 2.16683 7.41683C2.16683 6.34633 3.013 5.50016 4.0835 5.50016H5.8335" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M9.9165 5.50016C10.987 5.50016 11.8332 6.34633 11.8332 7.41683C11.8332 8.48733 10.987 9.3335 9.9165 9.3335H8.1665" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            className="streaming-block-view-btn"
            type="button"
            onClick={toggleHideMuted}
            aria-pressed={hideMutedFieldsState}
            aria-label="비활성 필드 숨김 토글"
          >
            {hideMutedFieldsState ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1.20297 7.20297C1.15435 7.072 1.15435 6.92793 1.20297 6.79697C1.67646 5.64888 2.48018 4.66724 3.51225 3.97649C4.54431 3.28574 5.75824 2.91699 7.00013 2.91699C8.24202 2.91699 9.45595 3.28574 10.488 3.97649C11.5201 4.66724 12.3238 5.64888 12.7973 6.79697C12.8459 6.92793 12.8459 7.072 12.7973 7.20297C12.3238 8.35105 11.5201 9.33269 10.488 10.0234C9.45595 10.7142 8.24202 11.0829 7.00013 11.0829C5.75824 11.0829 4.54431 10.7142 3.51225 10.0234C2.48018 9.33269 1.67646 8.35105 1.20297 7.20297Z" stroke="#64748B" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M7 8.75C7.9665 8.75 8.75 7.9665 8.75 7C8.75 6.0335 7.9665 5.25 7 5.25C6.0335 5.25 5.25 6.0335 5.25 7C5.25 7.9665 6.0335 8.75 7 8.75Z" stroke="#64748B" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 2L12 12" stroke="#64748B" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1.20297 7.20297C1.15435 7.072 1.15435 6.92793 1.20297 6.79697C1.67646 5.64888 2.48018 4.66724 3.51225 3.97649C4.54431 3.28574 5.75824 2.91699 7.00013 2.91699C8.24202 2.91699 9.45595 3.28574 10.488 3.97649C11.5201 4.66724 12.3238 5.64888 12.7973 6.79697C12.8459 6.92793 12.8459 7.072 12.7973 7.20297C12.3238 8.35105 11.5201 9.33269 10.488 10.0234C9.45595 10.7142 8.24202 11.0829 7.00013 11.0829C5.75824 11.0829 4.54431 10.7142 3.51225 10.0234C2.48018 9.33269 1.67646 8.35105 1.20297 7.20297Z" stroke="#64748B" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M7 8.75C7.9665 8.75 8.75 7.9665 8.75 7C8.75 6.0335 7.9665 5.25 7 5.25C6.0335 5.25 5.25 6.0335 5.25 7C5.25 7.9665 6.0335 8.75 7 8.75Z" stroke="#64748B" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        </div>
      </div>

      <div className="streaming-block-mode-toggle">
        <button 
          className={`mode-btn ${mode === 'live' ? 'active' : ''}`}
          onClick={() => {
            setMode('live');
            onUpdateBlock?.(blockId, { updateMode: 'live' });
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M1.99975 6.99984C1.90513 7.00016 1.81237 6.97363 1.73223 6.92333C1.65209 6.87302 1.58787 6.80102 1.54703 6.71567C1.50618 6.63032 1.4904 6.53513 1.5015 6.44117C1.5126 6.3472 1.55014 6.25832 1.60975 6.18484L6.55975 1.08484C6.59688 1.04198 6.64748 1.01302 6.70324 1.0027C6.759 0.992392 6.81661 1.00134 6.86662 1.02809C6.91662 1.05484 6.95604 1.09779 6.97842 1.14989C7.00079 1.202 7.00479 1.26016 6.98975 1.31484L6.02975 4.32484C6.00144 4.4006 5.99194 4.4821 6.00205 4.56234C6.01216 4.64258 6.04158 4.71918 6.0878 4.78555C6.13401 4.85192 6.19564 4.90609 6.26739 4.94342C6.33914 4.98074 6.41887 5.0001 6.49975 4.99984H9.99975C10.0944 4.99951 10.1871 5.02605 10.2673 5.07635C10.3474 5.12665 10.4116 5.19866 10.4525 5.28401C10.4933 5.36936 10.5091 5.46454 10.498 5.55851C10.4869 5.65247 10.4494 5.74136 10.3898 5.81484L5.43975 10.9148C5.40262 10.9577 5.35202 10.9867 5.29626 10.997C5.2405 11.0073 5.18289 10.9983 5.13289 10.9716C5.08288 10.9448 5.04346 10.9019 5.02108 10.8498C4.99871 10.7977 4.99471 10.7395 5.00975 10.6848L5.96975 7.67484C5.99806 7.59908 6.00757 7.51758 5.99746 7.43733C5.98735 7.35709 5.95792 7.2805 5.91171 7.21412C5.86549 7.14775 5.80387 7.09358 5.73211 7.05626C5.66036 7.01893 5.58063 6.99957 5.49975 6.99984H1.99975Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          실시간
        </button>
        <button 
          className={`mode-btn ${mode === 'periodic' ? 'active' : ''}`}
          onClick={() => {
            setMode('periodic');
            onUpdateBlock?.(blockId, { updateMode: 'periodic' });
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 11C8.76142 11 11 8.76142 11 6C11 3.23858 8.76142 1 6 1C3.23858 1 1 3.23858 1 6C1 8.76142 3.23858 11 6 11Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M6 3V6L8 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          주기적
        </button>
      </div>

      {mode === 'periodic' && (
        <div className="streaming-block-interval">
          <label className="streaming-block-label">업데이트 주기 (ms)</label>
          <input
            type="number"
            className="streaming-block-input"
            value={interval}
            onChange={(event) => {
              setInterval(event.target.value);
              onUpdateBlock?.(blockId, { updateInterval: Number(event.target.value) });
            }}
          />
        </div>
      )}

      <div className="streaming-block-interval">
        <label className="streaming-block-label">스트림 소스</label>
        <select
          className="streaming-block-input"
          value={kind}
          onChange={(event) => {
            const next = event.target.value;
            setKind(next);
            onUpdateBlock?.(blockId, { streamKind: next });
          }}
        >
          <option value="url">URL / WebSocket</option>
          <option value="evm-rpc">EVM RPC</option>
        </select>
      </div>

      {kind === 'url' && (
        <div className="streaming-block-interval">
          <label className="streaming-block-label">API/WebSocket URL</label>
          <input
            type="text"
            className="streaming-block-input"
            value={sourceUrl}
            placeholder="https://... or wss://..."
            onChange={(event) => {
              const next = event.target.value;
              setSourceUrl(next);
              onUpdateBlock?.(blockId, { apiUrl: next });
            }}
          />
        </div>
      )}

      {kind === 'evm-rpc' && (
        <>
          <div className="streaming-block-interval">
            <label className="streaming-block-label">체인</label>
            <select
              className="streaming-block-input"
              value={chain}
              onChange={(event) => {
                const next = event.target.value;
                setChain(next);
                onUpdateBlock?.(blockId, { streamChain: next });
              }}
            >
              <option value="">체인 선택</option>
              {EVM_CHAINS.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </div>
          <div className="streaming-block-interval">
            <label className="streaming-block-label">RPC Method</label>
            <input
              type="text"
              className="streaming-block-input"
              value={method}
              placeholder="eth_blockNumber"
              onChange={(event) => {
                const next = event.target.value;
                setMethod(next);
                onUpdateBlock?.(blockId, { streamMethod: next });
              }}
            />
          </div>
          <div className="streaming-block-interval">
            <label className="streaming-block-label">RPC Params(JSON)</label>
            <input
              type="text"
              className="streaming-block-input"
              value={paramsJson}
              placeholder='["latest", false]'
              onChange={(event) => {
                const next = event.target.value;
                setParamsJson(next);
                onUpdateBlock?.(blockId, { streamParamsJson: next });
              }}
            />
          </div>
        </>
      )}

      <div className="streaming-block-fields">
        <div className="streaming-block-fields-header">
          <span className="streaming-block-fields-title">필드 목록</span>
        </div>
        <div className="streaming-block-fields-list">
          {visibleFields.map((field, index) => (
            <div
              key={`${field}-${index}`}
              className={`streaming-field-item${mutedFieldsState.includes(field) ? ' is-muted' : ''}`}
              draggable
              onDragStart={(event) => handleFieldDragStart(event, field)}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onCreateFieldStream?.(blockId, field);
              }}
            >
              <div className="streaming-field-dot" />
              <span className="streaming-field-name">{field}</span>
              <button
                type="button"
                className="streaming-field-toggle"
                onClick={(event) => {
                  event.stopPropagation();
                  toggleMutedField(field);
                }}
                aria-pressed={mutedFieldsState.includes(field)}
                aria-label="필드 사용 토글"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M1.20297 7.20297C1.15435 7.072 1.15435 6.92793 1.20297 6.79697C1.67646 5.64888 2.48018 4.66724 3.51225 3.97649C4.54431 3.28574 5.75824 2.91699 7.00013 2.91699C8.24202 2.91699 9.45595 3.28574 10.488 3.97649C11.5201 4.66724 12.3238 5.64888 12.7973 6.79697C12.8459 6.92793 12.8459 7.072 12.7973 7.20297C12.3238 8.35105 11.5201 9.33269 10.488 10.0234C9.45595 10.7142 8.24202 11.0829 7.00013 11.0829C5.75824 11.0829 4.54431 10.7142 3.51225 10.0234C2.48018 9.33269 1.67646 8.35105 1.20297 7.20297Z" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M7 8.75C7.9665 8.75 8.75 7.9665 8.75 7C8.75 6.0335 7.9665 5.25 7 5.25C6.0335 5.25 5.25 6.0335 5.25 7C5.25 7.9665 6.0335 8.75 7 8.75Z" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          ))}
        </div>
        <div className="streaming-block-fields-footer">
          <span className="streaming-block-hint">우클릭으로 필드 블록 생성</span>
        </div>
      </div>

      <div className="connection-point connection-point-top" />
      <div className="connection-point connection-point-right" />
      <div className="connection-point connection-point-bottom" />
      <div className="connection-point connection-point-left" />
    </div>
  );
};

export default StreamingBlock;
