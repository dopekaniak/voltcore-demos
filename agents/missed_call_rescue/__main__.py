"""CLI: python -m agents.missed_call_rescue {demo,serve,stats} ...

`demo` is the one to show a contractor: it plays their customer's side of the text
thread live in the terminal so they can see exactly what their callers would get.
"""

from __future__ import annotations

import argparse
import json
import tempfile

from agents.missed_call_rescue.conversation import BusinessConfig, RescueAgent


def demo(cfg: BusinessConfig) -> None:
    agent = RescueAgent(cfg, tempfile.mkdtemp(prefix="mcr-demo-"))
    phone = "+15550100123"
    print(f"\n📞 Missed call from {phone} to {cfg.name}...\n")
    print(f"  {cfg.name} → customer: {agent.missed_call(phone).to_customer}\n")
    print("Type replies as the customer (blank line to quit).\n")
    while True:
        try:
            body = input("  customer → ")
        except EOFError:
            break
        if not body.strip():
            break
        reply = agent.inbound_sms(phone, body)
        if reply.to_customer:
            print(f"  {cfg.name} → customer: {reply.to_customer}")
        if reply.to_owner:
            print(f"  🔔 owner alert: {reply.to_owner}")
        print()
    print(json.dumps(agent.stats(), indent=2))


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="missed_call_rescue", description=__doc__)
    p.add_argument("--config", help="business JSON (name, owner_phone, service_zips, slots)")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("demo", help="interactive text-thread demo")
    sv = sub.add_parser("serve", help="run the Twilio webhook server")
    sv.add_argument("--data", default="mcr-data")
    sv.add_argument("--port", type=int, default=8080)
    st = sub.add_parser("stats", help="print booking stats for a data dir")
    st.add_argument("--data", default="mcr-data")
    args = p.parse_args(argv)

    cfg = BusinessConfig.load(args.config) if args.config else BusinessConfig(
        name="Cool Air HVAC", owner_phone="+15550100999", service_zips=[])
    if args.cmd == "demo":
        demo(cfg)
    elif args.cmd == "serve":
        if not args.config:
            p.error("serve needs --config")
        from agents.missed_call_rescue.server import serve
        serve(args.config, args.data, args.port)
    else:
        print(json.dumps(RescueAgent(cfg, args.data).stats(), indent=2))


if __name__ == "__main__":
    main()
