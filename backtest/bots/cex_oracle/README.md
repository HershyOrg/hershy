# CEX Oracle Collector

This folder collects:
- Polymarket RTDS Chainlink (btc/usd)
- 5 exchanges via cryptofeed (Binance, OKX, Bybit, Gate, HTX)
- Coinbase via REST
- Upbit via REST
- Bitget via REST
- KuCoin via REST
- MEXC via REST
- Polymarket chance via WS
- Binance via WS (bookTicker + aggTrade)

Data is written into rolling 5-minute Parquet files under `src/out/cex_oracle/<SESSION>/`.
Each file is compressed via Parquet compression (snappy).

## Install

```bash
pip install cryptofeed==2.4.1 streamlit plotly pandas websockets aiohttp pyarrow web3
```

## Chainlink RPC

Set Polygon RPC for on-chain Chainlink price feed:
```bash
export POLYRPC="https://<YOUR_POLYGON_RPC_URL>"
```

## Run collectors (all)

```bash
python bots/cex_oracle/collectors/run_all.py \
  --chainlink-symbol btc/usd \
  --binance-symbol BTCUSDT \
  --symbol BTC-USDT \
  --coinbase-symbol BTC-USD \
  --upbit-symbol KRW-BTC \
  --bitget-symbol BTCUSDT \
  --kucoin-symbol BTC-USDT \
  --mexc-symbol BTCUSDT \
  --polymarket-slug <polymarket-slug>
```

This creates (rolling 5-minute Parquet):
```
src/out/cex_oracle/<SESSION>/
  chainlink/chainlink_1s_YYYYMMDDTHHMMSSZ.parquet
  exchanges/exchanges_1s_YYYYMMDDTHHMMSSZ.parquet
  exchanges/exchanges_1s_volume_YYYYMMDDTHHMMSSZ.parquet
  coinbase/coinbase_1s_YYYYMMDDTHHMMSSZ.parquet
  upbit/upbit_1s_YYYYMMDDTHHMMSSZ.parquet
  bitget/bitget_1s_YYYYMMDDTHHMMSSZ.parquet
  kucoin/kucoin_1s_YYYYMMDDTHHMMSSZ.parquet
  mexc/mexc_1s_YYYYMMDDTHHMMSSZ.parquet
  polymarket/polymarket_chance_YYYYMMDDTHHMMSSZ.parquet
  binance/binance_1s_YYYYMMDDTHHMMSSZ.parquet
  binance/binance_1s_volume_YYYYMMDDTHHMMSSZ.parquet
  session.json
```

## Optional: per-exchange symbol mapping

Create a JSON like:
```json
{
  "UPBIT": "BTC-KRW"
}
```

Then:
```bash
python cex_oracle/collectors/run_all.py --symbol-map /path/to/symbol_map.json
```

## Dashboard

```bash
streamlit run bots/cex_oracle/dashboard/app.py
```

The dashboard uses `src/out/cex_oracle/LATEST` to pick the default session.
Set a custom base dir with `CEX_BASE_DIR` env var.

## Bitget MYXUSDT 1m history (compressed)

Backfill all available 1m candles, save as compressed Parquet:

```bash
python bots/cex_oracle/collectors/bitget_spot_perp_backfill.py --symbol MYXUSDT
```

Outputs:
```
src/out/cex_oracle/bitget_history/bitget_spot_MYXUSDT_1m.parquet
src/out/cex_oracle/bitget_history/bitget_perp_MYXUSDT_1m.parquet
```

In the dashboard, enable **"Use backfilled history (compressed)"** under
`4) Bitget MYXUSDT spot vs perp (1m)` to plot from these files.

Notes:
- Spot 1m candles are limited by Bitget API history range (often ~1 month). The script will stop once the API returns empty.
- Perp history uses `mix/market/history-candles` by default to go further back. Disable with `--no-perp-history`.
