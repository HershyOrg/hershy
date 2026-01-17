package parser

// * If, For && Stop, Break, Continue && Return을 매크로로 취급.
// * Stop과 Return 제어신호는 핸들링되지 않음.

// Will: if
type If struct {
	Cond Expr
	Then Block
	Else Block
}

var _ Stmt = (*If)(nil)

func (i *If) Node() string {
	return "If"
}

func (i *If) Stmt() string {
	return i.Node()
}

// Will: KillGhost제어신호 발생
type KillGhost struct {
}

var _ Stmt = (*KillGhost)(nil)

// Stop의 Do는 Stop 제어신호를 발생시킴
func (s *KillGhost) Node() string {
	return "Stop"
}

func (s *KillGhost) Stmt() string {
	return s.Node()
}
