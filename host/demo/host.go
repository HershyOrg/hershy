package main

import "fmt"

/* ---------------- Process Scheduler ---------------- */

type ProcessScheduler struct {
	procs map[string]*Program
}

func NewScheduler() *ProcessScheduler {
	return &ProcessScheduler{
		procs: map[string]*Program{},
	}
}

func (s *ProcessScheduler) Add(p *Program) {
	s.procs[p.Name] = p
}

func (s *ProcessScheduler) Start(name string) error {
	p, ok := s.procs[name]
	if !ok {
		return fmt.Errorf("no process: %s", name)
	}
	return p.Run()
}

func (s *ProcessScheduler) Stop(name string) error {
	p, ok := s.procs[name]
	if !ok {
		return fmt.Errorf("no process: %s", name)
	}
	return p.Stop()
}
