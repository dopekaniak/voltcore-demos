"""Optional Claude rewriting.

Every agent works with built-in templates and costs $0 to run. Set VOLTCORE_AI=1
(and have Anthropic credentials, e.g. ANTHROPIC_API_KEY) to let Claude personalize
scripts and read free-form texts. Any failure falls back to the template, so a
missing key or an outage never stops a campaign.
"""

from __future__ import annotations

import os

MODEL = "claude-opus-5-5"


def ai_enabled() -> bool:
    return os.environ.get("VOLTCORE_AI") == "1"


def generate(prompt: str, fallback: str, system: str = "", max_tokens: int = 2000) -> str:
    if not ai_enabled():
        return fallback
    try:
        import anthropic

        client = anthropic.Anthropic()
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=max_tokens,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": "low"},
            system=system or "You write short, plain-spoken phone and SMS copy for home-service businesses.",
            messages=[{"role": "user", "content": prompt}],
        )
        if response.stop_reason == "refusal":
            return fallback
        text = "".join(block.text for block in response.content if block.type == "text").strip()
        return text or fallback
    except Exception:  # never let copywriting break a live campaign
        return fallback
