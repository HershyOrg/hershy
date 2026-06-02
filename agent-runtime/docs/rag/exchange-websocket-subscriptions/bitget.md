# Bitget WebSocket Subscriptions

Updated: 2026-05-13

Use this when the agent configures Bitget public WebSocket market data in a Hershy streaming block.

## Endpoint Notes

Bitget has separate WebSocket products and docs for spot, futures, and UTA/classic APIs. Choose the endpoint that matches the product line in the user request or the connected exchange account.

The payload shape below applies to the documented public market channels.

Main public WebSocket domain:

```text
wss://ws.bitget.com/v2/ws/public
```

## Subscribe Payload

Spot ticker:

```json
{
  "op": "subscribe",
  "args": [
    {
      "instType": "SPOT",
      "channel": "ticker",
      "instId": "BTCUSDT"
    }
  ]
}
```

USDT futures ticker:

```json
{
  "op": "subscribe",
  "args": [
    {
      "instType": "USDT-FUTURES",
      "channel": "ticker",
      "instId": "BTCUSDT"
    }
  ]
}
```

Spot trades:

```json
{
  "op": "subscribe",
  "args": [
    {
      "instType": "SPOT",
      "channel": "trade",
      "instId": "BTCUSDT"
    }
  ]
}
```

## Common Channels

- Ticker: `ticker`
- Trades: `trade`
- Candles: channel names such as `candle1m` depending on product docs
- Order book/depth: product-specific depth channels

## Chart Field Hints

For ticker payloads, useful chart fields include:

- `lastPr` or equivalent last price field
- `bidPr`
- `askPr`
- `open24h`, `high24h`, `low24h`

Use the field names received in the actual sample response when configuring chart extraction.

## Hershy Example

```json
{
  "exchange": "bitget",
  "method": "WEBSOCKET",
  "url": "wss://ws.bitget.com/v2/ws/public",
  "subscribePayload": {
    "op": "subscribe",
    "args": [
      {
        "instType": "SPOT",
        "channel": "ticker",
        "instId": "BTCUSDT"
      }
    ]
  },
  "symbol": "BTCUSDT",
  "channel": "ticker",
  "updateIntervalMs": 1000
}
```

If endpoint conventions differ by Bitget product/version, prefer the endpoint from the current connector implementation or official product-specific docs.

Source:

- https://www.bitget.com/api-doc/spot/websocket/public/Tickers-Channel
- https://www.bitget.com/api-doc/classic/contract/websocket/public/Tickers-Channel
- https://www.bitget.com/api-doc/classic/quickStart/websocket-intro
