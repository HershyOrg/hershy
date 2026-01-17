package lexer

import (
	"fmt"
	"unicode"
)

type Lexer struct {
	input  []rune
	offset int
	line   int
	column int
}

func New(input string) *Lexer {
	return &Lexer{
		input:  []rune(input),
		offset: 0,
		line:   1,
		column: 1,
	}
}

func (l *Lexer) Lex() ([]Token, error) {
	var tokens []Token
	for {
		tok, err := l.nextToken()
		if err != nil {
			return nil, err
		}
		tokens = append(tokens, tok)
		if tok.Kind == TokenEOF {
			return tokens, nil
		}
	}
}

func (l *Lexer) nextToken() (Token, error) {
	l.skipWhitespaceAndComments()
	start := l.pos()
	if l.eof() {
		return Token{Kind: TokenEOF, Pos: start}, nil
	}

	ch := l.peek()
	switch ch {
	case '"':
		return l.scanString()
	case '+':
		l.advance()
		return Token{Kind: TokenPlus, Lexeme: "+", Pos: start}, nil
	case '-':
		if l.peekNext() == '>' {
			l.advance()
			l.advance()
			return Token{Kind: TokenArrowR, Lexeme: "->", Pos: start}, nil
		}
		l.advance()
		return Token{Kind: TokenMinus, Lexeme: "-", Pos: start}, nil
	case '*':
		l.advance()
		return Token{Kind: TokenStar, Lexeme: "*", Pos: start}, nil
	case '/':
		l.advance()
		return Token{Kind: TokenSlash, Lexeme: "/", Pos: start}, nil
	case '%':
		l.advance()
		return Token{Kind: TokenPercent, Lexeme: "%", Pos: start}, nil
	case '=':
		if l.peekNext() == '=' {
			l.advance()
			l.advance()
			return Token{Kind: TokenEq, Lexeme: "==", Pos: start}, nil
		}
		l.advance()
		return Token{Kind: TokenAssign, Lexeme: "=", Pos: start}, nil
	case '!':
		if l.peekNext() == '=' {
			l.advance()
			l.advance()
			return Token{Kind: TokenNotEq, Lexeme: "!=", Pos: start}, nil
		}
		l.advance()
		return Token{Kind: TokenNot, Lexeme: "!", Pos: start}, nil
	case '<':
		if l.peekNext() == '=' {
			l.advance()
			l.advance()
			return Token{Kind: TokenLessEq, Lexeme: "<=", Pos: start}, nil
		}
		if l.peekNext() == '-' {
			l.advance()
			l.advance()
			return Token{Kind: TokenArrowL, Lexeme: "<-", Pos: start}, nil
		}
		l.advance()
		return Token{Kind: TokenLess, Lexeme: "<", Pos: start}, nil
	case '>':
		if l.peekNext() == '=' {
			l.advance()
			l.advance()
			return Token{Kind: TokenGreaterEq, Lexeme: ">=", Pos: start}, nil
		}
		l.advance()
		return Token{Kind: TokenGreater, Lexeme: ">", Pos: start}, nil
	case '&':
		if l.peekNext() == '&' {
			l.advance()
			l.advance()
			return Token{Kind: TokenAnd, Lexeme: "&&", Pos: start}, nil
		}
	case '|':
		if l.peekNext() == '|' {
			l.advance()
			l.advance()
			return Token{Kind: TokenOr, Lexeme: "||", Pos: start}, nil
		}
	case ':':
		if l.peekNext() == '=' {
			l.advance()
			l.advance()
			return Token{Kind: TokenDefine, Lexeme: ":=", Pos: start}, nil
		}
		l.advance()
		return Token{Kind: TokenColon, Lexeme: ":", Pos: start}, nil
	case ',':
		l.advance()
		return Token{Kind: TokenComma, Lexeme: ",", Pos: start}, nil
	case '.':
		l.advance()
		return Token{Kind: TokenDot, Lexeme: ".", Pos: start}, nil
	case ';':
		l.advance()
		return Token{Kind: TokenSemicolon, Lexeme: ";", Pos: start}, nil
	case '(':
		l.advance()
		return Token{Kind: TokenLParen, Lexeme: "(", Pos: start}, nil
	case ')':
		l.advance()
		return Token{Kind: TokenRParen, Lexeme: ")", Pos: start}, nil
	case '{':
		l.advance()
		return Token{Kind: TokenLBrace, Lexeme: "{", Pos: start}, nil
	case '}':
		l.advance()
		return Token{Kind: TokenRBrace, Lexeme: "}", Pos: start}, nil
	case '[':
		l.advance()
		return Token{Kind: TokenLBracket, Lexeme: "[", Pos: start}, nil
	case ']':
		l.advance()
		return Token{Kind: TokenRBracket, Lexeme: "]", Pos: start}, nil
	}

	if unicode.IsDigit(ch) {
		return l.scanNumber()
	}
	if isIdentStart(ch) {
		return l.scanIdent()
	}
	return Token{}, fmt.Errorf("unexpected character %q at %d:%d", ch, start.Line, start.Column)
}

func (l *Lexer) scanIdent() (Token, error) {
	start := l.pos()
	begin := l.offset
	l.advance()
	for !l.eof() && isIdentPart(l.peek()) {
		l.advance()
	}
	lex := string(l.input[begin:l.offset])
	switch lex {
	case "event":
		return Token{Kind: TokenEvent, Lexeme: lex, Pos: start}, nil
	case "ghost":
		return Token{Kind: TokenGhost, Lexeme: lex, Pos: start}, nil
	case "func":
		return Token{Kind: TokenFunc, Lexeme: lex, Pos: start}, nil
	case "var":
		return Token{Kind: TokenVar, Lexeme: lex, Pos: start}, nil
	case "type":
		return Token{Kind: TokenType, Lexeme: lex, Pos: start}, nil
	case "return":
		return Token{Kind: TokenReturn, Lexeme: lex, Pos: start}, nil
	case "if":
		return Token{Kind: TokenIf, Lexeme: lex, Pos: start}, nil
	case "else":
		return Token{Kind: TokenElse, Lexeme: lex, Pos: start}, nil
	case "for":
		return Token{Kind: TokenFor, Lexeme: lex, Pos: start}, nil
	case "break":
		return Token{Kind: TokenBreak, Lexeme: lex, Pos: start}, nil
	case "continue":
		return Token{Kind: TokenContinue, Lexeme: lex, Pos: start}, nil
	case "map":
		return Token{Kind: TokenMap, Lexeme: lex, Pos: start}, nil
	case "struct":
		return Token{Kind: TokenStruct, Lexeme: lex, Pos: start}, nil
	case "true", "false":
		return Token{Kind: TokenBool, Lexeme: lex, Pos: start}, nil
	case "none":
		return Token{Kind: TokenNone, Lexeme: lex, Pos: start}, nil
	case "nil":
		return Token{Kind: TokenNil, Lexeme: lex, Pos: start}, nil
	default:
		return Token{Kind: TokenIdent, Lexeme: lex, Pos: start}, nil
	}
}

func (l *Lexer) scanNumber() (Token, error) {
	start := l.pos()
	begin := l.offset
	for !l.eof() && unicode.IsDigit(l.peek()) {
		l.advance()
	}
	kind := TokenInt
	if !l.eof() && l.peek() == '.' {
		if l.peekNext() != '.' {
			kind = TokenFloat
			l.advance()
			for !l.eof() && unicode.IsDigit(l.peek()) {
				l.advance()
			}
		}
	}
	lex := string(l.input[begin:l.offset])
	return Token{Kind: kind, Lexeme: lex, Pos: start}, nil
}

func (l *Lexer) scanString() (Token, error) {
	start := l.pos()
	l.advance()
	begin := l.offset
	for !l.eof() {
		ch := l.peek()
		if ch == '\\' {
			l.advance()
			if !l.eof() {
				l.advance()
			}
			continue
		}
		if ch == '"' {
			lex := string(l.input[begin:l.offset])
			l.advance()
			return Token{Kind: TokenString, Lexeme: lex, Pos: start}, nil
		}
		l.advance()
	}
	return Token{}, fmt.Errorf("unterminated string at %d:%d", start.Line, start.Column)
}

func (l *Lexer) skipWhitespaceAndComments() {
	for {
		l.skipWhitespace()
		if l.eof() {
			return
		}
		if l.peek() == '/' && l.peekNext() == '/' {
			for !l.eof() && l.peek() != '\n' {
				l.advance()
			}
			continue
		}
		if l.peek() == '/' && l.peekNext() == '*' {
			l.advance()
			l.advance()
			for !l.eof() {
				if l.peek() == '*' && l.peekNext() == '/' {
					l.advance()
					l.advance()
					break
				}
				l.advance()
			}
			continue
		}
		return
	}
}

func (l *Lexer) skipWhitespace() {
	for !l.eof() {
		ch := l.peek()
		if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' {
			l.advance()
			continue
		}
		return
	}
}

func (l *Lexer) pos() Pos {
	return Pos{Line: l.line, Column: l.column, Offset: l.offset}
}

func (l *Lexer) peek() rune {
	if l.eof() {
		return 0
	}
	return l.input[l.offset]
}

func (l *Lexer) peekNext() rune {
	if l.offset+1 >= len(l.input) {
		return 0
	}
	return l.input[l.offset+1]
}

func (l *Lexer) advance() {
	if l.eof() {
		return
	}
	ch := l.input[l.offset]
	l.offset++
	if ch == '\n' {
		l.line++
		l.column = 1
	} else {
		l.column++
	}
}

func (l *Lexer) eof() bool {
	return l.offset >= len(l.input)
}

func isIdentStart(ch rune) bool {
	return ch == '_' || unicode.IsLetter(ch)
}

func isIdentPart(ch rune) bool {
	return ch == '_' || unicode.IsLetter(ch) || unicode.IsDigit(ch)
}
