export default function NormalBlocksPanel({ onClose }) {
  return (
    <div className="overlay-panel">
      <div className="panel-sidebar">
        {/* Panel sidebar icons */}
      </div>
      
      <div className="panel-content">
        <div className="panel-header">
          <h3 className="panel-title">일반 블록</h3>
        </div>
        
        <div className="panel-form">
          <div className="form-field">
            <label className="field-label">블록 이름</label>
            <input 
              type="text" 
              className="field-input" 
              placeholder="예: Static_Value" 
            />
          </div>
          
          <div className="form-field">
            <label className="field-label">값</label>
            <input 
              type="text" 
              className="field-input" 
              placeholder="예: 100" 
            />
          </div>
          
          <button className="btn-create disabled">블록 생성</button>
        </div>
      </div>
    </div>
  );
}
