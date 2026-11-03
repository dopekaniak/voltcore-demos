# 7-Day Test — Estimate Revival

**Goal:** find out whether a real contractor will pay a performance fee for a revival campaign, before building anything else.

**Rule:** kill criteria are written here before the first call. If a criterion trips, you stop and change the offer or niche. You don't argue yourself out of it.

---

## Before day 1 (tonight, 30 min)

- [ ] Export your lead-generator CSV. Keep only HVAC and roofing shops with 20+ reviews and no website, or a weak one.
- [ ] Run the copilot to build the queue:
      `python3 -m agents.setter_copilot queue <your_leads.csv> --offer revival`
- [ ] Pick the first 25 shops from the top of the queue.
- [ ] Read `data/sample/setter_pack_web_agency.json` and the Revival pitch in `agents/setter_copilot/pitches.py` out loud, three times, until the opener doesn't sound like a script.
- [ ] Write the answer to the polite question from `docs/skeptic-review.md` in your own words. Keep it in the repo.

## Who the offer is for, and the lowest-risk pilot

Pitch to the **owner** of the contractor. The pilot is run by **their own staff** using your script. You never call homeowners directly. This keeps the telecom exposure off you until a lawyer has reviewed the homeowner side. Before you pitch, check whether the shop can export estimate history from Jobber, Housecall Pro, ServiceTitan or QuickBooks.

## The schedule

You have class 5:30–10:30 pm weekdays, so the calls happen during the day and on weekends.

| Day | Block | Target |
|---|---|---|
| 1 (Sat) | 4 hours of calls to shop owners | 40 dials, 8 conversations, 2 meetings booked |
| 2 (Sun) | 3 hours of calls + 1 pitch meeting if booked | 30 dials, 6 conversations, 1 meeting |
| 3 (Mon, lunch) | 1 hour of calls + log everything | 15 dials |
| 4 (Wed, lunch) | 1 hour of calls | 15 dials, 2 more meetings |
| 5 (Sat) | Meetings; show the 20-estimate sample | Pilot offers out |
| 6 (Sun) | Follow-up calls on open offers | 20 dials |
| 7 (Mon, lunch) | Read the numbers, decide | No new dials until the decision is logged |

Log every dial with `python3 -m agents.setter_copilot session <csv> --offer revival`. The funnel stats are the test.

## Pass / kill criteria (set now)

| Check (end of day 7) | Pass | Kill / change |
|---|---|---|
| Dials logged | ≥100 | <50: the blocker is you calling, not the offer. Stop and run `/money-diagnose` before anything else. |
| Conversations with the decision-maker | ≥15 | <8 after 100 dials: the list or the pitch is wrong. Change the niche (try roofing or plumbing) and rerun. |
| Meetings booked | ≥5 | 0 after 15 conversations: the pitch isn't landing. Test Missed-Call Rescue at $297/mo as the lead offer. |
| Signed pilots | ≥2 | 0 after 5 meetings: the performance fee is the problem. Test a flat $300 setup plus $99/mo. |
| Usable estimate exports | ≥2 of the pilots | 0: the list-cleaning promise doesn't work for these shops. Change the offer to missed-call only. |
| Your own log | Every call written down | Any gap: the result is invalid. Redo the day. |

**Any pass is a pass only if you can name the shop and show the signed pilot.**

## What you're NOT doing in the 7 days

- Building any new features.
- Sending texts to homeowners (wait for the telecom review and A2P registration).
- Hiring callers.
- Spending money beyond the phone number and a shared sheet.

## After day 7

1. Run `python3 -m backtest --calibrate <call_log.csv> --offer revival` with your real dials.
2. Write the result in `docs/7-day-test-results.md`: every number from the funnel, the criteria that tripped, and the one decision you made.
3. If it passed: book a one-hour telecom lawyer review, then build the performance-fee ledger.
4. If it failed: change the one thing the kill criteria named, and run another 7 days. Don't change two things at once.

## Legal guardrails (not legal advice)

- Calls and texts only between 9am and 8pm, never Sunday.
- Any opt-out goes into the suppression list immediately (the copilot does this).
- Don't send texts until A2P 10DLC registration is approved.
- Get a telecom lawyer's review of homeowner-facing calls and texts before any homeowner contact.
