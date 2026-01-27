package main

import (
	"context"
	"fmt"
	"sync"
)

type ProgramModel interface {
	RequestToRuntime_Run() error
	RequestToRuntime_Stop() error

	RequestToWatcher() ([]byte, error) //* 네트워크나 stdio이용 semi-IPC
}

/* ---------------- Scheduled Process ---------------- */

type Program struct {
	Name    string
	Runtime Runtime

	ctx    context.Context
	cancel context.CancelFunc
	mu     sync.Mutex
}

func (p *Program) Run() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.ctx != nil {
		return fmt.Errorf("%s already running", p.Name)
	}

	ctx, cancel := context.WithCancel(context.Background())
	p.ctx = ctx
	p.cancel = cancel
	return p.Runtime.Run(ctx, p.Name)
}

func (p *Program) Stop() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.ctx == nil {
		return fmt.Errorf("%s not running", p.Name)
	}

	defer func() {
		p.cancel()
		p.ctx = nil
		p.cancel = nil
	}()

	return p.Runtime.Stop(context.Background(), p.Name)
}
