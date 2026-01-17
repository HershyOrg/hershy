package eval

import (
	"context"
	"fmt"
	"host/will/parser"
)

// Do는 stmt를 평가하고 CtrlInfo 또는 오류를 반환한다.
func Do(stmt parser.Stmt, body Body, sandbox Env, ctx context.Context) (*CtrlInfo, error) {
	switch s := stmt.(type) {
	case *parser.Block:
		for _, inner := range s.Stmts {
			ctrlOrNil, err := Do(inner, body, sandbox, ctx)
			if ctrlOrNil != nil || err != nil {
				return ctrlOrNil, err
			}
		}
		return nil, nil
	case *parser.If:
		vals, ctrlInfoOrNil, err := Valuate(s.Cond, body, sandbox, ctx)
		if ctrlInfoOrNil != nil || err != nil {
			return ctrlInfoOrNil, err
		}
		if len(vals) != 1 {
			return nil, fmt.Errorf("If will의 Cond필드의 평가 값은 단일해야 합니다.")
		}
		cond := vals[0]
		if cond.Type() != BoolValType {
			return nil, fmt.Errorf("If will의 Cond의 Type은 Bool이여야 합니다.")
		}
		condVal, _ := cond.(*BoolVal)
		if condVal.Value {
			return Do(&s.Then, body, sandbox, ctx)
		}
		return Do(&s.Else, body, sandbox, ctx)
	case *parser.KillGhost:
		return &CtrlInfo{
			Kind: KillKind,
		}, nil
	case *parser.Init:
		// * Init의 Do에서 최종적으로 Return제어신호 핸들링해야 함.
		// * Ctrl 핸들링
		// * Panic과 Stop=> Ctrl전파
		// * Return=>핸들링 후 nil
		// * Break, Contunue => Ctrl은 Nil, 대신 에러 리턴.(break, continue는 전파 불가. 캐치되어야 함)
		panic("not implemented")
	default:
		return nil, fmt.Errorf("Do: unknown stmt %s", stmt.Node())
	}
}
