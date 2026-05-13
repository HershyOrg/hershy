export default function HostControlBar({
  hostTarget,
  hostProgram,
  hostBusy,
  onDeploy,
  onStart,
  onRefresh,
  onStop,
  onOpenWatcherStatus,
  hasActiveTab
}) {
  return (
    <div className="host-control-bar">
      <div className="host-control-target">
        Host API Target: {hostTarget}
      </div>
      <button
        type="button"
        className="strategy-tool-btn host"
        onClick={onDeploy}
        disabled={!hasActiveTab || hostBusy}
      >
        {hostBusy ? '처리중...' : 'Host 배포'}
      </button>
      <button
        type="button"
        className="strategy-tool-btn"
        onClick={onStart}
        disabled={!hostProgram?.programId || hostBusy}
      >
        시작
      </button>
      <button
        type="button"
        className="strategy-tool-btn"
        onClick={onRefresh}
        disabled={!hostProgram?.programId || hostBusy}
      >
        상태
      </button>
      <button
        type="button"
        className="strategy-tool-btn"
        onClick={onStop}
        disabled={!hostProgram?.programId || hostBusy}
      >
        중지
      </button>
      <button
        type="button"
        className="strategy-tool-btn"
        onClick={onOpenWatcherStatus}
        disabled={!hostProgram?.programId}
      >
        Watcher 상태
      </button>
      {hostProgram && (
        <div className="host-program-summary">
          id {hostProgram.programId} · build {hostProgram.buildId} · state {hostProgram.state}
        </div>
      )}
    </div>
  );
}
