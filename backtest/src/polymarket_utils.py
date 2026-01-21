from dataclasses import dataclass
import datetime as dt
import json
import re
from typing import List, Optional, Tuple
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

GAMMA_MARKETS_BY_SLUG = "https://gamma-api.polymarket.com/markets?slug="
GAMMA_UA = "Mozilla/5.0 (compatible; CodexBot/1.0)"
ET_TZ = ZoneInfo("America/New_York")
MONTH_NAMES = [
    "",
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
]
SLUG_TIME_RE = re.compile(
    r"^(?P<prefix>.+)-"
    r"(?P<month>january|february|march|april|may|june|july|august|september|october|november|december)-"
    r"(?P<day>\d{1,2})-"
    r"(?P<hour>\d{1,2})(?P<ampm>am|pm)-et$"
)


@dataclass
class MarketTokens:
    yes_token_id: str
    no_token_id: str
    outcomes: List[str]
    clob_token_ids: List[str]
    market_id: str
    slug: str
    enable_orderbook: Optional[bool]
    closed: Optional[bool]
    active: Optional[bool]
    start_date: Optional[str]
    end_date: Optional[str]


def normalize_slug(value: str) -> str:
    marker = "polymarket.com/event/"
    if marker in value:
        return value.split(marker, 1)[1].strip("/")
    return value


def fetch_market_by_slug(slug: str) -> dict:
    slug = normalize_slug(slug)
    url = GAMMA_MARKETS_BY_SLUG + urllib.parse.quote(slug)
    req = urllib.request.Request(url, headers={"User-Agent": GAMMA_UA})
    with urllib.request.urlopen(req) as resp:
        data = json.load(resp)

    if isinstance(data, dict):
        markets = data.get("markets", [])
    else:
        markets = data

    if not markets:
        raise ValueError(f"No market found for slug: {slug}")
    return markets[0]


def infer_slug_prefix(slug: str) -> Optional[str]:
    match = SLUG_TIME_RE.match(slug)
    if not match:
        return None
    return match.group("prefix")


def build_slug(prefix: str, when_et: dt.datetime) -> str:
    month = MONTH_NAMES[when_et.month]
    day = when_et.day
    hour24 = when_et.hour
    hour12 = hour24 % 12
    if hour12 == 0:
        hour12 = 12
    ampm = "am" if hour24 < 12 else "pm"
    return f"{prefix}-{month}-{day}-{hour12}{ampm}-et"


def _parse_iso_dt(value: Optional[str]) -> Optional[dt.datetime]:
    if not value:
        return None
    try:
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        return dt.datetime.fromisoformat(value)
    except ValueError:
        return None


def _is_open_market(market: dict, now_utc: dt.datetime) -> bool:
    closed = market.get("closed")
    if closed is True:
        return False
    start_dt = _parse_iso_dt(market.get("startDate"))
    if start_dt and now_utc < start_dt:
        return False
    end_dt = _parse_iso_dt(market.get("endDate"))
    if end_dt and end_dt < now_utc:
        return False
    return True


def find_active_market_by_time(
    prefix: str,
    now_et: Optional[dt.datetime] = None,
    search_hours: int = 6,
    step_hours: int = 1,
) -> Tuple[dict, str]:
    if now_et is None:
        now_et = dt.datetime.now(tz=ET_TZ)
    base = now_et.replace(minute=0, second=0, microsecond=0)
    now_utc = now_et.astimezone(dt.timezone.utc)

    offsets = [0]
    for h in range(1, search_hours + 1, step_hours):
        offsets.append(h)
        offsets.append(-h)

    fallback = None
    for offset in offsets:
        candidate = base + dt.timedelta(hours=offset)
        slug = build_slug(prefix, candidate)
        try:
            market = fetch_market_by_slug(slug)
        except Exception:
            continue
        if market.get("enableOrderBook") is False:
            fallback = fallback or (market, slug)
            continue
        if _is_open_market(market, now_utc):
            return market, slug
        fallback = fallback or (market, slug)

    if fallback:
        return fallback
    raise ValueError(f"No market found for prefix: {prefix}")


def resolve_yes_no_tokens(market: dict, slug: str) -> MarketTokens:
    outcomes = [_coerce_outcome(o) for o in _normalize_list_field(market.get("outcomes"))]
    token_ids = extract_clob_token_ids(market)
    if not outcomes or not token_ids:
        raise ValueError("Missing outcomes or clobTokenIds in market response.")

    yes_like = {"yes", "true", "up"}
    no_like = {"no", "false", "down"}

    mapped = {}
    for outcome, token_id in zip(outcomes, token_ids):
        norm = outcome.strip().lower()
        if norm in yes_like:
            mapped["yes"] = token_id
        elif norm in no_like:
            mapped["no"] = token_id

    if "yes" not in mapped or "no" not in mapped:
        if len(token_ids) == 2:
            mapped.setdefault("yes", token_ids[0])
            mapped.setdefault("no", token_ids[1])
        else:
            raise ValueError(
                "Could not map outcomes to yes/no. Provide explicit token IDs."
            )

    return MarketTokens(
        yes_token_id=mapped["yes"],
        no_token_id=mapped["no"],
        outcomes=outcomes,
        clob_token_ids=token_ids,
        market_id=str(market.get("id", "")),
        slug=str(market.get("slug", slug)),
        enable_orderbook=market.get("enableOrderBook"),
        closed=market.get("closed"),
        active=market.get("active"),
        start_date=market.get("startDate"),
        end_date=market.get("endDate"),
    )


def extract_clob_token_ids(market: dict) -> List[str]:
    token_ids = _normalize_list_field(market.get("clobTokenIds"))
    return [str(t) for t in token_ids if t]


def _coerce_outcome(value) -> str:
    if isinstance(value, dict):
        for key in ("title", "name", "label", "outcome"):
            if key in value:
                return str(value[key])
    return str(value)


def _normalize_list_field(value) -> List:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, list):
            return parsed
        if "," in text:
            return [chunk.strip() for chunk in text.split(",") if chunk.strip()]
        return [text]
    return [value]
