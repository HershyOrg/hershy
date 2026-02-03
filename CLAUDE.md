# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Hersh** is a reactive framework and container orchestration system for Go. The project consists of three main layers:

1. **hersh/** - Reactive framework library (Reducer-Effect pattern, WatchCall, Memo, WatcherAPI)
2. **program/** - Container manager (builds Dockerfile → runs gVisor container → proxies WatcherAPI)
3. **host/** - Thin registry (Program discovery, metadata storage only)

### Architecture

```
User Dockerfile → Program (build/run/proxy) → gVisor Container (hersh.Watcher + WatcherAPI:8080) ← Host Registry
```

**Program = Self-contained system**: Handles Dockerfile → Image → gVisor → WatcherServer proxy → API
**Host = Thin layer**: Program metadata registry only (조회/검색)

## Implementation Guide

Before implementation, you must create a plan and have it reviewed.

Implementation shall be carried out in a single Phase, and the Phase must be defined as As Is → To Be.

Break the Phase down step by step, create a plan, and then implement accordingly.

Follow Domain-Driven Design (DDD) principles and use granular, semantically meaningful types.

During implementation, you must validate the work by following the Verification Guide.

## Verification Guide

After implementation, run and verify all builds and tests within the package.

Confirm that the implementation matches the Phase's As Is and To Be defined in the plan.

Confirm that you did not "shortcut" by pretending to implement the To Be without actually doing so.

## Core Design Principles

### 1. Hersh Framework: Reducer-Effect Pattern

Hersh implements a **synchronous Reducer-Effect architecture** where all state transitions are deterministic and effects execute synchronously after state changes. This design ensures:

- **Deterministic execution**: No race conditions, predictable behavior
- **Synchronous flow**: Reducer → Commander → Handler (sequential, not concurrent)
- **Signal-based reactivity**: Priority-ordered signal processing (WatcherSig > UserSig > VarSig)
- **Fault tolerance**: Built-in recovery policies with exponential backoff

**Key Components**:
- `hersh.Watcher`: Core reactive engine (state management, lifecycle)
- `WatchCall`: Reactive variable monitoring (triggers on change)
- `Memo`: Expensive computation caching
- `WatcherAPI`: HTTP server (port 8080) for external control

### 2. Program: Domain-Driven Design

Program uses **interface-based dependency injection** with 4 domain layers:

- `builder.Builder`: Dockerfile → Image (Docker BuildKit)
- `runtime.Runtime`: Image → Container (gVisor runsc)
- `proxy.Proxy`: WatcherAPI HTTP proxy (container:8080 → host)
- `api.Server`: Program HTTP API (lifecycle, status, proxy endpoints)

**State Machine**: `Created → Building → Built → Starting → Running → Stopped`

**Mock implementations** enable testing without Docker/gVisor.

### 3. Responsibility Separation

**User provides**: Dockerfile + source code (using hersh library)
**Program manages**: Build → Run → Proxy → Expose API
**Host tracks**: Program metadata (name, version, endpoint, state)

## Package Structure

```
hersh/                  # Reactive framework library
├── watcher.go          # Core Watcher implementation
├── watcher_api.go      # HTTP API server (8080)
├── manager/            # Reducer-Effect implementation
├── hctx/               # HershContext (state management)
└── demo/               # Usage examples

program/                # Container manager
├── program.go          # Core orchestrator (324 lines)
├── builder/            # Image building domain
│   ├── model.go        # Builder interface
│   └── mock_builder.go # Mock implementation
├── runtime/            # Container runtime domain
│   ├── model.go        # Runtime interface
│   └── mock_runtime.go # Mock implementation
├── proxy/              # WatcherAPI proxy domain
│   ├── model.go        # Proxy interface
│   └── mock_proxy.go   # Mock implementation
├── api/                # Program API domain
│   ├── model.go        # Server/Handler interfaces
│   └── mock_server.go  # Mock implementation
└── examples/           # Usage examples
    ├── simple/         # Basic hersh.Watcher example
    └── demo_program.go # Program usage demo

host/                   # Program registry (future)
└── main.go             # Thin HTTP registry server
```

## Testing Strategy

1. **hersh**: 80+ unit tests (WatchCall, Memo, Lifecycle, Recovery)
2. **program**: Mock-based testing (no Docker/gVisor required)
3. **Integration**: Real Docker/gVisor (future phase)

Run tests: `cd <package> && go test ./... -v`
