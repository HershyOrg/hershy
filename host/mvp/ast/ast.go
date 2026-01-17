package ast

// Pos is a 1-based source position.
type Pos struct {
	Line   int
	Column int
	Offset int
}

type Node interface {
	node()
	Position() Pos
}

type Program struct {
	Decls []Decl
}

func (p *Program) node() {}

func (p *Program) Position() Pos {
	if len(p.Decls) == 0 {
		return Pos{}
	}
	return p.Decls[0].Position()
}

type Decl interface {
	Node
	decl()
}

type Stmt interface {
	Node
	stmt()
}

type Expr interface {
	Node
	expr()
}

type TypeExpr interface {
	Node
	typ()
}

type Ident struct {
	Name string
	Pos  Pos
}

func (i *Ident) node() {}

func (i *Ident) Position() Pos { return i.Pos }

type EventDecl struct {
	Pos    Pos
	Name   Ident
	Fields []Field
}

func (d *EventDecl) node() {}
func (d *EventDecl) decl() {}
func (d *EventDecl) Position() Pos { return d.Pos }

type Field struct {
	Name Ident
	Type TypeExpr
}

type GhostDecl struct {
	Pos     Pos
	Name    Ident
	InType  TypeExpr
	OutType TypeExpr
	Params  []Param
	Body    Block
}

func (d *GhostDecl) node() {}
func (d *GhostDecl) decl() {}
func (d *GhostDecl) Position() Pos { return d.Pos }

type CompGhostDecl struct {
	Pos    Pos
	Name   Ident
	Params []Param
	Pipe   []GhostCallExpr
}

func (d *CompGhostDecl) node() {}
func (d *CompGhostDecl) decl() {}
func (d *CompGhostDecl) Position() Pos { return d.Pos }

type FuncDecl struct {
	Pos        Pos
	Recv       *Param
	Name       Ident
	Params     []Param
	Return     []TypeExpr
	Body       Block
}

func (d *FuncDecl) node() {}
func (d *FuncDecl) decl() {}
func (d *FuncDecl) Position() Pos { return d.Pos }

type VarDecl struct {
	Pos    Pos
	Names  []Ident
	Type   TypeExpr
	Values []Expr
}

func (d *VarDecl) node() {}
func (d *VarDecl) decl() {}
func (d *VarDecl) Position() Pos { return d.Pos }

type TypeDecl struct {
	Pos  Pos
	Name Ident
	Type TypeExpr
}

func (d *TypeDecl) node() {}
func (d *TypeDecl) decl() {}
func (d *TypeDecl) Position() Pos { return d.Pos }

type Param struct {
	Name Ident
	Type TypeExpr
}

type Block struct {
	Pos   Pos
	Stmts []Stmt
}

func (b *Block) node() {}
func (b *Block) stmt() {}
func (b *Block) Position() Pos { return b.Pos }

type IfStmt struct {
	Pos  Pos
	Cond Expr
	Then Block
	Else *Block
}

func (s *IfStmt) node() {}
func (s *IfStmt) stmt() {}
func (s *IfStmt) Position() Pos { return s.Pos }

type ForStmt struct {
	Pos  Pos
	Cond Expr
	Body Block
}

func (s *ForStmt) node() {}
func (s *ForStmt) stmt() {}
func (s *ForStmt) Position() Pos { return s.Pos }

type RecvStmt struct {
	Pos       Pos
	Name      Ident
	EventType TypeExpr
}

func (s *RecvStmt) node() {}
func (s *RecvStmt) stmt() {}
func (s *RecvStmt) Position() Pos { return s.Pos }

type EmitStmt struct {
	Pos       Pos
	Value     Expr
	EventType TypeExpr
}

func (s *EmitStmt) node() {}
func (s *EmitStmt) stmt() {}
func (s *EmitStmt) Position() Pos { return s.Pos }

type AssignStmt struct {
	Pos    Pos
	Names  []Ident
	Values []Expr
	Define bool
}

func (s *AssignStmt) node() {}
func (s *AssignStmt) stmt() {}
func (s *AssignStmt) Position() Pos { return s.Pos }

type ReturnStmt struct {
	Pos    Pos
	Values []Expr
}

func (s *ReturnStmt) node() {}
func (s *ReturnStmt) stmt() {}
func (s *ReturnStmt) Position() Pos { return s.Pos }

type BreakStmt struct {
	Pos Pos
}

func (s *BreakStmt) node() {}
func (s *BreakStmt) stmt() {}
func (s *BreakStmt) Position() Pos { return s.Pos }

type ContinueStmt struct {
	Pos Pos
}

func (s *ContinueStmt) node() {}
func (s *ContinueStmt) stmt() {}
func (s *ContinueStmt) Position() Pos { return s.Pos }

type ExprStmt struct {
	Pos  Pos
	Expr Expr
}

func (s *ExprStmt) node() {}
func (s *ExprStmt) stmt() {}
func (s *ExprStmt) Position() Pos { return s.Pos }

type IdentExpr struct {
	Pos  Pos
	Name string
}

func (e *IdentExpr) node() {}
func (e *IdentExpr) expr() {}
func (e *IdentExpr) Position() Pos { return e.Pos }

type BasicKind int

const (
	BasicInt BasicKind = iota
	BasicFloat
	BasicString
	BasicBool
	BasicNone
	BasicNil
)

type BasicLit struct {
	Pos   Pos
	Kind  BasicKind
	Value string
}

func (e *BasicLit) node() {}
func (e *BasicLit) expr() {}
func (e *BasicLit) Position() Pos { return e.Pos }

type UnaryOp int

const (
	UnaryNot UnaryOp = iota
	UnaryPlus
	UnaryMinus
)

type UnaryExpr struct {
	Pos Pos
	Op  UnaryOp
	X   Expr
}

func (e *UnaryExpr) node() {}
func (e *UnaryExpr) expr() {}
func (e *UnaryExpr) Position() Pos { return e.Pos }

type BinaryOp int

const (
	BinaryOr BinaryOp = iota
	BinaryAnd
	BinaryEq
	BinaryNotEq
	BinaryLess
	BinaryLessEq
	BinaryGreater
	BinaryGreaterEq
	BinaryAdd
	BinarySub
	BinaryMul
	BinaryDiv
	BinaryMod
)

type BinaryExpr struct {
	Pos   Pos
	Op    BinaryOp
	Left  Expr
	Right Expr
}

func (e *BinaryExpr) node() {}
func (e *BinaryExpr) expr() {}
func (e *BinaryExpr) Position() Pos { return e.Pos }

type CallExpr struct {
	Pos    Pos
	Callee Expr
	Args   []Expr
}

func (e *CallExpr) node() {}
func (e *CallExpr) expr() {}
func (e *CallExpr) Position() Pos { return e.Pos }

type SelectorExpr struct {
	Pos Pos
	X   Expr
	Sel Ident
}

func (e *SelectorExpr) node() {}
func (e *SelectorExpr) expr() {}
func (e *SelectorExpr) Position() Pos { return e.Pos }

type IndexExpr struct {
	Pos   Pos
	X     Expr
	Index Expr
}

func (e *IndexExpr) node() {}
func (e *IndexExpr) expr() {}
func (e *IndexExpr) Position() Pos { return e.Pos }

type CompositeLit struct {
	Pos      Pos
	Type     TypeExpr
	Elements []Element
}

func (e *CompositeLit) node() {}
func (e *CompositeLit) expr() {}
func (e *CompositeLit) Position() Pos { return e.Pos }

type Element struct {
	Key   Expr
	Value Expr
}

type FuncLit struct {
	Pos        Pos
	Params     []Param
	Return     []TypeExpr
	Body       Block
}

func (e *FuncLit) node() {}
func (e *FuncLit) expr() {}
func (e *FuncLit) Position() Pos { return e.Pos }

type GhostLit struct {
	Pos     Pos
	InType  TypeExpr
	OutType TypeExpr
	Params  []Param
	Body    Block
}

func (e *GhostLit) node() {}
func (e *GhostLit) expr() {}
func (e *GhostLit) Position() Pos { return e.Pos }

type GhostCallExpr struct {
	Pos  Pos
	Name Ident
	Args []Expr
}

func (e *GhostCallExpr) node() {}
func (e *GhostCallExpr) expr() {}
func (e *GhostCallExpr) Position() Pos { return e.Pos }

type CompGhostExpr struct {
	Pos  Pos
	Pipe []GhostCallExpr
}

func (e *CompGhostExpr) node() {}
func (e *CompGhostExpr) expr() {}
func (e *CompGhostExpr) Position() Pos { return e.Pos }

type NamedType struct {
	Pos  Pos
	Name Ident
}

func (t *NamedType) node() {}
func (t *NamedType) typ() {}
func (t *NamedType) Position() Pos { return t.Pos }

type PointerType struct {
	Pos  Pos
	Base TypeExpr
}

func (t *PointerType) node() {}
func (t *PointerType) typ() {}
func (t *PointerType) Position() Pos { return t.Pos }

type SliceType struct {
	Pos  Pos
	Elem TypeExpr
}

func (t *SliceType) node() {}
func (t *SliceType) typ() {}
func (t *SliceType) Position() Pos { return t.Pos }

type MapType struct {
	Pos   Pos
	Key   TypeExpr
	Value TypeExpr
}

func (t *MapType) node() {}
func (t *MapType) typ() {}
func (t *MapType) Position() Pos { return t.Pos }

type StructType struct {
	Pos    Pos
	Fields []Field
}

func (t *StructType) node() {}
func (t *StructType) typ() {}
func (t *StructType) Position() Pos { return t.Pos }
