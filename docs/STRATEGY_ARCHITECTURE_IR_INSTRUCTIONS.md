# Strategy Architecture IR JSON Instruction

이 문서는 사람이 자연어로 설명한 퀀트 전략을 Watch-Effect 아키텍처에 맞춰 구조화하기 위한 JSON 생성 규칙이다.

이 JSON은 코드 생성 명세가 아니다. 실행 함수명, SDK 호출, Go 파일 경로, 인증 정보, Docker 설정 같은 구현 세부사항을 포함하지 않는다. 목적은 전략 의도, 상태, 노드, 데이터 흐름, 전이 규칙, 필요한 capability를 사람이 읽을 수 있는 추상 설계도로 정리하는 것이다.

---

## 1. 목적

### 1-1. 이 JSON이 하는 일

- 자연어 전략 설명을 구조화된 아키텍처로 변환한다.
- 전략을 여러 개의 `sequence`로 나눈다.
- 각 sequence를 `trigger`, `watch`, `function`, `action` 노드로 나눈다.
- 각 노드의 의도, 입력, 출력, 상태 변화, 전이 조건을 명확히 기록한다.
- 나중에 Hershy/Hersh/cctx 같은 실행 환경에서 구현 가능한지 판단할 수 있도록 `capability_requirements`를 태깅한다.

### 1-2. 이 JSON이 하지 않는 일

- 실제 Go 코드를 지정하지 않는다.
- 내부 함수명으로 직접 매핑하지 않는다.
- 특정 SDK 호출 방식을 강제하지 않는다.
- 실거래 인증 정보나 private key를 포함하지 않는다.
- 지원되지 않는 동작을 임의로 구현했다고 가정하지 않는다.

### 1-3. 한 줄 정의

```text
이 JSON은 퀀트 전략의 실행 코드를 직접 지시하는 문서가 아니라, 사람이 설명한 전략을 Watch-Effect 아키텍처에 맞춰 구조화한 추상 설계도다.
```

---

## 2. 전체 JSON 구조

최상위 JSON은 반드시 하나의 JSON object여야 한다.

```json
{
  "document_type": "strategy_architecture_ir",
  "schema_version": "0.2",
  "scope": "architecture_extraction_only",
  "strategy_goal": {},
  "global_config": {},
  "state_model": {},
  "transition_semantics": {},
  "capability_requirements": {},
  "ai_decision_policy": {},
  "sequences": {},
  "assumptions": [],
  "ai_filled_fields": [],
  "human_review_required": [],
  "approval_state": {},
  "implementation_readiness": {},
  "open_questions": []
}
```

### 2-1. 최상위 필드 규칙

| 필드 | 필수 | 설명 |
|---|---:|---|
| `document_type` | Yes | 반드시 `strategy_architecture_ir` |
| `schema_version` | Yes | 명세 버전. 예: `0.2` |
| `scope` | Yes | 반드시 `architecture_extraction_only` |
| `strategy_goal` | Yes | 전략의 목적과 수익/방어 논리 |
| `global_config` | Yes | 거래소, 자산, 마켓, 기준 통화, 실행 모드 |
| `state_model` | Yes | 전략이 사용하는 상태 이름과 의미 |
| `transition_semantics` | Yes | 노드 간 이동 규칙 |
| `capability_requirements` | Yes | 이 전략이 요구하는 추상 기능 목록 |
| `ai_decision_policy` | Yes | AI가 먼저 채울 수 있는 범위와 사람이 확인할 항목 |
| `sequences` | Yes | 초기화, 실행, 종료 시퀀스 목록 |
| `assumptions` | Yes | AI가 보강한 가정 목록 |
| `ai_filled_fields` | Yes | 사용자가 명시하지 않았지만 AI가 먼저 채운 필드 목록 |
| `human_review_required` | Yes | 사람이 확정해야 하는 항목 |
| `approval_state` | Yes | 전략 의도 검수, paper/live 승인 상태 |
| `implementation_readiness` | Yes | 구현 단계로 넘어갈 수 있는지에 대한 상태 |
| `open_questions` | Yes | AI가 보수적으로도 정하기 어려운 질문 목록 |

---

## 3. 생성 원칙

### 3-1. 의도 중심으로 적기

각 노드는 "무슨 코드를 실행할지"가 아니라 "전략상 어떤 책임을 갖는지"를 설명해야 한다.

좋은 예:

```json
{
  "intent": "현재 잔고와 리스크 한도를 기준으로 주문 가능한 최대 수량을 계산한다."
}
```

나쁜 예:

```json
{
  "intent": "ExchangeClient.CreateOrder를 호출하기 전에 size 변수를 계산한다."
}
```

### 3-2. 구현 세부를 쓰지 않기

금지되는 표현:

- `ExchangeClient.CreateOrder(...)`
- `client.FetchBalance()`
- `go routine`
- `Dockerfile`
- `private_key`
- `api_secret`
- `src/main.go`

대신 capability로 표현한다.

```json
{
  "capability_requirements": ["balance_read", "limit_order_execution"]
}
```

### 3-3. AI가 먼저 보수적으로 채우고 기록하기

사용자가 명시하지 않은 값이 있더라도 전략 아키텍처를 완성하는 데 필요한 값은 AI가 먼저 보수적으로 채운다. 단, AI가 채운 모든 값은 반드시 `ai_filled_fields`에 기록한다.

AI가 값을 채울 때는 다음 원칙을 따른다.

- 전략 안전성을 높이는 방향으로 보수적으로 채운다.
- 값의 출처를 `source: "ai_inferred"`로 표시한다.
- 왜 채웠는지 `reason`에 적는다.
- 확실도를 `certainty`에 `low`, `medium`, `high` 중 하나로 적는다.
- 사람이 확인해야 하는 값이면 `requires_human_review: true`로 표시하고 `human_review_required`에도 추가한다.

예:

```json
{
  "ai_filled_fields": [
    {
      "path": "risk_state.cooldown_active",
      "value": "최근 주문 이후 중복 진입을 방지하는 상태",
      "source": "ai_inferred",
      "reason": "반복 실행 전략에는 중복 주문 방지 상태가 필요하다.",
      "certainty": "high",
      "requires_human_review": false
    },
    {
      "path": "risk_policy.max_order_value_usd",
      "value": 1000,
      "source": "ai_inferred",
      "reason": "사용자가 최대 주문 금액을 명시하지 않아 보수적 기본 제한을 추가했다.",
      "certainty": "medium",
      "requires_human_review": false
    }
  ]
}
```

불명확해서 AI가 보수적으로도 채우기 어려운 항목은 `open_questions`에 기록한다.

### 3-4. JSON은 파싱 가능해야 함

- 주석을 넣지 않는다.
- trailing comma를 넣지 않는다.
- Markdown 설명은 JSON 바깥에만 둔다.
- JSON 문자열 안의 조건식은 문자열로 적는다.

### 3-5. AI와 사람의 결정 권한

이 명세는 "AI가 먼저 채우고 사람이 확인하는 구조"를 따른다.

AI는 사용자가 프롬프트에 명시하지 않은 대부분의 아키텍처 값을 먼저 정할 수 있다. 예를 들어 노드 분류, 상태 모델, 리스크 상태, 주문 크기 기본값, 슬리피지 기본값, 손절/익절 초안, 마켓 선택 초안, 종료 흐름 초안 등을 보수적으로 채울 수 있다.

단, 아래 항목은 사람이 따로 확정해야 한다.

1. 자동 재시도 여부와 재시도 횟수
2. AI가 추가한 전략 로직이 원래 사용자 의도와 맞는지 여부
3. live mode 배포 승인

종료 시 포지션 처리의 기본값은 `liquidate_on_shutdown: true`다. 사용자가 다르게 명시하지 않으면 종료 시퀀스는 미체결 주문 취소 후 보유 포지션 청산을 포함해야 한다.

```json
{
  "ai_decision_policy": {
    "default_mode": "ai_fills_first_human_reviews_after",
    "ai_may_fill_when_user_omits": [
      "node_category_classification",
      "sequence_decomposition",
      "state_model_completion",
      "risk_policy_defaults",
      "order_size_defaults",
      "slippage_defaults",
      "market_selection_defaults",
      "take_profit_stop_loss_draft",
      "termination_flow_defaults",
      "capability_tagging",
      "observability_fields"
    ],
    "human_must_confirm": [
      "automatic_retry_policy",
      "ai_added_strategy_logic_alignment",
      "live_deployment_approval"
    ],
    "termination_defaults": {
      "cancel_open_orders_on_shutdown": true,
      "liquidate_on_shutdown": true
    }
  }
}
```

자동 재시도 정책은 AI가 제안할 수는 있지만 확정값으로 두면 안 된다. 반드시 `human_review_required`에 추가한다.

```json
{
  "human_review_required": [
    {
      "path": "failure_policy.automatic_retry",
      "question": "주문 실행 실패 시 자동 재시도를 허용할 것인가?",
      "risk_if_wrong": "재시도가 켜져 있으면 중복 주문이나 의도보다 큰 노출이 생길 수 있고, 꺼져 있으면 일시적 오류에도 전략이 멈출 수 있다."
    },
    {
      "path": "approval_state.ai_added_strategy_logic_reviewed",
      "question": "AI가 추가한 전략 로직이 원래 의도와 일치하는가?",
      "risk_if_wrong": "전략이 사용자의 원래 아이디어와 다르게 작동할 수 있다."
    },
    {
      "path": "approval_state.live_mode_approved",
      "question": "이 전략을 live mode로 배포해도 되는가?",
      "risk_if_wrong": "실제 자금 손실이 발생할 수 있다."
    }
  ],
  "approval_state": {
    "ai_added_strategy_logic_reviewed": false,
    "automatic_retry_policy_approved": false,
    "paper_mode_approved": false,
    "live_mode_approved": false
  }
}
```

---

## 4. `strategy_goal`

전략이 최종적으로 무엇을 하려는지 설명한다.

```json
{
  "strategy_goal": {
    "name": "BTC 5분 모멘텀 진입 전략",
    "objective": "BTC 단기 가격 모멘텀이 강하고 리스크 조건이 허용될 때 포지션에 진입한다.",
    "profit_logic": "상승 모멘텀과 충분한 유동성이 동시에 확인될 때 진입하고, 목표 수익 또는 리스크 조건 악화 시 청산한다.",
    "risk_logic": "최대 주문 금액, 최대 포지션, 슬리피지, 쿨다운 조건을 통해 과도한 노출을 방지한다.",
    "primary_loop": "시장 데이터 관찰 -> 시그널 계산 -> 리스크 확인 -> 주문 실행 또는 대기",
    "scope_note": "이 명세는 아키텍처 추출용이며 실행 코드 매핑을 포함하지 않는다."
  }
}
```

### 필드 설명

| 필드 | 필수 | 설명 |
|---|---:|---|
| `name` | Yes | 전략 이름 |
| `objective` | Yes | 최종 목표 |
| `profit_logic` | Yes | 수익을 내는 논리 |
| `risk_logic` | Yes | 손실/과노출을 막는 논리 |
| `primary_loop` | Yes | 전략의 반복 흐름 |
| `scope_note` | No | 아키텍처 추출용이라는 설명 |

---

## 5. `global_config`

전략 전체에 적용되는 실행 환경과 대상 정보를 정의한다. 실제 인증 정보는 절대 넣지 않는다.

```json
{
  "global_config": {
    "execution_mode": "paper",
    "venue_scope": "single_exchange",
    "exchanges": [
      {
        "exchange_id": "polymarket",
        "exchange_type": "DEX",
        "role": "primary_execution_venue"
      }
    ],
    "assets": [
      {
        "symbol": "BTC",
        "role": "reference_asset"
      },
      {
        "symbol": "USDC",
        "role": "base_currency"
      }
    ],
    "markets": [
      {
        "market_ref": "btc_5m_updown",
        "market_type": "prediction_market",
        "base_asset": "BTC",
        "quote_asset": "USDC",
        "selection_rule": "현재 거래 가능한 BTC 5분 방향성 마켓을 대상으로 한다."
      }
    ],
    "timeframe": "5m",
    "base_currency": "USDC",
    "dry_run_required": true
  }
}
```

### 필드 설명

| 필드 | 필수 | 설명 |
|---|---:|---|
| `execution_mode` | Yes | `paper`, `live`, `backtest`, `shadow` 중 하나 |
| `venue_scope` | No | `single_exchange`, `multi_exchange`, `cex_dex_hybrid` 등 |
| `exchanges` | Yes | 거래소/플랫폼 목록 |
| `assets` | Yes | 전략에서 다루는 자산 |
| `markets` | Yes | 전략 대상 마켓 |
| `timeframe` | No | 주요 판단 주기 |
| `base_currency` | Yes | 기준 통화 |
| `dry_run_required` | Yes | 실거래 방지 필요 여부 |

---

## 6. `state_model`

전략 내부에서 사용하는 상태 이름과 의미를 통일한다. 상태는 코드 변수가 아니라 아키텍처 용어다.

```json
{
  "state_model": {
    "balance_state": {
      "available_cash": "현재 주문에 사용할 수 있는 기준 통화 잔고",
      "reserved_cash": "미체결 주문, 예치, 락업 등으로 사용 불가능한 잔고",
      "total_equity": "현금과 포지션 평가액을 합산한 총자산"
    },
    "position_state": {
      "current_position": "현재 보유 중인 포지션",
      "position_value": "현재 포지션의 평가액",
      "unrealized_pnl": "아직 실현되지 않은 손익",
      "exposure_ratio": "총자산 대비 포지션 노출 비율"
    },
    "order_state": {
      "open_orders": "아직 체결 또는 취소되지 않은 주문 목록",
      "last_order": "가장 최근 주문 요청과 결과",
      "last_fill": "가장 최근 체결 정보"
    },
    "market_state": {
      "last_price": "최근 관찰된 기준 가격",
      "best_bid": "최우선 매수 호가",
      "best_ask": "최우선 매도 호가",
      "spread": "best_ask와 best_bid의 차이",
      "liquidity_score": "거래 가능 유동성의 추상 점수"
    },
    "signal_state": {
      "momentum_signal": "모멘텀 판단 결과",
      "entry_signal": "진입 가능 여부",
      "exit_signal": "청산 필요 여부",
      "risk_signal": "리스크 제한 발동 여부"
    },
    "risk_state": {
      "max_position_exceeded": "최대 포지션 초과 여부",
      "drawdown_limit_hit": "손실 한도 도달 여부",
      "cooldown_active": "최근 주문 이후 대기 시간이 적용 중인지 여부",
      "duplicate_order_guard": "동일 조건에서 중복 주문을 막는 상태"
    }
  }
}
```

### 상태 모델 작성 규칙

- 같은 의미의 상태는 같은 이름으로 반복 사용한다.
- 노드의 `inputs`와 `outputs`는 되도록 `state_model`의 이름을 참조한다.
- 원문에 없는 상태는 "필요 추정"으로 만들 수 있지만, `assumptions` 또는 `open_questions`에 기록한다.

---

## 7. `transition_semantics`

노드 간 이동 규칙을 정의한다.

```json
{
  "transition_semantics": {
    "routing_modes": {
      "direct": "하나의 다음 노드로 이동한다.",
      "conditional": "조건 평가 결과에 따라 다음 노드를 선택한다.",
      "parallel": "여러 노드를 병렬로 시작한다.",
      "end": "현재 시퀀스를 종료한다."
    },
    "await_policy": {
      "sync": "현재 노드 결과를 확인한 뒤 다음 노드로 이동한다.",
      "async": "현재 노드 완료를 기다리지 않고 다음 노드로 이동한다."
    },
    "timeout_policy": {
      "default_timeout_ms": 5000,
      "on_timeout": "fail_node",
      "allowed_timeout_actions": ["fail_node", "skip_node", "retry_node", "stop_sequence"]
    },
    "parallel_policy": {
      "join_mode": "all_success",
      "allowed_join_modes": ["all_success", "any_success", "fire_and_forget"],
      "on_partial_failure": "fail_sequence"
    },
    "condition_policy": {
      "condition_language": "human_readable_boolean_expression",
      "unknown_condition_policy": "record_open_question"
    }
  }
}
```

### 노드별 `transition` 형식

#### Direct

```json
{
  "transition": {
    "await_current_action": true,
    "routing_mode": "direct",
    "next_nodes": ["function_entry_check"],
    "timeout_ms": 3000
  }
}
```

#### Conditional

```json
{
  "transition": {
    "await_current_action": true,
    "routing_mode": "conditional",
    "next_nodes": {
      "entry_signal == true": "action_enter_position",
      "entry_signal == false": "END_OF_SEQUENCE"
    },
    "timeout_ms": 3000
  }
}
```

#### Parallel

```json
{
  "transition": {
    "await_current_action": false,
    "routing_mode": "parallel",
    "next_nodes": ["watch_balance", "watch_position", "watch_orderbook"],
    "parallel_join": "all_success",
    "timeout_ms": 5000
  }
}
```

#### End

```json
{
  "transition": {
    "await_current_action": true,
    "routing_mode": "end",
    "next_nodes": ["END_OF_SEQUENCE"]
  }
}
```

---

## 8. `capability_requirements`

Capability는 구현 함수명이 아니라 전략이 요구하는 추상 기능이다.

```json
{
  "capability_requirements": {
    "watch_capabilities": [
      "websocket_subscription",
      "rest_polling",
      "orderbook_read",
      "balance_read",
      "position_read",
      "open_order_read",
      "market_metadata_read",
      "price_feed_read"
    ],
    "function_capabilities": [
      "numeric_calculation",
      "condition_evaluation",
      "risk_check",
      "signal_generation",
      "position_sizing",
      "spread_calculation",
      "momentum_calculation"
    ],
    "action_capabilities": [
      "market_order_execution",
      "limit_order_execution",
      "cancel_order",
      "cancel_all_orders",
      "position_liquidation",
      "fund_state_change",
      "notification_emit"
    ],
    "trigger_capabilities": [
      "time_periodic_trigger",
      "scheduled_time_trigger",
      "manual_trigger",
      "condition_trigger"
    ]
  }
}
```

### Capability 작성 규칙

- 소문자 snake_case를 사용한다.
- 내부 함수명 대신 기능명을 쓴다.
- 지원 여부가 불확실하면 `unknown_capability` 대신 `open_questions`에 적는다.
- 각 노드는 자기에게 필요한 capability를 별도로 가진다.

노드 예:

```json
{
  "id": "watch_balance",
  "node_category": "watch",
  "capability_requirements": ["balance_read"]
}
```

---

## 9. `sequences`

전략은 여러 sequence의 합으로 표현한다.

권장 sequence type:

- `INITIALIZATION`: 시작 전 상태 세팅, 잔고 확인, 마켓 선택
- `EXECUTION`: 실제 전략 루프
- `TERMINATION`: 종료, 주문 취소, 포지션 정리, 상태 기록

```json
{
  "sequences": {
    "SEQ_01": {
      "sequence_type": "INITIALIZATION",
      "sequence_name": "초기_상태_확인",
      "summary": "전략 실행 전 잔고, 포지션, 대상 마켓을 확인한다.",
      "entry_node": "trigger_initialize",
      "nodes": {}
    },
    "SEQ_02": {
      "sequence_type": "EXECUTION",
      "sequence_name": "메인_전략_루프",
      "summary": "시장 데이터 관찰 후 진입 또는 청산 여부를 판단한다.",
      "entry_node": "trigger_market_tick",
      "nodes": {}
    },
    "SEQ_03": {
      "sequence_type": "TERMINATION",
      "sequence_name": "전략_종료_처리",
      "summary": "미체결 주문 취소와 포지션 정리 여부를 처리한다.",
      "entry_node": "trigger_shutdown",
      "nodes": {}
    }
  }
}
```

### Sequence 필드

| 필드 | 필수 | 설명 |
|---|---:|---|
| `sequence_type` | Yes | `INITIALIZATION`, `EXECUTION`, `TERMINATION` |
| `sequence_name` | Yes | 사람이 읽을 수 있는 이름 |
| `summary` | Yes | 이 시퀀스의 책임 |
| `entry_node` | Yes | 시작 노드 ID |
| `nodes` | Yes | 노드 object |

---

## 10. 노드 공통 구조

모든 노드는 아래 공통 필드를 가진다.

```json
{
  "id": "node_id",
  "node_number": 1,
  "node_category": "watch",
  "name": "사람이_읽는_노드_이름",
  "intent": "이 노드가 전략상 수행하는 책임",
  "description": "필요하면 더 자세한 설명",
  "capability_requirements": [],
  "inputs": [],
  "outputs": [],
  "state_reads": [],
  "state_writes": [],
  "constraints": {},
  "failure_policy": {},
  "transition": {}
}
```

### 공통 필드 설명

| 필드 | 필수 | 설명 |
|---|---:|---|
| `id` | Yes | 노드 고유 ID |
| `node_number` | Yes | 시퀀스 안에서의 번호 |
| `node_category` | Yes | `trigger`, `watch`, `function`, `action` |
| `name` | Yes | 사람이 읽을 수 있는 이름 |
| `intent` | Yes | 노드의 목적 |
| `description` | No | 부연 설명 |
| `capability_requirements` | Yes | 필요한 추상 기능 |
| `inputs` | Yes | 입력값 목록 |
| `outputs` | Yes | 출력값 목록 |
| `state_reads` | No | 읽는 상태 |
| `state_writes` | No | 쓰는 상태 |
| `constraints` | No | 제약 조건 |
| `failure_policy` | Yes | 실패 처리 |
| `transition` | Yes | 다음 노드 이동 규칙 |

---

## 11. Trigger 노드

Trigger 노드는 시퀀스 또는 흐름을 시작하는 방아쇠다.

### Trigger 예시: 주기 실행

```json
{
  "id": "trigger_market_tick",
  "node_number": 1,
  "node_category": "trigger",
  "name": "시장_데이터_주기_트리거",
  "intent": "정해진 주기마다 시장 데이터 관찰 흐름을 시작한다.",
  "trigger_type": "time_periodic",
  "trigger_config": {
    "interval": "5s",
    "jitter_allowed": false
  },
  "capability_requirements": ["time_periodic_trigger"],
  "inputs": [],
  "outputs": [
    {
      "name": "tick_event",
      "type": "event",
      "meaning": "시장 관찰을 시작하라는 이벤트"
    }
  ],
  "state_reads": [],
  "state_writes": [],
  "failure_policy": {
    "on_failure": "stop_sequence",
    "retry_count": 0
  },
  "transition": {
    "await_current_action": false,
    "routing_mode": "parallel",
    "next_nodes": ["watch_market_price", "watch_orderbook", "watch_balance"],
    "parallel_join": "all_success",
    "timeout_ms": 5000
  }
}
```

### Trigger 예시: 수동 종료

```json
{
  "id": "trigger_shutdown",
  "node_number": 1,
  "node_category": "trigger",
  "name": "수동_종료_트리거",
  "intent": "사용자가 전략 종료를 요청했을 때 종료 시퀀스를 시작한다.",
  "trigger_type": "manual",
  "trigger_config": {
    "manual_command": "shutdown"
  },
  "capability_requirements": ["manual_trigger"],
  "inputs": [],
  "outputs": [
    {
      "name": "shutdown_event",
      "type": "event",
      "meaning": "전략 종료 요청"
    }
  ],
  "failure_policy": {
    "on_failure": "stop_sequence",
    "retry_count": 0
  },
  "transition": {
    "await_current_action": true,
    "routing_mode": "direct",
    "next_nodes": ["action_cancel_open_orders"],
    "timeout_ms": 1000
  }
}
```

---

## 12. Watch 노드

Watch 노드는 외부 또는 내부 상태를 관찰한다. 데이터를 직접 생성하지 않고, 관찰한 값을 구조화된 output으로 내보낸다.

### Watch 예시: 가격 피드 관찰

```json
{
  "id": "watch_market_price",
  "node_number": 2,
  "node_category": "watch",
  "name": "시장_가격_관찰",
  "intent": "대상 자산의 최근 가격과 가격 변화율을 관찰한다.",
  "watch_type": "market_data",
  "watch_method": "websocket_or_polling",
  "capability_requirements": ["price_feed_read", "websocket_subscription", "rest_polling"],
  "inputs": [
    {
      "name": "asset_symbol",
      "source": "global_config.assets",
      "required": true
    },
    {
      "name": "timeframe",
      "source": "global_config.timeframe",
      "required": true
    }
  ],
  "outputs": [
    {
      "name": "last_price",
      "type": "number",
      "meaning": "최근 체결 또는 기준 가격"
    },
    {
      "name": "price_change_pct",
      "type": "number",
      "meaning": "지정 시간 기준 가격 변화율"
    },
    {
      "name": "event_time",
      "type": "timestamp",
      "meaning": "데이터가 관찰된 시각"
    }
  ],
  "state_reads": [],
  "state_writes": ["market_state.last_price"],
  "constraints": {
    "max_data_age_ms": 3000
  },
  "failure_policy": {
    "on_failure": "skip_node",
    "retry_count": 2,
    "retry_backoff_ms": 500
  },
  "transition": {
    "await_current_action": true,
    "routing_mode": "direct",
    "next_nodes": ["function_momentum_signal"],
    "timeout_ms": 3000
  }
}
```

### Watch 예시: 오더북 관찰

```json
{
  "id": "watch_orderbook",
  "node_number": 3,
  "node_category": "watch",
  "name": "오더북_관찰",
  "intent": "대상 마켓의 최우선 호가와 스프레드를 관찰한다.",
  "watch_type": "orderbook",
  "watch_method": "snapshot_or_stream",
  "capability_requirements": ["orderbook_read"],
  "inputs": [
    {
      "name": "market_ref",
      "source": "global_config.markets[0].market_ref",
      "required": true
    }
  ],
  "outputs": [
    {
      "name": "best_bid",
      "type": "number",
      "meaning": "최우선 매수 호가"
    },
    {
      "name": "best_ask",
      "type": "number",
      "meaning": "최우선 매도 호가"
    },
    {
      "name": "spread",
      "type": "number",
      "meaning": "매도 호가와 매수 호가의 차이"
    },
    {
      "name": "liquidity_score",
      "type": "number",
      "meaning": "주문 가능 유동성의 추상 점수"
    }
  ],
  "state_writes": ["market_state.best_bid", "market_state.best_ask", "market_state.spread"],
  "constraints": {
    "max_data_age_ms": 3000
  },
  "failure_policy": {
    "on_failure": "skip_node",
    "retry_count": 2
  },
  "transition": {
    "await_current_action": true,
    "routing_mode": "direct",
    "next_nodes": ["function_entry_decision"],
    "timeout_ms": 3000
  }
}
```

### Watch 예시: 잔고 관찰

```json
{
  "id": "watch_balance",
  "node_number": 4,
  "node_category": "watch",
  "name": "잔고_관찰",
  "intent": "현재 사용 가능한 기준 통화 잔고를 확인한다.",
  "watch_type": "account_state",
  "watch_method": "polling",
  "capability_requirements": ["balance_read"],
  "inputs": [
    {
      "name": "base_currency",
      "source": "global_config.base_currency",
      "required": true
    }
  ],
  "outputs": [
    {
      "name": "available_cash",
      "type": "number",
      "meaning": "주문에 사용할 수 있는 기준 통화 잔고"
    },
    {
      "name": "reserved_cash",
      "type": "number",
      "meaning": "잠겨 있는 잔고"
    }
  ],
  "state_writes": ["balance_state.available_cash", "balance_state.reserved_cash"],
  "failure_policy": {
    "on_failure": "fail_sequence",
    "retry_count": 1
  },
  "transition": {
    "await_current_action": true,
    "routing_mode": "direct",
    "next_nodes": ["function_entry_decision"],
    "timeout_ms": 3000
  }
}
```

---

## 13. Function 노드

Function 노드는 판단, 계산, 분기 값을 만든다. 실제 주문이나 외부 상태 변경을 수행하지 않는다.

### Function 예시: 모멘텀 계산

```json
{
  "id": "function_momentum_signal",
  "node_number": 5,
  "node_category": "function",
  "name": "모멘텀_시그널_계산",
  "intent": "가격 변화율을 기준으로 상승 또는 하락 모멘텀 여부를 판단한다.",
  "function_symbol": "CALC_MOMENTUM_SIGNAL",
  "capability_requirements": ["numeric_calculation", "momentum_calculation", "signal_generation"],
  "inputs": [
    {
      "name": "price_change_pct",
      "source": "watch_market_price.outputs.price_change_pct",
      "required": true
    },
    {
      "name": "momentum_threshold_pct",
      "source": "strategy_parameters.momentum_threshold_pct",
      "required": true
    }
  ],
  "outputs": [
    {
      "name": "momentum_signal",
      "type": "string",
      "allowed_values": ["bullish", "bearish", "neutral"],
      "meaning": "현재 가격 모멘텀 방향"
    }
  ],
  "state_reads": ["market_state.last_price"],
  "state_writes": ["signal_state.momentum_signal"],
  "calculation_policy": {
    "method": "threshold_comparison",
    "description": "가격 변화율이 임계값 이상이면 bullish, 음의 임계값 이하이면 bearish, 그 외 neutral"
  },
  "failure_policy": {
    "on_failure": "fail_node",
    "retry_count": 0
  },
  "transition": {
    "await_current_action": true,
    "routing_mode": "direct",
    "next_nodes": ["function_entry_decision"],
    "timeout_ms": 1000
  }
}
```

### Function 예시: 진입 판단

```json
{
  "id": "function_entry_decision",
  "node_number": 6,
  "node_category": "function",
  "name": "진입_조건_판단",
  "intent": "모멘텀, 오더북, 잔고, 리스크 상태를 종합해 진입 여부를 결정한다.",
  "function_symbol": "EVALUATE_ENTRY_SIGNAL",
  "capability_requirements": ["condition_evaluation", "risk_check", "signal_generation"],
  "inputs": [
    {
      "name": "momentum_signal",
      "source": "signal_state.momentum_signal",
      "required": true
    },
    {
      "name": "spread",
      "source": "market_state.spread",
      "required": true
    },
    {
      "name": "available_cash",
      "source": "balance_state.available_cash",
      "required": true
    },
    {
      "name": "cooldown_active",
      "source": "risk_state.cooldown_active",
      "required": true
    }
  ],
  "outputs": [
    {
      "name": "entry_signal",
      "type": "boolean",
      "meaning": "true이면 진입 액션으로 이동한다."
    },
    {
      "name": "entry_reason",
      "type": "string",
      "meaning": "진입 또는 대기 판단 사유"
    }
  ],
  "state_reads": [
    "signal_state.momentum_signal",
    "market_state.spread",
    "balance_state.available_cash",
    "risk_state.cooldown_active"
  ],
  "state_writes": ["signal_state.entry_signal"],
  "decision_policy": {
    "condition": "momentum_signal == bullish AND spread <= max_spread AND available_cash >= min_cash AND cooldown_active == false"
  },
  "failure_policy": {
    "on_failure": "fail_node",
    "retry_count": 0
  },
  "transition": {
    "await_current_action": true,
    "routing_mode": "conditional",
    "next_nodes": {
      "entry_signal == true": "function_position_size",
      "entry_signal == false": "END_OF_SEQUENCE"
    },
    "timeout_ms": 1000
  }
}
```

### Function 예시: 주문 수량 계산

```json
{
  "id": "function_position_size",
  "node_number": 7,
  "node_category": "function",
  "name": "주문_수량_계산",
  "intent": "가용 잔고와 리스크 한도를 기준으로 진입 주문 수량을 계산한다.",
  "function_symbol": "CALC_POSITION_SIZE",
  "capability_requirements": ["numeric_calculation", "position_sizing", "risk_check"],
  "inputs": [
    {
      "name": "available_cash",
      "source": "balance_state.available_cash",
      "required": true
    },
    {
      "name": "last_price",
      "source": "market_state.last_price",
      "required": true
    },
    {
      "name": "max_cash_usage_pct",
      "source": "strategy_parameters.max_cash_usage_pct",
      "required": true
    }
  ],
  "outputs": [
    {
      "name": "recommended_order_size",
      "type": "number",
      "meaning": "진입 액션에서 사용할 권장 주문 수량"
    },
    {
      "name": "notional_value",
      "type": "number",
      "meaning": "주문 명목 금액"
    }
  ],
  "state_reads": ["balance_state.available_cash", "market_state.last_price"],
  "state_writes": ["risk_state.duplicate_order_guard"],
  "calculation_policy": {
    "method": "cash_fraction_position_sizing",
    "description": "가용 현금의 일정 비율 이내에서 주문 금액을 산정한다."
  },
  "failure_policy": {
    "on_failure": "fail_node",
    "retry_count": 0
  },
  "transition": {
    "await_current_action": true,
    "routing_mode": "conditional",
    "next_nodes": {
      "recommended_order_size > 0": "action_enter_position",
      "recommended_order_size <= 0": "END_OF_SEQUENCE"
    },
    "timeout_ms": 1000
  }
}
```

---

## 14. Action 노드

Action 노드는 전략 상태나 외부 세계에 영향을 주는 동작이다. 주문, 취소, 청산, 알림, 자금 상태 변경 등이 여기에 해당한다.

Action 노드는 반드시 `expected_effect`를 가져야 한다.

### Action 예시: 포지션 진입

```json
{
  "id": "action_enter_position",
  "node_number": 8,
  "node_category": "action",
  "name": "포지션_진입",
  "intent": "진입 조건이 충족되었을 때 대상 마켓에 매수 방향 포지션을 연다.",
  "action_symbol": "EXEC_BUY_MARKET",
  "capability_requirements": ["market_order_execution", "balance_read", "slippage_guard"],
  "inputs": [
    {
      "name": "market_ref",
      "source": "global_config.markets[0].market_ref",
      "required": true
    },
    {
      "name": "recommended_order_size",
      "source": "function_position_size.outputs.recommended_order_size",
      "required": true
    },
    {
      "name": "max_slippage_pct",
      "source": "strategy_parameters.max_slippage_pct",
      "required": true
    }
  ],
  "outputs": [
    {
      "name": "order_request",
      "type": "object",
      "meaning": "주문 요청의 추상 표현"
    },
    {
      "name": "order_result",
      "type": "object",
      "meaning": "주문 요청 이후 확인된 결과"
    }
  ],
  "state_reads": [
    "balance_state.available_cash",
    "market_state.best_ask",
    "risk_state.duplicate_order_guard"
  ],
  "state_writes": [
    "order_state.last_order",
    "position_state.current_position",
    "risk_state.cooldown_active"
  ],
  "expected_effect": {
    "effect_type": "order_execution",
    "position_change": "increase_exposure",
    "cash_change": "decrease_available_cash",
    "open_orders": "may_change"
  },
  "constraints": {
    "max_order_value_usd": 1000,
    "max_slippage_pct": 0.5,
    "duplicate_order_guard_required": true,
    "dry_run_allowed": true
  },
  "failure_policy": {
    "on_failure": "stop_sequence",
    "retry_count": 0,
    "record_failure_event": true
  },
  "transition": {
    "await_current_action": true,
    "routing_mode": "direct",
    "next_nodes": ["watch_position_after_entry"],
    "timeout_ms": 5000
  }
}
```

### Action 예시: 미체결 주문 전체 취소

```json
{
  "id": "action_cancel_open_orders",
  "node_number": 2,
  "node_category": "action",
  "name": "미체결_주문_전체_취소",
  "intent": "전략 종료 또는 리스크 이벤트 발생 시 미체결 주문을 모두 취소한다.",
  "action_symbol": "CANCEL_ALL_ORDERS",
  "capability_requirements": ["open_order_read", "cancel_all_orders"],
  "inputs": [
    {
      "name": "market_ref",
      "source": "global_config.markets[0].market_ref",
      "required": true
    }
  ],
  "outputs": [
    {
      "name": "cancel_result",
      "type": "object",
      "meaning": "취소된 주문 수와 실패한 주문 수"
    }
  ],
  "state_reads": ["order_state.open_orders"],
  "state_writes": ["order_state.open_orders", "order_state.last_order"],
  "expected_effect": {
    "effect_type": "order_cancellation",
    "open_orders": "decrease_or_zero",
    "position_change": "none"
  },
  "constraints": {
    "safe_to_retry": true
  },
  "failure_policy": {
    "on_failure": "retry_node",
    "retry_count": 2,
    "retry_backoff_ms": 1000
  },
  "transition": {
    "await_current_action": true,
    "routing_mode": "direct",
    "next_nodes": ["function_check_liquidation_needed"],
    "timeout_ms": 5000
  }
}
```

### Action 예시: 포지션 청산

```json
{
  "id": "action_liquidate_position",
  "node_number": 9,
  "node_category": "action",
  "name": "포지션_청산",
  "intent": "리스크 조건이 악화되거나 종료 요청이 있을 때 보유 포지션을 정리한다.",
  "action_symbol": "LIQUIDATE_POSITION",
  "capability_requirements": ["position_read", "position_liquidation", "orderbook_read"],
  "inputs": [
    {
      "name": "current_position",
      "source": "position_state.current_position",
      "required": true
    },
    {
      "name": "liquidation_reason",
      "source": "signal_state.exit_signal",
      "required": true
    }
  ],
  "outputs": [
    {
      "name": "liquidation_result",
      "type": "object",
      "meaning": "청산 요청과 결과"
    }
  ],
  "state_reads": ["position_state.current_position", "market_state.best_bid"],
  "state_writes": ["position_state.current_position", "order_state.last_order"],
  "expected_effect": {
    "effect_type": "position_reduction",
    "position_change": "decrease_or_zero",
    "cash_change": "increase_or_unknown"
  },
  "constraints": {
    "dry_run_allowed": true,
    "max_slippage_pct": 1.0
  },
  "failure_policy": {
    "on_failure": "stop_sequence",
    "retry_count": 1,
    "record_failure_event": true
  },
  "transition": {
    "await_current_action": true,
    "routing_mode": "end",
    "next_nodes": ["END_OF_SEQUENCE"],
    "timeout_ms": 10000
  }
}
```

---

## 15. 초기 증거금 및 자금 상태 표현

아키텍처 추출용 JSON에서는 실제 입출금 API 호출을 지정하지 않는다. 자금 이동은 "상태 변화 의도"로 표현한다.

```json
{
  "fund_state_plan": {
    "initial_margin": [
      {
        "venue": "polymarket",
        "asset": "USDC",
        "amount": 1000,
        "state": "available_for_paper_trading",
        "source": "user_defined"
      }
    ],
    "fund_states": {
      "account": "플랫폼 또는 지갑에 존재하는 자금",
      "trading_available": "전략이 주문에 사용할 수 있는 자금",
      "reserved": "미체결 주문 또는 락업으로 사용 불가능한 자금",
      "withdrawable": "전략 종료 후 회수 가능한 자금"
    },
    "movement_intents": [
      {
        "movement_type": "reserve_for_strategy",
        "from_state": "account",
        "to_state": "trading_available",
        "asset": "USDC",
        "amount_policy": "fixed_amount",
        "amount": 1000
      }
    ]
  }
}
```

---

## 16. Risk, Failure, Termination, Observability 권장 필드

이 항목들은 최상위 필수는 아니지만, 실전 전략 설계에서는 강하게 권장한다.

```json
{
  "risk_policy": {
    "max_order_value_usd": 1000,
    "max_position_value_usd": 3000,
    "max_daily_loss_usd": 500,
    "max_slippage_pct": 0.5,
    "cooldown_after_order_sec": 30,
    "duplicate_order_guard": true
  },
  "failure_policy": {
    "default_on_watch_failure": "skip_node",
    "default_on_function_failure": "fail_node",
    "default_on_action_failure": "stop_sequence",
    "automatic_retry": {
      "status": "requires_human_confirmation",
      "ai_proposed_value": false,
      "retry_count": null,
      "retry_backoff_ms": null
    },
    "record_failure_event": true
  },
  "termination_policy": {
    "cancel_open_orders_on_shutdown": true,
    "liquidate_on_shutdown": true,
    "liquidation_scope": "all_strategy_positions",
    "user_may_override": true
  },
  "observability": {
    "log_events": [
      "trigger_fired",
      "watch_updated",
      "signal_generated",
      "order_requested",
      "order_result",
      "risk_blocked",
      "node_failed"
    ],
    "state_snapshots": [
      "balance_state",
      "position_state",
      "order_state",
      "signal_state",
      "risk_state"
    ],
    "audit_trail_required": true
  }
}
```

`automatic_retry`는 사람이 확정해야 한다. AI는 `ai_proposed_value`를 넣을 수 있지만, `status`는 `requires_human_confirmation`으로 두고 `human_review_required`에 같은 항목을 추가한다.

`termination_policy.liquidate_on_shutdown`의 기본값은 `true`다. 사용자가 "종료 시 포지션을 유지한다"고 명시하지 않으면 종료 시퀀스에 포지션 청산 노드를 포함한다.

---

## 17. 전체 예시

아래 예시는 자연어 전략을 아키텍처 추출용 JSON으로 만든 것이다.

전략 설명:

```text
BTC 가격이 최근 5분 동안 0.3% 이상 상승하고, 오더북 스프레드가 충분히 좁고,
가용 USDC가 최소 100 이상이면 포지션에 진입한다.
이미 포지션이 있거나 쿨다운 중이면 진입하지 않는다.
수동 종료가 들어오면 미체결 주문을 취소하고 기본적으로 보유 포지션을 청산한다.
```

생성 JSON:

```json
{
  "document_type": "strategy_architecture_ir",
  "schema_version": "0.2",
  "scope": "architecture_extraction_only",
  "strategy_goal": {
    "name": "BTC_5분_모멘텀_진입_전략",
    "objective": "BTC 단기 상승 모멘텀이 확인될 때 제한된 리스크로 진입한다.",
    "profit_logic": "가격 상승 모멘텀과 좁은 스프레드가 동시에 나타나는 구간에서 진입해 유리한 방향 노출을 확보한다.",
    "risk_logic": "최소 잔고, 중복 진입 방지, 쿨다운, 스프레드 제한을 통해 불리한 체결과 과도한 노출을 방지한다.",
    "primary_loop": "가격 관찰 -> 오더북 관찰 -> 잔고/포지션 관찰 -> 진입 판단 -> 주문 수량 계산 -> 진입 액션",
    "scope_note": "이 명세는 실행 코드가 아니라 아키텍처 추출용 중간 표현이다."
  },
  "global_config": {
    "execution_mode": "paper",
    "venue_scope": "single_exchange",
    "exchanges": [
      {
        "exchange_id": "polymarket",
        "exchange_type": "DEX",
        "role": "primary_execution_venue"
      }
    ],
    "assets": [
      {
        "symbol": "BTC",
        "role": "reference_asset"
      },
      {
        "symbol": "USDC",
        "role": "base_currency"
      }
    ],
    "markets": [
      {
        "market_ref": "btc_5m_direction_market",
        "market_type": "prediction_market",
        "base_asset": "BTC",
        "quote_asset": "USDC",
        "selection_rule": "현재 거래 가능한 BTC 5분 방향성 마켓"
      }
    ],
    "timeframe": "5m",
    "base_currency": "USDC",
    "dry_run_required": true
  },
  "state_model": {
    "balance_state": {
      "available_cash": "현재 주문에 사용할 수 있는 USDC",
      "reserved_cash": "미체결 주문 등으로 잠긴 USDC"
    },
    "position_state": {
      "current_position": "현재 보유 포지션",
      "position_value": "현재 포지션 평가액"
    },
    "order_state": {
      "open_orders": "미체결 주문 목록",
      "last_order": "마지막 주문 요청과 결과"
    },
    "market_state": {
      "last_price": "최근 BTC 기준 가격",
      "price_change_pct": "최근 5분 가격 변화율",
      "best_bid": "최우선 매수 호가",
      "best_ask": "최우선 매도 호가",
      "spread": "오더북 스프레드"
    },
    "signal_state": {
      "momentum_signal": "모멘텀 판단 결과",
      "entry_signal": "진입 가능 여부",
      "exit_signal": "청산 필요 여부"
    },
    "risk_state": {
      "cooldown_active": "최근 주문 이후 대기 중인지 여부",
      "duplicate_order_guard": "중복 진입 방지 상태"
    }
  },
  "transition_semantics": {
    "routing_modes": {
      "direct": "하나의 다음 노드로 이동한다.",
      "conditional": "조건 평가 결과에 따라 다음 노드를 선택한다.",
      "parallel": "여러 노드를 병렬로 시작한다.",
      "end": "현재 시퀀스를 종료한다."
    },
    "await_policy": {
      "sync": "현재 노드 결과를 확인한 뒤 다음 노드로 이동한다.",
      "async": "현재 노드 완료를 기다리지 않고 다음 노드로 이동한다."
    },
    "timeout_policy": {
      "default_timeout_ms": 5000,
      "on_timeout": "fail_node"
    },
    "parallel_policy": {
      "join_mode": "all_success",
      "on_partial_failure": "fail_sequence"
    },
    "condition_policy": {
      "condition_language": "human_readable_boolean_expression",
      "unknown_condition_policy": "record_open_question"
    }
  },
  "capability_requirements": {
    "watch_capabilities": [
      "price_feed_read",
      "orderbook_read",
      "balance_read",
      "position_read",
      "open_order_read"
    ],
    "function_capabilities": [
      "momentum_calculation",
      "condition_evaluation",
      "risk_check",
      "position_sizing"
    ],
    "action_capabilities": [
      "market_order_execution",
      "cancel_all_orders",
      "position_liquidation"
    ],
    "trigger_capabilities": [
      "time_periodic_trigger",
      "manual_trigger"
    ]
  },
  "ai_decision_policy": {
    "default_mode": "ai_fills_first_human_reviews_after",
    "human_must_confirm": [
      "automatic_retry_policy",
      "ai_added_strategy_logic_alignment",
      "live_deployment_approval"
    ],
    "termination_defaults": {
      "cancel_open_orders_on_shutdown": true,
      "liquidate_on_shutdown": true
    }
  },
  "risk_policy": {
    "min_available_cash": 100,
    "max_spread_pct": 0.4,
    "momentum_threshold_pct": 0.3,
    "max_order_value_usd": 1000,
    "cooldown_after_order_sec": 30,
    "duplicate_order_guard": true
  },
  "failure_policy": {
    "default_on_watch_failure": "skip_node",
    "default_on_function_failure": "fail_node",
    "default_on_action_failure": "stop_sequence",
    "automatic_retry": {
      "status": "requires_human_confirmation",
      "ai_proposed_value": false,
      "retry_count": null,
      "retry_backoff_ms": null
    },
    "record_failure_event": true
  },
  "termination_policy": {
    "cancel_open_orders_on_shutdown": true,
    "liquidate_on_shutdown": true,
    "liquidation_scope": "all_strategy_positions",
    "user_may_override": true
  },
  "sequences": {
    "SEQ_01": {
      "sequence_type": "EXECUTION",
      "sequence_name": "메인_진입_판단_루프",
      "summary": "주기적으로 가격, 오더북, 잔고, 포지션을 관찰하고 진입 여부를 판단한다.",
      "entry_node": "trigger_market_tick",
      "nodes": {
        "trigger_market_tick": {
          "id": "trigger_market_tick",
          "node_number": 1,
          "node_category": "trigger",
          "name": "시장_틱_트리거",
          "intent": "5초마다 메인 진입 판단 흐름을 시작한다.",
          "trigger_type": "time_periodic",
          "trigger_config": {
            "interval": "5s"
          },
          "capability_requirements": ["time_periodic_trigger"],
          "inputs": [],
          "outputs": [
            {
              "name": "tick_event",
              "type": "event",
              "meaning": "진입 판단 루프 시작 이벤트"
            }
          ],
          "failure_policy": {
            "on_failure": "stop_sequence",
            "retry_count": 0
          },
          "transition": {
            "await_current_action": false,
            "routing_mode": "parallel",
            "next_nodes": [
              "watch_market_price",
              "watch_orderbook",
              "watch_balance",
              "watch_position"
            ],
            "parallel_join": "all_success",
            "timeout_ms": 5000
          }
        },
        "watch_market_price": {
          "id": "watch_market_price",
          "node_number": 2,
          "node_category": "watch",
          "name": "BTC_가격_관찰",
          "intent": "BTC 최근 가격과 5분 변화율을 관찰한다.",
          "watch_type": "market_data",
          "watch_method": "websocket_or_polling",
          "capability_requirements": ["price_feed_read"],
          "inputs": [
            {
              "name": "asset_symbol",
              "source": "global_config.assets[0].symbol",
              "required": true
            }
          ],
          "outputs": [
            {
              "name": "last_price",
              "type": "number",
              "meaning": "최근 BTC 기준 가격"
            },
            {
              "name": "price_change_pct",
              "type": "number",
              "meaning": "최근 5분 BTC 가격 변화율"
            }
          ],
          "state_writes": ["market_state.last_price", "market_state.price_change_pct"],
          "failure_policy": {
            "on_failure": "skip_node",
            "retry_count": 2
          },
          "transition": {
            "await_current_action": true,
            "routing_mode": "direct",
            "next_nodes": ["function_momentum_signal"],
            "timeout_ms": 3000
          }
        },
        "watch_orderbook": {
          "id": "watch_orderbook",
          "node_number": 3,
          "node_category": "watch",
          "name": "오더북_관찰",
          "intent": "진입 전 스프레드와 유동성 상태를 관찰한다.",
          "watch_type": "orderbook",
          "watch_method": "snapshot_or_stream",
          "capability_requirements": ["orderbook_read"],
          "inputs": [
            {
              "name": "market_ref",
              "source": "global_config.markets[0].market_ref",
              "required": true
            }
          ],
          "outputs": [
            {
              "name": "best_bid",
              "type": "number",
              "meaning": "최우선 매수 호가"
            },
            {
              "name": "best_ask",
              "type": "number",
              "meaning": "최우선 매도 호가"
            },
            {
              "name": "spread",
              "type": "number",
              "meaning": "오더북 스프레드"
            }
          ],
          "state_writes": ["market_state.best_bid", "market_state.best_ask", "market_state.spread"],
          "failure_policy": {
            "on_failure": "skip_node",
            "retry_count": 2
          },
          "transition": {
            "await_current_action": true,
            "routing_mode": "direct",
            "next_nodes": ["function_entry_decision"],
            "timeout_ms": 3000
          }
        },
        "watch_balance": {
          "id": "watch_balance",
          "node_number": 4,
          "node_category": "watch",
          "name": "잔고_관찰",
          "intent": "진입 가능 여부 판단에 필요한 가용 USDC를 관찰한다.",
          "watch_type": "account_state",
          "watch_method": "polling",
          "capability_requirements": ["balance_read"],
          "inputs": [
            {
              "name": "base_currency",
              "source": "global_config.base_currency",
              "required": true
            }
          ],
          "outputs": [
            {
              "name": "available_cash",
              "type": "number",
              "meaning": "주문 가능한 USDC"
            }
          ],
          "state_writes": ["balance_state.available_cash"],
          "failure_policy": {
            "on_failure": "fail_sequence",
            "retry_count": 1
          },
          "transition": {
            "await_current_action": true,
            "routing_mode": "direct",
            "next_nodes": ["function_entry_decision"],
            "timeout_ms": 3000
          }
        },
        "watch_position": {
          "id": "watch_position",
          "node_number": 5,
          "node_category": "watch",
          "name": "포지션_관찰",
          "intent": "이미 포지션을 보유 중인지 확인한다.",
          "watch_type": "position_state",
          "watch_method": "polling",
          "capability_requirements": ["position_read"],
          "inputs": [
            {
              "name": "market_ref",
              "source": "global_config.markets[0].market_ref",
              "required": true
            }
          ],
          "outputs": [
            {
              "name": "current_position",
              "type": "object",
              "meaning": "현재 보유 포지션"
            }
          ],
          "state_writes": ["position_state.current_position"],
          "failure_policy": {
            "on_failure": "fail_sequence",
            "retry_count": 1
          },
          "transition": {
            "await_current_action": true,
            "routing_mode": "direct",
            "next_nodes": ["function_entry_decision"],
            "timeout_ms": 3000
          }
        },
        "function_momentum_signal": {
          "id": "function_momentum_signal",
          "node_number": 6,
          "node_category": "function",
          "name": "모멘텀_시그널_계산",
          "intent": "5분 가격 변화율이 진입 임계값 이상인지 판단한다.",
          "function_symbol": "CALC_MOMENTUM_SIGNAL",
          "capability_requirements": ["momentum_calculation", "signal_generation"],
          "inputs": [
            {
              "name": "price_change_pct",
              "source": "watch_market_price.outputs.price_change_pct",
              "required": true
            },
            {
              "name": "momentum_threshold_pct",
              "source": "risk_policy.momentum_threshold_pct",
              "required": true
            }
          ],
          "outputs": [
            {
              "name": "momentum_signal",
              "type": "string",
              "allowed_values": ["bullish", "neutral"],
              "meaning": "진입 판단에 사용할 모멘텀 상태"
            }
          ],
          "state_writes": ["signal_state.momentum_signal"],
          "calculation_policy": {
            "method": "threshold_comparison",
            "condition": "price_change_pct >= momentum_threshold_pct"
          },
          "failure_policy": {
            "on_failure": "fail_node",
            "retry_count": 0
          },
          "transition": {
            "await_current_action": true,
            "routing_mode": "direct",
            "next_nodes": ["function_entry_decision"],
            "timeout_ms": 1000
          }
        },
        "function_entry_decision": {
          "id": "function_entry_decision",
          "node_number": 7,
          "node_category": "function",
          "name": "진입_조건_판단",
          "intent": "모멘텀, 스프레드, 잔고, 포지션, 쿨다운 상태를 종합해 진입 여부를 결정한다.",
          "function_symbol": "EVALUATE_ENTRY_SIGNAL",
          "capability_requirements": ["condition_evaluation", "risk_check", "signal_generation"],
          "inputs": [
            {
              "name": "momentum_signal",
              "source": "signal_state.momentum_signal",
              "required": true
            },
            {
              "name": "spread",
              "source": "market_state.spread",
              "required": true
            },
            {
              "name": "available_cash",
              "source": "balance_state.available_cash",
              "required": true
            },
            {
              "name": "current_position",
              "source": "position_state.current_position",
              "required": true
            },
            {
              "name": "cooldown_active",
              "source": "risk_state.cooldown_active",
              "required": true
            }
          ],
          "outputs": [
            {
              "name": "entry_signal",
              "type": "boolean",
              "meaning": "true이면 진입 주문 수량 계산으로 이동한다."
            },
            {
              "name": "entry_reason",
              "type": "string",
              "meaning": "진입 또는 대기 판단 사유"
            }
          ],
          "state_reads": [
            "signal_state.momentum_signal",
            "market_state.spread",
            "balance_state.available_cash",
            "position_state.current_position",
            "risk_state.cooldown_active"
          ],
          "state_writes": ["signal_state.entry_signal"],
          "decision_policy": {
            "condition": "momentum_signal == bullish AND spread <= max_spread_pct AND available_cash >= min_available_cash AND current_position is empty AND cooldown_active == false"
          },
          "failure_policy": {
            "on_failure": "fail_node",
            "retry_count": 0
          },
          "transition": {
            "await_current_action": true,
            "routing_mode": "conditional",
            "next_nodes": {
              "entry_signal == true": "function_position_size",
              "entry_signal == false": "END_OF_SEQUENCE"
            },
            "timeout_ms": 1000
          }
        },
        "function_position_size": {
          "id": "function_position_size",
          "node_number": 8,
          "node_category": "function",
          "name": "주문_수량_계산",
          "intent": "가용 잔고와 최대 주문 금액 제한을 기준으로 주문 수량을 산정한다.",
          "function_symbol": "CALC_POSITION_SIZE",
          "capability_requirements": ["position_sizing", "risk_check"],
          "inputs": [
            {
              "name": "available_cash",
              "source": "balance_state.available_cash",
              "required": true
            },
            {
              "name": "max_order_value_usd",
              "source": "risk_policy.max_order_value_usd",
              "required": true
            }
          ],
          "outputs": [
            {
              "name": "recommended_order_size",
              "type": "number",
              "meaning": "진입 액션에 전달할 주문 수량"
            }
          ],
          "state_reads": ["balance_state.available_cash"],
          "state_writes": ["risk_state.duplicate_order_guard"],
          "calculation_policy": {
            "method": "min_available_cash_and_max_order_value",
            "description": "가용 잔고와 최대 주문 금액 중 작은 값을 기준으로 주문 가능 금액을 산정한다."
          },
          "failure_policy": {
            "on_failure": "fail_node",
            "retry_count": 0
          },
          "transition": {
            "await_current_action": true,
            "routing_mode": "conditional",
            "next_nodes": {
              "recommended_order_size > 0": "action_enter_position",
              "recommended_order_size <= 0": "END_OF_SEQUENCE"
            },
            "timeout_ms": 1000
          }
        },
        "action_enter_position": {
          "id": "action_enter_position",
          "node_number": 9,
          "node_category": "action",
          "name": "포지션_진입",
          "intent": "진입 조건이 충족되면 paper mode에서 매수 방향 포지션 진입을 요청한다.",
          "action_symbol": "EXEC_BUY_MARKET",
          "capability_requirements": ["market_order_execution"],
          "inputs": [
            {
              "name": "market_ref",
              "source": "global_config.markets[0].market_ref",
              "required": true
            },
            {
              "name": "recommended_order_size",
              "source": "function_position_size.outputs.recommended_order_size",
              "required": true
            }
          ],
          "outputs": [
            {
              "name": "order_result",
              "type": "object",
              "meaning": "진입 주문 요청 결과"
            }
          ],
          "state_reads": ["balance_state.available_cash", "risk_state.duplicate_order_guard"],
          "state_writes": ["order_state.last_order", "position_state.current_position", "risk_state.cooldown_active"],
          "expected_effect": {
            "effect_type": "order_execution",
            "position_change": "increase_exposure",
            "cash_change": "decrease_available_cash",
            "open_orders": "may_change"
          },
          "constraints": {
            "dry_run_allowed": true,
            "duplicate_order_guard_required": true
          },
          "failure_policy": {
            "on_failure": "stop_sequence",
            "retry_count": 0,
            "record_failure_event": true
          },
          "transition": {
            "await_current_action": true,
            "routing_mode": "end",
            "next_nodes": ["END_OF_SEQUENCE"],
            "timeout_ms": 5000
          }
        }
      }
    },
    "SEQ_02": {
      "sequence_type": "TERMINATION",
      "sequence_name": "수동_종료_처리",
      "summary": "사용자가 종료를 요청하면 미체결 주문을 취소하고 기본적으로 보유 포지션을 청산한다.",
      "entry_node": "trigger_shutdown",
      "nodes": {
        "trigger_shutdown": {
          "id": "trigger_shutdown",
          "node_number": 1,
          "node_category": "trigger",
          "name": "수동_종료_트리거",
          "intent": "사용자 종료 요청을 받아 종료 시퀀스를 시작한다.",
          "trigger_type": "manual",
          "trigger_config": {
            "manual_command": "shutdown"
          },
          "capability_requirements": ["manual_trigger"],
          "inputs": [],
          "outputs": [
            {
              "name": "shutdown_event",
              "type": "event",
              "meaning": "종료 요청 이벤트"
            }
          ],
          "failure_policy": {
            "on_failure": "stop_sequence",
            "retry_count": 0
          },
          "transition": {
            "await_current_action": true,
            "routing_mode": "direct",
            "next_nodes": ["action_cancel_open_orders"],
            "timeout_ms": 1000
          }
        },
        "action_cancel_open_orders": {
          "id": "action_cancel_open_orders",
          "node_number": 2,
          "node_category": "action",
          "name": "미체결_주문_취소",
          "intent": "전략 종료 전 미체결 주문을 모두 취소한다.",
          "action_symbol": "CANCEL_ALL_ORDERS",
          "capability_requirements": ["open_order_read", "cancel_all_orders"],
          "inputs": [
            {
              "name": "market_ref",
              "source": "global_config.markets[0].market_ref",
              "required": true
            }
          ],
          "outputs": [
            {
              "name": "cancel_result",
              "type": "object",
              "meaning": "취소 처리 결과"
            }
          ],
          "state_reads": ["order_state.open_orders"],
          "state_writes": ["order_state.open_orders"],
          "expected_effect": {
            "effect_type": "order_cancellation",
            "open_orders": "decrease_or_zero",
            "position_change": "none"
          },
          "failure_policy": {
            "on_failure": "stop_sequence",
            "automatic_retry": {
              "status": "requires_human_confirmation",
              "ai_proposed_value": false,
              "retry_count": null,
              "retry_backoff_ms": null
            }
          },
          "transition": {
            "await_current_action": true,
            "routing_mode": "direct",
            "next_nodes": ["action_liquidate_position"],
            "timeout_ms": 5000
          }
        },
        "action_liquidate_position": {
          "id": "action_liquidate_position",
          "node_number": 3,
          "node_category": "action",
          "name": "보유_포지션_청산",
          "intent": "종료 시 기본 정책에 따라 전략이 보유한 포지션을 정리한다.",
          "action_symbol": "LIQUIDATE_POSITION",
          "capability_requirements": ["position_read", "position_liquidation", "orderbook_read"],
          "inputs": [
            {
              "name": "current_position",
              "source": "position_state.current_position",
              "required": true
            },
            {
              "name": "liquidation_policy",
              "source": "termination_policy.liquidate_on_shutdown",
              "required": true
            }
          ],
          "outputs": [
            {
              "name": "liquidation_result",
              "type": "object",
              "meaning": "종료 시 포지션 청산 결과"
            }
          ],
          "state_reads": ["position_state.current_position", "market_state.best_bid"],
          "state_writes": ["position_state.current_position", "order_state.last_order"],
          "expected_effect": {
            "effect_type": "position_reduction",
            "position_change": "decrease_or_zero",
            "cash_change": "increase_or_unknown"
          },
          "constraints": {
            "dry_run_allowed": true
          },
          "failure_policy": {
            "on_failure": "stop_sequence",
            "automatic_retry": {
              "status": "requires_human_confirmation",
              "ai_proposed_value": false,
              "retry_count": null,
              "retry_backoff_ms": null
            }
          },
          "transition": {
            "await_current_action": true,
            "routing_mode": "end",
            "next_nodes": ["END_OF_SEQUENCE"],
            "timeout_ms": 10000
          }
        }
      }
    }
  },
  "assumptions": [
    {
      "path": "risk_policy.max_order_value_usd",
      "assumption": "사용자가 최대 주문 금액을 명시하지 않아 AI가 보수적 초안으로 1000 USDC를 제안했다.",
      "source": "ai_inferred"
    },
    {
      "path": "termination_policy.liquidate_on_shutdown",
      "assumption": "사용자가 종료 시 포지션 유지 의사를 명시하지 않았으므로 기본값인 청산 정책을 적용했다.",
      "source": "default_policy"
    }
  ],
  "ai_filled_fields": [
    {
      "path": "risk_state.cooldown_active",
      "value": "최근 주문 이후 대기 중인지 여부",
      "source": "ai_inferred",
      "reason": "반복 실행 전략에서 중복 진입을 막기 위해 필요하다.",
      "certainty": "high",
      "requires_human_review": false
    },
    {
      "path": "risk_policy.max_order_value_usd",
      "value": 1000,
      "source": "ai_inferred",
      "reason": "사용자가 주문 금액 제한을 명시하지 않아 보수적 기본 제한을 추가했다.",
      "certainty": "medium",
      "requires_human_review": false
    },
    {
      "path": "termination_policy.liquidate_on_shutdown",
      "value": true,
      "source": "default_policy",
      "reason": "종료 시 포지션은 기본적으로 청산한다는 정책을 적용했다.",
      "certainty": "high",
      "requires_human_review": false
    }
  ],
  "human_review_required": [
    {
      "path": "failure_policy.automatic_retry",
      "question": "주문 실행 실패 시 자동 재시도를 허용할 것인가?",
      "risk_if_wrong": "재시도가 켜져 있으면 중복 주문이나 의도보다 큰 노출이 생길 수 있고, 꺼져 있으면 일시적 오류에도 전략이 멈출 수 있다."
    },
    {
      "path": "approval_state.ai_added_strategy_logic_reviewed",
      "question": "AI가 추가한 전략 로직이 원래 의도와 일치하는가?",
      "risk_if_wrong": "전략이 사용자의 원래 아이디어와 다르게 작동할 수 있다."
    },
    {
      "path": "approval_state.live_mode_approved",
      "question": "이 전략을 live mode로 배포해도 되는가?",
      "risk_if_wrong": "실제 자금 손실이 발생할 수 있다."
    }
  ],
  "approval_state": {
    "ai_added_strategy_logic_reviewed": false,
    "automatic_retry_policy_approved": false,
    "paper_mode_approved": false,
    "live_mode_approved": false
  },
  "implementation_readiness": {
    "status": "review_required",
    "paper_mode_possible": true,
    "live_mode_possible": false,
    "blocking_reviews": [
      "failure_policy.automatic_retry",
      "approval_state.ai_added_strategy_logic_reviewed",
      "approval_state.live_mode_approved"
    ]
  },
  "open_questions": [
    "진입 후 익절/손절 조건이 원문에 명시되어 있지 않다.",
    "시장가 주문의 허용 슬리피지 기준이 원문에 명시되어 있지 않다."
  ]
}
```

---

## 18. AI에게 줄 Instruction Template

아래 문장을 AI에게 함께 제공하면 된다.

```text
너는 퀀트 전략 설명을 Strategy Architecture IR JSON으로 변환하는 아키텍처 분석가다.

목표:
- 사용자의 자연어 전략 설명을 Watch-Effect 구조에 맞는 JSON으로 변환하라.
- 이 JSON은 코드 생성 명세가 아니라 architecture_extraction_only 중간 표현이다.

반드시 지킬 규칙:
- 최상위 JSON object 하나만 출력하라.
- document_type은 strategy_architecture_ir로 설정하라.
- scope는 architecture_extraction_only로 설정하라.
- strategy_goal, global_config, state_model, transition_semantics, capability_requirements, ai_decision_policy, sequences, assumptions, ai_filled_fields, human_review_required, approval_state, implementation_readiness, open_questions를 반드시 포함하라.
- 노드는 trigger, watch, function, action 중 하나로 분류하라.
- 각 노드에는 id, node_number, node_category, name, intent, capability_requirements, inputs, outputs, failure_policy, transition을 포함하라.
- 구현 함수명, SDK 호출명, 파일 경로, private key, API secret, Docker 설정을 넣지 마라.
- 지원 여부가 불확실한 기능은 임의로 구현 가능하다고 쓰지 말고 open_questions에 기록하라.
- 사용자가 명시하지 않은 값 중 전략 아키텍처 완성에 필요한 값은 AI가 먼저 보수적으로 채워라.
- AI가 채운 모든 값은 ai_filled_fields에 path, value, source, reason, certainty, requires_human_review와 함께 기록하라.
- 사람이 작성하지 않은 값이라도 자동 재시도 여부를 제외한 대부분의 설계값은 AI가 먼저 정할 수 있다.
- 자동 재시도 여부와 재시도 횟수는 사람이 확정해야 하므로 failure_policy.automatic_retry.status를 requires_human_confirmation으로 두고 human_review_required에 추가하라.
- 종료 시 포지션 처리 기본값은 liquidate_on_shutdown: true다. 사용자가 포지션 유지라고 명시하지 않으면 종료 시퀀스에 미체결 주문 취소와 포지션 청산을 포함하라.
- AI가 추가한 전략 로직의 원래 의도 부합 여부는 approval_state.ai_added_strategy_logic_reviewed로 따로 확인받아라.
- live mode 배포 승인은 approval_state.live_mode_approved로 따로 확인받아라.
- action 노드에는 expected_effect를 반드시 포함하라.
- transition에는 routing_mode, await_current_action, next_nodes, timeout_ms를 가능한 한 명시하라.
- JSON은 파싱 가능한 순수 JSON이어야 한다. 주석과 trailing comma를 사용하지 마라.
```

---

## 19. 검증 체크리스트

JSON을 생성한 뒤 아래 항목을 확인한다.

- `document_type == "strategy_architecture_ir"`인가?
- `scope == "architecture_extraction_only"`인가?
- 최상위 필수 필드가 모두 있는가?
- `ai_decision_policy`, `assumptions`, `ai_filled_fields`, `human_review_required`, `approval_state`, `implementation_readiness`, `open_questions`가 있는가?
- 모든 sequence에 `sequence_type`, `sequence_name`, `summary`, `entry_node`, `nodes`가 있는가?
- 모든 노드 ID가 고유한가?
- 모든 노드의 `node_category`가 `trigger`, `watch`, `function`, `action` 중 하나인가?
- 모든 노드가 `intent`를 가지고 있는가?
- 모든 노드가 `capability_requirements`를 가지고 있는가?
- 모든 action 노드가 `expected_effect`를 가지고 있는가?
- 모든 transition의 `next_nodes`가 존재하는 노드 또는 `END_OF_SEQUENCE`를 가리키는가?
- 코드 함수명이나 SDK 호출명이 들어가지 않았는가?
- 인증 정보나 private key가 들어가지 않았는가?
- AI가 채운 값이 `ai_filled_fields`에 기록되었는가?
- 자동 재시도 여부가 `human_review_required`에 들어갔는가?
- 사용자가 다르게 명시하지 않은 경우 종료 시퀀스에 포지션 청산 노드가 포함되어 있는가?
- AI가 추가한 전략 로직 검수와 live 배포 승인이 `approval_state`에 분리되어 있는가?
- AI가 보수적으로도 정하기 어려운 값이 `open_questions`에 기록되었는가?

---

## 20. 구현 단계와의 관계

이 문서의 JSON은 1단계 산출물이다.

```text
1. 자연어 전략 설명
2. Strategy Architecture IR JSON
3. Capability 지원 여부 검토
4. Implementation Profile 추가
5. Hershy/Hersh/cctx 기반 코드 생성
6. Paper mode 검증
7. Live mode 전환 검토
```

따라서 이 JSON 안에 구현 함수명을 넣지 않는다. 구현 단계에서 별도의 `implementation_profile` 또는 `capability_binding` 문서를 추가해 실제 런타임과 연결한다.
