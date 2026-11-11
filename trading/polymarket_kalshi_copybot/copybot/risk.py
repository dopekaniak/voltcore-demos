"""Deterministic sizing and risk checks. Pure functions, so they are easy to test."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

TICK = 0.01


def floor_tick(price: float) -> float:
    return math.floor(round(price / TICK, 6)) * TICK


def ceil_tick(price: float) -> float:
    return math.ceil(round(price / TICK, 6)) * TICK


def kalshi_taker_fee(contracts: float, price: float, rate: float = 0.07, multiplier: float = 1.0) -> float:
    """Total taker fee for a fill: rate * multiplier * C * P * (1 - P), rounded up to $0.000001.

    The round-up to $0.000001 is from Kalshi's fee-rounding docs (docs.kalshi.com/getting_started/fee_rounding).
    The 0.07 rate and the per-series multiplier (series.fee_type 'quadratic', fee_multiplier 1 for every series
    checked) come from secondary sources, not Kalshi's docs. Confirm them against the first real fill.
    """
    raw = rate * multiplier * contracts * price * (1 - price)
    return math.ceil(round(raw * 1_000_000, 6)) / 1_000_000


@dataclass
class EntryPlan:
    ok: bool
    reason: str
    contracts: int = 0
    limit_price: float = 0.0
    budget_usd: float = 0.0


@dataclass
class RiskState:
    cash: float
    equity: float
    market_exposure: float
    total_exposure: float
    spend_today: float
    open_positions: int
    holds_this_market: bool


def plan_entry(settings, *, leader_usd: float, leader_price: float, kalshi_ask: Optional[float],
               state: RiskState) -> EntryPlan:
    """Size a copy entry and pick an IOC limit price, or explain why not to trade."""
    limit = min(0.99, floor_tick(leader_price + settings.max_price_gap))
    if kalshi_ask is None:
        return EntryPlan(False, "no Kalshi offer on that side")
    if kalshi_ask > limit + 1e-9:
        return EntryPlan(False, f"Kalshi ask {kalshi_ask:.2f} > limit {limit:.2f} (leader paid {leader_price:.3f})")
    if not state.holds_this_market and state.open_positions >= settings.max_open_positions:
        return EntryPlan(False, f"max open positions ({settings.max_open_positions}) reached")

    if settings.copy_sizing == "proportional":
        target = leader_usd * settings.copy_ratio
    else:
        target = settings.copy_usd_per_trade
    caps = {
        "max_order_usd": settings.max_order_usd,
        "risk_pct_of_equity": state.equity * settings.max_risk_pct_per_trade / 100,
        "market_cap_left": settings.max_position_usd_per_market - state.market_exposure,
        "total_exposure_left": settings.max_total_exposure_usd - state.total_exposure,
        "daily_spend_left": settings.max_daily_spend_usd - state.spend_today,
        "cash": state.cash,
    }
    budget = min(target, *caps.values())
    binding = min(caps, key=caps.get) if budget < target else "target"
    if budget < settings.min_order_usd:
        return EntryPlan(False, f"budget ${budget:.2f} < min order (bound by {binding})")

    # Size against the worst price we accept, plus the taker fee, so a fill can never exceed the budget.
    per_contract = limit + kalshi_taker_fee(1, limit)
    contracts = int(budget // per_contract)
    if contracts < 1:
        return EntryPlan(False, f"budget ${budget:.2f} buys < 1 contract at {limit:.2f}")
    return EntryPlan(True, f"sized by {binding}", contracts, round(limit, 2), round(budget, 2))


def exit_limit(bid: Optional[float], slippage: float) -> Optional[float]:
    if bid is None:
        return None
    return max(0.01, floor_tick(bid - slippage))


def sell_fraction(leader_sold: float, leader_remaining: float) -> float:
    total = leader_sold + max(leader_remaining, 0.0)
    if total <= 0:
        return 1.0
    return min(1.0, max(0.0, leader_sold / total))
