# backtest

모델 학습에 쓸 데이터가 너무 용량이 큰 관계로 .gitnore하고 올립니다.
해당 데이터를 다시 다운받고 싶으면

src/pipeline_btc_exit_rl.py download_klines \
  --start-date 2017-08-17 --end-date YYYY-MM-DD(현재날짜) --intervals 1h 1s 1m
로 복원하시면 됨니다
근데 prob_model_logit_all 모델 사용할거라서 이전 데이터는 이미 학습에 쓰였으니 굳이 다운받을 필요 없을...걸요..??
