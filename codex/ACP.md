아래 문서는 **Virtuals Protocol의 ACP(Agent Commerce Protocol)** 연동을 “코덱스(Codex)에게 그대로 던져서 구현”할 수 있게, **필요 라이브러리 / 반드시 알아야 할 개념 / 구현 순서 / 예제 스켈레톤 / 테스트·운영 체크리스트**를 한 번에 정리한 **단일 문서**야.
(주의: “ACP”라는 이름이 다른 프로젝트에도 있지만, 여기서는 **Virtuals ACP** 기준임. ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/acp-product-resources/acp-concepts-terminologies-and-architecture?utm_source=chatgpt.com "ACP Concepts, Terminologies and Architecture")))

---

# Virtuals ACP 연동 구현 가이드 (Codex 작업용 단일 문서)

## 0) 목표

* 너의 서비스를 **ACP Seller(Provider) 에이전트**로 등록하고,
* 다른 에이전트/사용자가 **유료 Job**을 생성하면,
* 네 서버가 **Job 라이프사이클(Request→Negotiation→Transaction→Evaluation→Completed)**에 맞춰
  **accept → payment 확인/요구 → deliver → (optional) auto-approve/evaluate → 정산 완료**까지 자동 처리하게 만든다. ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/acp-product-resources/introducing-acp-v2?utm_source=chatgpt.com "Introducing ACP v2"))

---

## 1) ACP에서 꼭 알아야 하는 핵심 개념

### 1.1 Job(유료 작업) 상태머신

ACP v2 기준으로도 Job은 동일한 상태머신을 유지함:

* **Request → Negotiation → Transaction → Evaluation → Completed** ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/acp-product-resources/introducing-acp-v2?utm_source=chatgpt.com "Introducing ACP v2"))
  상태 전환은 “ **signed memo** (서명된 승인 메시지)”를 통해 진행되고, 결제/정산은 온체인 컨트랙트(에스크로) 메커니즘으로 강제됨. ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/acp-product-resources/introducing-acp-v2?utm_source=chatgpt.com "Introducing ACP v2"))

### 1.2 왜 SCW(Agent Smart Wallet)가 사실상 필수인가?

ACP는 에이전트 지갑을 일반 EOA가 아니라 **Smart Wallet Account(컨트랙트 기반 지갑)**로 발급하는 흐름이 기본이야.

* **프라이빗키가 노출되지 않는 컨트랙트 지갑**이고,
* **승인된 Job 흐름 밖의 임의 동작을 제한하는 가드레일**을 제공하며,
* 실제 Job 진행은 **whitelist된 Dev Wallet(EOA)**이 memo 서명으로 컨트롤함. ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/initialize-and-whitelist-wallet "Initialize and Whitelist Wallet | Virtuals Protocol Whitepaper"))

### 1.3 결제/가스

* 에이전트 간 거래는  **가스비가 들지 않는다** (문서 기준). ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/tips-and-troubleshooting/payments-pricing-and-wallets "Payments, Pricing &amp; Wallets | Virtuals Protocol Whitepaper"))
* 가격은 USD로 표기되지만 실제 결제는 **메인넷 USDC**로 이루어진다. ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/tips-and-troubleshooting/payments-pricing-and-wallets "Payments, Pricing &amp; Wallets | Virtuals Protocol Whitepaper"))

### 1.4 스키마(요청/응답 양식)는 “필수에 가깝다”

ACP는 “텍스트 모드”도 가능하지만 실무에선 **Schema mode(Requirements/Deliverables JSON 스키마)**를 강하게 추천(자동 검증/오류 방지/자동 reject 가능). ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/create-job-offering/job-offering-data-schema-validation?utm_source=chatgpt.com "Job Offering Data Schema Validation - Virtuals Protocol Whitepaper"))

### 1.5 Evaluation은 옵션(자동 승인 가능)

* `onEvaluate` 콜백을  **생략하면** , Seller가 deliver하는 순간 SDK가 **자동 승인(auto-approval)** 처리해서 결제가 자동 해제된다. ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/acp-product-resources/acp-onboarding-guide/tips-and-troubleshooting/optional-evaluation-in-acp?utm_source=chatgpt.com "Optional Evaluation in ACP | Virtuals Protocol Whitepaper"))

### 1.6 Resource Offering(무료/가벼운 조회 API)

ACP v2에는 **Resource offerings**가 추가됨:

* 에스크로/Job 생성 없이 **read-only로 즉시 조회 가능한 엔드포인트**를 노출(“public API처럼”) ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/acp-product-resources/introducing-acp-v2?utm_source=chatgpt.com "Introducing ACP v2"))
* 유료 Job 전에 “맛보기/신뢰/상태 공개(예: 현재 포지션, 카탈로그, 메트릭)”에 유리. ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/acp-product-resources/introducing-acp-v2?utm_source=chatgpt.com "Introducing ACP v2"))

---

## 2) 필요한 라이브러리/도구

### 2.1 Python(권장)

* **ACP Python SDK** : `virtuals-acp`
  설치: `pip install virtuals-acp` ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/customize-agent/simulate-agent-with-code/acp-sdk/python/installation?utm_source=chatgpt.com "Installation"))
* 추천 보조:
  * `python-dotenv` (.env 로딩)
  * `pydantic` (요청/응답 스키마 검증)
  * `httpx`/`requests` (네 기존 API/데이터피드 호출)

### 2.2 Node.js(대안)

* **ACP Node SDK** : `@virtuals-protocol/acp-node` ([Npm](https://www.npmjs.com/package/%40virtuals-protocol/acp-node?activeTab=readme&utm_source=chatgpt.com "virtuals-protocol/acp-node"))
* 보조:
  * TypeScript면 `ts-node`, `dotenv`

### 2.3 CLI(디버깅/운영에 강력 추천)

* **openclaw-acp (ACP CLI)** : 사람/LLM이 동일한 방식으로 agent discovery / job 실행 / 폴링 등을 수행 가능 ([GitHub](https://github.com/Virtual-Protocol/openclaw-acp?utm_source=chatgpt.com "Virtual-Protocol/openclaw-acp"))
  → “코드 구현 + CLI로 스모크 테스트/재현” 조합이 매우 편함.

---

## 3) 구현 전체 흐름 (UI + 코드)

### 3.1 (UI) ACP Registry에서 기본 세팅

1. **Sandbox 환경에서 시작**
2. **Agent 2개 생성** :

* Buyer(테스트용) 1개
* Seller(실제 서비스) 1개 ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/builders-hub/acp-tech-playbook "ACP Tech Playbook | Virtuals Protocol Whitepaper"))

1. Seller에 대해 **Smart Wallet 생성 + Dev Wallet whitelist** ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/builders-hub/acp-tech-playbook "ACP Tech Playbook | Virtuals Protocol Whitepaper"))
2. Buyer 에이전트에  **USDC 충전** , 테스트용으로 **서비스 가격 $0.01 권장** ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/builders-hub/acp-tech-playbook "ACP Tech Playbook | Virtuals Protocol Whitepaper"))
3. (메인넷 전환 시) 동일한 절차로 mainnet registry에 등록

> 참고: 팀이 “자율 에이전트”를 굳이 만들지 않아도, **API-only로 ACP에 참여**해서 기존 API를 service offering으로 노출할 수 있다고 문서에 명시돼 있어. ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/builders-hub/acp-tech-playbook "ACP Tech Playbook | Virtuals Protocol Whitepaper"))

### 3.2 (UI or JSON) Job/Resource Offering 정의

* Job/Resource는 UI에서 만들 수도 있고,
* **JSON import/export**로 팀 협업·백업·환경 이동이 가능. ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/acp-product-resources/acp-onboarding-guide/set-up-agent-profile/add-resource/import-and-export-agent-job-resource?utm_source=chatgpt.com "Import &amp; Export Agent Job / Resource"))
* Job 스키마는 반드시:
  * `requirementsSchema`(요청 입력)
  * `deliverableSchema`(응답 출력)
    를 정한다(실무에선 Schema mode 추천). ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/create-job-offering/job-offering-data-schema-validation?utm_source=chatgpt.com "Job Offering Data Schema Validation - Virtuals Protocol Whitepaper"))

---

## 4) 코덱스가 만들어야 할 결과물(프로젝트 산출물 정의)

### 4.1 파일 구조(권장)

```
acp-agent/
  README.md
  .env.example
  requirements.txt
  seller/
    main.py              # ACP Seller 런타임 (웹소켓 listen + phase 처리)
    offerings.py         # 요구/산출 스키마 + 내부 라우팅
    handlers/
      normalize_feed.py  # (예) 데이터 정제 핸들러
  buyer_test/
    buyer.py             # end-to-end 테스트용 buyer 스크립트
  ops/
    systemd.service      # 배포용(옵션)
    docker-compose.yml   # 배포용(옵션)
```

### 4.2 환경변수(.env) — “반드시” 포함할 것

ACP 문서가 설명하는 관계는:

* **WHITELISTED_WALLET_PRIVATE_KEY** = whitelist된 Dev Wallet의 private key
* **SELLER_AGENT_WALLET_ADDRESS / SELLER_ENTITY_ID** = ACP가 발급한 Agent wallet / entity id
* Buyer 테스트용도 동일하게 buyer 쪽 entity/wallet 세트 필요 ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/initialize-and-whitelist-wallet "Initialize and Whitelist Wallet | Virtuals Protocol Whitepaper"))

`.env.example` (예시)

```bash
# Dev wallet (EOA) — 반드시 registry에서 whitelist 된 지갑의 privkey
WHITELISTED_WALLET_PRIVATE_KEY=...

# Seller agent identity (from ACP registry)
SELLER_ENTITY_ID=...
SELLER_AGENT_WALLET_ADDRESS=0x...

# Buyer test agent identity (sandbox)
BUYER_ENTITY_ID=...
BUYER_AGENT_WALLET_ADDRESS=0x...
```

---

## 5) 구현 스펙(핵심 로직)

### 5.1 Seller 런타임의 동작 규칙(필수)

Seller는 “새 Job 이벤트”를 받으면 아래를 해야 함:

1. **Request 단계**
   * requirement가 스키마에 맞는지 검증
   * 가능하면 `accept()`, 아니면 `reject(reason)`
2. **Negotiation 단계**
   * (필요시) 추가 요구사항/가격/납기 확정 메시지 생성
3. **Transaction 단계**
   * 결제(에스크로)가 진행되면 실제 작업 수행
4. **Deliver**
   * deliverable 스키마에 맞는 결과를 반환(권장: JSON + 증빙 링크)
5. **Evaluation**
   * 기본은 auto-approval로 단순화 가능(= `onEvaluate` 생략) ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/acp-product-resources/acp-onboarding-guide/tips-and-troubleshooting/optional-evaluation-in-acp?utm_source=chatgpt.com "Optional Evaluation in ACP | Virtuals Protocol Whitepaper"))

### 5.2 “데이터 피드 정제 서비스”에 맞춘 추천 Offering 설계

#### Job Offering(유료) 예시: `normalize_feed`

* **Requirements(JSON)** 예시

```json
{
  "source": "binance|coinbase|polymarket_rtds|custom",
  "symbol": "BTCUSDT",
  "window_sec": 900,
  "transform": ["ohlc_1s", "spread", "anomaly_score"],
  "output": "json",
  "include_provenance": true
}
```

* **Deliverable(JSON)** 예시

```json
{
  "summary": "15m window anomaly_score=0.82, spread widened",
  "data": {
    "t0": 1700000000,
    "t1": 1700000900,
    "metrics": { "anomaly_score": 0.82, "avg_spread": 1.2 }
  },
  "provenance": {
    "source": "binance",
    "fetched_at": 1700000910,
    "raw_hash": "sha256:..."
  },
  "artifacts_url": "https://.../result.json"
}
```

#### Resource Offering(무료/즉시조회) 예시

* `/resources/health` : 현재 상태, 마지막 업데이트 시각
* `/resources/catalog` : 지원 source/symbol/transform 목록
* `/resources/sample` : 샘플 출력 (유료 전환 퍼널)
  Resource offerings는 v2에서 “public API처럼” 작동한다고 명시돼 있음. ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/acp-product-resources/introducing-acp-v2?utm_source=chatgpt.com "Introducing ACP v2"))

---

## 6) 코드 스켈레톤(코덱스가 바로 채울 수 있게)

> 아래 코드는 “형태”를 보여주는 스켈레톤이야. (실제 클래스/함수명은 SDK 버전에 따라 약간 다를 수 있으니 Codex가 설치된 SDK 기준으로 맞추면 됨.)
> 설치는 `pip install virtuals-acp`로 시작. ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/customize-agent/simulate-agent-with-code/acp-sdk/python/installation?utm_source=chatgpt.com "Installation"))

### 6.1 Python Seller 스켈레톤 (`seller/main.py`)

```python
import os
import json
import time
from dotenv import load_dotenv

# ACP SDK imports (Codex: adjust exact imports to current SDK version)
from virtuals_acp.client import VirtualsACP
from virtuals_acp.contract_clients.contract_client_v2 import ACPContractClientV2
from virtuals_acp.job import ACPJob
from virtuals_acp.memo import ACPMemo
from virtuals_acp.models import ACPJobPhase

from seller.offerings import validate_requirement, run_service, make_deliverable

load_dotenv()

WHITELISTED_WALLET_PRIVATE_KEY = os.environ["WHITELISTED_WALLET_PRIVATE_KEY"]
SELLER_ENTITY_ID = os.environ["SELLER_ENTITY_ID"]
SELLER_AGENT_WALLET_ADDRESS = os.environ["SELLER_AGENT_WALLET_ADDRESS"]

def on_new_task(job: ACPJob, memo_to_sign: ACPMemo | None = None):
    """
    Called whenever there is a new job event or a phase transition that needs seller action.
    """
    try:
        phase = job.phase

        # 1) Request -> accept/reject
        if phase == ACPJobPhase.REQUEST:
            req = job.requirement  # Codex: adapt field access
            ok, reason = validate_requirement(req)
            if not ok:
                job.reject(f"Invalid requirement: {reason}")
                return
            job.accept("Accepted. Proceeding to negotiation/payment.")
            # Optionally tell buyer what to do next
            job.create_requirement("Accepted. Please proceed with payment to start processing.")
            return

        # 2) Transaction -> execute and deliver
        if phase == ACPJobPhase.TRANSACTION:
            req = job.requirement
            result = run_service(req)              # your actual logic (data fetch + normalize)
            deliverable = make_deliverable(req, result)

            # Deliver must match deliverable schema defined in the offering
            job.deliver(deliverable)
            return

        # 3) Evaluation (optional)
        # If you omit onEvaluate globally, SDK auto-approves deliverables. :contentReference[oaicite:24]{index=24}
        # If you do implement evaluation, do it here (or in onEvaluate hook).

    except Exception as e:
        # Make it observable
        print(f"[ERROR] job_id={getattr(job,'id',None)} phase={getattr(job,'phase',None)} err={e}")

def main():
    contract = ACPContractClientV2(
        wallet_private_key=WHITELISTED_WALLET_PRIVATE_KEY,
        agent_wallet_address=SELLER_AGENT_WALLET_ADDRESS,
        entity_id=SELLER_ENTITY_ID,
    )

    VirtualsACP(
        acp_contract_clients=contract,
        on_new_task=on_new_task,
        # on_evaluate omitted => auto-approval :contentReference[oaicite:25]{index=25}
    )

    print("ACP Seller running...")
    while True:
        time.sleep(3600)

if __name__ == "__main__":
    main()
```

### 6.2 Buyer 테스트 스켈레톤 (`buyer_test/buyer.py`)

* 목표: sandbox에서 seller에게 Job 생성 → 결제 → deliverable 수신까지 E2E 확인
* Tech Playbook은 buyer/seller 두 에이전트로 sandbox 테스트를 권장. ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/builders-hub/acp-tech-playbook "ACP Tech Playbook | Virtuals Protocol Whitepaper"))

```python
# Pseudocode skeleton:
# 1) init buyer ACP client
# 2) browse agents / select seller offering
# 3) initiate job with requirement JSON
# 4) pay and accept requirement (advance to transaction)
# 5) poll job until deliverable received
# 6) assert deliverable schema
```

---

## 7) 테스트/디버깅: 여기서 많이 막힘(체크리스트)

### 7.1 “Signer is not whitelisted” (가장 흔함)

결제 진행 시 400 에러로:

* whitelist된 지갑인지 확인
* env의 private key가 whitelist된 지갑과 일치하는지 확인
* 필요하면 revoke 후 재-whitelist
  문서에 디버깅 절차가 그대로 있음. ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/tips-and-troubleshooting/payments-pricing-and-wallets "Payments, Pricing &amp; Wallets | Virtuals Protocol Whitepaper"))

### 7.2 “왜 Job 이벤트가 안 오지?”

* seller 런타임이 웹소켓 listen 중인지
* registry에서 seller가 discoverable 상태인지
* job phase가 PENDING memo 상태로 멈춰있는지(대시보드/SDK로 확인)
  관련 디버깅 가이드가 있음. ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/acp-product-resources/acp-onboarding-guide/tips-and-troubleshooting/debugging-acp-jobs?utm_source=chatgpt.com "Debugging ACP Jobs | Virtuals Protocol Whitepaper"))

### 7.3 offering 스키마 불일치

* requirement/deliverable이 “텍스트로 대충” 오가면 자동화가 깨짐 → **Schema mode**로 고정 권장. ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/create-job-offering/job-offering-data-schema-validation?utm_source=chatgpt.com "Job Offering Data Schema Validation - Virtuals Protocol Whitepaper"))

### 7.4 CLI로 스모크 테스트(추천)

* openclaw-acp CLI는 discovery/job 실행/polling을 CLI로 제공(사람/LLM 동일). ([GitHub](https://github.com/Virtual-Protocol/openclaw-acp?utm_source=chatgpt.com "Virtual-Protocol/openclaw-acp"))
  → “서버 구현은 SDK, 검증/재현은 CLI” 조합이 유지보수에 좋음.

---

## 8) 운영/보안(필수 권장사항)

1. **WHITELISTED_WALLET_PRIVATE_KEY 절대 하드코딩 금지**
   * Secrets Manager/환경변수로만 관리
2. **idempotency(중복 처리 방지)**
   * 동일 job_id / 동일 phase 이벤트 중복 수신에 대비(로그/DB로 dedupe)
3. **관측성**
   * job_id, phase, requirement hash, deliverable hash를 로그로 남김
4. **rate limit / abuse 대응**
   * Resource는 public API 성격이므로(문서 명시) 응답 제한/캐시/서명 URL 고려 ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/acp-product-resources/introducing-acp-v2?utm_source=chatgpt.com "Introducing ACP v2"))
5. **데이터 재배포 라이선스 주의**
   * 벤더/거래소/유료 데이터는 “정제해서 재배포”가 계약 위반일 수 있으니, 상업 운영 전 확인

---

## 9) Codex에게 던질 “구현 지시서”(복붙용)

아래를 Codex에 그대로 주면 됨:

* 목표: Virtuals ACP Seller 에이전트 런타임(Python) 구현
* SDK: `virtuals-acp` 사용 (`pip install virtuals-acp`) ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/customize-agent/simulate-agent-with-code/acp-sdk/python/installation?utm_source=chatgpt.com "Installation"))
* 입력/출력: Schema mode로 requirement/deliverable JSON 스키마 지원 ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/create-job-offering/job-offering-data-schema-validation?utm_source=chatgpt.com "Job Offering Data Schema Validation - Virtuals Protocol Whitepaper"))
* 운영: sandbox에서 buyer/seller 2 agent로 E2E 테스트(가격 0.01, buyer에 USDC) ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/builders-hub/acp-tech-playbook "ACP Tech Playbook | Virtuals Protocol Whitepaper"))
* 지갑: Agent Smart Wallet + whitelist된 Dev Wallet private key로 서명 ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/initialize-and-whitelist-wallet "Initialize and Whitelist Wallet | Virtuals Protocol Whitepaper"))
* 기능:
  1. Request 단계: requirement 검증 후 accept/reject
  2. Transaction 단계: 데이터 피드 fetch → 정제 → deliverable JSON 생성 → deliver
  3. Evaluation: 기본은 onEvaluate 생략(자동 승인) ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/acp-product-resources/acp-onboarding-guide/tips-and-troubleshooting/optional-evaluation-in-acp?utm_source=chatgpt.com "Optional Evaluation in ACP | Virtuals Protocol Whitepaper"))
  4. Resource offering(선택): health/catalog/sample read-only 엔드포인트(ACP v2 리소스) ([whitepaper.virtuals.io](https://whitepaper.virtuals.io/acp-product-resources/introducing-acp-v2?utm_source=chatgpt.com "Introducing ACP v2"))
* 산출물: 위 파일 구조로 repo 생성 + README에 실행법/환경변수/테스트법 포함

---

원하면, 네가 “정제해서 주고 싶은 데이터”가 정확히 뭔지(예:  **거래소 틱→1초 OHLC** ,  **오더북 벽 델타** ,  **온체인 스마트머니 라벨링** ) 딱 1개만 지정해줘. 그러면 이 문서의 **Requirement/Deliverable JSON Schema를 ‘실사용 수준’으로 확정**해서, 코덱스가 그대로 구현만 하면 되게 더 구체화해줄게.
