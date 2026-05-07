#!/usr/bin/env python3
import argparse
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from web3 import Web3

from _parquet_roll import RollingParquetWriter
# Polygon BTC/USD Chainlink Price Feed (EACAggregatorProxy)
FEED_ADDRESS = "0xc907E116054Ad103354f2D350FD2514433D57F6f"

AGGREGATOR_V3_ABI = [
    {
        "inputs": [],
        "name": "decimals",
        "outputs": [{"type": "uint8"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "description",
        "outputs": [{"type": "string"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "latestRoundData",
        "outputs": [
            {"type": "uint80", "name": "roundId"},
            {"type": "int256", "name": "answer"},
            {"type": "uint256", "name": "startedAt"},
            {"type": "uint256", "name": "updatedAt"},
            {"type": "uint80", "name": "answeredInRound"},
        ],
        "stateMutability": "view",
        "type": "function",
    },
]


def utc_iso_from_ms(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


def _require_rpc(rpc_arg: str | None) -> str:
    rpc = rpc_arg or os.environ.get("POLYRPC")
    if not rpc:
        raise SystemExit("Missing POLYRPC env var (or pass --rpc)")
    return rpc


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", default="btc/usd")
    ap.add_argument("--out-dir", default="src/out/cex_oracle/chainlink")
    ap.add_argument("--file-prefix", default="chainlink_1s")
    ap.add_argument("--poll-sec", type=float, default=1.0)
    ap.add_argument("--rpc", default=None, help="Override POLYRPC")
    ap.add_argument("--feed", default=FEED_ADDRESS)
    args = ap.parse_args()

    rpc = _require_rpc(args.rpc)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    w3 = Web3(Web3.HTTPProvider(rpc))
    if not w3.is_connected():
        raise SystemExit("RPC connection failed. Check POLYRPC.")

    addr = w3.to_checksum_address(args.feed)
    c = w3.eth.contract(address=addr, abi=AGGREGATOR_V3_ABI)

    decimals = int(c.functions.decimals().call())
    _ = c.functions.description().call()

    writer = RollingParquetWriter(out_dir, args.file_prefix, window_sec=300)
    last_written_sec = None

    while True:
        now_ms = int(time.time() * 1000)
        now_sec = now_ms // 1000
        if last_written_sec == now_sec:
            time.sleep(0.05)
            continue

        try:
            round_id, answer, _started_at, updated_at, _answered_in_round = (
                c.functions.latestRoundData().call()
            )
        except Exception:
            time.sleep(args.poll_sec)
            continue

        price = float(answer) / (10 ** decimals)
        last_written_sec = now_sec

        writer.write(
            {
                "ts": utc_iso_from_ms(now_ms),
                "ts_ms": now_ms,
                "source": "CHAINLINK_RPC",
                "symbol": args.symbol,
                "price": price,
                "round_id": int(round_id),
                "updated_at": int(updated_at),
            }
        )

        time.sleep(args.poll_sec)


if __name__ == "__main__":
    main()
