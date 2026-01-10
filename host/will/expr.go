package will

import (
	"context"
	"fmt"
)

// Expr은 Will이 지니는 표현식의 인터페이스임.
type Expr interface {
	// valuate는 Do과정에서 일어난 연산을 표현
	Valuate(body Body, sandbox Env, ctx context.Context) ([]Value, *CtrlInfo, error)
}

type Binary struct {
	opKind OpKind
	left   Expr
	right  Expr
}

var _ Expr = (*Binary)(nil)

func (b *Binary) Valuate(body Body, sandbox Env, ctx context.Context) ([]Value, *CtrlInfo, error) {
	leftValues, ctrlInfoOrNil, err := b.left.Valuate(body, sandbox, ctx)
	if ctrlInfoOrNil != nil || err != nil {
		return nil, ctrlInfoOrNil, err
	}
	if len(leftValues) != 1 {
		return nil, nil, fmt.Errorf("leftValues는 단일 값이어야 함")
	}
	panic("이 이후는 미구현")
	//rightValue도 valuate후 타입 대수에 따라 op적용
}

type Unary struct {
	opKind OpKind
	left   Expr
}

var _ Expr = (*Unary)(nil)

func (u *Unary) Valuate(body Body, sandbox Env, ctx context.Context) ([]Value, *CtrlInfo, error) {
	panic("미구현")
}

type Id struct {
	//변수의 저장 환경은 총 세 곳임
	// 1. 환경변수: body.Config
	// 2. escaped변수: body.Memory
	// 3. loacl변수: ghost.sandbox
	IsInConfig bool
	IsInMemory bool
	VarId      VarName
}

var _ Expr = (*Id)(nil)

// VarName는 "변수"에 대한 식별자임
// 원래는 리졸브 테이블에서 고유한 id로 관리해야 하지만
// 현재는 그냥 변수명을 그대로 varId에 적용함. (충돌, 스코핑, 중복에 대한 처리 전혀 없음)
type VarName string

// Valuate는 Body와 sandbox를 환경으로 삼아 Id를 평가함
// 현재 Id평가는 스코핑,리졸빙, 종복 핸들링 등이 적용되지 않음.
func (i *Id) Valuate(body Body, sandbox Env, ctx context.Context) ([]Value, *CtrlInfo, error) {
	if i.IsInConfig {
		str, ok := body.Config[string(i.VarId)]
		if !ok {
			return nil, nil, fmt.Errorf("Id가 Body의 Config에서 초기화되지 않음")
		}
		stringVal := StringVal{
			Value: str,
		}
		return []Value{&stringVal}, nil, nil
	}
	if i.IsInMemory {
		idVal, ok := body.Memory[i.VarId]
		if !ok {
			return nil, nil, fmt.Errorf("Id가 Body의 메모리에서 초기화되지 않음")
		}
		return []Value{idVal}, nil, nil
	}
	idVal, ok := sandbox[i.VarId]
	if !ok {
		return nil, nil, fmt.Errorf("Id가 sandbox에서 초기화되지 않음")
	}
	return []Value{idVal}, nil, nil
}

type Base struct {
	//추후 언어 설계에선 절대 이렇게 하면 안됨...
	//파서 부분이 평가기의 ValueType을 지니는 구조라니,
	//추후엔 반드시 수정 필요.
	Type        BaseType
	intOrNil    *int
	floatOrNil  *float64
	stringOrNil *string
	boolOrNil   *bool
}
type BaseType int

const (
	IntType BaseType = iota
	FloatType
	BoolType
	StringType
	ErrType
)

func (b *Base) Valuate(body Body, sandbox Env, ctx context.Context) ([]Value, *CtrlInfo, error) {
	switch b.Type {
	case IntType:
		return []Value{&IntVal{Value: *b.intOrNil}}, nil, nil
	case FloatType:
		return []Value{&FloatVal{Value: *b.floatOrNil}}, nil, nil
	case BoolType:
		return []Value{&BoolVal{Value: *b.boolOrNil}}, nil, nil
	case StringType:
		return []Value{&StringVal{Value: *b.stringOrNil}}, nil, nil
	case ErrType:
		isOk := true
		message := ""
		if b.stringOrNil != nil {
			isOk = false
			message = *b.stringOrNil
		}
		return []Value{&ErrorVal{isOk: isOk, message: message}}, nil, nil
	default:
		return nil, nil, fmt.Errorf("Base Valuate 케이스 미스매치")
	}
}

type OpKind int

const (
	//비교연산
	Equal OpKind = iota
	NotEq
	Greater //초과
	GTE     //이상(Greater than or Equal)
	Less    //미만
	LTE
	//사칙연산
	Plus
	Minus
	Div
	Mul
	//논리연산
	And
	Or
	Not
)
