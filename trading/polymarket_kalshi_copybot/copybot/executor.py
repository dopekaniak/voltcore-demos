"""Order execution. Paper fills against the live Kalshi top of book; live sends IOC limit orders."""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from typing import Optional

from .http import HttpError
from .models import KalshiMarket, to_float
from .risk import kalshi_taker_fee

log = logging.getLogger("copybot.executor")


@dataclass
class Fill:
    status: str  # filled | partial | unfilled | duplicate | error
    count: float = 0.0
    avg_price: float = 0.0  # per contract, from the held outcome's perspective
    fee: float = 0.0  # total fee in dollars
    error: str = ""
    raw: dict = field(default_factory=dict)

    @property
    def filled(self) -> bool:
        return self.count > 0


class PaperExecutor:
    mode = "paper"

    def execute(self, *, action: str, ticker: str, side: str, contracts: float, limit_price: float,
                quote: KalshiMarket, client_order_id: str) -> Fill:
        if action == "buy":
            px, avail = quote.ask_for(side), quote.ask_size_for(side)
            crosses = px is not None and px <= limit_price + 1e-9
        else:
            px, avail = quote.bid_for(side), quote.bid_size_for(side)
            crosses = px is not None and px >= limit_price - 1e-9
        if not crosses or avail <= 0:
            return Fill("unfilled", raw={"px": px, "avail": avail})
        # Conservative: only the displayed top-of-book size fills; the rest is cancelled (IOC).
        qty = float(min(contracts, math.floor(avail)))
        if qty <= 0:
            return Fill("unfilled", raw={"px": px, "avail": avail})
        return Fill("filled" if qty >= contracts else "partial", qty, px, kalshi_taker_fee(qty, px),
                    raw={"px": px, "avail": avail, "simulated": True})


class LiveExecutor:
    mode = "live"

    def __init__(self, kalshi):
        self.kalshi = kalshi

    def execute(self, *, action: str, ticker: str, side: str, contracts: float, limit_price: float,
                quote: Optional[KalshiMarket], client_order_id: str) -> Fill:
        # V2 orders quote the YES book: buy YES / sell NO = bid, buy NO / sell YES = ask, price = YES-leg price.
        buying_yes = (action == "buy") == (side == "yes")
        book_side = "bid" if buying_yes else "ask"
        yes_price = limit_price if side == "yes" else round(1.0 - limit_price, 4)
        try:
            resp = self.kalshi.create_order(
                ticker=ticker, book_side=book_side, count=contracts, yes_price=yes_price,
                client_order_id=client_order_id, time_in_force="immediate_or_cancel",
                reduce_only=(action == "sell"),
            )
        except HttpError as exc:
            if exc.status == 409:
                return Fill("duplicate", error=str(exc), raw={"body": exc.body})
            return Fill("error", error=str(exc), raw={"body": exc.body})

        count = to_float(resp.get("fill_count"), 0.0) or 0.0
        if count <= 0:
            return Fill("unfilled", raw=resp)
        avg_yes = to_float(resp.get("average_fill_price"), yes_price)
        avg = avg_yes if side == "yes" else 1.0 - avg_yes
        # Sanity check the price convention against our own limit; flip if the venue reported the other leg.
        worse = (avg > limit_price + 0.005) if action == "buy" else (avg < limit_price - 0.005)
        if worse and side == "no":
            log.warning("fill price %s looks like NO-leg pricing; using it as-is", avg_yes)
            avg = avg_yes
        fee_raw = to_float(resp.get("average_fee_paid"), 0.0) or 0.0
        fee = fee_raw * count if fee_raw <= 0.05 else fee_raw  # per-contract average vs total
        status = "filled" if count >= contracts - 1e-9 else "partial"
        return Fill(status, count, round(avg, 4), round(fee, 4), raw=resp)
