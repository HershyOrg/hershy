# Pipeline BTC Exit RL 설계도

## 목적

각 시간봉의 마지막 윈도우를 이용해 시간 방향(C > O_1h) 확률 모델을 만들고, 이 모델로 출구 리스크(Pbad)를 계산한다. 필요 시 실시간으로 모델을 온라인 업데이트하며, 정책 백테스트 도구를 제공한다.

## 데이터 소스

- Binance Vision 일별 klines (ZIP 안 CSV)
- Binance WebSocket 실시간 klines (1s + 1h)

### 과거 데이터 (Vision)

- 1h klines: O_1h 맵 구성
- 1s klines: 기본 스냅샷 생성 (각 시간의 마지막 4분)
- 1m klines: 1m 스냅샷 생성 (각 시간의 마지막 30분, 30개)(파이프라인에 아직 넣지 말기!! 모델 실험중임)

함수:

- URL/다운로드: `kline_daily_url`, `download_daily_klines`
- ZIP CSV 읽기: `iter_kline_rows_from_zip`

### 실시간 데이터 (WebSocket)

- `wss://stream.binance.com:9443/stream?streams=btcusdt@kline_1s/btcusdt@kline_1h`
- 실시간 추론 및 옵션 온라인 업데이트에 사용

함수:

- `live_signal`

## 스냅샷 생성 (과거)

각 시간의 마지막 구간만 모아 스냅샷 행을 만든다.

기본 설정:

- 1s: `last_window_sec=240` (마지막 4분, 240행)
- 1m: `last_window_sec=1800` (마지막 30분, 30행)

행 필드(요약):

- `hour_open_ms`, `t_ms`, `tau_sec`, `window_sec`, `interval_sec`
- `O_1h`, `O_4m`, `P_t`, `cum_vol_1h`
- `delta_pct`, `disparity_O`, `mom_logret_60s`, `regime`

핵심 로직:

- `O_1h`: 해당 시간 시작의 1h 캔들 시가
- `O_4m`: 마지막 윈도우 첫 가격
- `cum_vol_1h`: 시간 내 누적 거래량
- `mom_logret_60s`: 마지막 `momentum_sec` 구간 로그수익률 (기본 60초)
  - 1m 데이터일 때는 1분 로그수익률이 됨
- `regime`: `mom_logret_60s`와 `eps=0.0002`로 1/0/-1

함수:

- `build_O1h_map_from_1h_klines`
- `build_snapshot_rows_from_buffer`
- `build_snapshots_historical`

출력:

- `out/snapshots.parquet` (1s 기본)
- `out/snapshots_1m_30m.parquet` (1m, 마지막 30분)

## 모델 학습

SGD 기반 로지스틱 회귀.

라벨:

- 시간별 마지막 행(`tau_sec` 최소) 기준
  - `P_t > O_1h`이면 `y=1`, 아니면 `0`

특징:

- `delta_pct`
- `log1p(cum_vol_1h)`
- `mom_logret_60s`
- `regime`
- `tau_norm = tau_sec / tau_norm_div`

표준화:

- `mu`, `sd`를 학습 데이터에서 계산해 모델에 저장

학습 함수:

- `standardize_fit`
- `feature_matrix`
- `build_labels_for_snapshots`
- `train_logit_sgd_df`
- `train_logit_sgd`
- `train_logit_sgd_multi_windows`

모델 산출물:

- `out/prob_model_logit*.json`
- 포함: `w`, `mu`, `sd`, `tau_norm_div`, `train_range`, `train_rows`, `train_hours`

## 모델 사용 (추론)

`prob_predict`가 `p_up = Pr(C > O_1h)`를 반환.

출구 리스크:

- `compute_pbad`는 `(P_t - O_1h)` 부호로 방향 결정
- 롱: `Pbad = 1 - p_up`
- 숏: `Pbad = p_up`

사용처:

- `live_signal` (실시간)
- `backtest_signal` (정책 백테스트)
- `backtest_prediction_market_models` (예측시장 스타일)

## 온라인 업데이트 (실시간)

한 시간 스냅샷 단위로 모델 가중치를 업데이트한다.

흐름:

- `live_signal`이 마지막 윈도우를 버퍼링
- 시간 전환 시 `build_snapshot_df_from_live`로 스냅샷 생성
- `online_update_logit` 적용 후 `out/prob_model_logit.json` 저장
- `out/live_state.json` 체크포인트 갱신
- 필요 시 Vision 데이터로 누락 시간 백필

함수:

- `build_snapshot_df_from_live`
- `online_update_logit`
- `load_live_state`, `save_live_state`
- `backfill_missing_hours`
- `iter_snapshot_hours_from_1s`

산출물:

- `out/live_state.json` (체크포인트)
- `out/live_snapshots/` (옵션)

## 백테스팅

### 스토퍼 정책 백테스트

함수:

- `backtest_signal`

로직:

- 마지막 윈도우 시작 시 진입
- 진입 방향 = `sign(P_t - O_1h)`
- 각 행에서 `p_up`/`Pbad` 계산
- `Pbad > theta`면 즉시 청산, 아니면 `tau_sec` 최소까지 유지
- 지표: exit rate, 평균 보유 시간, 종가 방향 기준 승률, PnL(수수료 옵션)

### 예측시장 백테스트

함수:

- `backtest_prediction_market_models`

로직:

- 시간당 1회 진입, 조건:
  - `p_up >= 0.95` (YES) 또는 `p_up <= 0.05` (NO)
- 마지막 윈도우 동안 `step_sec` 간격으로 체크
- 같은 방향의 스톱 임계값을 넘으면 청산
- CSV 출력: bets, exits, exit_rate, win_rate, avg_exit_second

## 리포팅

별도 스크립트:

- `src/backtest_report_window.py`

역할:

- 스냅샷 + 모델로 구간 리포트/플롯 생성
- pipeline CLI의 일부는 아니지만 같은 산출물을 사용

## CLI 진입점

메인 파일: `src/pipeline_btc_exit_rl.py`

일반 실행 순서:

- `download_klines`
- `build_snapshots`
- `train_prob_model` 또는 `train_prob_model_multi`
- `backtest_signal` 또는 `backtest_prediction_market`
- `live_signal` (실시간)

## 함수 매핑

데이터 수집:

- `kline_daily_url`
- `download_daily_klines`
- `iter_kline_rows_from_zip`

스냅샷 생성:

- `build_O1h_map_from_1h_klines`
- `build_snapshot_rows_from_buffer`
- `build_snapshots_historical`
- `build_snapshot_df_from_live`
- `iter_snapshot_hours_from_1s`

모델 학습:

- `build_labels_for_snapshots`
- `feature_matrix`
- `standardize_fit`
- `train_logit_sgd_df`
- `train_logit_sgd`
- `train_logit_sgd_multi_windows`

추론/출구 로직:

- `prob_predict`
- `compute_pbad`

온라인 업데이트:

- `online_update_logit`
- `backfill_missing_hours`
- `load_live_state`, `save_live_state`

백테스트:

- `backtest_signal`
- `backtest_prediction_market_models`

리포팅(별도 파일):

- `src/backtest_report_window.py`의 `run_report`

## 사용 순서 다이어그램

### 과거 학습 파이프라인 (1s 또는 1m)

```text
download_klines
  -> build_O1h_map_from_1h_klines
  -> build_snapshots_historical
    -> build_snapshot_rows_from_buffer
  -> train_logit_sgd
    -> build_labels_for_snapshots
    -> feature_matrix
    -> standardize_fit
    -> SGD updates
  -> prob_model_logit*.json
```

### 실시간 추론 + 온라인 업데이트

```text
live_signal
  -> load_prob_model
  -> (옵션) backfill_missing_hours
  -> WebSocket 1s + 1h
    -> build_snapshot_df_from_live (hour rollover)
      -> online_update_logit
        -> 모델 JSON 저장
      -> save_live_state
    -> prob_predict (last window 매 틱)
      -> compute_pbad
      -> Pbad > theta 면 EXIT
```

### 백테스트

```text
backtest_signal
  -> load_prob_model
  -> snapshots.parquet 로드
  -> 시간별 반복:
       prob_predict -> compute_pbad -> exit rule
  -> 요약 지표

backtest_prediction_market_models
  -> prob_model_logit_*.json 로드
  -> snapshots.parquet 로드
  -> 시간별 반복:
       entry filter (p_up 0.95/0.05)
       last window 스텝 체크
       stop 임계값 청산
  -> pred_market_backtest.csv
```
