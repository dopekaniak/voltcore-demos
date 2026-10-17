"""CLI: python -m agents.setter_copilot {session,queue,stats} LEADS_CSV ...

`session` is the live call mode: it shows one lead at a time with the script,
you dial from your phone, then press one key for what happened.
"""

from __future__ import annotations

import argparse
import json

from agents.setter_copilot.agent import OUTCOME_KEYS, Copilot
from agents.setter_copilot.pitches import PACKS, load_pack

KEY_HELP = "  ".join(f"[{k}] {v[0].replace('_', ' ')}" for k, v in OUTCOME_KEYS.items())


def session(cp: Copilot) -> None:
    queue = cp.queue()
    print(f"\n{len(queue)} calls in today's queue · offer: {cp.pack['label']}\n")
    for p in queue:
        s = cp.script(p)
        print("=" * 72)
        print(f"{p.business}  ·  {p.phone}  ·  {p.city}  ·  {p.rating}★ ({p.reviews} reviews)")
        print(f"why this lead: {p.why}\n")
        for k in ("opener", "question", "value", "ask"):
            print(f"  {k.upper():9} {s[k]}")
        print("\n  OBJECTIONS")
        for k, v in s["objections"].items():
            print(f"   - {k.replace('_', ' ')}: {v}")
        print(f"\n  VOICEMAIL {s['voicemail']}\n")
        key = ""
        while key not in OUTCOME_KEYS and key != "q":
            key = input(f"{KEY_HELP}  [q] quit\n> ").strip().lower()
        if key == "q":
            break
        notes = input("notes (optional): ").strip()
        print(f"logged: {cp.log(p, key, notes)}\n")
    print(json.dumps(cp.funnel(), indent=2))


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="setter_copilot", description=__doc__)
    p.add_argument("cmd", choices=["session", "queue", "stats"])
    p.add_argument("leads_csv")
    p.add_argument("--offer", default="revival", choices=list(PACKS))
    p.add_argument("--pack-file", help="custom pitch pack JSON (e.g. a commission-setter offer)")
    p.add_argument("--data", default="setter-data")
    p.add_argument("--me", default="Alex", help="your first name")
    args = p.parse_args(argv)

    cp = Copilot(args.leads_csv, args.data, load_pack(args.offer, args.pack_file), me=args.me)
    if args.cmd == "session":
        session(cp)
    elif args.cmd == "queue":
        for i, lead in enumerate(cp.queue()[:25], start=1):
            print(f"{i:>2}. {lead.business:<32} {lead.phone}  score {lead.score}  ({lead.why})")
    else:
        print(json.dumps(cp.funnel(), indent=2))


if __name__ == "__main__":
    main()
