package main

import (
	"flag"
	"fmt"
	"os"

	"strategy-runner/validator"
)

func main() {
	file := flag.String("file", "./strategy.sample.json", "Path to hershy strategy graph JSON")
	flag.Parse()

	issues, err := validator.ValidateFile(*file)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: %v\n", err)
		os.Exit(2)
	}

	if len(issues) == 0 {
		fmt.Printf("OK: %s is valid hershy strategy graph JSON\n", *file)
		return
	}

	fmt.Printf("INVALID: %s has %d issue(s)\n", *file, len(issues))
	for i, issue := range issues {
		fmt.Printf("%d. %s\n", i+1, issue)
	}
	os.Exit(1)
}
