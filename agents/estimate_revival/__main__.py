"""CLI: python -m agents.estimate_revival {prioritize,log,report} ..."""

from __future__ import annotations

import argparse
import json

from agents.estimate_revival.agent import OUTCOMES, Business, log_outcome, prioritize, report


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="estimate_revival", description=__doc__)
    p.add_argument("--business", default="Your HVAC Co", help="contractor's business name (you call on their behalf)")
    p.add_argument("--caller", default="Alex", help="your first name on the calls")
    p.add_argument("--fee", type=float, default=0.10, help="performance fee as a fraction of revived revenue")
    sub = p.add_subparsers(dest="cmd", required=True)

    pr = sub.add_parser("prioritize", help="rank an estimate export and write call_sheet.csv/.md")
    pr.add_argument("estimates_csv")
    pr.add_argument("--out", default="campaign")

    lg = sub.add_parser("log", help="record a call outcome")
    lg.add_argument("--out", default="campaign")
    lg.add_argument("--lead", required=True)
    lg.add_argument("--outcome", required=True, choices=OUTCOMES)
    lg.add_argument("--notes", default="")

    rp = sub.add_parser("report", help="campaign stats + performance invoice")
    rp.add_argument("--out", default="campaign")
    rp.add_argument("--closed", help="CSV of closed jobs with lead_id,amount")

    args = p.parse_args(argv)
    biz = Business(name=args.business, caller=args.caller, fee_rate=args.fee)
    if args.cmd == "prioritize":
        print(json.dumps(prioritize(args.estimates_csv, args.out, biz), indent=2))
    elif args.cmd == "log":
        log_outcome(args.out, args.lead, args.outcome, args.notes)
        print(f"logged {args.lead}: {args.outcome}")
    else:
        print(report(args.out, biz, args.closed))


if __name__ == "__main__":
    main()
