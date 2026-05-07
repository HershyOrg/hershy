# L2/L3 Orderbook Collector

Binance L2 (price levels) + Coinbase L3 (order-level) collector based on
`docs/market_capture/15mMarket/L2L3orderbook.md`.

## Run

```bash
python bots/l2l3_orderbook/run.py \
  --binance-symbol BTCUSDT \
  --coinbase-symbol BTC-USD \
  --top-n 10 \
  --out-dir src/out/l2l3_orderbook
```

Store full Binance levels (up to 5000):

```bash
python bots/l2l3_orderbook/run.py --binance-full-levels
```

Disable Coinbase:

```bash
python bots/l2l3_orderbook/run.py --no-coinbase
```

Output:
- `src/out/l2l3_orderbook/<SESSION>/book_states_*.parquet`
