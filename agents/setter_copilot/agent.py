"""Setter Copilot agent.

Feeds on your lead-generator export (business name, phone, city, rating, reviews,
website - column names are matched loosely). It:
  - ranks leads by how likely they are to need the offer and pick up,
  - builds today's queue (new leads + follow-ups that are due),
  - walks you through each call with the script and objection comebacks,
  - logs every dial so your REAL connect and booking rates can recalibrate the backtest.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

from agents.common.compliance import SuppressionList, normalize_phone
from agents.common.storage import append_row, pick, read_rows
from agents.setter_copilot.pitches import render

TRADE_WORDS = ("hvac", "heating", "cooling", "air", "plumb", "roof", "electric", "solar", "furnace", "mechanical")
LOG_FIELDS = ["ts", "lead_id", "business", "phone", "outcome", "notes", "follow_up_on"]
# key -> (outcome, counts as a live conversation with the decision maker)
OUTCOME_KEYS = {
    "n": ("no_answer", False), "v": ("voicemail", False), "g": ("gatekeeper", False),
    "c": ("not_interested", True), "f": ("follow_up", True), "m": ("meeting_booked", True),
    "x": ("do_not_call", True), "w": ("wrong_number", False),
}
RETRY_DAYS = [2, 5, 10]  # follow-up cadence for no answer / voicemail / gatekeeper


@dataclass
class Prospect:
    lead_id: str
    business: str
    owner: str
    phone: str
    city: str
    rating: float
    reviews: int
    has_website: bool
    category: str
    score: float = 0.0
    why: str = ""


def _num(raw: str, cast, default):
    try:
        return cast(raw.replace(",", "")) if raw else default
    except ValueError:
        return default


def load_prospects(path: str | Path) -> list[Prospect]:
    out = []
    for i, row in enumerate(read_rows(path), start=1):
        website = pick(row, "website", "site", "url", "web")
        out.append(Prospect(
            lead_id=pick(row, "id", "lead_id", "place_id", default=f"L{i:04d}"),
            business=pick(row, "business", "business_name", "name", "title", "company"),
            owner=pick(row, "owner", "owner_name", "contact", "contact_name", default="the owner"),
            phone=pick(row, "phone", "phone_number", "phone number", "tel"),
            city=pick(row, "city", "town", "locality", "address", default="your area"),
            rating=_num(pick(row, "rating", "stars", "google_rating"), float, 0.0),
            reviews=_num(pick(row, "reviews", "review_count", "reviews_count", "user_ratings_total"), int, 0),
            has_website=bool(website) and website.lower() not in ("none", "n/a", "no", "false", "0"),
            category=pick(row, "category", "type", "industry", "categories", default=""),
        ))
    return out


def score(p: Prospect) -> Prospect:
    """Busy-but-small trades shops first: they have the problem and the owner answers."""
    s, why = 1.0, []
    if 15 <= p.reviews <= 150:
        s *= 1.5; why.append(f"{p.reviews} reviews - busy, owner-run")
    elif p.reviews > 150:
        s *= 1.1; why.append(f"{p.reviews} reviews - bigger shop, may hit an office manager")
    elif p.reviews < 5:
        s *= 0.6; why.append("few reviews - may be too small to pay")
    if not p.has_website:
        s *= 1.2; why.append("no website - likely no follow-up system")
    if any(w in (p.category + " " + p.business).lower() for w in TRADE_WORDS):
        s *= 1.2; why.append("core trade")
    if 0 < p.rating < 4.0:
        s *= 0.9; why.append(f"{p.rating}★ - reputation issues")
    p.score, p.why = round(s, 3), "; ".join(why)
    return p


class Copilot:
    def __init__(self, leads_csv: str | Path, data_dir: str | Path, pack: dict, me: str = "Alex"):
        self.data_dir = Path(data_dir)
        self.log_path = self.data_dir / "call_log.csv"
        self.suppression = SuppressionList(self.data_dir / "suppression.json")
        self.pack, self.me = pack, me
        self.prospects = {}
        for p in load_prospects(leads_csv):
            phone = normalize_phone(p.phone)
            if phone and phone not in self.suppression:
                p.phone = phone
                self.prospects[p.lead_id] = score(p)

    def history(self) -> list[dict]:
        return read_rows(self.log_path) if self.log_path.exists() else []

    def queue(self, today: date | None = None) -> list[Prospect]:
        """Due follow-ups first, then never-called leads by score. Finished leads drop out."""
        today = today or date.today()
        last: dict[str, dict] = {}
        attempts: dict[str, int] = {}
        for row in self.history():
            last[row["lead_id"]] = row
            attempts[row["lead_id"]] = attempts.get(row["lead_id"], 0) + 1
        due, fresh = [], []
        for lid, p in self.prospects.items():
            row = last.get(lid)
            if row is None:
                fresh.append(p)
            elif row["follow_up_on"] and date.fromisoformat(row["follow_up_on"]) <= today:
                due.append(p)
        return due + sorted(fresh, key=lambda p: p.score, reverse=True)

    def script(self, p: Prospect) -> dict[str, str]:
        known = p.owner != "the owner"
        fields = {"owner": p.owner, "business": p.business, "city": p.city, "me": self.me,
                  "reviews": str(p.reviews), "pricing": self.pack.get("pricing", "")}

        def fill(text: str) -> str:
            if not known:  # no owner name in the lead list: ask for the owner, greet generically
                text = text.replace("is this {owner}", "is this the owner").replace("{owner}", "there")
            return render(text, **fields)

        out = {k: fill(self.pack[k]) for k in ("opener", "question", "value", "ask", "voicemail")}
        out["objections"] = {k: fill(v) for k, v in self.pack["objections"].items()}
        return out

    def log(self, p: Prospect, key: str, notes: str = "", today: date | None = None) -> str:
        outcome, _ = OUTCOME_KEYS[key]
        today = today or date.today()
        prior = sum(1 for r in self.history() if r["lead_id"] == p.lead_id)
        follow_up = ""
        if outcome in ("no_answer", "voicemail", "gatekeeper") and prior < len(RETRY_DAYS):
            follow_up = (today + timedelta(days=RETRY_DAYS[prior])).isoformat()
        elif outcome == "follow_up":
            follow_up = (today + timedelta(days=3)).isoformat()
        if outcome == "do_not_call":
            self.suppression.add(p.phone)
        append_row(self.log_path, {
            "ts": datetime.now().isoformat(timespec="seconds"), "lead_id": p.lead_id, "business": p.business,
            "phone": p.phone, "outcome": outcome, "notes": notes, "follow_up_on": follow_up,
        }, LOG_FIELDS)
        return outcome

    def funnel(self) -> dict:
        rows = self.history()
        dials = len(rows)
        convos = sum(1 for r in rows if r["outcome"] in ("not_interested", "follow_up", "meeting_booked", "do_not_call"))
        meetings = sum(1 for r in rows if r["outcome"] == "meeting_booked")
        return {
            "dials": dials, "conversations": convos, "meetings": meetings,
            "connect_rate": round(convos / dials, 3) if dials else None,
            "meeting_per_conversation": round(meetings / convos, 3) if convos else None,
        }
