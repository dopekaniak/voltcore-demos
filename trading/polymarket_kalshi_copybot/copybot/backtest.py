"""Backtest: replay real leader trades over a past window against Kalshi's historical quotes and results.

It uses the live matcher, price guard, sizing, fee model and caps, so the answer is "what would this bot have
done in that window". Network fetching lives in `run_group`; `simulate` is pure and unit-tested.

Caveats (printed with every report):
- Leader selection is hindsight. The "top" group is today's leaderboard, so its results are optimistic.
  The "random" group is wallets that were recently active. It is not picked on PnL, so it is the fairer control.
- Kalshi history has no order book depth. Every order is assumed to fill in full at the quoted ask or bid.
- Quotes are 1-minute candles. A buy uses the highest ask in the minute, a sell the lowest bid (the worst case).
- The order is placed `delay` seconds after the leader's fill, which is roughly how often the bot polls.
- Exits follow the leader's estimated remaining shares, counting only trades inside the window.
- Fees use the 0.07 taker formula, which is unverified against real fills.
"""

from __future__ import annotations

import csv
import gzip
import json
import logging
import math
import random
import re
import statistics
import sys
import time
from bisect import bisect_right
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .config import Settings
from .http import HttpError
from .kalshi import KalshiClient
from .matcher import MarketIndex, Matcher, TextNormalizer, league_for_pm
from .models import KalshiMarket, Signal, parse_ts
from .polymarket import PolymarketClient, aggregate
from .risk import RiskState, kalshi_taker_fee, plan_entry, sell_fraction

log = logging.getLogger("copybot.backtest")

BUCKET_SEC = 60  # fills within one minute from one wallet count as one leader order, like one poll
CANDLE_SEC = 60
CAVEATS = [
    "Leader selection is hindsight (today's leaderboard). The top group is optimistic.",
    "No order-book depth in history: every order fills in full at the quoted ask/bid.",
    "Quotes are 1-minute candles: buys use the minute's highest ask, sells its lowest bid.",
    "Orders are placed `delay` seconds after the leader's fill.",
    "Exits use the leader's estimated remaining shares (only in-window trades are counted).",
    "Fees use the unverified 0.07 taker formula.",
]


# ---------------------------------------------------------------- quotes


@dataclass(frozen=True)
class Quote:
    yes_ask: float  # highest yes offer in the minute (worst for a buyer)
    yes_bid: float  # lowest yes bid in the minute (worst for a seller)

    def ask_for(self, side: str) -> float:
        return self.yes_ask if side == "yes" else round(1.0 - self.yes_bid, 4)

    def bid_for(self, side: str) -> float:
        return self.yes_bid if side == "yes" else round(1.0 - self.yes_ask, 4)


def _px(block: Optional[dict], key: str) -> Optional[float]:
    if not block:
        return None
    v = block.get(key)
    return float(v) if v not in (None, "") else None


def _first(*values):
    for v in values:
        if v is not None:
            return v
    return None


def parse_candles(raw: list) -> tuple:
    """(end timestamps, Quote-or-None per candle). A candle with no ask or bid gives None."""
    ends, quotes = [], []
    for c in raw:
        ends.append(int(c.get("end_period_ts") or 0))
        ask = _first(_px(c.get("yes_ask"), "high_dollars"), _px(c.get("yes_ask"), "close_dollars"))
        bid = _first(_px(c.get("yes_bid"), "low_dollars"), _px(c.get("yes_bid"), "close_dollars"))
        quotes.append(Quote(ask, bid) if ask is not None and bid is not None else None)
    return ends, quotes


def quote_at(series: tuple, ts: float) -> Optional[Quote]:
    """Quote for the one-minute candle that contains ts. Never looks at later minutes."""
    ends, quotes = series
    i = bisect_right(ends, ts)  # first candle that ends after ts
    if i >= len(quotes) or ends[i] - CANDLE_SEC > ts:  # gap in the data: no candle covers ts
        return None
    return quotes[i]


# ---------------------------------------------------------------- signals


def build_signals(trades: list, bucket: int = BUCKET_SEC) -> list:
    """Group each wallet's fills on the same token and side within one bucket into one leader order."""
    groups: dict = defaultdict(list)
    for t in trades:
        groups[(t.wallet, t.token_id, t.side, t.timestamp // bucket)].append(t)
    out: list = []
    for g in groups.values():
        out.extend(aggregate(g))
    out.sort(key=lambda s: s.last_ts)
    return out


def leader_sell_fractions(signals: list) -> dict:
    """For each SELL (by index), the share of the leader's position it closes, from in-window trades only."""
    net: dict = defaultdict(float)
    fractions: dict = {}
    for i, s in enumerate(signals):
        key = (s.wallet, s.token_id)
        if s.side == "BUY":
            net[key] += s.size
        elif s.side == "SELL":
            after = max(0.0, net[key] - s.size)
            fractions[i] = sell_fraction(s.size, after)
            net[key] = after
    return fractions


def eligible_buy(s: Signal, settings: Settings, min_usd: float) -> str:
    """Empty string if the leader's buy passes the bot's prefilter, otherwise the skip reason."""
    if s.usdc_size < min_usd:
        return "skip_small"
    slug = f"{s.slug} {s.event_slug}".lower()
    if any(p and p in slug for p in settings.skip_slug_patterns):
        return "skip_pattern"
    if not settings.min_entry_price <= s.price <= settings.max_entry_price:
        return "skip_price_range"
    return ""


# ---------------------------------------------------------------- simulation


@dataclass
class OpenPos:
    ticker: str
    side: str
    cid: str
    outcome_index: int
    title: str
    close_ts: int
    contracts: float = 0.0
    cost: float = 0.0  # cost basis still open, including entry fees
    invested: float = 0.0  # all entry cost, for ROI
    realized: float = 0.0  # P&L already booked by exits


@dataclass
class Result:
    rows: list = field(default_factory=list)
    closed: list = field(default_factory=list)
    equity: list = field(default_factory=list)  # (ts, equity) before each leader signal
    entry_slips: list = field(default_factory=list)  # our ask minus the leader's price
    stats: Counter = field(default_factory=Counter)
    final_equity: float = 0.0


def _plan_bucket(reason: str) -> str:
    if reason.startswith("Kalshi ask"):
        return "skip_price_gap"
    if reason.startswith("max open"):
        return "skip_max_positions"
    if reason.startswith("budget"):
        return "skip_caps"
    return "skip_other"


def simulate(settings: Settings, signals: list, fracs: dict, mapping: dict, universe: dict,
             candles: dict, delay_sec: int = 60) -> Result:
    """Replay leader signals in time order against historical quotes.

    mapping: (condition_id, outcome_index) -> {"status": "auto", "ticker": ..., "side": ...}
    universe: ticker -> KalshiMarket (carries close_time and the settled result)
    candles: ticker -> (ends, quotes) from parse_candles
    """
    res = Result()
    stats = res.stats
    cash = settings.paper_starting_balance
    positions: dict = {}
    spend: dict = defaultdict(float)
    day_open: dict = {}
    order_ts: list = []
    min_usd = settings.min_leader_trade_usd

    def quote(ticker: str, t: float) -> Optional[Quote]:
        series = candles.get(ticker)
        return quote_at(series, t) if series else None

    def equity() -> float:
        return cash + sum(p.cost for p in positions.values())

    def log_row(ts, event, p, leader_price, kalshi_price, contracts, fee, cash_flow, pnl, wallet="", note=""):
        res.rows.append({
            "time": datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="minutes"),
            "event": event, "wallet": wallet, "market": p.title, "outcome": p.side.upper(),
            "ticker": p.ticker, "leader_price": leader_price, "kalshi_price": kalshi_price,
            "contracts": contracts, "fee": fee, "cash_flow": cash_flow, "pnl": pnl, "note": note,
        })

    def settle(key) -> None:
        nonlocal cash
        p = positions.pop(key)
        m = universe[p.ticker]
        payout = p.contracts * (1.0 if m.result == p.side else 0.0)
        cash += payout
        pnl = p.realized + payout - p.cost
        stats["settled"] += 1
        res.closed.append({"ticker": p.ticker, "side": p.side, "title": p.title, "how": "settled",
                           "invested": p.invested, "pnl": pnl})
        log_row(p.close_ts, "settle", p, None, None, p.contracts, None, payout, pnl, note=f"result={m.result}")

    for i, s in enumerate(signals):
        ts = s.last_ts
        for key in [k for k, p in positions.items() if p.close_ts and p.close_ts <= ts]:
            settle(key)

        day = int(ts // 86400)
        eq = equity()
        day_open.setdefault(day, eq)
        res.equity.append((ts, eq))
        halted = eq < day_open[day] * (1 - settings.daily_loss_limit_pct / 100)
        mp = mapping.get((s.condition_id, s.outcome_index)) or {"status": "unmapped"}

        if s.side == "BUY":
            reason = eligible_buy(s, settings, min_usd)
            if reason:
                stats[reason] += 1
                continue
            stats["buy_candidates"] += 1
            if mp["status"] != "auto":
                stats["unmatched_" + mp["status"]] += 1
                continue
            stats["matched_auto"] += 1
            ticker, side = mp["ticker"], mp["side"]
            m = universe[ticker]
            close_ts = int(m.close_time.timestamp()) if m.close_time else 0
            if close_ts and (close_ts - ts) / 60 < settings.min_minutes_to_close:
                stats["skip_close_soon"] += 1
                continue
            if halted:
                stats["skip_halted"] += 1
                continue
            if sum(1 for t in order_ts if ts - t < 3600) >= settings.max_orders_per_hour:
                stats["skip_orders_per_hour"] += 1
                continue
            q = quote(ticker, ts + delay_sec)
            if q is None:
                stats["skip_no_quote"] += 1
                continue
            ask = q.ask_for(side)
            state = RiskState(
                cash=cash, equity=eq,
                market_exposure=sum(p.cost for (t, _), p in positions.items() if t == ticker),
                total_exposure=sum(p.cost for p in positions.values()),
                spend_today=spend[day], open_positions=len(positions),
                holds_this_market=any(t == ticker for t, _ in positions),
            )
            plan = plan_entry(settings, leader_usd=s.usdc_size, leader_price=s.price, kalshi_ask=ask, state=state)
            if not plan.ok:
                stats[_plan_bucket(plan.reason)] += 1
                continue
            fee = kalshi_taker_fee(plan.contracts, ask)
            cost = plan.contracts * ask + fee
            cash -= cost
            spend[day] += cost
            order_ts.append(ts)
            key = (ticker, side)
            p = positions.get(key)
            if p is None:
                p = positions[key] = OpenPos(ticker, side, s.condition_id, s.outcome_index, s.title, close_ts)
            p.contracts += plan.contracts
            p.cost += cost
            p.invested += cost
            stats["entries"] += 1
            res.entry_slips.append(ask - s.price)
            log_row(ts, "entry", p, s.price, ask, plan.contracts, fee, -cost, None, wallet=s.wallet,
                    note=plan.reason)

        elif s.side == "SELL":
            if not settings.copy_sells:
                continue
            if mp["status"] != "auto":
                stats["sell_unmapped"] += 1
                continue
            ticker, side = mp["ticker"], mp["side"]
            p = positions.get((ticker, side))
            if p is None:
                stats["sell_no_position"] += 1
                continue
            qty = min(p.contracts, math.ceil(p.contracts * fracs.get(i, 1.0) - 1e-9))
            if qty <= 0:
                stats["sell_too_small"] += 1
                continue
            q = quote(ticker, ts + delay_sec)
            if q is None:
                stats["sell_no_quote"] += 1
                continue
            bid = q.bid_for(side)
            if bid <= 0:
                stats["sell_no_bid"] += 1
                continue
            fee = kalshi_taker_fee(qty, bid)
            proceeds = qty * bid - fee
            basis = p.cost * qty / p.contracts
            cash += proceeds
            p.contracts -= qty
            p.cost -= basis
            p.realized += proceeds - basis
            stats["exits"] += 1
            log_row(ts, "exit", p, s.price, bid, qty, fee, proceeds, proceeds - basis, wallet=s.wallet,
                    note=f"leader sold {s.size:.0f} shares")
            if p.contracts <= 1e-9:
                positions.pop((ticker, side))
                res.closed.append({"ticker": ticker, "side": side, "title": p.title, "how": "exited",
                                   "invested": p.invested, "pnl": p.realized})

    for key in list(positions):
        settle(key)
    res.final_equity = cash
    return res


# ---------------------------------------------------------------- metrics


def bootstrap_ci(xs: list, n_boot: int = 2000, seed: int = 7) -> tuple:
    if len(xs) < 2:
        return (None, None)
    rng = random.Random(seed)
    means = sorted(statistics.fmean(rng.choice(xs) for _ in xs) for _ in range(n_boot))
    return means[int(0.025 * n_boot)], means[int(0.975 * n_boot) - 1]


def summarize(res: Result, settings: Settings) -> dict:
    pnls = [c["pnl"] for c in res.closed]
    n = len(pnls)
    total = sum(pnls)
    invested = sum(c["invested"] for c in res.closed)
    curve = [settings.paper_starting_balance] + [e for _, e in res.equity] + [res.final_equity]
    peak, max_dd = -math.inf, 0.0
    for e in curve:
        peak = max(peak, e)
        if peak > 0:
            max_dd = max(max_dd, (peak - e) / peak)
    lo, hi = bootstrap_ci(pnls)
    start = settings.paper_starting_balance
    return {
        "positions_closed": n,
        "win_rate": sum(1 for x in pnls if x > 0) / n if n else None,
        "total_pnl": total,
        "total_invested": invested,
        "roi": total / invested if invested else None,
        "return_on_start": (res.final_equity - start) / start,
        "mean_pnl_per_position": statistics.fmean(pnls) if n else None,
        "ci95_mean_pnl": (lo, hi),
        "max_drawdown": max_dd,
        "avg_entry_slippage": statistics.fmean(res.entry_slips) if res.entry_slips else None,
    }


# ---------------------------------------------------------------- data fetching


def fetch_candles(kalshi: KalshiClient, series: str, ticker: str, start: int, end: int) -> tuple:
    ends: list = []
    quotes: list = []
    t = start
    while t < end:
        t2 = min(end, t + 86400)
        raw = kalshi.candlesticks(series, ticker, t, t2, period_interval=1).get("candlesticks") or []
        e, q = parse_candles(raw)
        ends.extend(e)
        quotes.extend(q)
        t = t2
    return ends, quotes


def _market_row(m: dict, ev: dict) -> Optional[dict]:
    if (m.get("result") or "").lower() not in ("yes", "no"):
        return None
    if m.get("market_type", "binary") != "binary":
        return None
    km = KalshiMarket.from_api(m, ev)
    return {
        "t": km.ticker, "e": km.event_ticker, "s": km.series_ticker, "et": km.event_title,
        "ti": km.title, "y": km.yes_sub_title,
        "ct": km.close_time.isoformat() if km.close_time else None,
        "x": km.expected_expiration_time.isoformat() if km.expected_expiration_time else None,
        "r": km.result, "c": km.category,
    }


GAME_SERIES_RE = r"KX{league}(?:\d?[A-Z]{{0,2}})?(?:GAME|SPREAD|TOTAL|WINMARGIN)"


def league_game_series(kalshi: KalshiClient, league: str) -> list:
    """Game-level series for one league (winner, spread, total, win margin, halves and quarters)."""
    pattern = re.compile(GAME_SERIES_RE.format(league=league.upper()))
    return sorted(s["ticker"] for s in kalshi.list_series() if pattern.fullmatch(s.get("ticker", "")))


def _download_settled_rows(kalshi: KalshiClient, path: Path, min_close_ts: int, series: list) -> list:
    """Settled markets for the given series. Each page is checkpointed, so a rate-limit failure resumes."""
    part = path.with_name(path.name + ".partial.jsonl")
    rows: list = []
    idx, cursor = 0, None
    if part.exists():
        for line in part.read_text(encoding="utf-8").splitlines():
            try:
                rec = json.loads(line)
            except ValueError:
                break  # torn last write: resume from the last complete page
            rows.extend(rec["rows"])
            idx = rec["idx"] + (1 if rec["cursor"] is None else 0)
            cursor = rec["cursor"]
        log.info("resuming settled-market download from checkpoint: %d markets so far", len(rows))
    path.parent.mkdir(parents=True, exist_ok=True)
    failures = 0
    with open(part, "a", encoding="utf-8") as fh:
        while idx < len(series):
            try:
                events, nxt = kalshi.events_page("settled", min_close_ts, cursor, series_ticker=series[idx])
            except HttpError as exc:
                failures += 1
                if failures > 20:
                    raise
                log.warning("events page failed (%s); pausing 60s, checkpoint kept", exc)
                time.sleep(60)
                continue
            failures = 0
            page = [r for ev in events for m in (ev.get("markets") or []) for r in [_market_row(m, ev)] if r]
            rows.extend(page)
            if not events:
                nxt = None
            fh.write(json.dumps({"idx": idx, "cursor": nxt, "rows": page}) + "\n")
            fh.flush()
            if nxt is None:
                idx, cursor = idx + 1, None
            else:
                cursor = nxt
            time.sleep(1.0)
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        json.dump({"markets": rows}, fh)
    part.unlink(missing_ok=True)
    log.info("cached %d settled markets to %s", len(rows), path)
    return rows


def load_universe(kalshi: KalshiClient, path: Path, min_close_ts: int, series: list) -> dict:
    """Settled binary Kalshi markets for the given series, cached on disk. Returns ticker -> KalshiMarket."""
    if path.exists():
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            rows = json.load(fh)["markets"]
    else:
        rows = _download_settled_rows(kalshi, path, min_close_ts, series)
    out = {}
    for r in rows:
        out[r["t"]] = KalshiMarket(
            ticker=r["t"], event_ticker=r["e"], series_ticker=r["s"], event_title=r["et"], title=r["ti"],
            yes_sub_title=r["y"], status="settled", close_time=parse_ts(r["ct"]),
            expected_expiration_time=parse_ts(r["x"]), result=r["r"], category=r.get("c", ""),
        )
    return out


def run_group(settings: Settings, pm: PolymarketClient, kalshi: KalshiClient, matcher: Matcher, universe: dict,
              wallets: list, start: int, end: int, delay: int, min_usd: float,
              max_wallets: Optional[int] = None, league: str = "") -> dict:
    trades: list = []
    used: list = []
    for w in wallets:
        got = pm.trades_since(w, start, max_pages=60, end_ts=end)
        if league:
            got = [t for t in got if league_for_pm(t.event_slug or t.slug) == league]
        log.info("wallet %s: %d %s trades in window (%d wallets so far)", w[:10], len(got), league or "all",
                 len(used) + (1 if got else 0))
        if not got:
            continue
        trades.extend(got)
        used.append(w)
        if max_wallets and len(used) >= max_wallets:
            break
    signals = build_signals(trades)
    fracs = leader_sell_fractions(signals)

    mapping: dict = {}
    for s in signals:
        if s.side != "BUY" or eligible_buy(s, settings, min_usd):
            continue
        key = (s.condition_id, s.outcome_index)
        if key in mapping:
            continue
        if len(mapping) % 200 == 0:
            log.info("matching outcomes: %d done", len(mapping))
        pmm = pm.market(s.condition_id)
        if pmm is None:
            mapping[key] = {"status": "no_meta"}
            continue
        r = matcher.match(pmm, s.outcome, now=datetime.fromtimestamp(s.last_ts, tz=timezone.utc))
        mapping[key] = {"status": r.status, "ticker": r.kalshi_ticker, "side": r.kalshi_side,
                        "score": r.score, "reason": r.reason}

    spans: dict = {}
    for s in signals:
        mp = mapping.get((s.condition_id, s.outcome_index))
        if not mp or mp.get("status") != "auto":
            continue
        if s.side == "BUY" and eligible_buy(s, settings, min_usd):
            continue
        lo, hi = spans.get(mp["ticker"], (s.last_ts, s.last_ts))
        spans[mp["ticker"]] = (min(lo, s.last_ts), max(hi, s.last_ts))
    candles: dict = {}
    candle_failures = 0
    for ticker, (lo, hi) in spans.items():
        m = universe[ticker]
        if not m.series_ticker:
            continue
        try:
            candles[ticker] = fetch_candles(kalshi, m.series_ticker, ticker, int(lo) - 300, int(hi) + delay + 300)
        except HttpError as exc:
            candle_failures += 1  # trades on this market are skipped as "no quote", and the report says so
            log.warning("candles failed for %s: %s", ticker, exc)
    log.info("wallets used %d | trades %d | signals %d | mapped outcomes %d | priced markets %d | "
             "candle failures %d", len(used), len(trades), len(signals), len(mapping), len(candles), candle_failures)

    res = simulate(settings, signals, fracs, mapping, universe, candles, delay)
    return {"res": res, "summary": summarize(res, settings), "wallets": len(used), "trades": len(trades),
            "signals": len(signals), "priced_markets": len(candles), "candle_failures": candle_failures}


# ---------------------------------------------------------------- CLI


def _utc(date_str: str) -> int:
    return int(datetime.fromisoformat(date_str).replace(tzinfo=timezone.utc).timestamp())


def _money(x: Optional[float]) -> str:
    return "n/a" if x is None else f"${x:,.2f}"


def _pct(x: Optional[float]) -> str:
    return "n/a" if x is None else f"{x * 100:.1f}%"


def print_report(label: str, out: dict, args) -> None:
    s, st = out["summary"], out["res"].stats
    lo, hi = s["ci95_mean_pnl"]
    ci = "n/a" if lo is None else f"${lo:,.2f} to ${hi:,.2f}"
    slip = "n/a" if s["avg_entry_slippage"] is None else f"{s['avg_entry_slippage']:+.3f}"
    print(f"\n=== {label.upper()}  {args.start} to {args.end} (UTC)")
    print(f"  wallets {out['wallets']}  trades {out['trades']:,}  leader orders {out['signals']:,}  "
          f"priced markets {out['priced_markets']}  candle fetch failures {out['candle_failures']}")
    print(f"  buys passing prefilter : {st['buy_candidates']:,}")
    print(f"  matched to Kalshi auto : {st['matched_auto']:,}   "
          f"(unmatched: review {st['unmatched_review']}, needs_llm {st['unmatched_needs_llm']}, "
          f"none {st['unmatched_none']}, no_meta {st['unmatched_no_meta']})")
    print(f"  skipped: price gap {st['skip_price_gap']}, no quote {st['skip_no_quote']}, "
          f"caps {st['skip_caps']}, max positions {st['skip_max_positions']}, close soon "
          f"{st['skip_close_soon']}, orders/hour {st['skip_orders_per_hour']}, halted {st['skip_halted']}")
    print(f"  entries {st['entries']}   exits {st['exits']}   settled to resolution {st['settled']}")
    print(f"  positions closed       : {s['positions_closed']}   win rate {_pct(s['win_rate'])}")
    print(f"  total P&L              : {_money(s['total_pnl'])}   ROI on invested {_pct(s['roi'])}   "
          f"return on ${args.start_balance:,.0f} {_pct(s['return_on_start'])}")
    print(f"  mean P&L / position    : {_money(s['mean_pnl_per_position'])}   95% CI {ci}")
    print(f"  max drawdown           : {_pct(s['max_drawdown'])}   avg entry vs leader price {slip}")


def cmd_backtest(settings: Settings, args) -> None:
    start, end = _utc(args.start), _utc(args.end)
    if end <= start:
        sys.exit("--end must be after --start")
    min_usd = args.min_usd if args.min_usd is not None else settings.min_leader_trade_usd
    args.start_balance = settings.paper_starting_balance

    pm = PolymarketClient()
    kalshi = KalshiClient(settings.kalshi_base_url, None)
    series = league_game_series(kalshi, args.league)
    if not series:
        sys.exit(f"No game-level Kalshi series found for league {args.league!r}")
    print(f"League {args.league.upper()}: {len(series)} game-level Kalshi series: {', '.join(series)}")
    universe = load_universe(kalshi, settings.data_dir / f"backtest_universe_{args.league}_{args.start}.json.gz",
                             start - 86400, series)
    print(f"Settled Kalshi markets in those series: {len(universe):,}")
    matcher = Matcher(MarketIndex(list(universe.values()), TextNormalizer.from_file(settings.aliases_path)),
                      settings.match_auto_threshold, settings.match_review_threshold,
                      settings.match_max_date_diff_days)

    groups: dict = {}
    if args.group in ("top", "both"):
        board = pm.leaderboard("month", "overall", limit=max(args.n * 3, 50))
        groups["top"] = ([ld.wallet for ld in board if ld.pnl >= settings.leader_min_pnl], args.n)
    if args.group in ("random", "both"):
        pool = pm.recent_wallets(1000)
        candidates = random.Random(args.seed).sample(pool, min(len(pool), args.n * 4))
        groups["random"] = (candidates, args.n)

    out_dir = settings.data_dir / "backtests"
    out_dir.mkdir(parents=True, exist_ok=True)
    for label, (wallets, cap) in groups.items():
        out = run_group(settings, pm, kalshi, matcher, universe, wallets, start, end, args.delay, min_usd,
                        max_wallets=cap, league=args.league)
        print_report(label, out, args)
        path = out_dir / f"{label}_{args.start}_{args.end}.csv"
        fields = ["time", "event", "wallet", "market", "outcome", "ticker", "leader_price", "kalshi_price",
                  "contracts", "fee", "cash_flow", "pnl", "note"]
        with open(path, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=fields)
            w.writeheader()
            w.writerows(out["res"].rows)
        print(f"  trade log: {path}")

    print("\nCaveats:")
    for c in CAVEATS:
        print(f"  - {c}")
