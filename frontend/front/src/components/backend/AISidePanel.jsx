export default function AISidePanel({
  open,
  aiPrompt,
  onChangePrompt,
  aiBusy,
  aiNotice,
  onGenerate,
  onResetPrompt,
  onClose,
  disabled
}) {
  return (
    <div className={`ai-side-panel${open ? ' open' : ''}`}>
      <div className="ai-side-header">
        <div className="ai-side-title">AI 전략</div>
        <button
          type="button"
          className="ai-side-close"
          onClick={onClose}
        >
          닫기
        </button>
      </div>
      <div className="ai-side-body">
        <label htmlFor="ai-strategy-prompt" className="ai-control-label">요청 프롬프트</label>
        <textarea
          id="ai-strategy-prompt"
          className="ai-control-input"
          value={aiPrompt}
          onChange={(event) => onChangePrompt(event.target.value)}
          placeholder="예: BTCUSDT 1시간 마켓 기준으로 돌파 매수/이탈 매도 전략 만들어줘"
          rows={7}
        />
        <div className="ai-control-actions">
          <button
            type="button"
            className="strategy-tool-btn host"
            onClick={onGenerate}
            disabled={disabled || aiBusy}
          >
            {aiBusy ? 'AI 생성중...' : 'AI로 전략 생성'}
          </button>
          <button
            type="button"
            className="strategy-tool-btn"
            onClick={onResetPrompt}
            disabled={aiBusy}
          >
            예시 입력
          </button>
        </div>
        <div className="ai-control-hint">
          front 서버의 `/api/ai/strategy-draft`(오케스트레이션 to 리서치 to 전략)를 호출하고, 실패하면 로컬 규칙 생성으로 대체합니다.
        </div>
        {aiNotice && (
          <div className={`ai-control-message ${aiNotice.type}`}>
            {aiNotice.message}
          </div>
        )}
      </div>
    </div>
  );
}
