import argparse
import datetime as dt
import json
from pathlib import Path
from typing import Optional

try:
    import matplotlib.pyplot as plt
except ImportError as exc:
    raise RuntimeError("matplotlib is required. Install with: pip install matplotlib") from exc


def _floor_to_hour_ms(ts_ms: int) -> int:
    return (ts_ms // 3_600_000) * 3_600_000


def _load_rows(path: Path) -> list[dict]:
    rows = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            if "orderbook" not in payload:
                continue
            t_ms = payload.get("t_ms")
            if t_ms is None:
                continue
            hour_open_ms = payload.get("hour_open_ms")
            if hour_open_ms is None:
                hour_open_ms = _floor_to_hour_ms(int(t_ms))
            payload["hour_open_ms"] = hour_open_ms
            rows.append(payload)
    return rows


def _select_hour(rows: list[dict], hour_open_ms: Optional[int]) -> tuple[int, list[dict]]:
    if not rows:
        raise RuntimeError("no rows with orderbook data found")
    if hour_open_ms is None:
        hour_open_ms = max(r["hour_open_ms"] for r in rows)
    filtered = [r for r in rows if r["hour_open_ms"] == hour_open_ms]
    if not filtered:
        raise RuntimeError(f"no rows for hour_open_ms={hour_open_ms}")
    filtered.sort(key=lambda r: r.get("t_ms", 0))
    return hour_open_ms, filtered


def _plot(rows: list[dict], hour_open_ms: int, out_path: Path) -> None:
    xs = []
    p_ups = []
    yes_mids = []
    no_mids = []
    gap_yes = []

    for r in rows:
        tau = r.get("tau_sec")
        if tau is not None:
            x = 240 - float(tau)
        else:
            x = (r["t_ms"] - hour_open_ms) / 1000.0
        xs.append(x)
        p_up = float(r.get("p_up", 0.0))
        p_ups.append(p_up)
        ob = r.get("orderbook") or {}
        yes_mid = None
        no_mid = None
        if isinstance(ob, dict):
            yes = ob.get("yes") or {}
            no = ob.get("no") or {}
            yes_mid = yes.get("mid")
            no_mid = no.get("mid")
        yes_mids.append(yes_mid)
        no_mids.append(no_mid)
        gap_yes.append(ob.get("gap_yes") if isinstance(ob, dict) else None)

    xs_series = xs
    yes_series = [v if v is not None else float("nan") for v in yes_mids]
    no_series = [v if v is not None else float("nan") for v in no_mids]
    gap_series = [v if v is not None else float("nan") for v in gap_yes]

    hour_label = dt.datetime.utcfromtimestamp(hour_open_ms / 1000).strftime(
        "%Y-%m-%d %H:%M UTC"
    )

    fig, axes = plt.subplots(2, 1, figsize=(10, 8), sharex=True)
    ax1, ax2 = axes

    ax1.plot(xs_series, p_ups, label="p_up", linewidth=1.5)
    ax1.plot(xs_series, yes_series, label="yes_mid", linewidth=1.0)
    ax1.plot(xs_series, [1.0 - v for v in no_series], label="1-no_mid", linewidth=1.0)
    ax1.set_ylabel("Price / Probability")
    ax1.set_title(f"p_up vs Orderbook Mid ({hour_label})")
    ax1.legend(loc="best")

    ax2.plot(xs_series, gap_series, label="gap_yes", linewidth=1.0)
    ax2.axhline(0.0, color="gray", linestyle="--", linewidth=0.8)
    ax2.set_xlabel("Seconds into last 4-min window")
    ax2.set_ylabel("p_up - yes_mid")
    ax2.set_title("Gap (YES)")

    fig.tight_layout()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=150)


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--log", required=True, help="signal log jsonl from polymarket_trader")
    ap.add_argument("--hour-open-ms", type=int, default=None)
    ap.add_argument("--out", default=None)
    return ap.parse_args()


def main() -> None:
    args = parse_args()
    log_path = Path(args.log)
    rows = _load_rows(log_path)
    hour_open_ms, filtered = _select_hour(rows, args.hour_open_ms)

    if args.out:
        out_path = Path(args.out)
    else:
        ts = dt.datetime.utcfromtimestamp(hour_open_ms / 1000).strftime("%Y%m%dT%H00Z")
        out_path = log_path.with_suffix("").with_name(f"{log_path.stem}_{ts}.png")

    _plot(filtered, hour_open_ms, out_path)
    print(f"[OK] saved {out_path}")


if __name__ == "__main__":
    main()
