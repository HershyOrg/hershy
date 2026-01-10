package will

// CtrlInfo는 Will이 지닌 제어신호임
type CtrlInfo struct {
	//Kind: Return, Continue, Break, Panic
	Kind CtrlKind
	// Return, Panic시의 리턴값 혹은 에러 메시지
	Values []Value
}

type CtrlKind int

const (
	PanicKind CtrlKind = iota
	ReturnKind
	Breakkind
	ContinueKind
)
