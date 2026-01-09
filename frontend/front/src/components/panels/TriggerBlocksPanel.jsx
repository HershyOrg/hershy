import { useState } from 'react';

export default function TriggerBlocksPanel({ onClose }) {
  const [triggerType, setTriggerType] = useState('manual');

  return (
    <div className="overlay-panel">
      <div className="panel-sidebar">
        {/* Panel sidebar icons */}
      </div>
      
      <div className="panel-content">
        <div className="panel-header">
          <h3 className="panel-title">트리거 블록</h3>
        </div>
        
        <div className="panel-form">
          <div className="form-field">
            <label className="field-label">블록 이름</label>
            <input 
              type="text" 
              className="field-input" 
              placeholder="예: Price_Check" 
            />
          </div>
          
          <div className="form-field">
            <label className="field-label">트리거 타입</label>
            <div className="button-group-vertical">
              <button 
                className={`btn-option ${triggerType === 'manual' ? 'active' : ''}`}
                onClick={() => setTriggerType('manual')}
              >
                수동 클릭
              </button>
              <button 
                className={`btn-option ${triggerType === 'time' ? 'active' : ''}`}
                onClick={() => setTriggerType('time')}
              >
                시간 기반
              </button>
              <button 
                className={`btn-option ${triggerType === 'condition' ? 'active' : ''}`}
                onClick={() => setTriggerType('condition')}
              >
                조건 기반
              </button>
            </div>
          </div>
          
          {triggerType === 'manual' && (
            <div className="info-box">
              <p className="info-text">이 트리거는 캔버스에서 블록을 클릭하면 실행됩니다.</p>
            </div>
          )}
          
          {triggerType === 'time' && (
            <div className="form-field">
              <label className="field-label">실행주기 (초)</label>
              <input 
                type="text" 
                className="field-input" 
                placeholder="예: 1" 
              />
            </div>
          )}
          
          {triggerType === 'condition' && (
            <>
              <div className="form-field">
                <label className="field-label">왼쪽 값</label>
                <input 
                  type="text" 
                  className="field-input" 
                  placeholder="블록을 선택하거나 값 입력" 
                />
              </div>
              
              <div className="form-field">
                <label className="field-label">비교 연산자</label>
                <input type="text" className="field-input" />
              </div>
              
              <div className="form-field">
                <label className="field-label">오른쪽 값</label>
                <input 
                  type="text" 
                  className="field-input" 
                  placeholder="블록을 선택하거나 값 입력" 
                />
              </div>
            </>
          )}
          
          <button className="btn-create disabled">블록 생성</button>
        </div>
      </div>
    </div>
  );
}
