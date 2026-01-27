package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

/* ---------------- stdin Control ---------------- */

func main() {
	scheduler := NewScheduler()

	scheduler.Add(&Program{
		Name: "alpha",
		Runtime: &GVisorRuntime{
			Image: "alpine:3.20",
			Args:  []string{"sh", "-lc", "echo alpha running; sleep 9999"},
		},
	})

	scheduler.Add(&Program{
		Name: "beta",
		Runtime: &GVisorRuntime{
			Image: "alpine:3.20",
			Args:  []string{"sh", "-lc", "echo beta running; sleep 9999"},
		},
	})

	fmt.Println("commands: start <name> | stop <name> | exit")

	sc := bufio.NewScanner(os.Stdin)
	for {
		fmt.Print("> ")
		if !sc.Scan() {
			return
		}
		in := strings.TrimSpace(sc.Text())
		if in == "" {
			continue
		}

		parts := strings.Fields(in)
		switch parts[0] {
		case "start":
			if len(parts) < 2 {
				fmt.Println("usage: start <name>")
				continue
			}
			if err := scheduler.Start(parts[1]); err != nil {
				fmt.Println("err:", err)
			}
		case "stop":
			if len(parts) < 2 {
				fmt.Println("usage: stop <name>")
				continue
			}
			if err := scheduler.Stop(parts[1]); err != nil {
				fmt.Println("err:", err)
			}
		case "exit":
			return
		default:
			fmt.Println("unknown command")
		}
	}
}
