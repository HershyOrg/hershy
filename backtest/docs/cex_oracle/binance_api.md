응, 가능해. “특정 시간대의 거래량”을 어떻게 정의하느냐(캔들 구간 거래량 vs 체결 단위 합산)에 따라 방법이 3가지로 나뉘어.

1) 가장 쉬움: 캔들(Kline)로 “해당 구간 거래량” 받기

바이낸스 Kline 응답에는 Volume(기본자산 거래량)이 들어있고, startTime/endTime으로 원하는 시간대만 뽑을 수 있어.

Spot (현물)

엔드포인트: GET /api/v3/klines

파라미터: symbol, interval, startTime, endTime, limit

응답 배열의 5번째 값이 Volume

startTime/endTime은 항상 UTC 기준(timeZone을 줘도 start/end는 UTC로 해석)

USD-M Futures (선물)

엔드포인트: GET /fapi/v1/klines

startTime/endTime 지원 + 응답에 Volume 포함

예시 (1분봉 거래량을 특정 구간만)

# KST 2026-01-28 10:00~11:00 을 UTC로 바꿔서(start/end는 ms) 넣기

curl -s "<https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&startTime=START_MS&endTime=END_MS&limit=1000>"

시간 범위가 길면 limit(스팟 1000) 때문에 한 번에 다 못 받을 수 있으니, 마지막 캔들의 close time 다음으로 startTime을 밀어서 페이지네이션하면 돼.
