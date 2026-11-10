import base64
import unittest
from unittest import mock

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, padding, rsa

from copybot.executor import LiveExecutor, PaperExecutor
from copybot.http import HttpError
from copybot.kalshi import KalshiAuth, KalshiClient

from tests.helpers import km


def pem(key) -> bytes:
    return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                             serialization.NoEncryption())


class AuthTests(unittest.TestCase):
    def test_rsa_pss_signature_over_timestamp_method_path(self):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        auth = KalshiAuth("key-123", pem(key))
        with mock.patch("copybot.kalshi.time.time", return_value=1_700_000_000.123):
            h = auth.headers("get", "/trade-api/v2/portfolio/balance?limit=5")
        self.assertEqual(h["KALSHI-ACCESS-KEY"], "key-123")
        self.assertEqual(h["KALSHI-ACCESS-TIMESTAMP"], "1700000000123")
        msg = b"1700000000123GET/trade-api/v2/portfolio/balance"  # query string excluded
        key.public_key().verify(
            base64.b64decode(h["KALSHI-ACCESS-SIGNATURE"]), msg,
            padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.DIGEST_LENGTH), hashes.SHA256())

    def test_ed25519_signature(self):
        key = ed25519.Ed25519PrivateKey.generate()
        auth = KalshiAuth("k", pem(key))
        sig = auth.sign("123POST/trade-api/v2/portfolio/events/orders")
        key.public_key().verify(base64.b64decode(sig), b"123POST/trade-api/v2/portfolio/events/orders")

    def test_client_signs_full_api_path(self):
        key = ed25519.Ed25519PrivateKey.generate()
        client = KalshiClient("https://demo-api.kalshi.co/trade-api/v2", KalshiAuth("k", pem(key)))
        seen = {}

        def fake_request(method, url, **kw):
            seen["headers"] = kw["headers_fn"]()
            seen["url"] = url
            return {"balance": 12345, "portfolio_value": 500}

        client.http.request = fake_request
        with mock.patch("copybot.kalshi.time.time", return_value=1.0):
            bal = client.balance()
        self.assertEqual(bal, {"cash": 123.45, "portfolio_value": 5.0})
        key.public_key().verify(base64.b64decode(seen["headers"]["KALSHI-ACCESS-SIGNATURE"]),
                                b"1000GET/trade-api/v2/portfolio/balance")


class FakeKalshi:
    def __init__(self, response=None, error=None):
        self.calls = []
        self.response = response or {"fill_count": "5.00", "average_fill_price": "0.7000", "average_fee_paid": "0.02"}
        self.error = error

    def create_order(self, **kw):
        self.calls.append(kw)
        if self.error:
            raise self.error
        return self.response


class LiveExecutorTests(unittest.TestCase):
    def run_order(self, action, side, limit, response=None):
        k = FakeKalshi(response)
        fill = LiveExecutor(k).execute(action=action, ticker="T", side=side, contracts=5, limit_price=limit,
                                       quote=None, client_order_id="cid")
        return k.calls[0], fill

    def test_buy_yes_is_bid_at_yes_price(self):
        call, fill = self.run_order("buy", "yes", 0.42, {"fill_count": "5.00", "average_fill_price": "0.4100"})
        self.assertEqual((call["book_side"], call["yes_price"], call["reduce_only"]), ("bid", 0.42, False))
        self.assertEqual(call["time_in_force"], "immediate_or_cancel")
        self.assertAlmostEqual(fill.avg_price, 0.41)

    def test_buy_no_is_ask_at_one_minus_price(self):
        call, fill = self.run_order("buy", "no", 0.30)  # fills at YES 0.70 -> NO 0.30
        self.assertEqual((call["book_side"], call["yes_price"]), ("ask", 0.7))
        self.assertAlmostEqual(fill.avg_price, 0.30)
        self.assertAlmostEqual(fill.fee, 0.10)  # 0.02 average fee * 5 contracts

    def test_sells_are_reduce_only_on_the_opposite_book(self):
        call, _ = self.run_order("sell", "yes", 0.55)
        self.assertEqual((call["book_side"], call["reduce_only"]), ("ask", True))
        call, _ = self.run_order("sell", "no", 0.25)
        self.assertEqual((call["book_side"], call["yes_price"], call["reduce_only"]), ("bid", 0.75, True))

    def test_unfilled_and_duplicate(self):
        _, fill = self.run_order("buy", "yes", 0.4, {"fill_count": "0.00"})
        self.assertEqual(fill.status, "unfilled")
        k = FakeKalshi(error=HttpError(409, "duplicate client_order_id"))
        fill = LiveExecutor(k).execute(action="buy", ticker="T", side="yes", contracts=1, limit_price=0.4,
                                       quote=None, client_order_id="cid")
        self.assertEqual(fill.status, "duplicate")


class PaperExecutorTests(unittest.TestCase):
    def test_fills_only_displayed_size_at_or_better_than_limit(self):
        q = km("T", "e", "t", "y", "S", bid=0.40, ask=0.45, size=3)
        f = PaperExecutor().execute(action="buy", ticker="T", side="yes", contracts=10, limit_price=0.46, quote=q,
                                    client_order_id="c")
        self.assertEqual((f.status, f.count, f.avg_price), ("partial", 3.0, 0.45))
        f = PaperExecutor().execute(action="buy", ticker="T", side="yes", contracts=1, limit_price=0.44, quote=q,
                                    client_order_id="c")
        self.assertEqual(f.status, "unfilled")

    def test_no_side_uses_inverted_book(self):
        q = km("T", "e", "t", "y", "S", bid=0.40, ask=0.45, size=10)
        f = PaperExecutor().execute(action="buy", ticker="T", side="no", contracts=2, limit_price=0.60, quote=q,
                                    client_order_id="c")
        self.assertEqual((f.count, f.avg_price), (2.0, 0.60))  # NO ask = 1 - YES bid


if __name__ == "__main__":
    unittest.main()
