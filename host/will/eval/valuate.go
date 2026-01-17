package eval

import (
	"context"
	"fmt"
	"host/will/parser"
)

// Valuate는 expr을 평가하고 Value 목록, 제어 신호, 오류를 반환한다.
func Valuate(expr parser.Expr, body Body, sandbox Env, ctx context.Context) ([]Value, *CtrlInfo, error) {
	switch e := expr.(type) {
	case *parser.Binary:
		leftValues, ctrlInfoOrNil, err := Valuate(e.Left, body, sandbox, ctx)
		if ctrlInfoOrNil != nil || err != nil {
			return nil, ctrlInfoOrNil, err
		}
		if len(leftValues) != 1 {
			return nil, nil, fmt.Errorf("leftValues는 단일 값이어야 함")
		}
		panic("이 이후는 미구현")
		//*rightValue도 valuate후 타입 대수에 따라 op적용
	case *parser.Unary:
		panic("미구현")
	case *parser.Id:
		builtInFunc, ok := body.BuiltInFuncEnv[e.VarName]
		if ok {
			return []Value{&builtInFunc}, nil, nil
		}
		idVal, ok := body.Memory[e.VarName]
		if ok {
			return []Value{idVal}, nil, nil
		}
		idVal, ok = sandbox[e.VarName]
		if ok {
			return []Value{idVal}, nil, nil
		}
		return nil, nil, fmt.Errorf("Valuate Id: 3가지 환경에서 전부 발션 실패")
	case *parser.LiteralValueForm:
		switch e.Type {
		case parser.IntType:
			return []Value{&IntVal{Value: *e.IntOrNil}}, nil, nil
		case parser.FloatType:
			return []Value{&FloatVal{Value: *e.FloatOrNil}}, nil, nil
		case parser.BoolType:
			return []Value{&BoolVal{Value: *e.BoolOrNil}}, nil, nil
		case parser.StringType:
			return []Value{&StringVal{Value: *e.StringOrNil}}, nil, nil
		case parser.ErrType:
			isOk := true
			message := ""
			if e.StringOrNil != nil {
				isOk = false
				message = *e.StringOrNil
			}
			return []Value{&ErrorVal{isOk: isOk, message: message}}, nil, nil
		default:
			return nil, nil, fmt.Errorf("Base Valuate 케이스 미스매치")
		}
	case *parser.Call:
		valuatedCallee, ctrlInfoOrNil, err := Valuate(&e.Callee, body, sandbox, ctx)
		if len(valuatedCallee) != 1 {
			return nil, nil, fmt.Errorf("Valuate Call: Callee는 반드시 하나의 값이여야 함")
		}
		vCallee := valuatedCallee[0]
		if ctrlInfoOrNil != nil || err != nil {
			return nil, ctrlInfoOrNil, err
		}
		args := make([]Value, 0, len(e.ArgList))
		for _, arg := range e.ArgList {
			valuatedArg, ctrlInfoOrNil, err := Valuate(arg, body, sandbox, ctx)
			if ctrlInfoOrNil != nil || err != nil {
				return nil, ctrlInfoOrNil, err
			}
			if len(valuatedArg) != 1 {
				//하나의 인자가 평가 결과 여려 개의 Value로 분해되어 할당되면 안됨
				//ex: builtWatch(x())에서, x()의 결과가 100,error여서 buildWatch(100,err)로 들어가는, 인자 개수 변경 사태는 일어나선 안됨.
				return nil, nil, fmt.Errorf("Valuate Call: 함수 호출 시 다중 인자 할당은 가능하지만, 구조 분해 할당은 불가합니다.")
			}
			args = append(args, valuatedArg...)
		}
		builtInFunc, ok := vCallee.(*BuilInFuncVal)
		if !ok {
			//현재는 빌트인 제외의 함수는 호출이 불가함
			return nil, nil, fmt.Errorf("Valuate Call: 현재 빌트인 함수만 호출이 가능합니다.")
		}
		results, ctrlInfoOrNil, err := builtInFunc.Impl(args, body, sandbox, ctx)
		if ctrlInfoOrNil != nil || err != nil {
			if ctrlInfoOrNil.Kind == ReturnKind {
				return results, nil, nil
			}
			return nil, ctrlInfoOrNil, err
		}
		return results, nil, nil
	default:
		return nil, nil, fmt.Errorf("Valuate: unknown expr %s", expr.Node())
	}
}
