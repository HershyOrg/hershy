# Front AI Provider Guide

`front` 자립 서버(`frontend/front`)에서 AI provider를 설정하고,
3계층 AI(`오케스트레이션 -> 리서치 -> 전략`)로 전략 초안을 생성하는 방법입니다.

## 1. 책임 분리 구조

- Front server (`:9090`):
  - AI orchestration draft (`/api/ai/strategy-draft`)
  - AI orchestration (`/api/ai/orchestrate-strategy`)
  - AI research worker (`/api/ai/research`)
  - AI strategy worker (`/api/ai/strategy-compose`)
  - Host API 프록시 (`/api/host/*`)
  - 전략 UI 제공
- Host server (`:9000`):
  - 프로그램 생성/시작/중지/프록시 등 런타임 API
  - AI provider 직접 호출 책임 없음

즉, AI 관련 환경변수는 `host`가 아니라 **front 서버 프로세스 환경**에 설정해야 합니다.

## 2. 엔드포인트

Front AI draft endpoint (호환 유지, 내부는 오케스트레이션 파이프라인):
- `POST http://localhost:9090/api/ai/strategy-draft`

Front AI orchestration endpoint:
- `POST http://localhost:9090/api/ai/orchestrate-strategy`

Front AI research endpoint:
- `POST http://localhost:9090/api/ai/research`

Front AI strategy compose endpoint:
- `POST http://localhost:9090/api/ai/strategy-compose`

Front Host proxy endpoint:
- `http://localhost:9090/api/host/*` -> `http://localhost:9000/*` (기본)

Front runtime config endpoint:
- `GET http://localhost:9090/api/config`

## 3. Provider 선택 규칙

`AI_PROVIDER`를 우선 사용합니다.

- `AI_PROVIDER=ollama|local|oss` -> `ollama`
- `AI_PROVIDER=google|gemini|gemini-api` -> `gemini`
- `AI_PROVIDER=openai` -> `openai`

`AI_PROVIDER`가 비어 있으면 자동 선택:

1. `OLLAMA_BASE_URL` 또는 `OLLAMA_MODEL`이 있으면 `ollama`
2. `GOOGLE_API_KEY` 또는 `GEMINI_API_KEY`가 있으면 `gemini`
3. `OPENAI_API_KEY`가 있으면 `openai`
4. 모두 없으면 `ollama`

레이어별 provider를 분리하려면 다음을 우선 사용합니다.

- `AI_ORCHESTRATOR_PROVIDER`
- `AI_RESEARCH_PROVIDER`
- `AI_STRATEGY_PROVIDER`

예: 오케스트레이터는 `openai`, 리서치는 `gemini`, 전략 생성은 `ollama`

## 4. 환경 변수

### Front 서버 공통

- `HOST_API_BASE` (기본: `http://localhost:9000`)
- `FRONT_PORT` (기본: `9090`)
- `AI_PROVIDER` (선택)
- 레이어별 override (선택):
  - `AI_ORCHESTRATOR_PROVIDER`
  - `AI_RESEARCH_PROVIDER`
  - `AI_STRATEGY_PROVIDER`
  - `AI_ORCHESTRATOR_MODEL`
  - `AI_RESEARCH_MODEL`
  - `AI_STRATEGY_MODEL`
  - `AI_ORCHESTRATOR_TIMEOUT_SEC`
  - `AI_RESEARCH_TIMEOUT_SEC`
  - `AI_STRATEGY_TIMEOUT_SEC`

### Ollama

- `OLLAMA_BASE_URL` (기본: `http://localhost:11434`)
- `OLLAMA_ENDPOINT` (기본: `${OLLAMA_BASE_URL}/api/chat`)
- `OLLAMA_MODEL` (기본: `gpt-oss:20b`)
- `OLLAMA_WIRE_API` (`ollama` 또는 `openai`)
- `OLLAMA_API_KEY` (선택)
- `OLLAMA_TIMEOUT_SEC` (기본: `180`)
- 레이어별 override (선택):
  - `AI_ORCHESTRATOR_OLLAMA_MODEL`, `AI_RESEARCH_OLLAMA_MODEL`, `AI_STRATEGY_OLLAMA_MODEL`
  - `AI_ORCHESTRATOR_OLLAMA_ENDPOINT`, `AI_RESEARCH_OLLAMA_ENDPOINT`, `AI_STRATEGY_OLLAMA_ENDPOINT`
  - `AI_ORCHESTRATOR_OLLAMA_API_KEY` 등

### Gemini

- `GOOGLE_API_KEY` 또는 `GEMINI_API_KEY` (필수)
- `GEMINI_MODEL` (기본: `gemini-2.0-flash`)
- `GEMINI_BASE_URL` (기본: `https://generativelanguage.googleapis.com/v1beta`)
- `GEMINI_ENDPOINT` (선택)
- `GEMINI_TIMEOUT_SEC` (기본: `45`)
- 레이어별 override (선택):
  - `AI_ORCHESTRATOR_GEMINI_MODEL`, `AI_RESEARCH_GEMINI_MODEL`, `AI_STRATEGY_GEMINI_MODEL`
  - `AI_ORCHESTRATOR_GEMINI_ENDPOINT`, `AI_RESEARCH_GEMINI_ENDPOINT`, `AI_STRATEGY_GEMINI_ENDPOINT`
  - `AI_ORCHESTRATOR_GEMINI_API_KEY`/`AI_ORCHESTRATOR_GOOGLE_API_KEY` 등

### OpenAI

- `OPENAI_API_KEY` (필수)
- `OPENAI_MODEL` (기본: `gpt-4o-mini`)
- `OPENAI_BASE_URL` (기본: `https://api.openai.com/v1`)
- `OPENAI_CHAT_ENDPOINT` (기본: `${OPENAI_BASE_URL}/chat/completions`)
- `OPENAI_TIMEOUT_SEC` (기본: `35`)
- 레이어별 override (선택):
  - `AI_ORCHESTRATOR_OPENAI_MODEL`, `AI_RESEARCH_OPENAI_MODEL`, `AI_STRATEGY_OPENAI_MODEL`
  - `AI_ORCHESTRATOR_OPENAI_CHAT_ENDPOINT` 등
  - `AI_ORCHESTRATOR_OPENAI_API_KEY` 등

## 5. 실행 방법

### 5.1 Host 서버 실행 (`:9000`)

```bash
cd host
go run cmd/main.go
```

### 5.2 Front 서버 실행 (`:9090`)

```bash
cd frontend/front
export HOST_API_BASE=http://localhost:9000
# Provider 예시
export AI_PROVIDER=openai
export OPENAI_API_KEY=your_openai_api_key

npm install
npm run dev
```

접속:
- `http://localhost:9090`

## 6. API 예시

```bash
curl -sS -X POST http://localhost:9090/api/ai/strategy-draft \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt":"BTCUSDT 1시간 돌파 매수/이탈 매도 전략 생성",
    "response_format":"hershy-strategy-graph"
  }' | jq
```

성공 응답 예시:

```json
{
  "strategy": {
    "kind": "hershy-strategy-graph"
  },
  "research": {
    "summary": {
      "contracts": 1,
      "verifiedContracts": 1
    }
  },
  "orchestration": {
    "mode": "research_then_strategy"
  },
  "source": "orchestrated-ai-pipeline",
  "models": {
    "orchestrator": "gpt-4o-mini",
    "research": "gpt-4o-mini",
    "strategy": "gpt-4o-mini"
  },
  "message": "AI strategy draft generated (orchestrated)"
}
```

## 7. 상태 코드

- `400`: 잘못된 요청 / provider 설정 오류
- `401`: provider 인증 오류
- `429`: provider rate limit
- `502`: upstream 연결 실패/타임아웃/기타 provider 오류

## 8. 체크리스트

1. `host`는 `:9000`, `front`는 `:9090`에서 실행 중인지 확인
2. AI 키는 front 서버 프로세스 환경에 설정했는지 확인
3. `GET /api/config`로 front의 host 타깃 확인
4. `POST /api/ai/strategy-draft` 직접 호출로 오케스트레이션 응답 확인
