#!/usr/bin/env python3
import argparse
import datetime as dt
import json
import os
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

from py_clob_client.client import ClobClient
from py_clob_client.clob_types import (
    ApiCreds,
    AssetType,
    BalanceAllowanceParams,
    MarketOrderArgs,
    OrderType,
)
from py_clob_client.order_builder.constants import BUY, SELL

from polymarket_utils import (
    ET_TZ,
    fetch_market_by_slug,
    normalize_slug,
    resolve_yes_no_tokens,
)

USDC_SCALE = 1_000_000
CONDITIONAL_SCALE = 1_000_000
AUTO_15M = "__AUTO_15M__"


def _current_15m_slug(prefix: str) -> str:
    now_et = dt.datetime.now(tz=ET_TZ)
    minute = (now_et.minute // 15) * 15
    start_et = now_et.replace(minute=minute, second=0, microsecond=0)
    ts = int(start_et.astimezone(dt.timezone.utc).timestamp())
    return f"{prefix}-{ts}"


def _normalize_env_prefix(prefix: str | None) -> str | None:
    if prefix is None:
        return None
    cleaned = prefix.strip()
    return cleaned or None


def _env_key(base_key: str, env_prefix: str | None) -> str:
    prefix = _normalize_env_prefix(env_prefix)
    if prefix:
        return f"{prefix}_{base_key}"
    return base_key


def _resolve_env(
    value: str | None, base_env_key: str, arg_name: str, env_prefix: str | None
) -> str:
    if value:
        return value
    env_key = _env_key(base_env_key, env_prefix)
    env_value = os.getenv(env_key)
    if env_value:
        return env_value
    raise RuntimeError(f"Missing {env_key}. Provide --{arg_name} or set env var.")


def _resolve_optional_env(value: str | None, base_env_key: str, env_prefix: str | None):
    if value:
        return value
    env_key = _env_key(base_env_key, env_prefix)
    return os.getenv(env_key)


def _parse_order_type(name: str) -> OrderType:
    name = name.upper()
    if name == "FOK":
        return OrderType.FOK
    if name == "FAK":
        return OrderType.FAK
    raise ValueError("order_type must be FOK or FAK")


def _safe_float(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _scale_conditional_balance(raw) -> float:
    if raw is None:
        return 0.0
    if isinstance(raw, str) and "." in raw:
        return _safe_float(raw)
    return _safe_float(raw) / CONDITIONAL_SCALE


def _best_bid_ask(book) -> tuple[float | None, float | None]:
    bids = getattr(book, "bids", None) or []
    asks = getattr(book, "asks", None) or []
    best_bid = None
    best_ask = None
    for lvl in bids:
        price = _safe_float(getattr(lvl, "price", None))
        if price > 0 and (best_bid is None or price > best_bid):
            best_bid = price
    for lvl in asks:
        price = _safe_float(getattr(lvl, "price", None))
        if price > 0 and (best_ask is None or price < best_ask):
            best_ask = price
    return best_bid, best_ask


def _mid_from_bid_ask(bid: float | None, ask: float | None) -> float | None:
    if bid is None or ask is None:
        return None
    return (bid + ask) / 2.0


class MarketCache:
    def __init__(self):
        self.by_slug: dict[str, dict] = {}

    def resolve(self, slug: str) -> dict:
        slug = normalize_slug(slug)
        if slug in self.by_slug:
            return self.by_slug[slug]
        market = fetch_market_by_slug(slug)
        tokens = resolve_yes_no_tokens(market, slug)
        payload = {
            "slug": tokens.slug,
            "yes_token_id": tokens.yes_token_id,
            "no_token_id": tokens.no_token_id,
            "market_id": tokens.market_id,
            "enable_orderbook": tokens.enable_orderbook,
            "closed": tokens.closed,
            "active": tokens.active,
            "start_date": tokens.start_date,
            "end_date": tokens.end_date,
        }
        self.by_slug[slug] = payload
        return payload


class TradePanelApp:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.cache = MarketCache()
        self.order_type = _parse_order_type(args.order_type)
        self.auto_15m_prefix = args.auto_15m_prefix

        private_key = _resolve_env(
            args.private_key, "PRIVATE_KEY", "private-key", args.env_prefix
        )
        funder = _resolve_env(args.funder, "FUNDER", "funder", args.env_prefix)
        self.client = ClobClient(
            args.clob_host,
            key=private_key,
            chain_id=args.chain_id,
            signature_type=args.signature_type,
            funder=funder,
        )

        api_key = _resolve_optional_env(args.api_key, "API_KEY", args.env_prefix)
        api_secret = _resolve_optional_env(args.api_secret, "API_SECRET", args.env_prefix)
        api_passphrase = _resolve_optional_env(
            args.api_passphrase, "API_PASSPHRASE", args.env_prefix
        )
        if api_key and api_secret and api_passphrase:
            self.client.set_api_creds(
                ApiCreds(
                    api_key=api_key,
                    api_secret=api_secret,
                    api_passphrase=api_passphrase,
                )
            )
        else:
            self.client.set_api_creds(self.client.create_or_derive_api_creds())

    def market_snapshot(self, slug: str) -> dict:
        slug = self._resolve_slug(slug)
        info = self.cache.resolve(slug)
        yes_book = self.client.get_order_book(info["yes_token_id"])
        no_book = self.client.get_order_book(info["no_token_id"])
        yes_bid, yes_ask = _best_bid_ask(yes_book)
        no_bid, no_ask = _best_bid_ask(no_book)
        return {
            "slug": info["slug"],
            "yes_token_id": info["yes_token_id"],
            "no_token_id": info["no_token_id"],
            "enable_orderbook": info["enable_orderbook"],
            "closed": info["closed"],
            "active": info["active"],
            "start_date": info["start_date"],
            "end_date": info["end_date"],
            "yes": {
                "bid": yes_bid,
                "ask": yes_ask,
                "mid": _mid_from_bid_ask(yes_bid, yes_ask),
            },
            "no": {
                "bid": no_bid,
                "ask": no_ask,
                "mid": _mid_from_bid_ask(no_bid, no_ask),
            },
            "ts_ms": int(time.time() * 1000),
        }

    def _get_conditional_balance(self, token_id: str) -> float:
        params = BalanceAllowanceParams(asset_type=AssetType.CONDITIONAL, token_id=token_id)
        resp = self.client.get_balance_allowance(params)
        return _scale_conditional_balance(resp.get("balance"))

    def market_buy(self, slug: str, side: str, usdc: float) -> dict:
        info = self.cache.resolve(self._resolve_slug(slug))
        token_id = info["yes_token_id"] if side == "yes" else info["no_token_id"]
        order_args = MarketOrderArgs(
            token_id=token_id,
            amount=usdc,
            side=BUY,
            order_type=self.order_type,
        )
        signed = self.client.create_market_order(order_args)
        return self.client.post_order(signed, order_args.order_type)

    def market_sell(self, slug: str, side: str, shares: float | None) -> dict:
        info = self.cache.resolve(self._resolve_slug(slug))
        token_id = info["yes_token_id"] if side == "yes" else info["no_token_id"]
        if shares is None:
            shares = self._get_conditional_balance(token_id)
        order_args = MarketOrderArgs(
            token_id=token_id,
            amount=shares,
            side=SELL,
            order_type=self.order_type,
        )
        signed = self.client.create_market_order(order_args)
        return self.client.post_order(signed, order_args.order_type)

    def _resolve_slug(self, slug: str | None) -> str:
        if self.auto_15m_prefix and (slug == AUTO_15M or not slug):
            return _current_15m_slug(self.auto_15m_prefix)
        if not slug:
            raise RuntimeError("Missing slug")
        return slug


def _html_page(slugs: list[str], default_usdc: float, auto_prefix: str | None) -> str:
    options = []
    if auto_prefix:
        auto_label = f"AUTO (15m): {auto_prefix}-<ts>"
        options.append(f'<option value="{AUTO_15M}">{auto_label}</option>')
    for s in slugs:
        options.append(f'<option value="{s}">{s}</option>')
    options = "\n".join(
        options
    )
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Polymarket Trade Panel</title>
  <style>
    :root {{
      --bg: #f7f3ea;
      --ink: #1b1f24;
      --muted: #5b6777;
      --accent: #1f7a8c;
      --accent-2: #e76f51;
      --card: #ffffff;
      --line: #e6dfd1;
      --shadow: 0 10px 30px rgba(18, 27, 38, 0.12);
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: "Space Grotesk", "Avenir Next", "Helvetica Neue", sans-serif;
      color: var(--ink);
      background: radial-gradient(circle at 10% 10%, #fff6e6 0%, #f7f3ea 40%, #eef3f5 100%);
      min-height: 100vh;
    }}
    .wrap {{
      max-width: 980px;
      margin: 0 auto;
      padding: 32px 24px 64px;
      animation: rise 0.8s ease-out;
    }}
    header {{
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      align-items: center;
      justify-content: space-between;
    }}
    .title {{
      font-size: 28px;
      font-weight: 600;
      letter-spacing: -0.02em;
    }}
    .subtitle {{
      color: var(--muted);
      font-size: 14px;
      margin-top: 6px;
    }}
    .panel {{
      margin-top: 24px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 18px;
    }}
    .card {{
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 18px;
      box-shadow: var(--shadow);
      position: relative;
      overflow: hidden;
    }}
    .card::after {{
      content: "";
      position: absolute;
      inset: 0;
      border-radius: 16px;
      background: linear-gradient(120deg, rgba(31, 122, 140, 0.08), transparent 60%);
      pointer-events: none;
    }}
    .card h3 {{
      margin: 0 0 10px;
      font-size: 16px;
      font-weight: 600;
    }}
    .pill {{
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 999px;
      font-size: 12px;
      background: #f1f5f9;
      color: var(--muted);
    }}
    .value {{
      font-size: 24px;
      font-weight: 600;
      margin: 8px 0;
    }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }}
    .label {{
      font-size: 12px;
      color: var(--muted);
    }}
    .controls {{
      margin-top: 24px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 18px;
    }}
    .btn {{
      width: 100%;
      padding: 12px 14px;
      border-radius: 12px;
      border: none;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.12s ease, box-shadow 0.12s ease;
    }}
    .btn:active {{
      transform: translateY(1px) scale(0.98);
    }}
    .btn.buy {{
      background: var(--accent);
      color: white;
    }}
    .btn.sell {{
      background: #edf2f7;
      color: var(--ink);
      border: 1px solid var(--line);
    }}
    .btn.no {{
      background: var(--accent-2);
      color: white;
    }}
    .field {{
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 13px;
      color: var(--muted);
    }}
    input, select {{
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid var(--line);
      font-size: 14px;
      background: white;
    }}
    .log {{
      margin-top: 18px;
      padding: 12px 14px;
      background: #111827;
      color: #e5e7eb;
      border-radius: 12px;
      font-family: "IBM Plex Mono", "Menlo", monospace;
      font-size: 12px;
      min-height: 80px;
      white-space: pre-wrap;
    }}
    .fade {{
      animation: fadeIn 0.6s ease;
    }}
    @keyframes rise {{
      from {{ opacity: 0; transform: translateY(12px); }}
      to {{ opacity: 1; transform: translateY(0); }}
    }}
    @keyframes fadeIn {{
      from {{ opacity: 0; }}
      to {{ opacity: 1; }}
    }}
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div>
        <div class="title">Market Trade Panel</div>
        <div class="subtitle">Live orderbook tracking + manual market orders</div>
      </div>
      <div class="field">
        <label for="marketSelect">Market slug</label>
        <select id="marketSelect">
          {options}
        </select>
      </div>
    </header>

    <section class="panel">
      <div class="card" id="yesCard">
        <h3>YES</h3>
        <div class="value" id="yesMid">-</div>
        <div class="grid">
          <div>
            <div class="label">Bid</div>
            <div id="yesBid">-</div>
          </div>
          <div>
            <div class="label">Ask</div>
            <div id="yesAsk">-</div>
          </div>
        </div>
      </div>
      <div class="card" id="noCard">
        <h3>NO</h3>
        <div class="value" id="noMid">-</div>
        <div class="grid">
          <div>
            <div class="label">Bid</div>
            <div id="noBid">-</div>
          </div>
          <div>
            <div class="label">Ask</div>
            <div id="noAsk">-</div>
          </div>
        </div>
      </div>
      <div class="card">
        <h3>Status</h3>
        <div class="pill" id="marketStatus">loading...</div>
        <div class="grid" style="margin-top: 12px;">
          <div>
            <div class="label">Start</div>
            <div id="marketStart">-</div>
          </div>
          <div>
            <div class="label">End</div>
            <div id="marketEnd">-</div>
          </div>
          <div>
            <div class="label">Updated</div>
            <div id="marketUpdated">-</div>
          </div>
        </div>
      </div>
    </section>

    <section class="controls">
      <div class="card">
        <h3>Buy</h3>
        <div class="field">
          <label for="usdcInput">USDC amount</label>
          <input id="usdcInput" type="number" step="0.01" min="0" value="{default_usdc}">
        </div>
        <div style="margin-top: 12px; display: grid; gap: 10px;">
          <button class="btn buy" onclick="placeOrder('buy', 'yes')">Buy YES</button>
          <button class="btn no" onclick="placeOrder('buy', 'no')">Buy NO</button>
        </div>
      </div>
      <div class="card">
        <h3>Sell</h3>
        <div class="field">
          <label>Sell all shares</label>
        </div>
        <div style="margin-top: 12px; display: grid; gap: 10px;">
          <button class="btn sell" onclick="placeOrder('sell', 'yes')">Sell YES</button>
          <button class="btn sell" onclick="placeOrder('sell', 'no')">Sell NO</button>
        </div>
      </div>
      <div class="card">
        <h3>Activity</h3>
        <div class="log" id="logBox">Waiting for updates...</div>
      </div>
    </section>
  </div>

  <script>
    const logBox = document.getElementById('logBox');
    const marketSelect = document.getElementById('marketSelect');
    const fmt = (v) => (v === null || v === undefined) ? '-' : v.toFixed(4);

    function appendLog(text) {{
      logBox.textContent = text + "\\n" + logBox.textContent;
    }}

    async function refresh() {{
      const slug = marketSelect.value;
      try {{
        const res = await fetch(`/api/market?slug=${{encodeURIComponent(slug)}}`, {{
          cache: 'no-store'
        }});
        const data = await res.json();
        if (!res.ok) {{
          appendLog(`error: ${{data.error || res.status}}`);
          return;
        }}
        if (marketSelect.value === "{AUTO_15M}") {{
          const opt = marketSelect.options[marketSelect.selectedIndex];
          opt.textContent = `AUTO (15m): ${{data.slug}}`;
        }}
        document.getElementById('yesBid').textContent = fmt(data.yes.bid);
        document.getElementById('yesAsk').textContent = fmt(data.yes.ask);
        document.getElementById('yesMid').textContent = fmt(data.yes.mid);
        document.getElementById('noBid').textContent = fmt(data.no.bid);
        document.getElementById('noAsk').textContent = fmt(data.no.ask);
        document.getElementById('noMid').textContent = fmt(data.no.mid);
        const status = data.closed ? 'closed' : (data.active ? 'active' : 'inactive');
        document.getElementById('marketStatus').textContent = `${{status}} | ${{data.slug}}`;
        document.getElementById('marketStart').textContent = data.start_date || '-';
        document.getElementById('marketEnd').textContent = data.end_date || '-';
        const updated = data.ts_ms ? new Date(data.ts_ms).toLocaleTimeString() : '-';
        document.getElementById('marketUpdated').textContent = updated;
      }} catch (err) {{
        appendLog(`error: ${{err}}`);
      }}
    }}

    async function placeOrder(action, side) {{
      const slug = marketSelect.value;
      const usdc = parseFloat(document.getElementById('usdcInput').value || "0");
      const payload = {{
        slug,
        side,
        usdc,
      }};
      try {{
        const res = await fetch(`/api/${{action}}`, {{
          method: 'POST',
          headers: {{ 'Content-Type': 'application/json' }},
          body: JSON.stringify(payload),
        }});
        const data = await res.json();
        if (!res.ok) {{
          appendLog(`error: ${{data.error || res.status}}`);
          return;
        }}
        appendLog(`${{action}}/${{side}} ok: ${{JSON.stringify(data)}}`);
      }} catch (err) {{
        appendLog(`error: ${{err}}`);
      }}
    }}

    marketSelect.addEventListener('change', () => refresh());
    refresh();
    setInterval(refresh, 1000);
  </script>
</body>
</html>
"""


class TradePanelHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/":
            html = _html_page(
                self.server.slugs, self.server.default_usdc, self.server.auto_15m_prefix
            )
            self._send(200, html, "text/html; charset=utf-8")
            return
        if parsed.path == "/api/market":
            qs = parse_qs(parsed.query)
            slug = (qs.get("slug") or [None])[0]
            try:
                payload = self.server.app.market_snapshot(slug)
            except Exception as exc:
                self._send_json(500, {"error": str(exc)})
                return
            self._send_json(200, payload)
            return
        self._send(404, "not found", "text/plain; charset=utf-8")

    def do_POST(self):
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length > 0 else b""
        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except json.JSONDecodeError:
            self._send_json(400, {"error": "invalid JSON"})
            return

        slug = payload.get("slug")
        side = payload.get("side")
        if not slug or side not in ("yes", "no"):
            self._send_json(400, {"error": "missing slug or side"})
            return

        try:
            if parsed.path == "/api/buy":
                usdc = float(payload.get("usdc") or 0.0)
                if usdc <= 0:
                    self._send_json(400, {"error": "usdc must be > 0"})
                    return
                resp = self.server.app.market_buy(slug, side, usdc)
                self._send_json(200, resp)
                return
            if parsed.path == "/api/sell":
                shares = payload.get("shares")
                shares_val = float(shares) if shares is not None else None
                resp = self.server.app.market_sell(slug, side, shares_val)
                self._send_json(200, resp)
                return
        except Exception as exc:
            self._send_json(500, {"error": str(exc)})
            return

        self._send_json(404, {"error": "not found"})

    def log_message(self, format, *args):
        return

    def _send(self, code: int, body: str, ctype: str):
        data = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_json(self, code: int, payload: dict):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", action="append", help="Market slug(s)")
    ap.add_argument(
        "--auto-15m-prefix",
        default=None,
        help="Auto-switch 15m markets using prefix (e.g. btc-updown-15m).",
    )
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--order-type", default="FAK")
    ap.add_argument("--default-usdc", type=float, default=1.0)

    ap.add_argument("--private-key", default=None)
    ap.add_argument("--funder", default=None)
    ap.add_argument("--env-prefix", default="POLY")
    ap.add_argument("--signature-type", type=int, default=2)
    ap.add_argument("--api-key", default=None)
    ap.add_argument("--api-secret", default=None)
    ap.add_argument("--api-passphrase", default=None)
    ap.add_argument("--clob-host", default="https://clob.polymarket.com")
    ap.add_argument("--chain-id", type=int, default=137)
    return ap.parse_args()


def main() -> None:
    args = parse_args()
    if not args.slug and not args.auto_15m_prefix:
        raise RuntimeError("Provide --slug or --auto-15m-prefix.")
    slugs = [normalize_slug(s) for s in (args.slug or [])]
    app = TradePanelApp(args)

    server = HTTPServer((args.host, args.port), TradePanelHandler)
    server.app = app
    server.slugs = slugs
    server.auto_15m_prefix = args.auto_15m_prefix
    server.default_usdc = args.default_usdc
    print(f"[OK] trade panel at http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
