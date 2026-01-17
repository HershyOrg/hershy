package lexer

// Pos is a 1-based source position.
type Pos struct {
	Line   int
	Column int
	Offset int
}

type TokenKind int

const (
	TokenEOF TokenKind = iota
	TokenIdent
	TokenInt
	TokenFloat
	TokenString
	TokenBool
	TokenNone
	TokenNil

	// Keywords
	TokenEvent
	TokenGhost
	TokenFunc
	TokenVar
	TokenType
	TokenReturn
	TokenIf
	TokenElse
	TokenFor
	TokenBreak
	TokenContinue
	TokenMap
	TokenStruct

	// Operators and punctuators
	TokenAssign    // =
	TokenDefine    // :=
	TokenEq        // ==
	TokenNotEq     // !=
	TokenLess      // <
	TokenLessEq    // <=
	TokenGreater   // >
	TokenGreaterEq // >=
	TokenAnd       // &&
	TokenOr        // ||
	TokenNot       // !
	TokenPlus      // +
	TokenMinus     // -
	TokenStar      // *
	TokenSlash     // /
	TokenPercent   // %
	TokenArrowL    // <-
	TokenArrowR    // ->

	TokenComma
	TokenDot
	TokenColon
	TokenSemicolon
	TokenLParen
	TokenRParen
	TokenLBrace
	TokenRBrace
	TokenLBracket
	TokenRBracket
)

type Token struct {
	Kind   TokenKind
	Lexeme string
	Pos    Pos
}

func (k TokenKind) String() string {
	switch k {
	case TokenEOF:
		return "EOF"
	case TokenIdent:
		return "Ident"
	case TokenInt:
		return "Int"
	case TokenFloat:
		return "Float"
	case TokenString:
		return "String"
	case TokenBool:
		return "Bool"
	case TokenNone:
		return "None"
	case TokenNil:
		return "Nil"
	case TokenEvent:
		return "event"
	case TokenGhost:
		return "ghost"
	case TokenFunc:
		return "func"
	case TokenVar:
		return "var"
	case TokenType:
		return "type"
	case TokenReturn:
		return "return"
	case TokenIf:
		return "if"
	case TokenElse:
		return "else"
	case TokenFor:
		return "for"
	case TokenBreak:
		return "break"
	case TokenContinue:
		return "continue"
	case TokenMap:
		return "map"
	case TokenStruct:
		return "struct"
	case TokenAssign:
		return "="
	case TokenDefine:
		return ":="
	case TokenEq:
		return "=="
	case TokenNotEq:
		return "!="
	case TokenLess:
		return "<"
	case TokenLessEq:
		return "<="
	case TokenGreater:
		return ">"
	case TokenGreaterEq:
		return ">="
	case TokenAnd:
		return "&&"
	case TokenOr:
		return "||"
	case TokenNot:
		return "!"
	case TokenPlus:
		return "+"
	case TokenMinus:
		return "-"
	case TokenStar:
		return "*"
	case TokenSlash:
		return "/"
	case TokenPercent:
		return "%"
	case TokenArrowL:
		return "<-"
	case TokenArrowR:
		return "->"
	case TokenComma:
		return ","
	case TokenDot:
		return "."
	case TokenColon:
		return ":"
	case TokenSemicolon:
		return ";"
	case TokenLParen:
		return "("
	case TokenRParen:
		return ")"
	case TokenLBrace:
		return "{"
	case TokenRBrace:
		return "}"
	case TokenLBracket:
		return "["
	case TokenRBracket:
		return "]"
	default:
		return "Unknown"
	}
}
