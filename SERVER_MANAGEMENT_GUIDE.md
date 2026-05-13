# 서버관리 지침서

작성일: 2026-05-07 21:16 KST  
대상 장비: `Hongraeui-MacBookPro.local`  
대상 저장소: `/Users/hongraecho/hershy/code/hershy`

이 문서는 현재 컴퓨터에서 실제로 확인한 서버, 포트, 런타임, 저장소, 자동 시작 항목, 운영 절차를 새 서버관리자에게 인수인계하기 위한 문서다. 비밀값은 의도적으로 적지 않았다. 개인키, API 토큰, 지갑 키, ngrok 토큰은 파일 위치와 관리 절차만 기록한다.

## 목차

1. [핵심 요약](#1-핵심-요약)
2. [시스템 개요](#2-시스템-개요)
3. [네트워크와 포트](#3-네트워크와-포트)
4. [자동 시작 서비스](#4-자동-시작-서비스)
5. [주요 서버 서비스 운영](#5-주요-서버-서비스-운영)
6. [Hershy 프로젝트 운영](#6-hershy-프로젝트-운영)
7. [Docker 운영](#7-docker-운영)
8. [런타임과 개발 도구](#8-런타임과-개발-도구)
9. [데이터, 로그, 백업](#9-데이터-로그-백업)
10. [보안 관리](#10-보안-관리)
11. [정기 점검 체크리스트](#11-정기-점검-체크리스트)
12. [장애 대응](#12-장애-대응)
13. [인수인계 체크리스트](#13-인수인계-체크리스트)
14. [참고 명령 모음](#14-참고-명령-모음)

## 1. 핵심 요약

현재 이 컴퓨터는 일반적인 원격 Linux 서버가 아니라 macOS 개발 장비 위에서 여러 로컬 서버 프로세스를 실행하는 형태다. 외부 공개 서비스는 확인되지 않았고, 실제 핵심 서비스는 대부분 `127.0.0.1`에 묶여 있다.

현재 실행 중인 핵심 서버성 서비스:

| 서비스 | 상태 | 포트 | 바인드 | 자동 시작 | 관리 방식 |
|---|---:|---:|---|---|---|
| Jenkins LTS | 실행 중 | `8080` | `127.0.0.1` | 예 | Homebrew LaunchAgent |
| OpenClaw Gateway | 실행 중 | `18789`, `18791`, `18792` | `127.0.0.1`, `::1` | 예 | user LaunchAgent |
| Docker Desktop | 실행 중 | 내부 VM | 로컬 | 예/앱 상태 의존 | Docker Desktop |
| Hershy Host API | 미실행 | 기본 `9000` | 기본 `127.0.0.1` | 아니오 | 수동 실행 |
| Front standalone UI | 미실행 | 기본 `9090` | 로컬 | 아니오 | 수동 실행 |
| ACP Seller agent | 미실행 | 설정 의존 | 로컬 | 아니오 | 수동 실행 또는 ops 예시 |

주의할 점:

- `docker-compose.yml`은 현재 루트 `.env` 문법 오류 때문에 바로 실행되지 않는다.
- 루트 compose의 `monitor` 서비스는 `8080:8080`을 사용하므로 현재 Jenkins의 `127.0.0.1:8080`과 충돌할 수 있다.
- `runsc`/gVisor는 설치되어 있지 않다. 현재 Docker 런타임은 `runc`만 확인된다.
- macOS 방화벽과 FileVault가 꺼져 있다. 장비를 운영 용도로 인수한다면 우선 보안 정책을 정해야 한다.
- 저장소는 `codex/main-front-upgrade` 브랜치이며 원격보다 6커밋 앞서 있다. 추적되지 않은 디렉터리도 있다.

## 2. 시스템 개요

### 2.1 장비 정보

| 항목 | 값 |
|---|---|
| OS | macOS 14.7.1, Darwin 23.6.0 |
| 모델 | `Mac15,3` |
| CPU | Apple M3 |
| 메모리 | 8 GiB |
| 아키텍처 | `arm64` |
| 사용자 | `hongraecho` |
| 사용자 권한 | `admin`, `_developer`, `access_ssh`, `access_screensharing` 그룹 포함 |
| 호스트명 | `Hongraeui-MacBookPro.local` |
| 로컬 호스트명 | `Hongraeui-MacBookPro` |
| 컴퓨터 이름 | `Hongrae의 MacBook Pro` |
| 부팅 시각 | 2026-04-29 18:12:11 KST |
| 조사 시점 uptime | 약 8일 |
| 시간대 | Asia/Seoul, KST |

### 2.2 디스크 상태

| 마운트 | 용량 | 사용 | 여유 | 사용률 |
|---|---:|---:|---:|---:|
| `/` | 460 GiB | 12 GiB | 88 GiB | 13% |
| `/System/Volumes/Data` | 460 GiB | 340 GiB | 88 GiB | 80% |

운영 기준으로 `/System/Volumes/Data` 사용률이 80%라 여유가 넉넉하지 않다. Docker 이미지와 개발 산출물이 주요 정리 후보이다.

주요 디렉터리 사용량:

| 경로 | 크기 | 비고 |
|---|---:|---|
| `/Users/hongraecho/hershy/code/hershy` | 2.2 GiB | 현재 작업 저장소 |
| `frontend/` | 445 MiB | 프론트 관련 산출물 포함 |
| `host/` | 262 MiB | Host 코드와 `node_modules`, `host-storage` 포함 |
| `acp-agent/` | 198 MiB | `node_modules` 포함 |
| `ui/` | 132 MiB | nested shadcn-ui repo |
| Docker Desktop data | 16 GiB | `/Users/hongraecho/Library/Containers/com.docker.docker` |
| Jenkins home | 108 MiB | `/Users/hongraecho/.jenkins` |
| OpenClaw home | 964 KiB | `/Users/hongraecho/.openclaw` |

## 3. 네트워크와 포트

### 3.1 네트워크 인터페이스

활성 기본 인터페이스:

| 인터페이스 | 상태 | IP | 게이트웨이 |
|---|---|---|---|
| `en0` | active | `172.30.1.85/24` | `172.30.1.254` |

기본 라우트는 `en0`을 통해 `172.30.1.254`로 나간다. `utun0`부터 `utun3`까지 터널 인터페이스도 활성화되어 있으나 구체적인 VPN 제품명은 이번 조사에서 확정하지 않았다.

### 3.2 현재 LISTEN 포트

조사 명령: `lsof -nP -iTCP -sTCP:LISTEN`

| 프로세스 | 포트 | 바인드 | 판단 |
|---|---:|---|---|
| `java` | `8080` | `127.0.0.1` | Jenkins LTS |
| `node` / `openclaw-gateway` | `18789` | `127.0.0.1`, `::1` | OpenClaw Gateway/Control UI |
| `node` / `openclaw-gateway` | `18791`, `18792` | `127.0.0.1` | OpenClaw browser/control 보조 포트 |
| `rapportd` | `56717` | `*` | Apple Continuity/Rapport 계열 |
| `Control Center` | `5000`, `7000` | `*` | macOS Control Center 계열 |
| `Discord` | `6463` | `127.0.0.1` | Discord local IPC |
| `Code Helper` | `59644` | `127.0.0.1` | VS Code/ChatGPT extension local |
| `figma_agent` | `44950`, `44960` | `127.0.0.1` | Figma agent |

확인 결과:

- SSH `22` 포트는 LISTEN 상태가 아니다.
- VNC/Screen Sharing 기본 포트 `5900`도 LISTEN 상태가 아니다.
- Hershy Host API 기본 포트 `9000`은 현재 LISTEN 상태가 아니다.
- Front standalone 기본 포트 `9090`도 현재 LISTEN 상태가 아니다.

### 3.3 포트 충돌 주의

`8080`은 Jenkins가 이미 사용 중이다. 아래 항목도 `8080`을 사용한다.

- `monitor/main.go`: API 서버 `:8080`
- 루트 `docker-compose.yml`의 `monitor`: `"8080:8080"`
- Hershy 프로그램 내부 WatcherAPI: 컨테이너 내부 `8080`, Host proxy가 `19001-29999` 범위로 localhost publish

루트 compose stack을 올릴 때는 Jenkins를 내리거나 `monitor`의 host port를 바꿔야 한다.

## 4. 자동 시작 서비스

### 4.1 Homebrew services

현재 `brew services list` 결과:

| 서비스 | 상태 | 사용자 | plist |
|---|---|---|---|
| `jenkins-lts` | started | `hongraecho` | `~/Library/LaunchAgents/homebrew.mxcl.jenkins-lts.plist` |
| `dbus` | none | - | - |

### 4.2 사용자 LaunchAgents

주요 항목:

| Label | plist | 상태 |
|---|---|---|
| `homebrew.mxcl.jenkins-lts` | `/Users/hongraecho/Library/LaunchAgents/homebrew.mxcl.jenkins-lts.plist` | running |
| `ai.openclaw.gateway` | `/Users/hongraecho/Library/LaunchAgents/ai.openclaw.gateway.plist` | running |
| Google updater, Steam cleaner 등 | `~/Library/LaunchAgents/` | 운영 핵심 아님 |

### 4.3 시스템 LaunchDaemons

`/Library/LaunchDaemons`에서 확인한 주요 항목:

| plist | 비고 |
|---|---|
| `com.docker.socket.plist` | Docker Desktop helper |
| `com.docker.vmnetd.plist` | Docker Desktop networking helper |
| `com.interezen.nwsdaemon.plist` | 외부 보안/네트워크 계열로 보임, 별도 확인 필요 |
| `us.zoom.ZoomDaemon.plist` | Zoom daemon |

### 4.4 Cron

사용자 crontab은 없다.

```bash
crontab -l
# crontab: no crontab for hongraecho
```

프로젝트 내부에는 Docker 컨테이너용 cron 설정이 있다.

- `monitor/cron/jobs.crontab`
- 실행 주기: 15분마다 `/app/cron`

## 5. 주요 서버 서비스 운영

### 5.1 Jenkins LTS

현재 상태:

| 항목 | 값 |
|---|---|
| 상태 | 실행 중 |
| URL | `http://127.0.0.1:8080` |
| 버전 | Jenkins `2.528.3` |
| 설치 경로 | `/opt/homebrew/Cellar/jenkins-lts/2.528.3` |
| WAR | `/opt/homebrew/opt/jenkins-lts/libexec/jenkins.war` |
| Java | `/opt/homebrew/opt/openjdk@21/bin/java` |
| Java 버전 | OpenJDK `21.0.9` |
| Jenkins home | `/Users/hongraecho/.jenkins` |
| LaunchAgent | `/Users/hongraecho/Library/LaunchAgents/homebrew.mxcl.jenkins-lts.plist` |

실행 명령은 LaunchAgent 기준으로 다음과 같다.

```bash
/opt/homebrew/opt/openjdk@21/bin/java \
  -Dmail.smtp.starttls.enable=true \
  -jar /opt/homebrew/opt/jenkins-lts/libexec/jenkins.war \
  --httpListenAddress=127.0.0.1 \
  --httpPort=8080
```

관리 명령:

```bash
brew services list
brew services restart jenkins-lts
brew services stop jenkins-lts
brew services start jenkins-lts
```

상태 확인:

```bash
curl -I http://127.0.0.1:8080
```

인증이 없으면 `403 Forbidden`이 나오는 것은 정상이다. 응답 헤더에 `X-Jenkins: 2.528.3`이 확인된다.

Jenkins 데이터:

- `/Users/hongraecho/.jenkins/config.xml`
- `/Users/hongraecho/.jenkins/users/`
- `/Users/hongraecho/.jenkins/secrets/`
- `/Users/hongraecho/.jenkins/secret.key`

조사 시점에는 `~/.jenkins/jobs` 아래 job config가 없고, `~/.jenkins/plugins`에 plugin 파일도 없다. 즉 현재 Jenkins는 설치와 admin 사용자만 있는 초기 상태에 가깝다.

주의:

- Homebrew 기준으로 설치 버전보다 새 stable 버전이 있다고 표시된다. 업그레이드 전에는 반드시 `~/.jenkins`를 백업하고, LTS 릴리스 노트를 확인한 뒤 진행한다.
- 기본 `java` 명령은 PATH에서 Java runtime을 찾지 못했다. Jenkins는 Homebrew OpenJDK 경로를 직접 사용하므로 운영 명령에서도 이 경로를 사용한다.

백업:

```bash
tar -czf ~/jenkins-home-$(date +%Y%m%d-%H%M%S).tar.gz -C /Users/hongraecho .jenkins
```

### 5.2 OpenClaw Gateway

현재 상태:

| 항목 | 값 |
|---|---|
| 상태 | 실행 중 |
| 버전 | `2026.3.2` |
| Node | `/Users/hongraecho/.nvm/versions/node/v23.9.0/bin/node` |
| CLI | `/Users/hongraecho/.nvm/versions/node/v23.9.0/bin/openclaw` |
| Gateway port | `18789` |
| Browser/control ports | `18791`, `18792` |
| LaunchAgent | `/Users/hongraecho/Library/LaunchAgents/ai.openclaw.gateway.plist` |
| stdout log | `/Users/hongraecho/.openclaw/logs/gateway.log` |
| stderr log | `/Users/hongraecho/.openclaw/logs/gateway.err.log` |

실행 명령:

```bash
/Users/hongraecho/.nvm/versions/node/v23.9.0/bin/node \
  /Users/hongraecho/.nvm/versions/node/v23.9.0/lib/node_modules/openclaw/dist/index.js \
  gateway --port 18789
```

LaunchAgent에는 `OPENCLAW_GATEWAY_TOKEN`이 들어 있다. 문서에는 값을 기록하지 않는다. 새 관리자에게 장비를 넘길 때는 이 토큰을 새 값으로 교체하거나 OpenClaw를 재설치해 토큰을 재발급하는 것을 권장한다.

관리 명령:

```bash
launchctl print gui/$(id -u)/ai.openclaw.gateway
launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway
launchctl bootout gui/$(id -u) /Users/hongraecho/Library/LaunchAgents/ai.openclaw.gateway.plist
launchctl bootstrap gui/$(id -u) /Users/hongraecho/Library/LaunchAgents/ai.openclaw.gateway.plist
```

상태 확인:

```bash
lsof -nP -p $(pgrep -f openclaw-gateway) -a -iTCP
curl -sS http://127.0.0.1:18789/health
tail -n 80 /Users/hongraecho/.openclaw/logs/gateway.log
tail -n 80 /Users/hongraecho/.openclaw/logs/gateway.err.log
```

조사 시점 로그상 주의 사항:

- 최신 OpenClaw 버전 알림이 계속 기록된다.
- 과거에 gateway token mismatch로 인한 unauthorized WebSocket 로그가 반복된 이력이 있다.
- mDNS/Bonjour 네트워크 인터페이스 변경 관련 경고가 있었다.

### 5.3 Docker Desktop

Docker Desktop은 실행 중이다. Docker CLI는 `/usr/local/bin/docker`에 있다.

상태 요약:

| 항목 | 값 |
|---|---|
| Docker version | `27.5.1` |
| Compose | `v2.32.4-desktop.1` |
| Context | `desktop-linux` |
| Docker OS | Linux VM, `aarch64` |
| Docker VM CPU | 8 |
| Docker VM memory | 약 4.1 GB |
| Runtime | `runc`, `io.containerd.runc.v2` |
| gVisor/runsc | 미설치 |

현재 컨테이너:

- 실행 중인 컨테이너 없음
- 종료된 컨테이너 1개: `hersh-program-ui-strategy-1-...`

Docker storage:

| 항목 | 값 |
|---|---:|
| Images | 52개, 15.37 GB |
| Active images | 1개 |
| Containers | 1개, 실행 중 0개 |
| Volumes | 1개, `jenkins_home`, 110.8 MB |
| Reclaimable | 이미지와 볼륨 대부분 회수 가능 |

운영 명령:

```bash
docker ps --all
docker images
docker volume ls
docker network ls
docker system df
docker context ls
```

정리 명령은 신중히 사용한다.

```bash
docker image prune
docker container prune
docker volume prune
docker system prune
```

`docker system prune -a --volumes`는 이미지와 볼륨을 광범위하게 삭제하므로, 현재 실행 중인 업무와 재빌드 비용을 확인한 뒤 사용한다.

## 6. Hershy 프로젝트 운영

### 6.1 저장소 상태

| 항목 | 값 |
|---|---|
| 경로 | `/Users/hongraecho/hershy/code/hershy` |
| Git remote | `https://github.com/HershyOrg/hershy.git` |
| 현재 브랜치 | `codex/main-front-upgrade` |
| 원격 대비 | `origin/main`보다 6커밋 앞섬 |
| 최근 커밋 | `e96887bd frontend: replace dummy stream previews with real sampling` |
| 루트 Go module | `github.com/HershyOrg/hershy` |
| Go version in module | `1.24.13` |

추적되지 않은 항목:

- `frontend/hershyV1.1/`
- `frontend/kest-ui-app/`
- `frontend/trading-orderbook-app/`
- `hersh/`

Nested git repository:

| 경로 | remote | 상태 |
|---|---|---|
| `ui/` | `https://github.com/shadcn-ui/ui.git` | `main...origin/main` |
| `hersh/` | `https://github.com/HershyOrg/hersh.git` | `main...origin/main`, untracked demo 디렉터리 존재 |

새 관리자는 루트 저장소의 미커밋/미추적 파일을 정리하기 전 반드시 기존 작업자의 의도를 확인해야 한다.

### 6.2 프로젝트 구성

주요 디렉터리:

| 경로 | 역할 |
|---|---|
| `program/` | 순수 상태 머신, reducer/effect/supervisor |
| `host/` | Docker 런타임 연동, Host API, proxy, storage |
| `host/api/web/` | Host 내장 Web UI, Vite/React |
| `examples/` | simple-counter, watcher-server, trading-long 등 샘플 프로그램 |
| `monitor/` | 시장 데이터 monitor API와 cron worker |
| `monitor/log/` | Loki/Grafana/watcher-poller monitoring stack |
| `acp-agent/` | Virtuals ACP Seller 연동 Node 런타임 |
| `frontend/front/` | 독립 실행형 strategy canvas/AI orchestration UI |
| `ui/` | shadcn-ui 기반 별도 nested repo |
| `cctx/`, `backtest/` | 거래/백테스트 관련 보조 코드 |

### 6.3 Host API 서버

Host API는 현재 실행 중이 아니다. 기본 소스는 `host/cmd/main.go`이다.

기본 설정:

| 항목 | 기본값 |
|---|---|
| bind | `127.0.0.1` |
| port | `9000` |
| storage | `./host-storage` |
| runtime | `runc` |
| vector compose | `./host/vector/docker-compose.yml` |
| API token | 옵션, `HERSHY_HOST_API_TOKEN` 또는 `-api-token` |
| proxy allowlist | 옵션, `HERSHY_PROXY_ALLOWLIST` 또는 `-proxy-allowlist` |

권장 수동 실행:

```bash
cd /Users/hongraecho/hershy/code/hershy/host
go run cmd/main.go \
  -bind 127.0.0.1 \
  -port 9000 \
  -storage ./host-storage \
  -runtime runc
```

토큰을 사용하는 실행:

```bash
cd /Users/hongraecho/hershy/code/hershy/host
HERSHY_HOST_API_TOKEN='<long-random-token>' \
HERSHY_PROXY_ALLOWLIST='/watcher/watching-state,/watcher/varState/*' \
go run cmd/main.go \
  -bind 127.0.0.1 \
  -port 9000 \
  -storage ./host-storage \
  -runtime runc \
  -api-token '<long-random-token>'
```

주의:

- `go run cmd/main.go`를 어느 디렉터리에서 실행하느냐에 따라 상대 경로 `./host-storage` 위치가 달라진다.
- 기존 데이터는 `/Users/hongraecho/hershy/code/hershy/host/host-storage`에 있다.
- 운영 문서와 기존 README는 `cd host && go run cmd/main.go` 패턴을 전제로 한다.

상태 확인:

```bash
curl -sS http://127.0.0.1:9000/programs
curl -sS http://127.0.0.1:9000/watcher/endpoints
```

토큰 사용 시:

```bash
curl -sS http://127.0.0.1:9000/programs \
  -H 'X-Hershy-Api-Token: <token>'
```

주요 API:

| Method | Path | 역할 |
|---|---|---|
| `POST` | `/programs` | 프로그램 생성 |
| `GET` | `/programs` | 프로그램 목록 |
| `GET` | `/programs/{id}` | 상세 상태 |
| `POST` | `/programs/{id}/start` | 빌드 및 실행 시작 |
| `POST` | `/programs/{id}/stop` | 중지 |
| `POST` | `/programs/{id}/restart` | 재시작 |
| `DELETE` | `/programs/{id}` | 삭제 |
| `GET` | `/programs/{id}/logs` | 컨테이너 로그 |
| `GET` | `/programs/{id}/source` | 소스 확인 |
| `GET/POST` | `/programs/{id}/proxy/*` | WatcherAPI proxy |
| `GET` | `/watcher/endpoints` | Watcher endpoint catalog |
| `GET` | `/ui/programs` | 내장 Web UI |

### 6.4 Host Web UI

소스:

- `host/api/web/`
- Vite base: `/ui/programs/`
- Host API가 실행되면 `/ui/programs`에서 SPA가 서빙된다.

개발 명령:

```bash
cd /Users/hongraecho/hershy/code/hershy/host/api/web
npm install
npm run dev
npm run build
```

Host 서버 내장 UI로 쓰려면 빌드 결과가 Host 서버의 embedded/static serving 로직과 맞는지 확인한다.

### 6.5 Program 배포 흐름

Hershy 프로그램은 Dockerfile과 Go source를 Host API에 전달해 생성하고, 별도 start API로 실행한다.

최소 흐름:

```bash
curl -sS -X POST http://127.0.0.1:9000/programs \
  -H 'Content-Type: application/json' \
  -d @payload.json

curl -sS -X POST http://127.0.0.1:9000/programs/<program_id>/start

curl -sS http://127.0.0.1:9000/programs/<program_id>
```

프로그램별 proxy port는 `19001-29999` 범위에서 할당된다. 컨테이너 내부 WatcherAPI는 `8080`이고, Host proxy가 `127.0.0.1:<publishPort>:8080` 형태로 localhost publish한다.

### 6.6 루트 Docker Compose stack

파일: `docker-compose.yml`

서비스:

| 서비스 | 역할 | 포트 |
|---|---|---|
| `postgres` | PostgreSQL 16 | `5432:5432` |
| `migrate` | DB migration | 없음 |
| `monitor` | market monitor API | `8080:8080` |
| `host` | Host 서비스 컨테이너 | `8091:8090` |
| `cron` | monitor cron worker | 없음 |

현재 문제:

- 루트 `.env`의 3번째 줄 문법이 잘못되어 `docker compose config`와 `docker compose ps`가 실패한다.
- 문제 형태는 `SELLER_AGENT_WALLET_ADDRESS` 키에 `=` 없이 값이 붙어 있는 구조다.
- 루트 `.env`에는 개인키성 값이 들어 있으므로 문서나 Git에 절대 기록하지 않는다.

수정 예시:

```dotenv
SELLER_AGENT_WALLET_ADDRESS=<address>
```

compose 실행 전 반드시 할 일:

1. `.env`를 백업한다.
2. 문법을 수정한다.
3. `monitor`의 `8080` 포트가 Jenkins와 충돌하는지 확인한다.
4. 필요하면 `monitor` 포트를 예를 들어 `18080:8080`으로 변경한다.
5. `docker compose config`로 검증한다.

실행:

```bash
cd /Users/hongraecho/hershy/code/hershy
docker compose config
docker compose up -d postgres migrate monitor host cron
docker compose ps
docker compose logs -f monitor cron
docker compose down
```

### 6.7 Monitor 서비스

소스:

- `monitor/main.go`
- `monitor/cron/cron.go`
- `monitor/cron/jobs.crontab`
- `monitor/market/repository/migrations/`

역할:

- `monitor/main.go`: `DATABASE_URL`을 사용해 PostgreSQL에 연결하고 `:8080` API 서버를 연다.
- `monitor/cron/cron.go`: 15분 timeout 컨텍스트로 market sync를 실행한다.
- 컨테이너 cron은 15분마다 `/app/cron`을 실행한다.

필수 환경변수:

```bash
DATABASE_URL=postgres://predict:predict@postgres:5432/predictmarket?sslmode=disable
```

API endpoint:

| Path | 역할 |
|---|---|
| `/polymarkets` | Polymarket market list |
| `/kalshimarkets` | Kalshi market list |

### 6.8 ACP Seller agent

소스: `acp-agent/`

역할:

- Virtuals ACP Seller runtime
- ACP job을 받아 Hershy Host API에 프로그램을 생성/실행
- program metadata, lifecycle link, encrypted access grant를 buyer에게 전달

Node package:

| 항목 | 값 |
|---|---|
| package | `hershy-acp-agent` |
| Node engine | `>=20` |
| start | `node src/main.mjs` |
| test | `node --test test/*.test.mjs` |
| check | `node --check ...` |

실행:

```bash
cd /Users/hongraecho/hershy/code/hershy/acp-agent
npm install
cp .env.example .env
# .env 편집
npm run check
npm run test
npm run start
```

필수 환경변수는 `acp-agent/.env.example`을 기준으로 만든다.

주요 필수/권장 값:

- `WHITELISTED_WALLET_PRIVATE_KEY`
- `ACP_SESSION_ENTITY_KEY_ID`
- `SELLER_AGENT_WALLET_ADDRESS`
- `HERSHY_HOST_URL`
- `HERSHY_HOST_API_TOKEN`
- `ACP_NETWORK`
- `ACP_RESOURCE_PORT`
- `ACP_ACCESS_GATEWAY_*`

현재 주의:

- `acp-agent/.env`는 없다.
- `acp-agent/ops/docker-compose.yml`은 `../.env`를 참조하므로 실제로는 `acp-agent/.env`가 필요하다.
- 루트 `.env`는 별도 파일이며 현재 문법 오류가 있다.

ops 예시:

- `acp-agent/ops/docker-compose.yml`: Node 22 alpine 컨테이너에서 `npm ci && npm run start`
- `acp-agent/ops/systemd.service`: Linux `/opt/hershy/acp-agent` 배포 예시

macOS 현재 장비에서는 systemd가 없으므로 해당 service 파일은 직접 적용되지 않는다.

### 6.9 Front standalone server

소스: `frontend/front/`

역할:

- 전략 캔버스 UI
- AI orchestration/research/strategy compose endpoint
- Host API proxy endpoint `/api/host/*`

기본 포트:

- Front: `9090`
- Host target: `http://localhost:9000`

실행:

```bash
cd /Users/hongraecho/hershy/code/hershy/frontend/front
npm install
cp .env.example .env
HOST_API_BASE=http://localhost:9000 npm run dev
```

프로덕션 방식:

```bash
cd /Users/hongraecho/hershy/code/hershy/frontend/front
npm run build
HOST_API_BASE=http://localhost:9000 npm run start
```

주요 환경변수:

- `FRONT_PORT`, 기본 `9090`
- `HOST_API_BASE`, 기본 `http://localhost:9000`
- `AI_PROVIDER`, `ollama | gemini | openai`
- `OPENAI_API_KEY`
- `GOOGLE_API_KEY` 또는 `GEMINI_API_KEY`
- `OLLAMA_BASE_URL`, `OLLAMA_MODEL`

현재 `ollama` CLI는 설치되어 있으나 실행 중인 Ollama instance에는 연결되지 않았다.

### 6.10 Monitoring stack

#### Loki/Grafana/watcher-poller

파일: `monitor/log/docker-compose.yml`

서비스:

| 서비스 | 포트 | 비고 |
|---|---:|---|
| `loki` | `3100` | log store |
| `grafana` | `3000` | 기본 admin password가 `admin`으로 설정됨 |
| `watcher-poller` | 없음 | Host API에서 프로그램과 watcher endpoint를 polling |

현재 실행 중인 컨테이너는 없다.

실행:

```bash
cd /Users/hongraecho/hershy/code/hershy/monitor/log
docker compose up -d
docker compose ps
docker compose logs -f watcher-poller
```

보안 주의:

- Grafana anonymous admin이 켜져 있다.
- 외부 공개 환경에서는 그대로 사용하면 안 된다.
- 로컬 개발용으로만 쓰거나 admin password와 auth 설정을 변경한다.

#### Vector

파일:

- `host/vector/docker-compose.yml`
- `host/vector/vector.toml`

역할:

- `../host-storage/**/*.log` 파일을 읽어 Loki로 전송
- Loki endpoint: `http://monitoring-server:3100`

현재 `docker compose -f host/vector/docker-compose.yml ps` 결과 실행 중인 vector 컨테이너는 없다.

실행:

```bash
cd /Users/hongraecho/hershy/code/hershy
docker compose -f host/vector/docker-compose.yml up -d
docker compose -f host/vector/docker-compose.yml logs -f
```

주의:

- `monitoring-server` host alias가 Loki를 가리키도록 환경이 맞아야 한다.
- 현재 구성은 개발용에 가깝다.

## 7. Docker 운영

### 7.1 현재 Docker inventory

현재 Docker에는 과거 Hershy program build 이미지가 많이 남아 있다.

대표 패턴:

- `build-<hash>`
- `test-user-...`
- `ui-strategy-...`
- dangling `<none>` 이미지 다수
- base image: `golang:1.24-alpine`, `alpine:latest`, `jenkins/jenkins:lts`

현재 활성 컨테이너가 없으므로 대부분 정리 가능해 보이나, 재현/디버깅이 필요한 이미지가 있는지 확인 후 삭제한다.

### 7.2 gVisor/runsc 상태

현재 `runsc`는 PATH에 없다.

```bash
command -v runsc
# no output
```

Docker runtime에도 `runsc`가 없다. 현재 Host 기본 runtime은 `runc`다.

프로젝트의 `scripts/install-gvisor.sh`와 `docs/GVISOR_SETUP.md`는 Linux/apt/systemd 기준이다. macOS Docker Desktop에는 그대로 적용되지 않는다. 실제 multi-tenant 또는 외부 사용자 코드를 운영하려면 Linux 서버에서 runsc를 설치한 뒤 운영하는 방식을 권장한다.

### 7.3 Docker Compose 실행 전 점검

```bash
docker context ls
docker ps --all
docker system df
docker compose config
```

루트 compose의 `.env` 오류가 해결되기 전에는 `docker compose config`가 실패한다. 먼저 `.env` 문법을 고친다.

## 8. 런타임과 개발 도구

### 8.1 설치된 주요 런타임

| 도구 | 버전 | 경로/비고 |
|---|---|---|
| Go | `go1.24.13 darwin/arm64` | `/usr/local/go/bin/go` |
| Node 기본 | `v23.7.0` | `/opt/homebrew/bin/node` |
| Node OpenClaw | `v23.9.0` | `/Users/hongraecho/.nvm/versions/node/v23.9.0/bin/node` |
| npm | `10.9.2` | Homebrew/nvm 양쪽 존재 |
| pnpm | `10.8.1` | `/opt/homebrew/bin/pnpm` |
| bun | `1.3.4` | `/Users/hongraecho/.bun/bin/bun` |
| Python | `3.9.6` | `/usr/bin/python3` |
| Docker | `27.5.1` | `/usr/local/bin/docker` |
| Docker Compose | `v2.32.4-desktop.1` | Docker Desktop |
| Homebrew | `5.1.9` | `/opt/homebrew/bin/brew` |
| Git | `2.39.3` | Apple Git |
| Rust | `rustc 1.88.0`, `cargo 1.88.0` | rust toolchain |
| Java for Jenkins | OpenJDK `21.0.9` | `/opt/homebrew/opt/openjdk@21/bin/java` |
| ngrok | `3.22.0` | config valid |
| AWS CLI | `2.34.3` | profile `icarus` |
| OpenClaw | `2026.3.2` | nvm global package |

없는 도구:

- `gh`
- `pm2`
- `uv`
- `nginx`
- `runsc`

### 8.2 Homebrew leaves

현재 Homebrew leaf packages:

- `awscli`
- `ffmpeg`
- `jenkins-lts`
- `libusb`
- `node`
- `python-matplotlib`
- `python@3.11`
- `ripgrep`
- `slither-analyzer`
- `solidity`
- `watch`
- `xdot`

Homebrew cask:

- `ngrok`

### 8.3 Node package 위치

| 경로 | 크기 | 비고 |
|---|---:|---|
| `acp-agent/node_modules` | 198 MiB | ACP agent dependencies |
| `host/api/web/node_modules` | 247 MiB | Host Web UI dependencies |
| `frontend/front/node_modules` | 44 MiB | Front standalone dependencies |

### 8.4 AWS와 SSH 관련 항목

AWS config:

- `/Users/hongraecho/.aws/config`
- profile: `icarus`
- SSO session: `hershy`
- region: `us-east-1`
- role: `AdministratorAccess`

AWS credential 파일은 이번 조사에서 확인되지 않았고, SSO 기반 config만 확인했다.

SSH config:

```text
Host hershy-ec2      -> ubuntu@3.249.43.235
Host hershy-host     -> ubuntu@34.245.227.113
Host hershyhetzner   -> admin@213.239.214.59
```

참조 key:

- `/Users/hongraecho/Downloads/hershyAi.pem`
- `/Users/hongraecho/Downloads/Hershy.pem`
- `/Users/hongraecho/.ssh/hershy-hetzner`
- `/Users/hongraecho/.ssh/hetzner-alma`

개인키는 이 문서에 기록하지 않는다. 새 관리자로 넘어갈 때는 키 소유권, 접근 필요성, 회수/교체 여부를 별도로 결정한다.

## 9. 데이터, 로그, 백업

### 9.1 주요 데이터 위치

| 대상 | 경로 | 비고 |
|---|---|---|
| Hershy repo | `/Users/hongraecho/hershy/code/hershy` | 코드와 일부 실행 데이터 |
| Host storage | `/Users/hongraecho/hershy/code/hershy/host/host-storage` | 프로그램별 src/meta/state/compose/log/runtime |
| Host log | `/Users/hongraecho/hershy/code/hershy/host/host-storage/logs/host.log` | Host 실행 로그 |
| Jenkins home | `/Users/hongraecho/.jenkins` | Jenkins 설정, 사용자, secrets |
| OpenClaw home | `/Users/hongraecho/.openclaw` | config, identity, logs |
| OpenClaw temp logs | `/tmp/openclaw` | 날짜별 runtime log |
| Docker Desktop data | `/Users/hongraecho/Library/Containers/com.docker.docker` | Docker VM data |
| ngrok config | `/Users/hongraecho/Library/Application Support/ngrok/ngrok.yml` | 토큰 포함 가능 |
| SSH keys | `/Users/hongraecho/.ssh`, `/Users/hongraecho/Downloads/*.pem` | 개인키 포함 |
| Solana keys | `/Users/hongraecho/.config/solana/*.json` | 개인키 포함 가능 |

### 9.2 Host storage 구조

기존 프로그램 디렉터리는 다음 구조를 갖는다.

```text
host/host-storage/<program_id>/
  compose/
  runtime/
  meta/
  state/
  logs/
  src/
```

조사 시점 기존 program storage는 약 1.5 MiB다. 삭제는 Host API의 `DELETE /programs/{id}`를 우선 사용한다. 수동으로 디렉터리만 삭제하면 Docker container/image와 registry 상태가 엇갈릴 수 있다.

### 9.3 Time Machine

`tmutil status` 기준 백업 세션은 실행 중이 아니다.

```text
Running = 0
```

대상 디스크가 설정되어 있는지는 이번 조사에서 확인하지 않았다. 인수 후 백업 정책을 별도로 정한다.

### 9.4 백업 우선순위

우선 백업해야 하는 항목:

1. `/Users/hongraecho/hershy/code/hershy`
2. `/Users/hongraecho/.jenkins`
3. `/Users/hongraecho/.openclaw`
4. `/Users/hongraecho/.ssh`
5. `/Users/hongraecho/Library/Application Support/ngrok/ngrok.yml`
6. `/Users/hongraecho/.aws/config`
7. 필요한 경우 Docker volumes와 Docker Desktop data

비밀값이 포함된 파일은 암호화된 저장소에 백업한다.

## 10. 보안 관리

### 10.1 현재 보안 상태

| 항목 | 상태 |
|---|---|
| SIP | enabled |
| FileVault | Off |
| macOS Application Firewall | disabled |
| Stealth mode | disabled |
| SSH listener | 없음 |
| VNC listener | 없음 |
| 사용자 권한 | `hongraecho`가 admin 그룹 |

개발 장비로는 흔한 상태지만, 운영 서버로 넘긴다면 보안 설정을 강화해야 한다.

우선 조치:

```bash
fdesetup status
/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate
lsof -nP -iTCP -sTCP:LISTEN
```

권장:

- FileVault를 켠다.
- macOS Firewall을 켠다.
- 외부 공개가 필요한 서비스만 명시적으로 허용한다.
- Jenkins와 Hershy Host는 계속 `127.0.0.1`에 bind한다.
- 외부 접근은 Tailscale/WireGuard/ngrok/reverse proxy 중 하나로 정책화한다.

### 10.2 비밀값 파일

다음 파일에는 비밀값이 들어 있거나 들어갈 수 있다.

| 경로 | 내용 |
|---|---|
| `.env` | 지갑 private key, ACP 관련 값 |
| `acp-agent/.env` | ACP Seller runtime env, 현재는 없음 |
| `acp-agent/.env.example` | 예시값, 비밀 아님 |
| `~/Library/LaunchAgents/ai.openclaw.gateway.plist` | OpenClaw gateway token 포함 |
| `~/.jenkins/secrets/`, `~/.jenkins/secret.key` | Jenkins secrets |
| `~/.ssh/*`, `~/Downloads/*.pem` | SSH private keys |
| `~/Library/Application Support/ngrok/ngrok.yml` | ngrok auth token 가능 |
| `~/.config/solana/*.json` | Solana private key 가능 |

운영 규칙:

- 비밀값은 Git에 커밋하지 않는다.
- 문서에는 값 자체를 적지 않는다.
- 새 관리자에게 넘길 때 기존 token/key를 그대로 넘길지, 새로 발급할지 결정한다.
- 가능하면 인수 직후 OpenClaw token, Jenkins admin password, ACP wallet/session 관련 값을 rotation한다.

### 10.3 Jenkins 보안

Jenkins는 `127.0.0.1:8080`에만 묶여 있다. 외부 공개는 하지 않는 구성이 안전하다.

관리 규칙:

- `~/.jenkins` 백업 후 업그레이드한다.
- admin password와 API token은 새 관리자 기준으로 재발급한다.
- job을 추가하기 전 credentials 관리를 Jenkins Credentials 기능으로 통일한다.
- 외부 webhook이 필요하면 ngrok이나 reverse proxy 사용 범위를 명확히 한다.

### 10.4 Hershy Host 보안

Host API는 프로그램 생성, Docker build, 컨테이너 실행 권한을 갖는다. 외부 공개 시 위험도가 높다.

운영 규칙:

- 기본 bind는 `127.0.0.1` 유지.
- 외부 또는 tunnel 환경에서는 `HERSHY_HOST_API_TOKEN` 필수.
- proxy endpoint는 `HERSHY_PROXY_ALLOWLIST`로 필요한 watcher path만 허용.
- untrusted code 운영은 macOS 개발 장비가 아니라 Linux + gVisor/runsc 구성을 권장.

예시:

```bash
HERSHY_HOST_API_TOKEN='<long-random-token>' \
HERSHY_PROXY_ALLOWLIST='/watcher/watching-state,/watcher/varState/*' \
go run cmd/main.go -bind 127.0.0.1 -port 9000 -api-token '<long-random-token>'
```

## 11. 정기 점검 체크리스트

### 매일

- `lsof -nP -iTCP -sTCP:LISTEN`으로 예상하지 않은 포트 확인
- `brew services list`로 Jenkins 상태 확인
- `docker ps --all`로 실패/반복 재시작 컨테이너 확인
- `df -h`로 디스크 여유 확인
- `tail`로 Jenkins/OpenClaw/Host 주요 로그 확인

### 매주

- Docker image와 container 정리 가능 여부 확인
- `~/.jenkins`, `host/host-storage`, `.env`류 백업 확인
- `git status --short --branch`로 작업 상태 확인
- macOS 업데이트와 Homebrew package 업데이트 계획 확인
- OpenClaw update 알림 확인

### 배포 전

- `.env` 문법 검증
- `docker compose config` 통과 여부 확인
- `go test ./...` 또는 영향 범위 테스트 실행
- `npm run check`, `npm run test`, `npm run build` 등 해당 패키지 검증
- 포트 충돌 확인
- 비밀값이 로그나 Git diff에 들어가지 않았는지 확인

## 12. 장애 대응

### 12.1 Jenkins가 안 열린다

확인:

```bash
brew services list
launchctl print gui/$(id -u)/homebrew.mxcl.jenkins-lts
lsof -nP -iTCP:8080 -sTCP:LISTEN
curl -I http://127.0.0.1:8080
```

복구:

```bash
brew services restart jenkins-lts
```

`java` 명령이 PATH에서 실패해도 Jenkins는 Homebrew OpenJDK 경로를 직접 사용한다. LaunchAgent의 `ProgramArguments`를 확인한다.

### 12.2 `docker compose`가 `.env` 오류로 실패한다

증상:

```text
unexpected character "\"" in variable name
```

원인:

- 루트 `.env` 3번째 줄의 key/value 문법 오류.

해결:

```dotenv
SELLER_AGENT_WALLET_ADDRESS=<address>
```

수정 후:

```bash
docker compose config
```

### 12.3 `8080` 포트 충돌

현재 Jenkins가 `127.0.0.1:8080`을 사용한다.

선택지:

1. Jenkins 중지 후 compose monitor 실행

```bash
brew services stop jenkins-lts
docker compose up -d monitor
```

2. `docker-compose.yml`에서 monitor port를 변경

```yaml
ports:
  - "18080:8080"
```

3. Jenkins 포트 변경

Jenkins LaunchAgent의 `--httpPort=8080`을 바꾸고 `brew services restart jenkins-lts`를 수행한다. Homebrew service 파일은 재생성될 수 있으므로 변경 방법을 별도 표준화한다.

### 12.4 Hershy Host API가 응답하지 않는다

확인:

```bash
lsof -nP -iTCP:9000 -sTCP:LISTEN
curl -sS http://127.0.0.1:9000/programs
```

실행:

```bash
cd /Users/hongraecho/hershy/code/hershy/host
go run cmd/main.go -bind 127.0.0.1 -port 9000 -storage ./host-storage -runtime runc
```

토큰을 켰다면 header를 포함한다.

```bash
curl -sS http://127.0.0.1:9000/programs \
  -H 'X-Hershy-Api-Token: <token>'
```

### 12.5 gVisor/runsc 오류

증상:

- `unknown runtime specified runsc`
- `runsc not found`

현재 macOS 장비에는 `runsc`가 없다. 개발 환경에서는 `-runtime runc`로 실행한다. 외부 사용자 코드를 격리 운영하려면 Linux 서버에 gVisor를 설치하고 Docker runtime에 등록한다.

### 12.6 OpenClaw unauthorized 또는 token mismatch

확인:

```bash
launchctl print gui/$(id -u)/ai.openclaw.gateway
tail -n 80 /Users/hongraecho/.openclaw/logs/gateway.err.log
```

처리:

- Control UI에 저장된 token과 LaunchAgent의 gateway token이 같은지 확인한다.
- 새 관리자 인수 시 token을 재발급 또는 재설정한다.
- 포트 `18789`가 정상 LISTEN인지 확인한다.

### 12.7 Docker Desktop storage가 커진다

확인:

```bash
docker system df
docker images
docker ps --all
```

정리:

```bash
docker image prune
docker container prune
```

볼륨 삭제는 데이터 유실 가능성이 있으므로 반드시 목록 확인 후 실행한다.

```bash
docker volume ls
docker volume prune
```

## 13. 인수인계 체크리스트

새 서버관리자가 인수 직후 해야 할 일:

1. 이 문서 기준으로 `lsof`, `brew services`, `docker ps`, `git status`를 다시 실행해 상태 변화를 확인한다.
2. `.env` 오류를 수정하고 root compose가 필요한지 결정한다.
3. Jenkins admin password와 API token을 재발급한다.
4. OpenClaw gateway token을 재발급하거나 새 관리자 기준으로 재설정한다.
5. SSH key와 AWS SSO 접근 권한을 필요한 것만 승계하고 나머지는 폐기한다.
6. macOS Firewall과 FileVault 활성화 여부를 운영 정책에 맞게 결정한다.
7. Hershy Host API를 수동 운영할지, launchd로 자동 시작할지 결정한다.
8. 외부 공개가 필요하면 ngrok, Tailscale, reverse proxy 중 하나로 표준 경로를 정한다.
9. `host/host-storage`, `~/.jenkins`, `.env`, SSH key의 백업 방식을 확정한다.
10. Docker image와 volume 정리 기준을 정한다.
11. `codex/main-front-upgrade` 브랜치의 6개 ahead commit과 untracked 디렉터리의 처리 방침을 정한다.

운영 서버로 고정하려면 추가로 권장되는 작업:

- macOS 개발 장비 대신 Linux VM/VPS로 Host API와 ACP agent를 이전한다.
- gVisor/runsc를 Linux Docker runtime에 등록한다.
- systemd 또는 launchd service 파일을 표준화한다.
- Grafana/Loki는 인증을 켠 뒤 별도 network로 분리한다.
- Host API token과 proxy allowlist를 기본값으로 강제한다.

## 14. 참고 명령 모음

### 14.1 시스템

```bash
sw_vers
uname -a
hostname
whoami
id
uptime
df -h
sysctl -n hw.model hw.memsize machdep.cpu.brand_string kern.boottime
```

### 14.2 네트워크

```bash
ifconfig
netstat -rn
lsof -nP -iTCP -sTCP:LISTEN
lsof -nP -iTCP:9000 -sTCP:LISTEN
lsof -nP -iTCP:8080 -sTCP:LISTEN
```

### 14.3 서비스

```bash
brew services list
launchctl list
launchctl print gui/$(id -u)/homebrew.mxcl.jenkins-lts
launchctl print gui/$(id -u)/ai.openclaw.gateway
crontab -l
```

### 14.4 Jenkins

```bash
brew services restart jenkins-lts
curl -I http://127.0.0.1:8080
ls -la /Users/hongraecho/.jenkins
du -sh /Users/hongraecho/.jenkins
```

### 14.5 OpenClaw

```bash
openclaw --version
curl -sS http://127.0.0.1:18789/health
tail -n 80 /Users/hongraecho/.openclaw/logs/gateway.log
tail -n 80 /Users/hongraecho/.openclaw/logs/gateway.err.log
launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway
```

### 14.6 Docker

```bash
docker --version
docker compose version
docker context ls
docker ps --all
docker images
docker volume ls
docker network ls
docker system df
docker info
```

### 14.7 Hershy Host

```bash
cd /Users/hongraecho/hershy/code/hershy/host
go run cmd/main.go -bind 127.0.0.1 -port 9000 -storage ./host-storage -runtime runc
curl -sS http://127.0.0.1:9000/programs
curl -sS http://127.0.0.1:9000/watcher/endpoints
```

### 14.8 Front

```bash
cd /Users/hongraecho/hershy/code/hershy/frontend/front
npm install
HOST_API_BASE=http://localhost:9000 npm run dev
curl -sS http://127.0.0.1:9090/api/config
```

### 14.9 ACP agent

```bash
cd /Users/hongraecho/hershy/code/hershy/acp-agent
npm install
npm run check
npm run test
npm run start
```

### 14.10 Git

```bash
cd /Users/hongraecho/hershy/code/hershy
git status --short --branch
git log -5 --oneline --decorate
git remote -v
```

