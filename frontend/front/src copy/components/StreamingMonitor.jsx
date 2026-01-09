import React, { useState } from 'react';
import './StreamingMonitor.css';

export const StreamingTableMonitor = ({ 
  name = "Price_Table_Monitor",
  source = "TABLE NAME",
  totalRecords = 100,
  visibleFields = "5/6",
  lastUpdate = "오후 06:27:19",
  updateSpeed = "실시간",
  currentPage = 1,
  totalPages = 10,
  viewMode = "card" // "card" or "list"
}) => {
  const [mode, setMode] = useState(viewMode);
  const [page, setPage] = useState(currentPage);

  return (
    <div className="streaming-monitor">
      <div className="streaming-monitor-header">
        <div className="streaming-monitor-info">
          <div className="streaming-monitor-status" />
          <div className="streaming-monitor-title-section">
            <div className="streaming-monitor-title-row">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 2V14" stroke="#94A3B8" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12.6667 2H3.33333C2.59695 2 2 2.59695 2 3.33333V12.6667C2 13.403 2.59695 14 3.33333 14H12.6667C13.403 14 14 13.403 14 12.6667V3.33333C14 2.59695 13.403 2 12.6667 2Z" stroke="#94A3B8" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 6H14" stroke="#94A3B8" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 10H14" stroke="#94A3B8" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <h3 className="streaming-monitor-name">{name}</h3>
            </div>
            <p className="streaming-monitor-source">SOURCE: {source}</p>
          </div>
        </div>
        <div className="streaming-monitor-controls">
          <div className="view-mode-toggle">
            <button 
              className={`view-mode-btn ${mode === 'card' ? 'active' : ''}`}
              onClick={() => setMode('card')}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M6 2H2.66667C2.29848 2 2 2.29848 2 2.66667V6C2 6.36819 2.29848 6.66667 2.66667 6.66667H6C6.36819 6.66667 6.66667 6.36819 6.66667 6V2.66667C6.66667 2.29848 6.36819 2 6 2Z" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M13.3335 2H10.0002C9.63197 2 9.3335 2.29848 9.3335 2.66667V6C9.3335 6.36819 9.63197 6.66667 10.0002 6.66667H13.3335C13.7017 6.66667 14.0002 6.36819 14.0002 6V2.66667C14.0002 2.29848 13.7017 2 13.3335 2Z" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M13.3335 9.3335H10.0002C9.63197 9.3335 9.3335 9.63197 9.3335 10.0002V13.3335C9.3335 13.7017 9.63197 14.0002 10.0002 14.0002H13.3335C13.7017 14.0002 14.0002 13.7017 14.0002 13.3335V10.0002C14.0002 9.63197 13.7017 9.3335 13.3335 9.3335Z" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M6 9.3335H2.66667C2.29848 9.3335 2 9.63197 2 10.0002V13.3335C2 13.7017 2.29848 14.0002 2.66667 14.0002H6C6.36819 14.0002 6.66667 13.7017 6.66667 13.3335V10.0002C6.66667 9.63197 6.36819 9.3335 6 9.3335Z" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <button 
              className={`view-mode-btn ${mode === 'list' ? 'active' : ''}`}
              onClick={() => setMode('list')}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 8H2.00667" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 12H2.00667" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 4H2.00667" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M5.3335 8H14.0002" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M5.3335 12H14.0002" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M5.3335 4H14.0002" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
          <button className="monitor-control-btn">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 8C2 6.4087 2.63214 4.88258 3.75736 3.75736C4.88258 2.63214 6.4087 2 8 2C9.67737 2.00631 11.2874 2.66082 12.4933 3.82667L14 5.33333" stroke="white" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M13.9998 2V5.33333H10.6665" stroke="white" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M14 8C14 9.5913 13.3679 11.1174 12.2426 12.2426C11.1174 13.3679 9.5913 14 8 14C6.32263 13.9937 4.71265 13.3392 3.50667 12.1733L2 10.6667" stroke="white" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M5.33333 10.6665H2V13.9998" stroke="white" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button className="monitor-control-btn disabled">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M14 10V12.6667C14 13.0203 13.8595 13.3594 13.6095 13.6095C13.3594 13.8595 13.0203 14 12.6667 14H3.33333C2.97971 14 2.64057 13.8595 2.39052 13.6095C2.14048 13.3594 2 13.0203 2 12.6667V10" stroke="white" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M4.6665 6.6665L7.99984 9.99984L11.3332 6.6665" stroke="white" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M8 10V2" stroke="white" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="streaming-monitor-stats">
        <div className="monitor-stat">
          <span className="monitor-stat-label">전체 레코드</span>
          <span className="monitor-stat-value">{totalRecords}</span>
        </div>
        <div className="monitor-stat">
          <span className="monitor-stat-label">표시 필드</span>
          <span className="monitor-stat-value">{visibleFields}</span>
        </div>
        <div className="monitor-stat">
          <span className="monitor-stat-label">최근 업데이트</span>
          <span className="monitor-stat-value monitor-stat-time">{lastUpdate}</span>
        </div>
        <div className="monitor-stat">
          <span className="monitor-stat-label">업데이트 속도</span>
          <span className="monitor-stat-value monitor-stat-live">{updateSpeed}</span>
        </div>
      </div>

      <div className="streaming-monitor-footer">
        <div className="monitor-pagination-info">
          <span>{(page - 1) * 10 + 1} - {Math.min(page * 10, totalRecords)} / {totalRecords}</span>
        </div>
        <div className="monitor-pagination-controls">
          <button 
            className="monitor-page-btn"
            disabled={page === 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
          >
            이전
          </button>
          <span className="monitor-page-info">{page} / {totalPages}</span>
          <button 
            className="monitor-page-btn"
            disabled={page === totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          >
            다음
          </button>
        </div>
      </div>
    </div>
  );
};

export const StreamingSearchMonitor = ({ 
  name = "Trade_Search",
  source = "Binance_BTC_Stream",
  searchPlaceholder = "데이터 검색... (모든 필드 대상)",
  currentPage = 1,
  totalPages = 10,
  totalRecords = 100,
  viewMode = "card"
}) => {
  const [mode, setMode] = useState(viewMode);
  const [page, setPage] = useState(currentPage);
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <div className="streaming-monitor">
      <div className="streaming-monitor-header">
        <div className="streaming-monitor-info">
          <div className="streaming-monitor-status" />
          <div className="streaming-monitor-title-section">
            <div className="streaming-monitor-title-row">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M7.33333 12.6667C10.2789 12.6667 12.6667 10.2789 12.6667 7.33333C12.6667 4.38781 10.2789 2 7.33333 2C4.38781 2 2 4.38781 2 7.33333C2 10.2789 4.38781 12.6667 7.33333 12.6667Z" stroke="#94A3B8" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M14 14L11.1333 11.1333" stroke="#94A3B8" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <h3 className="streaming-monitor-name">{name}</h3>
            </div>
            <p className="streaming-monitor-source">SOURCE: {source}</p>
          </div>
        </div>
        <div className="streaming-monitor-controls">
          <div className="view-mode-toggle">
            <button 
              className={`view-mode-btn ${mode === 'card' ? 'active' : ''}`}
              onClick={() => setMode('card')}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M6 2H2.66667C2.29848 2 2 2.29848 2 2.66667V6C2 6.36819 2.29848 6.66667 2.66667 6.66667H6C6.36819 6.66667 6.66667 6.36819 6.66667 6V2.66667C6.66667 2.29848 6.36819 2 6 2Z" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M13.3335 2H10.0002C9.63197 2 9.3335 2.29848 9.3335 2.66667V6C9.3335 6.36819 9.63197 6.66667 10.0002 6.66667H13.3335C13.7017 6.66667 14.0002 6.36819 14.0002 6V2.66667C14.0002 2.29848 13.7017 2 13.3335 2Z" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M13.3335 9.3335H10.0002C9.63197 9.3335 9.3335 9.63197 9.3335 10.0002V13.3335C9.3335 13.7017 9.63197 14.0002 10.0002 14.0002H13.3335C13.7017 14.0002 14.0002 13.7017 14.0002 13.3335V10.0002C14.0002 9.63197 13.7017 9.3335 13.3335 9.3335Z" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M6 9.3335H2.66667C2.29848 9.3335 2 9.63197 2 10.0002V13.3335C2 13.7017 2.29848 14.0002 2.66667 14.0002H6C6.36819 14.0002 6.66667 13.7017 6.66667 13.3335V10.0002C6.66667 9.63197 6.36819 9.3335 6 9.3335Z" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <button 
              className={`view-mode-btn ${mode === 'list' ? 'active' : ''}`}
              onClick={() => setMode('list')}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 8H2.00667" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 12H2.00667" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 4H2.00667" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M5.3335 8H14.0002" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M5.3335 12H14.0002" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M5.3335 4H14.0002" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
          <button className="monitor-control-btn">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 8C2 6.4087 2.63214 4.88258 3.75736 3.75736C4.88258 2.63214 6.4087 2 8 2C9.67737 2.00631 11.2874 2.66082 12.4933 3.82667L14 5.33333" stroke="white" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M13.9998 2V5.33333H10.6665" stroke="white" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M14 8C14 9.5913 13.3679 11.1174 12.2426 12.2426C11.1174 13.3679 9.5913 14 8 14C6.32263 13.9937 4.71265 13.3392 3.50667 12.1733L2 10.6667" stroke="white" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M5.33333 10.6665H2V13.9998" stroke="white" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button className="monitor-control-btn disabled">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M14 10V12.6667C14 13.0203 13.8595 13.3594 13.6095 13.6095C13.3594 13.8595 13.0203 14 12.6667 14H3.33333C2.97971 14 2.64057 13.8595 2.39052 13.6095C2.14048 13.3594 2 13.0203 2 12.6667V10" stroke="white" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M4.6665 6.6665L7.99984 9.99984L11.3332 6.6665" stroke="white" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M8 10V2" stroke="white" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="streaming-search-section">
        <div className="streaming-search-bar">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M7.33333 12.6667C10.2789 12.6667 12.6667 10.2789 12.6667 7.33333C12.6667 4.38781 10.2789 2 7.33333 2C4.38781 2 2 4.38781 2 7.33333C2 10.2789 4.38781 12.6667 7.33333 12.6667Z" stroke="#64748B" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M14 14L11.1333 11.1333" stroke="#64748B" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <input 
            type="text"
            className="streaming-search-input"
            placeholder={searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="streaming-search-footer">
          <div className="monitor-pagination-info">
            <span>{(page - 1) * 10 + 1} - {Math.min(page * 10, totalRecords)} / {totalRecords}</span>
          </div>
          <div className="monitor-pagination-controls">
            <button 
              className="monitor-page-btn"
              disabled={page === 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              이전
            </button>
            <span className="monitor-page-info">{page} / {totalPages}</span>
            <button 
              className="monitor-page-btn"
              disabled={page === totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            >
              다음
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
