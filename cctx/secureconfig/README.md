# Secure Config

`secureconfig`은 `enc:v1:` 형식의 문자열을 `AES-256-GCM`으로 암복호화하는 계층입니다.

## 빠른 테스트

1. 마스터 키 생성

```bash
cd /Users/xxuchan/hershy/cctx
go run ./cmd/secureconfig generate-key
```

2. 환경변수 설정

```bash
export CCTX_MASTER_KEY='생성된_키'
```

3. 평문 암호화

```bash
cd /Users/xxuchan/hershy/cctx
go run ./cmd/secureconfig encrypt --value 'my-binance-secret'
```

4. 암호문 복호화

```bash
cd /Users/xxuchan/hershy/cctx
go run ./cmd/secureconfig decrypt --value 'enc:v1:...'
```

5. 한 번에 검증

```bash
cd /Users/xxuchan/hershy/cctx
go run ./cmd/secureconfig roundtrip --value 'my-binance-secret'
```

## stdin 사용

쉘 히스토리에 남기고 싶지 않으면 `--stdin`을 사용합니다.

```bash
printf '%s\n' 'my-binance-secret' | go run ./cmd/secureconfig encrypt --stdin
```

## 런타임 사용

암호화된 문자열은 그대로 `api_key`, `api_secret`, `private_key` 같은 config 값에 넣으면 됩니다.
`cctx`는 생성 시점에 `CCTX_MASTER_KEY`로 자동 복호화합니다.
