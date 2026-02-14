from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import time

from .bus import Event
from .models import BookState


def _bucket_start_ms(ts_ms: int, window_sec: int) -> int:
    step = window_sec * 1000
    return (int(ts_ms) // step) * step


@dataclass
class RollingParquetWriter:
    out_dir: Path
    prefix: str
    window_sec: int = 300
    compression: str = "snappy"
    _bucket_ms: int | None = None
    _rows: list[dict[str, Any]] = field(default_factory=list)

    def write(self, row: dict[str, Any]) -> None:
        ts_ms = int(row["ts_ms"])
        bucket_ms = _bucket_start_ms(ts_ms, self.window_sec)
        if self._bucket_ms is None:
            self._bucket_ms = bucket_ms
        if bucket_ms != self._bucket_ms:
            self.flush()
            self._bucket_ms = bucket_ms
        self._rows.append(row)

    def _path_for_bucket(self, bucket_ms: int) -> Path:
        ts = datetime.fromtimestamp(bucket_ms / 1000, tz=timezone.utc)
        name = f"{self.prefix}_{ts.strftime('%Y%m%dT%H%M%SZ')}.parquet"
        return self.out_dir / name

    def flush(self) -> None:
        if not self._rows:
            return
        self.out_dir.mkdir(parents=True, exist_ok=True)
        path = self._path_for_bucket(self._bucket_ms or 0)
        df = pd.DataFrame(self._rows)
        if path.exists():
            try:
                existing = pd.read_parquet(path)
                df = pd.concat([existing, df], ignore_index=True)
                if "ts_ms" in df.columns:
                    df = df.drop_duplicates(subset=["ts_ms", "venue"]).sort_values("ts_ms")
            except Exception:
                pass
        df.to_parquet(path, index=False, compression=self.compression)
        self._rows.clear()


class StorageSink:
    def __init__(self, out_dir: Path, window_sec: int = 300, flush_sec: float = 5.0) -> None:
        self._writer = RollingParquetWriter(out_dir, "book_states", window_sec=window_sec)
        self._flush_sec = flush_sec
        self._last_flush = 0.0

    def handle_book(self, book: BookState) -> None:
        self._writer.write(
            {
                "ts_ms": book.ts_local_ms,
                "ts_exchange_ms": book.ts_exchange_ms,
                "venue": book.venue,
                "symbol": book.symbol,
                "kind": book.kind,
                "best_bid": book.best_bid,
                "best_ask": book.best_ask,
                "bids": json.dumps(book.bids),
                "asks": json.dumps(book.asks),
                "l3_order_count": book.l3_order_count,
            }
        )

    async def run(self, bus, stop_evt, counts: dict[str, int] | None = None) -> None:
        while not stop_evt.is_set():
            event: Event = await bus.next()
            if event.type == "book_state":
                self.handle_book(event.payload)
                if counts is not None:
                    counts["book"] = counts.get("book", 0) + 1
                now = time.time()
                if now - self._last_flush >= self._flush_sec:
                    self._writer.flush()
                    self._last_flush = now
