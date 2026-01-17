package parser

// Expr은 Will이 지니는 표현식의 인터페이스임.
type Expr interface {
	WillNode
	Expr() string
}

type Binary struct {
	OpKind OpKind
	Left   Expr
	Right  Expr
}

var _ Expr = (*Binary)(nil)

func (b *Binary) Node() string {
	return "Binary"
}

func (b *Binary) Expr() string {
	return b.Node()
}

type Unary struct {
	OpKind OpKind
	Left   Expr
}

var _ Expr = (*Unary)(nil)

func (u *Unary) Node() string {
	return "Unary"
}

func (u *Unary) Expr() string {
	return u.Node()
}

type Id struct {
	VarName VarName
}

var _ Expr = (*Id)(nil)

// VarName는 "변수"에 대한 식별자임
// 원래는 리졸브 테이블에서 고유한 id로 관리해야 하지만
// *현재는 그냥 변수명을 그대로 varId에 적용함. (충돌, 스코핑, 중복에 대한 처리 전혀 없음)
type VarName string

// Valuate는 Body와 sandbox를 환경으로 삼아 Id를 평가함
// *현재 Id평가는 스코핑,리졸빙, 종복 핸들링 등이 적용되지 않음.
// * Id는 body.BuiltInv->body.Memory->sandbox순으로 탐색함
func (i *Id) Node() string {
	return "Id"
}

func (i *Id) Expr() string {
	return i.Node()
}

// Expr: LiteralValueForm은 Fexp지원하지 않음
// * 현재 함수 표현식은 값으로써 작동하지 못함. 함수 선언 역시 불가함
type LiteralValueForm struct {
	//추후 언어 설계에선 절대 이렇게 하면 안됨...
	//파서 부분이 평가기의 ValueType을 지니는 구조라니,
	//추후엔 반드시 수정 필요.
	Type        ParsedValueType
	IntOrNil    *int
	FloatOrNil  *float64
	StringOrNil *string
	BoolOrNil   *bool
}
type ParsedValueType int

const (
	IntType ParsedValueType = iota
	FloatType
	BoolType
	StringType
	ErrType
	BuiltInFuncType
)

// * Call현재 함수 호출은 빌트인 함수에 대해서만 가능 (함수 선언 기능 없음)
type Call struct {
	Callee  Id
	ArgList []Expr
}

func (b *LiteralValueForm) Node() string {
	return "LiteralValueForm"
}

func (b *LiteralValueForm) Expr() string {
	return b.Node()
}

func (c *Call) Node() string {
	return "Call"
}

func (c *Call) Expr() string {
	return c.Node()
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
