export default function StrategyFeedbackBar({ strategyReport, strategyNotice }) {
  return (
    <>
      <div className="strategy-feedback-bar">
        <div className={`strategy-feedback-chip ${strategyReport?.valid ? 'valid' : 'invalid'}`}>
          {strategyReport
            ? `검증: ${strategyReport.valid ? '통과' : '실패'}`
            : '검증: 미실행'}
        </div>
        {strategyReport && (
          <div className="strategy-feedback-summary">
            blocks {strategyReport.stats?.blocks ?? 0} · links {strategyReport.stats?.connections ?? 0}
            {' '}· errors {strategyReport.errors.length} · warnings {strategyReport.warnings.length}
          </div>
        )}
        {strategyNotice && (
          <div className={`strategy-feedback-message ${strategyNotice.type}`}>
            {strategyNotice.message}
          </div>
        )}
      </div>
      {strategyReport && (strategyReport.errors.length > 0 || strategyReport.warnings.length > 0) && (
        <div className="strategy-feedback-issues">
          {strategyReport.errors.slice(0, 3).map((item) => (
            <div key={`err-${item.code}-${item.message}`} className="strategy-feedback-issue error">
              [ERR] {item.message}
            </div>
          ))}
          {strategyReport.warnings.slice(0, 3).map((item) => (
            <div key={`warn-${item.code}-${item.message}`} className="strategy-feedback-issue warn">
              [WARN] {item.message}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
