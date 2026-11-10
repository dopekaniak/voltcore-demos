"""Synthetic Polymarket/Kalshi fixtures modelled on real API responses (Nov 2026)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from copybot.models import KalshiMarket, PMMarket

NOW = datetime(2026, 11, 9, 23, 0, tzinfo=timezone.utc)
GAME = datetime(2026, 11, 10, 1, 0, tzinfo=timezone.utc)
GAME_END = GAME + timedelta(hours=2)


def km(ticker, event_title, title, yes_sub, series, close=None, exp=None, bid=0.45, ask=0.47, size=500.0):
    return KalshiMarket(
        ticker=ticker, event_ticker=ticker.rsplit("-", 1)[0], series_ticker=series, event_title=event_title,
        title=title, yes_sub_title=yes_sub, status="active", close_time=close or GAME_END + timedelta(days=2),
        expected_expiration_time=exp or GAME_END, yes_bid=bid, yes_ask=ask, yes_bid_size=size, yes_ask_size=size,
    )


def kalshi_universe() -> list:
    ev = "KXNBASPREAD-26NOV09INDDAL"
    pres_close = datetime(2028, 11, 8, tzinfo=timezone.utc)
    return [
        # NBA game: moneyline, spreads, first-half spread, totals
        km("KXNBAGAME-26NOV09INDDAL-DAL", "Indiana vs Dallas", "Indiana vs Dallas Winner?", "Dallas", "KXNBAGAME"),
        km("KXNBAGAME-26NOV09INDDAL-IND", "Indiana vs Dallas", "Indiana vs Dallas Winner?", "Indiana", "KXNBAGAME"),
        km(f"{ev}-DAL3", "Indiana vs Dallas: Spread", "Dallas wins by over 2.5 points?",
           "Dallas wins by over 2.5 points", "KXNBASPREAD"),
        km(f"{ev}-DAL4", "Indiana vs Dallas: Spread", "Dallas wins by over 3.5 points?",
           "Dallas wins by over 3.5 points", "KXNBASPREAD"),
        km(f"{ev}-DAL3INT", "Indiana vs Dallas: Spread", "Dallas wins by over 3 points?",
           "Dallas wins by over 3 points", "KXNBASPREAD"),
        km("KXNBA1HSPREAD-26NOV09INDDAL-DAL4", "Indiana vs Dallas: First Half Spread",
           "Dallas wins first half by over 3.5 points?", "Dallas wins first half by over 3.5 points", "KXNBA1HSPREAD"),
        km("KXNBATOTAL-26NOV09INDDAL-230", "Indiana vs Dallas: Total Points", "Full Game: Over 229.5 points scored",
           "Over 229.5 points", "KXNBATOTAL"),
        km("KXNBATOTAL-26NOV09INDDAL-231", "Indiana vs Dallas: Total Points", "Full Game: Over 230.5 points scored",
           "Over 230.5 points", "KXNBATOTAL"),
        # Same teams, different sport/date noise
        km("KXNHLGAME-26NOV20DALCOL-DAL", "Dallas vs Colorado", "Dallas vs Colorado Winner?", "Dallas", "KXNHLGAME",
           exp=GAME_END + timedelta(days=10), close=GAME_END + timedelta(days=12)),
        # Politics: President vs Vice President vs nominee vs Iowa caucus
        km("KXPRESPERSON-28-RDES", "2028 U.S. Presidential Election winner",
           "Who will win the 2028 United States presidential election?", "Ron DeSantis", "KXPRESPERSON",
           close=pres_close, exp=pres_close),
        km("KXVPRESPERSON-29-RDES", "2028 U.S. Vice-Presidential Election winner",
           "Who will win the 2028 United States vice presidential election?", "Ron DeSantis", "KXVPRESPERSON",
           close=pres_close, exp=pres_close),
        km("KXPRESNOMR-28-RDS", "2028 Republican presidential nominee",
           "Will Ron DeSantis be the nominee for the Presidency for the Republican party?", "Ron DeSantis",
           "KXPRESNOMR", close=datetime(2028, 8, 20, tzinfo=timezone.utc), exp=datetime(2028, 8, 20, tzinfo=timezone.utc)),
        km("KXRPRESPRIMARY-28IA-RDES", "Iowa Republican presidential caucus winner?",
           "Will Ron DeSantis win the 2028 Iowa Republican caucus?", "Ron DeSantis", "KXRPRESPRIMARY",
           close=datetime(2028, 1, 20, tzinfo=timezone.utc), exp=datetime(2028, 1, 20, tzinfo=timezone.utc)),
        # Polarity trap: "leave office" vs "be the leader"
        km("KXLEADERSOUT-27JAN01-DROD", "Which leaders will leave office in 2026?",
           "Will Delcy Rodriguez leave office as leader of Venezuela before 2027?", "Delcy Rodriguez",
           "KXLEADERSOUT", close=datetime(2027, 1, 1, tzinfo=timezone.utc), exp=datetime(2027, 1, 1, tzinfo=timezone.utc)),
        # Esports future with clean Yes/No
        km("KXLOL-WORLDS26-GEN", "Worlds 2026 Champion", "Will Gen.G win League of Legends Worlds?", "Gen.G",
           "KXLOL", close=datetime(2026, 11, 15, tzinfo=timezone.utc), exp=datetime(2026, 11, 15, tzinfo=timezone.utc)),
        km("KXLOL-WORLDS26-BLG", "Worlds 2026 Champion", "Will Bilibili Gaming win League of Legends Worlds?",
           "Bilibili Gaming", "KXLOL", close=datetime(2026, 11, 15, tzinfo=timezone.utc),
           exp=datetime(2026, 11, 15, tzinfo=timezone.utc)),
    ]


def pm(question, outcomes, slug="", event_slug="", end=GAME, sports_type=""):
    return PMMarket(condition_id="0x" + str(abs(hash(question)))[:16].ljust(16, "0"), question=question,
                    slug=slug, outcomes=outcomes, end_date=end, event_slug=event_slug,
                    sports_market_type=sports_type)


NBA_EVENT = "nba-ind-dal-2026-11-09"
SPREAD_35 = dict(question="Spread: Mavericks (-3.5)", outcomes=["Mavericks", "Pacers"],
                 slug="nba-ind-dal-2026-11-09-spread-home-3pt5", event_slug=NBA_EVENT, sports_type="spreads")
