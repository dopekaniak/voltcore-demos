"""python -m backtest [--runs 2000] [--solo] [--calibrate setter-data/call_log.csv --offer revival]

Writes results/backtest.md (+ .json). With --calibrate, your real cold-call
numbers replace the assumed connect and booking rates for that offer.
"""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

from agents.common.storage import read_rows
from backtest.simulate import MODELS, default_params, run, summarize

OFFER_SECTION = {"revival": "REVIVAL", "missed_call": "MISSED_CALL"}


def calibrate(params: dict, call_log: str, offer: str) -> str:
    rows = read_rows(call_log)
    dials = len(rows)
    convos = sum(r["outcome"] in ("not_interested", "follow_up", "meeting_booked", "do_not_call") for r in rows)
    meetings = sum(r["outcome"] == "meeting_booked" for r in rows)
    if dials < 50 or convos < 10:
        return f"calibration skipped: need 50+ dials and 10+ conversations (have {dials}/{convos})"
    connect, c2m = convos / dials, meetings / convos
    band = lambda v: ((v * 0.8, v, v * 1.2), "your call log")
    params["SALES_FUNNEL"]["connect_rate"] = band(connect)
    params[OFFER_SECTION[offer]]["conv_to_meeting"] = band(c2m)
    return f"calibrated from {dials} dials: connect {connect:.1%}, conversation->meeting {c2m:.1%} ({offer})"


RATE_KEYS = {
    "SALES_FUNNEL": ("connect_rate",),
    "REVIVAL": ("conv_to_meeting", "book_per_reached"),
    "MISSED_CALL": ("conv_to_meeting",),
    "SETTER": ("connect_rate", "conv_to_set"),
}


def haircut(params: dict, factor: float) -> str:
    """Stress test: scale every conversion rate (connect, booking) by `factor`."""
    for section, keys in RATE_KEYS.items():
        for key in keys:
            (low, mode, high), source = params[section][key]
            params[section][key] = ((low * factor, mode * factor, high * factor), source)
    return f"Stress test: all connect/booking rates x{factor}."


def money(v: float) -> str:
    return f"-${abs(v):,.0f}" if v < 0 else f"${v:,.0f}"


def render(summaries: dict, runs: int, scale: bool, note: str) -> str:
    lines = [
        f"# Backtest - {runs:,} simulated years per idea ({'scale: hiring allowed' if scale else 'solo: no hires'})",
        f"_Run {date.today():%b %d, %Y}. Net profit to you per month, after tools and any hired callers. {note}_", "",
        "| | " + " | ".join(summaries) + " |", "|---|" + "---|" * len(summaries),
    ]
    rows = [
        ("Median month 3", lambda s: money(s["median_by_month"][2])),
        ("Median month 6", lambda s: money(s["median_by_month"][5])),
        ("Median month 12", lambda s: money(s["median_by_month"][11])),
        ("Bad-luck month 12 (p10)", lambda s: money(s["p10_by_month"][11])),
        ("Good-luck month 12 (p90)", lambda s: money(s["p90_by_month"][11])),
        ("Chance of $5k+/mo by month 6", lambda s: f"{s['m6_p_5k']:.0%}"),
        ("Chance of $10k+/mo by month 6", lambda s: f"{s['m6_p_10k']:.0%}"),
        ("Chance of $10k+/mo by month 12", lambda s: f"{s['m12_p_10k']:.0%}"),
        ("Chance of $25k+/mo by month 12", lambda s: f"{s['m12_p_25k']:.0%}"),
        ("Median week of first dollar", lambda s: f"week {s['median_first_cash_week']:.0f}" if s["median_first_cash_week"] else "never"),
        ("Median 12-month total", lambda s: money(s["median_year_total"])),
        ("Median $/hour in month 6", lambda s: f"${s['median_hourly_m6']:.2f}"),
    ]
    for label, fn in rows:
        lines.append(f"| {label} | " + " | ".join(fn(s) for s in summaries.values()) + " |")
    lines += ["", "## Median net profit by month", "", "| Month | " + " | ".join(summaries) + " |",
              "|---|" + "---|" * len(summaries)]
    for i in range(12):
        lines.append(f"| {i + 1} | " + " | ".join(money(s["median_by_month"][i]) for s in summaries.values()) + " |")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="backtest", description=__doc__)
    p.add_argument("--runs", type=int, default=2000)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--solo", action="store_true", help="no hiring for any idea")
    p.add_argument("--calibrate", help="setter copilot call_log.csv with your real dials")
    p.add_argument("--offer", default="revival", choices=list(OFFER_SECTION), help="offer the call log was pitching")
    p.add_argument("--haircut", type=float, help="stress test: multiply connect/booking rates, e.g. 0.5")
    p.add_argument("--out", default="results")
    args = p.parse_args(argv)

    params = default_params()
    note = calibrate(params, args.calibrate, args.offer) if args.calibrate else "All rates from assumptions.py."
    if args.haircut:
        note += " " + haircut(params, args.haircut)
    results = run(args.runs, args.seed, scale=not args.solo, params=params)
    summaries = {name: summarize(res) for name, res in results.items()}
    text = render(summaries, args.runs, not args.solo, note)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    stem = "backtest" + ("_solo" if args.solo else "") + (f"_haircut{args.haircut:g}" if args.haircut else "")
    (out / f"{stem}.md").write_text(text)
    (out / f"{stem}.json").write_text(json.dumps(summaries, indent=2))
    print(text)


if __name__ == "__main__":
    main()
