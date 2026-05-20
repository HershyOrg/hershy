# Binance WebSocket Subscriptions

Updated: 2026-05-13

Use this when the agent configures Binance Spot WebSocket market data in a Hershy streaming block.

## Endpoints

Raw stream with stream name in URL:

```text
wss://stream.binance.com:9443/ws/<streamName>
```

Combined stream with stream names in URL:

```text
wss://stream.binance.com:9443/stream?streams=<streamName1>/<streamName2>
```

Generic raw socket that needs a post-connect subscribe payload:

```text
wss://stream.binance.com:9443/ws
```

## Subscribe Payload

Binance supports live subscribing after opening the WebSocket.

```json
{
  "method": "SUBSCRIBE",
  "params": ["btcusdt@ticker"],
  "id": 1
}
```

Multiple streams:

```json
{
  "method": "SUBSCRIBE",
  "params": ["btcusdt@aggTrade", "btcusdt@depth"],
  "id": 1
}
```

Unsubscribe:

```json
{
  "method": "UNSUBSCRIBE",
  "params": ["btcusdt@ticker"],
  "id": 2
}
```

## Common Stream Names

- Ticker: `btcusdt@ticker`
- Mini ticker: `btcusdt@miniTicker`
- Trade: `btcusdt@trade`
- Aggregate trade: `btcusdt@aggTrade`
- Kline: `btcusdt@kline_1m`
- Book ticker: `btcusdt@bookTicker`
- Depth: `btcusdt@depth` or `btcusdt@depth@100ms`

## Chart Field Hints

For ticker payloads, useful chart fields include:

- `c`: last price
- `b`: best bid
- `a`: best ask
- `w`: weighted average price
- `o`, `h`, `l`: open, high, low

For kline payloads, use nested `k.c` as close price.

## Hershy Example

Direct URL, no subscribe payload required:

```json
{
  "exchange": "binance",
  "method": "WEBSOCKET",
  "url": "wss://stream.binance.com:9443/ws/btcusdt@ticker",
  "subscribePayload": null,
  "symbol": "BTCUSDT",
  "channel": "ticker",
  "updateIntervalMs": 1000
}
```

Generic URL with subscribe payload:

```json
{
  "exchange": "binance",
  "method": "WEBSOCKET",
  "url": "wss://stream.binance.com:9443/ws",
  "subscribePayload": {
    "method": "SUBSCRIBE",
    "params": ["btcusdt@ticker"],
    "id": 1
  },
  "symbol": "BTCUSDT",
  "channel": "ticker",
  "updateIntervalMs": 1000
}
```

Source:

- https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams
