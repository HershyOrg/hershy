# 15m Impulse Bot (Shadow Trading)

Implements the **설계도2** spec as a minimal live shadow bot:
- Binance spot trades + depth (impulse + orderbook consume)
- Polymarket best bid/ask (chance)
- Chainlink (on-chain RPC) + RTDS chainlink stream for price_to_beat
- Real-time beta estimation + spoof filter
- Shadow fills + parquet logs

## Run

```bash
export POLYRPC="https://<POLYGON_RPC>"
python bots/impulse_15m_bot/run_shadow.py --slug <polymarket-slug>
```

Auto-switch markets by slug prefix:
```bash
python bots/impulse_15m_bot/run_shadow.py --auto-slug --slug-prefix btc-updown-15m
```

## Live orders

```bash
export POLY_PRIVATE_KEY="..."
export POLY_FUNDER="..."
export POLY_API_KEY="..."
export POLY_API_SECRET="..."
export POLY_API_PASSPHRASE="..."
python bots/impulse_15m_bot/run_shadow.py --slug <polymarket-slug> --live --order-usdc 100
```

Outputs (rolling Parquet):
```
src/out/impulse_15m_bot/<SESSION>/
  raw_exch_trades_*.parquet
  raw_exch_book_*.parquet
  raw_chainlink_*.parquet
  raw_pm_quotes_*.parquet
  signals_*.parquet
  paper_fills_*.parquet
```

## Dashboard

```bash
streamlit run bots/impulse_15m_bot/dashboard.py
```

## Notes
- This is **shadow-only** (no real orders).
- Beta/edge/fee model are simplified. Tune in `config.py`.
- Uses WebSocket feeds; requires `websockets`, `web3`, `pandas`, `pyarrow`.
