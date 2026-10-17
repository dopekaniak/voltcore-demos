"""Pitch packs: what to say to a contractor for each offer.

Every pack is an opener, the one question that gets them talking, the value line,
the ask, and comebacks for the objections owners actually throw. Fill-ins:
{owner} {business} {city} {me} {reviews}.
"""

from __future__ import annotations

import json
from pathlib import Path

COMMON_OBJECTIONS = {
    "busy": "Totally - you're probably on a job. This takes 30 seconds: can I ask one question and you tell me if it's worth a call back?",
    "send_info": "Happy to. So I send the right thing - what's your bigger headache right now, missed calls or quotes that never close?",
    "not_interested": "Fair enough. Just so I know for next time - is it the timing, or you've already got this covered?",
    "is_this_ai_or_scam": "Ha - real person, I promise. I'm local, I work with contractors around {city}. No contract, nothing to sign today.",
    "how_much": "Depends on volume, but here's the deal: {pricing}. If it doesn't pay for itself you walk.",
}

PACKS: dict[str, dict] = {
    "revival": {
        "label": "Estimate Revival (performance-only)",
        "pricing": "nothing up front - I only get 10% of jobs I bring back from your old estimates",
        "opener": "Hey, is this {owner}? This is {me} - quick one, I'll be fast. You guys are {business} over in {city}, right?",
        "question": "Roughly how many estimates did you send out last year that never turned into a job?",
        "value": ("Most shops I talk to have a couple hundred quotes just sitting there. I call those customers back for you - "
                  "in your name - and book the ones that are still interested. You don't pay me a dime unless one of them closes, "
                  "then I take 10% of that job."),
        "ask": "Can I grab 15 minutes with you Thursday or Friday to show you how it works on 20 of your old estimates?",
        "objections": {
            "we_follow_up_already": "Love that. How far back do you go? Most guys stop after one call - the money's in the 3-to-12-month-old ones nobody touches.",
            "dont_want_you_calling_customers": "Totally fair, it's your reputation. You approve the script, I call as part of your office, and anyone who says no is off the list for good. Want to start with 20 and listen in?",
            "no_list": "Do you use Jobber, Housecall Pro, ServiceTitan, or even QuickBooks? Any of those can export old estimates in two clicks - I'll walk you through it.",
        },
        "voicemail": "Hey {owner}, {me} here - I help contractors in {city} turn their old unsold estimates into jobs, and you only pay when one closes. Give me a call back at [YOUR NUMBER].",
    },
    "missed_call": {
        "label": "Missed-Call Rescue",
        "pricing": "$297 a month, no contract, and I'll set it up free if you start this week",
        "opener": "Hey, is this {owner}? This is {me} - you guys are {business} in {city}, right? Quick question for you.",
        "question": "When you're up on a job and the phone rings, what happens to that call?",
        "value": ("Most of those callers just call the next guy on Google. I set up your line so anyone you miss gets a text back in "
                  "seconds, it asks what they need, and books them right into your schedule - you get a text with the job."),
        "ask": "Want me to show you? Give me 10 minutes and I'll text your own number from it so you see exactly what your customers get.",
        "objections": {
            "we_answer_every_call": "That's rare - nice. What about after 6 and weekends? That's when the no-heat calls come in.",
            "jobber_has_this": "It does - if you're on Jobber and using it, keep it. Most guys pay for it and never set it up. I do the setup and keep it tuned so it actually books jobs.",
        },
        "voicemail": "Hey {owner}, {me} here. Quick one - I set up a thing for contractors in {city} that texts back every call you miss and books the job. Call me back at [YOUR NUMBER] and I'll show you on your own phone.",
    },
}


def load_pack(name: str, custom_path: str | None = None) -> dict:
    """Built-in pack, or a custom JSON (same keys) for a commission-setter offer."""
    if custom_path:
        pack = json.loads(Path(custom_path).read_text())
    elif name in PACKS:
        pack = PACKS[name]
    else:
        raise KeyError(f"unknown pack {name!r}; choose {', '.join(PACKS)} or pass --pack-file")
    objections = {**COMMON_OBJECTIONS, **pack.get("objections", {})}
    return {**pack, "objections": objections}


def render(text: str, **fields: str) -> str:
    class Blank(dict):
        def __missing__(self, key):
            return "[" + key + "]"
    return text.format_map(Blank(fields))
