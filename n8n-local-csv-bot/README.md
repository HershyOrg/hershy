# n8n Local CSV + Ollama + X Posting Bot

이 버전은 Google Sheets를 쓰지 않습니다. Hetzner 서버의 로컬 CSV 파일을 큐로 사용합니다.

## 파일 구조

n8n Docker에서 `/files`로 마운트할 폴더 안에 아래 파일들이 있어야 합니다.

```text
/files/queue.csv
/files/accounts.csv
/files/scripts/generate_drafts.js
/files/scripts/post_approved.js
```

## 1. 서버에 폴더 만들기

```bash
mkdir -p ~/n8n-files/scripts
```

이 ZIP 안의 `queue.csv`, `accounts.csv`, `scripts/` 폴더를 `~/n8n-files` 안에 넣으세요.

## 2. n8n Docker 실행

```bash
docker run -it --rm \
  --name n8n \
  -p 5678:5678 \
  -v ~/.n8n:/home/node/.n8n \
  -v ~/n8n-files:/files \
  n8nio/n8n
```

## 3. Ollama URL

n8n이 Docker 안에서 돌고, Ollama가 Hetzner 호스트에서 돌면 `localhost`가 아니라 보통 아래를 씁니다.

```text
http://172.17.0.1:11434/api/generate
```

`queue.csv`의 `ollama_url` 컬럼에 이 값이 들어 있습니다.

만약 n8n과 Ollama를 Docker Compose 같은 네트워크로 묶으면 아래처럼 바꿀 수 있습니다.

```text
http://ollama:11434/api/generate
```

## 4. 사용법

### 초안 생성

1. `queue.csv`에 글 소재를 넣습니다.
2. `status`를 `queued`로 둡니다.
3. n8n에서 `A - Local CSV Queue to Ollama Draft` 실행.
4. 성공하면 `generated_text`가 채워지고 `status`가 `drafted`로 바뀝니다.

### 승인

1. `generated_text`를 보고 마음에 들면 `status`를 `approved`로 바꿉니다.
2. 게시하기 싫으면 `skipped`로 바꿉니다.

### 게시

1. `accounts.csv`에 account_name별 X token env를 넣습니다.
2. 서버/n8n 컨테이너 환경변수에 실제 토큰을 넣습니다.
3. n8n에서 `B - Local CSV Approved to X Post` 실행.
4. 성공하면 `status=posted`, `posted_url`이 채워집니다.

## 5. X 토큰 설정

권장 방식은 `accounts.csv`에 토큰을 직접 넣지 않고 환경변수 이름만 넣는 것입니다.

`accounts.csv` 예시:

```csv
account_name,x_token_env,x_access_token,enabled,notes
account_01,X_TOKEN_ACCOUNT_01,,true,main account
```

그 후 n8n Docker 실행 시:

```bash
docker run -it --rm \
  --name n8n \
  -p 5678:5678 \
  -e X_TOKEN_ACCOUNT_01="YOUR_REAL_X_USER_ACCESS_TOKEN" \
  -v ~/.n8n:/home/node/.n8n \
  -v ~/n8n-files:/files \
  n8nio/n8n
```

테스트 단계에서는 `accounts.csv`의 `x_access_token`에 직접 넣어도 되지만, 보안상 비추천입니다.

## 6. status 값

```text
queued    = 초안 생성 대기
drafted   = 초안 생성 완료
approved  = 사람이 승인, 게시 대기
posted    = 게시 완료
skipped   = 건너뜀
failed    = 에러 발생
```

## 7. 주의

- 같은 내용을 여러 계정에 동시에 뿌리지 마세요.
- 각 계정별로 서로 다른 source_text와 rewrite_format을 넣는 방식이 안전합니다.
- 처음에는 Workflow B 자동 게시보다 수동 승인 후 소량 게시를 추천합니다.
