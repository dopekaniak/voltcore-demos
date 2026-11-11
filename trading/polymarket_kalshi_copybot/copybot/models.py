"""Plain data containers shared across the bot."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional


def parse_ts(value) -> Optional[datetime]:
    """Parse an ISO-8601 string (or 'YYYY-MM-DD') into an aware UTC datetime."""
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip().replace("Z", "+00:00")
    if " " in text and "T" not in text:
        text = text.replace(" ", "T", 1)
    if text.endswith("+00"):
        text += ":00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def to_float(value, default: Optional[float] = None) -> Optional[float]:
    if value is None or value == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


# --------------------------------------------------------------------------- Polymarket


@dataclass
class Leader:
    wallet: str
    name: str
    rank: int
    pnl: float
    volume: float


@dataclass
class LeaderTrade:
    """One raw TRADE row from Polymarket /v2/activity."""

    wallet: str
    leader_name: str
    condition_id: str
    token_id: str
    side: str  # BUY | SELL
    outcome: str
    outcome_index: int
    price: float
    size: float  # shares
    usdc_size: float
    timestamp: int
    title: str
    slug: str
    event_slug: str
    tx_hash: str

    @property
    def key(self) -> str:
        return f"{self.tx_hash}:{self.token_id}:{self.side}:{self.size}:{self.price}"


@dataclass
class Signal:
    """Leader trades aggregated per (wallet, token, side) within one poll."""

    wallet: str
    leader_name: str
    condition_id: str
    token_id: str
    side: str
    outcome: str
    outcome_index: int
    price: float  # volume-weighted average fill price
    size: float
    usdc_size: float
    first_ts: int
    last_ts: int
    title: str
    slug: str
    event_slug: str
    trade_keys: list = field(default_factory=list)


@dataclass
class PMMarket:
    condition_id: str
    question: str
    slug: str
    outcomes: list
    end_date: Optional[datetime]
    event_title: str = ""
    event_slug: str = ""
    group_item_title: str = ""
    sports_market_type: str = ""
    closed: bool = False
    description: str = ""


# --------------------------------------------------------------------------- Kalshi


@dataclass(slots=True)
class KalshiMarket:
    ticker: str
    event_ticker: str
    series_ticker: str
    event_title: str
    title: str
    yes_sub_title: str
    status: str
    close_time: Optional[datetime]
    expected_expiration_time: Optional[datetime]
    yes_bid: Optional[float] = None
    yes_ask: Optional[float] = None
    yes_bid_size: float = 0.0
    yes_ask_size: float = 0.0
    result: str = ""
    category: str = ""
    rules_primary: str = ""

    # Outcome-perspective quotes. Buying NO at p is the same as selling YES at 1 - p.
    def ask_for(self, side: str) -> Optional[float]:
        if side == "yes":
            return self.yes_ask
        return None if self.yes_bid is None else round(1.0 - self.yes_bid, 4)

    def bid_for(self, side: str) -> Optional[float]:
        if side == "yes":
            return self.yes_bid
        return None if self.yes_ask is None else round(1.0 - self.yes_ask, 4)

    def ask_size_for(self, side: str) -> float:
        return self.yes_ask_size if side == "yes" else self.yes_bid_size

    def bid_size_for(self, side: str) -> float:
        return self.yes_bid_size if side == "yes" else self.yes_ask_size

    @classmethod
    def from_api(cls, m: dict, event: Optional[dict] = None, keep_rules: bool = False) -> "KalshiMarket":
        event = event or {}
        yes_bid = to_float(m.get("yes_bid_dollars"))
        yes_ask = to_float(m.get("yes_ask_dollars"))
        # A zero bid / one-dollar ask means there is no resting order on that side.
        if yes_bid is not None and yes_bid <= 0:
            yes_bid = None
        if yes_ask is not None and yes_ask >= 1:
            yes_ask = None
        return cls(
            ticker=m.get("ticker", ""),
            event_ticker=m.get("event_ticker", "") or event.get("event_ticker", ""),
            series_ticker=event.get("series_ticker", "") or m.get("series_ticker", ""),
            event_title=event.get("title", "") or "",
            title=m.get("title", "") or "",
            yes_sub_title=m.get("yes_sub_title", "") or "",
            status=m.get("status", "") or "",
            close_time=parse_ts(m.get("close_time")),
            expected_expiration_time=parse_ts(m.get("expected_expiration_time")),
            yes_bid=yes_bid,
            yes_ask=yes_ask,
            yes_bid_size=to_float(m.get("yes_bid_size_fp"), 0.0) or 0.0,
            yes_ask_size=to_float(m.get("yes_ask_size_fp"), 0.0) or 0.0,
            result=(m.get("result") or "").lower(),
            category=event.get("category", "") or "",
            rules_primary=(m.get("rules_primary") or "") if keep_rules else "",
        )


# --------------------------------------------------------------------------- matching


@dataclass
class Candidate:
    ticker: str
    side: str
    score: float
    label: str
    passed_gates: bool
    gate_reason: str = ""
    near_date: bool = False  # failed only the date window, and only by a little


@dataclass
class MatchResult:
    status: str  # auto | review | needs_llm | none
    kalshi_ticker: Optional[str] = None
    kalshi_side: Optional[str] = None
    score: float = 0.0
    reason: str = ""
    candidates: list = field(default_factory=list)
