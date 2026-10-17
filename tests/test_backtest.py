import tempfile
import unittest
from pathlib import Path

from backtest.__main__ import calibrate, haircut
from backtest.simulate import default_params, run, summarize


class Backtest(unittest.TestCase):
    def test_deterministic(self):
        a = {k: summarize(v) for k, v in run(runs=60, seed=1).items()}
        b = {k: summarize(v) for k, v in run(runs=60, seed=1).items()}
        self.assertEqual(a, b)

    def test_haircut_lowers_every_model(self):
        base = {k: summarize(v)["median_year_total"] for k, v in run(runs=150, seed=3).items()}
        params = default_params()
        haircut(params, 0.5)
        cut = {k: summarize(v)["median_year_total"] for k, v in run(runs=150, seed=3, params=params).items()}
        for name in base:
            self.assertLess(cut[name], base[name], name)

    def test_setter_income_is_capped(self):
        res = {k: summarize(v) for k, v in run(runs=200, seed=5).items()}
        self.assertEqual(res["Commission Setter"]["m12_p_25k"], 0)

    def test_calibration_needs_enough_dials(self):
        log = Path(tempfile.mkdtemp()) / "call_log.csv"
        log.write_text("ts,lead_id,business,phone,outcome,notes,follow_up_on\n" +
                       "".join(f"t,L{i},b,p,{'meeting_booked' if i % 20 == 0 else 'not_interested' if i % 4 == 0 else 'no_answer'},,\n"
                               for i in range(30)))
        self.assertIn("skipped", calibrate(default_params(), str(log), "revival"))
        log.write_text(log.read_text() + "".join(f"t,M{i},b,p,{'not_interested' if i % 4 == 0 else 'no_answer'},,\n" for i in range(60)))
        params = default_params()
        msg = calibrate(params, str(log), "revival")
        self.assertIn("calibrated", msg)
        self.assertEqual(params["SALES_FUNNEL"]["connect_rate"][1], "your call log")


if __name__ == "__main__":
    unittest.main()
