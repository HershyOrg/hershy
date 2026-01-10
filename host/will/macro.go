package will

import (
	"context"
	"fmt"
)

// Will
type If struct {
	Cond Expr
	Then Will
	Else Will
}

var _ Will = (*If)(nil)

func (i *If) Do(body Body, sandbox Env, ctx context.Context) (*CtrlInfo, error) {
	vals, ctrlInfoOrNil, err := i.Cond.Valuate(body, sandbox, ctx)
	if ctrlInfoOrNil != nil || err != nil {
		return ctrlInfoOrNil, err
	}
	if len(vals) != 1 {
		return nil, fmt.Errorf("If will의 Cond필드의 평가 값은 단일해야 합니다.")
	}
	cond := vals[0]
	if cond.Type() != BoolType {
		return nil, fmt.Errorf("If will의 Cond의 Type은 Bool이여야 합니다.")
	}
	condVal, _ := cond.(*BoolVal)
	if condVal.Value {
		return i.Then.Do(body, sandbox, ctx)
	} else {
		return i.Else.Do(body, sandbox, ctx)
	}
}
