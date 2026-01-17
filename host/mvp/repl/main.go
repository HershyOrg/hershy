package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"host/mvp/ast"
	"host/mvp/parser"
)

func main() {
	reader := bufio.NewReader(os.Stdin)
	var buf strings.Builder
	prompt := "ghost> "
	for {
		fmt.Print(prompt)
		line, err := reader.ReadString('\n')
		if err != nil && len(line) == 0 {
			fmt.Println()
			return
		}
		line = strings.TrimRight(line, "\r\n")
		if strings.TrimSpace(line) == "" && buf.Len() == 0 {
			continue
		}
		switch strings.TrimSpace(line) {
		case ":q", ":quit":
			return
		}
		buf.WriteString(line)
		buf.WriteString("\n")

		node, err := parser.ParseSnippet(buf.String())
		if err != nil {
			if perr, ok := err.(*parser.Error); ok && perr.UnexpectedEOF {
				prompt = "....> "
				continue
			}
			fmt.Printf("error: %s\n", err)
			buf.Reset()
			prompt = "ghost> "
			continue
		}
		fmt.Printf("ok (%T)\n", node)
		fmt.Println(ast.Dump(node))
		buf.Reset()
		prompt = "ghost> "
	}
}
