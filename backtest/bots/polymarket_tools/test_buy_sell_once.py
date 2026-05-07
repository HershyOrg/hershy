#!/usr/bin/env python3
import argparse
import json
import os
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
LIBS_DIR = REPO_ROOT / "libs"
if str(LIBS_DIR) not in sys.path:
    sys.path.insert(0, str(LIBS_DIR))

from py_clob_client.client import ClobClient
from py_clob_client.clob_types import (
    ApiCreds,
    AssetType,
    BalanceAllowanceParams,
    MarketOrderArgs,
    OrderType,
)
from py_clob_client.order_builder.constants import BUY, SELL

from polymarket_utils import fetch_market_by_slug, normalize_slug, resolve_yes_no_tokens

USDC_SCALE = 1_000_000
CONDITIONAL_SCALE = 1_000_000


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


def _scale_conditional_balance(raw) -> float:
    if raw is None:
        return 0.0
    if isinstance(raw, str) and "." in raw:
        return float(raw)
    return float(raw) / CONDITIONAL_SCALE


def _get_conditional_balance(client: ClobClient, token_id: str) -> float:
    params = BalanceAllowanceParams(asset_type=AssetType.CONDITIONAL, token_id=token_id)
    resp = client.get_balance_allowance(params)
    return _scale_conditional_balance(resp.get("balance"))


def _post_market_order(
    client: ClobClient, token_id: str, amount: float, side: str, order_type: OrderType
) -> dict:
    order_args = MarketOrderArgs(
        token_id=token_id,
        amount=amount,
        side=side,
        order_type=order_type,
    )
    signed = client.create_market_order(order_args)
    return client.post_order(signed, order_args.order_type)


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--slug",
        default="bitcoin-up-or-down-january-21-11am-et",
        help="Market slug to trade.",
    )
    ap.add_argument("--side", choices=["yes", "no"], default="yes")
    ap.add_argument("--usdc", type=float, default=1.0)
    ap.add_argument("--order-type", default="FAK")
    ap.add_argument("--max-wait-sec", type=int, default=20)
    ap.add_argument("--poll-sec", type=float, default=1.0)

    ap.add_argument("--private-key", default=None)
    ap.add_argument("--funder", default=None)
    ap.add_argument(
        "--env-prefix",
        default="POLY",
        help="Env var prefix for secrets (e.g. POLY, POLY2).",
    )
    ap.add_argument("--signature-type", type=int, default=2)
    ap.add_argument("--api-key", default=None)
    ap.add_argument("--api-secret", default=None)
    ap.add_argument("--api-passphrase", default=None)
    ap.add_argument("--clob-host", default="https://clob.polymarket.com")
    ap.add_argument("--chain-id", type=int, default=137)
    return ap.parse_args()


def main() -> None:
    args = parse_args()
    slug = normalize_slug(args.slug)
    market = fetch_market_by_slug(slug)
    tokens = resolve_yes_no_tokens(market, slug)
    token_id = tokens.yes_token_id if args.side == "yes" else tokens.no_token_id

    private_key = _resolve_env(
        args.private_key, "PRIVATE_KEY", "private-key", args.env_prefix
    )
    funder = _resolve_env(args.funder, "FUNDER", "funder", args.env_prefix)
    client = ClobClient(
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
        client.set_api_creds(
            ApiCreds(
                api_key=api_key,
                api_secret=api_secret,
                api_passphrase=api_passphrase,
            )
        )
    else:
        client.set_api_creds(client.create_or_derive_api_creds())

    order_type = _parse_order_type(args.order_type)

    print(f"[MARKET] slug={tokens.slug} token_id={token_id} side={args.side}")
    print(f"[BUY] usdc={args.usdc:.6f} order_type={order_type}")
    buy_resp = _post_market_order(client, token_id, args.usdc, BUY, order_type)
    print(f"[BUY] resp={json.dumps(buy_resp, separators=(',', ':'))}")

    start = time.time()
    shares = 0.0
    while time.time() - start < args.max_wait_sec:
        shares = _get_conditional_balance(client, token_id)
        if shares > 0:
            break
        time.sleep(args.poll_sec)

    if shares <= 0:
        raise RuntimeError("No conditional token balance detected after buy.")

    print(f"[SELL] shares={shares:.6f} order_type={order_type}")
    sell_resp = _post_market_order(client, token_id, shares, SELL, order_type)
    print(f"[SELL] resp={json.dumps(sell_resp, separators=(',', ':'))}")


if __name__ == "__main__":
    main()
