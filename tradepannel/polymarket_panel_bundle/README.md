# 폴리마켓 패널 설정 (로컬)

이 폴더에는 아래 파일이 있습니다.

- `derive_api_creds.py`
- `polymarket_trade_panel.py`
- `client.py`

**주의:** 이 문서에 실제 비밀키를 붙여넣거나 git에 커밋하지 마세요.

## 파일 용도

- `derive_api_creds.py`: API 키/시크릿/패스프레이즈를 발급(또는 재생성)하는 스크립트
- `polymarket_trade_panel.py`: 웹 기반 수동 매매 패널(시장가/지정가, 손절/익절 로직 포함)
- `client.py`: `py_clob_client` CLOB API 클라이언트 구현(요청/서명/주문/취소 등)

## 파이썬/패키지 설치

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install py-clob-client websockets py-builder-signing-sdk
```

## 1) 개인키 + 펀더 주소 export

```bash
export POLY_PRIVATE_KEY="0xYOUR_PRIVATE_KEY"
export POLY_FUNDER="0xYOUR_FUNDER_ADDRESS"
```

필요하면 `POLY` 대신 `POLY2` 같은 다른 프리픽스를 사용할 수 있습니다.

## 2) API 키/시크릿/패스프레이즈 발급

```bash
PYTHONUNBUFFERED=1 .venv/bin/python polymarket_panel_bundle/derive_api_creds.py \
  --env-prefix POLY \
  --signature-type 2
```

출력된 3줄을 그대로 export 합니다.

```bash
export POLY_API_KEY="..."
export POLY_API_SECRET="..."
export POLY_API_PASSPHRASE="..."
```

## 3) 패널 실행

```bash
PYTHONUNBUFFERED=1 .venv/bin/python polymarket_panel_bundle/polymarket_trade_panel.py \
  --env-prefix POLY \
  --signature-type 2 \
  --auto-15m-prefix btc-updown-15m \
  --order-type FAK \
  --exit-order-type GTC
```

브라우저에서 `http://127.0.0.1:8787` 접속하면 됩니다.

## 주의점

AUTO exit 기능은 시장가 지정매도기능으로, 오류가 있으므로 사용하시면 안됩니다@@!!
