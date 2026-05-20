# Exchange WebSocket Subscription RAG Index

Updated: 2026-05-13

Use this RAG pack when the agent is asked to create, repair, or explain streaming blocks that connect to CEX or Polymarket WebSocket market data.

The important distinction:

- Some WebSocket URLs include the stream name in the URL and start pushing data immediately.
- Other WebSocket URLs are generic endpoints. They require a subscribe payload to be sent after the socket opens.
- The Hershy streaming block should store both `url` and `subscribePayload` when the exchange requires a post-connect subscription message.
- If a user gives only a generic WebSocket URL and no subscribe payload, the strategy can connect but may receive no usable market data.

Recommended normalized streaming config fields:

```json
{
  "exchange": "okx",
  "method": "WEBSOCKET",
  "url": "wss://ws.okx.com:8443/ws/v5/public",
  "subscribePayload": {
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

Exchange-specific docs in this pack:

- `binance.md`: Binance Spot WebSocket stream names and live `SUBSCRIBE` message.
- `bybit.md`: Bybit V5 public subscribe messages with topic strings such as `tickers.BTCUSDT`.
- `okx.md`: OKX public subscribe messages with `channel` and `instId`.
- `kucoin.md`: KuCoin subscribe messages with `type`, `topic`, and optional `privateChannel`.
- `bitget.md`: Bitget subscribe messages with `instType`, `channel`, and `instId`.
- `gateio.md`: Gate.io v4 subscribe messages with `time`, `channel`, `event`, and channel-specific `payload`.
- `polymarket.md`: Polymarket CLOB market/user channel subscription messages.

Agent rules:

- Prefer exchange-native symbols in generated payloads.
- Do not invent private credentials. For private/user channels, reference stored connection credentials and mark authentication as required.
- For charting, prefer fields that represent last price, best bid/ask, close, mark/index price, or midpoint.
- Keep raw trade streams separate from ticker streams. A trade price is usable for a chart, but it is semantically different from a ticker/mark price.
- If the exchange has both URL-encoded stream names and post-connect subscriptions, choose the simplest valid form for the user's requested venue/channel.

Source links:

- Binance WebSocket Streams: https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams
- Bybit V5 WebSocket Connect: https://bybit-exchange.github.io/docs/v5/ws/connect
- OKX WebSocket API: https://www.okx.com/docs-v5/en/#websocket
- KuCoin WebSocket Ticker: https://www.kucoin.com/docs-new/3470063w0
- Bitget Spot Ticker Channel: https://www.bitget.com/api-doc/spot/websocket/public/Tickers-Channel
- Gate.io Spot WebSocket v4: https://www.gate.com/docs/developers/apiv4/ws/
- Polymarket WebSocket Overview: https://docs.polymarket.com/market-data/websocket/overview
