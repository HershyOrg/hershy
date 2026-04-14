# Hershy 로그 정리

## 요약

- Host 서버 로그 (plain text): `{storageRoot}/logs/host.log`
  - `effect.log` — Effect 관련 JSONL 로그
  - `host.log` - Host 서버 관련 JSONL 로그
- 프로그램별 persisted logs: `{storageRoot}/programs/{program_id}/logs/`
  - `build.log` — Docker build 출력
  - `runtime.log` — persisted runtime stream
    Docker stdout/stderr를 Vector 수집용으로 slim하게 append 저장
  - `timeline.json` — 전략 AI 피드백용 구조화 상태
    기본적으로 `{storageRoot}/programs/{program_id}/state/debug/timeline.json`
    Vector 기본 설정에서는 수집 대상이 아님
    기본 `storageRoot`는 `./host-storage` (main.go 기본값).

---

## 파일 위치 예시

- Host 로그:
  - `./host-storage/logs/host.log`
    `./host-storage/logs/effect.log`
- 프로그램 로그 예시 (프로그램 ID: `ID`):
  - `./host-storage/programs/ID/logs/build.log`
  - `./host-storage/programs/ID/logs/runtime.log`
  - `./host-storage/programs/ID/state/debug/timeline.json`

---

## 로그 포맷

### 프로그램별 로그

- `build.log`는 Docker build 출력 저장
- `runtime.log`는 `stdout/stderr`를 `[stdout] ...`, `[stderr] ...` 형식으로 append 저장
- `timeline.json`은 전략 디버그 핵심 이벤트만 구조화 저장

확인(파싱):

```bash
tail -n 200 ./host-storage/programs/ID/logs/build.log
tail -n 200 ./host-storage/programs/ID/logs/runtime.log
```

런타임 로그 확인:

```bash
curl http://localhost:9000/programs/ID/logs | jq -r '.logs'
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
