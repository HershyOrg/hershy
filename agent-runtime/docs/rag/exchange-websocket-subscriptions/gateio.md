# Gate.io WebSocket Subscriptions

Updated: 2026-05-13

Use this when the agent configures Gate.io Spot WebSocket v4 market data in a Hershy streaming block.

## Endpoint

```text
wss://api.gateio.ws/ws/v4/
```

## Subscribe Payload

Gate.io v4 subscriptions use a common envelope:

```json
{
  "time": 1611541000,
  "id": 123456789,
  "channel": "spot.tickers",
  "event": "subscribe",
  "payload": ["BTC_USDT"]
}
```

Order book:

```json
{
  "time": 1611541000,
  "id": 123456790,
  "channel": "spot.order_book",
  "event": "subscribe",
  "payload": ["BTC_USDT", "5", "100ms"]
}
```

Private order updates require `auth`:

```json
{
  "time": 1611541000,
  "id": 123456791,
  "channel": "spot.orders",
  "event": "subscribe",
  "payload": ["BTC_USDT"],
  "auth": {
    "method": "api_key",
    "KEY": "<api-key>",
    "SIGN": "<signature>"
  }
}
```

## Common Channels

- Ticker: `spot.tickers`
- Trades: `spot.trades`
- Order book: `spot.order_book`
- Private orders: `spot.orders`

## Chart Field Hints

For ticker updates, useful fields depend on the channel result shape. Prefer:

- `result.last`: last traded price
- `result.highest_bid`: recent best bid
- `result.lowest_ask`: recent best ask

Gate.io spot symbols use underscore format, e.g. `BTC_USDT`.

## Hershy Example

```json
{
  "exchange": "gate",
  "method": "WEBSOCKET",
  "url": "wss://api.gateio.ws/ws/v4/",
  "subscribePayload": {
    "time": 1611541000,
    "id": 123456789,
    "channel": "spot.tickers",
    "event": "subscribe",
    "payload": ["BTC_USDT"]
  },
  "symbol": "BTC_USDT",
  "channel": "ticker",
  "updateIntervalMs": 1000,
  "requiresDynamicTimestamp": true
}
```

Agent note: replace `time` with current Unix seconds at runtime or mark `requiresDynamicTimestamp: true` so the runner does not reuse a stale timestamp.

Source:

- https://www.gate.com/docs/developers/apiv4/ws/
