# Bybit WebSocket Subscriptions

Updated: 2026-05-13

Use this when the agent configures Bybit V5 public WebSocket market data in a Hershy streaming block.

## Endpoints

Bybit V5 uses product-specific public endpoints.

```text
wss://stream.bybit.com/v5/public/spot
wss://stream.bybit.com/v5/public/linear
wss://stream.bybit.com/v5/public/inverse
wss://stream.bybit.com/v5/public/option
```

## Subscribe Payload

Bybit public subscriptions use `op: "subscribe"` and `args` as topic strings.

```json
{
  "req_id": "hershy-btcusdt-ticker",
  "op": "subscribe",
  "args": ["tickers.BTCUSDT"]
}
```

Multiple topics:

```json
{
  "req_id": "hershy-market-data",
  "op": "subscribe",
  "args": [
    "tickers.BTCUSDT",
    "publicTrade.BTCUSDT",
    "orderbook.1.BTCUSDT"
  ]
}
```

Heartbeat:

```json
{
  "req_id": "hershy-ping",
  "op": "ping"
}
```

## Common Topics

- Ticker: `tickers.BTCUSDT`
- Public trades: `publicTrade.BTCUSDT`
- Order book level 1: `orderbook.1.BTCUSDT`
- Order book level 50: `orderbook.50.BTCUSDT`
- Kline: `kline.1.BTCUSDT`

## Chart Field Hints

For ticker payloads, useful chart fields often include:

- `lastPrice`
- `bid1Price`
- `ask1Price`
- `markPrice`
- `indexPrice`

For public trade payloads, use the trade `price` field.

## Hershy Example

```json
{
  "exchange": "bybit",
  "method": "WEBSOCKET",
  "url": "wss://stream.bybit.com/v5/public/spot",
  "subscribePayload": {
    "req_id": "hershy-btcusdt-ticker",
    "op": "subscribe",
    "args": ["tickers.BTCUSDT"]
  },
  "symbol": "BTCUSDT",
  "channel": "ticker",
  "updateIntervalMs": 1000
}
```

Source:

- https://bybit-exchange.github.io/docs/v5/ws/connect
- https://bybit-exchange.github.io/docs/v5/websocket/public/ticker
