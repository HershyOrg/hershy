# Front Standalone Server

`frontend/front`는 Host와 분리된 자립형 서버로 동작합니다.

## Runtime Roles

- Front (`:9090`)
  - 전략 캔버스 UI
  - AI draft endpoint: `/api/ai/strategy-draft`
  - Host proxy endpoint: `/api/host/*`
- Host (`:9000`)
  - 프로그램 생성/실행/중지/Watcher 프록시

## Commands

```bash
cd frontend/front
npm install
cp .env.example .env
```

개발 모드 (권장):

```bash
HOST_API_BASE=http://localhost:9000 npm run dev
```

프로덕션 빌드:

```bash
npm run build
HOST_API_BASE=http://localhost:9000 npm run start
```

접속 URL:
- `http://localhost:9090`

## Key Environment Variables

- `HOST_API_BASE` (default: `http://localhost:9000`)
- `FRONT_PORT` (default: `9090`)
- `AI_PROVIDER` (`ollama`, `gemini`, `openai`)
- `OPENAI_API_KEY`, `GOOGLE_API_KEY`/`GEMINI_API_KEY`, `OLLAMA_*`

세부 provider 설정은 `host/AI_PROVIDER_GUIDE.md` 참고.
