# voltcore-demos

Three sellable automations for home-service contractors, plus a backtest that compares
the businesses built on them. Pure Python 3.12+ standard library: nothing to install, $0 to run.

| Agent | What it does | Who pays |
|---|---|---|
| `agents/estimate_revival` | Ranks a contractor's old unsold estimates, writes a call script per customer, logs outcomes, invoices 10% of revived jobs | Contractor, performance fee |
| `agents/missed_call_rescue` | Texts back every missed call, books the job by SMS, flags emergencies to the owner (Twilio webhook server included) | Contractor, ~$297/mo |
| `agents/setter_copilot` | Cold-call copilot for **your** lead list: next lead, script, objection comebacks, follow-up cadence, real funnel stats | You use it to sell the two above, or for a commission-setter gig |

## Quick start

```bash
python3 data/generate_sample.py                     # fake data (555-01XX numbers, reach no one)

# 1. Estimate Revival
python3 -m agents.estimate_revival --business "Cool Air HVAC" --caller Jordan prioritize data/sample/estimates.csv --out campaign
python3 -m agents.estimate_revival log --out campaign --lead E0098 --outcome booked
python3 -m agents.estimate_revival --business "Cool Air HVAC" report --out campaign --closed closed_jobs.csv

# 2. Missed-Call Rescue - show a contractor exactly what their customers would get
python3 -m agents.missed_call_rescue --config data/sample/business.json demo
python3 -m agents.missed_call_rescue --config data/sample/business.json serve --port 8080   # Twilio webhooks

# 3. Setter Copilot on your lead generator's CSV
python3 -m agents.setter_copilot queue   your_leads.csv --offer revival
python3 -m agents.setter_copilot session your_leads.csv --offer revival --me Jordan
python3 -m agents.setter_copilot session your_leads.csv --pack-file data/sample/setter_pack_web_agency.json

# Backtest
python3 -m backtest                     # hiring allowed once profitable
python3 -m backtest --solo              # never hire
python3 -m backtest --haircut 0.5       # stress test: you convert at half the assumed rate
python3 -m backtest --calibrate setter-data/call_log.csv --offer revival   # use YOUR real numbers

python3 -m unittest discover -s tests -t .
```

Lead CSVs are matched loosely (`business_name`/`name`, `phone`, `city`, `rating`, `reviews`, `website`),
so most lead-generator exports work as-is.

**Live Missed-Call Rescue:** set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `PUBLIC_URL`, then point the
Twilio number's Voice webhook at `/voice` and its Messaging webhook at `/sms`. Webhook signatures are verified.
US business texting needs A2P 10DLC registration in Twilio first.

**Optional AI:** `VOLTCORE_AI=1` plus Anthropic credentials (e.g. `ANTHROPIC_API_KEY`, `pip install anthropic`)
lets Claude polish openers and read free-form texts. Templates are used whenever it's off or fails.

## Backtest results (2,000 simulated years each)

Net profit to you per month. Full tables are in [`results/`](results/), and every assumption, with its source, is in
[`backtest/assumptions.py`](backtest/assumptions.py).

| | Estimate Revival | **Revival + Rescue upsell** | Missed-Call Rescue | Commission Setter |
|---|---|---|---|---|
| Median month 6 | $7,351 | **$8,363** | $4,358 | $2,471 |
| Median month 12 | $8,237 | **$10,352** | $8,223 | $2,495 |
| Bad-luck month 12 (p10) | $2,486 | $4,192 | **$4,658** | $821 |
| Chance of $10k+/mo by month 12 | 39% | **52%** | 28% | 0% |
| Median 12-month total | $86,929 | **$102,853** | $60,052 | $29,580 |
| Median $/hour, month 6 | $57 | **$69** | $31 | $18 |

What this does and doesn't tell you:
- It's a simulation built on published benchmarks (mostly vendor-published) and labeled assumptions, not
  historical data. **The cold-call connect and booking rates drive almost everything**: at half the assumed rates
  (`--haircut 0.5`), every model lands under ~$1.6k/mo median at month 12. Your first 100 logged dials matter more than any number here.
- Month-to-month zig-zag comes from 4- vs 5-week months and lumpy revival payouts.

## Compliance defaults (not legal advice)

Calls and texts only 9am-8pm and never Sundays. STOP and plain-English opt-outs are honored permanently across
runs. Revival calls are made on the contractor's behalf, to their own past customers. Follow-up texts are only
generated for customers marked `sms_consent=yes`. Check your state's rules before calling.
