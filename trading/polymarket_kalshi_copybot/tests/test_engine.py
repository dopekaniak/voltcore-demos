"""End-to-end paper-mode tests of the copy loop with fake Polymarket and Kalshi clients."""

import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from copybot.config import BOT_DIR, Settings
from copybot.engine import CopyEngine
from copybot.executor import PaperExecutor
from copybot.models import Leader, LeaderTrade
from copybot.store import Store

from tests.helpers import NOW, SPREAD_35, kalshi_universe, pm

WALLET = "0xleader"
T0 = int(NOW.timestamp())
SPREAD_TICKER = "KXNBASPREAD-26NOV09INDDAL-DAL4"


class FakePM:
    def __init__(self):
        self.trades = []
        self.position_left = 0.0
        self.market_obj = pm(**SPREAD_35)

    def leaderboard(self, *a, **kw):
        return [Leader(WALLET, "whale", 1, 250_000, 4_000_000), Leader("0xsmall", "minnow", 2, 50, 100)]

    def trades_since(self, wallet, start_ts, max_pages=5):
        return [t for t in self.trades if t.wallet == wallet and t.timestamp >= start_ts]

    def position_size(self, wallet, cid, idx):
        return self.position_left

    def market(self, cid):
        return replace(self.market_obj, condition_id=cid)


class FakeKalshi:
    def __init__(self):
        self.quotes = {m.ticker: m for m in kalshi_universe()}
        self.auth = None

    def get_market(self, ticker):
        return self.quotes[ticker]

    def get_markets(self, tickers):
        return [self.quotes[t] for t in tickers if t in self.quotes]


def trade(n, side="BUY", outcome="Mavericks", idx=0, price=0.46, usd=5000.0, ts=None):
    return LeaderTrade(wallet=WALLET, leader_name="whale", condition_id="0xcond", token_id=f"tok{idx}", side=side,
                       outcome=outcome, outcome_index=idx, price=price, size=usd / price, usdc_size=usd,
                       timestamp=ts if ts is not None else T0 + n, title="Spread: Mavericks (-3.5)",
                       slug=SPREAD_35["slug"], event_slug=SPREAD_35["event_slug"], tx_hash=f"0xtx{n}")


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        data = Path(self.tmp.name)
        self.s = Settings(data_dir=data, aliases_path=BOT_DIR / "aliases.json", market_map_path=data / "none.json",
                          leader_min_pnl=10_000, max_trade_age_sec=600)
        self.now = [float(T0)]
        self.pm, self.k = FakePM(), FakeKalshi()
        self.store = Store(data / "t.sqlite3")
        self.e = CopyEngine(self.s, self.store, self.pm, self.k, PaperExecutor(), clock=lambda: self.now[0])
        self.e.install_universe(kalshi_universe(), self.now[0])
        self.e.refresh_leaders(force=True)
        self.e.cycle()  # first sight of the leader: sets the watermark, copies nothing

    def tearDown(self):
        self.store.conn.close()
        self.tmp.cleanup()

    def advance(self, sec=30):
        self.now[0] += sec

    def cash(self):
        return self.store.paper_cash(self.s.paper_starting_balance)

    def test_filters_leaders_by_pnl(self):
        self.assertEqual([r["wallet"] for r in self.store.active_leaders()], [WALLET])

    def test_history_is_not_copied(self):
        self.pm.trades = [trade(0, ts=T0 - 3600)]
        self.advance()
        self.e.cycle()
        self.assertEqual(self.store.open_positions("paper"), [])

    def test_buy_is_copied_once(self):
        self.pm.trades = [trade(1), trade(2, usd=3000)]  # two fills -> one aggregated signal
        self.advance()
        summary = self.e.cycle()
        self.assertEqual(summary["signals"], {"copied": 1})
        pos = self.store.get_position("paper", SPREAD_TICKER, "yes")
        self.assertIsNotNone(pos)
        self.assertGreater(pos["contracts"], 0)
        self.assertAlmostEqual(self.cash(), 1000 - pos["cost_basis"], places=6)
        self.assertLessEqual(pos["cost_basis"], 10.0 + 1e-9)
        # Same fills seen again on the next poll must not trade again.
        self.advance()
        self.assertEqual(self.e.cycle()["signals"], {})
        self.assertEqual(len(self.store.q("SELECT * FROM orders")), 1)

    def test_underdog_buy_maps_to_no(self):
        self.pm.trades = [trade(1, outcome="Pacers", idx=1, price=0.54)]
        self.advance()
        self.e.cycle()
        self.assertIsNotNone(self.store.get_position("paper", SPREAD_TICKER, "no"))

    def test_small_and_stale_trades_skipped(self):
        self.pm.trades = [trade(1, usd=100)]
        self.advance()
        self.assertEqual(self.e.cycle()["signals"], {"skipped": 1})
        self.pm.trades = [trade(2, ts=T0 + 5)]
        self.advance(1200)
        self.assertEqual(self.e.cycle()["signals"], {"skipped": 1})
        self.assertIn("stale", self.store.recent_signals(1)[0]["reason"])

    def test_kalshi_price_gap_blocks_entry(self):
        self.k.quotes[SPREAD_TICKER] = replace(self.k.quotes[SPREAD_TICKER], yes_ask=0.60)
        self.pm.trades = [trade(1, price=0.46)]
        self.advance()
        self.e.cycle()
        self.assertEqual(self.store.recent_signals(1)[0]["status"], "skipped")
        self.assertIn("Kalshi ask 0.60 > limit 0.49", self.store.recent_signals(1)[0]["reason"])

    def test_partial_exit_mirrors_leader(self):
        self.pm.trades = [trade(1)]
        self.advance()
        self.e.cycle()
        held = self.store.get_position("paper", SPREAD_TICKER, "yes")["contracts"]
        leader_shares = 5000 / 0.46
        self.pm.trades.append(trade(2, side="SELL", usd=2500))  # leader sells half
        self.pm.position_left = leader_shares - 2500 / 0.46
        self.advance()
        self.assertEqual(self.e.cycle()["signals"], {"exited": 1})
        left = self.store.get_position("paper", SPREAD_TICKER, "yes")["contracts"]
        self.assertEqual(left, held - (held + 1) // 2)

    def test_settlement_pays_out(self):
        self.pm.trades = [trade(1)]
        self.advance()
        self.e.cycle()
        pos = self.store.get_position("paper", SPREAD_TICKER, "yes")
        self.k.quotes[SPREAD_TICKER] = replace(self.k.quotes[SPREAD_TICKER], result="yes", status="finalized")
        self.advance()
        self.e.cycle()
        self.assertIsNone(self.store.get_position("paper", SPREAD_TICKER, "yes"))
        self.assertAlmostEqual(self.cash(), 1000 - pos["cost_basis"] + pos["contracts"], places=6)
        self.assertAlmostEqual(self.store.realized_pnl_total("paper"), pos["contracts"] - pos["cost_basis"], places=6)

    def test_kill_switch_file(self):
        self.s.stop_file.write_text("stop")
        self.pm.trades = [trade(1)]
        self.advance()
        self.e.cycle()
        self.assertEqual(self.store.recent_signals(1)[0]["status"], "halted")
        self.assertEqual(self.store.open_positions("paper"), [])

    def test_daily_loss_limit_halts_entries(self):
        self.store.x("UPDATE daily SET start_equity=2000")
        self.pm.trades = [trade(1)]
        self.advance()
        self.e.cycle()
        self.assertEqual(self.store.recent_signals(1)[0]["status"], "halted")

    def test_unmatched_market_goes_nowhere(self):
        self.pm.market_obj = pm("Will it snow in Miami on Christmas?", ["Yes", "No"])
        self.pm.trades = [trade(1, outcome="Yes")]
        self.advance()
        self.e.cycle()
        self.assertEqual(self.store.recent_signals(1)[0]["status"], "unmatched")
        self.assertEqual(self.store.q("SELECT * FROM orders"), [])

    def test_manual_map_blocks_market(self):
        self.s.market_map_path.write_text('[{"pm_condition_id": "0xcond", "pm_outcome_index": 0, "kalshi_ticker": null}]')
        self.e.load_manual_map()
        self.pm.trades = [trade(1)]
        self.advance()
        self.e.cycle()
        self.assertEqual(self.store.recent_signals(1)[0]["status"], "blocked")


if __name__ == "__main__":
    unittest.main()
