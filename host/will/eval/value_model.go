package eval

import (
	"strconv"
)

// Value는 Will이 지니는 객체 모델의 표현임
type Value interface {
	Inspect() string
	Type() EvaledValueType
}

// * 추후 파서와 Eval이 분리될 걸 감안해서 비정규화 해 두었음
// * ParsedValueType, EvaledValueType동시 존재 중임
type EvaledValueType int

const (
	IntValType EvaledValueType = iota
	FloatValType
	BoolValType
	StringValType
	ErrValType
	BuiltInFuncValType
)

type IntVal struct {
	Value int
}

var _ Value = (*IntVal)(nil)

func (i *IntVal) Inspect() string {
	return strconv.Itoa(i.Value)
}
func (i *IntVal) Type() EvaledValueType {
	return IntValType
}

type FloatVal struct {
	Value float64
}

func (f *FloatVal) Inspect() string {
	return strconv.FormatFloat(f.Value, 'f', 4, 64)
}

func (f *FloatVal) Type() EvaledValueType {
	return FloatValType
}

var _ Value = (*FloatVal)(nil)

type BoolVal struct {
	Value bool
}

var _ Value = (*BoolVal)(nil)

func (bv *BoolVal) Inspect() string {
	if bv.Value {
		return "true"
	}
	return "false"
}
func (bv *BoolVal) Type() EvaledValueType {
	return BoolValType
}

type StringVal struct {
	Value string
}

var _ Value = (*StringVal)(nil)

func (s *StringVal) Inspect() string {
	return s.Value
}
func (s *StringVal) Type() EvaledValueType {
	return StringValType
}

type ErrorVal struct {
	isOk    bool
	message string
}

func (e *ErrorVal) Inspect() string {
	if e.isOk {
		return "ok"
	}
	return e.message
}
func (e *ErrorVal) Type() EvaledValueType {
	return ErrValType
}
