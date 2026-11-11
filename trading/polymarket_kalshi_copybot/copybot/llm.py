"""Optional LLM check for unclear matches, routed through the local OmniRoute proxy (OpenAI-compatible)."""

from __future__ import annotations

import json
import logging
import re
from typing import Optional

from .http import HttpClient, HttpError
from .models import PMMarket

log = logging.getLogger("copybot.llm")

SYSTEM = (
    "You map prediction-market positions between Polymarket and Kalshi. Two positions are equivalent only if "
    "they pay out in exactly the same real-world outcomes: same event, same date or deadline, same threshold or "
    "line, same team or person, same treatment of ties and pushes. When unsure, answer null. Reply with JSON only."
)


class LLMVerifier:
    def __init__(self, base_url: str, api_key: str, model: str, min_confidence: float = 0.8,
                 http: Optional[HttpClient] = None):
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.api_key = api_key
        self.model = model
        self.min_confidence = min_confidence
        self.http = http or HttpClient(min_interval=0.5, timeout=60)

    def choose(self, pm: PMMarket, outcome: str, candidates: list) -> Optional[dict]:
        """candidates: list[KalshiMarket]. Returns {"ticker", "side", "confidence", "reason"} or None."""
        if not candidates:
            return None
        lines = []
        for i, m in enumerate(candidates):
            close = m.close_time.date().isoformat() if m.close_time else "?"
            rules = (m.rules_primary or "")[:400]
            lines.append(f"[{i}] ticker={m.ticker} | event: {m.event_title} | market: {m.title} | "
                         f"YES means: {m.yes_sub_title} | closes {close} | rules: {rules}")
        end = pm.end_date.date().isoformat() if pm.end_date else "?"
        user = (
            f"Polymarket market: {pm.question}\nOutcomes: {pm.outcomes}\nEnd date: {end}\n"
            f"Rules: {pm.description[:800]}\n\nThe trader BOUGHT the outcome: \"{outcome}\".\n\n"
            "Kalshi candidates:\n" + "\n".join(lines) + "\n\n"
            "Which single candidate, and which Kalshi side (yes or no), gives the SAME payoff as holding that "
            "Polymarket outcome? Answer with JSON: "
            '{"index": <int or null>, "side": "yes"|"no"|null, "confidence": <0..1>, "reason": "<short>"}'
        )
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        try:
            resp = self.http.request("POST", self.url, json_body={
                "model": self.model, "temperature": 0, "max_tokens": 300,
                "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
            }, headers_fn=lambda: headers, max_retries=2)
        except HttpError as exc:
            log.warning("LLM verify failed: %s", exc)
            return None
        try:
            text = resp["choices"][0]["message"]["content"]
            parsed = json.loads(re.search(r"\{.*\}", text, re.S).group(0))
        except (KeyError, IndexError, AttributeError, ValueError, TypeError):
            log.warning("LLM verify returned unparseable output")
            return None
        idx, side = parsed.get("index"), str(parsed.get("side") or "").lower()
        conf = float(parsed.get("confidence") or 0)
        if not isinstance(idx, int) or not 0 <= idx < len(candidates) or side not in ("yes", "no"):
            return None
        if conf < self.min_confidence:
            log.info("LLM confidence %.2f below %.2f for %s", conf, self.min_confidence, pm.question)
            return None
        return {"ticker": candidates[idx].ticker, "side": side, "confidence": conf,
                "reason": str(parsed.get("reason", ""))[:300]}
