import { useMemo, useState } from 'react';

const CATEGORY_LABELS = {
  trigger: '트리거 블록',
  action: '액션 블록',
  streaming: '스트리밍 블록',
  monitoring: '모니터링 블록',
  normal: '일반 블록'
};

const CATEGORY_ORDER = ['trigger', 'action', 'streaming', 'monitoring', 'normal'];

export default function BlockListPanel({ onClose, blocks = [], selectedBlockIds = [], onSelectBlock }) {
  const [query, setQuery] = useState('');

  const filteredBlocks = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return blocks;
    }

    return blocks.filter((block) => {
      const label = block.name || block.id || '';
      return label.toLowerCase().includes(trimmed);
    });
  }, [blocks, query]);

  const groupedBlocks = useMemo(() => (
    CATEGORY_ORDER.map((category) => ({
      category,
      label: CATEGORY_LABELS[category],
      items: filteredBlocks.filter((block) => block.type === category)
    })).filter((group) => group.items.length > 0)
  ), [filteredBlocks]);

  const hasBlocks = groupedBlocks.length > 0;

  return (
    <div className="overlay-panel">
      <div className="panel-sidebar">
        {/* Panel sidebar icons */}
      </div>
      
      <div className="panel-content">
        <div className="panel-header">
          <h3 className="panel-title">블록 목록</h3>
        </div>
        
        <div className="panel-search">
          <div className="search-input">
            <svg className="search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M13.9997 14.0002L11.1064 11.1069" stroke="#A1A1A1" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M7.33333 12.6667C10.2789 12.6667 12.6667 10.2789 12.6667 7.33333C12.6667 4.38781 10.2789 2 7.33333 2C4.38781 2 2 4.38781 2 7.33333C2 10.2789 4.38781 12.6667 7.33333 12.6667Z" stroke="#A1A1A1" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <input
              type="text"
              placeholder="블록 이름 검색..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>

        {hasBlocks ? (
          <div className="panel-items panel-items--grouped">
            {groupedBlocks.map((group) => (
              <div key={group.category} className="panel-category">
                <p className="panel-category-title">{group.label}</p>
                <div className="panel-category-items">
                  {group.items.map((block) => (
                    <button
                      key={block.id}
                      type="button"
                      className={`panel-block-item${selectedBlockIds.includes(block.id) ? ' is-selected' : ''}`}
                      onClick={() => onSelectBlock?.(block.id)}
                      draggable
                      onDragStart={(event) => {
                        const name = block.name || block.id;
                        event.dataTransfer.setData('application/x-block-name', name);
                        event.dataTransfer.setData('text/plain', name);
                        event.dataTransfer.effectAllowed = 'copy';
                      }}
                    >
                      <span className="block-indicator" data-type={block.type}></span>
                      <span className="block-name">{block.name || block.id}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="panel-empty">
            <p className="empty-text">생성된 블록이 없습니다</p>
          </div>
        )}
      </div>
    </div>
  );
}
