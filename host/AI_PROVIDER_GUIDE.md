# Host AI Provider Guide

Host의 `/ai/strategy-draft` 엔드포인트에서 사용할 AI provider 설정 및 사용 방법입니다.

## 1. Provider 선택 규칙

`AI_PROVIDER` 값을 먼저 확인합니다.

- `AI_PROVIDER=ollama|local|oss` -> `ollama`
- `AI_PROVIDER=google|gemini|gemini-api` -> `gemini`
- `AI_PROVIDER=openai` -> `openai`
- 그 외 값 -> 요청 시 `unsupported AI_PROVIDER` 에러

`AI_PROVIDER`가 비어 있으면 아래 순서로 자동 선택됩니다.

1. `OLLAMA_BASE_URL` 또는 `OLLAMA_MODEL`이 설정되어 있으면 `ollama`
2. `GOOGLE_API_KEY` 또는 `GEMINI_API_KEY`가 설정되어 있으면 `gemini`
3. `OPENAI_API_KEY`가 설정되어 있으면 `openai`
4. 아무것도 없으면 기본값 `ollama`

## 2. 환경 변수

### 공통

- `AI_PROVIDER`: 사용할 provider 강제 지정

### Ollama

- `OLLAMA_BASE_URL` (기본: `http://localhost:11434`)
- `OLLAMA_ENDPOINT` (기본: `${OLLAMA_BASE_URL}/api/chat`)
- `OLLAMA_MODEL` (기본: `gpt-oss:20b`)
- `OLLAMA_WIRE_API` (`ollama` 또는 `openai`)
- `OLLAMA_API_KEY` (선택)
- `OLLAMA_TIMEOUT_SEC` (기본: `180`)

참고:
- `OLLAMA_WIRE_API`를 비우면 `OLLAMA_ENDPOINT`에 `/v1/`가 포함될 때 `openai`, 아니면 `ollama` 포맷을 사용합니다.

### Gemini

- `GOOGLE_API_KEY` 또는 `GEMINI_API_KEY` (둘 중 하나 필수)
- `GEMINI_MODEL` (기본: `gemini-2.0-flash`)
- `GEMINI_BASE_URL` (기본: `https://generativelanguage.googleapis.com/v1beta`)
- `GEMINI_ENDPOINT` (기본: 모델 기반 `generateContent` URL 자동 생성)
- `GEMINI_TIMEOUT_SEC` (기본: `45`)

### OpenAI

- `OPENAI_API_KEY` (필수)
- `OPENAI_MODEL` (기본: `gpt-4o-mini`)
- `OPENAI_BASE_URL` (기본: `https://api.openai.com/v1`)
- `OPENAI_CHAT_ENDPOINT` (기본: `${OPENAI_BASE_URL}/chat/completions`)
- `OPENAI_TIMEOUT_SEC` (기본: `35`)

## 3. 빠른 설정 예시

Host 서버 실행 전에 provider를 설정합니다.

### 3.1 Ollama

```bash
export AI_PROVIDER=ollama
export OLLAMA_BASE_URL=http://localhost:11434
export OLLAMA_MODEL=gpt-oss:20b

cd host
go run cmd/main.go
```

### 3.2 Gemini

```bash
export AI_PROVIDER=gemini
export GOOGLE_API_KEY=your_google_api_key
export GEMINI_MODEL=gemini-2.0-flash

cd host
go run cmd/main.go
```

### 3.3 OpenAI

```bash
export AI_PROVIDER=openai
export OPENAI_API_KEY=your_openai_api_key
export OPENAI_MODEL=gpt-4o-mini

cd host
go run cmd/main.go
```

## 4. API 사용법

엔드포인트:
- `POST /ai/strategy-draft`

요청 바디:

```json
{
  "prompt": "BTCUSDT 1시간 돌파 매수/이탈 매도 전략 만들어줘",
  "current_strategy": {
    "kind": "hershy-strategy-graph"
  },
  "response_format": "hershy-strategy-graph"
}
```

- `prompt`는 필수
- `current_strategy`, `response_format`은 선택

응답 예시:

```json
{
  "strategy": {
    "kind": "hershy-strategy-graph"
  },
  "source": "openai-chat-completions",
  "model": "gpt-4o-mini",
  "message": "AI strategy draft generated"
}
```

`source` 값:
- `ollama-chat`
- `google-gemini-generate-content`
- `openai-chat-completions`

### curl 예시

```bash
curl -sS -X POST http://localhost:9000/ai/strategy-draft \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt":"BTCUSDT 1시간 전략 생성",
    "response_format":"hershy-strategy-graph"
  }' | jq
```

## 5. 프론트엔드에서 사용

`BackendTab`의 AI 전략 기능은 Host API의 `/ai/strategy-draft`를 우선 호출합니다.

- 호출 성공: 원격 AI 결과를 전략 그래프로 반영
- 호출 실패: 프론트의 로컬 규칙 기반 생성으로 자동 대체

Host Base URL은 UI에서 입력한 값이 사용됩니다.

## 6. 에러 및 상태 코드

- `405`: POST 이외 메서드 호출
- `400`: 잘못된 요청 바디, `prompt` 누락, provider 설정 오류
- `401`: upstream provider 인증/권한 오류(401/403 매핑)
- `429`: upstream rate limit
- `502`: upstream 연결 실패, 타임아웃, 기타 provider 오류

## 7. 점검 체크리스트

1. Host 서버가 `:9000`에서 실행 중인지 확인
2. 선택한 provider의 필수 키/엔드포인트가 설정되었는지 확인
3. `curl`로 `/ai/strategy-draft` 직접 호출해 `source`, `model` 확인
4. 브라우저에서 Host API 호출 시 CORS/프리플라이트가 통과되는지 확인
