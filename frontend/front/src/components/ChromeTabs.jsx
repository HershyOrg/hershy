export default function ChromeTabs({
  tabs,
  activeTabId,
  onAddTab,
  onCloseTab,
  onSelectTab
}) {
  return (
    <div className="chrome-tabs">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab ${activeTabId === tab.id ? 'active' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => onSelectTab(tab.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelectTab(tab.id);
            }
          }}
        >
          <span className="tab-label">{tab.label}</span>
          <button
            className="tab-close"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onCloseTab(tab.id);
            }}
            aria-label={`${tab.label} 닫기`}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 3L3 9" stroke="white" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M3 3L9 9" stroke="white" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      ))}
      
      <button className="tab-add" type="button" onClick={onAddTab} aria-label="새 전략 추가">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3.33301 8H12.6663" stroke="#94A3B8" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M8 3.3335V12.6668" stroke="#94A3B8" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  );
}
