# OKX WebSocket Subscriptions

Updated: 2026-05-13

Use this when the agent configures OKX public WebSocket market data in a Hershy streaming block.

## Endpoints

Public channels:

```text
wss://ws.okx.com:8443/ws/v5/public
```

Private channels require authentication:

```text
wss://ws.okx.com:8443/ws/v5/private
```

## Subscribe Payload

OKX uses `op: "subscribe"` and `args` as channel objects.

```json
{
  "id": "hershy-btc-usdt-ticker",
  "op": "subscribe",
  "args": [
    {
      "channel": "tickers",
      "instId": "BTC-USDT"
    }
  ]
}
```

Order book:

```json
{
  "id": "hershy-btc-usdt-books",
  "op": "subscribe",
  "args": [
    {
      "channel": "books5",
      "instId": "BTC-USDT"
    }
  ]
}
```

Candles:

```json
{
  "id": "hershy-btc-usdt-candle",
  "op": "subscribe",
  "args": [
    {
      "channel": "candle1m",
      "instId": "BTC-USDT"
    }
  ]
}
```

## Common Channels

- Ticker: `tickers`
- Trades: `trades`
- 5-level order book: `books5`
- Full order book: `books`
- Candles: `candle1m`, `candle5m`, `candle1H`
- Mark price: `mark-price`
- Index ticker: `index-tickers`

## Chart Field Hints

For ticker payloads, useful chart fields include:

- `last`
- `bidPx`
- `askPx`
- `open24h`, `high24h`, `low24h`

For candle payload arrays, close is usually the close element in the candle tuple. Keep the channel semantic as kline/candle.

## Hershy Example

```json
{
  "exchange": "okx",
  "method": "WEBSOCKET",
  "url": "wss://ws.okx.com:8443/ws/v5/public",
  "subscribePayload": {
    "id": "hershy-btc-usdt-ticker",
    "op": "subscribe",
    "args": [
      {
        "channel": "tickers",
        "instId": "BTC-USDT"
      }
    ]
  },
  "symbol": "BTC-USDT",
  "channel": "ticker",
  "updateIntervalMs": 1000
}
```

Source:

- https://www.okx.com/docs-v5/en/#websocket
