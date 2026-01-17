package eval

import (
	"context"
	"fmt"
	"host/will/parser"
)

type BuilInFuncVal struct {
	VarName parser.VarName
	Impl    func(args []Value, body Body, sandbox Env, ctx context.Context) ([]Value, *CtrlInfo, error)
}

func (b *BuilInFuncVal) Inspect() string {
	return fmt.Sprintf("BuiltInFunc<%s>", string(b.VarName))
}
func (b *BuilInFuncVal) Type() EvaledValueType {
	return BuiltInFuncValType
}

var builtInRegistry = map[parser.VarName]BuilInFuncVal{
	"buildWatch": {
		VarName: parser.VarName("buildWatch"),
		Impl: func(args []Value, body Body, sandbox Env, ctx context.Context) ([]Value, *CtrlInfo, error) {
			//* "값"을 받아서 곧바로 처리
			panic("not implemented")
		},
	},
}
