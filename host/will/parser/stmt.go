package parser

type Block struct {
	Stmts []Stmt
}

var _ Stmt = (*Block)(nil)

func (b *Block) Node() string {
	return "Block"
}

func (b *Block) Stmt() string {
	return b.Node()
}
