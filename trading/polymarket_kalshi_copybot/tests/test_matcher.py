import unittest
from datetime import datetime, timezone

from copybot.config import BOT_DIR
from copybot.matcher import MarketIndex, Matcher, TextNormalizer, build_proposition

from tests.helpers import NBA_EVENT, NOW, SPREAD_35, kalshi_universe, pm

NORM = TextNormalizer.from_file(BOT_DIR / "aliases.json")
MATCHER = Matcher(MarketIndex(kalshi_universe(), NORM))


def match(question, outcome, **kw):
    return MATCHER.match(pm(question, kw.pop("outcomes", ["Yes", "No"]), **kw), outcome, now=NOW)


class NormalizerTests(unittest.TestCase):
    def test_numbers_and_months(self):
        self.assertEqual(NORM.normalize("Bitcoin above $100,000 on November 10th?"), "bitcoin over 100000 on nov 10")
        self.assertIn("100000", NORM.tokens("BTC above 100k"))
        self.assertIn("1500000", NORM.tokens("1.5 million votes"))
        self.assertIn("3.5", NORM.tokens("Spread: Mavericks (-3.5)"))

    def test_league_scoped_aliases(self):
        self.assertEqual(NORM.normalize("Pacers vs. Mavericks", "nba"), "indiana vs dallas")
        self.assertEqual(NORM.normalize("Kings", "nba"), "sacramento")
        self.assertEqual(NORM.normalize("Kings", "nhl"), "los angeles")
        self.assertEqual(NORM.normalize("Kings"), "kings")  # no league -> untouched

    def test_totals_alias(self):
        self.assertIn("total", NORM.tokens("Pacers vs. Mavericks: O/U 229.5", "nba"))


class PropositionTests(unittest.TestCase):
    def test_yes_no(self):
        p = build_proposition(pm("Will X happen?", ["Yes", "No"]), "No", NORM)
        self.assertEqual((p.side, p.deterministic), ("no", True))

    def test_handicap_other_side_is_no_on_named_side(self):
        p = build_proposition(pm(**SPREAD_35), "Pacers", NORM)
        self.assertEqual(p.side, "no")
        self.assertTrue(p.deterministic)
        self.assertEqual(p.required, frozenset({"dalla"}))

    def test_integer_line_is_not_deterministic(self):
        p = build_proposition(pm("Spread: Mavericks (-3)", ["Mavericks", "Pacers"], event_slug=NBA_EVENT), "Pacers", NORM)
        self.assertFalse(p.deterministic)


class MatchTests(unittest.TestCase):
    def assertAuto(self, r, ticker, side):
        self.assertEqual(r.status, "auto", f"{r.status}: {r.reason} {[(c.ticker, c.score, c.gate_reason) for c in r.candidates[:4]]}")
        self.assertEqual((r.kalshi_ticker, r.kalshi_side), (ticker, side))

    def test_spread_favourite(self):
        self.assertAuto(MATCHER.match(pm(**SPREAD_35), "Mavericks", now=NOW),
                        "KXNBASPREAD-26NOV09INDDAL-DAL4", "yes")

    def test_spread_underdog_maps_to_no(self):
        self.assertAuto(MATCHER.match(pm(**SPREAD_35), "Pacers", now=NOW), "KXNBASPREAD-26NOV09INDDAL-DAL4", "no")

    def test_moneyline_picks_full_game_winner_not_spread_or_half(self):
        r = match("Pacers vs. Mavericks", "Mavericks", outcomes=["Pacers", "Mavericks"], event_slug=NBA_EVENT,
                  sports_type="moneyline")
        self.assertAuto(r, "KXNBAGAME-26NOV09INDDAL-DAL", "yes")

    def test_under_is_no_on_over(self):
        r = match("Pacers vs. Mavericks: O/U 229.5", "Under", outcomes=["Over", "Under"], event_slug=NBA_EVENT,
                  sports_type="totals")
        self.assertAuto(r, "KXNBATOTAL-26NOV09INDDAL-230", "no")

    def test_integer_spread_never_auto(self):
        r = match("Spread: Mavericks (-3)", "Pacers", outcomes=["Mavericks", "Pacers"], event_slug=NBA_EVENT,
                  sports_type="spreads")
        self.assertNotEqual(r.status, "auto")

    def test_president_not_vice_president(self):
        end = datetime(2028, 11, 7, tzinfo=timezone.utc)
        self.assertAuto(match("Will Ron DeSantis win the 2028 US Presidential Election?", "No", end=end),
                        "KXPRESPERSON-28-RDES", "no")

    def test_nomination_not_iowa_caucus(self):
        end = datetime(2028, 8, 20, tzinfo=timezone.utc)
        self.assertAuto(match("Will Ron DeSantis win the 2028 Republican presidential nomination?", "Yes", end=end),
                        "KXPRESNOMR-28-RDS", "yes")

    def test_polarity_trap_is_not_auto(self):
        end = datetime(2026, 12, 31, tzinfo=timezone.utc)
        r = match("Will Delcy Rodriguez be the leader of Venezuela end of 2026?", "No", end=end)
        self.assertNotEqual(r.status, "auto")

    def test_sibling_markets_resolved_by_label(self):
        end = datetime(2026, 11, 15, tzinfo=timezone.utc)
        self.assertAuto(match("Will Bilibili Gaming win Worlds 2026?", "Yes", end=end), "KXLOL-WORLDS26-BLG", "yes")

    def test_date_window_blocks_other_game(self):
        # Same teams, but the only NHL-like Dallas game is 10 days later -> must not auto-match.
        r = match("Stars vs. Avalanche", "Stars", outcomes=["Stars", "Avalanche"], event_slug="nhl-dal-col-2026-11-09")
        self.assertNotEqual(r.status, "auto")

    def test_unrelated_market_is_none(self):
        r = match("Will it snow in Miami on Christmas 2026?", "Yes", end=datetime(2026, 12, 25, tzinfo=timezone.utc))
        self.assertEqual(r.status, "none")


if __name__ == "__main__":
    unittest.main()
