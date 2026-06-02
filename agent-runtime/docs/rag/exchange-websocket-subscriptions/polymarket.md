# Polymarket WebSocket Subscriptions

Updated: 2026-05-13

Use this when the agent configures Polymarket CLOB WebSocket market/user data in a Hershy streaming block.

## Channels

Polymarket provides multiple WebSocket channels. The most relevant for charting a market price is the public CLOB market channel.

Market channel:

```text
wss://ws-subscriptions-clob.polymarket.com/ws/market
```

User channel:

```text
wss://ws-subscriptions-clob.polymarket.com/ws/user
```

The market channel does not require auth. The user channel requires L2 API credentials.

## Market Subscribe Payload

Subscribe by CLOB token IDs, not by slug or condition ID.

```json
{
  "assets_ids": ["<token_id_1>", "<token_id_2>"],
  "type": "market",
  "custom_feature_enabled": true
}
```

`custom_feature_enabled: true` enables additional events such as `best_bid_ask`, `new_market`, and `market_resolved`.

Dynamic subscribe:

```json
{
  "assets_ids": ["<new_token_id>"],
  "operation": "subscribe",
  "custom_feature_enabled": true
}
```

Dynamic unsubscribe:

```json
{
  "assets_ids": ["<token_id_to_remove>"],
  "operation": "unsubscribe"
}
```

## User Subscribe Payload

Subscribe by condition IDs, not by token IDs.

```json
{
  "auth": {
    "apiKey": "<api-key>",
    "secret": "<api-secret>",
    "passphrase": "<api-passphrase>"
  },
  "markets": ["<condition_id>"],
  "type": "user"
}
```

## Heartbeat

For market and user channels, send:

```text
PING
```

The server responds with `PONG`.

## Event Types

Market channel events include:

- `book`: order book snapshot
- `price_change`: price level update
- `tick_size_change`: minimum tick size change
- `last_trade_price`: matched trade price
- `best_bid_ask`: best bid/ask update, requires `custom_feature_enabled: true`
- `new_market`: new market metadata, requires `custom_feature_enabled: true`
- `market_resolved`: market resolution update, requires `custom_feature_enabled: true`

## Chart Field Hints

For probability/price charting:

- `last_trade_price.price`
- `best_bid_ask.best_bid`
- `best_bid_ask.best_ask`
- midpoint: `(best_bid + best_ask) / 2`
- `price_change.price`

Market channel payloads use token IDs as `asset_id`. A binary market has separate YES/NO token IDs.

## Hershy Example

```json
{
  "exchange": "polymarket",
  "method": "WEBSOCKET",
  "url": "wss://ws-subscriptions-clob.polymarket.com/ws/market",
  "subscribePayload": {
    "assets_ids": ["<yes_or_no_token_id>"],
    "type": "market",
    "custom_feature_enabled": true
  },
  "symbol": "<condition_id_or_market_slug>",
  "tokenId": "<yes_or_no_token_id>",
  "channel": "market",
  "updateIntervalMs": 1000
}
```

Agent notes:

- For public market data, L1/L2 auth is not required.
- For user/order activity, L2 API credentials are required.
- For actual trading, Polymarket uses wallet/L1 signing plus L2 API credentials generated from the wallet flow. Do not assume market WebSocket auth is enough for trading.

Source:

- https://docs.polymarket.com/market-data/websocket/overview
- https://docs.polymarket.com/developers/CLOB/websocket/market-channel-migration-guide
