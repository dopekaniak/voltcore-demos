# Skeptic Review — Estimate Revival + Missed-Call Rescue

## Verdict: 🔴 EXISTENTIAL RISK

The plan's first step is a sale nobody has made yet, and that step is the one the founder has avoided for months. Every number in the backtest assumes that calls get answered and some contractors say yes. The backtest's conversion inputs are also the same assumptions it was built on, so the $10.4k/mo result is only as good as an untested guess. The plan fails in month 2–4 if the first 100 calls don't produce pilots, and no current action guarantees those calls happen.

---

## The seven attack vectors

### 1. Competitive shift
The closest substitutes are field-service platforms that already ship estimate follow-up: Jobber, Housecall Pro and ServiceTitan are all marketing AI features to contractors in 2026, with ServiceTitan's residential follow-up queue on its roadmap. A contractor who already pays for one of these can switch on follow-up for $0–$99/mo. Our moat is not the software. It is the human call and the performance-only price. That moat is thin: it works only while contractors value a stranger calling their old customers more than their own software doing it. **Honest moat: low.**

### 2. AI commoditization
The calling itself is the piece AI voice agents will automate first. Within 12 months a contractor can point a voice agent at their estimate export for a few dollars a month. The human voice is only defensible if it converts measurably better, and nobody has measured that. The workflow survives (list cleaning, invoicing, suppression), but the thing the founder is best at, talking, is the part AI undercuts first. **Path to workflow-native:** own the performance-fee ledger (booked jobs, revenue, invoice) that voice agents don't have. That is the defensible piece and it is not built yet.

### 3. Distribution death spiral
The only distribution in the plan is cold calls to contractors. That's a single channel with no fallback, run by the one person who has avoided it. If 8 weeks of calls yield no pilots, there is no Plan B in the plan. The backup offer (Missed-Call Rescue at $297/mo) uses the same calls. **Plan B does not exist yet.**

### 4. Founder boredom and capacity
The founder has 35–45 hours a week at most, with class taking evenings. Calling is the bulk of the work and the least enjoyable. Once pilots exist, fulfillment (exports, scripts, follow-ups, reports, support texts) lands on the same person, and so does the class schedule. Hiring callers is in the backtest, but it needs about $2k/mo of profit first, which is roughly the point where the founder burns out. **Honest read: this is a 4–6 month sprint unless callers get hired by month 3.**

### 5. Pricing collapse
A 10% performance fee sounds risk-free, but contractors will ask "what if the job would have closed anyway?" and "what exactly counts as attribution?". A competitor offering a flat $99/mo AI follow-up undercuts the fee on any mid-size contractor. Worst case, contractors accept the offer but dispute attribution on every invoice, and the founder spends the time chasing payments. The backtest assumes 10% of revived revenue is collected 90% of the time. There is no evidence for either number.

### 6. Single points of failure
- **Contractor's data access:** the entire plan depends on contractors exporting their estimate history. Many small shops can't, or won't, do that cleanly. The backtest assumes a 60% usable-list rate, which is a guess.
- **Telephony and messaging:** Missed-Call Rescue needs Twilio plus US business-texting registration (A2P 10DLC). A registration rejection stops the product before the first sale.
- **Compliance:** texting homeowners is where the legal exposure sits. The TCPA allows $500 per violation, up to $1,500 if willful. One vendor claims $25k per text; I could not verify that against the statute, so treat it as unconfirmed. Quiet-hours and consent rules are enforced by plaintiffs' lawyers, and the rules differ for marketing versus service messages. Nothing in the plan has had legal review.

### 7. The polite question nobody asks
**"You said you were scared to call because you didn't have a product you could sell. The plan's first step is calling. What is different this time, and what will you do on the first day a contractor says no?"**

The user's reaction to this question is the most important diagnostic in the review. If the answer is about the product (the product is now better), it is avoidance dressed up as product work. If the answer is about the calling itself, the plan is ready to test.

---

## Top 3 risks, ranked by probability × severity

| # | Risk | Probability | Severity | Current mitigation | Playbook |
|---|---|---|---|---|---|
| 1 | No contractor signs a pilot because the calls don't happen or the pitch doesn't land | High | High | None executed yet | Commit to the 7-day test with written kill criteria (see `docs/7-day-test.md`). Make the first 25 calls on Saturday, before anything else. |
| 2 | Field-service software or a voice agent makes the list-cleanup service free | Medium | High | None | Position on the performance-fee ledger and the booked-job record, not the list. Track whether contractors would pay without the calls. |
| 3 | TCPA or A2P compliance blocks the homeowner-facing calls and texts | Medium | High | Revival pilots are run by the contractor's own staff, so the founder never calls homeowners directly | Get a one-hour review from a telecom lawyer before any homeowner contact. Do not send texts until A2P registration is approved. |

---

## What this plan is most likely to look like in month 9 if executed as-is

Month 9: the founder has spent six weeks cold-calling without a signed pilot, then landed two pilots that each produced one closed job. Revival income is $800/mo and falling because the backlog is exhausted. The Rescue upsell was never sold because no contractor reached the second step. The founder is still working evenings, is 9 weeks behind on the class project, and has stopped logging calls. The calls per week fell from 60 in month 1 to 8 in month 4. The founder is now deciding between an idea that never got tested and a new idea.

---

## Recommendation

1. Run the 7-day test in `docs/7-day-test.md` this coming weekend, before any other build work.
2. Settle the polite question out loud, in writing, before the first call.
3. Do not build more features until 100 dials and at least one signed pilot exist.
4. If the 7-day test passes its kill criteria, get the telecom review, then build the performance-fee ledger.
