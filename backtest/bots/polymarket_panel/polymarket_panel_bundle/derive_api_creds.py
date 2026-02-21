#!/usr/bin/env python3
import argparse
import os

from py_clob_client.client import ClobClient


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


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--private-key", default=None)
    ap.add_argument("--funder", default=None)
    ap.add_argument(
        "--env-prefix",
        default="POLY",
        help="Env var prefix for secrets (e.g. POLY, POLY2).",
    )
    ap.add_argument("--signature-type", type=int, default=2)
    ap.add_argument("--clob-host", default="https://clob.polymarket.com")
    ap.add_argument("--chain-id", type=int, default=137)
    return ap.parse_args()


def main() -> None:
    args = parse_args()
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
    creds = client.create_or_derive_api_creds()
    if creds is None:
        raise RuntimeError("Failed to create/derive API creds.")

    prefix = _normalize_env_prefix(args.env_prefix) or "POLY"
    print(f'export {prefix}_API_KEY="{creds.api_key}"')
    print(f'export {prefix}_API_SECRET="{creds.api_secret}"')
    print(f'export {prefix}_API_PASSPHRASE="{creds.api_passphrase}"')


if __name__ == "__main__":
    main()
