from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass
class BookState:
    venue: Literal["binance", "coinbase"]
    symbol: str
    ts_exchange_ms: int | None
    ts_local_ms: int
    kind: Literal["L2", "L3"]
    best_bid: float
    best_ask: float
    bids: list[tuple[float, float]]
    asks: list[tuple[float, float]]
    l3_order_count: int | None = None

