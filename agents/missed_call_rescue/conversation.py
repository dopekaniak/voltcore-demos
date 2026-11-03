"""The SMS booking conversation.

A missed call starts a short, rule-driven text thread:
  service type -> how urgent -> ZIP (service-area check) -> pick a time slot -> booked.
Emergencies (gas smell, no heat in winter, flooding...) skip the queue and alert the
owner immediately. STOP or "don't text me" ends the thread for good.

Rules handle the common replies; with VOLTCORE_AI=1, Claude reads anything the
rules can't place.
"""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path

from agents.common import llm
from agents.common.compliance import SuppressionList, is_opt_out, normalize_phone

SERVICES = {
    "repair": ("repair", "fix", "broken", "not working", "stopped", "won't", "wont", "no heat", "no ac", "no air", "leak", "noise"),
    "maintenance": ("maintenance", "tune", "tune-up", "tuneup", "service", "check", "clean", "inspection"),
    "new_system": ("new", "replace", "replacement", "install", "quote", "estimate", "upgrade"),
}
LIFE_SAFETY = ("gas smell", "smell gas", "smells like gas", "carbon monoxide", "co alarm", "co detector", "sparks", "smoke", "burning smell", "fire")
URGENT = ("no heat", "no ac", "no a/c", "no air", "not cooling", "not heating", "stopped working", "not working",
          "quit working", "won't turn on", "wont turn on", "broke down", "died", "degrees", "flood", "water everywhere",
          "leaking", "emergency", "asap", "today", "right now", "freezing", "too hot", "baby", "elderly")


@dataclass
class BusinessConfig:
    name: str
    owner_phone: str
    service_zips: list[str] = field(default_factory=list)
    slots: list[str] = field(default_factory=lambda: ["8am-12pm", "12pm-4pm"])
    business_number: str = ""

    @classmethod
    def load(cls, path: str | Path) -> "BusinessConfig":
        return cls(**json.loads(Path(path).read_text()))


@dataclass
class Thread:
    phone: str
    state: str = "new"
    service: str = ""
    issue: str = ""
    urgent: bool = False
    zip_code: str = ""
    slot: str = ""
    history: list[dict] = field(default_factory=list)


@dataclass
class Reply:
    to_customer: str | None
    to_owner: str | None = None


def _contains(text: str, words) -> bool:
    return any(re.search(rf"(?<![a-z]){re.escape(w)}(?![a-z])", text) for w in words)


def classify_service(text: str) -> str | None:
    t = text.lower()
    if t.strip() in ("1", "2", "3"):
        return ["repair", "maintenance", "new_system"][int(t.strip()) - 1]
    for service, words in SERVICES.items():
        if _contains(t, words):
            return service
    if llm.ai_enabled():
        guess = llm.generate(
            "A homeowner texted an HVAC company. Reply with exactly one word - repair, maintenance, new_system, "
            f"or unknown - for what they want.\nText: {text}",
            fallback="unknown", max_tokens=200,
        ).strip().lower()
        return guess if guess in SERVICES else None
    return None


def next_slots(cfg: BusinessConfig, today: date, count: int = 2) -> list[str]:
    """Next business days (Mon-Sat) paired with the first slot window, e.g. 'Tue Oct 20, 8am-12pm'."""
    out, day = [], today
    while len(out) < count:
        day += timedelta(days=1)
        if day.weekday() == 6:
            continue
        out.append(f"{day:%a %b %d}, {cfg.slots[len(out) % len(cfg.slots)]}")
    return out


class ConversationStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.threads: dict[str, Thread] = {}
        if self.path.exists():
            self.threads = {k: Thread(**v) for k, v in json.loads(self.path.read_text()).items()}

    def save(self) -> None:
        self.path.write_text(json.dumps({k: asdict(v) for k, v in self.threads.items()}, indent=2))


class RescueAgent:
    def __init__(self, cfg: BusinessConfig, data_dir: str | Path, today: date | None = None):
        self.cfg = cfg
        self.data_dir = Path(data_dir)
        self.store = ConversationStore(self.data_dir / "threads.json")
        self.suppression = SuppressionList(self.data_dir / "suppression.json")
        self.today = today

    # -- events ---------------------------------------------------------------
    def missed_call(self, phone: str) -> Reply:
        phone = normalize_phone(phone) or phone
        if phone in self.suppression:
            return Reply(None)
        thread = self.store.threads.get(phone)
        if thread and thread.state not in ("booked", "closed"):
            return Reply(None)  # already mid-conversation; don't double-text
        self.store.threads[phone] = thread = Thread(phone=phone, state="ask_service")
        msg = (f"Hi, this is {self.cfg.name} - sorry we missed your call! We're probably on a job. "
               "What can we help with? Reply 1 for a repair, 2 for maintenance, or 3 for a new system quote. "
               "Reply STOP to opt out.")
        self._log(thread, "out", msg)
        self.store.save()
        return Reply(msg)

    def inbound_sms(self, phone: str, body: str) -> Reply:
        phone = normalize_phone(phone) or phone
        if phone in self.suppression:
            return Reply(None)
        thread = self.store.threads.get(phone) or Thread(phone=phone, state="ask_service")
        self.store.threads[phone] = thread
        self._log(thread, "in", body)
        reply = self._step(thread, body)
        if reply.to_customer:
            self._log(thread, "out", reply.to_customer)
        self.store.save()
        return reply

    # -- state machine --------------------------------------------------------
    def _step(self, t: Thread, body: str) -> Reply:
        text = body.lower()
        if is_opt_out(body):
            self.suppression.add(t.phone)
            t.state = "closed"
            return Reply("You're unsubscribed and won't get any more texts from us.")

        if _contains(text, LIFE_SAFETY):
            t.state, t.urgent = "handoff", True
            return Reply(
                "If you smell gas, smell smoke, or a CO alarm is going off: leave the house now and call 911 or your gas "
                "company from outside. We're alerting our team to call you right away.",
                to_owner=f"LIFE-SAFETY text from {t.phone}: \"{body}\" - call them NOW.",
            )

        if t.state in ("new", "ask_service"):
            service = classify_service(body)
            if not service:
                return Reply("Got it - is this for a repair (1), maintenance (2), or a new system quote (3)?")
            t.service, t.issue = service, body
            if _contains(text, URGENT):
                t.urgent = True
                t.state = "ask_zip"
                return Reply("Sorry you're dealing with that - we'll treat it as urgent. What's the ZIP code where you need us?")
            t.state = "ask_urgency"
            return Reply("Thanks! Is this urgent (system down / no heat or cooling), or can it wait a few days?")

        if t.state == "ask_urgency":
            t.urgent = _contains(text, URGENT) or _contains(text, ("yes", "yeah", "yep", "down", "urgent"))
            t.state = "ask_zip"
            return Reply("Understood. What's the ZIP code where you need service?")

        if t.state == "ask_zip":
            m = re.search(r"\b(\d{5})\b", body)
            if not m:
                return Reply("Sorry, I didn't catch that - what's the 5-digit ZIP code?")
            t.zip_code = m.group(1)
            if self.cfg.service_zips and t.zip_code not in self.cfg.service_zips:
                t.state = "closed"
                return Reply(f"Thanks! Unfortunately {t.zip_code} is outside our service area. Sorry we can't help this time.",
                             to_owner=f"Out-of-area lead {t.phone} ({t.zip_code}, {t.service}).")
            if t.urgent:
                t.state = "handoff"
                return Reply("Thanks - someone from our team will call you within 15 minutes to get you on today's schedule.",
                             to_owner=f"URGENT {t.service} lead {t.phone}, ZIP {t.zip_code}: \"{t.issue}\". Call within 15 min.")
            slots = next_slots(self.cfg, self.today or date.today())
            t.state = "ask_time"
            return Reply(f"Great, we cover {t.zip_code}. We can come {slots[0]} (reply A) or {slots[1]} (reply B). Which works?")

        if t.state == "ask_time":
            slots = next_slots(self.cfg, self.today or date.today())
            choice = text.strip()
            if choice.startswith("a") or "first" in choice:
                t.slot = slots[0]
            elif choice.startswith("b") or "second" in choice:
                t.slot = slots[1]
            else:
                t.state = "handoff"
                return Reply("No problem - someone will call you shortly to find a time that works.",
                             to_owner=f"{t.service} lead {t.phone} ({t.zip_code}) needs a custom time: \"{body}\".")
            t.state = "booked"
            return Reply(f"You're booked for {t.slot}. We'll text when the tech is on the way. Reply here if anything changes!",
                         to_owner=f"NEW BOOKING: {t.service} at ZIP {t.zip_code}, {t.slot}. Customer {t.phone}: \"{t.issue}\".")

        if t.state in ("booked", "handoff"):
            return Reply("Thanks - we've passed your message to the team.", to_owner=f"Message from {t.phone}: \"{body}\"")
        return Reply(None)

    def _log(self, t: Thread, direction: str, text: str) -> None:
        t.history.append({"ts": datetime.now().isoformat(timespec="seconds"), "dir": direction, "text": text})

    # -- reporting ------------------------------------------------------------
    def stats(self) -> dict:
        threads = list(self.store.threads.values())
        return {
            "missed_calls_texted": len(threads),
            "replied": sum(1 for t in threads if any(h["dir"] == "in" for h in t.history)),
            "booked": sum(1 for t in threads if t.state == "booked"),
            "urgent_handoffs": sum(1 for t in threads if t.state == "handoff"),
            "opted_out": len(self.suppression),
        }
