package parser

import (
	"fmt"

	"host/mvp/ast"
	"host/mvp/lexer"
)

type Error struct {
	Pos          lexer.Pos
	Message      string
	UnexpectedEOF bool
}

func (e *Error) Error() string {
	return fmt.Sprintf("%d:%d: %s", e.Pos.Line, e.Pos.Column, e.Message)
}

type Parser struct {
	tokens []lexer.Token
	pos    int
}

func ParseProgram(src string) (*ast.Program, error) {
	tokens, err := lexer.New(src).Lex()
	if err != nil {
		return nil, err
	}
	p := &Parser{tokens: tokens, pos: 0}
	return p.parseProgram()
}

func ParseSnippet(src string) (ast.Node, error) {
	tokens, err := lexer.New(src).Lex()
	if err != nil {
		return nil, err
	}
	p := &Parser{tokens: tokens, pos: 0}
	if p.isDeclStart(p.peek()) {
		decl, err := p.parseDecl()
		if err != nil {
			return nil, err
		}
		p.consumeSemis()
		if p.peek().Kind != lexer.TokenEOF {
			return nil, p.errorf(p.peek(), "unexpected token %q", p.peek().Lexeme)
		}
		return decl, nil
	}
	stmt, err := p.parseStmt()
	if err == nil {
		p.consumeSemis()
		if p.peek().Kind != lexer.TokenEOF {
			return nil, p.errorf(p.peek(), "unexpected token %q", p.peek().Lexeme)
		}
		return stmt, nil
	}
	p.reset(0)
	expr, err2 := p.parseExpr()
	if err2 != nil {
		return nil, err
	}
	p.consumeSemis()
	if p.peek().Kind != lexer.TokenEOF {
		return nil, p.errorf(p.peek(), "unexpected token %q", p.peek().Lexeme)
	}
	return expr, nil
}

func (p *Parser) parseProgram() (*ast.Program, error) {
	prog := &ast.Program{}
	for p.peek().Kind != lexer.TokenEOF {
		decl, err := p.parseDecl()
		if err != nil {
			return nil, err
		}
		prog.Decls = append(prog.Decls, decl)
		p.consumeSemis()
	}
	return prog, nil
}

func (p *Parser) parseDecl() (ast.Decl, error) {
	switch p.peek().Kind {
	case lexer.TokenEvent:
		return p.parseEventDecl()
	case lexer.TokenGhost:
		return p.parseGhostDecl()
	case lexer.TokenFunc:
		return p.parseFuncDecl()
	case lexer.TokenVar:
		return p.parseVarDecl()
	case lexer.TokenType:
		return p.parseTypeDecl()
	default:
		return nil, p.errorf(p.peek(), "expected declaration")
	}
}

func (p *Parser) parseEventDecl() (ast.Decl, error) {
	start, err := p.expect(lexer.TokenEvent)
	if err != nil {
		return nil, err
	}
	name, err := p.expectIdent()
	if err != nil {
		return nil, err
	}
	if _, err := p.expect(lexer.TokenStruct); err != nil {
		return nil, err
	}
	if _, err := p.expect(lexer.TokenLBrace); err != nil {
		return nil, err
	}
	fields := []ast.Field{}
	for p.peek().Kind != lexer.TokenRBrace {
		fname, err := p.expectIdent()
		if err != nil {
			return nil, err
		}
		ftype, err := p.parseType()
		if err != nil {
			return nil, err
		}
		fields = append(fields, ast.Field{Name: fname, Type: ftype})
		p.consumeSemis()
	}
	if _, err := p.expect(lexer.TokenRBrace); err != nil {
		return nil, err
	}
	return &ast.EventDecl{
		Pos:    toPos(start.Pos),
		Name:   name,
		Fields: fields,
	}, nil
}

func (p *Parser) parseGhostDecl() (ast.Decl, error) {
	start, err := p.expect(lexer.TokenGhost)
	if err != nil {
		return nil, err
	}
	if p.peek().Kind == lexer.TokenLBracket {
		inType, outType, err := p.parseGhostType()
		if err != nil {
			return nil, err
		}
		name, err := p.expectIdent()
		if err != nil {
			return nil, err
		}
		params, err := p.parseParams()
		if err != nil {
			return nil, err
		}
		body, err := p.parseBlock()
		if err != nil {
			return nil, err
		}
		return &ast.GhostDecl{
			Pos:     toPos(start.Pos),
			Name:    name,
			InType:  inType,
			OutType: outType,
			Params:  params,
			Body:    *body,
		}, nil
	}
	name, err := p.expectIdent()
	if err != nil {
		return nil, err
	}
	params, err := p.parseParams()
	if err != nil {
		return nil, err
	}
	if _, err := p.expect(lexer.TokenAssign); err != nil {
		return nil, err
	}
	pipe, err := p.parseGhostPipe()
	if err != nil {
		return nil, err
	}
	return &ast.CompGhostDecl{
		Pos:    toPos(start.Pos),
		Name:   name,
		Params: params,
		Pipe:   pipe,
	}, nil
}

func (p *Parser) parseGhostType() (ast.TypeExpr, ast.TypeExpr, error) {
	if _, err := p.expect(lexer.TokenLBracket); err != nil {
		return nil, nil, err
	}
	inType, err := p.parseType()
	if err != nil {
		return nil, nil, err
	}
	if _, err := p.expect(lexer.TokenArrowR); err != nil {
		return nil, nil, err
	}
	outType, err := p.parseType()
	if err != nil {
		return nil, nil, err
	}
	if _, err := p.expect(lexer.TokenRBracket); err != nil {
		return nil, nil, err
	}
	return inType, outType, nil
}

func (p *Parser) parseGhostPipe() ([]ast.GhostCallExpr, error) {
	call, err := p.parseGhostCall()
	if err != nil {
		return nil, err
	}
	pipe := []ast.GhostCallExpr{*call}
	for p.match(lexer.TokenArrowR) {
		next, err := p.parseGhostCall()
		if err != nil {
			return nil, err
		}
		pipe = append(pipe, *next)
	}
	return pipe, nil
}

func (p *Parser) parseGhostCall() (*ast.GhostCallExpr, error) {
	name, err := p.expectIdent()
	if err != nil {
		return nil, err
	}
	if _, err := p.expect(lexer.TokenLParen); err != nil {
		return nil, err
	}
	args, err := p.parseExprList(lexer.TokenRParen)
	if err != nil {
		return nil, err
	}
	if _, err := p.expect(lexer.TokenRParen); err != nil {
		return nil, err
	}
	return &ast.GhostCallExpr{
		Pos:  name.Pos,
		Name: name,
		Args: args,
	}, nil
}

func (p *Parser) parseFuncDecl() (ast.Decl, error) {
	start, err := p.expect(lexer.TokenFunc)
	if err != nil {
		return nil, err
	}
	var recv *ast.Param
	if p.peek().Kind == lexer.TokenLParen && p.isFuncDeclReceiver() {
		recv, err = p.parseReceiver()
		if err != nil {
			return nil, err
		}
	}
	name, err := p.expectIdent()
	if err != nil {
		return nil, err
	}
	params, err := p.parseParams()
	if err != nil {
		return nil, err
	}
	retTypes, err := p.parseReturnTypes()
	if err != nil {
		return nil, err
	}
	body, err := p.parseBlock()
	if err != nil {
		return nil, err
	}
	return &ast.FuncDecl{
		Pos:    toPos(start.Pos),
		Recv:   recv,
		Name:   name,
		Params: params,
		Return: retTypes,
		Body:   *body,
	}, nil
}

func (p *Parser) parseVarDecl() (ast.Decl, error) {
	start, err := p.expect(lexer.TokenVar)
	if err != nil {
		return nil, err
	}
	names, err := p.parseIdentList()
	if err != nil {
		return nil, err
	}
	var typ ast.TypeExpr
	if p.isTypeStart(p.peek()) {
		typ, err = p.parseType()
		if err != nil {
			return nil, err
		}
	}
	values := []ast.Expr{}
	if p.match(lexer.TokenAssign) {
		values, err = p.parseExprList(lexer.TokenSemicolon, lexer.TokenRBrace, lexer.TokenEOF)
		if err != nil {
			return nil, err
		}
	}
	return &ast.VarDecl{
		Pos:    toPos(start.Pos),
		Names:  names,
		Type:   typ,
		Values: values,
	}, nil
}

func (p *Parser) parseTypeDecl() (ast.Decl, error) {
	start, err := p.expect(lexer.TokenType)
	if err != nil {
		return nil, err
	}
	name, err := p.expectIdent()
	if err != nil {
		return nil, err
	}
	typ, err := p.parseType()
	if err != nil {
		return nil, err
	}
	return &ast.TypeDecl{
		Pos:  toPos(start.Pos),
		Name: name,
		Type: typ,
	}, nil
}

func (p *Parser) parseParams() ([]ast.Param, error) {
	if _, err := p.expect(lexer.TokenLParen); err != nil {
		return nil, err
	}
	params := []ast.Param{}
	if p.peek().Kind != lexer.TokenRParen {
		for {
			name, err := p.expectIdent()
			if err != nil {
				return nil, err
			}
			typ, err := p.parseType()
			if err != nil {
				return nil, err
			}
			params = append(params, ast.Param{Name: name, Type: typ})
			if !p.match(lexer.TokenComma) {
				break
			}
		}
	}
	if _, err := p.expect(lexer.TokenRParen); err != nil {
		return nil, err
	}
	return params, nil
}

func (p *Parser) parseReceiver() (*ast.Param, error) {
	if _, err := p.expect(lexer.TokenLParen); err != nil {
		return nil, err
	}
	name, err := p.expectIdent()
	if err != nil {
		return nil, err
	}
	typ, err := p.parseType()
	if err != nil {
		return nil, err
	}
	if _, err := p.expect(lexer.TokenRParen); err != nil {
		return nil, err
	}
	return &ast.Param{Name: name, Type: typ}, nil
}

func (p *Parser) parseReturnTypes() ([]ast.TypeExpr, error) {
	if !p.isTypeStart(p.peek()) && p.peek().Kind != lexer.TokenLParen {
		return nil, nil
	}
	if p.match(lexer.TokenLParen) {
		var types []ast.TypeExpr
		if p.peek().Kind != lexer.TokenRParen {
			for {
				typ, err := p.parseType()
				if err != nil {
					return nil, err
				}
				types = append(types, typ)
				if !p.match(lexer.TokenComma) {
					break
				}
			}
		}
		if _, err := p.expect(lexer.TokenRParen); err != nil {
			return nil, err
		}
		return types, nil
	}
	typ, err := p.parseType()
	if err != nil {
		return nil, err
	}
	return []ast.TypeExpr{typ}, nil
}

func (p *Parser) parseStmt() (ast.Stmt, error) {
	switch p.peek().Kind {
	case lexer.TokenLBrace:
		return p.parseBlock()
	case lexer.TokenIf:
		return p.parseIf()
	case lexer.TokenFor:
		return p.parseFor()
	case lexer.TokenReturn:
		return p.parseReturn()
	case lexer.TokenBreak:
		start, err := p.expect(lexer.TokenBreak)
		if err != nil {
			return nil, err
		}
		return &ast.BreakStmt{Pos: toPos(start.Pos)}, nil
	case lexer.TokenContinue:
		start, err := p.expect(lexer.TokenContinue)
		if err != nil {
			return nil, err
		}
		return &ast.ContinueStmt{Pos: toPos(start.Pos)}, nil
	default:
		return p.parseSimpleStmt()
	}
}

func (p *Parser) parseSimpleStmt() (ast.Stmt, error) {
	if p.peek().Kind == lexer.TokenIdent && p.peekNext().Kind == lexer.TokenArrowL {
		name := p.consume()
		p.consume()
		eventType, err := p.parseType()
		if err != nil {
			return nil, err
		}
		return &ast.RecvStmt{
			Pos:       toPos(name.Pos),
			Name:      ast.Ident{Name: name.Lexeme, Pos: toPos(name.Pos)},
			EventType: eventType,
		}, nil
	}

	save := p.save()
	names, err := p.tryParseIdentList()
	if err == nil && (p.peek().Kind == lexer.TokenDefine || p.peek().Kind == lexer.TokenAssign) {
		define := p.match(lexer.TokenDefine)
		if !define {
			if _, err := p.expect(lexer.TokenAssign); err != nil {
				return nil, err
			}
		}
		values, err := p.parseExprList(lexer.TokenSemicolon, lexer.TokenRBrace, lexer.TokenEOF)
		if err != nil {
			return nil, err
		}
		return &ast.AssignStmt{
			Pos:    names[0].Pos,
			Names:  names,
			Values: values,
			Define: define,
		}, nil
	}
	p.restore(save)
	expr, err := p.parseExpr()
	if err != nil {
		return nil, err
	}
	if p.match(lexer.TokenArrowR) {
		eventType, err := p.parseType()
		if err != nil {
			return nil, err
		}
		return &ast.EmitStmt{
			Pos:       expr.Position(),
			Value:     expr,
			EventType: eventType,
		}, nil
	}
	return &ast.ExprStmt{Pos: expr.Position(), Expr: expr}, nil
}

func (p *Parser) parseIf() (ast.Stmt, error) {
	start, err := p.expect(lexer.TokenIf)
	if err != nil {
		return nil, err
	}
	cond, err := p.parseExpr()
	if err != nil {
		return nil, err
	}
	thenBlock, err := p.parseBlock()
	if err != nil {
		return nil, err
	}
	var elseBlock *ast.Block
	if p.match(lexer.TokenElse) {
		if p.peek().Kind == lexer.TokenIf {
			stmt, err := p.parseIf()
			if err != nil {
				return nil, err
			}
			elseBlock = &ast.Block{
				Pos:   stmt.Position(),
				Stmts: []ast.Stmt{stmt},
			}
		} else {
			block, err := p.parseBlock()
			if err != nil {
				return nil, err
			}
			elseBlock = block
		}
	}
	return &ast.IfStmt{
		Pos:  toPos(start.Pos),
		Cond: cond,
		Then: *thenBlock,
		Else: elseBlock,
	}, nil
}

func (p *Parser) parseFor() (ast.Stmt, error) {
	start, err := p.expect(lexer.TokenFor)
	if err != nil {
		return nil, err
	}
	cond, err := p.parseExpr()
	if err != nil {
		return nil, err
	}
	body, err := p.parseBlock()
	if err != nil {
		return nil, err
	}
	return &ast.ForStmt{
		Pos:  toPos(start.Pos),
		Cond: cond,
		Body: *body,
	}, nil
}

func (p *Parser) parseReturn() (ast.Stmt, error) {
	start, err := p.expect(lexer.TokenReturn)
	if err != nil {
		return nil, err
	}
	values := []ast.Expr{}
	if p.peek().Kind != lexer.TokenSemicolon && p.peek().Kind != lexer.TokenRBrace && p.peek().Kind != lexer.TokenEOF {
		var err error
		values, err = p.parseExprList(lexer.TokenSemicolon, lexer.TokenRBrace, lexer.TokenEOF)
		if err != nil {
			return nil, err
		}
	}
	return &ast.ReturnStmt{Pos: toPos(start.Pos), Values: values}, nil
}

func (p *Parser) parseBlock() (*ast.Block, error) {
	start, err := p.expect(lexer.TokenLBrace)
	if err != nil {
		return nil, err
	}
	stmts := []ast.Stmt{}
	for p.peek().Kind != lexer.TokenRBrace {
		stmt, err := p.parseStmt()
		if err != nil {
			return nil, err
		}
		stmts = append(stmts, stmt)
		p.consumeSemis()
	}
	if _, err := p.expect(lexer.TokenRBrace); err != nil {
		return nil, err
	}
	return &ast.Block{Pos: toPos(start.Pos), Stmts: stmts}, nil
}

func (p *Parser) parseExpr() (ast.Expr, error) {
	return p.parseBinary(0)
}

func (p *Parser) parseBinary(minPrec int) (ast.Expr, error) {
	left, err := p.parseUnary()
	if err != nil {
		return nil, err
	}
	for {
		op, prec := p.binaryOp(p.peek())
		if prec < minPrec {
			break
		}
		opTok := p.consume()
		right, err := p.parseBinary(prec + 1)
		if err != nil {
			return nil, err
		}
		left = &ast.BinaryExpr{
			Pos:   toPos(opTok.Pos),
			Op:    op,
			Left:  left,
			Right: right,
		}
	}
	return left, nil
}

func (p *Parser) parseUnary() (ast.Expr, error) {
	switch p.peek().Kind {
	case lexer.TokenNot, lexer.TokenPlus, lexer.TokenMinus:
		opTok := p.consume()
		x, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		return &ast.UnaryExpr{
			Pos: toPos(opTok.Pos),
			Op:  p.unaryOp(opTok),
			X:   x,
		}, nil
	default:
		return p.parsePrimary()
	}
}

func (p *Parser) parsePrimary() (ast.Expr, error) {
	operand, err := p.parseOperand()
	if err != nil {
		return nil, err
	}
	for {
		switch p.peek().Kind {
		case lexer.TokenDot:
			dot := p.consume()
			ident, err := p.expectIdent()
			if err != nil {
				return nil, err
			}
			operand = &ast.SelectorExpr{
				Pos: toPos(dot.Pos),
				X:   operand,
				Sel: ident,
			}
		case lexer.TokenLBracket:
			start := p.consume()
			idx, err := p.parseExpr()
			if err != nil {
				return nil, err
			}
			if _, err := p.expect(lexer.TokenRBracket); err != nil {
				return nil, err
			}
			operand = &ast.IndexExpr{
				Pos:   toPos(start.Pos),
				X:     operand,
				Index: idx,
			}
		case lexer.TokenLParen:
			start := p.consume()
			args, err := p.parseExprList(lexer.TokenRParen)
			if err != nil {
				return nil, err
			}
			if _, err := p.expect(lexer.TokenRParen); err != nil {
				return nil, err
			}
			operand = &ast.CallExpr{
				Pos:    toPos(start.Pos),
				Callee: operand,
				Args:   args,
			}
		default:
			return operand, nil
		}
	}
}

func (p *Parser) parseOperand() (ast.Expr, error) {
	switch p.peek().Kind {
	case lexer.TokenIdent:
		if expr, ok, err := p.tryCompGhostExpr(); ok || err != nil {
			return expr, err
		}
		if lit, ok, err := p.tryCompositeLit(); ok || err != nil {
			return lit, err
		}
		tok := p.consume()
		return &ast.IdentExpr{Pos: toPos(tok.Pos), Name: tok.Lexeme}, nil
	case lexer.TokenInt, lexer.TokenFloat, lexer.TokenString, lexer.TokenBool, lexer.TokenNone, lexer.TokenNil:
		return p.parseLiteral()
	case lexer.TokenLParen:
		p.consume()
		expr, err := p.parseExpr()
		if err != nil {
			return nil, err
		}
		if _, err := p.expect(lexer.TokenRParen); err != nil {
			return nil, err
		}
		return expr, nil
	case lexer.TokenFunc:
		return p.parseFuncLit()
	case lexer.TokenGhost:
		return p.parseGhostLit()
	case lexer.TokenStar, lexer.TokenLBracket, lexer.TokenMap:
		if lit, ok, err := p.tryCompositeLit(); ok || err != nil {
			return lit, err
		}
	}
	return nil, p.errorf(p.peek(), "unexpected token %q", p.peek().Lexeme)
}

func (p *Parser) parseLiteral() (ast.Expr, error) {
	tok := p.consume()
	switch tok.Kind {
	case lexer.TokenInt:
		return &ast.BasicLit{Pos: toPos(tok.Pos), Kind: ast.BasicInt, Value: tok.Lexeme}, nil
	case lexer.TokenFloat:
		return &ast.BasicLit{Pos: toPos(tok.Pos), Kind: ast.BasicFloat, Value: tok.Lexeme}, nil
	case lexer.TokenString:
		return &ast.BasicLit{Pos: toPos(tok.Pos), Kind: ast.BasicString, Value: tok.Lexeme}, nil
	case lexer.TokenBool:
		return &ast.BasicLit{Pos: toPos(tok.Pos), Kind: ast.BasicBool, Value: tok.Lexeme}, nil
	case lexer.TokenNone:
		return &ast.BasicLit{Pos: toPos(tok.Pos), Kind: ast.BasicNone, Value: "none"}, nil
	case lexer.TokenNil:
		return &ast.BasicLit{Pos: toPos(tok.Pos), Kind: ast.BasicNil, Value: "nil"}, nil
	default:
		return nil, p.errorf(tok, "invalid literal")
	}
}

func (p *Parser) parseFuncLit() (ast.Expr, error) {
	start, err := p.expect(lexer.TokenFunc)
	if err != nil {
		return nil, err
	}
	params, err := p.parseParams()
	if err != nil {
		return nil, err
	}
	retTypes, err := p.parseReturnTypes()
	if err != nil {
		return nil, err
	}
	body, err := p.parseBlock()
	if err != nil {
		return nil, err
	}
	return &ast.FuncLit{
		Pos:    toPos(start.Pos),
		Params: params,
		Return: retTypes,
		Body:   *body,
	}, nil
}

func (p *Parser) parseGhostLit() (ast.Expr, error) {
	start, err := p.expect(lexer.TokenGhost)
	if err != nil {
		return nil, err
	}
	inType, outType, err := p.parseGhostType()
	if err != nil {
		return nil, err
	}
	params, err := p.parseParams()
	if err != nil {
		return nil, err
	}
	body, err := p.parseBlock()
	if err != nil {
		return nil, err
	}
	return &ast.GhostLit{
		Pos:     toPos(start.Pos),
		InType:  inType,
		OutType: outType,
		Params:  params,
		Body:    *body,
	}, nil
}

func (p *Parser) tryCompositeLit() (ast.Expr, bool, error) {
	save := p.save()
	typ, err := p.parseType()
	if err != nil {
		p.restore(save)
		return nil, false, nil
	}
	if p.peek().Kind != lexer.TokenLBrace {
		p.restore(save)
		return nil, false, nil
	}
	start := p.consume()
	elems, err := p.parseElements()
	if err != nil {
		return nil, true, err
	}
	if _, err := p.expect(lexer.TokenRBrace); err != nil {
		return nil, true, err
	}
	return &ast.CompositeLit{
		Pos:      toPos(start.Pos),
		Type:     typ,
		Elements: elems,
	}, true, nil
}

func (p *Parser) tryCompGhostExpr() (ast.Expr, bool, error) {
	save := p.save()
	call, err := p.parseGhostCall()
	if err != nil {
		p.restore(save)
		return nil, false, nil
	}
	if p.peek().Kind != lexer.TokenArrowR {
		p.restore(save)
		return nil, false, nil
	}
	pipe := []ast.GhostCallExpr{*call}
	for p.match(lexer.TokenArrowR) {
		next, err := p.parseGhostCall()
		if err != nil {
			return nil, true, err
		}
		pipe = append(pipe, *next)
	}
	return &ast.CompGhostExpr{
		Pos:  pipe[0].Pos,
		Pipe: pipe,
	}, true, nil
}

func (p *Parser) parseElements() ([]ast.Element, error) {
	elems := []ast.Element{}
	if p.peek().Kind == lexer.TokenRBrace {
		return elems, nil
	}
	for {
		key, err := p.parseExpr()
		if err != nil {
			return nil, err
		}
		if p.match(lexer.TokenColon) {
			value, err := p.parseExpr()
			if err != nil {
				return nil, err
			}
			elems = append(elems, ast.Element{Key: key, Value: value})
		} else {
			elems = append(elems, ast.Element{Value: key})
		}
		if !p.match(lexer.TokenComma) {
			break
		}
	}
	return elems, nil
}

func (p *Parser) parseType() (ast.TypeExpr, error) {
	switch p.peek().Kind {
	case lexer.TokenStar:
		start := p.consume()
		base, err := p.parseType()
		if err != nil {
			return nil, err
		}
		return &ast.PointerType{Pos: toPos(start.Pos), Base: base}, nil
	case lexer.TokenLBracket:
		start := p.consume()
		if _, err := p.expect(lexer.TokenRBracket); err != nil {
			return nil, err
		}
		elem, err := p.parseType()
		if err != nil {
			return nil, err
		}
		return &ast.SliceType{Pos: toPos(start.Pos), Elem: elem}, nil
	case lexer.TokenMap:
		start := p.consume()
		if _, err := p.expect(lexer.TokenLBracket); err != nil {
			return nil, err
		}
		key, err := p.parseType()
		if err != nil {
			return nil, err
		}
		if _, err := p.expect(lexer.TokenRBracket); err != nil {
			return nil, err
		}
		val, err := p.parseType()
		if err != nil {
			return nil, err
		}
		return &ast.MapType{Pos: toPos(start.Pos), Key: key, Value: val}, nil
	case lexer.TokenStruct:
		start := p.consume()
		if _, err := p.expect(lexer.TokenLBrace); err != nil {
			return nil, err
		}
		fields := []ast.Field{}
		for p.peek().Kind != lexer.TokenRBrace {
			name, err := p.expectIdent()
			if err != nil {
				return nil, err
			}
			typ, err := p.parseType()
			if err != nil {
				return nil, err
			}
			fields = append(fields, ast.Field{Name: name, Type: typ})
			p.consumeSemis()
		}
		if _, err := p.expect(lexer.TokenRBrace); err != nil {
			return nil, err
		}
		return &ast.StructType{Pos: toPos(start.Pos), Fields: fields}, nil
	case lexer.TokenIdent:
		name := p.consume()
		return &ast.NamedType{
			Pos:  toPos(name.Pos),
			Name: ast.Ident{Name: name.Lexeme, Pos: toPos(name.Pos)},
		}, nil
	default:
		return nil, p.errorf(p.peek(), "expected type")
	}
}

func (p *Parser) parseExprList(stop ...lexer.TokenKind) ([]ast.Expr, error) {
	exprs := []ast.Expr{}
	if p.isStopToken(stop) {
		return exprs, nil
	}
	for {
		expr, err := p.parseExpr()
		if err != nil {
			return nil, err
		}
		exprs = append(exprs, expr)
		if !p.match(lexer.TokenComma) {
			break
		}
	}
	return exprs, nil
}

func (p *Parser) parseIdentList() ([]ast.Ident, error) {
	idents := []ast.Ident{}
	first, err := p.expectIdent()
	if err != nil {
		return nil, err
	}
	idents = append(idents, first)
	for p.match(lexer.TokenComma) {
		next, err := p.expectIdent()
		if err != nil {
			return nil, err
		}
		idents = append(idents, next)
	}
	return idents, nil
}

func (p *Parser) tryParseIdentList() ([]ast.Ident, error) {
	save := p.save()
	ids, err := p.parseIdentList()
	if err != nil {
		p.restore(save)
		return nil, err
	}
	return ids, nil
}

func (p *Parser) consumeSemis() {
	for p.match(lexer.TokenSemicolon) {
	}
}

func (p *Parser) expectIdent() (ast.Ident, error) {
	tok := p.peek()
	if tok.Kind != lexer.TokenIdent {
		return ast.Ident{}, p.errorf(tok, "expected identifier")
	}
	p.consume()
	return ast.Ident{Name: tok.Lexeme, Pos: toPos(tok.Pos)}, nil
}

func (p *Parser) expectKeyword(word string) (lexer.Token, error) {
	tok := p.peek()
	if tok.Lexeme != word {
		return lexer.Token{}, p.errorf(tok, "expected %q", word)
	}
	return p.consume(), nil
}

func (p *Parser) expect(kind lexer.TokenKind) (lexer.Token, error) {
	tok := p.peek()
	if tok.Kind != kind {
		return lexer.Token{}, p.errorf(tok, "expected %s", kind.String())
	}
	return p.consume(), nil
}

func (p *Parser) match(kind lexer.TokenKind) bool {
	if p.peek().Kind == kind {
		p.consume()
		return true
	}
	return false
}

func (p *Parser) peek() lexer.Token {
	if p.pos >= len(p.tokens) {
		return lexer.Token{Kind: lexer.TokenEOF}
	}
	return p.tokens[p.pos]
}

func (p *Parser) peekNext() lexer.Token {
	if p.pos+1 >= len(p.tokens) {
		return lexer.Token{Kind: lexer.TokenEOF}
	}
	return p.tokens[p.pos+1]
}

func (p *Parser) consume() lexer.Token {
	tok := p.peek()
	if p.pos < len(p.tokens) {
		p.pos++
	}
	return tok
}

func (p *Parser) save() int {
	return p.pos
}

func (p *Parser) restore(pos int) {
	p.pos = pos
}

func (p *Parser) reset(pos int) {
	p.pos = pos
}

func (p *Parser) isDeclStart(tok lexer.Token) bool {
	switch tok.Kind {
	case lexer.TokenEvent, lexer.TokenGhost, lexer.TokenFunc, lexer.TokenVar, lexer.TokenType:
		if tok.Kind == lexer.TokenFunc {
			return p.isFuncDeclStart()
		}
		if tok.Kind == lexer.TokenGhost {
			return p.isGhostDeclStart()
		}
		return true
	default:
		return false
	}
}

func (p *Parser) isFuncDeclStart() bool {
	next := p.peekNext()
	if next.Kind == lexer.TokenIdent {
		return true
	}
	if next.Kind != lexer.TokenLParen {
		return false
	}
	i := p.pos + 1
	if i >= len(p.tokens) || p.tokens[i].Kind != lexer.TokenLParen {
		return false
	}
	i++
	if i >= len(p.tokens) || p.tokens[i].Kind != lexer.TokenIdent {
		return false
	}
	i++
	if i >= len(p.tokens) || !p.isTypeStart(p.tokens[i]) {
		return false
	}
	i++
	for i < len(p.tokens) && p.tokens[i].Kind != lexer.TokenRParen {
		i++
	}
	if i >= len(p.tokens) || i+2 >= len(p.tokens) {
		return false
	}
	if p.tokens[i+1].Kind != lexer.TokenIdent {
		return false
	}
	return p.tokens[i+2].Kind == lexer.TokenLParen
}

func (p *Parser) isGhostDeclStart() bool {
	if p.peek().Kind != lexer.TokenGhost {
		return false
	}
	next := p.peekNext()
	if next.Kind == lexer.TokenIdent {
		return true
	}
	if next.Kind != lexer.TokenLBracket {
		return false
	}
	i := p.pos + 2
	for i < len(p.tokens) && p.tokens[i].Kind != lexer.TokenRBracket {
		i++
	}
	if i >= len(p.tokens) {
		return false
	}
	if i+1 >= len(p.tokens) {
		return false
	}
	return p.tokens[i+1].Kind == lexer.TokenIdent
}

func (p *Parser) isTypeStart(tok lexer.Token) bool {
	switch tok.Kind {
	case lexer.TokenIdent, lexer.TokenStar, lexer.TokenLBracket, lexer.TokenMap:
		return true
	default:
		return false
	}
}

func (p *Parser) isFuncDeclReceiver() bool {
	if p.peek().Kind != lexer.TokenLParen {
		return false
	}
	i := p.pos + 1
	if i >= len(p.tokens) || p.tokens[i].Kind != lexer.TokenIdent {
		return false
	}
	i++
	if i >= len(p.tokens) {
		return false
	}
	if !p.isTypeStart(p.tokens[i]) {
		return false
	}
	i++
	for i < len(p.tokens) && p.tokens[i].Kind != lexer.TokenRParen {
		i++
	}
	if i >= len(p.tokens) {
		return false
	}
	if i+1 >= len(p.tokens) {
		return false
	}
	return p.tokens[i+1].Kind == lexer.TokenIdent
}

func (p *Parser) isStopToken(stops []lexer.TokenKind) bool {
	for _, k := range stops {
		if p.peek().Kind == k {
			return true
		}
	}
	return false
}

func (p *Parser) binaryOp(tok lexer.Token) (ast.BinaryOp, int) {
	switch tok.Kind {
	case lexer.TokenOr:
		return ast.BinaryOr, 1
	case lexer.TokenAnd:
		return ast.BinaryAnd, 2
	case lexer.TokenEq:
		return ast.BinaryEq, 3
	case lexer.TokenNotEq:
		return ast.BinaryNotEq, 3
	case lexer.TokenLess:
		return ast.BinaryLess, 4
	case lexer.TokenLessEq:
		return ast.BinaryLessEq, 4
	case lexer.TokenGreater:
		return ast.BinaryGreater, 4
	case lexer.TokenGreaterEq:
		return ast.BinaryGreaterEq, 4
	case lexer.TokenPlus:
		return ast.BinaryAdd, 5
	case lexer.TokenMinus:
		return ast.BinarySub, 5
	case lexer.TokenStar:
		return ast.BinaryMul, 6
	case lexer.TokenSlash:
		return ast.BinaryDiv, 6
	case lexer.TokenPercent:
		return ast.BinaryMod, 6
	default:
		return 0, -1
	}
}

func (p *Parser) unaryOp(tok lexer.Token) ast.UnaryOp {
	switch tok.Kind {
	case lexer.TokenNot:
		return ast.UnaryNot
	case lexer.TokenPlus:
		return ast.UnaryPlus
	default:
		return ast.UnaryMinus
	}
}

func (p *Parser) errorf(tok lexer.Token, format string, args ...interface{}) error {
	msg := fmt.Sprintf(format, args...)
	eof := tok.Kind == lexer.TokenEOF
	return &Error{Pos: tok.Pos, Message: msg, UnexpectedEOF: eof}
}

func toPos(pos lexer.Pos) ast.Pos {
	return ast.Pos{Line: pos.Line, Column: pos.Column, Offset: pos.Offset}
}
