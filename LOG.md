# Hershy 로그 정리

## 요약

- Host 서버 로그 (plain text): `{storageRoot}/logs/host.log`
  - `effect.log` — Effect 관련 JSONL 로그
  - `host.log` - Host 서버 관련 JSONL 로그
- 프로그램별 로그 (JSONL): `{storageRoot}/programs/{program_id}/logs/`
  - `build.log` — Docker build 출력
  - `runtime.log` — Program 로그 = Docker stdout, stderr 관련 로그
  - TODO 두 로그 또한 JSONL 스키마로 변경할 예정
    기본 `storageRoot`는 `./host-storage` (main.go 기본값).

---

## 파일 위치 예시

- Host 로그:
  - `./host-storage/logs/host.log`
    `./host-storage/logs/effect.log`
- 프로그램 로그 예시 (프로그램 ID: `ID`):
  - `./host-storage/programs/ID/logs/build.log`
  - `./host-storage/programs/ID/logs/runtime.log`

---

## 로그 포맷

### 프로그램별 로그 (JSONL)

- 각 줄이 하나의 JSON 객체(JSONL)
- 스키마 (IHershyLog, 주요 필드)

```json
{
  "ts": "2026-02-27T11:32:25.000000000Z",
  "level": "INFO",
  "log_type": "EFFECT",
  "component": "RealEffectHandler",
  "msg": "container started",
  "program_id": "test-user-...",
  "duration_ms": 170,
  "vars": { "container_id": "67b0c3f95152" },
  "meta": { "file_path": "..." }
}
```

- `log_type` 예: EVENT, WATCH, EFFECT, REDUCE, STATE, CONTEXT, BUILD, HOST
- `level` 예: DEBUG, INFO, WARN, ERROR, FATAL

확인(파싱):

```bash
tail -n 200 ./host-storage/programs/ID/logs/runtime.log | jq -c '.'
```

---

## logger 패키지 동작 요약

- `logger.New(component, out, filePath)`:
  - `filePath`가 주어지면 파일에만 기록(콘솔 출력 차단).
  - `filePath` 실패 시 `out`으로 폴백.
  - `filePath`를 빈 문자열로 주면 `out`으로 기록(보통 `os.Stdout`).
- `Logger.Log(LogEntry)`:
  - `LogEntry`를 `json.Marshal`하여 한 줄(JSONL)로 기록.
- `Logger.Close()`:
  - 파일 핸들 닫기.

로그 파일만 남기고 콘솔 출력을 원치 않으면:

```go
lg := logger.New("Comp", io.Discard, "./host-storage/programs/ID/logs/effect.log")
defer lg.Close()
```

---
