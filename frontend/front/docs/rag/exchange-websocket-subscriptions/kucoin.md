# KuCoin WebSocket Subscriptions

Updated: 2026-05-13

Use this when the agent configures KuCoin public WebSocket market data in a Hershy streaming block.

## Endpoint Notes

KuCoin WebSocket connections normally require a server endpoint/token from the bullet API. Some public channel docs show the logical push endpoint:

```text
wss://ws-api-spot.kucoin.com
```

Do not invent a token. If the runtime needs a live KuCoin socket, use the exchange connector/client flow that obtains the WebSocket server and token.

## Subscribe Payload

KuCoin public subscriptions use `type: "subscribe"`, a `topic`, and optional `response`.

```json
{
  "id": 1545910660739,
  "type": "subscribe",
  "topic": "/market/ticker:BTC-USDT",
  "response": true
}
```

All tickers:

```json
{
  "id": 1545910660739,
  "type": "subscribe",
  "topic": "/market/ticker:all",
  "response": true
}
```

Private channels include `privateChannel: true` and require authenticated token setup:

```json
{
  "id": 1545910660739,
  "type": "subscribe",
  "topic": "/spotMarket/tradeOrdersV2",
  "privateChannel": true,
  "response": true
}
```

## Common Topics

- Ticker for specific symbols: `/market/ticker:BTC-USDT`
- All tickers: `/market/ticker:all`
- Spot private order updates: `/spotMarket/tradeOrdersV2`
- Account balance updates: `/account/balance`

## Chart Field Hints

For ticker messages, useful chart fields include:

- `data.price`
- `data.bestBid`
- `data.bestAsk`

KuCoin symbol format generally uses a dash, e.g. `BTC-USDT`.

## Hershy Example

```json
{
  "exchange": "kucoin",
  "method": "WEBSOCKET",
  "url": "wss://ws-api-spot.kucoin.com",
  "subscribePayload": {
    "id": 1545910660739,
    "type": "subscribe",
    "topic": "/market/ticker:BTC-USDT",
    "response": true
  },
  "symbol": "BTC-USDT",
  "channel": "ticker",
  "updateIntervalMs": 1000,
  "requiresConnectionBootstrap": true
}
```

Source:

- https://www.kucoin.com/docs-new/3470063w0
- https://www.kucoin.com/docs-new/3470064w0
