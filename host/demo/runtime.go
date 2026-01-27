package main

import (
	"context"
	"os"
	"os/exec"
)

/* ---------------- Runtime Abstraction ---------------- */

type Runtime interface {
	Run(ctx context.Context, name string) error
	Stop(ctx context.Context, name string) error
}

/* ---------------- gVisor Runtime ---------------- */

type GVisorRuntime struct {
	Image string
	Args  []string
}

func (r *GVisorRuntime) Run(ctx context.Context, name string) error {
	args := []string{
		"run",
		"--runtime=runsc",
		"--rm",
		"--name", name,
	}
	args = append(args, r.Args...)
	args = append(args, r.Image)

	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Start()
}

func (r *GVisorRuntime) Stop(_ context.Context, name string) error {
	cmd := exec.Command("docker", "stop", name)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}
