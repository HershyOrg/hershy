package main

import (
	"flag"
	"fmt"
	"os"

	"strategy-runner/codegen"
)

func main() {
	file := flag.String("file", "./strategy.sample.json", "Path to hershy strategy graph JSON")
	out := flag.String("out", "./generated_strategy.go", "Path for generated Hershy Go source")
	flag.Parse()

	if err := codegen.GenerateFile(*file, *out); err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("OK: generated Hershy Go source: %s\n", *out)
}
