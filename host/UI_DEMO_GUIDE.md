# Host Web UI 실제 사용 가이드

## 🚀 빠른 시작

### 1. Host 서버 실행

```bash
cd /home/rlaaudgjs5638/hersh/host
./host-server
```

출력:
```
[HOST] 🚀 Starting Hersh Host Server
[HOST]    Port: 9000
[HOST]    Storage: ./host-storage
[HOST]    Runtime: runc (contracts enforced)
[HOST] ✅ Host initialized
[HOST] 🌐 HTTP API: http://localhost:9000
```

### 2. Web UI 접속

브라우저에서 열기:
```
http://localhost:9000/ui/programs
```

## 📦 프로그램 배포 실습

### 방법 1: Web UI 사용 (추천)

#### 1단계: Dashboard 접속
- URL: `http://localhost:9000/ui/programs`
- "Create Program" 버튼 클릭

#### 2단계: 프로그램 정보 입력

**User ID**: `demo-user`

**Dockerfile**: (simple-counter 예제)
```dockerfile
FROM golang:1.24-alpine AS builder
WORKDIR /build
RUN apk add --no-cache git ca-certificates
COPY go.mod go.sum ./
COPY main.go .
RUN go mod download
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o simple-counter .

FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /build/simple-counter .
RUN chmod +x /app/simple-counter
RUN mkdir -p /state && chmod 777 /state
EXPOSE 8080
CMD ["/app/simple-counter"]
```

**Source Files** (JSON):
```json
{
  "main.go": "package main\n\nimport (\n\t\"context\"\n\t\"fmt\"\n\t\"io\"\n\t\"log\"\n\t\"os\"\n\t\"path/filepath\"\n\t\"time\"\n\n\t\"github.com/HershyOrg/hershy/hersh\"\n)\n\nfunc main() {\n\t// Setup logging to /state directory\n\tstateDir := \"/state\"\n\tos.MkdirAll(stateDir, 0755)\n\tlogFile, err := os.Create(filepath.Join(stateDir, \"counter.log\"))\n\tif err != nil {\n\t\tfmt.Printf(\"⚠️  Failed to create log file: %v\\n\", err)\n\t\tlogFile = nil\n\t}\n\tif logFile != nil {\n\t\tdefer logFile.Close()\n\t\tlog.SetOutput(io.MultiWriter(os.Stdout, logFile))\n\t} else {\n\t\tlog.SetOutput(os.Stdout)\n\t}\n\n\tlog.Println(\"🚀 Starting Simple Counter Demo\")\n\n\t// Create config with WatcherAPI enabled\n\tconfig := hersh.DefaultWatcherConfig()\n\tconfig.ServerPort = 8080 // Enable WatcherAPI on port 8080\n\tconfig.DefaultTimeout = 5 * time.Minute\n\n\tenvVars := map[string]string{\n\t\t\"DEMO_NAME\":    \"Simple Counter\",\n\t\t\"DEMO_VERSION\": \"1.0.0\",\n\t}\n\n\t// Create context\n\tctx := context.Background()\n\n\t// Create Watcher\n\twatcher := hersh.NewWatcher(config, envVars, ctx)\n\n\t// Register managed function\n\twatcher.Manage(func(msg *hersh.Message, ctx hersh.HershContext) error {\n\t\tif msg.Content == \"tick\" {\n\t\t\t// Get counter from context value store\n\t\t\tcounterVal := ctx.GetValue(\"COUNTER\")\n\t\t\tcounter := 0\n\t\t\tif counterVal != nil {\n\t\t\t\tcounter = counterVal.(int)\n\t\t\t}\n\t\t\tcounter++\n\t\t\tctx.SetValue(\"COUNTER\", counter)\n\n\t\t\t// Log the counter value\n\t\t\tlogMsg := fmt.Sprintf(\"[%s] Counter: %d\", time.Now().Format(\"15:04:05\"), counter)\n\t\t\tlog.Println(logMsg)\n\t\t}\n\t\treturn nil\n\t}, \"Counter\").Cleanup(func(ctx hersh.HershContext) {\n\t\tlog.Println(\"🧹 Cleanup called\")\n\t})\n\n\t// Start Watcher (automatically starts API server on port 8080)\n\tlog.Println(\"▶️  Starting Watcher with API server on :8080\")\n\tif err := watcher.Start(); err != nil {\n\t\tlog.Printf(\"❌ Failed to start: %v\\n\", err)\n\t\tos.Exit(1)\n\t}\n\tlog.Println(\"✅ Watcher and WatcherAPI started successfully\")\n\n\t// Send tick messages every second\n\tticker := time.NewTicker(1 * time.Second)\n\tdefer ticker.Stop()\n\n\tgo func() {\n\t\tfor range ticker.C {\n\t\t\twatcher.SendMessage(\"tick\")\n\t\t}\n\t}()\n\n\t// Run indefinitely\n\tlog.Println(\"🔄 Running indefinitely (Ctrl+C to stop)...\")\n\n\t// Block forever\n\tselect {}\n}",
  "go.mod": "module simple-counter\n\ngo 1.24\n\nrequire github.com/HershyOrg/hershy v0.1.3\n\nrequire (\n\tgithub.com/google/uuid v1.6.0 // indirect\n\tgolang.org/x/sync v0.10.0 // indirect\n)",
  "go.sum": "github.com/HershyOrg/hershy v0.1.3 h1:example\ngithub.com/HershyOrg/hershy v0.1.3/go.mod h1:example\ngithub.com/google/uuid v1.6.0 h1:example\ngithub.com/google/uuid v1.6.0/go.mod h1:example\ngolang.org/x/sync v0.10.0 h1:example\ngolang.org/x/sync v0.10.0/go.mod h1:example"
}
```

#### 3단계: 프로그램 생성
- "Create Program" 버튼 클릭
- Dashboard로 자동 이동
- 프로그램이 목록에 표시됨

#### 4단계: 프로그램 시작
- 프로그램 카드에서 "Start" 버튼 클릭
- 상태 변화 관찰: Created → Building → Built → Starting → Running

**예상 시간**:
- Building: 30-60초 (Docker 이미지 빌드)
- Starting: 5-10초 (컨테이너 시작 및 헬스체크)

### 방법 2: Python 스크립트 사용

```python
import json
import requests

# 파일 읽기 (examples/simple-counter 디렉토리에서)
with open('Dockerfile', 'r') as f:
    dockerfile = f.read()
with open('main.go', 'r') as f:
    main_go = f.read()
with open('go.mod', 'r') as f:
    go_mod = f.read()
with open('go.sum', 'r') as f:
    go_sum = f.read()

# 페이로드 생성
payload = {
    'user_id': 'python-user',
    'dockerfile': dockerfile,
    'src_files': {
        'main.go': main_go,
        'go.mod': go_mod,
        'go.sum': go_sum
    }
}

# 프로그램 생성
print('📦 Creating program...')
response = requests.post('http://localhost:9000/programs', json=payload)
result = response.json()
program_id = result['program_id']
print(f'✅ Created: {program_id}')

# 프로그램 시작
print('🚀 Starting program...')
requests.post(f'http://localhost:9000/programs/{program_id}/start')

print(f'\n🌐 Web UI: http://localhost:9000/ui/programs/{program_id}')
```

실행:
```bash
cd /home/rlaaudgjs5638/hersh/examples/simple-counter
python3 deploy_script.py
```

## 📊 Web UI 사용법

### Dashboard (`/ui/programs`)

**기능**:
- 📋 모든 프로그램 목록 보기
- 🔍 프로그램 검색 (Program ID, User ID)
- 🎯 상태별 필터링
- ⚡ 빠른 작업 (Start, Stop, Restart, Delete)
- ➕ 새 프로그램 생성

**상태 색상**:
- 🟢 **Running** (초록) - 실행 중, Watcher 접근 가능
- 🔵 **Built** (파랑) - 빌드 완료, 시작 대기
- 🟡 **Building** (노랑) - Docker 이미지 빌드 중
- 🟠 **Starting** (주황) - 컨테이너 시작 중
- ⚪ **Created** (회색) - 생성됨, 빌드 전
- 🔴 **Stopped** (빨강) - 중지됨
- 🔴 **Error** (빨강) - 오류 발생

**실시간 업데이트**: 5초마다 자동 폴링

### Program Detail (`/ui/programs/:id`)

**기능**:
- 📝 프로그램 전체 정보 표시
- 🎮 생명주기 제어 (Start, Stop, Restart, Delete)
- 🔗 Watcher 인터페이스 링크
- ⚠️ 오류 메시지 표시

**정보 표시**:
- **Identifiers**: Program ID, Build ID, User ID, Image ID, Container ID
- **Network**: Proxy URL (WatcherAPI 접근 주소)
- **Timestamps**: Created At, Updated At

**생명주기 제어**:
- **Start**: Built/Stopped 상태에서 프로그램 시작
- **Stop**: Running 상태에서 프로그램 중지
- **Restart**: Running 상태에서 프로그램 재시작
- **Delete**: 모든 상태에서 프로그램 삭제 (확인 필요)

**실시간 업데이트**: 5초마다 자동 폴링

### Watcher Page (`/ui/programs/:id/watcher`)

**접근 조건**: 프로그램이 Running 상태여야 함

**구성 요소**:

#### 1. Status Card (상태 카드)
- **State**: Watcher 상태
- **Running**: 실행 여부
- **Watcher ID**: Watcher 식별자
- **Uptime**: 실행 시간
- **Last Update**: 마지막 업데이트 시각

#### 2. Signal Card (시그널 메트릭)
- **Variable Signals**: 변수 변경 시그널 수
- **User Signals**: 사용자 메시지 시그널 수
- **Watcher Signals**: Watcher 내부 시그널 수
- **Total Pending**: 대기 중인 총 시그널 수

#### 3. Log Viewer (로그 뷰어)
- **Effect Logs**: Effect 핸들러 로그
- **Reduce Logs**: Reducer 로그
- **Watch Error Logs**: 감시 오류 로그
- **Context Logs**: 컨텍스트 변경 로그
- **State Fault Logs**: 상태 오류 로그

#### 4. Command Panel (명령 패널)
- **메시지 전송**: WatcherAPI를 통해 프로그램에 명령 전송
- **Quick Commands**: 사전 정의된 빠른 명령 버튼

**실시간 업데이트**: 2초마다 자동 폴링 (Status, Signals, Logs)

## 💬 WatcherAPI 메시지 테스트

### Web UI에서 메시지 보내기

1. Watcher Page 접속
2. Command Panel에서 메시지 입력 또는 Quick Command 클릭
3. "Send" 버튼 클릭
4. 프로그램이 메시지 수신 및 처리

### curl로 메시지 보내기

```bash
# Program ID 설정
PROG_ID="ui-demo-user-build-ec5a5a719102-29ac62f5"

# Proxy URL 가져오기
PROXY_URL=$(curl -s http://localhost:9000/programs/$PROG_ID | jq -r '.proxy_url')

# 메시지 전송
curl -X POST $PROXY_URL/watcher/message \
  -H "Content-Type: application/json" \
  -d '{"content":"status"}'

# 응답: {"status":"message sent"}
```

### 컨테이너 로그 확인

```bash
# Container ID 가져오기
CONTAINER_ID=$(curl -s http://localhost:9000/programs/$PROG_ID | jq -r '.container_id')

# 로그 확인
docker logs $CONTAINER_ID --tail 30

# 실시간 로그 스트리밍
docker logs -f $CONTAINER_ID
```

출력 예시:
```
2026/02/08 09:34:36 [09:34:36] Counter: 46
2026/02/08 09:34:37 [09:34:37] Counter: 47
2026/02/08 09:34:38 [09:34:38] Counter: 48
```

## 🔍 모니터링 및 디버깅

### 1. 프로그램 상태 확인

**Web UI**:
- Dashboard에서 실시간 상태 확인
- Program Detail에서 상세 정보 확인

**API**:
```bash
curl -s http://localhost:9000/programs/$PROG_ID | jq '.'
```

### 2. WatcherAPI 상태 확인

**Web UI**:
- Watcher Page의 Status Card 확인

**API**:
```bash
curl -s $PROXY_URL/watcher/status | jq '.'
```

출력:
```json
{
  "state": "Ready",
  "isRunning": true,
  "watcherID": "effect Handler ctx",
  "uptime": "50.527533468s",
  "lastUpdate": "2026-02-08T09:34:25.68722364Z"
}
```

### 3. 로그 확인

**Web UI**:
- Watcher Page의 Log Viewer에서 실시간 로그 확인

**Docker**:
```bash
# 최근 50줄
docker logs $CONTAINER_ID --tail 50

# 실시간 스트리밍
docker logs -f $CONTAINER_ID

# 타임스탬프 포함
docker logs -f --timestamps $CONTAINER_ID
```

### 4. 빌드 오류 디버깅

**상태가 "Error"인 경우**:

1. Program Detail 페이지에서 Error Message 확인
2. Host 서버 로그 확인:
```bash
tail -100 /tmp/host-server.log | grep -A 10 -B 5 "Error"
```

**일반적인 오류**:
- `go.sum: file does not exist` → go.sum 파일 누락
- `Dockerfile syntax error` → Dockerfile 문법 오류
- `go.mod: module not found` → go.mod 의존성 오류

## 🎯 실전 시나리오

### 시나리오 1: simple-counter 배포 및 모니터링

```bash
# 1. 프로그램 배포 (Python 스크립트 또는 Web UI)
cd /home/rlaaudgjs5638/hersh/examples/simple-counter
python3 << EOF
import requests, json

with open('Dockerfile') as f: dockerfile = f.read()
with open('main.go') as f: main_go = f.read()
with open('go.mod') as f: go_mod = f.read()
with open('go.sum') as f: go_sum = f.read()

payload = {
    'user_id': 'demo-user',
    'dockerfile': dockerfile,
    'src_files': {
        'main.go': main_go,
        'go.mod': go_mod,
        'go.sum': go_sum
    }
}

response = requests.post('http://localhost:9000/programs', json=payload)
program_id = response.json()['program_id']
print(f'Program ID: {program_id}')

requests.post(f'http://localhost:9000/programs/{program_id}/start')
print(f'UI: http://localhost:9000/ui/programs/{program_id}')
EOF

# 2. Web UI에서 확인
# - Dashboard에서 프로그램 상태 확인
# - Program Detail에서 빌드 진행 상황 확인
# - Running 상태 도달까지 대기 (30-60초)

# 3. Watcher 모니터링
# - "Open Watcher" 버튼 클릭
# - Status Card에서 uptime 확인
# - Log Viewer에서 Counter 로그 실시간 확인

# 4. 메시지 전송 테스트
# - Command Panel에서 "status" 입력 후 Send
# - Docker 로그에서 응답 확인
```

### 시나리오 2: 여러 프로그램 동시 관리

```bash
# 1. 여러 프로그램 배포
for i in {1..3}; do
  python3 << EOF
import requests
# ... (배포 코드 반복)
EOF
done

# 2. Dashboard에서 전체 확인
# - 3개 프로그램 모두 목록에 표시
# - 각 프로그램 상태 실시간 모니터링

# 3. 개별 제어
# - 특정 프로그램 Stop
# - 다른 프로그램은 계속 실행
# - Restart로 재시작

# 4. 필터링 및 검색
# - State 필터로 "Running"만 표시
# - User ID로 검색
```

### 시나리오 3: 오류 처리 및 재배포

```bash
# 1. 의도적으로 잘못된 Dockerfile 배포
# (go.sum 누락 등)

# 2. Error 상태 확인
# - Dashboard에서 빨간색 Error 상태 확인
# - Program Detail에서 에러 메시지 확인

# 3. 프로그램 삭제
# - "Delete" 버튼 클릭
# - 확인 후 삭제

# 4. 수정 후 재배포
# - go.sum 포함하여 재배포
# - 정상 빌드 및 실행 확인
```

## 📈 성능 및 제한사항

### 폴링 전략
- **Dashboard**: 5초 (프로그램 목록)
- **Program Detail**: 5초 (단일 프로그램 상태)
- **Watcher Page**: 2초 (Status, Signals, Logs)

### 동시 프로그램 지원
- 테스트 완료: 6개 동시 프로그램 안정 실행
- 권장: 10개 이하
- 포트 범위: 19001-29999 (총 11,000개 가능)

### 브라우저 요구사항
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- JavaScript 필수

## 🔧 트러블슈팅

### UI가 로드되지 않음
```bash
# 1. Host 서버 실행 확인
curl http://localhost:9000/programs

# 2. 빌드 파일 확인
ls -la /home/rlaaudgjs5638/hersh/host/api/web/dist/

# 3. 서버 재시작
pkill host-server
./host-server
```

### 프로그램이 Building 상태에서 멈춤
```bash
# 1. Host 로그 확인
tail -50 /tmp/host-server.log

# 2. Docker 빌드 로그 확인
docker images | grep build-

# 3. 디스크 공간 확인
df -h
```

### WatcherAPI 접근 불가
```bash
# 1. 프로그램 상태 확인 (Running이어야 함)
curl -s http://localhost:9000/programs/$PROG_ID | jq '.state'

# 2. Proxy URL 확인
curl -s http://localhost:9000/programs/$PROG_ID | jq '.proxy_url'

# 3. 컨테이너 실행 확인
docker ps | grep $CONTAINER_ID
```

## 🎓 추가 학습 자료

- **DEPLOYMENT_GUIDE.md**: Host API 상세 명세
- **WEB_UI_GUIDE.md**: 기술 문서 및 아키텍처
- **TEST_REPORT_PHASE7-11.md**: 통합 테스트 결과
- **examples/**: 다양한 예제 프로그램

## 📝 요약

**Web UI 접속**: `http://localhost:9000/ui/programs`

**주요 기능**:
✅ 프로그램 생성 및 배포 (Web UI 또는 API)
✅ 실시간 상태 모니터링 (Dashboard)
✅ 생명주기 제어 (Start/Stop/Restart/Delete)
✅ Watcher 모니터링 (Status/Signals/Logs)
✅ WatcherAPI 메시지 전송

**성공 기준**:
- ✅ 프로그램 생성 완료
- ✅ Building → Running 상태 전환 성공
- ✅ Counter 로그 실시간 출력 확인
- ✅ WatcherAPI 메시지 전송/수신 성공

**현재 실행 중인 데모**:
- Program ID: `ui-demo-user-build-ec5a5a719102-29ac62f5`
- Proxy URL: `http://localhost:19002`
- Container: `1c6770a6aaff`
- State: ✅ Running
- Counter: 매초 증가 중

🎉 **Host Web UI 실습 완료!**
