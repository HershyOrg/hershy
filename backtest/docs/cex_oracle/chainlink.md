맞아, 그 주소가 **Polygon 메인넷의 Chainlink BTC/USD 온체인 Price Feed(EACAggregatorProxy)** 컨트랙트 주소야. ([Polygon (POL) Blockchain Explorer][1])
그래서 이제는 네가 말한 것처럼 **RPC(`POLYRPC`)로 `latestRoundData()` / `getRoundData()`를 `eth_call`로 조회**할 수 있어. (너가 전에 준 32바이트 값은 Data Streams의 feedID였고, 이건 20바이트 컨트랙트 주소라 온체인 조회가 됨.)

아래 코드는 네가 **`POLYRPC`만 export** 해놓으면, 피드 주소는 코드에 고정해두고 **특정 시간 구간의 라운드들을 CSV로 뽑아주는** 스크립트야.

---

## 1) 환경변수

```bash
export POLYRPC="https://<YOUR_POLYGON_RPC_URL>"
```

---

## 2) 설치

```bash
pip install web3 python-dateutil
```

---

## 3) 코드: `polygon_chainlink_btcusd_rounds.py`

```python
import os
import csv
import sys
from dataclasses import dataclass
from typing import Optional, List

from web3 import Web3
from web3.exceptions import ContractLogicError
from dateutil import parser as dtparser

# ✅ Polygon BTC/USD Price Feed (EACAggregatorProxy)
# Polygonscan: "Chainlink: BTC/USD Price Feed" at this address :contentReference[oaicite:1]{index=1}
FEED_ADDRESS = "0xc907E116054Ad103354f2D350FD2514433D57F6f"

AGGREGATOR_V3_ABI = [
    {"inputs": [], "name": "decimals", "outputs": [{"type": "uint8"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "description", "outputs": [{"type": "string"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "latestRoundData", "outputs": [
        {"type": "uint80", "name": "roundId"},
        {"type": "int256", "name": "answer"},
        {"type": "uint256", "name": "startedAt"},
        {"type": "uint256", "name": "updatedAt"},
        {"type": "uint80", "name": "answeredInRound"},
    ], "stateMutability": "view", "type": "function"},
    {"inputs": [{"type": "uint80", "name": "_roundId"}], "name": "getRoundData", "outputs": [
        {"type": "uint80", "name": "roundId"},
        {"type": "int256", "name": "answer"},
        {"type": "uint256", "name": "startedAt"},
        {"type": "uint256", "name": "updatedAt"},
        {"type": "uint80", "name": "answeredInRound"},
    ], "stateMutability": "view", "type": "function"},
]

@dataclass
class Round:
    round_id: int
    answer: int
    updated_at: int

def env_or_fail(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        raise SystemExit(f"Missing env var: {name}")
    return v

def to_unix_seconds(dt_str: str) -> int:
    # accepts "2026-01-28T10:00:00+09:00" or "2026-01-28 10:00:00+09:00"
    dt = dtparser.parse(dt_str)
    return int(dt.timestamp())

def safe_get_round(contract, rid: int) -> Optional[Round]:
    try:
        round_id, answer, _started_at, updated_at, _answered_in_round = contract.functions.getRoundData(rid).call()
        if int(updated_at) == 0:
            return None
        return Round(round_id=int(round_id), answer=int(answer), updated_at=int(updated_at))
    except (ContractLogicError, ValueError):
        return None

def latest(contract) -> Round:
    rid, answer, _started_at, updated_at, _answered_in_round = contract.functions.latestRoundData().call()
    return Round(round_id=int(rid), answer=int(answer), updated_at=int(updated_at))

def find_lower_valid_round_id(contract, latest_rid: int) -> int:
    # step-down to find an early valid round (fast & usually sufficient)
    step = 1
    rid = latest_rid
    last_valid = latest_rid

    while True:
        cand = rid - step
        if cand <= 0:
            break
        r = safe_get_round(contract, cand)
        if r is None:
            break
        last_valid = cand
        rid = cand
        step *= 2

    return max(1, last_valid)

def find_round_at_or_after(contract, lo: int, hi: int, target_ts: int) -> int:
    # binary search first round with updated_at >= target_ts
    ans = hi
    while lo <= hi:
        mid = (lo + hi) // 2
        r = safe_get_round(contract, mid)
        if r is None:
            lo = mid + 1
            continue
        if r.updated_at >= target_ts:
            ans = mid
            hi = mid - 1
        else:
            lo = mid + 1
    return ans

def collect_rounds_between(contract, start_ts: int, end_ts: int, max_rows: int = 200000) -> List[Round]:
    last = latest(contract)
    latest_rid = last.round_id

    lower = find_lower_valid_round_id(contract, latest_rid)
    start_rid = find_round_at_or_after(contract, lower, latest_rid, start_ts)

    out: List[Round] = []
    rid = start_rid
    while rid <= latest_rid and len(out) < max_rows:
        r = safe_get_round(contract, rid)
        rid += 1
        if r is None:
            continue
        if r.updated_at > end_ts:
            break
        out.append(r)
    return out

def main():
    rpc = env_or_fail("POLYRPC")

    w3 = Web3(Web3.HTTPProvider(rpc))
    if not w3.is_connected():
        raise SystemExit("RPC connection failed. Check POLYRPC.")

    addr = w3.to_checksum_address(FEED_ADDRESS)
    c = w3.eth.contract(address=addr, abi=AGGREGATOR_V3_ABI)

    decimals = c.functions.decimals().call()
    desc = c.functions.description().call()

    last = latest(c)
    latest_price = last.answer / (10 ** decimals)
    print(f"# feed: {desc}")
    print(f"# latestRoundId: {last.round_id}, updatedAt: {last.updated_at}, price: {latest_price}")
    print("# usage:")
    print("#   python polygon_chainlink_btcusd_rounds.py '<start ISO8601>' '<end ISO8601>' > out.csv")
    print("# example:")
    print("#   python polygon_chainlink_btcusd_rounds.py '2026-01-28T10:00:00+09:00' '2026-01-28T11:00:00+09:00' > btcusd_polygon.csv")
    print("#")

    if len(sys.argv) < 3:
        return

    start_ts = to_unix_seconds(sys.argv[1])
    end_ts = to_unix_seconds(sys.argv[2])
    if end_ts <= start_ts:
        raise SystemExit("end must be after start")

    rows = collect_rounds_between(c, start_ts, end_ts)

    w = csv.writer(sys.stdout)
    w.writerow(["roundId", "updatedAt_unix", "price"])
    for r in rows:
        price = r.answer / (10 ** decimals)
        w.writerow([r.round_id, r.updated_at, price])

if __name__ == "__main__":
    main()
```

---

## 4) 실행 예시 (KST로 그대로 넣어도 됨)

```bash
python polygon_chainlink_btcusd_rounds.py "2026-01-28T10:00:00+09:00" "2026-01-28T11:00:00+09:00" > btcusd_polygon.csv
```

이 CSV의 `updatedAt_unix` 간격을 보면 “몇 초마다 업데이트되는지”가 실제로 찍혀. (고정 주기 아님: 가격 변동/heartbeat 조건에 따라 라운드가 생김)

---

원하면 내가 위 CSV로 **업데이트 간격 통계(평균/중앙값/분위수/최대 공백)**까지 바로 계산하는 짧은 스크립트도 같이 줄게.

[1]: https://polygonscan.com/address/0xc907E116054Ad103354f2D350FD2514433D57F6f "
 Chainlink: BTC/USD Price Feed | Address: 0xc907E116...433D57F6f | PolygonScan
"
