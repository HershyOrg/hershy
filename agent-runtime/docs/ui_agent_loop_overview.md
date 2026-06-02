# Front UI and Agent Loop Overview

이 문서는 `front/` 폴더의 UI와 에이전트 루프를 동료 개발자와 비개발자가 함께 이해할 수 있도록 정리한 문서입니다.

정리 기준은 CCTX 문서와 비슷하게, 각 의미론적 구현 모듈을 **개요 -> 기능 -> 주요 입출력 -> 아키텍처** 순서로 설명합니다.

## 전체 개요

`front/`는 Next.js 앱과 Express 커스텀 서버를 함께 실행합니다. 사용자는 자연어로 전략을 요청하고, 서버는 리서치/검증/코드 생성 루프를 거쳐 `hershy-strategy-graph`를 만들며, 프론트는 이 그래프를 쉬운 보기, 고급 보기, 코드 보기로 투영합니다.

```text
사용자 프롬프트 또는 템플릿 선택
  -> front/app/page.tsx
  -> POST /api/ai/agentic-strategy-loop 또는 /api/ai/strategy-draft-stream
  -> 서버 AI/리서치/검증/코드 생성 루프
  -> hershy-strategy-graph
  -> front/features/strategy-graph/easyViewAgent.ts
  -> EasyViewModel + AdvancedGraph + generated_strategy.go
  -> EasyStrategyGraph / NodeEditor / Code view
```

가장 중요한 원칙은 다음입니다.

- UI에 보이는 시퀀스는 실제 트레이딩 로직만 포함합니다.
- 프롬프트 해석, 웹 검색, KG/RAG 검색, 후보 랭킹, solver, check-effect 같은 AI 내부 단계는 화면 시퀀스로 렌더링하지 않습니다.
- 사용자의 자금이 움직이는 순서가 있는 작업은 순차 실행으로 표현합니다.
- 서로 다른 시퀀스 안의 노드는 직접 연결하지 않습니다.
- 고급 보기의 visual artifact, 예를 들어 생성된 코드 블록은 runtime strategy graph로 역변환하지 않습니다.

## 핵심 데이터 모델

### 개요

프론트와 서버가 공유하는 중심 산출물은 `hershy-strategy-graph`입니다. 이 그래프는 "AI가 어떻게 생각했는지"가 아니라 "실제로 어떤 시장 데이터를 읽고, 어떤 조건을 확인하고, 어떤 액션을 실행할지"를 표현합니다.

### 기능

- 전략을 `blocks`와 `connections`로 표현합니다.
- `metadata.workflowGroups`로 시퀀스/그룹 경계를 표현합니다.
- `metadata.strategyBlock`으로 전체 전략 컨테이너를 표시합니다.
- easy view, advanced view, code view의 공통 원본 역할을 합니다.
- Go validator와 codegen의 입력으로 사용됩니다.

### 주요 입출력

대표 입력/출력 모델:

```ts
type StrategyGraphPayload = {
  schemaVersion?: number;
  kind?: "hershy-strategy-graph";
  strategy?: {
    id?: string;
    name?: string;
  };
  metadata?: Record<string, unknown>;
  blocks?: StrategyGraphBlock[];
  connections?: StrategyGraphConnection[];
};
```

대표 block type:

- `streaming`: 외부 REST/WSS/RPC/시장 데이터 피드
- `normal`: 계산값, indicator, fixed parameter, 중간 상태
- `trigger`: 시간/조건/수동 실행 조건
- `action`: CEX 주문, DEX 거래, 온체인 함수 호출, custom effect
- `monitoring`: 차트, 로그, 상태 관측

대표 connection kind:

- `data-flow`: 데이터나 계산값 전달
- `action-input`: 액션 파라미터 입력
- `trigger-action`: 트리거가 액션 실행을 허용
- `action-result`: 액션 결과를 후속 확인/모니터링으로 전달
- `stream-monitor`: 스트리밍 값을 관측 UI로 전달

### 아키텍처

```text
AI/서버 루프
  -> StrategyGraphPayload
  -> easyViewAgent.ts
       -> EasyViewModel
       -> AdvancedGraph
       -> strategyGraphToCode()
  -> UI 렌더링
  -> 사용자가 고급 보기에서 편집
  -> advancedGraphToStrategyGraph()
  -> runtime-artifacts/codegen
```

관련 파일:

- `front/features/strategy-graph/easyViewAgent.ts`
- `front/app/page.tsx`
- `front/server.mjs`

## 1. 사용자 입력과 홈 워크스페이스 모듈

### 개요

사용자 입력 모듈은 현재 프론트의 제품 레벨 컨트롤 타워입니다. 자연어 프롬프트, 추천 템플릿, 거래소 연결, 보기 전환, 히스토리 스냅샷, agent activity를 한 화면에서 연결합니다.

핵심 파일은 `front/app/page.tsx`입니다.

### 기능

- 사용자의 자연어 전략 요청을 수집합니다.
- 추천 AI 템플릿 클릭을 전략 생성 요청으로 바꿉니다.
- 쉬운 보기, 고급 보기, 코드 보기 상태를 관리합니다.
- 거래소/RPC 연결 여부를 서버 요청 payload에 포함합니다.
- agent activity를 우측 rail에 표시합니다.
- 생성된 `EasyViewModel`, `AdvancedGraph`, `programCode`를 화면 상태에 반영합니다.
- 고급 보기에서 수정된 그래프를 다시 strategy graph로 역변환합니다.
- strategy history snapshot을 저장하고 로드합니다.

### 주요 입출력

입력:

- 사용자 프롬프트 문자열
- 추천 템플릿 ID와 템플릿 prompt
- 현재 선택된 거래소/RPC 연결 정보
- 현재 열려 있는 전략 snapshot
- 현재 보기 상태: `easy`, `advanced`, `code`
- 사용자 ID: `X-Hershy-User-ID`, `user_id`

출력:

- `agentActivities`: 요청 접수, 리서치, 검증, runtime artifact 생성 상태
- `easyViewModel`: 쉬운 보기용 전략 카드/흐름
- `advancedGraphModel`: React Flow 기반 고급 보기 그래프
- `generatedCode`: strategy graph를 사람이 읽을 수 있게 변환한 코드형 문자열
- `programCode`: Go codegen 결과인 `generated_strategy.go`
- history snapshot과 `loadSnapshot`, `runAutoLayout` 브라우저 이벤트

### 아키텍처

```text
사용자 입력
  -> app/page.tsx
  -> runRemoteAgentPrompt()
  -> /api/ai/agentic-strategy-loop
  -> runEasyViewGraphAgentLoop()
  -> setEasyViewModel()
  -> setAdvancedGraphModel()
  -> historyStore.updateActiveSnapshot()
  -> NodeEditor / EasyStrategyGraph / Code view
```

관련 파일:

- `front/app/page.tsx`
- `front/features/home/PageRightRail.tsx`
- `front/features/home/config.ts`
- `front/features/home/ExchangeLibraryModal.tsx`
- `front/features/home/StrategyLibraryWorkspace.tsx`
- `front/features/home/PortfolioWorkspace.tsx`

## 2. 서버 API 게이트웨이 모듈

### 개요

서버 API 게이트웨이는 `front/server.mjs`입니다. Next.js request handler와 Express API를 같은 프로세스에서 실행하며, 프론트 UI가 필요한 AI 루프, 시장 데이터, 거래소 연결, runtime artifact 생성을 제공합니다.

### 기능

- Next.js 앱 요청을 처리합니다.
- AI 전략 생성 API를 제공합니다.
- 전략 검증과 Go runtime artifact 생성을 제공합니다.
- 시장 개요와 차트 데이터를 제공합니다.
- URL/RPC/WSS stream sample을 제공합니다.
- 거래소 연결 CRUD와 Binance auth test를 제공합니다.
- Codex 로컬 전략 inbox를 제공합니다.

### 주요 입출력

대표 API:

| 경로 | 입력 | 출력 |
| --- | --- | --- |
| `GET /api/config` | 없음 | front/host API 설정 |
| `GET /api/market/overview` | 없음 | market overview rows |
| `GET /api/market/chart` | `symbol`, `market`, `interval`, `limit` | chart series |
| `POST /api/stream/sample` | URL/RPC/WSS sample 설정 | latest value, chart point |
| `GET /api/exchange-connections` | user id header | 저장된 거래소 연결 |
| `POST /api/exchange-connections` | connection payload | 저장된 connection |
| `POST /api/exchange-connections/:id/binance-auth-test` | credential reference | Binance auth test 결과 |
| `POST /api/ai/agentic-strategy-loop` | prompt, current strategy, user context | researched strategy graph |
| `POST /api/ai/strategy-draft` | prompt/options | generated strategy package |
| `POST /api/ai/strategy-draft-stream` | prompt/options | SSE progress/result |
| `POST /api/strategy/runtime-artifacts` | strategy graph | validation, generated Go runtime |
| `GET/POST /api/codex/strategy-inbox` | local strategy payload | Codex bridge payload |

### 아키텍처

```text
front/server.mjs
  -> Express API routes
  -> server/agentic_strategy_loop_py/native_langgraph.py
  -> server/exchangeConnections.mjs
  -> server/requestUserContext.mjs
  -> examples/strategy-runner validator/codegen
  -> Next request handler
```

`npm run dev`는 `next dev`를 직접 실행하지 않고 `NODE_ENV=development node server.mjs`를 실행합니다. 기본 포트는 `FRONT_PORT=9090`입니다.

## 3. Agentic Strategy Loop 모듈

### 개요

Agentic Strategy Loop는 자연어 전략 요청을 실제 trading-only strategy graph로 만드는 서버 루프입니다. 이 루프 안에서는 프롬프트 해석, 웹 검색, API 문서 조사, KG 검색, 컨트랙트 추론, 후보 비교가 모두 일어나지만, UI로 나가는 최종 그래프에는 실제 트레이딩 블록만 남아야 합니다.

핵심 파일은 `front/server/agentic_strategy_loop_py/native_langgraph.py`입니다. `front/server.mjs`는 Express API 라우트에서 이 Python LangGraph runner를 직접 호출합니다.

### 기능

- 사용자의 전략 의도와 실행 도메인을 추론합니다.
- 웹 검색과 API 문서 fetch를 수행합니다.
- 프로토콜 KG/RAG 검색으로 pool, gauge, reward, contract, chain 정보를 찾습니다.
- 컨트랙트/온체인 실행 가능성을 추론합니다.
- intent plan, logic IR, workflow graph를 구성합니다.
- strategy graph를 Go validator에 통과시킵니다.
- agentic workflow run을 저장합니다.
- UI로 넘길 때 AI 내부 루프를 `trading-logic-only` 그래프로 내부화합니다.

### 주요 입출력

입력:

- `prompt`: 사용자 자연어 전략 요청
- `current_strategy`: 현재 UI에 떠 있는 전략 상태
- `validate`: Go validator 실행 여부
- `web_search`: 웹 검색 사용 여부
- `fetch_web_pages`: API/docs 후보 페이지 fetch 여부
- `contract_reasoning`: 컨트랙트 추론 사용 여부
- 거래소/RPC/API 연결 capability
- KG, embedding, web search provider 환경 변수

출력:

- `strategy`: `hershy-strategy-graph`
- `reasoning`: 요약된 reasoning trace
- `workflowTrace`: research/label/adapter trace
- `validation`: Go validator 결과
- `runtime`: 선택적으로 생성된 runtime artifact
- `metadata.aiLoopInternalized=true`
- `metadata.visibleGraphScope="trading-logic-only"`

### 아키텍처

```text
POST /api/ai/agentic-strategy-loop
  -> server.mjs route
  -> python server/agentic_strategy_loop_py/native_langgraph.py
  -> StateGraph(infer_intent)
  -> StateGraph(collect_local_evidence)
  -> StateGraph(resolve_contracts)
  -> StateGraph(audit_data_sources)
  -> StateGraph(materialize_block_map)
  -> StateGraph(validate_block_map / repair_block_map)
  -> StateGraph(audit_execution_readiness)
  -> StateGraph(write_strategy_summary)
  -> persistAgenticWorkflowRun()
  -> response.strategy
```

관련 파일:

- `front/server/agentic_strategy_loop_py/native_langgraph.py`
- `front/server/strategyWorkflowAlgorithms.mjs`
- `front/server/agenticWebResearch.mjs`
- `front/server/agenticReasoningLayer.mjs`
- `front/server/protocolKnowledgeGraphLoop.mjs`
- `front/server/agenticWorkflowPersistence.mjs`

## 4. Strategy Draft / Repair / Runtime Artifact 모듈

### 개요

이 모듈은 전략 그래프를 직접 생성하거나, 생성된 그래프를 의미 검사/repair/Go validator/codegen에 통과시키는 파이프라인입니다. Agentic Strategy Loop가 "근거를 조사해서 전략을 만드는 루프"라면, 이 모듈은 "전략이 실제 runner와 codegen을 통과하는지"에 초점이 있습니다.

핵심 구현은 `front/server.mjs` 안의 AI draft/repair/runtime 함수들입니다.

### 기능

- AI가 `intentPlan`, `logicIR`, `runtimeGraph`를 포함한 전략 패키지를 생성합니다.
- JSON schema validation 전에 semantic lint를 수행합니다.
- semantic lint 실패 시 AI repair를 반복합니다.
- Go runner validator 실패 시 AI repair를 반복합니다.
- 검증된 strategy graph를 `generated_strategy.go`로 codegen합니다.
- 필요하면 host program API 등록을 시도합니다.
- code view 또는 advanced view에서 runtime artifact를 재생성합니다.

### 주요 입출력

입력:

- `prompt`
- `current_strategy`
- `logicIR` 또는 `runtimeGraph`
- `strategyGraph`
- validator/codegen 실행 옵션

출력:

- `intentPlan`: 사용자 의도, 금지 shortcut, 실행 제약
- `logicIR`: 데이터, 계산, predicate, trigger, action 요구사항
- `runtimeGraph`: 실제 Hershy runner가 검증할 graph
- `validation.history`: repair/validator 시도 이력
- `runtime.programCode`: `generated_strategy.go`
- `examples/strategy-runner/generated/<timestamp>-<strategy-id>/` 산출물

runtime artifact endpoint:

```text
POST /api/strategy/runtime-artifacts
  input: { strategy: StrategyGraphPayload }
  output: { ok, validation, runtime }
```

### 아키텍처

```text
/api/ai/strategy-draft or /api/ai/strategy-draft-stream
  -> runOrchestrationPipeline()
  -> runResearchLayer()
  -> runStrategyLayer()
  -> parseStrategyGenerationPackage()
  -> normalizeStrategyGraphForRunner()
  -> completeLogicIRFromRuntimeGraph()
  -> lintStrategyLogicIR()
  -> lintRuntimeStrategyGraph()
  -> AI repair if needed
  -> validateStrategyGraphWithRunner()
  -> AI repair if needed
  -> writeStrategyRuntimeArtifacts()
  -> runStrategyOverviewLayer()
```

관련 파일:

- `front/server.mjs`
- `examples/strategy-runner`
- `examples/strategy-runner/generated/*`

## 5. 그래프 변환과 하네스 모듈

### 개요

`front/features/strategy-graph/easyViewAgent.ts`는 이름에는 agent가 들어가지만, 현재 역할은 서버 AI를 다시 호출하는 것이 아니라 strategy graph를 UI 모델로 materialize하는 변환/하네스 레이어입니다.

이 모듈은 runtime graph를 쉬운 보기, 고급 보기, 코드 보기로 바꾸고, 고급 보기 수정분을 다시 runtime graph로 되돌립니다.

### 기능

- `runEasyViewGraphAgentLoop()`: strategy graph를 UI 전체 결과로 변환합니다.
- `createEasyViewFromStrategyGraph()`: 쉬운 보기 모델을 만듭니다.
- `createAdvancedViewFromStrategyGraph()`: React Flow graph를 만듭니다.
- `advancedGraphToStrategyGraph()`: 고급 보기 편집 결과를 runtime graph로 역변환합니다.
- `strategyGraphToCode()`: strategy graph를 읽기용 코드 문자열로 변환합니다.
- `createAdvancedViewWithHarness()`: UI 하네스 규칙을 적용합니다.
- runtime artifact node, code editor node 같은 visual-only node를 역변환 대상에서 제외합니다.

### 주요 입출력

입력:

- `StrategyGraphPayload`
- `prompt`
- 고급 보기의 `nodes`, `edges`
- active snapshot 이름

출력:

- `EasyViewModel`
- `advancedGraph: { nodes, edges }`
- `generatedCode`
- `diagnostics`
- 역변환된 `StrategyGraphPayload`

하네스가 강제하는 대표 규칙:

- UI 그래프는 실제 트레이딩 로직이어야 합니다.
- AI 내부 루프 단계는 시퀀스로 렌더링하지 않습니다.
- 연결된 노드는 같은 시퀀스 안에 있어야 합니다.
- 서로 다른 시퀀스 안의 노드끼리는 직접 연결할 수 없습니다.
- 시퀀스를 접으면 내부 블록과 내부 연결은 숨깁니다.
- 블록끼리 겹치지 않도록 자동정렬과 레이아웃 검증을 거칩니다.
- 순차 실행이 필요한 액션은 한 trigger에서 동시에 실행하지 않습니다.
- 예: `unstake -> remove liquidity`는 다음처럼 표현합니다.

```text
DEX action: unstake LP
  -> action-result
  -> confirmation trigger
  -> trigger-action
  -> DEX action: remove liquidity
```

### 아키텍처

```text
StrategyGraphPayload
  -> validateHarnessTradingLogicScope()
  -> validateHarnessSequentialExecution()
  -> createAdvancedViewWithHarness()
  -> validateAdvancedGraph()
  -> createEasyViewFromStrategyGraph()
  -> strategyGraphToCode()
  -> EasyViewAgentResult
```

관련 파일:

- `front/features/strategy-graph/easyViewAgent.ts`
- `front/features/node-editor/types.ts`

## 6. 쉬운 보기 UI 모듈

### 개요

쉬운 보기는 비개발자가 전략을 빠르게 이해하고 액션 파라미터를 조정할 수 있는 화면입니다. 내부 노드/edge의 기술적 구조보다 "어떤 시장을 보고, 어떤 조건에서, 어떤 거래를 하는지"를 먼저 보여줍니다.

핵심 컴포넌트는 `front/features/strategy-builder/EasyStrategyGraph.tsx`입니다.

### 기능

- 전략 흐름을 카드와 화살표로 표현합니다.
- 시장 데이터, 조건, CEX/DEX 액션, 리스크, 종료 흐름을 사람이 읽기 쉬운 단위로 보여줍니다.
- action parameter 중 사용자가 수정할 수 있는 값을 표시합니다.
- 고정값 `normal` block을 별도 카드로 남기지 않고 액션/조건 파라미터로 흡수합니다.
- monitoring block을 필요하면 chart/상태 표현으로 흡수합니다.

### 주요 입출력

입력:

- `EasyViewModel`
- 선택된 node/action parameter
- 사용자 parameter 수정 이벤트

출력:

- 쉬운 보기 카드/edge 렌더링
- 수정된 action parameter
- 고급 보기로 넘길 수 있는 동기화 상태

대표 easy node:

- `start`
- `stream`
- `condition`
- `cex`
- `dex`
- `monitor`
- `risk`
- `end`

### 아키텍처

```text
StrategyGraphPayload
  -> createEasyViewFromStrategyGraph()
  -> EasyViewModel
  -> EasyStrategyGraph
  -> parameter edit
  -> app/page.tsx state sync
```

관련 파일:

- `front/features/strategy-builder/EasyStrategyGraph.tsx`
- `front/features/strategy-graph/easyViewAgent.ts`
- `front/app/page.tsx`

## 7. 고급 보기 Node Editor 모듈

### 개요

고급 보기는 실제 데이터 흐름, 트리거, 액션, 시퀀스 그룹, runtime artifact를 확인하고 편집하는 React Flow 기반 에디터입니다. 사용자가 전략을 구조적으로 검토해야 할 때 이 화면을 봅니다.

핵심 컴포넌트는 `front/features/node-editor/NodeEditor.tsx`입니다.

### 기능

- React Flow graph를 렌더링합니다.
- node/edge 추가, 삭제, 연결, 자동정렬을 처리합니다.
- sequence/group collapse 상태를 관리합니다.
- sequence를 접으면 내부 node/edge를 숨깁니다.
- 서로 다른 sequence 내부 노드 간 연결을 차단합니다.
- 연결된 unsequenced node는 필요한 경우 같은 sequence로 자동 편입합니다.
- focus가 해제되면 반투명/강조 스타일을 정리합니다.
- 실시간 시장 데이터와 chart를 node에 표시합니다.
- generated Go program을 read-only `codeEditor` node로 표시합니다.

### 주요 입출력

입력:

- `initialGraph: { nodes, edges }`
- `initialGraphVersion`
- `programCode`
- 브라우저 이벤트: `loadSnapshot`, `runAutoLayout`, `saveHistorySnapshot`, `toggleSequenceCollapse`
- 사용자의 drag/connect/edit 이벤트

출력:

- 편집된 React Flow `nodes`, `edges`
- history snapshot
- 고급 보기에서 역변환 가능한 strategy graph
- UI focus/collapse/layout 상태

주요 node type:

- `streamingNode`: 외부 URL/WSS/RPC/시장 데이터
- `functionNode`, `mergedFunction`, `block`: 계산/가공 로직
- `timeTrigger`, `clickTrigger`, `branchNode`: 시간/수동/조건 분기
- `actionNode`: CEX/DEX 실행
- `monitoringNode`: 차트/테이블/로그 관측
- `groupNode`: 전략/workflow sequence 그룹
- `timelineFrame`: timeline/sequence 표현
- `codeEditor`: 생성된 Hershy Go program 또는 코드 블록

주요 edge type:

- `custom`: 일반 데이터/실행 연결
- `delay`: 지연 edge
- `fsmEdge`: 상태 전이 edge

### 아키텍처

```text
AdvancedGraph
  -> NodeEditor
  -> React Flow nodeTypes / edgeTypes
  -> sequence boundary guard
  -> collapsed sequence visibility
  -> auto layout
  -> user edits
  -> app/page.tsx
  -> advancedGraphToStrategyGraph()
```

관련 파일:

- `front/features/node-editor/NodeEditor.tsx`
- `front/features/node-editor/layout.ts`
- `front/features/node-editor/CustomEdge.tsx`
- `front/features/node-editor/StreamingNode.tsx`
- `front/features/node-editor/FunctionNode.tsx`
- `front/features/node-editor/MonitoringNode.tsx`
- `front/features/node-editor/CodeEditorNode.tsx`
- `front/features/node-editor/types.ts`

## 8. 코드 보기와 Hershy runtime program 모듈

### 개요

코드 보기 모듈은 strategy graph가 실제 Hershy runner/codegen을 통과했는지 보여줍니다. 단순한 JSON/DSL 문자열인 `generatedCode`와 실제 Go codegen 결과인 `programCode`를 구분합니다.

현재 고급 보기에서도 `programCode`가 있으면 `Hershy generated_strategy.go` read-only code block으로 표시됩니다.

### 기능

- code view 진입 시 runtime artifact를 자동 생성합니다.
- advanced view 진입 시에도 strategy graph에 맞는 `generated_strategy.go`를 자동 생성합니다.
- Go validator 실패 시 error를 표시합니다.
- `generated_strategy.go` 전체를 code view와 고급 보기 code block에 표시합니다.
- 각 전략 node에 관련 runtime code snippet을 연결합니다.
- visual-only `codeEditor` node는 `advancedGraphToStrategyGraph()`에서 제외합니다.

### 주요 입출력

입력:

- `codeViewStrategyGraph`
- `codeViewStrategyGraphSignature`
- active advanced graph 또는 generated strategy graph

출력:

- `programCode`: `generated_strategy.go`
- `programCodeError`
- 고급 보기의 read-only code editor node
- code view의 title/status

API:

```text
POST /api/strategy/runtime-artifacts
  input:
    { strategy: StrategyGraphPayload }

  output:
    {
      ok: true,
      validation,
      runtime: {
        files,
        programCode,
        compileCommand,
        codegenCommand
      }
    }
```

### 아키텍처

```text
app/page.tsx
  -> codeViewStrategyGraph
  -> generateRuntimeProgramCode()
  -> POST /api/strategy/runtime-artifacts
  -> validateStrategyGraphWithRunner()
  -> writeStrategyRuntimeArtifacts()
  -> programCode
  -> NodeEditor(programCode)
  -> enrichGraphWithRuntimeProgram()
  -> CodeEditorNode
```

관련 파일:

- `front/app/page.tsx`
- `front/server.mjs`
- `front/features/node-editor/NodeEditor.tsx`
- `front/features/node-editor/CodeEditorNode.tsx`

## 9. 시장 데이터, 스트리밍, 차트 모듈

### 개요

시장 데이터 모듈은 전략 블록이 참조하는 URL/RPC/WSS 데이터와 차트 데이터를 UI에 표시합니다. 현재 차트는 TradingView embed가 아니라 `lightweight-charts` 기반입니다.

### 기능

- 시장 개요 rows를 주기적으로 가져옵니다.
- Binance-style historical kline chart를 `/api/market/chart`로 가져옵니다.
- URL/RPC/WSS streaming node를 `/api/stream/sample`로 주기 샘플링합니다.
- numeric field를 찾아 chart point로 축적합니다.
- dark mode일 때 chart palette도 dark mode로 바꿉니다.
- TradingView attribution mark를 숨깁니다.
- latest value, change, percent change, high/low, update time, source를 표시합니다.
- volume 값이 있으면 histogram series를 표시합니다.

### 주요 입출력

`GET /api/market/chart` 입력:

- `symbol`: 예: `BTCUSDT`, `ETHUSDT`
- `market`: 예: `binance`
- `interval`: 예: `1m`
- `limit`

`GET /api/market/chart` 출력:

- `points`: `{ time, value, volume? }[]`
- `source`
- `updatedAt`

`POST /api/stream/sample` 입력:

- `streamKind`: `url`, `websocket`, `evm-rpc`
- `url` 또는 `rpcUrl`
- HTTP method/body/path
- numeric field selector

`POST /api/stream/sample` 출력:

- latest sample value
- chart point
- source/update metadata

### 아키텍처

```text
StreamingNode
  -> marketChartRequestPayload()
  -> GET /api/market/chart        # initial/historical series
  -> POST /api/stream/sample      # live sample append
  -> NodeChartPoint[]
  -> MetricChart
```

관련 파일:

- `front/features/node-editor/StreamingNode.tsx`
- `front/features/node-editor/MetricChart.tsx`
- `front/features/node-editor/FunctionNode.tsx`
- `front/features/node-editor/types.ts`
- `front/server.mjs`

## 10. 거래소와 사용자 컨텍스트 모듈

### 개요

거래소/사용자 컨텍스트 모듈은 사용자별 거래소 연결과 실행 capability를 관리합니다. AI prompt에는 raw secret을 넘기지 않고, 실행 가능한 endpoint와 capability 여부만 요약해서 넘깁니다.

### 기능

- 사용자별 거래소 연결을 저장하고 불러옵니다.
- CEX REST URL, DEX RPC URL, API key 존재 여부를 관리합니다.
- Binance credential test를 제공합니다.
- 요청마다 `X-Hershy-User-ID`와 `user_id`를 맞춥니다.
- 실행 가능한 연결이 없으면 실행 전략 생성 요청을 막습니다.
- AI에게는 secret value 대신 capability summary를 제공합니다.

### 주요 입출력

입력:

- 사용자 ID
- exchange connection form
- API URL, REST URL, RPC URL
- credential presence
- Binance test request

출력:

- serialized exchange connections
- selected exchange capability
- auth test result
- AI prompt에 포함되는 실행 환경 요약

대표 API:

- `GET /api/exchange-connections`
- `POST /api/exchange-connections`
- `POST /api/exchange-connections/:id/binance-auth-test`

### 아키텍처

```text
localStorage user context
  -> app/page.tsx
  -> X-Hershy-User-ID / user_id
  -> server/requestUserContext.mjs
  -> server/exchangeConnections.mjs
  -> AI prompt capability summary
```

관련 파일:

- `front/lib/userContextClient.js`
- `front/server/requestUserContext.mjs`
- `front/server/exchangeConnections.mjs`
- `front/lib/exchangeCatalog.mjs`
- `front/features/home/ExchangeLibraryModal.tsx`

## 11. 상태 저장, 히스토리, Codex inbox 모듈

### 개요

이 모듈은 전략 편집 상태를 브라우저와 로컬 브리지에 보존합니다. 사용자가 만든 전략은 history snapshot으로 저장되고, Codex가 생성한 전략은 local inbox를 통해 UI로 로드될 수 있습니다.

### 기능

- strategy snapshot을 localStorage에 저장합니다.
- 열린 탭, active tab, branch/history를 관리합니다.
- 현재 실행 중인 node 상태를 메모리에 유지합니다.
- sequence 실행 로그를 메모리에 쌓습니다.
- Codex가 `.local/codex-strategy-inbox.json`에 쓴 전략을 UI로 가져옵니다.
- 가져온 strategy graph를 easy/advanced/code view로 materialize합니다.

### 주요 입출력

입력:

- 현재 React Flow nodes/edges
- strategy name
- active snapshot id
- Codex inbox payload

출력:

- history snapshot
- `loadSnapshot` 이벤트
- `saveHistorySnapshot` 이벤트
- UI에 로드된 advanced graph
- Codex 전략 로드 성공/실패 activity

대표 API:

- `GET /api/codex/strategy-inbox`
- `POST /api/codex/strategy-inbox`

### 아키텍처

```text
NodeEditor / app/page.tsx
  -> historyStore
  -> localStorage snapshots
  -> loadSnapshot event

Codex generated strategy
  -> .local/codex-strategy-inbox.json
  -> /api/codex/strategy-inbox
  -> runEasyViewGraphAgentLoop()
  -> UI graph load
```

관련 파일:

- `front/lib/historyStore.ts`
- `front/lib/runningStore.ts`
- `front/lib/sequenceLogStore.ts`
- `front/app/page.tsx`
- `front/server.mjs`

## 12. CCTX / 실행 계층과의 경계 모듈

### 개요

`front/`는 CCTX 실행기를 직접 UI에서 호출하는 계층이 아닙니다. 프론트는 사용자의 의도와 연결 정보를 바탕으로 strategy graph와 `generated_strategy.go`를 만들고, 실제 CEX/DEX/SCW 실행은 Hershy runner와 CCTX 계층으로 내려갑니다.

즉, `front/`의 책임은 "실행 가능한 전략을 구조화하고 검증 가능한 산출물로 만드는 것"이고, CCTX의 책임은 "여러 거래소/온체인 실행 방식을 공통 인터페이스로 실행하는 것"입니다.

### 기능

프론트가 CCTX로 내려보내기 위해 준비하는 의미:

- CEX action: exchange, market, side, size, price, order type
- DEX action: chain, contract address, calldata/function call, value, gas/fee option
- streaming source: REST/WSS/RPC URL과 selector
- trigger: time/condition/manual execution guard
- monitoring: 실행 전후 상태 확인
- safety: approval, kill switch, emergency stop, exit sequence

CCTX 실행 계층에서 대응되는 의미:

- `base.Exchange`, `ExchangeClient`, `MarketClient`, `Strategy`
- CEX adapters: Binance, Bybit, OKX, GateIO
- prediction market/DEX adapters: Polymarket, Limitless, Opinion, EVMDEX
- EVM call/transaction execution
- ERC20 metadata/balance/allowance/quote 조회
- SCW session key relay와 Safe provisioning
- secure config `enc:v1:` resolver

### 주요 입출력

프론트가 만드는 입력:

- `StrategyGraphPayload`
- `generated_strategy.go`
- action block parameter
- user/exchange capability summary
- runtime artifact validation result

CCTX/runner 쪽으로 내려가는 실행 의미:

- 공통 거래소 입력: `marketID`, `outcome`, `side`, `price`, `size`, `params`
- EVM DEX 입력: `chain`, `contract_address`, `calldata`, `value`, `gas_limit`, fee options
- SCW relay 입력: `chain_id`, `smart_wallet_address`, `session_key_address`, `policy_id`, `contract_address`, `calldata`, `value`, `gas_limit`, `deadline_unix`, `signature`

출력 의미:

- 주문/포지션/잔고/오더북/시장 정보
- `tx_hash`, `status`, `message`
- `raw_output`
- monitoring chart/log/state

### 아키텍처

```text
front UI
  -> hershy-strategy-graph
  -> /api/strategy/runtime-artifacts
  -> examples/strategy-runner generated_strategy.go
  -> Hershy runner / host program
  -> cctx base.Exchange / EVMDEX / SCW relay
  -> 거래소 API 또는 온체인 transaction
```

관련 CCTX 모듈:

- `cctx/base`
- `cctx/models`
- `cctx/cex/*`
- `cctx/exchanges`
- `cctx/scw`
- `cctx/relayer`
- `cctx/secureconfig`
- `cctx/contracts/scw`

## 실행 방법

```bash
cd front
npm install
npm run dev
```

주요 환경 변수는 `front/.env.example`을 기준으로 설정합니다.

- `FRONT_PORT`: 프론트 서버 포트
- `HOST_API_BASE`: Hershy host program API 주소
- `AI_PROVIDER`: `ollama`, `gemini`, `openai`, `deepseek`
- `AI_STRATEGY_VALIDATE_MAX_ATTEMPTS`: validation/repair 반복 횟수
- `AI_STRATEGY_WRITE_RUNTIME_ARTIFACTS`: runtime artifact 파일 저장 여부
- `AI_STRATEGY_REGISTER_HOST_PROGRAM`: host program API 등록 여부
- `KG_DATABASE_URL`, `KG_EMBEDDING_*`: 프로토콜 KG/RAG 검색
- `AGENT_WEB_SEARCH_PROVIDER`: agentic workflow 웹 검색 provider
- `AGENT_WORKFLOW_PERSIST_RUNS`: agentic workflow trace 저장 여부

## 폴더 구조

```text
front/
  app/                         현재 Next.js App Router UI
  features/home/             홈 화면 nav, rail, 거래소 모달, 라이브러리/포트폴리오 UI
  features/strategy-builder/  쉬운 보기 그래프
  features/node-editor/       React Flow 기반 고급 보기 그래프 에디터
  components/ui/                shadcn/Radix 기반 공용 UI
  lib/                          프론트 상태 저장소와 공유 helper
  features/strategy-graph/      strategy graph UI 표현/레이아웃 로직
  contracts/                    프론트/백엔드 공유 DTO
  server/                       agentic workflow, KG, 웹 리서치, 거래소 서버 모듈
  scripts/                      agent loop, KG, workflow trace CLI
  db/migrations/                KG와 agentic workflow persistence 스키마
  server.mjs                    Express + Next 통합 서버와 API 엔드포인트
```

주의할 점:

- 현재 메인 앱은 `front/app/`입니다.
- 이전 `front/src/App.jsx` 계열 UI는 제거했고, 현재 앱과 서버에서 쓰는 helper는 `front/lib/*`로 승격했습니다.
- `easyViewAgent.ts`의 `AgentLoop`는 서버 AI 호출이 아니라 UI materialization 레이어입니다.
- `agentic-strategy-loop`는 research-heavy 루프이고, `strategy-draft-stream`은 semantic lint/validator/codegen 중심 루프입니다.

## 빠른 디버깅 체크리스트

- AI 버튼을 눌렀는데 바로 실패하면 거래소 연결에 REST API URL 또는 RPC URL이 있는지 확인합니다.
- 고급 보기에 블록이 안 뜨면 `/api/codex/strategy-inbox` 또는 agentic response의 `strategy.blocks`, `strategy.connections`를 확인합니다.
- 시퀀스 내부 블록이 겹치면 `runAutoLayout` 이벤트와 `metadata.workflowGroups[].nodeIds`를 확인합니다.
- 서로 다른 시퀀스의 노드가 연결되면 `edgeRespectsSequenceBoundary()`와 하네스 validation 결과를 확인합니다.
- 접힌 시퀀스 내부 블록이 보이면 `applySequenceCollapsedState()` 적용 여부를 확인합니다.
- action 순서가 중요한데 병렬처럼 보이면 `action-result -> confirmation trigger -> trigger-action` 구조인지 확인합니다.
- code view 또는 advanced code block이 비어 있으면 `/api/strategy/runtime-artifacts` validation error를 확인합니다.
- 차트가 비어 있으면 `/api/market/chart`의 symbol inference와 `/api/stream/sample`의 numeric selector를 확인합니다.

## 관련 문서

- `front/docs/front_redesign.md`: 제품/UX 방향성
- `front/docs/strategy_logic_agent_loop_brief.md`: 전략 논리 agent loop 브리프
- `front/docs/agentloop.md`: logic IR/linter 설계 상세
- `front/docs/agentloop2.md`: StrategyLogicIR 구현 브리프
- `front/docs/rag/agentic-defi-strategy-workflows.md`: agentic DeFi workflow/RAG 방향
