export default function Sidebar({ activePanel, onIconClick }) {
  const icons = [
    { type: 'block-list', label: '블록 목록', icon: 'grid' },
    { type: 'saved-blocks', label: '저장된 블록', icon: 'bookmark' },
    { type: 'streaming-blocks', label: '스트리밍 블록', icon: 'activity' },
    { type: 'normal-blocks', label: '일반 블록', icon: 'package' },
    { type: 'trigger-blocks', label: '트리거 블록', icon: 'code' },
    { type: 'action-blocks', label: '액션 블록', icon: 'zap' },
    { type: 'monitoring-blocks', label: '모니터링 블록', icon: 'monitor' }
  ];

  return (
    <div className="sidebar">
      <div className="sidebar-border"></div>
      
      <div className="sidebar-icons">
        {icons.map((item, index) => (
          <button
            key={item.type}
            className={`sidebar-icon-btn ${activePanel === item.type ? 'active' : ''}`}
            onClick={() => onIconClick(item.type)}
            style={{ top: `${16 + index * 44}px` }}
          >
            {renderIcon(item.icon)}
          </button>
        ))}
      </div>
    </div>
  );
}

function renderIcon(iconType) {
  const icons = {
    grid: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g clipPath="url(#clip0)">
          <path d="M0.832031 0.832031H0.840365" stroke="white" strokeWidth="1.66381" strokeLinecap="round" strokeLinejoin="round"/>
        </g>
        <g clipPath="url(#clip1)" transform="translate(2, 9)">
          <path d="M0.832031 0.828125H0.840365" stroke="white" strokeWidth="1.6599" strokeLinecap="round" strokeLinejoin="round"/>
        </g>
        <g clipPath="url(#clip2)" transform="translate(2, 15)">
          <path d="M0.832031 0.832031H0.840365" stroke="white" strokeWidth="1.66381" strokeLinecap="round" strokeLinejoin="round"/>
        </g>
        <g clipPath="url(#clip3)" transform="translate(6, 3)">
          <path d="M0.833008 0.832031H11.6596" stroke="white" strokeWidth="1.66484" strokeLinecap="round" strokeLinejoin="round"/>
        </g>
        <g clipPath="url(#clip4)" transform="translate(6, 9)">
          <path d="M0.833008 0.828125H11.6596" stroke="white" strokeWidth="1.66093" strokeLinecap="round" strokeLinejoin="round"/>
        </g>
        <g clipPath="url(#clip5)" transform="translate(6, 15)">
          <path d="M0.833008 0.832031H11.6596" stroke="white" strokeWidth="1.66484" strokeLinecap="round" strokeLinejoin="round"/>
        </g>
      </svg>
    ),
    bookmark: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M15.8337 17.5L10.0003 14.1667L4.16699 17.5V4.16667C4.16699 3.72464 4.34259 3.30072 4.65515 2.98816C4.96771 2.67559 5.39163 2.5 5.83366 2.5H14.167C14.609 2.5 15.0329 2.67559 15.3455 2.98816C15.6581 3.30072 15.8337 3.72464 15.8337 4.16667V17.5Z" stroke="#94A3B8" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    activity: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M18.326 9.99602H14.994L12.495 17.493L7.49702 2.49902L4.99802 9.99602H1.66602" stroke="#A1A1A1" strokeWidth="1.38834" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    package: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M17.5 6.66675C17.4997 6.37448 17.4225 6.08742 17.2763 5.83438C17.13 5.58134 16.9198 5.37122 16.6667 5.22508L10.8333 1.89175C10.58 1.74547 10.2926 1.66846 10 1.66846C9.70744 1.66846 9.42003 1.74547 9.16667 1.89175L3.33333 5.22508C3.08022 5.37122 2.86998 5.58134 2.72372 5.83438C2.57745 6.08742 2.5003 6.37448 2.5 6.66675V13.3334C2.5003 13.6257 2.57745 13.9127 2.72372 14.1658C2.86998 14.4188 3.08022 14.6289 3.33333 14.7751L9.16667 18.1084C9.42003 18.2547 9.70744 18.3317 10 18.3317C10.2926 18.3317 10.58 18.2547 10.8333 18.1084L16.6667 14.7751C16.9198 14.6289 17.13 14.4188 17.2763 14.1658C17.4225 13.9127 17.4997 13.6257 17.5 13.3334V6.66675Z" stroke="#94A3B8" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M2.75 5.8335L10 10.0002L17.25 5.8335" stroke="#94A3B8" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M10 18.3333V10" stroke="#94A3B8" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    code: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M6.66634 17.5C6.66634 17.5 3.33301 15 3.33301 10C3.33301 5 6.66634 2.5 6.66634 2.5" stroke="#94A3B8" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M13.333 2.5C13.333 2.5 16.6663 5 16.6663 10C16.6663 15 13.333 17.5 13.333 17.5" stroke="#94A3B8" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M12.5 7.5L7.5 12.5" stroke="#94A3B8" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M7.5 7.5L12.5 12.5" stroke="#94A3B8" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    zap: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10.829 1.66602L2.49902 11.662H9.99602L9.16302 18.326L17.493 8.33002H9.99602L10.829 1.66602Z" stroke="#A1A1A1" strokeWidth="1.38834" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    monitor: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 14.1665V17.4998" stroke="#94A3B8" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M18.3337 10.2558V12.5C18.3337 12.942 18.1581 13.366 17.8455 13.6785C17.5329 13.9911 17.109 14.1667 16.667 14.1667H3.33366C2.89163 14.1667 2.46771 13.9911 2.15515 13.6785C1.84259 13.366 1.66699 12.942 1.66699 12.5V4.16667C1.66699 3.72464 1.84259 3.30072 2.15515 2.98816C2.46771 2.67559 2.89163 2.5 3.33366 2.5H10.5778" stroke="#94A3B8" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M6.66699 17.5H13.3337" stroke="#94A3B8" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M15.833 7.5C17.2137 7.5 18.333 6.38071 18.333 5C18.333 3.61929 17.2137 2.5 15.833 2.5C14.4523 2.5 13.333 3.61929 13.333 5C13.333 6.38071 14.4523 7.5 15.833 7.5Z" stroke="#94A3B8" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )
  };

  return icons[iconType] || null;
}
