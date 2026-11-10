"""Kalshi Trade API v2 client: signed requests, market universe, quotes, balance, positions, V2 orders.

Auth (docs.kalshi.com/getting_started/api_keys): sign `timestamp_ms + METHOD + path` where path includes
the /trade-api/v2 prefix and excludes the query string. RSA keys use RSA-PSS/SHA-256 with salt length
equal to the digest length; Ed25519 keys sign the message directly.

Orders use POST /portfolio/events/orders (V2): `side` is bid|ask on the YES book and `price` is always the
YES-leg price in dollars. Buying NO at p is sent as an `ask` at 1 - p.
"""

from __future__ import annotations

import base64
import gzip
import json
import logging
import time
from pathlib import Path
from typing import Iterator, Optional
from urllib.parse import urlparse

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, padding, rsa

from .http import HttpClient, HttpError
from .models import KalshiMarket, parse_ts

log = logging.getLogger("copybot.kalshi")


class KalshiAuth:
    def __init__(self, key_id: str, private_key_pem: bytes):
        self.key_id = key_id
        self.key = serialization.load_pem_private_key(private_key_pem, password=None)
        if not isinstance(self.key, (rsa.RSAPrivateKey, ed25519.Ed25519PrivateKey)):
            raise ValueError("Kalshi private key must be RSA or Ed25519")

    @classmethod
    def from_file(cls, key_id: str, path: str) -> "KalshiAuth":
        return cls(key_id, Path(path).expanduser().read_bytes())

    def sign(self, message: str) -> str:
        data = message.encode()
        if isinstance(self.key, rsa.RSAPrivateKey):
            sig = self.key.sign(
                data,
                padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.DIGEST_LENGTH),
                hashes.SHA256(),
            )
        else:
            sig = self.key.sign(data)
        return base64.b64encode(sig).decode()

    def headers(self, method: str, path: str) -> dict:
        ts = str(int(time.time() * 1000))
        path = path.split("?", 1)[0]
        return {
            "KALSHI-ACCESS-KEY": self.key_id,
            "KALSHI-ACCESS-TIMESTAMP": ts,
            "KALSHI-ACCESS-SIGNATURE": self.sign(ts + method.upper() + path),
        }


def fmt_price(p: float) -> str:
    return f"{p:.4f}"


def fmt_count(c: float) -> str:
    return f"{c:.2f}"


class KalshiClient:
    def __init__(self, base_url: str, auth: Optional[KalshiAuth] = None, http: Optional[HttpClient] = None):
        self.base_url = base_url.rstrip("/")
        self.base_path = urlparse(self.base_url).path
        self.auth = auth
        # Unauthenticated reads get 429s quickly; ~4 req/s keeps the universe crawl clean.
        self.http = http or HttpClient(min_interval=0.25, timeout=20)

    def _req(self, method: str, path: str, *, params: Optional[dict] = None, body: Optional[dict] = None,
             auth_required: bool = False, **kw):
        if auth_required and not self.auth:
            raise RuntimeError("Kalshi API key not configured (KALSHI_API_KEY_ID / KALSHI_PRIVATE_KEY_PATH)")
        headers_fn = (lambda: self.auth.headers(method, self.base_path + path)) if self.auth else None
        return self.http.request(method, self.base_url + path, params=params, json_body=body,
                                 headers_fn=headers_fn, **kw)

    # ------------------------------------------------------------------ market data
    def iter_open_events(self, page_size: int = 200, page_delay: float = 0.6) -> Iterator[dict]:
        # Pages with nested markets are expensive for Kalshi's rate limiter; going faster than
        # ~1 page/s triggers a 429 on nearly every page and ends up slower overall.
        cursor = None
        first = True
        while True:
            if not first:
                time.sleep(page_delay)
            first = False
            params = {"status": "open", "with_nested_markets": "true", "limit": page_size}
            if cursor:
                params["cursor"] = cursor
            data = self._req("GET", "/events", params=params, max_retries=6)
            events = data.get("events") or []
            yield from events
            cursor = data.get("cursor")
            if not cursor or not events:
                return

    def fetch_universe(self) -> list:
        started = time.time()
        markets = []
        for ev in self.iter_open_events():
            for m in ev.get("markets") or []:
                if m.get("status") == "active" and m.get("market_type", "binary") == "binary":
                    markets.append(KalshiMarket.from_api(m, ev))
        log.info("Kalshi universe: %d active markets in %.0fs", len(markets), time.time() - started)
        return markets

    def get_market(self, ticker: str) -> KalshiMarket:
        data = self._req("GET", f"/markets/{ticker}")
        m = data.get("market") or {}
        ev = {"series_ticker": "", "title": ""}
        return KalshiMarket.from_api(m, ev, keep_rules=True)

    def get_markets(self, tickers: list) -> list:
        out = []
        for i in range(0, len(tickers), 50):
            chunk = tickers[i:i + 50]
            data = self._req("GET", "/markets", params={"tickers": ",".join(chunk), "limit": len(chunk)})
            out.extend(KalshiMarket.from_api(m) for m in data.get("markets") or [])
        return out

    # ------------------------------------------------------------------ portfolio
    def balance(self) -> dict:
        data = self._req("GET", "/portfolio/balance", auth_required=True)
        cash = float(data["balance_dollars"]) if data.get("balance_dollars") else data.get("balance", 0) / 100
        return {"cash": cash, "portfolio_value": (data.get("portfolio_value") or 0) / 100}

    def positions(self) -> list:
        out, cursor = [], None
        while True:
            params = {"limit": 1000, "count_filter": "position"}
            if cursor:
                params["cursor"] = cursor
            data = self._req("GET", "/portfolio/positions", params=params, auth_required=True)
            out.extend(data.get("market_positions") or [])
            cursor = data.get("cursor")
            if not cursor:
                return out

    def create_order(self, *, ticker: str, book_side: str, count: float, yes_price: float,
                     client_order_id: str, time_in_force: str = "immediate_or_cancel",
                     reduce_only: bool = False) -> dict:
        body = {
            "ticker": ticker,
            "client_order_id": client_order_id,
            "side": book_side,
            "count": fmt_count(count),
            "price": fmt_price(yes_price),
            "time_in_force": time_in_force,
            "self_trade_prevention_type": "taker_at_cross",
        }
        if reduce_only:
            body["reduce_only"] = True
        # Never blindly retry an order on a read timeout or 5xx: it may already be live. 429 and 503 are
        # rejections, so they are safe to retry. The client_order_id also lets Kalshi reject duplicates.
        return self._req("POST", "/portfolio/events/orders", body=body, auth_required=True,
                         retry_statuses=(429, 503), retry_on_read_timeout=False)


# ---------------------------------------------------------------------- universe cache (gzip on disk)


def save_universe(path: Path, markets: list) -> None:
    rows = [{
        "t": m.ticker, "e": m.event_ticker, "s": m.series_ticker, "et": m.event_title, "ti": m.title,
        "y": m.yes_sub_title, "ct": m.close_time.isoformat() if m.close_time else None,
        "x": m.expected_expiration_time.isoformat() if m.expected_expiration_time else None, "c": m.category,
    } for m in markets]
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with gzip.open(tmp, "wt", encoding="utf-8") as fh:
        json.dump({"fetched_at": time.time(), "markets": rows}, fh)
    tmp.replace(path)


def load_universe(path: Path) -> tuple:
    """Returns (markets, fetched_at) or ([], 0) when no cache exists."""
    if not path.exists():
        return [], 0.0
    try:
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError) as exc:
        log.warning("ignoring unreadable universe cache %s: %s", path, exc)
        return [], 0.0
    markets = [
        KalshiMarket(
            ticker=r["t"], event_ticker=r["e"], series_ticker=r["s"], event_title=r["et"], title=r["ti"],
            yes_sub_title=r["y"], status="active", close_time=parse_ts(r["ct"]),
            expected_expiration_time=parse_ts(r["x"]), category=r.get("c", ""),
        )
        for r in data.get("markets", [])
    ]
    return markets, float(data.get("fetched_at", 0))


__all__ = ["KalshiAuth", "KalshiClient", "HttpError", "save_universe", "load_universe", "fmt_price", "fmt_count"]
