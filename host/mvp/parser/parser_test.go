package parser

import (
	"testing"

	"host/mvp/ast"
)

func TestParseProgramBasic(t *testing.T) {
	src := `
event E struct { A int }
type T int
var x int = 1
func main(body Body) { x = 2 }
func (r T) f(x int) int { return x }
ghost [E->E] G(a int) { ev <- E }
ghost H(a int) = G(a)->G(a)
`
	prog, err := ParseProgram(src)
	if err != nil {
		t.Fatalf("ParseProgram error: %v", err)
	}
	got := ast.Dump(prog)
	want := `Program
  EventDecl E
    Field A int
  TypeDecl T int
  VarDecl
    Name x
    Type int
    Literal 1
  FuncDecl main
    Params
      body Body
    Block
      AssignStmt =
        Name x
        Literal 2
  FuncDecl (r T) f
    Params
      x int
    Returns
      int
    Block
      ReturnStmt
        Ident x
  GhostDecl G [E->E]
    Params
      a int
    Block
      RecvStmt ev E
  CompGhostDecl H
    Params
      a int
    GhostCall G
      Ident a
    GhostCall G
      Ident a
`
	if got != want {
		t.Fatalf("unexpected AST:\n%s", got)
	}
}

func TestParseSnippets(t *testing.T) {
	cases := []string{
		`x <- E`,
		`E{a: 1}.b`,
		`arr[0]`,
		`g1(a)->g2(b).Mount(Once)`,
		`func(a int) int { return a }`,
		`func (r T) f(x int) int { return r }`,
		`ghost[E->E](a int) { ev <- E }`,
		`a, b := f(x), g(y)`,
		`return a, b`,
		`obj.method(1, 2)`,
		`list[1].field`,
		`map[int]string{1: "x"}[1]`,
		`[]int{1, 2, 3}[0]`,
		`S{a: 1, b: 2}.f()`,
		`g1(c.a)->g2(c.b)`,
	}
	for _, src := range cases {
		if _, err := ParseSnippet(src); err != nil {
			t.Fatalf("ParseSnippet error for %q: %v", src, err)
		}
	}
}

func TestParseDeclsMore(t *testing.T) {
	src := `
type Pair struct { A int }
var a, b int = 1, 2
func add(a int, b int) (int, int) { return a + b, a - b }
ghost [None->None] G() { x <- None }
`
	prog, err := ParseProgram(src)
	if err != nil {
		t.Fatalf("ParseProgram error: %v", err)
	}
	got := ast.Dump(prog)
	want := `Program
  TypeDecl Pair struct{A int}
  VarDecl
    Name a
    Name b
    Type int
    Literal 1
    Literal 2
  FuncDecl add
    Params
      a int
      b int
    Returns
      int
      int
    Block
      ReturnStmt
        Binary +
          Ident a
          Ident b
        Binary -
          Ident a
          Ident b
  GhostDecl G [None->None]
    Block
      RecvStmt x None
`
	if got != want {
		t.Fatalf("unexpected AST:\n%s", got)
	}
}
