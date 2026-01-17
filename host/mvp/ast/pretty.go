package ast

import (
	"fmt"
	"strings"
)

// Dump renders an AST node without position info for tests/REPL.
func Dump(n Node) string {
	var b strings.Builder
	d := dumper{b: &b}
	d.node(n, 0)
	return b.String()
}

type dumper struct {
	b *strings.Builder
}

func (d dumper) node(n Node, indent int) {
	if n == nil {
		d.line(indent, "nil")
		return
	}
	switch v := n.(type) {
	case *Program:
		d.line(indent, "Program")
		for _, decl := range v.Decls {
			d.node(decl, indent+1)
		}
	case *EventDecl:
		d.line(indent, "EventDecl %s", v.Name.Name)
		for _, f := range v.Fields {
			d.line(indent+1, "Field %s %s", f.Name.Name, d.typeName(f.Type))
		}
	case *GhostDecl:
		d.line(indent, "GhostDecl %s [%s->%s]", v.Name.Name, d.typeName(v.InType), d.typeName(v.OutType))
		d.params(v.Params, indent+1)
		d.node(&v.Body, indent+1)
	case *CompGhostDecl:
		d.line(indent, "CompGhostDecl %s", v.Name.Name)
		d.params(v.Params, indent+1)
		for _, call := range v.Pipe {
			d.node(&call, indent+1)
		}
	case *FuncDecl:
		if v.Recv != nil {
			d.line(indent, "FuncDecl (%s %s) %s", v.Recv.Name.Name, d.typeName(v.Recv.Type), v.Name.Name)
		} else {
			d.line(indent, "FuncDecl %s", v.Name.Name)
		}
		d.params(v.Params, indent+1)
		d.returns(v.Return, indent+1)
		d.node(&v.Body, indent+1)
	case *VarDecl:
		d.line(indent, "VarDecl")
		for _, name := range v.Names {
			d.line(indent+1, "Name %s", name.Name)
		}
		if v.Type != nil {
			d.line(indent+1, "Type %s", d.typeName(v.Type))
		}
		for _, val := range v.Values {
			d.node(val, indent+1)
		}
	case *TypeDecl:
		d.line(indent, "TypeDecl %s %s", v.Name.Name, d.typeName(v.Type))
	case *Block:
		d.line(indent, "Block")
		for _, st := range v.Stmts {
			d.node(st, indent+1)
		}
	case *IfStmt:
		d.line(indent, "IfStmt")
		d.node(v.Cond, indent+1)
		d.node(&v.Then, indent+1)
		if v.Else != nil {
			d.node(v.Else, indent+1)
		}
	case *ForStmt:
		d.line(indent, "ForStmt")
		d.node(v.Cond, indent+1)
		d.node(&v.Body, indent+1)
	case *RecvStmt:
		d.line(indent, "RecvStmt %s %s", v.Name.Name, d.typeName(v.EventType))
	case *EmitStmt:
		d.line(indent, "EmitStmt %s", d.typeName(v.EventType))
		d.node(v.Value, indent+1)
	case *AssignStmt:
		if v.Define {
			d.line(indent, "AssignStmt :=")
		} else {
			d.line(indent, "AssignStmt =")
		}
		for _, name := range v.Names {
			d.line(indent+1, "Name %s", name.Name)
		}
		for _, val := range v.Values {
			d.node(val, indent+1)
		}
	case *ReturnStmt:
		d.line(indent, "ReturnStmt")
		for _, val := range v.Values {
			d.node(val, indent+1)
		}
	case *BreakStmt:
		d.line(indent, "BreakStmt")
	case *ContinueStmt:
		d.line(indent, "ContinueStmt")
	case *ExprStmt:
		d.line(indent, "ExprStmt")
		d.node(v.Expr, indent+1)
	case *IdentExpr:
		d.line(indent, "Ident %s", v.Name)
	case *BasicLit:
		d.line(indent, "Literal %s", v.Value)
	case *UnaryExpr:
		d.line(indent, "Unary %s", d.unaryOp(v.Op))
		d.node(v.X, indent+1)
	case *BinaryExpr:
		d.line(indent, "Binary %s", d.binaryOp(v.Op))
		d.node(v.Left, indent+1)
		d.node(v.Right, indent+1)
	case *CallExpr:
		d.line(indent, "Call")
		d.node(v.Callee, indent+1)
		for _, arg := range v.Args {
			d.node(arg, indent+1)
		}
	case *SelectorExpr:
		d.line(indent, "Selector %s", v.Sel.Name)
		d.node(v.X, indent+1)
	case *IndexExpr:
		d.line(indent, "Index")
		d.node(v.X, indent+1)
		d.node(v.Index, indent+1)
	case *CompositeLit:
		d.line(indent, "Composite %s", d.typeName(v.Type))
		for _, el := range v.Elements {
			if el.Key != nil {
				d.line(indent+1, "Key")
				d.node(el.Key, indent+2)
				d.line(indent+1, "Value")
				d.node(el.Value, indent+2)
				continue
			}
			d.node(el.Value, indent+1)
		}
	case *FuncLit:
		d.line(indent, "FuncLit")
		d.params(v.Params, indent+1)
		d.returns(v.Return, indent+1)
		d.node(&v.Body, indent+1)
	case *GhostLit:
		d.line(indent, "GhostLit [%s->%s]", d.typeName(v.InType), d.typeName(v.OutType))
		d.params(v.Params, indent+1)
		d.node(&v.Body, indent+1)
	case *GhostCallExpr:
		d.line(indent, "GhostCall %s", v.Name.Name)
		for _, arg := range v.Args {
			d.node(arg, indent+1)
		}
	case *CompGhostExpr:
		d.line(indent, "CompGhostExpr")
		for _, call := range v.Pipe {
			d.node(&call, indent+1)
		}
	default:
		d.line(indent, "Unknown %T", v)
	}
}

func (d dumper) params(params []Param, indent int) {
	if len(params) == 0 {
		return
	}
	d.line(indent, "Params")
	for _, p := range params {
		d.line(indent+1, "%s %s", p.Name.Name, d.typeName(p.Type))
	}
}

func (d dumper) returns(types []TypeExpr, indent int) {
	if len(types) == 0 {
		return
	}
	d.line(indent, "Returns")
	for _, t := range types {
		d.line(indent+1, "%s", d.typeName(t))
	}
}

func (d dumper) typeName(t TypeExpr) string {
	switch v := t.(type) {
	case *NamedType:
		return v.Name.Name
	case *PointerType:
		return "*" + d.typeName(v.Base)
	case *SliceType:
		return "[]" + d.typeName(v.Elem)
	case *MapType:
		return "map[" + d.typeName(v.Key) + "]" + d.typeName(v.Value)
	case *StructType:
		var b strings.Builder
		b.WriteString("struct{")
		for i, f := range v.Fields {
			if i > 0 {
				b.WriteString(";")
			}
			b.WriteString(f.Name.Name)
			b.WriteString(" ")
			b.WriteString(d.typeName(f.Type))
		}
		b.WriteString("}")
		return b.String()
	default:
		return "<?>"
	}
}

func (d dumper) unaryOp(op UnaryOp) string {
	switch op {
	case UnaryNot:
		return "!"
	case UnaryPlus:
		return "+"
	default:
		return "-"
	}
}

func (d dumper) binaryOp(op BinaryOp) string {
	switch op {
	case BinaryOr:
		return "||"
	case BinaryAnd:
		return "&&"
	case BinaryEq:
		return "=="
	case BinaryNotEq:
		return "!="
	case BinaryLess:
		return "<"
	case BinaryLessEq:
		return "<="
	case BinaryGreater:
		return ">"
	case BinaryGreaterEq:
		return ">="
	case BinaryAdd:
		return "+"
	case BinarySub:
		return "-"
	case BinaryMul:
		return "*"
	case BinaryDiv:
		return "/"
	default:
		return "%"
	}
}

func (d dumper) line(indent int, format string, args ...interface{}) {
	for i := 0; i < indent; i++ {
		d.b.WriteString("  ")
	}
	if len(args) == 0 {
		d.b.WriteString(format)
	} else {
		d.b.WriteString(fmt.Sprintf(format, args...))
	}
	d.b.WriteString("\n")
}
