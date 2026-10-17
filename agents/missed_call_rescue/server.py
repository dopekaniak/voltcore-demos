"""Twilio webhook server (Python stdlib only).

Point the contractor's Twilio number at:
  Voice "A call comes in"  -> POST {PUBLIC_URL}/voice
  Messaging "A message"    -> POST {PUBLIC_URL}/sms

Flow: /voice forwards the call to the owner's cell for 20s. If nobody picks up,
Twilio hits /voice/after-dial, we text the caller back, and the SMS thread runs
through RescueAgent. Owner alerts go out as texts to owner_phone.

Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (the Twilio number), PUBLIC_URL.
Without Twilio credentials it runs in dry-run mode and writes outgoing texts to outbox.jsonl.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import urllib.parse
import urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from xml.sax.saxutils import escape

from agents.missed_call_rescue.conversation import BusinessConfig, RescueAgent

MISSED_STATUSES = {"no-answer", "busy", "failed", "canceled"}


def twiml(*verbs: str) -> bytes:
    return ('<?xml version="1.0" encoding="UTF-8"?><Response>' + "".join(verbs) + "</Response>").encode()


def valid_twilio_signature(auth_token: str, url: str, params: dict[str, str], signature: str) -> bool:
    """Twilio signs url + sorted(key+value) with HMAC-SHA1. Rejects forged webhook calls."""
    payload = url + "".join(k + params[k] for k in sorted(params))
    digest = base64.b64encode(hmac.new(auth_token.encode(), payload.encode(), hashlib.sha1).digest()).decode()
    return hmac.compare_digest(digest, signature or "")


class SmsSender:
    def __init__(self, data_dir: Path):
        self.sid = os.environ.get("TWILIO_ACCOUNT_SID", "")
        self.token = os.environ.get("TWILIO_AUTH_TOKEN", "")
        self.from_number = os.environ.get("TWILIO_FROM", "")
        self.outbox = data_dir / "outbox.jsonl"

    @property
    def live(self) -> bool:
        return bool(self.sid and self.token and self.from_number)

    def send(self, to: str, body: str) -> None:
        if not self.live:
            with open(self.outbox, "a") as f:
                f.write(json.dumps({"ts": datetime.now().isoformat(timespec="seconds"), "to": to, "body": body}) + "\n")
            return
        url = f"https://api.twilio.com/2010-04-01/Accounts/{self.sid}/Messages.json"
        data = urllib.parse.urlencode({"To": to, "From": self.from_number, "Body": body}).encode()
        req = urllib.request.Request(url, data=data, method="POST")
        req.add_header("Authorization", "Basic " + base64.b64encode(f"{self.sid}:{self.token}".encode()).decode())
        urllib.request.urlopen(req, timeout=15).read()


def make_handler(agent: RescueAgent, sender: SmsSender, public_url: str):
    cfg = agent.cfg

    class Handler(BaseHTTPRequestHandler):
        def _params(self) -> dict[str, str]:
            length = int(self.headers.get("Content-Length", 0))
            return dict(urllib.parse.parse_qsl(self.rfile.read(length).decode()))

        def _respond(self, body: bytes, status: int = 200) -> None:
            self.send_response(status)
            self.send_header("Content-Type", "text/xml")
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self) -> None:
            params = self._params()
            if sender.token and not valid_twilio_signature(
                    sender.token, public_url.rstrip("/") + self.path, params, self.headers.get("X-Twilio-Signature", "")):
                self._respond(b"forbidden", 403)
                return

            caller = params.get("From", "")
            if self.path == "/voice":
                self._respond(twiml(f'<Dial timeout="20" action="/voice/after-dial">{escape(cfg.owner_phone)}</Dial>'))
            elif self.path == "/voice/after-dial":
                if params.get("DialCallStatus") in MISSED_STATUSES:
                    reply = agent.missed_call(caller)
                    if reply.to_customer:
                        sender.send(caller, reply.to_customer)
                    self._respond(twiml("<Say>Sorry we missed you. We just sent you a text so we can get you taken care of.</Say><Hangup/>"))
                else:
                    self._respond(twiml("<Hangup/>"))
            elif self.path == "/sms":
                reply = agent.inbound_sms(caller, params.get("Body", ""))
                if reply.to_owner:
                    sender.send(cfg.owner_phone, reply.to_owner)
                msg = f"<Message>{escape(reply.to_customer)}</Message>" if reply.to_customer else ""
                self._respond(twiml(msg))
            else:
                self._respond(b"not found", 404)

        def do_GET(self) -> None:
            if self.path == "/health":
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True, "live": sender.live, **agent.stats()}).encode())
            else:
                self._respond(b"not found", 404)

    return Handler


def serve(config_path: str, data_dir: str, port: int = 8080) -> None:
    data = Path(data_dir)
    agent = RescueAgent(BusinessConfig.load(config_path), data)
    sender = SmsSender(data)
    public_url = os.environ.get("PUBLIC_URL", f"http://localhost:{port}")
    mode = "LIVE (Twilio)" if sender.live else f"DRY-RUN (texts go to {sender.outbox})"
    print(f"Missed-Call Rescue for {agent.cfg.name} on :{port} - {mode}")
    ThreadingHTTPServer(("0.0.0.0", port), make_handler(agent, sender, public_url)).serve_forever()
