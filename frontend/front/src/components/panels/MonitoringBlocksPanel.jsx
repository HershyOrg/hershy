import { useState } from 'react';

export default function MonitoringBlocksPanel({ onClose, onCreate }) {
  const [monitorType, setMonitorType] = useState('table');
  const [blockName, setBlockName] = useState('');
  const canCreate = Boolean(blockName.trim());

  const handleCreate = () => {
    if (!canCreate || !onCreate) {
      return;
    }

    onCreate({
      name: blockName.trim(),
      monitorType,
      connectedStream: '',
      fields: []
    });

    setBlockName('');
  };

  return (
    <div className="overlay-panel">
      <div className="panel-sidebar">
        {/* Panel sidebar icons */}
      </div>
      
      <div className="panel-content">
        <div className="panel-header">
          <h3 className="panel-title">스트리밍 모니터링</h3>
        </div>
        
        <div className="panel-form">
          <div className="form-field">
            <label className="field-label">블록 이름</label>
            <input 
              type="text" 
              className="field-input" 
              placeholder="예: Price_Monitor"
              value={blockName}
              onChange={(event) => setBlockName(event.target.value)}
            />
          </div>
          
          <div className="form-field">
            <label className="field-label">모니터링 타입</label>
            <div className="monitor-type-cards">
              <button 
                className={`monitor-card ${monitorType === 'table' ? 'active' : ''}`}
                onClick={() => setMonitorType('table')}
              >
                <svg className="monitor-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M10 2.5V17.5" stroke="white" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M15.8333 2.5H4.16667C3.24619 2.5 2.5 3.24619 2.5 4.16667V15.8333C2.5 16.7538 3.24619 17.5 4.16667 17.5H15.8333C16.7538 17.5 17.5 16.7538 17.5 15.8333V4.16667C17.5 3.24619 16.7538 2.5 15.8333 2.5Z" stroke="white" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M2.5 7.5H17.5" stroke="white" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M2.5 12.5H17.5" stroke="white" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <div className="monitor-card-content">
                  <h4 className="monitor-card-title">테이블 모니터링</h4>
                  <p className="monitor-card-desc">스트리밍 데이터를 테이블 형식으로 정리하여 표시합니다</p>
                </div>
              </button>
              
              <button 
                className={`monitor-card ${monitorType === 'search' ? 'active' : ''}`}
                onClick={() => setMonitorType('search')}
              >
                <svg className="monitor-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M17.5005 17.5L13.8838 13.8833" stroke="white" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M9.16667 15.8333C12.8486 15.8333 15.8333 12.8486 15.8333 9.16667C15.8333 5.48477 12.8486 2.5 9.16667 2.5C5.48477 2.5 2.5 5.48477 2.5 9.16667C2.5 12.8486 5.48477 15.8333 9.16667 15.8333Z" stroke="white" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <div className="monitor-card-content">
                  <h4 className="monitor-card-title">검색 모니터링</h4>
                  <p className="monitor-card-desc">프론트 탭에서 데이터 검색 및 필터링이 가능합니다</p>
                </div>
              </button>
            </div>
          </div>
          
          <div className="info-box">
            <p className="info-text">💡 블록 생성 후 백엔드 탭에서 화살표로 스트리밍 블록과 연결하세요</p>
            <p className="info-text">🔗 연결된 블록만 프론트 탭에서 표시됩니다</p>
          </div>
          
          <button
            type="button"
            className={`btn-create ${canCreate ? '' : 'disabled'}`}
            disabled={!canCreate}
            onClick={handleCreate}
          >
            모니터링 블록 생성
          </button>
        </div>
      </div>
    </div>
  );
}
