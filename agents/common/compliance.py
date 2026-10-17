"""Calling/texting guardrails.

These are conservative defaults, not legal advice. Federal TCPA quiet hours are
8am-9pm in the recipient's local time; several states are stricter, so we default
to 9am-8pm and never on Sunday. Opt-outs are permanent and checked before every
call or text.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, time
from pathlib import Path

CALL_WINDOW_START = time(9, 0)
CALL_WINDOW_END = time(20, 0)
NO_CALL_WEEKDAYS = {6}  # Sunday

# Carrier-standard SMS keywords plus plain-English versions people actually type.
OPT_OUT_KEYWORDS = {"stop", "stopall", "unsubscribe", "cancel", "end", "quit", "revoke", "optout"}
OPT_OUT_PHRASES = (
    "don't call", "dont call", "do not call", "stop calling", "stop texting",
    "remove me", "take me off", "leave me alone", "not interested, stop",
)


def normalize_phone(raw: str) -> str | None:
    """Return a US number in E.164 (+1XXXXXXXXXX), or None if it isn't one."""
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10 or digits[0] in "01":
        return None
    return "+1" + digits


def is_opt_out(message: str) -> bool:
    text = (message or "").strip().lower()
    if re.sub(r"[^a-z]", "", text) in OPT_OUT_KEYWORDS:
        return True
    return any(p in text for p in OPT_OUT_PHRASES)


def in_call_window(local_dt: datetime) -> bool:
    """True if it's an acceptable time to call/text someone at this local time."""
    if local_dt.weekday() in NO_CALL_WEEKDAYS:
        return False
    return CALL_WINDOW_START <= local_dt.time() < CALL_WINDOW_END


class SuppressionList:
    """Permanent do-not-contact list stored as JSON next to the campaign data."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self._numbers: set[str] = set()
        if self.path.exists():
            self._numbers = set(json.loads(self.path.read_text()))

    def __contains__(self, phone: str) -> bool:
        return (normalize_phone(phone) or phone) in self._numbers

    def add(self, phone: str) -> None:
        self._numbers.add(normalize_phone(phone) or phone)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(sorted(self._numbers), indent=2))

    def __len__(self) -> int:
        return len(self._numbers)
