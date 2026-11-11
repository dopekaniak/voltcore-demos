"""SQLite persistence. One file, WAL mode, indexed for the bot's hot paths."""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS leaders (
    wallet TEXT PRIMARY KEY, name TEXT, rank INTEGER, pnl REAL, volume REAL,
    active INTEGER NOT NULL DEFAULT 1, updated_at REAL
);

CREATE TABLE IF NOT EXISTS watermarks (wallet TEXT PRIMARY KEY, last_ts INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS seen_trades (key TEXT PRIMARY KEY, wallet TEXT, ts INTEGER);
CREATE INDEX IF NOT EXISTS idx_seen_ts ON seen_trades(ts);

CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT, created_at REAL, wallet TEXT, leader_name TEXT,
    condition_id TEXT, outcome TEXT, outcome_index INTEGER, side TEXT, leader_price REAL,
    leader_size REAL, leader_usd REAL, title TEXT, slug TEXT, last_ts INTEGER,
    status TEXT, reason TEXT, kalshi_ticker TEXT, kalshi_side TEXT, match_score REAL
);
CREATE INDEX IF NOT EXISTS idx_signals_created ON signals(created_at);
CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);

CREATE TABLE IF NOT EXISTS market_map (
    condition_id TEXT NOT NULL, outcome_index INTEGER NOT NULL, kalshi_ticker TEXT, kalshi_side TEXT,
    source TEXT, score REAL, reason TEXT, created_at REAL,
    PRIMARY KEY (condition_id, outcome_index)
);
CREATE INDEX IF NOT EXISTS idx_map_ticker ON market_map(kalshi_ticker);

CREATE TABLE IF NOT EXISTS review_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT, created_at REAL, condition_id TEXT, outcome_index INTEGER,
    outcome TEXT, pm_question TEXT, pm_slug TEXT, best_ticker TEXT, best_side TEXT, best_score REAL,
    reason TEXT, candidates_json TEXT, status TEXT NOT NULL DEFAULT 'pending',
    UNIQUE (condition_id, outcome_index)
);
CREATE INDEX IF NOT EXISTS idx_review_status ON review_queue(status);

CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, created_at REAL, signal_id INTEGER, client_order_id TEXT UNIQUE,
    mode TEXT, ticker TEXT, outcome_side TEXT, action TEXT, count REAL, limit_price REAL,
    status TEXT, fill_count REAL, avg_price REAL, fee REAL, error TEXT, raw TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_ticker ON orders(ticker);

CREATE TABLE IF NOT EXISTS positions (
    mode TEXT NOT NULL, ticker TEXT NOT NULL, side TEXT NOT NULL, contracts REAL NOT NULL DEFAULT 0,
    cost_basis REAL NOT NULL DEFAULT 0, fees REAL NOT NULL DEFAULT 0, realized_pnl REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open', condition_id TEXT, outcome_index INTEGER, title TEXT,
    mark_price REAL, opened_at REAL, updated_at REAL,
    PRIMARY KEY (mode, ticker, side)
);
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(mode, status);
CREATE INDEX IF NOT EXISTS idx_positions_source ON positions(condition_id, outcome_index);

CREATE TABLE IF NOT EXISTS paper_account (id INTEGER PRIMARY KEY CHECK (id = 1), cash REAL NOT NULL, updated_at REAL);

CREATE TABLE IF NOT EXISTS daily (
    day TEXT NOT NULL, mode TEXT NOT NULL, start_equity REAL, spend REAL NOT NULL DEFAULT 0,
    orders INTEGER NOT NULL DEFAULT 0, halted INTEGER NOT NULL DEFAULT 0, halt_reason TEXT,
    PRIMARY KEY (day, mode)
);
"""


def utc_day(ts: Optional[float] = None) -> str:
    return datetime.fromtimestamp(ts or time.time(), tz=timezone.utc).strftime("%Y-%m-%d")


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._lock = threading.RLock()
        self.conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA busy_timeout=5000")
        self.conn.executescript(SCHEMA)

    @contextmanager
    def tx(self):
        with self._lock:
            self.conn.execute("BEGIN IMMEDIATE")
            try:
                yield self.conn
            except BaseException:
                self.conn.execute("ROLLBACK")
                raise
            else:
                self.conn.execute("COMMIT")

    def q(self, sql: str, args: tuple = ()) -> list:
        with self._lock:
            return self.conn.execute(sql, args).fetchall()

    def q1(self, sql: str, args: tuple = ()):
        with self._lock:
            return self.conn.execute(sql, args).fetchone()

    def x(self, sql: str, args: tuple = ()) -> int:
        with self._lock:
            cur = self.conn.execute(sql, args)
            return cur.lastrowid

    # ------------------------------------------------------------------ meta
    def get_meta(self, key: str, default: Optional[str] = None) -> Optional[str]:
        row = self.q1("SELECT value FROM meta WHERE key=?", (key,))
        return row["value"] if row else default

    def set_meta(self, key: str, value: str) -> None:
        self.x("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
               (key, value))

    # ------------------------------------------------------------------ leaders
    def replace_leaders(self, leaders: list) -> None:
        now = time.time()
        with self.tx() as c:
            c.execute("UPDATE leaders SET active=0")
            for ld in leaders:
                c.execute(
                    "INSERT INTO leaders(wallet,name,rank,pnl,volume,active,updated_at) VALUES(?,?,?,?,?,1,?) "
                    "ON CONFLICT(wallet) DO UPDATE SET name=excluded.name, rank=excluded.rank, pnl=excluded.pnl, "
                    "volume=excluded.volume, active=1, updated_at=excluded.updated_at",
                    (ld.wallet, ld.name, ld.rank, ld.pnl, ld.volume, now))

    def active_leaders(self) -> list:
        return self.q("SELECT * FROM leaders WHERE active=1 ORDER BY rank")

    # ------------------------------------------------------------------ trade dedup
    def get_watermark(self, wallet: str) -> Optional[int]:
        row = self.q1("SELECT last_ts FROM watermarks WHERE wallet=?", (wallet,))
        return int(row["last_ts"]) if row else None

    def set_watermark(self, wallet: str, ts: int) -> None:
        self.x("INSERT INTO watermarks(wallet,last_ts) VALUES(?,?) "
               "ON CONFLICT(wallet) DO UPDATE SET last_ts=MAX(last_ts, excluded.last_ts)", (wallet, int(ts)))

    def filter_unseen(self, trades: list) -> list:
        """Return trades not seen before and mark them seen (atomic)."""
        fresh = []
        with self.tx() as c:
            for t in trades:
                cur = c.execute("INSERT OR IGNORE INTO seen_trades(key,wallet,ts) VALUES(?,?,?)",
                                (t.key, t.wallet, t.timestamp))
                if cur.rowcount:
                    fresh.append(t)
        return fresh

    def prune(self, keep_days: int = 7) -> None:
        cutoff = time.time() - keep_days * 86400
        self.x("DELETE FROM seen_trades WHERE ts < ?", (int(cutoff),))

    # ------------------------------------------------------------------ signals
    def record_signal(self, sig, status: str, reason: str, ticker: Optional[str] = None,
                      side: Optional[str] = None, score: Optional[float] = None) -> int:
        return self.x(
            "INSERT INTO signals(created_at,wallet,leader_name,condition_id,outcome,outcome_index,side,leader_price,"
            "leader_size,leader_usd,title,slug,last_ts,status,reason,kalshi_ticker,kalshi_side,match_score) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (time.time(), sig.wallet, sig.leader_name, sig.condition_id, sig.outcome, sig.outcome_index, sig.side,
             sig.price, sig.size, sig.usdc_size, sig.title, sig.slug, sig.last_ts, status, reason, ticker, side,
             score))

    def update_signal(self, signal_id: int, status: str, reason: str) -> None:
        self.x("UPDATE signals SET status=?, reason=? WHERE id=?", (status, reason, signal_id))

    def recent_signals(self, limit: int = 25) -> list:
        return self.q("SELECT * FROM signals ORDER BY id DESC LIMIT ?", (limit,))

    # ------------------------------------------------------------------ market map
    def get_mapping(self, condition_id: str, outcome_index: int):
        return self.q1("SELECT * FROM market_map WHERE condition_id=? AND outcome_index=?",
                       (condition_id, outcome_index))

    def set_mapping(self, condition_id: str, outcome_index: int, ticker: Optional[str], side: Optional[str],
                    source: str, score: float = 0.0, reason: str = "") -> None:
        self.x(
            "INSERT INTO market_map(condition_id,outcome_index,kalshi_ticker,kalshi_side,source,score,reason,created_at) "
            "VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(condition_id,outcome_index) DO UPDATE SET "
            "kalshi_ticker=excluded.kalshi_ticker, kalshi_side=excluded.kalshi_side, source=excluded.source, "
            "score=excluded.score, reason=excluded.reason, created_at=excluded.created_at",
            (condition_id, outcome_index, ticker, side, source, score, reason, time.time()))

    def delete_stale_negative_mappings(self, max_age_sec: float) -> None:
        self.x("DELETE FROM market_map WHERE source='none' AND created_at < ?", (time.time() - max_age_sec,))

    # ------------------------------------------------------------------ review queue
    def enqueue_review(self, sig, pm_question: str, pm_slug: str, result) -> None:
        cands = [{"ticker": c.ticker, "side": c.side, "score": c.score, "label": c.label,
                  "passed": c.passed_gates, "gate": c.gate_reason} for c in result.candidates]
        self.x(
            "INSERT INTO review_queue(created_at,condition_id,outcome_index,outcome,pm_question,pm_slug,best_ticker,"
            "best_side,best_score,reason,candidates_json,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending') "
            "ON CONFLICT(condition_id,outcome_index) DO NOTHING",
            (time.time(), sig.condition_id, sig.outcome_index, sig.outcome, pm_question, pm_slug,
             result.kalshi_ticker, result.kalshi_side, result.score, result.reason, json.dumps(cands)))

    def pending_reviews(self) -> list:
        return self.q("SELECT * FROM review_queue WHERE status='pending' ORDER BY id")

    def get_review(self, review_id: int):
        return self.q1("SELECT * FROM review_queue WHERE id=?", (review_id,))

    def set_review_status(self, review_id: int, status: str) -> None:
        self.x("UPDATE review_queue SET status=? WHERE id=?", (status, review_id))

    # ------------------------------------------------------------------ orders
    def order_exists(self, client_order_id: str) -> bool:
        return self.q1("SELECT 1 FROM orders WHERE client_order_id=?", (client_order_id,)) is not None

    def record_order(self, **kw) -> int:
        cols = ",".join(kw)
        marks = ",".join("?" for _ in kw)
        return self.x(f"INSERT INTO orders(created_at,{cols}) VALUES(?,{marks})", (time.time(), *kw.values()))

    def orders_since(self, since_ts: float, mode: str) -> int:
        row = self.q1("SELECT COUNT(*) n FROM orders WHERE created_at>=? AND mode=? AND status!='error'",
                      (since_ts, mode))
        return int(row["n"])

    # ------------------------------------------------------------------ positions
    def get_position(self, mode: str, ticker: str, side: str):
        return self.q1("SELECT * FROM positions WHERE mode=? AND ticker=? AND side=? AND status='open'",
                       (mode, ticker, side))

    def open_positions(self, mode: str) -> list:
        return self.q("SELECT * FROM positions WHERE mode=? AND status='open' AND contracts>0 ORDER BY opened_at",
                      (mode,))

    def add_to_position(self, mode: str, ticker: str, side: str, contracts: float, cost: float, fee: float,
                        condition_id: str, outcome_index: int, title: str) -> None:
        now = time.time()
        self.x(
            "INSERT INTO positions(mode,ticker,side,contracts,cost_basis,fees,status,condition_id,outcome_index,title,"
            "opened_at,updated_at) VALUES(?,?,?,?,?,?,'open',?,?,?,?,?) "
            "ON CONFLICT(mode,ticker,side) DO UPDATE SET "
            "contracts=CASE WHEN status='open' THEN contracts ELSE 0 END + excluded.contracts, "
            "cost_basis=CASE WHEN status='open' THEN cost_basis ELSE 0 END + excluded.cost_basis, "
            "fees=CASE WHEN status='open' THEN fees ELSE 0 END + excluded.fees, "
            "opened_at=CASE WHEN status='open' THEN opened_at ELSE excluded.opened_at END, "
            "status='open', updated_at=excluded.updated_at",
            (mode, ticker, side, contracts, cost, fee, condition_id, outcome_index, title, now, now))

    def reduce_position(self, mode: str, ticker: str, side: str, contracts: float, proceeds: float,
                        fee: float) -> float:
        """Sell `contracts` for `proceeds`; returns realized PnL of this sale (average-cost basis)."""
        with self.tx() as c:
            row = c.execute("SELECT * FROM positions WHERE mode=? AND ticker=? AND side=? AND status='open'",
                            (mode, ticker, side)).fetchone()
            if not row or row["contracts"] <= 0:
                return 0.0
            sold = min(contracts, row["contracts"])
            basis = row["cost_basis"] * sold / row["contracts"]
            pnl = proceeds - basis - fee
            remaining = row["contracts"] - sold
            c.execute(
                "UPDATE positions SET contracts=?, cost_basis=?, fees=fees+?, realized_pnl=realized_pnl+?, "
                "status=?, updated_at=? WHERE mode=? AND ticker=? AND side=?",
                (remaining, row["cost_basis"] - basis, fee, pnl, "open" if remaining > 1e-9 else "closed",
                 time.time(), mode, ticker, side))
            return pnl

    def settle_position(self, mode: str, ticker: str, side: str, payout: float) -> float:
        with self.tx() as c:
            row = c.execute("SELECT * FROM positions WHERE mode=? AND ticker=? AND side=? AND status='open'",
                            (mode, ticker, side)).fetchone()
            if not row:
                return 0.0
            pnl = payout - row["cost_basis"]
            c.execute("UPDATE positions SET contracts=0, cost_basis=0, realized_pnl=realized_pnl+?, "
                      "status='settled', mark_price=?, updated_at=? WHERE mode=? AND ticker=? AND side=?",
                      (pnl, payout / row["contracts"] if row["contracts"] else 0, time.time(), mode, ticker, side))
            return pnl

    def set_mark(self, mode: str, ticker: str, side: str, mark: Optional[float]) -> None:
        self.x("UPDATE positions SET mark_price=? WHERE mode=? AND ticker=? AND side=?", (mark, mode, ticker, side))

    def realized_pnl_total(self, mode: str) -> float:
        row = self.q1("SELECT COALESCE(SUM(realized_pnl),0) p FROM positions WHERE mode=?", (mode,))
        return float(row["p"])

    # ------------------------------------------------------------------ paper cash
    def paper_cash(self, starting: float) -> float:
        row = self.q1("SELECT cash FROM paper_account WHERE id=1")
        if row is None:
            self.x("INSERT OR IGNORE INTO paper_account(id,cash,updated_at) VALUES(1,?,?)", (starting, time.time()))
            return starting
        return float(row["cash"])

    def adjust_paper_cash(self, delta: float) -> None:
        self.x("UPDATE paper_account SET cash=cash+?, updated_at=? WHERE id=1", (delta, time.time()))

    # ------------------------------------------------------------------ daily stats
    def daily(self, mode: str, day: Optional[str] = None):
        day = day or utc_day()
        self.x("INSERT OR IGNORE INTO daily(day,mode) VALUES(?,?)", (day, mode))
        return self.q1("SELECT * FROM daily WHERE day=? AND mode=?", (day, mode))

    def set_start_equity(self, mode: str, equity: float) -> None:
        self.x("UPDATE daily SET start_equity=? WHERE day=? AND mode=? AND start_equity IS NULL",
               (equity, utc_day(), mode))

    def add_spend(self, mode: str, usd: float) -> None:
        self.daily(mode)
        self.x("UPDATE daily SET spend=spend+?, orders=orders+1 WHERE day=? AND mode=?", (usd, utc_day(), mode))

    def halt_today(self, mode: str, reason: str) -> None:
        self.daily(mode)
        self.x("UPDATE daily SET halted=1, halt_reason=? WHERE day=? AND mode=?", (reason, utc_day(), mode))
