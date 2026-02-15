# Hershy

**리액티브 상태 관리를 사용하는 Go용 컨테이너 오케스트레이션 시스템**

Hershy는 **[Hersh](https://github.com/HershyOrg/hersh)** 리액티브 프레임워크를 사용해 Docker/gVisor 컨테이너를 관리하는 컨테이너 오케스트레이션 시스템입니다.

## 🏗️ 아키텍처

```
User Dockerfile → Host API:9000 → Program (state machine) → Docker/gVisor Container → WatcherAPI:8080
                                                              ↓
                                                    localhost:19001-29999 (PublishPort)
```

### 주요 구성 요소

### 1. **[Hersh Framework](https://github.com/HershyOrg/hersh)** (외부 라이브러리)
- **리포지토리**: `github.com/HershyOrg/hersh@v0.2.0`
- **Managed Execution**: 반응형 트리거로 동작하는 단일 관리 함수
- **WatchCall**: 폴링 기반 리액티브 변수
- **WatchFlow**: 채널 기반 리액티브 변수
- **Memo**: 세션 범위 캐시
- **HershContext**: 영속 상태 저장소
- **WatcherAPI**: 외부 제어를 위한 HTTP 서버(포트 8080)

### 2. **program/** - Program 도메인(순수 상태 머신)
- 순수 상태 전이(IO 없음)
- 상태 머신: `Created → Building → Starting → Ready → Stopping → Stopped`
- Reducer-Effect 패턴
- 28개+ 테스트, 100% 목(mock) 기반

### 3. **host/** - Host 구성 요소(IO 레이어)
- Docker 런타임 연동
- 파일 시스템 관리
- HTTP API 서버(포트 9000)
- WatcherAPI 프록시 매니저

## ✨ 핵심 기능

### 보안 우선 설계
- **gVisor 런타임 강제**: 모든 컨테이너가 기본적으로 gVisor(`runsc`) 사용
- **읽기 전용 루트 파일시스템**: 시스템 파일 변경 불가
- **격리된 상태 디렉터리**: `/state`만 쓰기 가능
- **외부 포트 노출 없음**: `:8080`은 외부로 퍼블리시하지 않음
- **역방향 프록시만 사용**: 모든 접근은 Host 프록시 통해 처리

### Reducer-Effect 패턴
- **결정적 실행**: 레이스 컨디션 없음, 예측 가능
- **동기 흐름**: Reducer → Effect → Event (순차, 비동시)
- **시그널 기반 반응성**: 우선순위 기반 시그널 처리
- **장애 내성**: 지수 백오프 기반 복구

### 도메인 주도 설계
- **Program 도메인**: 순수 상태 전이(reducer.go)
- **Host 구성 요소**: 현실 세계 IO(Docker, 파일시스템)
- **인터페이스 기반**: 목 구현으로 쉬운 테스트
- **상태 머신**: `Created → Building → Starting → Ready → Stopping → Stopped`

## 📦 프로젝트 구조

```
hershy/
├── program/                    # Program 도메인(순수 상태 머신)
│   ├── types.go               # ProgramID, State, ProgramState
│   ├── event.go               # 사용자 및 시스템 이벤트
│   ├── effect.go              # 실행될 사이드 이펙트
│   ├── reducer.go             # 순수 상태 전이 로직
│   ├── supervisor.go          # 고루틴 기반 이벤트 루프
│   ├── effect_handler.go      # Effect 실행 인터페이스
│   └── fake_handler.go        # 테스트 구현(목)
│
├── host/                       # Host 구성 요소(IO 레이어)
│   ├── cmd/main.go            # Host 서버 엔트리포인트
│   ├── api/                   # HTTP API 서버(포트 9000)
│   ├── registry/              # 프로그램 레지스트리(메모리)
│   ├── proxy/                 # WatcherAPI 프록시 매니저
│   ├── storage/               # 파일시스템 관리
│   ├── compose/               # Docker Compose 스펙 생성
│   ├── runtime/               # Docker 런타임 연동
│   └── effect_handler.go      # 실제 IO 구현
│
└── examples/                   # 예제 프로그램(Hersh 프레임워크 사용)
    ├── simple-counter/         # WatcherAPI 기본 카운터
    ├── trading-long/           # 트레이딩 시뮬레이터
    └── watcher-server/         # 최소 WatcherAPI 서버
```

**참고**: Hersh 프레임워크는 현재 [github.com/HershyOrg/hersh](https://github.com/HershyOrg/hersh) 별도 라이브러리입니다.

## 🚀 빠른 시작

### 사전 요구사항
- Go 1.24+
- Docker 20.10+
- gVisor(runsc) - 테스트 시 선택, 운영 시 필수

### Hersh 설치

사용자 프로그램은 Hersh 프레임워크가 필요합니다:

```bash
go get github.com/HershyOrg/hersh@v0.2.0
```

전체 API 레퍼런스, 예제, 사용 가이드는 [Hersh 문서](https://github.com/HershyOrg/hersh)를 참고하세요.

### 테스트 실행

```bash
# Program 도메인 테스트(28개+, Docker 불필요)
cd program && go test ./... -v
cd program && go test ./... -race -cover

# Host 통합 테스트(Docker 필요)
cd host && go test ./... -v
cd host && go test -tags=integration ./... -v
```

### 예제 프로그램 실행

```bash
# Host 서버 시작(기본: 포트 9000, runc 런타임)
cd host && go run cmd/main.go

# 예제 프로그램 배포(Host가 :9000에서 실행 중이어야 함)
cd examples/simple-counter && ./deploy-to-host.sh
cd examples/trading-long && ./e2e_test.sh
cd examples/watcher-server && ./deploy-to-host.sh
```

## 🔒 보안 계약(Security Contracts)

Host는 모든 Program에 대해 다음 보안 계약을 강제합니다:

| 계약 | 적용 | 근거 |
|----------|-------------|-----------|
| **gVisor 런타임** | `runtime: runsc` | 커널 수준 격리 |
| **읽기 전용 루트 FS** | `read_only: true` | 시스템 변조 방지 |
| **단일 RW 볼륨** | `/state:rw`만 | 제어된 영속 데이터 |
| **포트 노출 없음** | `:8080`은 내부 전용 | 직접 접근 차단 |
| **역방향 프록시** | Host 관리 | 중앙 집중 접근 제어 |

## 📋 상태 머신

```
Created
  ↓ UserStartRequested
Building (EnsureProgramFolders, BuildRuntime)
  ↓ BuildFinished(success)
Starting (StartRuntime)
  ↓ RuntimeStarted
Ready
  ↓ UserStopRequested
Stopping (StopRuntime)
  ↓ StopFinished(success)
Stopped

Error ← (any failure)
  ↓ UserStartRequested (retry)
Building
```

## 🧪 테스트

### 테스트 커버리지

| 패키지 | 커버리지 | 테스트 |
|---------|----------|-------|
| program/ | 82.7% | 28 tests |
| host/storage | N/A | 통합 |
| host/compose | N/A | 통합 |
| host/runtime | N/A | 통합 |

### 테스트 분류

1. **단위 테스트** (`program/*_test.go`)
   - Reducer 상태 전이(19개)
   - Supervisor 이벤트 루프(9개)
   - 레이스 컨디션 탐지

2. **통합 테스트** (`host/host_test.go`)
   - 실제 Docker 빌드(Docker 필요)
   - 컨테이너 라이프사이클
   - 보안 계약 검증

3. **검증 예제** (`examples/validation`)
   - 엔드-투-엔드 흐름 검증
   - 전체 3단계 테스트

## 🛠️ 개발 원칙

### SOLID 원칙
- **단일 책임**: 각 컴포넌트는 하나의 변경 이유만 가짐
- **개방/폐쇄**: 인터페이스로 확장, 수정에는 닫힘
- **리스코프 치환**: FakeEffectHandler ↔ RealEffectHandler
- **인터페이스 분리**: 최소·집중 인터페이스
- **의존성 역전**: 구체 구현이 아닌 추상화에 의존(EffectHandler)

### 핵심 설계 패턴
- **Reducer-Effect**: 예측 가능한 상태 관리
- **Event Sourcing**: 모든 변경은 이벤트를 통해 수행
- **프로그램당 고루틴**: 격리된, 직렬 처리
- **목 기반 테스트**: 빠르고 신뢰성 높은 단위 테스트

## 📚 API 레퍼런스

### Program 도메인

```go
// 새 프로그램 생성
prog := program.NewProgram(programID, buildID, effectHandler)

// 이벤트 루프 시작
ctx := context.Background()
go prog.Start(ctx)

// 이벤트 전송
prog.SendEvent(program.UserStartRequested{ProgramID: id})

// 상태 조회(스레드 안전)
state := prog.GetState()
```

### Host 구성 요소

```go
// Storage
storage := storage.NewManager("/var/lib/hersh/programs")
storage.EnsureProgramFolders(programID)

// Compose
compose := compose.NewBuilder()
spec, _ := compose.GenerateSpec(compose.BuildOpts{...})
compose.ValidateSpec(spec) // 보안 계약 강제

// Docker
docker, _ := runtime.NewDockerManager()
result, _ := docker.Build(ctx, runtime.BuildOpts{...})
docker.Start(ctx, runtime.StartOpts{Spec: spec})
docker.Stop(ctx, containerID)
```

### Effect Handler

```go
// 실제 핸들러 생성
handler := host.NewRealEffectHandler(storage, compose, docker)

// 또는 테스트용 fake 사용
handler := program.NewFakeEffectHandler()
handler.Delay = 10 * time.Millisecond
handler.FailBuild = false
```

## 🔮 향후 작업(Phase 4)

- **Registry**: 영속성을 갖춘 멀티 프로그램 관리
- **HTTP API**: CRUD + 라이프사이클 REST 엔드포인트
- **Reverse Proxy**: `/programs/{id}/watcher/*` 라우팅
- **인증**: 사용자/토큰 기반 접근 제어
- **메트릭**: Prometheus 호환 텔레메트리

## 📝 라이선스

MIT License - 자세한 내용은 LICENSE 파일 참고

## 🤝 기여

기여 환영합니다! 다음을 확인해주세요:
- 테스트 통과: `go test ./program -race`
- 커버리지 ≥80%: `go test ./program -cover`
- 코드 포맷팅: `go fmt ./...`
- 린터 통과: `go vet ./...`

## 📖 문서

- [CLAUDE.md](CLAUDE.md) - 프로젝트 개요 및 구현 가이드
- [API Reference](docs/API.md) - 상세 API 문서(TBD)
- [Host AI Provider Guide](host/AI_PROVIDER_GUIDE.md) - `/ai/strategy-draft`용 AI provider 설정/사용 가이드
- [Examples](examples/) - 사용 예제 및 검증

---

**Go와 Reducer-Effect 패턴으로 만들었습니다 ❤️**
