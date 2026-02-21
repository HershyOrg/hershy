좋아. **“Binance = L2(가격레벨), Coinbase = L3(주문단위)”**로 고정하고, 코덱스가 그대로 구현할 수 있게 **모듈/상태머신/입출력 스펙**까지 다시 짜줄게.

---

## 1) 전체 아키텍처(한 장 설계도)

```
          ┌──────────────────────────┐
          │      Orchestrator         │  (asyncio task manager)
          └───────┬──────────┬───────┘
                  │          │
      ┌───────────▼───┐  ┌──▼─────────────┐
      │ Binance L2     │  │ Coinbase L3     │
      │ BookBuilder    │  │ BookBuilder     │
      │ (snapshot+diff)│  │ (snapshot+full) │
      └───────┬────────┘  └──────┬─────────┘
              │                  │
     emits    ▼                  ▼    emits
      ┌────────────────────────────────────┐
      │ Normalized Event Bus (in-memory)    │
      │  - book_state / trades / metrics    │
      └───────────┬───────────┬───────────┘
                  │           │
          ┌───────▼───┐   ┌──▼───────────┐
          │ Feature    │   │ Storage       │
          │ Engine     │   │ (Parquet/DB)  │
          └───────┬────┘   └──┬───────────┘
                  │           │
             ┌────▼───────────▼───┐
             │ UI/Monitor (FastAPI │
             │ + WebSocket / Panel │
             │ / Streamlit)        │
             └─────────────────────┘
```

---

## 2) Binance L2 “정확 재구성” 스펙 (가격 레벨, depthUpdate)

### 2-1) 입력(공식 규칙)

* WS: `<symbol>@depth` 또는 `@depth@100ms`의 `depthUpdate` 이벤트(필드 `U, u, b, a`) ([바이낸스 개발자 센터](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams "WebSocket Streams | Binance Open Platform"))
* REST 스냅샷: `GET /api/v3/depth?symbol=...&limit=5000` → `lastUpdateId, bids, asks` ([바이낸스 개발자 센터](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints "Market Data endpoints | Binance Open Platform"))
* 로컬북 동기화 절차(버퍼링→스냅샷→리플레이→실시간 적용) Binance가 단계별로 명시 ([바이낸스 개발자 센터](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams "WebSocket Streams | Binance Open Platform"))

### 2-2) 상태머신(그대로 구현)

1. WS 연결 후 `depthUpdate` 수신  **버퍼에 쌓기** , 첫 이벤트의 `U` 기억 ([바이낸스 개발자 센터](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams "WebSocket Streams | Binance Open Platform"))
2. REST 스냅샷 요청 (limit 5000 권장/상한) ([바이낸스 개발자 센터](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints "Market Data endpoints | Binance Open Platform"))
3. 스냅샷 `lastUpdateId < first_U`이면 스냅샷 다시 ([바이낸스 개발자 센터](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams "WebSocket Streams | Binance Open Platform"))
4. 버퍼에서 `u <= lastUpdateId` 이벤트 폐기, 첫 이벤트가 `[U;u]`에 lastUpdateId 포함하도록 맞추기 ([바이낸스 개발자 센터](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams "WebSocket Streams | Binance Open Platform"))
5. 로컬북 = 스냅샷으로 세팅, `book_update_id = lastUpdateId` ([바이낸스 개발자 센터](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams "WebSocket Streams | Binance Open Platform"))
6. 이후 이벤트 적용 규칙:
   * `u < book_update_id`면 무시
   * `U > book_update_id + 1`이면 **유실** → 전체 리셋(1부터) ([바이낸스 개발자 센터](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams "WebSocket Streams | Binance Open Platform"))
   * 각 price level은 “새 수량으로 set”, 수량 0이면 제거 ([바이낸스 개발자 센터](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams "WebSocket Streams | Binance Open Platform"))

### 2-3) “정확”의 한계(중요)

* REST 스냅샷은 **양쪽 최대 5000 레벨**이라, 그 밖 레벨은 “변화가 있을 때만” 알게 됨(완전한 전체북 보장 X) ([바이낸스 개발자 센터](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams "WebSocket Streams | Binance Open Platform"))
  → 그래서 Binance는 “정확한 L2(top5000)”로 정의하고 가는 게 현실적.

### 2-4) 내부 자료구조(권장)

* `bids: dict[price] = qty`, `asks: dict[price] = qty` (Decimal 권장)
* `book_update_id: int`
* `apply_depth_update(event)`는 “set/remove”만 수행(누적이 아님)

---

## 3) Coinbase L3 “정확 재구성” 스펙 (주문 단위, full channel)

### 3-1) 입력(공식 규칙)

* WS `full` 채널: L3 스냅샷에 적용해서 “정확한 실시간 L3 유지” 가능하다고 Coinbase가 명시 ([Coinbase Developer Docs](https://docs.cdp.coinbase.com/exchange/websocket-feed/channels "Exchange WebSocket Channels - Coinbase Developer Documentation"))
* 절차도 Binance랑 동일 패턴(구독→큐잉→REST 스냅샷→sequence 기준 재생→실시간 적용) ([Coinbase Developer Docs](https://docs.cdp.coinbase.com/exchange/websocket-feed/channels "Exchange WebSocket Channels - Coinbase Developer Documentation"))
* REST 스냅샷: `GET /products/{product_id}/book?level=3`
  * level 3은  **non-aggregated 전체 주문북** (단, 폴링 남용 금지 + WS로 유지 권장) ([Coinbase Developer Docs](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-book "Get product book - Coinbase Developer Documentation"))

또한 `received`는 “북에 resting 됐다는 뜻이 아니므로 북 변경하면 틀어진다”를 Coinbase가 직접 경고함 ([Coinbase Developer Docs](https://docs.cdp.coinbase.com/exchange/websocket-feed/channels "Exchange WebSocket Channels - Coinbase Developer Documentation"))

### 3-2) 상태머신(그대로 구현)

1. WS 연결 → `full` subscribe 전송
2. 수신 메시지 전부 **큐(버퍼)**에 저장
3. REST로 `book?level=3` 스냅샷 획득(스냅샷은 `sequence` 포함) ([Coinbase Developer Docs](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-book "Get product book - Coinbase Developer Documentation"))
4. 버퍼 메시지 중 `sequence <= snapshot.sequence` 폐기 후, 순서대로 리플레이 ([Coinbase Developer Docs](https://docs.cdp.coinbase.com/exchange/websocket-feed/channels "Exchange WebSocket Channels - Coinbase Developer Documentation"))
5. 리플레이가 끝나면 실시간 메시지를 즉시 적용

### 3-3) 이벤트 적용 규칙(핵심만)

Coinbase가 “북을 바꾸는 건 open/match는 항상, done/change는 경우에 따라”라고 못 박음 ([Coinbase Developer Docs](https://docs.cdp.coinbase.com/exchange/websocket-feed/channels "Exchange WebSocket Channels - Coinbase Developer Documentation"))

* `received`: **북에 반영 금지** ([Coinbase Developer Docs](https://docs.cdp.coinbase.com/exchange/websocket-feed/channels "Exchange WebSocket Channels - Coinbase Developer Documentation"))
* `open`: 주문이 북에 게시됨(추가) ([Coinbase Developer Docs](https://docs.cdp.coinbase.com/exchange/websocket-feed/channels "Exchange WebSocket Channels - Coinbase Developer Documentation"))
* `match`: maker 주문 잔량 감소(0이면 제거)
* `done`: 주문이 북에서 제거(단, “북에 없던 주문 done은 무시”) ([Coinbase Developer Docs](https://docs.cdp.coinbase.com/exchange/websocket-feed/channels "Exchange WebSocket Channels - Coinbase Developer Documentation"))
* `change`: 주문 수정(마찬가지로 “북에 없던 주문 change는 무시”) ([Coinbase Developer Docs](https://docs.cdp.coinbase.com/exchange/websocket-feed/channels "Exchange WebSocket Channels - Coinbase Developer Documentation"))

### 3-4) 내부 자료구조(필수)

* `orders: dict[order_id] -> {side, price, remaining_size}`
* `levels: dict[side][price] -> total_size` (L2형 벽/델타 계산을 위해 L3를 집계해 두면 좋음)

### 3-5) 운영 안정성(ErrSlowConsume 방어)

Coinbase는 풀 채널이 특히 무거워서:

* 메시지 처리/IO를 콜백에서 바로 하지 말고 **큐에 넣고 오프스레드/별도 태스크로 처리**
* slow consumer 에러 대응, 구독 분산 등 권장 ([Coinbase Developer Docs](https://docs.cdp.coinbase.com/exchange/websocket-feed/best-practices?utm_source=chatgpt.com "Exchange WebSocket Best Practices"))

---

## 4) “통합 레이어” 표준 인터페이스(코덱스용)

### 4-1) 공통 출력 타입(두 거래소 동일)

```python
@dataclass
class BookState:
    venue: Literal["binance", "coinbase"]
    symbol: str                  # "BTCUSDT" or "BTC-USD"
    ts_exchange_ms: int | None   # 이벤트에 있으면 사용
    ts_local_ms: int             # 수신 시각(모노토닉/벽시계 둘 다 가능)
    kind: Literal["L2", "L3"]
    # L2 view (always present):
    best_bid: float
    best_ask: float
    bids: list[tuple[float, float]]   # topN (price, qty)
    asks: list[tuple[float, float]]
    # L3 extras (coinbase only):
    l3_order_count: int | None
```

### 4-2) 공통 빌더 API

```python
class BookBuilder(Protocol):
    async def start(self) -> None: ...
    def get_state(self) -> BookState: ...
    def health(self) -> dict: ...  # lag, last_seq, resync_count, queue_depth
```

---

## 5) Watchdog/Resync 정책(실전 필수)

### Binance(L2)

* 규칙 그대로:
  * `U > local_id + 1`이면 유실 → 즉시 리셋 ([바이낸스 개발자 센터](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams "WebSocket Streams | Binance Open Platform"))
* 추가로:
  * `now - last_event_ts > 1s(또는 2s)`면 재연결/리셋

### Coinbase(L3)

* `sequence` 점프/역행 감지 시 리셋(스냅샷 다시 + replay) ([Coinbase Developer Docs](https://docs.cdp.coinbase.com/exchange/websocket-feed/channels "Exchange WebSocket Channels - Coinbase Developer Documentation"))
* `ErrSlowConsume`류가 뜨거나 큐가 비정상 증가하면:
  * 구독 분산 / 처리 최적화 / 리셋(권장사항) ([Coinbase Developer Docs](https://docs.cdp.coinbase.com/exchange/websocket-feed/best-practices?utm_source=chatgpt.com "Exchange WebSocket Best Practices"))

---

## 6) 바로 코드로 옮길 “폴더 구조 설계도”

```
md/
  orchestrator.py          # asyncio run + task wiring
  bus.py                   # event bus (async queue + pubsub)
  watchdog.py              # health monitor + resync trigger
  storage.py               # parquet writer, rolling files

exchanges/
  binance_l2.py            # depthUpdate + /api/v3/depth snapshot
  coinbase_l3.py           # full channel + book?level=3 snapshot
  symbols.py               # BTCUSDT <-> BTC-USD mapping, decimals

features/
  walls.py                 # 벽 생김/사라짐 (delta)
  trades.py                # 1M$ 체결 감지(notional)
  alignment.py             # cross-venue time align (lead/lag)

ui/
  api.py                   # FastAPI + WS endpoints
  dashboard.py             # Panel/Streamlit front
```

---

원하면 다음 턴에 **“벽 생김/사라짐 델타 탐지(네가 말한 F4)”를 Binance(L2)와 Coinbase(L3)에서 각각 어떻게 정의/계산할지**까지, (1) 수식/임계치 (2) 이벤트 기반 구현 (3) 가상 트레이딩 입력 시그널 포맷까지 붙여서 완성 설계도로 마무리해줄게.
