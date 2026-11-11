"""Map a Polymarket position (market + outcome) onto a Kalshi market + side.

Pipeline:
  1. Normalize both venues' text (numbers, months, aliases such as team nicknames -> Kalshi city labels).
  2. Turn the Polymarket outcome into a *proposition* plus the Kalshi side that expresses it
     (e.g. buying "Under" on "O/U 229.5" == buying NO on Kalshi "Over 229.5 points").
  3. Pull candidates from an inverted index over ~170k open Kalshi markets, score them with
     IDF-weighted token overlap and date proximity.
  4. Apply hard safety gates (date window, every line/threshold number must agree, the outcome must be
     named on the Kalshi YES side). Only a clear, unambiguous winner is auto-traded; anything else goes
     to the review queue or the optional LLM check.
"""

from __future__ import annotations

import json
import math
import re
import sys
import unicodedata
from array import array
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Iterable, Optional

from .models import Candidate, KalshiMarket, MatchResult, PMMarket

STOPWORDS = frozenset(
    "will the a an of in on at to be is are for and by with vs v versus this that who what which "
    "does do than it its as or from".split()
)
MONTHS = {
    "january": "jan", "february": "feb", "march": "mar", "april": "apr", "june": "jun",
    "july": "jul", "august": "aug", "september": "sep", "sept": "sep", "october": "oct",
    "november": "nov", "december": "dec",
}
MONTH_ABBR = ["", "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
# Words that change what a market pays on (VP vs President, Iowa caucus vs nomination, conference vs league
# title, first half vs full game, 5pm EST close vs any time). When one venue uses such a word and the other does
# not, the score is cut hard, so look-alike markets cannot clear the auto threshold. (Tokens are post-stem.)
CRITICAL = frozenset(
    "vice deputy primary caucus nominee western eastern conference division runner mention say announce announced "
    "approval turnout margin popular trimmed average pm am est edt first second third half quarter period "
    "inning overtime regulation halve map hit low high record combo parlay between exactly officially facto "
    "leave out remain stay resign removed fired impeached lose not no end coding pareto".split()
)
CRITICAL_PENALTY = 0.8
NEAR_DATE_REVIEW_DAYS = 90

_ORDINAL_RE = re.compile(r"\b(\d+)(?:st|nd|rd|th)\b")
_NUM_RE = re.compile(
    r"(?<![\w.])\$?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:(k|m|bn|b)\b|\s+(thousand|million|billion)\b)?"
)
_MULT = {"k": 1_000, "thousand": 1_000, "m": 1_000_000, "million": 1_000_000,
         "b": 1_000_000_000, "bn": 1_000_000_000, "billion": 1_000_000_000}
_NUMBER_TOKEN = re.compile(r"\d+(?:\.\d+)?")
_HALF_LINE = re.compile(r"\b\d+\.5\b")

# contain: share of the Polymarket proposition found on Kalshi; precision: share of the Kalshi text explained;
# label: share of the Kalshi YES label found in the proposition (separates sibling markets of one event);
# date: closeness of expiry dates.
W_CONTAIN, W_PRECISION, W_LABEL, W_DATE = 0.55, 0.15, 0.15, 0.15


def _fmt_decimal(value: Decimal) -> str:
    if value == value.to_integral_value():
        return str(int(value))
    return format(value.normalize(), "f")


def _canon_number(match: re.Match) -> str:
    whole = match.group(1).replace(",", "")
    frac = match.group(2) or ""
    mult = _MULT.get(match.group(3) or match.group(4) or "", 1)
    try:
        value = Decimal(whole + frac) * mult
    except InvalidOperation:
        return match.group(0)
    return f" {_fmt_decimal(value)} "


def _stem(token: str) -> str:
    if token.isalpha() and len(token) > 3 and token.endswith("s") and not token.endswith(("ss", "us", "is")):
        return token[:-1]
    return token


def is_number(token: str) -> bool:
    return bool(_NUMBER_TOKEN.fullmatch(token))


def is_year(token: str) -> bool:
    return token.isdigit() and 2000 <= int(token) <= 2100


def is_significant_number(token: str) -> bool:
    """Lines, thresholds, prices and years. Small integers (days, counts) are only soft signals."""
    return is_number(token) and ("." in token or float(token) >= 100)


def league_for_pm(slug: str) -> Optional[str]:
    prefix = (slug or "").split("-", 1)[0].lower()
    return prefix if prefix in ("nba", "nfl", "nhl", "mlb") else None


def league_for_kalshi(series_ticker: str) -> Optional[str]:
    s = (series_ticker or "").upper()
    for league in ("NBA", "NFL", "NHL", "MLB"):
        if s.startswith("KX" + league) or s.startswith(league):
            return league.lower()
    return None


class TextNormalizer:
    def __init__(self, aliases: Optional[dict] = None):
        aliases = aliases or {}
        self._maps = {}
        for group, mapping in aliases.items():
            if group.startswith("_") or not isinstance(mapping, dict):
                continue
            norm_map = {}
            for key, value in mapping.items():
                k = self._base(key).strip()
                if k:
                    norm_map[k] = self._base(value).strip()
            if norm_map:
                keys = sorted(norm_map, key=len, reverse=True)
                pattern = re.compile(r"\b(?:" + "|".join(re.escape(k) for k in keys) + r")\b")
                self._maps[group] = (pattern, norm_map)

    @classmethod
    def from_file(cls, path: Path) -> "TextNormalizer":
        if path and Path(path).exists():
            return cls(json.loads(Path(path).read_text()))
        return cls({})

    @staticmethod
    def _base(text: str) -> str:
        text = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode()
        text = text.lower().replace("&", " and ").replace("'", "").replace("’", "")
        text = _ORDINAL_RE.sub(r"\1", text)
        text = _NUM_RE.sub(_canon_number, text)
        text = re.sub(r"[^a-z0-9.\s]", " ", text)
        text = re.sub(r"(?<!\d)\.|\.(?!\d)", " ", text)
        words = [MONTHS.get(w, w) for w in text.split()]
        return " ".join(words)

    def normalize(self, text: str, league: Optional[str] = None) -> str:
        out = f" {self._base(text)} "
        for group in ([league] if league else []) + ["global"]:
            entry = self._maps.get(group)
            if entry:
                pattern, mapping = entry
                out = pattern.sub(lambda m: mapping[m.group(0)], out)
        return out.strip()

    def tokens(self, text: str, league: Optional[str] = None) -> list:
        return [
            sys.intern(_stem(t))
            for t in self.normalize(text, league).split()
            if t not in STOPWORDS
        ]


@dataclass
class Proposition:
    text: str
    side: str  # Kalshi side ("yes"/"no") on a market whose YES expresses `text`
    required: frozenset  # tokens that must appear on the Kalshi YES label
    deterministic: bool
    note: str = ""


def build_proposition(pm: PMMarket, outcome: str, norm: TextNormalizer) -> Optional[Proposition]:
    league = league_for_pm(pm.event_slug or pm.slug)
    label = (outcome or "").strip()
    low = label.lower()
    question = pm.question or ""
    half_line = bool(_HALF_LINE.search(question))
    has_number = bool(re.search(r"\d", question))

    if low in ("yes", "no"):
        return Proposition(question, "yes" if low == "yes" else "no", frozenset(), True)

    if low in ("over", "under"):
        return Proposition(
            f"{question} over", "yes" if low == "over" else "no", frozenset({"over"}),
            deterministic=half_line, note="" if half_line else "integer total line can push",
        )

    q_tokens = set(norm.tokens(question, league))
    o_tokens = frozenset(norm.tokens(label, league))
    if not o_tokens:
        return None
    if o_tokens <= q_tokens:
        return Proposition(f"{question} {label}", "yes", o_tokens, True)

    others = [o for o in pm.outcomes if str(o).strip().lower() != low]
    if len(pm.outcomes) == 2 and len(others) == 1:
        other_tokens = frozenset(norm.tokens(str(others[0]), league))
        if other_tokens and other_tokens <= q_tokens:
            # Handicap style: "Spread: Mavericks (-3.5)" and we hold the *other* team -> NO on the named side.
            det = half_line if has_number else False
            note = "opposite of the side named in the question"
            if not det:
                note += "; no half-point line, push/draw possible"
            return Proposition(f"{question} {others[0]}", "no", other_tokens, det, note)

    return Proposition(f"{question} {label}", "yes", o_tokens, False, "outcome not named in question")


def _date_tokens(dt: Optional[datetime]) -> set:
    if not dt:
        return set()
    out = set()
    for d in (dt, dt - timedelta(days=1)):
        out.update({str(d.year), MONTH_ABBR[d.month], str(d.month), str(d.day)})
    return out


class MarketIndex:
    """Inverted index over the open Kalshi market universe."""

    def __init__(self, markets: list, norm: TextNormalizer):
        self.markets = markets
        self.norm = norm
        self.tokens: list = []
        postings: dict = defaultdict(lambda: array("I"))
        df: Counter = Counter()
        for i, m in enumerate(markets):
            toks = tuple(set(norm.tokens(f"{m.event_title} {m.title} {m.yes_sub_title}",
                                         league_for_kalshi(m.series_ticker))))
            self.tokens.append(toks)
            for t in toks:
                postings[t].append(i)
                df[t] += 1
        self.postings = dict(postings)
        n = max(len(markets), 1)
        self.n = n
        self.idf = {t: math.log((n + 1) / (c + 1)) + 1.0 for t, c in df.items()}
        self.max_idf = math.log(n + 1) + 1.0

    def idf_of(self, token: str) -> float:
        return self.idf.get(token, self.max_idf)

    def candidate_ids(self, query_tokens: Iterable[str], limit: int = 1000) -> list:
        toks = [t for t in set(query_tokens) if t in self.postings]
        if not toks:
            return []
        cap = max(2000, int(self.n * 0.02))
        selective = [t for t in toks if len(self.postings[t]) <= cap]
        if not selective:  # everything is common; fall back to the two rarest tokens
            selective = sorted(toks, key=lambda t: len(self.postings[t]))[:2]
        scores: dict = defaultdict(float)
        for t in selective:
            w = self.idf_of(t)
            for i in self.postings[t]:
                scores[i] += w
        # A single game can have hundreds of player-prop markets sharing its title; on ties prefer the
        # market with the fewest extra words so the plain game/spread/total markets are never crowded out.
        return sorted(scores, key=lambda i: (-scores[i], len(self.tokens[i])))[:limit]


class Matcher:
    def __init__(self, index: MarketIndex, auto_threshold: float = 0.80, review_threshold: float = 0.65,
                 max_date_diff_days: float = 0.5, sports_date_diff_days: float = 1.5,
                 ambiguity_margin: float = 0.02):
        self.index = index
        self.norm = index.norm
        self.auto_threshold = auto_threshold
        self.review_threshold = review_threshold
        self.max_date_diff_days = max_date_diff_days
        self.sports_date_diff_days = sports_date_diff_days
        self.ambiguity_margin = ambiguity_margin

    def _allowed_days(self, pm: PMMarket, now: datetime) -> float:
        if pm.sports_market_type or league_for_pm(pm.event_slug or pm.slug):
            return self.sports_date_diff_days
        # Non-sports deadlines must agree within a fraction of a day: "by Nov 13" and "before Nov 13" differ by one.
        return self.max_date_diff_days

    def match(self, pm: PMMarket, outcome: str, now: Optional[datetime] = None) -> MatchResult:
        now = now or datetime.now(timezone.utc)
        prop = build_proposition(pm, outcome, self.norm)
        if prop is None:
            return MatchResult("none", reason="could not interpret outcome")

        league = league_for_pm(pm.event_slug or pm.slug)
        pm_tokens = set(self.norm.tokens(prop.text, league))
        if not pm_tokens:
            return MatchResult("none", reason="empty proposition")
        pm_sig = {t for t in pm_tokens if is_significant_number(t)}
        pm_small = {t for t in pm_tokens if is_number(t) and not is_significant_number(t)}
        pm_numbers_all = {t for t in pm_tokens if is_number(t)} | _date_tokens(pm.end_date)
        pm_critical = pm_tokens & CRITICAL
        # Nicknames Kalshi never uses (e.g. college mascots) cannot be required on its YES label.
        required = frozenset(t for t in prop.required if t in self.index.idf) or prop.required
        w_pm = sum(self.index.idf_of(t) for t in pm_tokens)
        allowed_days = self._allowed_days(pm, now)

        scored: list = []
        for i in self.index.candidate_ids(pm_tokens):
            m: KalshiMarket = self.index.markets[i]
            k_tokens = set(self.index.tokens[i])
            shared = pm_tokens & k_tokens
            if not shared:
                continue
            w_k = sum(self.index.idf_of(t) for t in k_tokens) or 1.0
            w_s = sum(self.index.idf_of(t) for t in shared)
            contain, precision = w_s / w_pm, w_s / w_k
            kleague = league_for_kalshi(m.series_ticker)
            label_tokens = set(self.norm.tokens(m.yes_sub_title or m.title, kleague))
            w_label = sum(self.index.idf_of(t) for t in label_tokens)
            label = (sum(self.index.idf_of(t) for t in label_tokens & pm_tokens) / w_label) if w_label else 0.0

            k_dates = [d for d in (m.expected_expiration_time, m.close_time) if d]
            if pm.end_date and k_dates:
                diff = min(abs((pm.end_date - d).total_seconds()) / 86400 for d in k_dates)
                date_score = max(0.0, 1.0 - diff / allowed_days) if allowed_days else 0.0
            else:
                diff, date_score = None, 0.5

            score = W_CONTAIN * contain + W_PRECISION * precision + W_LABEL * label + W_DATE * date_score
            k_numbers = k_tokens | set().union(*(_date_tokens(d) for d in k_dates)) if k_dates else k_tokens
            score *= 0.85 ** len(pm_small - k_numbers)
            score *= CRITICAL_PENALTY ** min(len(pm_critical ^ (k_tokens & CRITICAL)), 3)

            market_tokens = set(self.norm.tokens(f"{m.title} {m.yes_sub_title}", kleague))
            failures = self._gates(required, pm_sig, pm_numbers_all, k_numbers, market_tokens, label_tokens,
                                   diff, allowed_days)
            near_date = (len(failures) == 1 and failures[0].startswith("date")
                         and diff is not None and diff <= NEAR_DATE_REVIEW_DAYS)
            scored.append(Candidate(m.ticker, prop.side, round(score, 4),
                                    f"{m.event_title} | {m.title} | YES={m.yes_sub_title}",
                                    not failures, "; ".join(failures), near_date))

        scored.sort(key=lambda c: c.score, reverse=True)
        top = scored[:8]
        passing = [c for c in scored if c.passed_gates]
        if not passing:
            near = [c for c in scored if c.near_date and c.score >= self.review_threshold]
            if near and prop.deterministic:
                return MatchResult("review", near[0].ticker, near[0].side, near[0].score,
                                   f"expiry differs ({near[0].gate_reason}); check the rules", top)
            status = "needs_llm" if (not prop.deterministic and top) else "none"
            reason = top[0].gate_reason if top else "no Kalshi candidates share any terms"
            return MatchResult(status, score=top[0].score if top else 0.0, reason=reason, candidates=top)

        best = passing[0]
        result = MatchResult("none", best.ticker, best.side, best.score, "", top)
        ambiguous = len(passing) > 1 and best.score - passing[1].score < self.ambiguity_margin
        if not prop.deterministic:
            result.status, result.reason = "needs_llm", prop.note
        elif best.score >= self.auto_threshold and not ambiguous:
            result.status, result.reason = "auto", prop.note or "clear match"
        elif best.score >= self.review_threshold:
            result.status = "review"
            result.reason = (f"ambiguous with {passing[1].ticker} ({passing[1].score:.2f})" if ambiguous
                             else f"score {best.score:.2f} below auto threshold {self.auto_threshold:.2f}")
        else:
            result.reason = f"best score {best.score:.2f} below review threshold"
        return result

    @staticmethod
    def _gates(required: frozenset, pm_sig: set, pm_numbers_all: set, k_numbers: set, market_tokens: set,
               label_tokens: set, diff: Optional[float], allowed_days: float) -> list:
        failures = []
        if diff is not None and diff > allowed_days:
            failures.append(f"date mismatch ({diff:.1f}d > {allowed_days:.1f}d)")
        missing = pm_sig - k_numbers
        if missing:
            failures.append(f"Kalshi lacks number(s) {sorted(missing)}")
        extra = {t for t in market_tokens if is_significant_number(t) and not is_year(t)} - pm_numbers_all
        if extra:
            failures.append(f"Kalshi market has extra line(s) {sorted(extra)}")
        if required and not required <= label_tokens:
            failures.append("outcome not on Kalshi YES label")
        return failures
