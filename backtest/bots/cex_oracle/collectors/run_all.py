#!/usr/bin/env python3
import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
COLLECTORS_DIR = Path(__file__).resolve().parent


def utc_now_id() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def p(*args, cwd: Path) -> subprocess.Popen:
    return subprocess.Popen([sys.executable, *args], cwd=str(cwd))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-dir", default="src/out/cex_oracle")
    ap.add_argument("--session", default=None, help="Session id (default: UTC timestamp)")
    ap.add_argument("--chainlink-symbol", default="btc/usd")
    ap.add_argument("--chainlink-rpc", default=None, help="Override POLYRPC for Chainlink RPC collector")
    ap.add_argument("--symbol", default="BTC-USDT", help="Default symbol for cryptofeed exchanges")
    ap.add_argument("--symbol-map", default=None, help="JSON file mapping exchange->symbol")
    ap.add_argument("--binance-symbol", default="BTCUSDT")
    ap.add_argument("--coinbase-symbol", default="BTC-USD")
    ap.add_argument("--upbit-symbol", default="KRW-BTC")
    ap.add_argument("--bitget-symbol", default="BTCUSDT")
    ap.add_argument("--kucoin-symbol", default="BTC-USDT")
    ap.add_argument("--mexc-symbol", default="BTCUSDT")
    ap.add_argument("--polymarket-slug", default=None, help="Polymarket market slug for chance tracking")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    base_dir = ROOT / args.base_dir
    session_id = args.session or utc_now_id()
    session_dir = base_dir / session_id
    chainlink_dir = session_dir / "chainlink"
    exchanges_dir = session_dir / "exchanges"
    mexc_dir = session_dir / "mexc"
    coinbase_dir = session_dir / "coinbase"
    upbit_dir = session_dir / "upbit"
    bitget_dir = session_dir / "bitget"
    kucoin_dir = session_dir / "kucoin"
    polymarket_dir = session_dir / "polymarket"
    binance_dir = session_dir / "binance"

    for d in (chainlink_dir, exchanges_dir, mexc_dir, coinbase_dir, upbit_dir, bitget_dir, kucoin_dir, polymarket_dir, binance_dir):
        d.mkdir(parents=True, exist_ok=True)

    meta = {
        "session": session_id,
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "chainlink_symbol": args.chainlink_symbol,
        "default_symbol": args.symbol,
        "symbol_map": args.symbol_map,
        "coinbase_symbol": args.coinbase_symbol,
        "upbit_symbol": args.upbit_symbol,
        "bitget_symbol": args.bitget_symbol,
        "kucoin_symbol": args.kucoin_symbol,
        "mexc_symbol": args.mexc_symbol,
        "polymarket_slug": args.polymarket_slug,
        "binance_symbol": args.binance_symbol,
        "paths": {
            "chainlink": str(chainlink_dir),
            "exchanges": str(exchanges_dir),
            "mexc": str(mexc_dir),
            "coinbase": str(coinbase_dir),
            "upbit": str(upbit_dir),
            "bitget": str(bitget_dir),
            "kucoin": str(kucoin_dir),
            "polymarket": str(polymarket_dir),
            "binance": str(binance_dir),
        },
    }
    (session_dir / "session.json").write_text(json.dumps(meta, indent=2))

    latest_path = base_dir / "LATEST"
    latest_path.write_text(session_id)

    cmd_chainlink = [
        str(COLLECTORS_DIR / "rtds_chainlink.py"),
        "--symbol",
        args.chainlink_symbol,
        "--out-dir",
        str(chainlink_dir),
    ]
    if args.chainlink_rpc:
        cmd_chainlink += ["--rpc", args.chainlink_rpc]
    cmd_exchanges = [
        str(COLLECTORS_DIR / "exchanges_cryptofeed.py"),
        "--symbol",
        args.symbol,
        "--out-dir",
        str(exchanges_dir),
    ]
    if args.symbol_map:
        cmd_exchanges += ["--symbol-map", args.symbol_map]
    cmd_mexc = [
        str(COLLECTORS_DIR / "mexc_rest.py"),
        "--symbol",
        args.mexc_symbol,
        "--out-dir",
        str(mexc_dir),
    ]
    cmd_coinbase = [
        str(COLLECTORS_DIR / "coinbase_rest.py"),
        "--symbol",
        args.coinbase_symbol,
        "--out-dir",
        str(coinbase_dir),
    ]
    cmd_upbit = [
        str(COLLECTORS_DIR / "upbit_rest.py"),
        "--symbol",
        args.upbit_symbol,
        "--out-dir",
        str(upbit_dir),
    ]
    cmd_bitget = [
        str(COLLECTORS_DIR / "bitget_rest.py"),
        "--symbol",
        args.bitget_symbol,
        "--out-dir",
        str(bitget_dir),
    ]
    cmd_kucoin = [
        str(COLLECTORS_DIR / "kucoin_rest.py"),
        "--symbol",
        args.kucoin_symbol,
        "--out-dir",
        str(kucoin_dir),
    ]
    cmd_polymarket = [
        str(COLLECTORS_DIR / "polymarket_chance.py"),
        "--slug",
        args.polymarket_slug or "",
        "--out-dir",
        str(polymarket_dir),
    ]
    cmd_binance = [
        str(COLLECTORS_DIR / "binance_ws.py"),
        "--symbol",
        args.binance_symbol,
        "--out-dir",
        str(binance_dir),
    ]

    if args.dry_run:
        print("[DRY]", " ".join([sys.executable] + cmd_chainlink))
        print("[DRY]", " ".join([sys.executable] + cmd_exchanges))
        print("[DRY]", " ".join([sys.executable] + cmd_mexc))
        print("[DRY]", " ".join([sys.executable] + cmd_coinbase))
        print("[DRY]", " ".join([sys.executable] + cmd_upbit))
        print("[DRY]", " ".join([sys.executable] + cmd_bitget))
        print("[DRY]", " ".join([sys.executable] + cmd_kucoin))
        if args.polymarket_slug:
            print("[DRY]", " ".join([sys.executable] + cmd_polymarket))
        print("[DRY]", " ".join([sys.executable] + cmd_binance))
        return

    procs = []
    procs.append(p(*cmd_chainlink, cwd=ROOT))
    procs.append(p(*cmd_exchanges, cwd=ROOT))
    procs.append(p(*cmd_mexc, cwd=ROOT))
    procs.append(p(*cmd_coinbase, cwd=ROOT))
    procs.append(p(*cmd_upbit, cwd=ROOT))
    procs.append(p(*cmd_bitget, cwd=ROOT))
    procs.append(p(*cmd_kucoin, cwd=ROOT))
    if args.polymarket_slug:
        procs.append(p(*cmd_polymarket, cwd=ROOT))
    procs.append(p(*cmd_binance, cwd=ROOT))

    print(f"Collectors running. session={session_id} (Ctrl+C to stop)")
    try:
        for pr in procs:
            pr.wait()
    except KeyboardInterrupt:
        for pr in procs:
            if pr.poll() is None:
                pr.terminate()


if __name__ == "__main__":
    main()
