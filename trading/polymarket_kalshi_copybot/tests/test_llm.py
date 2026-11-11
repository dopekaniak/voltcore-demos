import unittest

from copybot.http import HttpError
from copybot.llm import LLMVerifier

from tests.helpers import SPREAD_35, km, pm


class FakeHttp:
    def __init__(self, content=None, error=None):
        self.content, self.error, self.sent = content, error, None

    def request(self, method, url, json_body=None, headers_fn=None, **kw):
        self.sent = {"url": url, "body": json_body, "headers": headers_fn()}
        if self.error:
            raise self.error
        return {"choices": [{"message": {"content": self.content}}]}


CANDS = [km("A", "Indiana vs Dallas: Spread", "Dallas wins by over 3.5 points?", "Dallas wins by over 3.5 points", "S"),
         km("B", "Indiana vs Dallas", "Winner?", "Dallas", "S")]


def verifier(content=None, error=None):
    http = FakeHttp(content, error)
    return LLMVerifier("http://localhost:20128/v1", "key", "auto", 0.8, http=http), http


class LLMTests(unittest.TestCase):
    def test_routes_through_omniroute_and_parses_choice(self):
        v, http = verifier('Sure: {"index": 0, "side": "no", "confidence": 0.93, "reason": "Pacers +3.5"}')
        out = v.choose(pm(**SPREAD_35), "Pacers", CANDS)
        self.assertEqual(out["ticker"], "A")
        self.assertEqual(out["side"], "no")
        self.assertEqual(http.sent["url"], "http://localhost:20128/v1/chat/completions")
        self.assertEqual(http.sent["headers"]["Authorization"], "Bearer key")
        self.assertEqual(http.sent["body"]["model"], "auto")

    def test_rejects_low_confidence_null_and_garbage(self):
        for content in ['{"index": 0, "side": "no", "confidence": 0.5}', '{"index": null, "side": null}',
                        '{"index": 7, "side": "yes", "confidence": 1}', "no json here"]:
            v, _ = verifier(content)
            self.assertIsNone(v.choose(pm(**SPREAD_35), "Pacers", CANDS), content)

    def test_proxy_down_is_not_fatal(self):
        v, _ = verifier(error=HttpError(0, "connection refused"))
        self.assertIsNone(v.choose(pm(**SPREAD_35), "Pacers", CANDS))


if __name__ == "__main__":
    unittest.main()
