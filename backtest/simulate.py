"""Week-by-week Monte Carlo of each business over 12 months.

Each run draws one "version of the world" from the ranges in assumptions.py
(e.g. this run's connect rate is 8%), then plays 52 weeks with random outcomes
(binomial dials -> conversations -> meetings -> closes). Thousands of runs give a
distribution: how likely each model is to hit $5k/$10k/$25k a month, and when.

Policies shared by all three, so the comparison is fair:
  - same founder hours, same ramp-up penalty in the first weeks;
  - "scale" mode lets ideas 1 and 2 hire a $7/hr offshore caller once the business
    nets $2-3k/month; idea 3 is a commission job and can't hire.
"""

from __future__ import annotations

import copy
import random
import statistics
from dataclasses import dataclass, field

from backtest import assumptions as A

WEEKS = 52
WEEKS_PER_MONTH = 52 / 12


def draw(rng: random.Random, spec):
    value = spec[0]
    if isinstance(value, tuple):
        low, mode, high = value
        return rng.triangular(low, high, mode)
    return value


def binom(rng: random.Random, n: float, p: float) -> int:
    n = int(n)
    if n <= 0 or p <= 0:
        return 0
    return rng.binomialvariate(n, min(p, 1.0))


def month_of(week: int) -> int:
    return min(int(week / WEEKS_PER_MONTH), 11)


@dataclass
class RunResult:
    monthly_net: list[float]
    monthly_hours: list[float]
    first_cash_week: int | None
    extra: dict = field(default_factory=dict)


def _finish(weekly_net: list[float], weekly_hours: list[float], extra=None) -> RunResult:
    net, hours = [0.0] * 12, [0.0] * 12
    for w in range(WEEKS):
        net[month_of(w)] += weekly_net[w]
        hours[month_of(w)] += weekly_hours[w]
    first = next((w for w, v in enumerate(weekly_net) if v > 0), None)
    return RunResult(net, hours, first, extra or {})


def _founder(rng):
    return draw(rng, A.FOUNDER["hours_per_week"]), A.FOUNDER["ramp_weeks"][0], draw(rng, A.FOUNDER["ramp_penalty"])


class Prospector:
    """Cold-calls contractors. Dialing is capped per week, and last week's sales
    meetings eat into this week's free hours."""

    def __init__(self, rng, s: dict, c2m: float, m2c: float):
        self.rng = rng
        self.dph, self.connect, self.show = (draw(rng, s[k]) for k in ("dials_per_hour", "connect_rate", "show_rate"))
        self.c2m, self.m2c = c2m, m2c
        self.max_dial = draw(rng, A.FOUNDER["max_dial_hours"])
        self.meeting_hours = A.FOUNDER["meeting_hours"][0]
        self.pending_meetings = 0

    def week(self, free_hours: float, pen: float = 1.0) -> int:
        free_hours -= self.pending_meetings * self.meeting_hours
        dial_hours = max(min(free_hours, self.max_dial), 0)
        rng = self.rng
        meetings = binom(rng, binom(rng, dial_hours * self.dph, self.connect), self.c2m * pen)
        shows = binom(rng, meetings, self.show)
        self.pending_meetings = meetings
        return binom(rng, shows, self.m2c * pen)


def simulate_revival(rng: random.Random, p: dict, scale: bool, upsell: bool = False) -> RunResult:
    H, ramp_weeks, ramp_pen = _founder(rng)
    s, f = p["SALES_FUNNEL"], p["REVIVAL"]
    c2m, m2c, has_list = (draw(rng, f[k]) for k in ("conv_to_meeting", "meeting_to_close", "has_usable_list"))
    sales = Prospector(rng, s, c2m, m2c)
    onboarding = 0
    reach, book, visit_close = (draw(rng, f[k]) for k in ("reach_rate", "book_per_reached", "visit_to_close"))
    hdph, non_pay, retention = (draw(rng, f[k]) for k in ("homeowner_dials_per_hour", "non_payment", "monthly_retention"))
    leads_per_hour = hdph / f["attempts_per_lead"][0]
    weekly_keep = retention ** (1 / WEEKS_PER_MONTH)
    wage = A.FOUNDER["caller_wage"][0]

    # Upsell: revival clients who also buy Missed-Call Rescue (already trust you, no cold call needed).
    m = p["MISSED_CALL"]
    upsell_rate = draw(rng, p["COMBO"]["upsell_rate"]) if upsell else 0.0
    price, mc_cost, mc_support = m["price"][0], draw(rng, m["cost_per_client"]), draw(rng, m["support_hours_per_month"])
    mc_churn = 1 - (1 - draw(rng, m["monthly_churn"])) ** (1 / WEEKS_PER_MONTH)
    mc_clients = 0

    clients: list[dict] = []  # {"backlog": float, "monthly_new": float}
    payouts = [0.0] * (WEEKS + 12)
    weekly_net, weekly_hours = [], []
    for w in range(WEEKS):
        hours = H * rng.uniform(0.9, 1.1)
        pen = ramp_pen if w < ramp_weeks else 1.0
        for c in clients:
            c["backlog"] += c["monthly_new"] / WEEKS_PER_MONTH
        backlog = sum(c["backlog"] for c in clients)
        trailing = sum(weekly_net[-4:]) * WEEKS_PER_MONTH / 4 if weekly_net else 0
        hired = scale and trailing >= 2000

        hours -= onboarding * f["onboarding_hours"][0] + mc_clients * mc_support / WEEKS_PER_MONTH
        if hired:  # callers do fulfillment, founder sells and manages
            worked = backlog
            labor_cost = worked / leads_per_hour * wage
            prospect_hours = hours * 0.85
        else:
            own_capacity = max(hours, 0) * 0.5 * leads_per_hour
            worked = min(backlog, own_capacity)
            labor_cost = 0.0
            prospect_hours = hours - worked / leads_per_hour

        if backlog > 0:
            for c in clients:
                c["backlog"] -= worked * c["backlog"] / backlog
        booked = binom(rng, worked, reach * book)
        for _ in range(binom(rng, booked, visit_close)):
            if rng.random() > non_pay:
                due = w + round(draw(rng, f["pay_delay_weeks"]))
                payouts[due] += draw(rng, f["ticket"]) * f["fee_rate"][0]

        new = sales.week(prospect_hours, pen)
        onboarding = new
        mc_clients -= binom(rng, mc_clients, mc_churn)
        for _ in range(new):
            if rng.random() < has_list:
                clients.append({"backlog": draw(rng, f["list_size"]), "monthly_new": draw(rng, f["new_estimates_per_month"])})
        mc_clients += binom(rng, new, upsell_rate)
        clients = [c for c in clients if c["backlog"] > 5 or rng.random() < weekly_keep]

        mrr_net = mc_clients * (price - mc_cost) / WEEKS_PER_MONTH
        weekly_net.append(payouts[w] + mrr_net - labor_cost - f["tools_per_month"][0] / WEEKS_PER_MONTH)
        weekly_hours.append(hours)
    return _finish(weekly_net, weekly_hours, {"clients": len(clients)})


def simulate_missed_call(rng: random.Random, p: dict, scale: bool) -> RunResult:
    H, ramp_weeks, ramp_pen = _founder(rng)
    s, m = p["SALES_FUNNEL"], p["MISSED_CALL"]
    c2m, m2c = draw(rng, m["conv_to_meeting"]), draw(rng, m["meeting_to_close"])
    sales = Prospector(rng, s, c2m, m2c)
    hire = Prospector(rng, s, c2m * 0.7, m2c)
    price, setup, setup_p = m["price"][0], m["setup_fee"][0], draw(rng, m["setup_fee_collected"])
    cost, onboard, support = (draw(rng, m[k]) for k in ("cost_per_client", "onboarding_hours", "support_hours_per_month"))
    weekly_churn = 1 - (1 - draw(rng, m["monthly_churn"])) ** (1 / WEEKS_PER_MONTH)
    wage = A.FOUNDER["caller_wage"][0]

    clients, onboarding_queue = 0, 0
    weekly_net, weekly_hours = [], []
    for w in range(WEEKS):
        hours = H * rng.uniform(0.9, 1.1)
        pen = ramp_pen if w < ramp_weeks else 1.0
        busy = clients * support / WEEKS_PER_MONTH + onboarding_queue * onboard
        prospect_hours = max(hours - busy, 0)
        mrr = clients * price
        hired = scale and mrr >= 3000
        new = sales.week(prospect_hours, pen)
        labor_cost = 0.0
        if hired:  # one 20h/week setter, 30% less effective than the founder; founder still runs the meetings
            new += hire.week(20)
            labor_cost = 20 * wage
        cash = sum(setup for _ in range(new) if rng.random() < setup_p)
        clients = clients - binom(rng, clients, weekly_churn) + new
        onboarding_queue = new
        weekly_net.append(cash + clients * (price - cost) / WEEKS_PER_MONTH - labor_cost)
        weekly_hours.append(hours)
    return _finish(weekly_net, weekly_hours, {"clients": clients})


def simulate_setter(rng: random.Random, p: dict, scale: bool) -> RunResult:
    H, ramp_weeks, ramp_pen = _founder(rng)
    st = p["SETTER"]
    dph, connect, c2s, show, close = (draw(rng, st[k]) for k in ("dials_per_hour", "connect_rate", "conv_to_set", "show_rate", "close_rate"))
    commission = draw(rng, st["commission"])
    max_dial = draw(rng, A.FOUNDER["max_dial_hours"])
    unplaced = round(draw(rng, st["weeks_to_get_placed"]))
    placed_week = None
    payouts = [0.0] * (WEEKS + 12)
    weekly_net, weekly_hours = [], []
    for w in range(WEEKS):
        hours = H * rng.uniform(0.9, 1.1)
        if unplaced > 0:
            unplaced -= 1
        else:
            placed_week = w if placed_week is None else placed_week
            pen = ramp_pen if w - placed_week < ramp_weeks else 1.0
            dial_hours = min(hours * (1 - st["admin_share"][0]), max_dial)
            convos = binom(rng, dial_hours * dph, connect)
            shows = binom(rng, binom(rng, convos, c2s * pen), show)
            closes = binom(rng, shows, close * pen)
            due = w + round(draw(rng, st["pay_delay_weeks"]))
            payouts[due] += shows * st["show_bonus"][0] + sum(draw(rng, st["ticket"]) * commission for _ in range(closes))
            if rng.random() < st["gig_loss_per_week"][0]:
                unplaced, placed_week = round(draw(rng, st["weeks_to_get_placed"])), None
        weekly_net.append(payouts[w])
        weekly_hours.append(hours)
    return _finish(weekly_net, weekly_hours)


def simulate_combo(rng: random.Random, p: dict, scale: bool) -> RunResult:
    return simulate_revival(rng, p, scale, upsell=True)


MODELS = {
    "Estimate Revival": simulate_revival,
    "Revival + Rescue upsell": simulate_combo,
    "Missed-Call Rescue": simulate_missed_call,
    "Commission Setter": simulate_setter,
}


def default_params() -> dict:
    return {name: copy.deepcopy(getattr(A, name)) for name in ("SALES_FUNNEL", "REVIVAL", "MISSED_CALL", "SETTER", "COMBO")}


def run(runs: int = 2000, seed: int = 42, scale: bool = True, params: dict | None = None) -> dict[str, list[RunResult]]:
    params = params or default_params()
    out = {}
    for name, fn in MODELS.items():
        rng = random.Random(f"{seed}-{name}")  # each model gets its own stream: adding one never shifts another
        out[name] = [fn(rng, params, scale) for _ in range(runs)]
    return out


def pct(values: list[float], q: float) -> float:
    values = sorted(values)
    return values[min(int(q * len(values)), len(values) - 1)]


def summarize(results: list[RunResult]) -> dict:
    m6 = [r.monthly_net[5] for r in results]
    m12 = [r.monthly_net[11] for r in results]
    first = [r.first_cash_week for r in results if r.first_cash_week is not None]
    hourly6 = [r.monthly_net[5] / r.monthly_hours[5] for r in results if r.monthly_hours[5]]
    return {
        "median_by_month": [round(statistics.median(r.monthly_net[i] for r in results)) for i in range(12)],
        "p10_by_month": [round(pct([r.monthly_net[i] for r in results], 0.10)) for i in range(12)],
        "p90_by_month": [round(pct([r.monthly_net[i] for r in results], 0.90)) for i in range(12)],
        "m6_p_5k": sum(v >= 5000 for v in m6) / len(m6),
        "m6_p_10k": sum(v >= 10000 for v in m6) / len(m6),
        "m12_p_10k": sum(v >= 10000 for v in m12) / len(m12),
        "m12_p_25k": sum(v >= 25000 for v in m12) / len(m12),
        "never_paid": 1 - len(first) / len(results),
        "median_first_cash_week": statistics.median(first) + 1 if first else None,
        "median_year_total": round(statistics.median(sum(r.monthly_net) for r in results)),
        "median_hourly_m6": round(statistics.median(hourly6), 2) if hourly6 else 0,
    }
