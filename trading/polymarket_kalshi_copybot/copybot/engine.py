"""Copy-trading loop: follow Polymarket leaders, mirror their entries and exits on Kalshi."""

from __future__ import annotations

import json
import logging
import math
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

import requests

from .executor import Fill
from .http import HttpError
from .kalshi import load_universe, save_universe
from .matcher import MarketIndex, Matcher, TextNormalizer
from .models import Leader, PMMarket, Signal
from .polymarket import aggregate
from .risk import RiskState, exit_limit, plan_entry, sell_fraction

log = logging.getLogger("copybot.engine")

NEGATIVE_MAPPING_TTL_SEC = 6 * 3600


@dataclass
class Mapping:
    status: str  # mapped | blocked | review | unmatched | deferred
    ticker: Optional[str] = None
    side: Optional[str] = None
    source: str = ""
    score: float = 0.0
    reason: str = ""


class CopyEngine:
    def __init__(self, settings, store, pm, kalshi, executor, llm=None, clock=time.time):
        self.s = settings
        self.store = store
        self.pm = pm
        self.kalshi = kalshi
        self.exec = executor
        self.mode = executor.mode
        self.llm = llm
        self.clock = clock
        self.norm = TextNormalizer.from_file(settings.aliases_path)
        self.matcher: Optional[Matcher] = None
        self._universe_fetched = 0.0
        self._universe_thread: Optional[threading.Thread] = None
        self._leaders_refreshed = 0.0
        self._last_prune = 0.0
        self._equity = 0.0
        self._live_cash = 0.0
        self._stop = threading.Event()

    # ================================================================== Kalshi universe
    @property
    def universe_path(self):
        return self.s.data_dir / "kalshi_universe.json.gz"

    def _universe_stale(self) -> bool:
        return self.clock() - self._universe_fetched > self.s.kalshi_universe_refresh_min * 60

    def install_universe(self, markets: list, fetched_at: float) -> None:
        index = MarketIndex(markets, self.norm)
        self.matcher = Matcher(index, self.s.match_auto_threshold, self.s.match_review_threshold,
                               self.s.match_max_date_diff_days)
        self._universe_fetched = fetched_at
        log.info("matcher ready: %d Kalshi markets indexed", len(markets))

    def refresh_universe(self) -> None:
        markets = self.kalshi.fetch_universe()
        if markets:
            save_universe(self.universe_path, markets)
            self.install_universe(markets, self.clock())

    def ensure_universe(self, block: bool = False) -> None:
        if self.matcher is None:
            markets, fetched = load_universe(self.universe_path)
            if markets:
                self.install_universe(markets, fetched)
        if self.matcher is not None and not self._universe_stale():
            return
        if block and self.matcher is None:
            log.info("downloading Kalshi market universe (about 1-2 minutes the first time)...")
            self.refresh_universe()
            return
        if self._universe_thread is None or not self._universe_thread.is_alive():
            def _bg():
                try:
                    self.refresh_universe()
                except Exception:  # noqa: BLE001 - keep the trading loop alive
                    log.exception("background universe refresh failed")
            self._universe_thread = threading.Thread(target=_bg, name="universe-refresh", daemon=True)
            self._universe_thread.start()

    # ================================================================== manual mappings
    def load_manual_map(self) -> int:
        path = self.s.market_map_path
        if not path.exists():
            return 0
        entries = json.loads(path.read_text())
        n = 0
        for e in entries:
            if not isinstance(e, dict) or "pm_condition_id" not in e:
                continue
            ticker = e.get("kalshi_ticker") or None
            side = (e.get("kalshi_side") or "").lower() or None
            if ticker and side not in ("yes", "no"):
                raise ValueError(f"market_map.json: kalshi_side must be yes|no for {ticker}")
            self.store.set_mapping(e["pm_condition_id"], int(e.get("pm_outcome_index", 0)), ticker, side,
                                   "manual", 1.0, e.get("note", ""))
            n += 1
        return n

    # ================================================================== leaders
    def refresh_leaders(self, force: bool = False) -> list:
        if not force and self.clock() - self._leaders_refreshed < self.s.leader_refresh_min * 60:
            return []
        try:
            board = self.pm.leaderboard(self.s.leader_time_period, self.s.leader_category,
                                        limit=max(self.s.leader_top_n * 3, 50))
        except HttpError as exc:
            log.warning("leaderboard fetch failed (%s); keeping current leaders", exc)
            return []
        exclude = set(self.s.leader_wallets_exclude)
        picked = [ld for ld in board
                  if ld.wallet not in exclude and ld.pnl >= self.s.leader_min_pnl
                  and ld.volume >= self.s.leader_min_volume][: self.s.leader_top_n]
        have = {ld.wallet for ld in picked}
        for w in self.s.leader_wallets_extra:
            if w not in have:
                picked.append(Leader(w, "manual", 0, 0.0, 0.0))
        self.store.replace_leaders(picked)
        self._leaders_refreshed = self.clock()
        log.info("following %d leaders (%s, %s by PnL)", len(picked), self.s.leader_category,
                 self.s.leader_time_period)
        return picked

    # ================================================================== polling
    def poll(self) -> list:
        now = int(self.clock())
        signals: list = []
        for row in self.store.active_leaders():
            wallet = row["wallet"]
            wm = self.store.get_watermark(wallet)
            if wm is None:
                self.store.set_watermark(wallet, now)  # follow from now on; never copy old history
                continue
            try:
                trades = self.pm.trades_since(wallet, wm - 120)  # small look-back for late-indexed fills
            except HttpError as exc:
                log.warning("activity fetch failed for %s: %s", row["name"] or wallet[:10], exc)
                continue
            if trades:
                self.store.set_watermark(wallet, max(t.timestamp for t in trades))
            fresh = self.store.filter_unseen(trades)
            signals.extend(aggregate(fresh))
        return sorted(signals, key=lambda s: s.last_ts)

    # ================================================================== signal handling
    def prefilter(self, sig: Signal) -> str:
        slug = f"{sig.slug} {sig.event_slug}".lower()
        for pat in self.s.skip_slug_patterns:
            if pat and pat in slug:
                return f"slug matches skip pattern '{pat}'"
        age = self.clock() - sig.last_ts
        if age > self.s.max_trade_age_sec:
            return f"stale ({age:.0f}s old)"
        if sig.side == "BUY":
            if sig.usdc_size < self.s.min_leader_trade_usd:
                return f"leader size ${sig.usdc_size:,.0f} < ${self.s.min_leader_trade_usd:,.0f}"
            if not self.s.min_entry_price <= sig.price <= self.s.max_entry_price:
                return f"price {sig.price:.3f} outside [{self.s.min_entry_price}, {self.s.max_entry_price}]"
        elif sig.side == "SELL":
            if not self.s.copy_sells:
                return "COPY_SELLS is off"
        else:
            return f"unknown side {sig.side}"
        return ""

    def process(self, sig: Signal) -> str:
        """Handle one signal end to end. Returns the final status string."""
        reason = self.prefilter(sig)
        if reason:
            self.store.record_signal(sig, "skipped", reason)
            return "skipped"

        mapped = self.store.get_mapping(sig.condition_id, sig.outcome_index)
        if sig.side == "SELL" and (mapped is None or not mapped["kalshi_ticker"]):
            self.store.record_signal(sig, "skipped", "exit in a market we never copied")
            return "skipped"

        pm_market = self.pm.market(sig.condition_id)
        if pm_market is None:
            self.store.record_signal(sig, "skipped", "Polymarket market metadata unavailable")
            return "skipped"
        if pm_market.closed and sig.side == "BUY":
            self.store.record_signal(sig, "skipped", "Polymarket market already closed")
            return "skipped"

        m = self.resolve_mapping(sig, pm_market)
        if m.status != "mapped":
            self.store.record_signal(sig, m.status, m.reason, m.ticker, m.side, m.score)
            return m.status

        sid = self.store.record_signal(sig, "pending", f"mapped via {m.source}", m.ticker, m.side, m.score)
        try:
            if sig.side == "BUY":
                status, why = self._enter(sig, m, pm_market)
            else:
                status, why = self._exit(sig, m)
        except HttpError as exc:
            status, why = "error", f"Kalshi API: {exc}"
        self.store.update_signal(sid, status, why)
        level = logging.INFO if status in ("copied", "partial", "exited") else logging.DEBUG
        log.log(level, "[%s] %s %s '%s' @%.3f ($%.0f) -> %s %s: %s", status.upper(), sig.leader_name or sig.wallet[:8],
                sig.side, sig.outcome, sig.price, sig.usdc_size, m.ticker, m.side, why)
        return status

    def resolve_mapping(self, sig: Signal, pm: PMMarket) -> Mapping:
        row = self.store.get_mapping(sig.condition_id, sig.outcome_index)
        if row is not None:
            if row["source"] == "none":
                return Mapping("unmatched", score=row["score"] or 0, reason=row["reason"] or "no Kalshi match")
            if not row["kalshi_ticker"]:
                return Mapping("blocked", source=row["source"], reason="blocked in market_map.json")
            return Mapping("mapped", row["kalshi_ticker"], row["kalshi_side"], row["source"], row["score"] or 0)

        self.ensure_universe(block=False)
        if self.matcher is None:
            return Mapping("deferred", reason="Kalshi universe still loading")
        result = self.matcher.match(pm, sig.outcome, now=datetime.fromtimestamp(self.clock(), tz=timezone.utc))
        use_llm = self.llm is not None and result.candidates and (
            self.s.llm_verify_mode == "all" or
            (self.s.llm_verify_mode == "review" and result.status in ("review", "needs_llm")))

        if result.status == "auto" and not (use_llm and self.s.llm_verify_mode == "all"):
            self.store.set_mapping(sig.condition_id, sig.outcome_index, result.kalshi_ticker, result.kalshi_side,
                                   "auto", result.score, result.reason)
            return Mapping("mapped", result.kalshi_ticker, result.kalshi_side, "auto", result.score)

        if use_llm:
            choice = self._llm_choose(pm, sig.outcome, result.candidates)
            if choice:
                self.store.set_mapping(sig.condition_id, sig.outcome_index, choice["ticker"], choice["side"],
                                       "llm", choice["confidence"], choice["reason"])
                return Mapping("mapped", choice["ticker"], choice["side"], "llm", choice["confidence"])

        if result.status in ("auto", "review", "needs_llm"):
            self.store.enqueue_review(sig, pm.question, pm.slug, result)
            self.store.set_mapping(sig.condition_id, sig.outcome_index, None, None, "none", result.score,
                                   f"in review queue: {result.reason}")
            return Mapping("review", result.kalshi_ticker, result.kalshi_side, score=result.score,
                           reason=f"queued for review: {result.reason}")

        self.store.set_mapping(sig.condition_id, sig.outcome_index, None, None, "none", result.score, result.reason)
        return Mapping("unmatched", score=result.score, reason=result.reason or "no Kalshi match")

    def _llm_choose(self, pm: PMMarket, outcome: str, candidates: list) -> Optional[dict]:
        by_ticker = {m.ticker: m for m in self.matcher.index.markets} if self.matcher else {}
        full = []
        for c in candidates[:6]:
            try:
                q = self.kalshi.get_market(c.ticker)
            except HttpError:
                continue
            base = by_ticker.get(c.ticker)
            if base:
                q.event_title, q.series_ticker = base.event_title, base.series_ticker
            full.append(q)
        return self.llm.choose(pm, outcome, full)

    # ------------------------------------------------------------------ entries
    def _enter(self, sig: Signal, m: Mapping, pm: PMMarket) -> tuple:
        halted = self.halt_reason()
        if halted:
            return "halted", halted
        if self.store.orders_since(self.clock() - 3600, self.mode) >= self.s.max_orders_per_hour:
            return "skipped", f"MAX_ORDERS_PER_HOUR ({self.s.max_orders_per_hour}) reached"

        quote = self.kalshi.get_market(m.ticker)
        if quote.status != "active":
            return "skipped", f"Kalshi market status {quote.status}"
        ends = [d for d in (quote.close_time, quote.expected_expiration_time) if d]
        if ends:
            minutes_left = (min(ends).timestamp() - self.clock()) / 60
            if minutes_left < self.s.min_minutes_to_close:
                return "skipped", f"only {minutes_left:.0f} min until Kalshi close/expiry"

        plan = plan_entry(self.s, leader_usd=sig.usdc_size, leader_price=sig.price,
                          kalshi_ask=quote.ask_for(m.side), state=self.risk_state(m.ticker, m.side))
        if not plan.ok:
            return "skipped", plan.reason

        coid = client_order_id(sig, "buy", self.mode)
        if self.store.order_exists(coid):
            return "skipped", "order already sent for these leader fills"
        fill = self.exec.execute(action="buy", ticker=m.ticker, side=m.side, contracts=plan.contracts,
                                 limit_price=plan.limit_price, quote=quote, client_order_id=coid)
        self._record_order(sig, coid, m, "buy", plan.contracts, plan.limit_price, fill)
        if not fill.filled:
            return ("error" if fill.status in ("error", "duplicate") else "unfilled"), (
                fill.error or f"nothing filled at <= {plan.limit_price:.2f}")

        cost = fill.count * fill.avg_price + fill.fee
        self.store.add_to_position(self.mode, m.ticker, m.side, fill.count, cost, fill.fee,
                                   sig.condition_id, sig.outcome_index, sig.title)
        self.store.add_spend(self.mode, cost)
        if self.mode == "paper":
            self.store.adjust_paper_cash(-cost)
        else:
            self._live_cash -= cost
        return ("copied" if fill.status == "filled" else "partial"), (
            f"bought {fill.count:g} {m.side.upper()} @ {fill.avg_price:.2f} (+${fill.fee:.2f} fee), {plan.reason}")

    # ------------------------------------------------------------------ exits
    def _exit(self, sig: Signal, m: Mapping) -> tuple:
        pos = self.store.get_position(self.mode, m.ticker, m.side)
        if not pos or pos["contracts"] <= 0:
            return "skipped", "no open copied position"
        try:
            remaining = self.pm.position_size(sig.wallet, sig.condition_id, sig.outcome_index)
        except HttpError:
            remaining = 0.0  # cannot tell: treat as a full exit, the safer direction
        frac = sell_fraction(sig.size, remaining)
        qty = min(pos["contracts"], math.ceil(pos["contracts"] * frac - 1e-9))
        if qty <= 0:
            return "skipped", "leader trim too small to mirror"

        quote = self.kalshi.get_market(m.ticker)
        limit = exit_limit(quote.bid_for(m.side), self.s.exit_slippage)
        if limit is None:
            return "skipped", "no Kalshi bid to sell into"
        coid = client_order_id(sig, "sell", self.mode)
        if self.store.order_exists(coid):
            return "skipped", "exit already sent for these leader fills"
        fill = self.exec.execute(action="sell", ticker=m.ticker, side=m.side, contracts=qty, limit_price=limit,
                                 quote=quote, client_order_id=coid)
        self._record_order(sig, coid, m, "sell", qty, limit, fill)
        if not fill.filled:
            return ("error" if fill.status in ("error", "duplicate") else "unfilled"), (
                fill.error or f"no fill at >= {limit:.2f}")
        proceeds = fill.count * fill.avg_price
        pnl = self.store.reduce_position(self.mode, m.ticker, m.side, fill.count, proceeds, fill.fee)
        if self.mode == "paper":
            self.store.adjust_paper_cash(proceeds - fill.fee)
        return "exited", f"sold {fill.count:g}/{pos['contracts']:g} ({frac:.0%} like leader) @ {fill.avg_price:.2f}, PnL ${pnl:+.2f}"

    def _record_order(self, sig: Signal, coid: str, m: Mapping, action: str, count: float, limit: float,
                      fill: Fill) -> None:
        self.store.record_order(
            signal_id=None, client_order_id=coid, mode=self.mode, ticker=m.ticker, outcome_side=m.side,
            action=action, count=count, limit_price=limit, status=fill.status, fill_count=fill.count,
            avg_price=fill.avg_price, fee=fill.fee, error=fill.error, raw=json.dumps(fill.raw, default=str)[:4000])

    # ================================================================== risk state
    def risk_state(self, ticker: str, side: str) -> RiskState:
        positions = self.store.open_positions(self.mode)
        cash = self.store.paper_cash(self.s.paper_starting_balance) if self.mode == "paper" else self._live_cash
        return RiskState(
            cash=cash,
            equity=self._equity or cash,
            market_exposure=sum(p["cost_basis"] for p in positions if p["ticker"] == ticker),
            total_exposure=sum(p["cost_basis"] for p in positions),
            spend_today=self.store.daily(self.mode)["spend"],
            open_positions=len(positions),
            holds_this_market=any(p["ticker"] == ticker for p in positions),
        )

    def update_equity(self) -> float:
        if self.mode == "paper":
            cash = self.store.paper_cash(self.s.paper_starting_balance)
            marks = 0.0
            for p in self.store.open_positions(self.mode):
                mark = p["mark_price"] if p["mark_price"] is not None else p["cost_basis"] / max(p["contracts"], 1e-9)
                marks += p["contracts"] * mark
            self._equity = cash + marks
        else:
            bal = self.kalshi.balance()
            self._live_cash = bal["cash"]
            self._equity = bal["cash"] + bal["portfolio_value"]
        self.store.daily(self.mode)
        self.store.set_start_equity(self.mode, self._equity)
        return self._equity

    def halt_reason(self) -> str:
        if self.s.stop_file.exists():
            return f"kill switch file present ({self.s.stop_file})"
        day = self.store.daily(self.mode)
        if day["halted"]:
            return f"halted for today: {day['halt_reason']}"
        start = day["start_equity"]
        if start and self._equity and self._equity < start * (1 - self.s.daily_loss_limit_pct / 100):
            reason = (f"daily loss limit hit: equity ${self._equity:,.2f} < "
                      f"{100 - self.s.daily_loss_limit_pct:g}% of ${start:,.2f}")
            self.store.halt_today(self.mode, reason)
            log.error(reason)
            return reason
        return ""

    # ================================================================== marks and settlement
    def mark_and_settle(self) -> None:
        positions = self.store.open_positions(self.mode)
        if not positions:
            return
        try:
            quotes = {q.ticker: q for q in self.kalshi.get_markets(sorted({p["ticker"] for p in positions}))}
        except HttpError as exc:
            log.warning("could not refresh position quotes: %s", exc)
            return
        for p in positions:
            q = quotes.get(p["ticker"])
            if q is None:
                continue
            if q.result in ("yes", "no"):
                payout = p["contracts"] * (1.0 if q.result == p["side"] else 0.0)
                pnl = self.store.settle_position(self.mode, p["ticker"], p["side"], payout)
                if self.mode == "paper":
                    self.store.adjust_paper_cash(payout)
                log.info("[SETTLED] %s %s resolved %s: payout $%.2f, PnL $%+.2f", p["ticker"], p["side"].upper(),
                         q.result.upper(), payout, pnl)
            else:
                self.store.set_mark(self.mode, p["ticker"], p["side"], q.bid_for(p["side"]))

    # ================================================================== main loop
    def cycle(self) -> dict:
        started = self.clock()
        self.refresh_leaders()
        self.ensure_universe(block=False)
        try:
            self.mark_and_settle()
            self.update_equity()
        except HttpError as exc:
            log.warning("equity/mark update failed: %s", exc)
        counts: dict = {}
        for sig in self.poll():
            try:
                status = self.process(sig)
            except Exception as exc:  # noqa: BLE001 - one bad signal must not stop the bot
                log.exception("signal failed: %s %s", sig.slug, sig.outcome)
                self.store.record_signal(sig, "error", f"{type(exc).__name__}: {exc}")
                status = "error"
            counts[status] = counts.get(status, 0) + 1
        if self.clock() - self._last_prune > 3600:
            self.store.prune()
            self.store.delete_stale_negative_mappings(NEGATIVE_MAPPING_TTL_SEC)
            self._last_prune = self.clock()
        summary = {"ts": int(self.clock()), "mode": self.mode, "equity": round(self._equity, 2),
                   "open_positions": len(self.store.open_positions(self.mode)), "signals": counts,
                   "cycle_sec": round(self.clock() - started, 2), "halt": self.halt_reason()}
        self.heartbeat(summary)
        return summary

    def heartbeat(self, summary: dict) -> None:
        try:
            (self.s.data_dir / "heartbeat.json").write_text(json.dumps(summary))
        except OSError:
            pass
        if self.s.healthcheck_url:
            try:
                requests.get(self.s.healthcheck_url, timeout=5)
            except requests.RequestException:
                log.debug("healthcheck ping failed")

    def stop(self) -> None:
        self._stop.set()

    def run_forever(self) -> None:
        log.info("copybot starting in %s mode (Kalshi %s)", self.mode.upper(), self.s.kalshi_env)
        self.load_manual_map()
        self.refresh_leaders(force=True)
        self.ensure_universe(block=True)
        while not self._stop.is_set():
            try:
                summary = self.cycle()
                if summary["signals"]:
                    log.info("cycle: %s | equity $%.2f | open %d", summary["signals"], summary["equity"],
                             summary["open_positions"])
            except Exception:  # noqa: BLE001
                log.exception("cycle failed; continuing")
            self._stop.wait(self.s.poll_interval_sec)
        log.info("copybot stopped")


def client_order_id(sig: Signal, action: str, mode: str) -> str:
    """Deterministic per leader-fill set, so a crash/restart can never double-send the same copy."""
    seed = "|".join(sorted(sig.trade_keys)) + f"|{action}|{mode}"
    return str(uuid.uuid5(uuid.NAMESPACE_URL, seed))
