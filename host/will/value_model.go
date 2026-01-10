package will

import "strconv"

// Value는 Will이 지니는 객체 모델의 표현임
type Value interface {
	Inspect() string
	Type() BaseType
}

type IntVal struct {
	Value int
}

var _ Value = (*IntVal)(nil)

func (i *IntVal) Inspect() string {
	return strconv.Itoa(i.Value)
}
func (i *IntVal) Type() BaseType {
	return IntType
}

type FloatVal struct {
	Value float64
}

func (f *FloatVal) Inspect() string {
	return strconv.FormatFloat(f.Value, 'f', 2, 64)
}

func (f *FloatVal) Type() BaseType {
	return FloatType
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
func (bv *BoolVal) Type() BaseType {
	return BoolType
}

type StringVal struct {
	Value string
}

var _ Value = (*StringVal)(nil)

func (s *StringVal) Inspect() string {
	return s.Value
}
func (s *StringVal) Type() BaseType {
	return StringType
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
func (e *ErrorVal) Type() BaseType {
	return ErrType
}
