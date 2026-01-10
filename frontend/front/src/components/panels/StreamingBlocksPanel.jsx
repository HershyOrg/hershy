import { useState } from 'react';
import { getStreamingFields } from '../../data/blockFixtures';

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

const parseJsonFields = (rawValue) => {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);
    return flattenJsonFields(parsed);
  } catch (error) {
    return [];
  }

  return [];
};

export default function StreamingBlocksPanel({ onClose, onCreate }) {
  const [dataReceptionType, setDataReceptionType] = useState('realtime');
  const [blockName, setBlockName] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [updateInterval, setUpdateInterval] = useState('');
  const [responseFormat, setResponseFormat] = useState('');
  const [fields, setFields] = useState([]);

  const canParse = Boolean(apiUrl.trim() || responseFormat.trim());
  const canCreate = Boolean(blockName.trim()) && (fields.length > 0 || canParse);

  const resolveFields = () => {
    const jsonFields = parseJsonFields(responseFormat);
    if (jsonFields.length > 0) {
      return jsonFields;
    }
    return getStreamingFields(apiUrl.trim());
  };

  const handleParseFields = () => {
    setFields(resolveFields());
  };

  const handleCreate = () => {
    if (!blockName.trim()) {
      return;
    }

    let nextFields = fields;
    if (nextFields.length === 0) {
      nextFields = resolveFields();
      setFields(nextFields);
    }

    if (nextFields.length === 0 || !onCreate) {
      return;
    }

    const updateMode = dataReceptionType === 'periodic' ? 'periodic' : 'live';
    const resolvedInterval = dataReceptionType === 'periodic'
      ? Number(updateInterval || 1000)
      : 1000;

    onCreate({
      name: blockName.trim(),
      fields: nextFields,
      updateMode,
      updateInterval: resolvedInterval,
      responseSchema: responseFormat.trim()
    });

    setBlockName('');
    setFields([]);
  };

  return (
    <div className="overlay-panel">
      <div className="panel-sidebar">
        {/* Panel sidebar icons */}
      </div>
      
      <div className="panel-content">
        <div className="panel-header">
          <h3 className="panel-title">스트리밍 블록</h3>
        </div>
        
        <div className="panel-form">
          <div className="form-field">
            <label className="field-label">블록 이름</label>
            <input 
              type="text" 
              className="field-input" 
              placeholder="예: BTCUSDT_Price"
              value={blockName}
              onChange={(event) => setBlockName(event.target.value)}
            />
          </div>
          
          <div className="form-field">
            <label className="field-label">API/WebSocket URL</label>
            <input 
              type="text" 
              className="field-input" 
              placeholder={dataReceptionType === 'periodic' ? 'wss://stream.binance.com:9443/ws/btcusdt@ticker' : '예: BTCUSDT_Price'}
              value={apiUrl}
              onChange={(event) => setApiUrl(event.target.value)}
            />
          </div>
          
          <div className="form-field">
            <label className="field-label">데이터 수신 방식</label>
            <div className="button-group">
              <button 
                className={`btn-option ${dataReceptionType === 'realtime' ? 'active' : ''}`}
                onClick={() => setDataReceptionType('realtime')}
              >
                실시간
              </button>
              <button 
                className={`btn-option ${dataReceptionType === 'periodic' ? 'active' : ''}`}
                onClick={() => setDataReceptionType('periodic')}
              >
                주기적
              </button>
            </div>
          </div>
          
          {dataReceptionType === 'periodic' && (
            <div className="form-field">
              <label className="field-label">업데이트 주기 (초)</label>
              <input 
                type="text" 
                className="field-input" 
                placeholder="예: 1"
                value={updateInterval}
                onChange={(event) => setUpdateInterval(event.target.value)}
              />
            </div>
          )}
          
          <div className="form-field">
            <label className="field-label">반환값 형식 (JSON)</label>
            <textarea 
              className="field-textarea" 
              placeholder='{"price": "number", "volume": "number", "timestamp": "string"}'
              value={responseFormat}
              onChange={(event) => setResponseFormat(event.target.value)}
            />
          </div>
          
          <button
            type="button"
            className={`btn-parse ${canParse ? '' : 'disabled'}`}
            disabled={!canParse}
            onClick={handleParseFields}
          >
            필드 파싱
          </button>

          {fields.length > 0 && (
            <div className="field-preview">
              <span className="field-preview-label">파싱된 필드</span>
              <div className="field-preview-list">
                {fields.map((field) => (
                  <span key={field} className="field-preview-tag">{field}</span>
                ))}
              </div>
            </div>
          )}
          
          <button
            type="button"
            className={`btn-create ${canCreate ? '' : 'disabled'}`}
            disabled={!canCreate}
            onClick={handleCreate}
          >
            블록 생성
          </button>
        </div>
      </div>
    </div>
  );
}
