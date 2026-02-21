# Polymarket 트레이딩 전략 (pbad)

이 봇은 BTC 가격 움직임으로 학습된 확률 모델을 사용해 Polymarket의 Up/Down 마켓을 트레이딩한다.
주문은 Polymarket CLOB SDK(`py-clob-client`)로 전송하며, 기본은 시장가 성격의 FAK 주문이다.

## 입력
- 마켓: Gamma의 slug 또는 token ID(`clobTokenIds`)
- 모델: `src/out/prob_model_logit_all.json`
- 가격 스트림: Binance BTCUSDT 1s + 1h kline

## 시그널
모델은 현재 시점 기준으로 `p_up = Pr(close > open)`을 계산한다.
입력 피처는 아래와 같다.
- 시간당 시가 대비 가격 변화(`P_t / O_1h - 1`)
- 시간당 누적 거래량
- 60초 로그수익률 모멘텀
- 레짐(모멘텀 부호)
- 남은 시간(tau)

`p_up`으로부터 현재 방향성 기준의 `pbad`를 계산한다.
- 가격 >= 시간 시가: `pbad = 1 - p_up`
- 가격 < 시간 시가: `pbad = p_up`

## 진입
마지막 4분 윈도우 시작 시점(tau = 240)에서:
- 가격 >= 시간 시가: **Up** 매수
- 가격 < 시간 시가: **Down** 매수

아래 조건에서는 진입을 스킵한다.
- `enableOrderBook`이 false
- 마켓이 closed 상태

## 청산
마지막 4분 윈도우 동안:
- `pbad > theta`이면 즉시 청산 (기본 theta = 0.50)
- 그렇지 않으면 윈도우 끝(tau = 1)에서 청산

## 주문 실행
- `py-clob-client`의 `MarketOrderArgs` 사용 (시장가 성격의 limit)
- 기본 주문 타입: `FAK` (가능한 만큼 체결 후 나머지 취소)
- 선택 옵션: `FOK` (전량 즉시 체결 아니면 실패)

## 마켓 선택
- slug는 Polymarket URL의 `/event/` 뒤 문자열이다.
- 예시:
  `https://polymarket.com/event/bitcoin-up-or-down-january-18-6am-et`
  → slug = `bitcoin-up-or-down-january-18-6am-et`
- auto-slug 기능을 켜면 ET 기준 현재 시간대에 맞춰 slug의 시간 suffix를 자동으로 바꾼다.

## 참고
- Up/Down 마켓은 이진(binary) 구조이며 Up = YES, Down = NO로 보면 된다.
- 크립토 Up/Down 마켓은 taker 수수료가 붙을 수 있다.
