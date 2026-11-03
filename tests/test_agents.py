import json
import tempfile
import threading
import unittest
import urllib.parse
import urllib.request
from datetime import date, datetime
from http.server import ThreadingHTTPServer
from pathlib import Path

from agents.common.compliance import SuppressionList, in_call_window, is_opt_out, normalize_phone
from agents.estimate_revival import agent as revival
from agents.missed_call_rescue.conversation import BusinessConfig, RescueAgent
from agents.missed_call_rescue.server import SmsSender, make_handler, valid_twilio_signature
from agents.setter_copilot.agent import Copilot
from agents.setter_copilot.pitches import load_pack
from data.generate_sample import main as generate_sample

TODAY = date(2026, 10, 17)


class Compliance(unittest.TestCase):
    def test_phone_normalization(self):
        self.assertEqual(normalize_phone("(614) 555-0101"), "+16145550101")
        self.assertEqual(normalize_phone("1-614-555-0101"), "+16145550101")
        self.assertIsNone(normalize_phone("n/a"))
        self.assertIsNone(normalize_phone("055-555-0101"))

    def test_opt_out(self):
        for msg in ("STOP", "stop.", "Unsubscribe", "please don't call me again", "remove me"):
            self.assertTrue(is_opt_out(msg), msg)
        for msg in ("stopped working", "my AC won't stop running", "yes"):
            self.assertFalse(is_opt_out(msg), msg)

    def test_call_window(self):
        self.assertTrue(in_call_window(datetime(2026, 10, 19, 10, 0)))   # Monday 10am
        self.assertFalse(in_call_window(datetime(2026, 10, 19, 20, 30)))  # Monday 8:30pm
        self.assertFalse(in_call_window(datetime(2026, 10, 18, 12, 0)))  # Sunday


class EstimateRevival(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        generate_sample(self.tmp, today=TODAY)
        self.biz = revival.Business(name="Cool Air HVAC", caller="Jordan")

    def test_prioritize_filters_and_ranks(self):
        out = revival.prioritize(self.tmp / "estimates.csv", self.tmp / "c", self.biz, today=TODAY)
        self.assertGreater(out["callable"], 150)
        self.assertGreater(out["skipped"]["closed_status"], 0)
        self.assertEqual(out["skipped"]["duplicate"], 2)
        rows = (self.tmp / "c" / "call_sheet.csv").read_text().splitlines()
        self.assertTrue(rows[0].startswith("rank,lead_id"))

    def test_word_matching_does_not_misfire(self):
        # "replacement" contains "ac" - must not count as a cooling job
        self.assertEqual(revival._season_fit("Water heater replacement", TODAY), (1.0, None))
        self.assertEqual(revival._season_fit("Furnace replacement", TODAY)[0], 1.25)

    def test_opt_out_is_suppressed_on_next_run(self):
        c = self.tmp / "c"
        revival.prioritize(self.tmp / "estimates.csv", c, self.biz, today=TODAY)
        first = revival.read_rows(c / "call_sheet.csv")[0]
        revival.log_outcome(c, first["lead_id"], "opt_out")
        revival.prioritize(self.tmp / "estimates.csv", c, self.biz, today=TODAY)
        phones = {r["phone"] for r in revival.read_rows(c / "call_sheet.csv")}
        self.assertNotIn(first["phone"], phones)

    def test_invoice_only_counts_booked_leads(self):
        c = self.tmp / "c"
        revival.prioritize(self.tmp / "estimates.csv", c, self.biz, today=TODAY)
        revival.log_outcome(c, "E0001", "booked")
        revival.log_outcome(c, "E0002", "not_interested")
        closed = self.tmp / "closed.csv"
        closed.write_text("lead_id,amount\nE0001,8000\nE0002,5000\n")
        text = revival.report(c, self.biz, closed)
        self.assertIn("$800.00", text)
        self.assertNotIn("$500.00", text)


class MissedCallRescue(unittest.TestCase):
    def setUp(self):
        self.cfg = BusinessConfig(name="Cool Air", owner_phone="+16145550199", service_zips=["43215"])
        self.agent = RescueAgent(self.cfg, tempfile.mkdtemp(), today=TODAY)
        self.phone = "+16145550123"

    def test_happy_path_books(self):
        self.assertIn("sorry we missed", self.agent.missed_call(self.phone).to_customer.lower())
        self.agent.inbound_sms(self.phone, "2")
        self.agent.inbound_sms(self.phone, "it can wait")
        self.assertIn("reply A", self.agent.inbound_sms(self.phone, "43215").to_customer)
        reply = self.agent.inbound_sms(self.phone, "A")
        self.assertIn("booked", reply.to_customer)
        self.assertIn("NEW BOOKING", reply.to_owner)
        self.assertEqual(self.agent.stats()["booked"], 1)

    def test_urgent_skips_scheduling(self):
        self.agent.missed_call(self.phone)
        self.agent.inbound_sms(self.phone, "ac stopped working, it's 95 degrees")
        reply = self.agent.inbound_sms(self.phone, "zip is 43215")
        self.assertIn("URGENT", reply.to_owner)
        self.assertIn("stopped working", reply.to_owner)

    def test_gas_smell_is_life_safety(self):
        self.agent.missed_call(self.phone)
        reply = self.agent.inbound_sms(self.phone, "I smell gas")
        self.assertIn("911", reply.to_customer)
        self.assertIn("LIFE-SAFETY", reply.to_owner)

    def test_stop_is_permanent(self):
        self.agent.missed_call(self.phone)
        self.agent.inbound_sms(self.phone, "STOP")
        self.assertIsNone(self.agent.inbound_sms(self.phone, "hello?").to_customer)
        self.assertIsNone(self.agent.missed_call(self.phone).to_customer)

    def test_out_of_area(self):
        self.agent.missed_call(self.phone)
        self.agent.inbound_sms(self.phone, "need a new system quote")
        self.agent.inbound_sms(self.phone, "no rush")
        self.assertIn("outside our service area", self.agent.inbound_sms(self.phone, "90210").to_customer)


class TwilioServer(unittest.TestCase):
    def test_signature(self):
        params = {"From": "+16145550123", "Body": "hi"}
        url = "https://example.com/sms"
        import base64, hashlib, hmac
        sig = base64.b64encode(hmac.new(b"tok", (url + "Bodyhi" + "From+16145550123").encode(), hashlib.sha1).digest()).decode()
        self.assertTrue(valid_twilio_signature("tok", url, params, sig))
        self.assertFalse(valid_twilio_signature("tok", url, params, "forged"))

    def test_missed_call_flow_over_http(self):
        data = Path(tempfile.mkdtemp())
        agent = RescueAgent(BusinessConfig(name="Cool Air", owner_phone="+16145550199"), data, today=TODAY)
        sender = SmsSender(data)
        sender.token = sender.sid = ""  # force dry-run regardless of env
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(agent, sender, "http://test"))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{server.server_port}"

        def post(path, **params):
            req = urllib.request.Request(base + path, data=urllib.parse.urlencode(params).encode(), method="POST")
            return urllib.request.urlopen(req).read().decode()

        try:
            self.assertIn("<Dial", post("/voice", From="+16145550123"))
            self.assertIn("missed you", post("/voice/after-dial", From="+16145550123", DialCallStatus="no-answer"))
            outbox = [json.loads(l) for l in (data / "outbox.jsonl").read_text().splitlines()]
            self.assertEqual(outbox[0]["to"], "+16145550123")
            self.assertIn("<Message>", post("/sms", From="+16145550123", Body="furnace is broken"))
            self.assertNotIn("missed you", post("/voice/after-dial", From="+16145550124", DialCallStatus="completed"))
        finally:
            server.shutdown()


class SetterCopilot(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        generate_sample(self.tmp, today=TODAY)
        self.cp = Copilot(self.tmp / "hvac_leads.csv", self.tmp / "s", load_pack("revival"), me="Jordan")

    def test_queue_prefers_busy_no_website_shops(self):
        top = self.cp.queue(TODAY)[0]
        self.assertFalse(top.has_website)
        self.assertTrue(15 <= top.reviews <= 150)

    def test_follow_up_cadence_and_dnc(self):
        q = self.cp.queue(TODAY)
        self.cp.log(q[0], "n", today=TODAY)        # no answer -> retry in 2 days
        self.cp.log(q[1], "x", today=TODAY)        # do not call -> gone for good
        self.cp.log(q[2], "m", today=TODAY)        # meeting booked -> out of queue
        ids_today = {p.lead_id for p in self.cp.queue(TODAY)}
        self.assertFalse({q[0].lead_id, q[1].lead_id, q[2].lead_id} & ids_today)
        ids_later = [p.lead_id for p in self.cp.queue(date(2026, 10, 19))]
        self.assertEqual(ids_later[0], q[0].lead_id)
        reloaded = Copilot(self.tmp / "hvac_leads.csv", self.tmp / "s", load_pack("revival"))
        self.assertNotIn(q[1].lead_id, reloaded.prospects)
        self.assertEqual(self.cp.funnel()["meetings"], 1)

    def test_script_fills_in_lead(self):
        p = self.cp.queue(TODAY)[0]
        script = self.cp.script(p)
        self.assertIn(p.business, script["opener"])
        self.assertIn("Jordan", script["opener"])
        text = json.dumps(script)
        self.assertNotIn("{owner}", text)
        self.assertNotIn("Hey the owner", text)
        self.assertIn("is this the owner?", script["opener"])  # sample leads have no owner names

    def test_custom_pack_file(self):
        pack = load_pack("", str(Path(__file__).parent.parent / "data/sample/setter_pack_web_agency.json"))
        self.assertIn("busy", pack["objections"])  # common objections merged in


if __name__ == "__main__":
    unittest.main()
