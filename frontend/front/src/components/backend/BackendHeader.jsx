import ChromeTabs from '../ChromeTabs';

export default function BackendHeader({
  tabs,
  activeTabId,
  onAddTab,
  onCloseTab,
  onSelectTab,
  onValidateStrategy,
  onCopyStrategyJson,
  onDownloadStrategyJson,
  onOpenHostUI,
  aiPanelOpen,
  onToggleAIPanel,
  viewMode,
  onSelectViewMode,
  hasActiveTab
}) {
  return (
    <div className="backend-tab-header">
      <ChromeTabs
        tabs={tabs}
        activeTabId={activeTabId}
        onAddTab={onAddTab}
        onCloseTab={onCloseTab}
        onSelectTab={onSelectTab}
      />
      <div className="backend-view-toggle">
        <button
          type="button"
          className="strategy-tool-btn"
          onClick={onValidateStrategy}
          disabled={!hasActiveTab}
        >
          전략 검증
        </button>
        <button
          type="button"
          className="strategy-tool-btn"
          onClick={onCopyStrategyJson}
          disabled={!hasActiveTab}
        >
          JSON 복사
        </button>
        <button
          type="button"
          className="strategy-tool-btn"
          onClick={onDownloadStrategyJson}
          disabled={!hasActiveTab}
        >
          JSON 저장
        </button>
        <button
          type="button"
          className="strategy-tool-btn host"
          onClick={onOpenHostUI}
        >
          Host UI
        </button>
        <button
          type="button"
          className={`strategy-tool-btn ai${aiPanelOpen ? ' active' : ''}`}
          onClick={onToggleAIPanel}
        >
          AI 전략
        </button>
        <button
          type="button"
          className={`backend-view-btn${viewMode === 'backend' ? ' active' : ''}`}
          onClick={() => onSelectViewMode('backend')}
        >
          백엔드
        </button>
        <button
          type="button"
          className={`backend-view-btn${viewMode === 'front' ? ' active' : ''}`}
          onClick={() => onSelectViewMode('front')}
        >
          프론트
        </button>
        <button
          type="button"
          className={`backend-view-btn${viewMode === 'preauth' ? ' active' : ''}`}
          onClick={() => onSelectViewMode('preauth')}
        >
          사전인증
        </button>
      </div>
    </div>
  );
}
