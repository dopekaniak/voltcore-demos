"""Estimate Revival agent.

Pipeline:
  1. prioritize  - clean a contractor's estimate export, drop anything we must not
                   call, rank the rest by expected value, and write a call sheet
                   with a personalized script per customer.
  2. log         - record each call outcome; opt-outs go straight to the
                   suppression list.
  3. report      - match closed jobs to the leads you booked and produce the
                   performance invoice (default 10% of revived revenue).
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path

from agents.common import llm
from agents.common.compliance import SuppressionList, normalize_phone
from agents.common.storage import append_row, pick, read_rows, write_rows

EXCLUDED_STATUSES = ("won", "sold", "approved", "completed", "do not contact", "dnc", "lost to competitor")
OUTCOMES = ("booked", "callback", "already_done", "not_interested", "no_answer", "voicemail", "wrong_number", "opt_out")
OUTCOME_FIELDS = ["ts", "lead_id", "outcome", "notes"]

COOLING_WORDS = ("ac", "a/c", "air condition", "cooling", "condenser", "heat pump", "mini split", "mini-split")
HEATING_WORDS = ("furnace", "boiler", "heating", "heater", "heat exchanger")
ROOF_WORDS = ("roof", "shingle", "gutter")


@dataclass
class Business:
    name: str
    caller: str
    offer: str = "a free re-check visit so the numbers are current"
    fee_rate: float = 0.10


@dataclass
class Lead:
    lead_id: str
    customer: str
    phone: str
    job_type: str
    amount: float
    estimate_date: date | None
    status: str
    sms_consent: bool
    score: float = 0.0
    reasons: list[str] = field(default_factory=list)

    @property
    def first_name(self) -> str:
        return self.customer.split()[0].title() if self.customer else "there"


def _parse_date(raw: str) -> date | None:
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d", "%d-%b-%Y"):
        try:
            return datetime.strptime(raw.strip(), fmt).date()
        except ValueError:
            continue
    return None


def _parse_amount(raw: str) -> float:
    try:
        return float(raw.replace("$", "").replace(",", "").strip() or 0)
    except ValueError:
        return 0.0


def load_leads(path: str | Path) -> list[Lead]:
    leads = []
    for i, row in enumerate(read_rows(path), start=1):
        leads.append(Lead(
            lead_id=pick(row, "id", "estimate_id", "estimate #", "lead_id", default=f"E{i:04d}"),
            customer=pick(row, "customer", "customer_name", "name", "client"),
            phone=pick(row, "phone", "phone_number", "mobile", "cell"),
            job_type=pick(row, "job_type", "job", "service", "description", "item", default="service"),
            amount=_parse_amount(pick(row, "amount", "total", "estimate_total", "price", default="0")),
            estimate_date=_parse_date(pick(row, "estimate_date", "date", "created", "created_at")),
            status=pick(row, "status", "estimate_status", default="open").lower(),
            sms_consent=pick(row, "sms_consent", "text_ok", "consent").lower() in ("yes", "y", "true", "1"),
        ))
    return leads


def _mentions(text: str, words: tuple[str, ...]) -> bool:
    # Whole-word match so "ac" doesn't fire on "replacement".
    return any(re.search(rf"(?<![a-z]){re.escape(w)}(?![a-z])", text) for w in words)


def _season_fit(job_type: str, today: date) -> tuple[float, str | None]:
    job = job_type.lower()
    month = today.month
    if "water heater" in job:  # year-round, not a heating-season job
        return 1.0, None
    if _mentions(job, COOLING_WORDS):
        return (1.25, "cooling job heading into hot months") if month in (3, 4, 5, 6, 7) else (0.9, None)
    if _mentions(job, HEATING_WORDS):
        return (1.25, "heating job heading into cold months") if month in (9, 10, 11, 12, 1) else (0.9, None)
    if _mentions(job, ROOF_WORDS):
        return (1.15, "roofing season") if month in (3, 4, 5, 9, 10) else (0.95, None)
    return 1.0, None


def _age_factor(age_days: int | None) -> tuple[float, str]:
    if age_days is None:
        return 0.6, "no estimate date"
    if age_days < 14:
        return 0.5, "too fresh - contractor is probably still following up"
    if age_days <= 120:
        return 1.0, f"{age_days} days old - still warm"
    if age_days <= 365:
        return 0.8, f"{age_days // 30} months old"
    if age_days <= 730:
        return 0.5, "over a year old"
    return 0.25, "over two years old"


def score_lead(lead: Lead, today: date) -> Lead:
    """Expected-value score: bigger tickets, warm age, and in-season jobs first."""
    reasons = []
    value = math.log10(max(lead.amount, 100)) - 1  # $100 -> 1.0, $1k -> 2.0, $10k -> 3.0
    if lead.amount >= 5000:
        reasons.append(f"${lead.amount:,.0f} ticket")
    age_days = (today - lead.estimate_date).days if lead.estimate_date else None
    age, age_reason = _age_factor(age_days)
    reasons.append(age_reason)
    season, season_reason = _season_fit(lead.job_type, today)
    if season_reason:
        reasons.append(season_reason)
    lead.score = round(value * age * season, 3)
    lead.reasons = reasons
    return lead


def filter_callable(leads: list[Lead], suppression: SuppressionList) -> tuple[list[Lead], dict[str, int]]:
    keep, skipped, seen = [], {"bad_phone": 0, "suppressed": 0, "closed_status": 0, "duplicate": 0}, set()
    for lead in leads:
        phone = normalize_phone(lead.phone)
        if not phone:
            skipped["bad_phone"] += 1
            continue
        if phone in suppression:
            skipped["suppressed"] += 1
            continue
        if any(s in lead.status for s in EXCLUDED_STATUSES):
            skipped["closed_status"] += 1
            continue
        if phone in seen:
            skipped["duplicate"] += 1
            continue
        seen.add(phone)
        lead.phone = phone
        keep.append(lead)
    return keep, skipped


def script_for(lead: Lead, biz: Business, today: date) -> dict[str, str]:
    when = lead.estimate_date.strftime("%B") if lead.estimate_date else "a while back"
    if lead.estimate_date and lead.estimate_date.year != today.year:
        when = lead.estimate_date.strftime("%B %Y")
    job = lead.job_type.lower()
    opener = (
        f"Hi, is this {lead.first_name}? Hey {lead.first_name}, this is {biz.caller} calling from {biz.name}. "
        f"We put together an estimate for your {job} back in {when}, and I'm just checking in - "
        "did you ever get that taken care of?"
    )
    script = {
        "opener": opener,
        "if_still_open": (
            "Totally get it. Can I ask what held it up - was it timing, the price, or life just got busy? "
            f"[listen] What I can do is set up {biz.offer}. "
            "I've got [DAY] morning or [DAY] afternoon - which works better?"
        ),
        "if_price": (
            "That makes sense - it's a real number. A lot of folks don't know we can look at a repair-only option "
            "or monthly financing. Want me to have the tech come back out and walk you through both, no charge?"
        ),
        "if_timing": (
            "No rush at all. The schedule usually fills up once the weather turns, so would it help to grab a slot "
            "now? If something changes you can always move it."
        ),
        "if_already_done": (
            "Glad it's handled! Mind if I ask who you went with? [log it] We'd love to keep you in mind for "
            "maintenance - have a great day."
        ),
        "if_not_interested": "No problem at all, I appreciate your time. Want me to take you off our list? [if yes: log opt_out]",
        "voicemail": (
            f"Hi {lead.first_name}, it's {biz.caller} with {biz.name}, following up on the {job} estimate from {when}. "
            "We've got openings this week if you still want to get it done - call or text us back at [BUSINESS NUMBER]. Thanks!"
        ),
    }
    if lead.sms_consent:
        script["follow_up_text"] = (
            f"Hi {lead.first_name}, {biz.caller} from {biz.name} here about your {job} estimate. "
            "Still want to get it done? Reply with a day that works and we'll hold a spot. Reply STOP to opt out."
        )
    if llm.ai_enabled():
        script["opener"] = llm.generate(
            f"Rewrite this phone opener so it sounds natural and warm, under 45 words, keep the facts:\n{opener}",
            fallback=opener,
            max_tokens=400,
        )
    return script


def prioritize(estimates_csv: str | Path, out_dir: str | Path, biz: Business, today: date | None = None) -> dict:
    today = today or date.today()
    out_dir = Path(out_dir)
    suppression = SuppressionList(out_dir / "suppression.json")
    leads, skipped = filter_callable(load_leads(estimates_csv), suppression)
    ranked = sorted((score_lead(lead, today) for lead in leads), key=lambda l: l.score, reverse=True)

    rows, md = [], [f"# Call sheet - {biz.name}", f"_Generated {today:%b %d, %Y}. Call 9am-8pm, never Sundays._", ""]
    for rank, lead in enumerate(ranked, start=1):
        script = script_for(lead, biz, today)
        rows.append({
            "rank": rank, "lead_id": lead.lead_id, "customer": lead.customer, "phone": lead.phone,
            "job_type": lead.job_type, "amount": f"{lead.amount:.0f}",
            "estimate_date": lead.estimate_date.isoformat() if lead.estimate_date else "",
            "score": lead.score, "why": "; ".join(lead.reasons), "opener": script["opener"],
        })
        md += [f"## {rank}. {lead.customer} - {lead.job_type} (${lead.amount:,.0f})",
               f"**{lead.phone}** · {'; '.join(lead.reasons)} · lead `{lead.lead_id}`", ""]
        md += [f"- **{k.replace('_', ' ').title()}:** {v}" for k, v in script.items()]
        md.append("")
    write_rows(out_dir / "call_sheet.csv", rows, fieldnames=[
        "rank", "lead_id", "customer", "phone", "job_type", "amount", "estimate_date", "score", "why", "opener"])
    (out_dir / "call_sheet.md").write_text("\n".join(md))
    pipeline_value = sum(l.amount for l in ranked)
    return {"callable": len(ranked), "skipped": skipped, "pipeline_value": pipeline_value, "out_dir": str(out_dir)}


def log_outcome(out_dir: str | Path, lead_id: str, outcome: str, notes: str = "", phone: str = "") -> None:
    if outcome not in OUTCOMES:
        raise ValueError(f"outcome must be one of {', '.join(OUTCOMES)}")
    out_dir = Path(out_dir)
    if outcome == "opt_out":
        if not phone:
            sheet = {r["lead_id"]: r for r in read_rows(out_dir / "call_sheet.csv")}
            phone = sheet.get(lead_id, {}).get("phone", "")
        if phone:
            SuppressionList(out_dir / "suppression.json").add(phone)
    append_row(out_dir / "outcomes.csv", {
        "ts": datetime.now().isoformat(timespec="seconds"), "lead_id": lead_id, "outcome": outcome, "notes": notes,
    }, OUTCOME_FIELDS)


def report(out_dir: str | Path, biz: Business, closed_jobs_csv: str | Path | None = None) -> str:
    """Campaign summary plus a performance invoice for jobs that closed from booked leads."""
    out_dir = Path(out_dir)
    outcomes_path = out_dir / "outcomes.csv"
    outcomes = read_rows(outcomes_path) if outcomes_path.exists() else []
    latest: dict[str, str] = {}
    for row in outcomes:
        latest[row["lead_id"]] = row["outcome"]
    counts = {o: sum(1 for v in latest.values() if v == o) for o in OUTCOMES}
    booked = {lid for lid, o in latest.items() if o == "booked"}
    attempts = len(outcomes)
    reached = sum(counts[o] for o in ("booked", "callback", "already_done", "not_interested", "opt_out"))

    closed, revenue = [], 0.0
    if closed_jobs_csv and Path(closed_jobs_csv).exists():
        for row in read_rows(closed_jobs_csv):
            lid = pick(row, "lead_id", "estimate_id", "id")
            if lid in booked:
                amount = _parse_amount(pick(row, "amount", "total", "revenue"))
                closed.append((lid, amount))
                revenue += amount
    fee = revenue * biz.fee_rate

    lines = [
        f"# Estimate Revival report - {biz.name}", "",
        f"- Call attempts: **{attempts}**",
        f"- Leads reached (live conversation): **{reached}**",
        f"- Booked visits: **{counts['booked']}**",
        f"- Callbacks pending: {counts['callback']}  ·  Already done elsewhere: {counts['already_done']}",
        f"- Not interested: {counts['not_interested']}  ·  Opted out: {counts['opt_out']}  ·  Wrong numbers: {counts['wrong_number']}",
        "",
        "## Invoice",
        f"Jobs closed from revived estimates: **{len(closed)}**, revenue **${revenue:,.2f}**",
        f"Performance fee ({biz.fee_rate:.0%}): **${fee:,.2f}**",
    ]
    if closed:
        lines += ["", "| Lead | Job revenue | Fee |", "|---|---|---|"]
        lines += [f"| {lid} | ${amt:,.2f} | ${amt * biz.fee_rate:,.2f} |" for lid, amt in closed]
    text = "\n".join(lines) + "\n"
    (out_dir / "report.md").write_text(text)
    return text
