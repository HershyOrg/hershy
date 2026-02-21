from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd


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
                    df = df.drop_duplicates(subset=["ts_ms"]).sort_values("ts_ms")
            except Exception:
                pass
        df.to_parquet(path, index=False, compression=self.compression)
        self._rows.clear()
