import { useState } from 'react';

export default function NormalBlocksPanel({ onClose, onCreate }) {
  const [blockName, setBlockName] = useState('');
  const [value, setValue] = useState('');
  const canCreate = Boolean(blockName.trim());

  const handleCreate = () => {
    if (!canCreate || !onCreate) {
      return;
    }

    onCreate({
      name: blockName.trim(),
      value
    });

    setBlockName('');
    setValue('');
  };

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
              value={blockName}
              onChange={(event) => setBlockName(event.target.value)}
            />
          </div>
          
          <div className="form-field">
            <label className="field-label">값</label>
            <input 
              type="text" 
              className="field-input" 
              placeholder="예: 100"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
          
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
