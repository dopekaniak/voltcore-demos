import unittest

from copybot.config import Settings
from copybot.risk import RiskState, exit_limit, kalshi_taker_fee, plan_entry, sell_fraction


def state(**kw):
    base = dict(cash=1000.0, equity=1000.0, market_exposure=0.0, total_exposure=0.0, spend_today=0.0,
                open_positions=0, holds_this_market=False)
    base.update(kw)
    return RiskState(**base)


class RiskTests(unittest.TestCase):
    def setUp(self):
        self.s = Settings()  # defaults: $10 fixed, gap 0.03, max order $25, 1% risk

    def test_fee_formula(self):
        self.assertEqual(kalshi_taker_fee(10, 0.5), 0.18)  # ceil(0.07*10*0.25*100)/100
        self.assertEqual(kalshi_taker_fee(1, 0.99), 0.01)

    def test_rejects_when_kalshi_is_too_expensive(self):
        plan = plan_entry(self.s, leader_usd=5000, leader_price=0.40, kalshi_ask=0.45, state=state())
        self.assertFalse(plan.ok)
        self.assertIn("> limit 0.43", plan.reason)

    def test_fixed_sizing_never_exceeds_budget_with_fees(self):
        plan = plan_entry(self.s, leader_usd=5000, leader_price=0.40, kalshi_ask=0.41, state=state())
        self.assertTrue(plan.ok)
        self.assertEqual(plan.limit_price, 0.43)
        self.assertLessEqual(plan.contracts * (0.43 + kalshi_taker_fee(1, 0.43)), 10.0)
        self.assertEqual(plan.contracts, 22)

    def test_caps(self):
        p = plan_entry(self.s, leader_usd=5000, leader_price=0.5, kalshi_ask=0.5, state=state(spend_today=100))
        self.assertFalse(p.ok)
        self.assertIn("daily_spend_left", p.reason)
        p = plan_entry(self.s, leader_usd=5000, leader_price=0.5, kalshi_ask=0.5, state=state(equity=300))
        self.assertTrue(p.ok)
        self.assertEqual(p.budget_usd, 3.0)  # 1% of equity
        p = plan_entry(self.s, leader_usd=5000, leader_price=0.5, kalshi_ask=0.5, state=state(open_positions=15))
        self.assertFalse(p.ok)
        p = plan_entry(self.s, leader_usd=5000, leader_price=0.5, kalshi_ask=0.5,
                       state=state(market_exposure=49.5, holds_this_market=True))
        self.assertFalse(p.ok)

    def test_proportional(self):
        self.s.copy_sizing = "proportional"
        p = plan_entry(self.s, leader_usd=8000, leader_price=0.5, kalshi_ask=0.5, state=state())
        self.assertEqual(p.budget_usd, 8.0)

    def test_exit_helpers(self):
        self.assertEqual(sell_fraction(50, 50), 0.5)
        self.assertEqual(sell_fraction(50, 0), 1.0)
        self.assertAlmostEqual(exit_limit(0.40, 0.05), 0.35)
        self.assertEqual(exit_limit(0.03, 0.05), 0.01)
        self.assertIsNone(exit_limit(None, 0.05))

    def test_config_requires_explicit_live_confirmation(self):
        s = Settings(mode="live", kalshi_key_id="k", kalshi_private_key_path="/x")
        with self.assertRaises(ValueError):
            s.validate()
        s.live_confirm = "I_ACCEPT_REAL_MONEY_RISK"
        s.validate()


if __name__ == "__main__":
    unittest.main()
