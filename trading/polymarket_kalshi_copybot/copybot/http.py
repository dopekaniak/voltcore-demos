"""HTTP helper: timeouts, pacing, and retry with backoff on 429/5xx."""

from __future__ import annotations

import logging
import random
import threading
import time
from typing import Any, Callable, Optional

import requests

log = logging.getLogger("copybot.http")

USER_AGENT = "copybot/1.0 (+prediction-market copy trader)"


class HttpError(Exception):
    def __init__(self, status: int, message: str, body: Any = None):
        super().__init__(f"HTTP {status}: {message}")
        self.status = status
        self.body = body


class Pacer:
    """Minimum spacing between requests to one host (thread safe)."""

    def __init__(self, min_interval: float):
        self.min_interval = min_interval
        self._lock = threading.Lock()
        self._next = 0.0

    def wait(self) -> None:
        with self._lock:
            now = time.monotonic()
            delay = self._next - now
            self._next = max(now, self._next) + self.min_interval
        if delay > 0:
            time.sleep(delay)


class HttpClient:
    def __init__(self, min_interval: float = 0.0, timeout: float = 15.0, session: Optional[requests.Session] = None):
        self.session = session or requests.Session()
        self.session.headers.setdefault("User-Agent", USER_AGENT)
        self.session.headers.setdefault("Accept", "application/json")
        self.pacer = Pacer(min_interval)
        self.timeout = timeout

    def request(
        self,
        method: str,
        url: str,
        *,
        params: Optional[dict] = None,
        json_body: Optional[dict] = None,
        headers_fn: Optional[Callable[[], dict]] = None,
        max_retries: int = 4,
        retry_statuses: tuple = (429, 500, 502, 503, 504),
        retry_on_read_timeout: bool = True,
    ) -> Any:
        attempt = 0
        while True:
            self.pacer.wait()
            headers = headers_fn() if headers_fn else {}
            try:
                resp = self.session.request(method, url, params=params, json=json_body,
                                            headers=headers, timeout=self.timeout)
            except requests.exceptions.ConnectTimeout as exc:
                err: Exception = exc
                retryable = True
            except requests.exceptions.ReadTimeout as exc:
                err, retryable = exc, retry_on_read_timeout
            except requests.exceptions.ConnectionError as exc:
                err, retryable = exc, retry_on_read_timeout
            else:
                if resp.status_code < 400:
                    if not resp.content:
                        return {}
                    try:
                        return resp.json()
                    except ValueError as exc:
                        raise HttpError(resp.status_code, "invalid JSON", resp.text[:500]) from exc
                body: Any
                try:
                    body = resp.json()
                except ValueError:
                    body = resp.text[:500]
                if resp.status_code in retry_statuses and attempt < max_retries:
                    delay = _retry_after(resp) or _backoff(attempt)
                    log.warning("%s %s -> %s, retrying in %.1fs", method, _short(url), resp.status_code, delay)
                    attempt += 1
                    time.sleep(delay)
                    continue
                raise HttpError(resp.status_code, _message(body), body)

            if retryable and attempt < max_retries:
                delay = _backoff(attempt)
                log.warning("%s %s failed (%s), retrying in %.1fs", method, _short(url), type(err).__name__, delay)
                attempt += 1
                time.sleep(delay)
                continue
            raise HttpError(0, f"{type(err).__name__}: {err}") from err


def _backoff(attempt: int) -> float:
    return min(30.0, 0.75 * (2 ** attempt)) + random.uniform(0, 0.5)


def _retry_after(resp: requests.Response) -> Optional[float]:
    raw = resp.headers.get("Retry-After")
    try:
        return min(60.0, float(raw)) if raw else None
    except ValueError:
        return None


def _message(body: Any) -> str:
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict):
            return str(err.get("message") or err.get("code") or err)
        return str(err or body.get("message") or body)[:300]
    return str(body)[:300]


def _short(url: str) -> str:
    return url.split("?", 1)[0]
