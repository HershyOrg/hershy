#!/usr/bin/env python3
import argparse
import asyncio
import datetime as dt
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
LIBS_DIR = REPO_ROOT / "libs"
if str(LIBS_DIR) not in sys.path:
    sys.path.insert(0, str(LIBS_DIR))

from polymarket_utils import ET_TZ, SLUG_TIME_RE, find_active_market_by_time, normalize_slug


def _parse_iso_dt(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    try:
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        parsed = dt.datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=dt.timezone.utc)
    return parsed


def _parse_slug_start(slug: str) -> dt.datetime | None:
    slug = normalize_slug(slug)
    match = SLUG_TIME_RE.match(slug)
    if not match:
        return None
    month_name = match.group("month")
    day = int(match.group("day"))
    hour = int(match.group("hour"))
    ampm = match.group("ampm")

    month_map = {
        "january": 1,
        "february": 2,
        "march": 3,
        "april": 4,
        "may": 5,
        "june": 6,
        "july": 7,
        "august": 8,
        "september": 9,
        "october": 10,
        "november": 11,
        "december": 12,
    }
    month = month_map.get(month_name)
    if month is None:
        return None

    hour24 = hour % 12
    if ampm == "pm":
        hour24 += 12

    now_et = dt.datetime.now(tz=ET_TZ)
    year = now_et.year
    candidate = dt.datetime(year, month, day, hour24, tzinfo=ET_TZ)
    if candidate - now_et > dt.timedelta(days=180):
        candidate = candidate.replace(year=year - 1)
    elif now_et - candidate > dt.timedelta(days=180):
        candidate = candidate.replace(year=year + 1)
    return candidate


def _window_from_market(market: dict, slug: str) -> tuple[int, int, dt.datetime]:
    start_dt = _parse_iso_dt(market.get("startDate"))
    end_dt = _parse_iso_dt(market.get("endDate"))

    if start_dt and end_dt:
        pass
    elif start_dt and not end_dt:
        end_dt = start_dt + dt.timedelta(hours=1)
    elif end_dt and not start_dt:
        start_dt = end_dt - dt.timedelta(hours=1)
    else:
        start_et = _parse_slug_start(slug)
        if start_et is None:
            raise ValueError("Unable to infer window from slug; missing start/end date.")
        start_dt = start_et.astimezone(dt.timezone.utc)
        end_dt = start_dt + dt.timedelta(hours=1)

    start_ms = int(start_dt.timestamp() * 1000)
    end_ms = int(end_dt.timestamp() * 1000)
    start_et = start_dt.astimezone(ET_TZ)
    return start_ms, end_ms, start_et


def _build_out_dir(out_base: Path, start_et: dt.datetime) -> Path:
    folder = start_et.strftime("%Y%m%dT%H00ET")
    return out_base / folder


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--auto-1h-prefix", required=True)
    ap.add_argument("--auto-15m-prefix", required=True)
    ap.add_argument("--binance-symbol", default="btcusdc")
    ap.add_argument("--out-base", default="src/out/market_hourly")
    ap.add_argument("--search-hours", type=int, default=6)
    ap.add_argument("--search-step-hours", type=int, default=1)
    ap.add_argument("--dry-run", action="store_true")
    return ap.parse_args()


async def _run_commands(cmds: list[list[str]]) -> None:
    procs = []
    try:
        for cmd in cmds:
            procs.append(await asyncio.create_subprocess_exec(*cmd))
        for proc in procs:
            rc = await proc.wait()
            if rc != 0:
                raise RuntimeError(f"Command failed with exit code {rc}")
    except KeyboardInterrupt:
        for proc in procs:
            if proc.returncode is None:
                proc.terminate()
        raise


async def main_async() -> None:
    args = parse_args()

    market, slug = find_active_market_by_time(
        args.auto_1h_prefix,
        search_hours=args.search_hours,
        step_hours=args.search_step_hours,
    )
    start_ms, end_ms, start_et = _window_from_market(market, slug)
    out_dir = _build_out_dir(Path(args.out_base), start_et)
    out_dir.mkdir(parents=True, exist_ok=True)

    start_epoch = start_ms // 1000
    start_label = start_et.strftime("%Y-%m-%d %H:%M:%S ET")
    print(f"[BUNDLE] slug_1h={slug} start={start_label} out_dir={out_dir}")

    capture_1h = [
        sys.executable,
        str(SCRIPT_DIR / "capture_1h_market.py"),
        "--slug",
        slug,
        "--binance-symbol",
        args.binance_symbol,
        "--out-dir",
        str(out_dir),
    ]

    capture_15m = [
        sys.executable,
        str(SCRIPT_DIR / "capture_15m_market.py"),
        "--auto-15m-prefix",
        args.auto_15m_prefix,
        "--start-epoch",
        str(start_epoch),
        "--follow",
        "--max-windows",
        "4",
        "--skip-ended",
        "--binance-symbol",
        args.binance_symbol,
        "--out-dir",
        str(out_dir),
    ]

    if args.dry_run:
        print("[DRY]", " ".join(capture_1h))
        print("[DRY]", " ".join(capture_15m))
        return

    await _run_commands([capture_1h, capture_15m])


def main() -> None:
    asyncio.run(main_async())


if __name__ == "__main__":
    main()
