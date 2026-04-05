package diagnostics

// Severity describes how strongly a finding should be surfaced.
type Severity string

const (
	SeverityInfo     Severity = "info"
	SeverityWarning  Severity = "warning"
	SeverityError    Severity = "error"
	SeverityCritical Severity = "critical"
)

// Finding is a structured diagnostics item suitable for logs or AI notes.
type Finding struct {
	Code         ReasonCode     `json:"code"`
	Severity     Severity       `json:"severity"`
	Message      string         `json:"message"`
	Evidence     map[string]any `json:"evidence,omitempty"`
	SuggestedFix string         `json:"suggested_fix,omitempty"`
}

// NewFinding builds a structured diagnostics item.
func NewFinding(code ReasonCode, severity Severity, message string, evidence map[string]any, suggestedFix string) Finding {
	return Finding{
		Code:         code,
		Severity:     severity,
		Message:      message,
		Evidence:     evidence,
		SuggestedFix: suggestedFix,
	}
}
