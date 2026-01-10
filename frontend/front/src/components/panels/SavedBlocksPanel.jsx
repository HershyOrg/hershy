import { useMemo, useState } from 'react';

export default function SavedBlocksPanel({ onClose, templates = [], onCreateTemplate, onDeleteTemplate }) {
  const [query, setQuery] = useState('');

  const filteredTemplates = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return templates;
    }

    return templates.filter((template) => template.name.toLowerCase().includes(trimmed));
  }, [templates, query]);

  return (
    <div className="overlay-panel">
      <div className="panel-sidebar">
        {/* Panel sidebar icons */}
      </div>
      
      <div className="panel-content">
        <div className="panel-header">
          <h3 className="panel-title">저장된 블록</h3>
        </div>
        
        <div className="panel-search">
          <div className="search-input">
            <svg className="search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M13.9997 14.0002L11.1064 11.1069" stroke="#A1A1A1" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M7.33333 12.6667C10.2789 12.6667 12.6667 10.2789 12.6667 7.33333C12.6667 4.38781 10.2789 2 7.33333 2C4.38781 2 2 4.38781 2 7.33333C2 10.2789 4.38781 12.6667 7.33333 12.6667Z" stroke="#A1A1A1" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <input
              type="text"
              placeholder="저장된 ब्ल록 검색..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>

        {filteredTemplates.length === 0 ? (
          <div className="panel-empty">
            <p className="empty-text">저장된 블록이 없습니다</p>
          </div>
        ) : (
          <div className="panel-items">
            {filteredTemplates.map((template) => (
              <div key={template.id} className="saved-block-row">
                <button
                  type="button"
                  className="saved-block-item"
                  onClick={() => onCreateTemplate?.(template)}
                >
                  <span className="block-indicator"></span>
                  <span className="block-name">{template.name}</span>
                </button>
                <button
                  type="button"
                  className="saved-block-delete"
                  onClick={() => onDeleteTemplate?.(template.id)}
                  aria-label="저장된 블록 삭제"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
