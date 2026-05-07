# FDV<=500M coin list + spot/futures pairs (Binance, Bitget, OKX, Gate.io, Bybit)

This repo-less script downloads:
- CoinGecko market data (to get **FDV = fully_diluted_valuation**)
- Public instrument lists from each exchange

Then it outputs an Excel workbook with:
- `Summary`: coins with FDV<=500M and where they appear
- One sheet per exchange (spot & futures/perp pairs, sorted by name)
- `AllPairs_Normalized`: (exchange, symbol, market, pair) rows
- `Ambiguous_Symbols`: tickers that map to multiple CoinGecko coins
- `Meta`: run metadata

## Run

```bash
python fdv500m_pairs.py --out fdv_le_500m_pairs.xlsx
```

## (Optional) CoinGecko demo key

If you have a CoinGecko Demo API key, set:

```bash
export COINGECKO_DEMO_API_KEY=YOUR_KEY
```

## Requirements

```bash
pip install requests pandas openpyxl
```
