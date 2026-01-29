# Hersh - Reactive Go Framework

Hersh는 반응형 프로그래밍과 모니터링 기능을 제공하는 Go 프레임워크입니다.

## 🎯 핵심 개념

### Reactive State Management (반응형 상태 관리)
- **Watch**: 값의 변화를 감지하고 자동으로 재실행
- **Memo**: 비용이 높은 계산 결과를 캐싱
- **HershContext**: 실행 간 공유되는 상태 관리 (GetValue/SetValue)

### Fault Tolerance (장애 허용)
- Erlang Supervisor 패턴 기반 자동 복구
- 6회 재시도 + Exponential backoff
- StopErr, KillErr, CrashErr로 세밀한 제어

### State Machine (상태 머신)
- Ready → InitRun → Running → Ready 사이클
- 우선순위 기반 시그널 처리 (Watcher > User > Var)
- Reducer-Effect 패턴으로 예측 가능한 상태 전이

## 🚀 빠른 시작

### 기본 사용법

```go
package main

import (
    "fmt"
    "hersh"
)

func main() {
    watcher := hersh.NewWatcher(hersh.DefaultWatcherConfig())

    managedFunc := func(msg *hersh.Message, ctx hersh.HershContext) error {
        fmt.Println("Hello, Hersh!")

        // Memo로 캐싱
        result := hersh.Memo(func() any {
            return "cached value"
        }, "myMemo", ctx)

        fmt.Println(result)
        return nil
    }

    watcher.Manage(managedFunc, "example")
    watcher.Start()

    // 메시지 전송으로 재실행 트리거
    watcher.SendMessage("trigger")

    watcher.Stop()
}
```

### WatchCall 사용

```go
managedFunc := func(msg *hersh.Message, ctx hersh.HershContext) error {
    // 300ms마다 외부 값 폴링
    val := hersh.WatchCall(
        func(prev any, watchCtx context.Context) (any, bool, error) {
            newVal := fetchExternalValue()
            changed := prev != newVal
            return newVal, changed, nil
        },
        "externalValue",
        300*time.Millisecond,
        ctx,
    )

    if val != nil {
        fmt.Printf("Value changed to: %v\n", val)
    }

    return nil
}
```

## 📦 패키지 구조

```
hersh/
├── core/          # 공유 타입 (WatcherState, Signal, Message 등)
├── manager/       # Reducer-Effect 시스템
│   ├── state.go   # VarState, UserState, ManagerState
│   ├── signal.go  # VarSig, UserSig, WatcherSig
│   ├── reducer.go # 우선순위 기반 상태 전이
│   ├── effect.go  # Effect 정의
│   ├── handler.go # Effect 실행 엔진
│   └── logger.go  # 통합 로깅
├── watcher.go     # Watcher 코어 API
├── watch.go       # WatchCall, WatchFlow
├── memo.go        # Memo 캐싱
└── types.go       # 편의 re-export
```

## 🧪 테스트

전체 33개 테스트 통과:
- Manager 유닛 테스트: 23개
- Manager 통합 테스트: 6개
- Watcher E2E 테스트: 5개 (전부 통과)

```bash
go test ./...
```

## 🎬 예제

### 1. 기본 반응형 실행
```bash
go run demo/example_simple.go
```

Memo, HershContext 기반 상태 관리, Message 실행을 시연합니다.

### 2. WatchCall 반응형 폴링
```bash
go run demo/example_watchcall.go
```

외부 값 변화 감지와 자동 재실행을 시연합니다.

## 📊 주요 기능

### ✅ 구현 완료
- [x] Reactive State Management (Watch, Memo, HershContext)
- [x] Fault Tolerance (Supervisor 패턴)
- [x] Reducer-Effect 패턴
- [x] 우선순위 기반 시그널 처리
- [x] InitRun 2-phase 초기화
- [x] StopErr/KillErr/CrashErr 제어
- [x] WatchCall (주기적 폴링)
- [x] WatchFlow (채널 기반)
- [x] 통합 로깅 시스템

### ⏳ 향후 구현
- [ ] Outside (IPC 지원)
- [ ] WatcherServer (원격 모니터링)
- [ ] 블록 언어 컴파일러

## 🏗️ 아키텍처

### Signal → Reduce → Effect 사이클

```
1. Watch가 변화 감지 → VarSig 생성
2. Reducer가 우선순위에 따라 처리
   - WatcherSig (최우선)
   - UserSig (중간)
   - VarSig (최하)
3. 상태 전이 발생
4. EffectCommander가 Effect 지시
5. EffectHandler가 스크립트 실행
6. 결과에 따라 다시 Signal 생성
```

### 상태 전이 규칙

```
Ready    → Running   (VarSig/UserSig)
Running  → Ready     (실행 완료)
Ready    → InitRun   (초기화)
InitRun  → Ready     (초기화 완료)
Running  → Stopped   (StopErr)
Stopped  → InitRun   (재시작)
```

## 🔧 설정

### WatcherConfig

```go
config := hersh.WatcherConfig{
    DefaultTimeout: 1 * time.Minute,
    RecoveryPolicy: hersh.RecoveryPolicy{
        MaxConsecutiveFailures: 6,
        BaseRetryDelay:         1 * time.Second,
        MaxRetryDelay:          5 * time.Minute,
    },
}
```

## 📝 라이센스

프로젝트 라이센스에 따릅니다.
