"""Read-only Polymarket client: leaderboard, leader trades/positions (Data API v2) and market metadata (Gamma)."""

from __future__ import annotations

import json
import logging
import time
from collections import OrderedDict
from typing import Optional

from .http import HttpClient, HttpError
from .models import Leader, LeaderTrade, PMMarket, Signal, parse_ts, to_float

log = logging.getLogger("copybot.polymarket")

DATA_API = "https://data-api.polymarket.com/v2"
GAMMA_API = "https://gamma-api.polymarket.com"


class PolymarketClient:
    def __init__(self, http: Optional[HttpClient] = None, market_cache_size: int = 2000):
        # Data API allows ~200 req/10s on /activity; 0.1s spacing stays well under every limit.
        self.http = http or HttpClient(min_interval=0.1)
        self._markets: OrderedDict = OrderedDict()
        self._cache_size = market_cache_size

    # ------------------------------------------------------------------ leaderboard
    def leaderboard(self, time_period: str = "month", category: str = "overall", limit: int = 50,
                    sort_by: str = "PNL") -> list:
        data = self.http.request("GET", f"{DATA_API}/leaderboard", params={
            "time_period": time_period, "category": category, "sort_by": sort_by, "limit": min(limit, 1000),
        })
        rows = data.get("data", []) if isinstance(data, dict) else []
        return [
            Leader(
                wallet=str(r.get("user_id", "")).lower(),
                name=r.get("user_name") or "",
                rank=int(r.get("rank") or 0),
                pnl=to_float(r.get("pnl"), 0.0),
                volume=to_float(r.get("volume"), 0.0),
            )
            for r in rows if r.get("user_id")
        ]

    # ------------------------------------------------------------------ trades
    def trades_since(self, wallet: str, start_ts: int, max_pages: int = 5) -> list:
        """TRADE activity for one wallet with timestamp >= start_ts, oldest first."""
        params = {"user": wallet, "type": "TRADE", "start": max(int(start_ts), 1),
                  "sort_direction": "ASC", "limit": 500}
        out: list = []
        cursor = None
        for _ in range(max_pages):
            page_params = dict(params)
            if cursor:
                page_params["cursor"] = cursor
            data = self.http.request("GET", f"{DATA_API}/activity", params=page_params)
            for r in data.get("data", []):
                if r.get("type", "TRADE") != "TRADE":
                    continue
                out.append(LeaderTrade(
                    wallet=str(r.get("proxy_wallet") or wallet).lower(),
                    leader_name=r.get("name") or r.get("pseudonym") or "",
                    condition_id=r.get("condition_id", ""),
                    token_id=str(r.get("token_id", "")),
                    side=str(r.get("side", "")).upper(),
                    outcome=r.get("outcome") or "",
                    outcome_index=int(r.get("outcome_index") or 0),
                    price=to_float(r.get("price"), 0.0),
                    size=to_float(r.get("size"), 0.0),
                    usdc_size=to_float(r.get("usdc_size"), 0.0),
                    timestamp=int(r.get("timestamp") or 0),
                    title=r.get("title") or "",
                    slug=r.get("slug") or "",
                    event_slug=r.get("event_slug") or "",
                    tx_hash=r.get("transaction_hash") or "",
                ))
            cursor = (data.get("pagination") or {}).get("next_cursor")
            if not cursor:
                break
        return out

    def position_size(self, wallet: str, condition_id: str, outcome_index: int) -> float:
        """Leader's current share count in one outcome (0 if flat)."""
        data = self.http.request("GET", f"{DATA_API}/positions",
                                 params={"user": wallet, "condition": condition_id})
        for r in data.get("data", []):
            if int(r.get("outcome_index") or 0) == int(outcome_index):
                return to_float(r.get("current_size"), 0.0) or 0.0
        return 0.0

    # ------------------------------------------------------------------ market metadata
    def market(self, condition_id: str) -> Optional[PMMarket]:
        if condition_id in self._markets:
            cached, fetched = self._markets[condition_id]
            if time.time() - fetched < 600:
                self._markets.move_to_end(condition_id)
                return cached
        try:
            rows = self.http.request("GET", f"{GAMMA_API}/markets", params={"condition_ids": condition_id})
            if not rows:  # Gamma hides closed markets unless asked
                rows = self.http.request("GET", f"{GAMMA_API}/markets",
                                         params={"condition_ids": condition_id, "closed": "true"})
        except HttpError as exc:
            log.warning("gamma lookup failed for %s: %s", condition_id[:12], exc)
            return None
        market = _pm_market(rows[0]) if rows else None
        if market:
            self._markets[condition_id] = (market, time.time())
            while len(self._markets) > self._cache_size:
                self._markets.popitem(last=False)
        return market

    def market_by_slug(self, slug: str) -> Optional[PMMarket]:
        rows = self.http.request("GET", f"{GAMMA_API}/markets", params={"slug": slug})
        return _pm_market(rows[0]) if rows else None

    def event_markets(self, event_slug: str) -> list:
        rows = self.http.request("GET", f"{GAMMA_API}/events", params={"slug": event_slug})
        out = []
        for ev in rows or []:
            for m in ev.get("markets", []):
                m.setdefault("events", [{"title": ev.get("title"), "slug": ev.get("slug")}])
                out.append(_pm_market(m))
        return out


def _pm_market(m: dict) -> PMMarket:
    outcomes = m.get("outcomes") or []
    if isinstance(outcomes, str):
        try:
            outcomes = json.loads(outcomes)
        except ValueError:
            outcomes = []
    events = m.get("events") or [{}]
    return PMMarket(
        condition_id=m.get("conditionId", ""),
        question=m.get("question") or "",
        slug=m.get("slug") or "",
        outcomes=list(outcomes),
        end_date=parse_ts(m.get("endDate") or m.get("endDateIso")),
        event_title=events[0].get("title") or "",
        event_slug=events[0].get("slug") or "",
        group_item_title=m.get("groupItemTitle") or "",
        sports_market_type=m.get("sportsMarketType") or "",
        closed=bool(m.get("closed")),
        description=(m.get("description") or "")[:1500],
    )


def aggregate(trades: list) -> list:
    """Collapse fills of the same (wallet, token, side) into one signal with a VWAP price."""
    groups: dict = {}
    for t in trades:
        key = (t.wallet, t.token_id, t.side)
        g = groups.get(key)
        if g is None:
            groups[key] = Signal(
                wallet=t.wallet, leader_name=t.leader_name, condition_id=t.condition_id, token_id=t.token_id,
                side=t.side, outcome=t.outcome, outcome_index=t.outcome_index, price=t.price, size=t.size,
                usdc_size=t.usdc_size, first_ts=t.timestamp, last_ts=t.timestamp, title=t.title, slug=t.slug,
                event_slug=t.event_slug, trade_keys=[t.key],
            )
            continue
        g.size += t.size
        g.usdc_size += t.usdc_size
        g.first_ts = min(g.first_ts, t.timestamp)
        g.last_ts = max(g.last_ts, t.timestamp)
        g.trade_keys.append(t.key)
    for g in groups.values():
        if g.size > 0 and g.usdc_size > 0:
            g.price = round(g.usdc_size / g.size, 4)
    return list(groups.values())
