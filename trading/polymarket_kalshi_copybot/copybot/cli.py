"""Command line: python -m copybot <command>"""

from __future__ import annotations

import argparse
import json
import logging
import signal
import sys
from logging.handlers import RotatingFileHandler
from urllib.parse import urlparse

from .config import Settings
from .engine import CopyEngine
from .executor import LiveExecutor, PaperExecutor
from .kalshi import KalshiAuth, KalshiClient
from .llm import LLMVerifier
from .polymarket import PolymarketClient
from .store import Store


def setup_logging(settings: Settings) -> None:
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s | %(levelname)-7s | %(name)s | %(message)s", "%Y-%m-%d %H:%M:%S")
    root = logging.getLogger()
    root.setLevel(settings.log_level)
    root.handlers.clear()
    console = logging.StreamHandler(sys.stderr)
    console.setFormatter(fmt)
    root.addHandler(console)
    fileh = RotatingFileHandler(settings.data_dir / "copybot.log", maxBytes=5_000_000, backupCount=5)
    fileh.setFormatter(fmt)
    root.addHandler(fileh)
    logging.getLogger("urllib3").setLevel(logging.WARNING)


def build_engine(settings: Settings) -> CopyEngine:
    auth = None
    if settings.kalshi_key_id and settings.kalshi_private_key_path:
        auth = KalshiAuth.from_file(settings.kalshi_key_id, settings.kalshi_private_key_path)
    kalshi = KalshiClient(settings.kalshi_base_url, auth)
    executor = LiveExecutor(kalshi) if settings.is_live else PaperExecutor()
    llm = None
    if settings.llm_verify_mode != "off":
        llm = LLMVerifier(settings.llm_base_url, settings.llm_api_key, settings.llm_model,
                          settings.llm_min_confidence)
    store = Store(settings.data_dir / "copybot.sqlite3")
    return CopyEngine(settings, store, PolymarketClient(), kalshi, executor, llm)


# ---------------------------------------------------------------------- commands


def cmd_run(engine: CopyEngine, args) -> None:
    if args.once:
        engine.load_manual_map()
        engine.refresh_leaders(force=True)
        engine.ensure_universe(block=True)
        print(json.dumps(engine.cycle(), indent=2))
        return
    signal.signal(signal.SIGTERM, lambda *_: engine.stop())
    try:
        engine.run_forever()
    except KeyboardInterrupt:
        engine.stop()


def cmd_leaders(engine: CopyEngine, args) -> None:
    leaders = engine.refresh_leaders(force=True)
    print(f"{'#':>3}  {'name':<28} {'wallet':<44} {'PnL':>14} {'volume':>16}")
    for ld in leaders:
        print(f"{ld.rank:>3}  {ld.name[:28]:<28} {ld.wallet:<44} {ld.pnl:>14,.0f} {ld.volume:>16,.0f}")


def cmd_match(engine: CopyEngine, args) -> None:
    ref = args.market.strip()
    if ref.startswith("http"):
        ref = [p for p in urlparse(ref).path.split("/") if p][-1]
    if ref.startswith("0x"):
        markets = [engine.pm.market(ref)]
    else:
        markets = [m for m in [engine.pm.market_by_slug(ref)] if m] or engine.pm.event_markets(ref)
    markets = [m for m in markets if m]
    if not markets:
        sys.exit(f"No Polymarket market found for {args.market!r} (use a market slug, event slug, URL or condition id)")
    engine.ensure_universe(block=True)
    for pm in markets[: args.limit]:
        outcomes = [args.outcome] if args.outcome else pm.outcomes
        for outcome in outcomes:
            r = engine.matcher.match(pm, outcome)
            print(f"\n{pm.question}  [{outcome}]   cid={pm.condition_id[:14]}...")
            print(f"  -> {r.status.upper()}  {r.kalshi_ticker or '-'} {(r.kalshi_side or '').upper()}  "
                  f"score={r.score:.2f}  {r.reason}")
            for c in r.candidates[: args.candidates]:
                flag = "ok " if c.passed_gates else "x  "
                print(f"     {flag}{c.score:.2f} {c.ticker:<45} {c.label[:90]}"
                      + ("" if c.passed_gates else f"   [{c.gate_reason}]"))


def cmd_review(engine: CopyEngine, args) -> None:
    rows = engine.store.pending_reviews()
    if not rows:
        print("Review queue is empty.")
        return
    for r in rows:
        print(f"\n#{r['id']}  {r['pm_question']}  [{r['outcome']}]  ({r['pm_slug']})")
        print(f"    suggested: {r['best_ticker'] or '-'} {(r['best_side'] or '').upper()} "
              f"score={r['best_score'] or 0:.2f}  why queued: {r['reason']}")
        for c in json.loads(r["candidates_json"] or "[]")[:5]:
            print(f"      {c['score']:.2f} {c['ticker']:<45} {c['label'][:90]}")
    print("\nApprove: python -m copybot approve <id> [--ticker T --side yes|no]   Reject: python -m copybot reject <id>")


def cmd_approve(engine: CopyEngine, args) -> None:
    r = engine.store.get_review(args.id)
    if not r:
        sys.exit(f"No review item #{args.id}")
    ticker = args.ticker or r["best_ticker"]
    side = (args.side or r["best_side"] or "").lower()
    if not ticker or side not in ("yes", "no"):
        sys.exit("Need a ticker and --side yes|no (no suggestion available)")
    engine.store.set_mapping(r["condition_id"], r["outcome_index"], ticker, side, "manual", 1.0,
                             f"approved review #{r['id']}")
    engine.store.set_review_status(r["id"], "approved")
    print(f"Approved: '{r['pm_question']}' [{r['outcome']}] -> {ticker} {side.upper()}. "
          "Future leader trades in this market will be copied.")


def cmd_reject(engine: CopyEngine, args) -> None:
    r = engine.store.get_review(args.id)
    if not r:
        sys.exit(f"No review item #{args.id}")
    engine.store.set_mapping(r["condition_id"], r["outcome_index"], None, None, "manual", 0.0,
                             f"rejected review #{r['id']}")
    engine.store.set_review_status(r["id"], "rejected")
    print(f"Rejected #{r['id']}; this market will not be copied.")


def cmd_status(engine: CopyEngine, args) -> None:
    s = engine.s
    try:
        engine.mark_and_settle()
        equity = engine.update_equity()
    except Exception as exc:  # noqa: BLE001
        equity = None
        print(f"(could not refresh marks: {exc})")
    day = engine.store.daily(engine.mode)
    print(f"Mode: {engine.mode.upper()}   Kalshi env: {s.kalshi_env}")
    if engine.mode == "paper":
        print(f"Paper cash: ${engine.store.paper_cash(s.paper_starting_balance):,.2f}   "
              f"(started ${s.paper_starting_balance:,.2f})")
    if equity is not None:
        print(f"Equity: ${equity:,.2f}   Day start: ${day['start_equity'] or 0:,.2f}   "
              f"Spent today: ${day['spend']:,.2f}/${s.max_daily_spend_usd:,.0f}   Orders today: {day['orders']}")
    print(f"Realized PnL (all time): ${engine.store.realized_pnl_total(engine.mode):+,.2f}")
    halt = engine.halt_reason()
    if halt:
        print(f"HALTED: {halt}")
    pos = engine.store.open_positions(engine.mode)
    print(f"\nOpen positions ({len(pos)}):")
    for p in pos:
        mark = p["mark_price"]
        value = p["contracts"] * mark if mark is not None else None
        upnl = (value - p["cost_basis"]) if value is not None else None
        print(f"  {p['ticker']:<45} {p['side'].upper():<3} {p['contracts']:>6g} cost ${p['cost_basis']:>8.2f} "
              f"mark {mark if mark is not None else '-':>6} uPnL {('$%+.2f' % upnl) if upnl is not None else '-':>9}  "
              f"{(p['title'] or '')[:40]}")
    print(f"\nLast {args.signals} signals:")
    for r in engine.store.recent_signals(args.signals):
        print(f"  #{r['id']:<5} {r['status']:<9} {r['leader_name'][:14]:<14} {r['side']:<4} "
              f"${r['leader_usd']:>9,.0f} '{(r['title'] or '')[:38]}' [{r['outcome']}] -> "
              f"{r['kalshi_ticker'] or '-'} | {(r['reason'] or '')[:70]}")
    reviews = engine.store.pending_reviews()
    if reviews:
        print(f"\n{len(reviews)} market match(es) waiting for review: python -m copybot review")


def cmd_check_kalshi(engine: CopyEngine, args) -> None:
    if not engine.kalshi.auth:
        sys.exit("Set KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY_PATH in .env first.")
    bal = engine.kalshi.balance()
    print(f"Kalshi {engine.s.kalshi_env} auth OK. Cash ${bal['cash']:,.2f}, positions value ${bal['portfolio_value']:,.2f}")
    for p in engine.kalshi.positions()[:20]:
        print(f"  {p.get('ticker'):<45} position {p.get('position_fp')}  exposure ${p.get('market_exposure_dollars')}")


def cmd_refresh_universe(engine: CopyEngine, args) -> None:
    engine.refresh_universe()
    print(f"Indexed {len(engine.matcher.index.markets)} Kalshi markets -> {engine.universe_path}")


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(prog="copybot", description="Copy Polymarket leaderboard traders onto Kalshi.")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("run", help="run the copy loop")
    p.add_argument("--once", action="store_true", help="run a single cycle and exit")
    sub.add_parser("leaders", help="show the leaders being followed")
    p = sub.add_parser("match", help="test how a Polymarket market maps to Kalshi")
    p.add_argument("market", help="Polymarket market/event slug, URL, or condition id")
    p.add_argument("--outcome", help="only this outcome (default: all)")
    p.add_argument("--limit", type=int, default=6, help="max markets of an event to show")
    p.add_argument("--candidates", type=int, default=5)
    sub.add_parser("review", help="list matches waiting for approval")
    p = sub.add_parser("approve", help="approve a queued match")
    p.add_argument("id", type=int)
    p.add_argument("--ticker")
    p.add_argument("--side", choices=["yes", "no"])
    p = sub.add_parser("reject", help="reject a queued match")
    p.add_argument("id", type=int)
    p = sub.add_parser("status", help="positions, PnL, recent signals")
    p.add_argument("--signals", type=int, default=15)
    sub.add_parser("check-kalshi", help="verify Kalshi API keys and show balance")
    sub.add_parser("refresh-universe", help="re-download all open Kalshi markets")
    p = sub.add_parser("backtest", help="replay leader trades over a past window against Kalshi history")
    p.add_argument("--league", required=True, choices=["nba", "nfl", "nhl", "mlb"],
                   help="one league per run: the Kalshi universe is game-level series for that league only")
    p.add_argument("--start", required=True, help="YYYY-MM-DD, UTC, inclusive")
    p.add_argument("--end", required=True, help="YYYY-MM-DD, UTC, exclusive")
    p.add_argument("--group", choices=["top", "random", "both"], default="both",
                   help="top = current leaderboard (hindsight); random = recently active wallets (control)")
    p.add_argument("--n", type=int, default=20, help="wallets per group")
    p.add_argument("--delay", type=int, default=60, help="seconds between a leader fill and our order")
    p.add_argument("--min-usd", type=float, default=None, help="leader order size floor (default MIN_LEADER_TRADE_USD)")
    p.add_argument("--seed", type=int, default=7, help="seed for the random control sample")
    args = parser.parse_args(argv)

    try:
        settings = Settings.from_env()
    except ValueError as exc:
        sys.exit(str(exc))
    setup_logging(settings)
    if args.cmd == "backtest":
        from .backtest import cmd_backtest  # no trading engine needed for a replay

        cmd_backtest(settings, args)
        return
    engine = build_engine(settings)
    {
        "run": cmd_run, "leaders": cmd_leaders, "match": cmd_match, "review": cmd_review,
        "approve": cmd_approve, "reject": cmd_reject, "status": cmd_status, "check-kalshi": cmd_check_kalshi,
        "refresh-universe": cmd_refresh_universe,
    }[args.cmd](engine, args)
