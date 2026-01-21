import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import List, Optional, Tuple

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from polymarket_utils import (
    extract_clob_token_ids,
    fetch_market_by_slug,
    find_active_market_by_time,
    infer_slug_prefix,
    normalize_slug,
)

try:
    from py_clob_client.client import ClobClient
    from py_clob_client.clob_types import BookParams
except ImportError as exc:
    raise RuntimeError(
        "py-clob-client is required. Install with: pip install py-clob-client"
    ) from exc

CLOB_HOST = "https://clob.polymarket.com"


def _safe_slug(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "_", value).strip("_")


def _resolve_token_ids(args: argparse.Namespace) -> Tuple[List[str], str]:
    if args.token_id:
        token_ids = args.token_id
        slug = normalize_slug(args.slug) if args.slug else "tokens"
        return token_ids, slug

    auto_slug = _resolve_auto_slug(args)
    if auto_slug:
        prefix = args.slug_prefix or infer_slug_prefix(normalize_slug(args.slug or ""))
        if not prefix:
            raise RuntimeError("Provide --slug-prefix or a slug with time suffix.")
        market, slug = find_active_market_by_time(
            prefix,
            search_hours=args.search_hours,
            step_hours=args.search_step_hours,
        )
    else:
        if not args.slug:
            raise RuntimeError("Provide --slug or at least one --token-id.")
        market = fetch_market_by_slug(args.slug)
        slug = market.get("slug", normalize_slug(args.slug))

    try:
    token_ids = extract_clob_token_ids(market)
    if not token_ids:
        raise RuntimeError("No clobTokenIds found for market.")
    if market.get("enableOrderBook") is False:
        print("[WARN] enableOrderBook=false; orderbook updates may be unavailable.")
    return token_ids, slug
    except ValueError as exc:
        token_ids = extract_clob_token_ids(market)
        if not token_ids:
            raise
        print(f"[WARN] {exc} Using all clobTokenIds ({len(token_ids)}).")
        return token_ids, slug


def _resolve_auto_slug(args: argparse.Namespace) -> bool:
    if args.auto_slug is not None:
        return args.auto_slug
    if args.slug_prefix:
        return True
    if args.slug and infer_slug_prefix(normalize_slug(args.slug)):
        return True
    return False


def _book_to_dict(book) -> dict:
    bids = []
    asks = []
    for bid in book.bids or []:
        bids.append({"price": bid.price, "size": bid.size})
    for ask in book.asks or []:
        asks.append({"price": ask.price, "size": ask.size})

    return {
        "market": book.market,
        "asset_id": book.asset_id,
        "timestamp": book.timestamp,
        "last_trade_price": book.last_trade_price,
        "min_order_size": book.min_order_size,
        "neg_risk": book.neg_risk,
        "tick_size": book.tick_size,
        "hash": book.hash,
        "bids": bids,
        "asks": asks,
    }


def record_orderbook(
    token_ids: List[str],
    out_path: Path,
    poll_sec: float,
    max_polls: Optional[int],
    flush_every: int,
) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    client = ClobClient(CLOB_HOST)
    polls = 0

    params = [BookParams(token_id=t) for t in token_ids]
    with out_path.open("a", encoding="utf-8") as f:
        while True:
            ts = time.time()
            try:
                if len(params) == 1:
                    books = [client.get_order_book(params[0].token_id)]
                else:
                    books = client.get_order_books(params)
            except Exception as exc:
                print(f"[WARN] fetch failed: {exc}")
                time.sleep(poll_sec)
                continue

            for book in books:
                payload = {
                    "_ts": ts,
                    "token_id": book.asset_id,
                    "book": _book_to_dict(book),
                }
                f.write(json.dumps(payload, separators=(",", ":")) + "\n")

            polls += 1
            if flush_every and (polls % flush_every) == 0:
                f.flush()

            if max_polls is not None and polls >= max_polls:
                print(f"[DONE] max_polls={max_polls} reached")
                return

            time.sleep(poll_sec)


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", default=None, help="Polymarket slug")
    ap.add_argument("--slug-prefix", default=None)
    ap.add_argument("--auto-slug", dest="auto_slug", action="store_true")
    ap.add_argument("--no-auto-slug", dest="auto_slug", action="store_false")
    ap.set_defaults(auto_slug=None)
    ap.add_argument("--search-hours", type=int, default=12)
    ap.add_argument("--search-step-hours", type=int, default=1)
    ap.add_argument("--token-id", action="append", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--poll-sec", type=float, default=1.0)
    ap.add_argument("--flush-every", type=int, default=10)
    ap.add_argument("--max-polls", type=int, default=None)
    return ap.parse_args()


def main() -> None:
    args = parse_args()
    token_ids, slug = _resolve_token_ids(args)

    if args.out:
        out_path = Path(args.out)
    else:
        ts = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        safe_slug = _safe_slug(slug)
        out_path = SCRIPT_DIR / "out" / f"polymarket_orderbook_{safe_slug}_{ts}.jsonl"

    print(f"[BOOT] out={out_path}")
    record_orderbook(
        token_ids=token_ids,
        out_path=out_path,
        poll_sec=args.poll_sec,
        max_polls=args.max_polls,
        flush_every=args.flush_every,
    )


if __name__ == "__main__":
    main()
