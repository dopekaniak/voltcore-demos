import unittest
from datetime import datetime, timezone

from copybot.backtest import (Quote, build_signals, leader_sell_fractions, parse_candles, quote_at, simulate)
from copybot.config import Settings
from copybot.models import KalshiMarket, LeaderTrade, Signal

T = 1_800_000_000  # divisible by 60, so candle boundaries line up with the signal times


def market(result="yes", close=T + 3 * 3600):
    c = datetime.fromtimestamp(close, tz=timezone.utc)
    return KalshiMarket(ticker="KX-1", event_ticker="KX-1", series_ticker="KXT", event_title="Game",
                        title="A wins?", yes_sub_title="A", status="settled", close_time=c,
                        expected_expiration_time=c, result=result)


def candles(ask=0.41, bid=0.39, until=T + 3600):
    ends = [T + 60 * k for k in range(1, (until - T) // 60 + 1)]
    return {"KX-1": (ends, [Quote(ask, bid)] * len(ends))}


def buy(ts=T, price=0.40, usd=1000.0, side="BUY"):
    size = usd / price
    return Signal(wallet="0xw", leader_name="w", condition_id="0xc", token_id="tok", side=side, outcome="A",
                  outcome_index=0, price=price, size=size, usdc_size=usd, first_ts=ts, last_ts=ts, title="A wins",
                  slug="s", event_slug="e", trade_keys=["k"])


MAPPING = {("0xc", 0): {"status": "auto", "ticker": "KX-1", "side": "yes"}}


class CandleTests(unittest.TestCase):
    def test_quote_is_the_minute_containing_ts(self):
        series = parse_candles([
            {"end_period_ts": T + 60, "yes_ask": {"high_dollars": "0.50", "close_dollars": "0.49"},
             "yes_bid": {"low_dollars": "0.44", "close_dollars": "0.45"}},
            {"end_period_ts": T + 120, "yes_ask": {"high_dollars": "0.52"}, "yes_bid": {"low_dollars": "0.46"}},
        ])
        q = quote_at(series, T + 30)  # minute T..T+60
        self.assertEqual((q.yes_ask, q.yes_bid), (0.50, 0.44))
        self.assertAlmostEqual(q.ask_for("no"), 0.56)  # buying NO at 1 - the lowest yes bid
        self.assertAlmostEqual(q.bid_for("no"), 0.50)  # selling NO into 1 - the highest yes ask

    def test_missing_candle_gives_no_quote(self):
        self.assertIsNone(quote_at(([T + 60], [Quote(0.4, 0.3)]), T + 600))  # no candle covers T+600

    def test_empty_candle_gives_no_quote(self):
        series = parse_candles([{"end_period_ts": T + 60, "yes_ask": None, "yes_bid": None}])
        self.assertIsNone(quote_at(series, T + 30))


class SignalTests(unittest.TestCase):
    def trade(self, ts, size, usd):
        return LeaderTrade(wallet="0xw", leader_name="w", condition_id="0xc", token_id="tok", side="BUY",
                           outcome="A", outcome_index=0, price=usd / size, size=size, usdc_size=usd,
                           timestamp=ts, title="t", slug="s", event_slug="e", tx_hash=f"0x{ts}")

    def test_fills_in_one_minute_become_one_order(self):
        sigs = build_signals([self.trade(100, 10, 4), self.trade(110, 10, 6), self.trade(200, 5, 3)])
        self.assertEqual(len(sigs), 2)
        first = sigs[0]
        self.assertAlmostEqual(first.size, 20)
        self.assertAlmostEqual(first.usdc_size, 10)
        self.assertAlmostEqual(first.price, 0.5)

    def test_leader_sell_fraction_uses_in_window_shares(self):
        sigs = [buy(T, usd=200.0), buy(T + 60, usd=200.0, side="SELL")]  # holds 500 shares, sells 500 -> all
        self.assertEqual(leader_sell_fractions(sigs)[1], 1.0)
        sigs = [buy(T, price=0.5, usd=50.0), buy(T + 60, price=0.5, usd=25.0, side="SELL")]  # 100 held, 50 sold
        self.assertAlmostEqual(leader_sell_fractions(sigs)[1], 0.5)


class SimulationTests(unittest.TestCase):
    def setUp(self):
        self.s = Settings()  # defaults: $10 per copy, 3% price gap, 1000 starting balance

    def test_entry_then_settlement_pnl(self):
        res = simulate(self.s, [buy()], {}, MAPPING, {"KX-1": market("yes")}, candles(), 60)
        self.assertEqual(res.stats["entries"], 1)
        self.assertEqual(len(res.closed), 1)
        c = res.closed[0]
        # 22 contracts at 0.41 + 0.372526 fee = $9.392526 cost; they pay $1 each on a yes result.
        self.assertAlmostEqual(c["invested"], 9.392526, places=6)
        self.assertAlmostEqual(c["pnl"], 12.607474, places=6)
        self.assertEqual(c["how"], "settled")

    def test_losing_side_settles_to_zero(self):
        res = simulate(self.s, [buy()], {}, MAPPING, {"KX-1": market("no")}, candles(), 60)
        self.assertAlmostEqual(res.closed[0]["pnl"], -9.392526, places=6)

    def test_price_gap_blocks_entry(self):
        res = simulate(self.s, [buy()], {}, MAPPING, {"KX-1": market("yes")}, candles(ask=0.60), 60)
        self.assertEqual(res.stats["entries"], 0)
        self.assertEqual(res.stats["skip_price_gap"], 1)

    def test_unmatched_and_small_orders_are_skipped(self):
        res = simulate(self.s, [buy()], {}, {}, {"KX-1": market()}, candles(), 60)
        self.assertEqual(res.stats["entries"], 0)
        res = simulate(self.s, [buy(usd=100.0)], {}, MAPPING, {"KX-1": market()}, candles(), 60)
        self.assertEqual(res.stats["skip_small"], 1)

    def test_leader_exit_sells_at_bid(self):
        sigs = [buy(T), buy(T + 600, side="SELL")]
        res = simulate(self.s, sigs, leader_sell_fractions(sigs), MAPPING, {"KX-1": market("yes")}, candles(), 60)
        self.assertEqual(res.stats["exits"], 1)
        self.assertEqual(len(res.closed), 1)
        self.assertEqual(res.closed[0]["how"], "exited")
        # 22 sold at 0.39 less a 0.366366 fee = $8.213634 back, against $9.392526 cost.
        self.assertAlmostEqual(res.closed[0]["pnl"], -1.178892, places=6)

    def test_settles_at_close_before_later_signals(self):
        later = buy(T + 4 * 3600)  # after the market closed: the first position must already be settled
        res = simulate(self.s, [buy(), later], {}, MAPPING, {"KX-1": market("yes")},
                       candles(until=T + 4 * 3600 + 3600), 60)
        self.assertGreaterEqual(res.stats["settled"], 1)


if __name__ == "__main__":
    unittest.main()
