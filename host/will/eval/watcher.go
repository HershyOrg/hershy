package eval

import (
	"context"
	"host/will/parser"
)

// Watcher는 자원 감시에 대한 설계도임.
// Watcher 하나당 자원 하나를 모니터링함.
type Watcher struct {
	//resourceName은 현실 세계에서의 식별자임.
	//ex: Bitcoin Price
	resourceName string
	//varId는 Ghost프로그램 내부에서의 식별자임
	//ex: varName:BitPrice, Value: int(100)
	varId parser.VarName
	//Watch는 해당 자원을 감시하는 함수임
	Watch func(ctx context.Context) <-chan ResourceInfo

	//body, sandbox Watch가 참조할 환경임
	body    Body
	sandbox Env
}

type ResourceInfo interface {
	ResourceName() string
	VarId() parser.VarName
	Value() Value
	Error() error
}
