package main

import (
	"fmt"
	"os"

	"host/interp"
)

func main() {
	if err := interp.RunProcessDemo(); err != nil {
		fmt.Fprintf(os.Stderr, "process demo failed: %v\n", err)
		os.Exit(1)
	}
}
