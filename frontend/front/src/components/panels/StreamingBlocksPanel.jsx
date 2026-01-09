import { useState } from 'react';

export default function StreamingBlocksPanel({ onClose }) {
  const [dataReceptionType, setDataReceptionType] = useState('realtime');

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
            />
          </div>
          
          <div className="form-field">
            <label className="field-label">API/WebSocket URL</label>
            <input 
              type="text" 
              className="field-input" 
              placeholder={dataReceptionType === 'periodic' ? 'wss://stream.binance.com:9443/ws/btcusdt@ticker' : '예: BTCUSDT_Price'} 
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
              />
            </div>
          )}
          
          <div className="form-field">
            <label className="field-label">반환값 형식 (JSON)</label>
            <textarea 
              className="field-textarea" 
              placeholder='{"price": "number", "volume": "number", "timestamp": "string"}'
            />
          </div>
          
          <button className="btn-parse disabled">필드 파싱</button>
          
          <button className="btn-create disabled">블록 생성</button>
        </div>
      </div>
    </div>
  );
}
