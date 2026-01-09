import { useState } from 'react';

export default function ActionBlocksPanel({ onClose }) {
  const [actionType, setActionType] = useState('cex');

  return (
    <div className="overlay-panel">
      <div className="panel-sidebar">
        {/* Panel sidebar icons */}
      </div>
      
      <div className="panel-content">
        <div className="panel-header">
          <h3 className="panel-title">Action 블록</h3>
        </div>
        
        <div className="panel-form">
          <div className="form-field">
            <label className="field-label">블록 이름</label>
            <input 
              type="text" 
              className="field-input" 
              placeholder="예: BTC_Buy_Action" 
            />
          </div>
          
          <div className="form-field">
            <label className="field-label">액션 타입</label>
            <div className="button-group">
              <button 
                className={`btn-option tall ${actionType === 'cex' ? 'active' : ''}`}
                onClick={() => setActionType('cex')}
              >
                중앙화 거래소 (CEX)
              </button>
              <button 
                className={`btn-option tall ${actionType === 'contract' ? 'active' : ''}`}
                onClick={() => setActionType('contract')}
              >
                스마트 컨트랙트
              </button>
            </div>
          </div>
          
          <div className="form-field">
            <label className="field-label">거래소</label>
            <input type="text" className="field-input" />
          </div>
          
          <div className="form-field">
            <label className="field-label">시장 타입</label>
            <input type="text" className="field-input" />
          </div>
          
          <div className="form-field">
            <label className="field-label">토큰</label>
            <input 
              type="text" 
              className="field-input" 
              placeholder="예: BTCUSDT" 
            />
          </div>
          
          <div className="form-field">
            <label className="field-label">시장 타입</label>
            <input type="text" className="field-input" />
          </div>
          
          <button className="btn-create">블록 생성</button>
        </div>
      </div>
    </div>
  );
}
