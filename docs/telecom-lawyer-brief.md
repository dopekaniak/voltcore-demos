# Telecom Counsel Brief — Calls and Texts to Home-Service Customers

**Purpose:** a one-hour review before any homeowner-facing calls or texts. This is a brief for counsel to check, not legal advice. Nothing here has been reviewed by a lawyer.

**Prepared for:** a US telecom / TCPA attorney.
**Business:** solo founder testing a service that helps HVAC and roofing contractors call their own past customers about unfinished estimates, and texts homeowners who call a contractor and miss an answer.

---

## 1. Facts counsel needs

| # | Product / flow | Who initiates | Who is called or texted | Channel | Content |
|---|---|---|---|---|---|
| A | **Estimate Revival pilot** | Contractor's own staff, using a script we write | Contractor's past customers who received an estimate, not yet booked | Phone call (live or voicemail); optional text if the customer gave consent | Follow-up on a quote the customer already received |
| B | **Estimate Revival, founder-run** (not yet approved; we want to rule this out) | Founder, on the contractor's behalf | Same customer list | Phone call | Same |
| C | **Missed-Call Rescue** | The homeowner called the contractor first | The homeowner who called | Text reply to an inbound call, then texts in a booking thread | Scheduling, service questions, STOP handling |
| D | **Lead cold calls to contractors** | Founder | Business owners (not households) | Phone call | Offering the service to the contractor |

Items to confirm for counsel:
- Which contractor-owned number makes the calls in A, and whether it is registered as the business.
- Whether the founder ever touches a homeowner's number in A or B (the plan says no; counsel should confirm the design holds).
- Where the customer list comes from: the contractor's own system export, with no purchased or scraped lists.

---

## 2. Questions for counsel

### Calls (Flow A, B)
1. Does an **established business relationship** cover a contractor calling its own customers about an estimate given within the past 18 months? If so, what are the limits (time window, scope, whether a prior estimate counts)?
2. Does the **National Do-Not-Call Registry** apply to these calls? Is an existing business relationship enough to call a number that is on the registry?
3. Is a call from a contractor's staff to its own customer a "telephone solicitation" under the TCPA, or a call about an existing transaction that is exempt?
4. What is required for **voicemail drops** (prerecorded or AI-generated audio)? Are pre-recorded messages allowed without consent under this relationship?
5. Does **AI-generated voice** change the analysis? (Our copilot writes scripts; a human reads them. We want to avoid any automated dialer.)
6. Who is liable if a contractor's staff member goes off-script? Do we need contract terms or a script-approval step?

### Texts (Flow A optional, C)
7. For **Flow C**, a homeowner texts STOP or replies to a booking thread, which is an inbound conversation. Does the first outbound reply to an inbound call fall under prior express consent? Is the auto-text sent when the call is missed treated the same way?
8. For **Flow A texts**, what written consent is needed under the Do-Not-Call and TCPA rules? (A recent district court ruling said a keyword opt-in on a marketing list counts as prior express permission, but it also held that Do-Not-Call claims need heightened written consent. Counsel should confirm this is accurate and whether it applies in our circuit.)
9. What **quiet hours** apply? Our default is 9am–8pm local time, never Sunday, which is stricter than the federal 8am–9pm window. Is the stricter default right, and do any states set different rules we should code in?
10. Is a **service reminder** or **estimate follow-up** a marketing message or a transactional one? Does the answer change the consent we need?
11. What **A2P 10DLC** registration is required for a small business texting service, and what happens if a carrier rejects the brand?
12. What **opt-out language** and **keyword handling** are required? Does "STOP" have to be honored across the whole business or just the thread?

### Liability and exposure
13. What is the realistic exposure per violation under the TCPA ($500 per violation, up to $1,500 if willful or knowing)? What is the exposure under state mini-TCPA laws in the states we target (Ohio and the Columbus market are the first test)?
14. Does a class action risk change if we run the same script across many contractors?
15. Do we need **insurance** (E&O, cyber, or TCPA coverage) before the first pilot?
16. Does a **contract with the contractor** shift liability for their staff's calls? What clauses are needed (indemnity, script approval, consent confirmation, list-ownership warranty)?
17. Does a **performance fee** tied to booked jobs change the analysis (for example, a "paid per booking" arrangement that looks like a lead-generation or telemarketing arrangement)?

### Data
18. What do we store (phone numbers, call outcomes, opt-outs), and for how long? Does the suppression list need to be shared with the contractor?
19. Is the copilot's call log (`setter-data/call_log.csv`) a record counsel should advise us to keep for a set period?

---

## 3. What the team has already built against these risks

- Calls and texts are scheduled only 9am–8pm local time, never Sunday (`agents/common/compliance.py`).
- STOP and plain-English opt-outs (for example "don't call me") are added to a permanent suppression list and checked before every call or text (`agents/common/compliance.py`, `agents/estimate_revival/agent.py`).
- Texts to homeowners in the Revival flow are only generated for customers marked `sms_consent=yes`.
- Missed-Call Rescue handles emergencies by alerting the owner, not by sending automated scheduling replies.
- The Revival pilot is designed so the contractor's staff makes the calls from a script, not an automated dialer.

**Known gaps:**
- Inbound-call text replies are coded, but no A2P registration has been filed.
- The homeowner-facing script has not been reviewed for disclosures.
- Voicemail scripts are written but no decision has been made about prerecorded audio.
- Location-based time zones use the business's timezone, not the customer's. This needs a fix before any multi-state use.

---

## 4. Stop-ship conditions (do not run any homeowner contact until these are answered)

- [ ] Counsel confirms the established-business-relationship position for Flow A, including the time window.
- [ ] Counsel confirms the Do-Not-Call position for calls to registered numbers.
- [ ] Counsel confirms whether texts in Flow A need written consent, and what form.
- [ ] A2P 10DLC registration is approved for the texting number.
- [ ] Contractor contract includes script approval, list-ownership warranty, and indemnity.
- [ ] Time-zone logic uses the customer's local time.
- [ ] Counsel has reviewed the homeowner scripts and voicemail text.

---

## 5. Materials to send counsel

- This brief
- `agents/estimate_revival/agent.py` (the script generator and suppression logic)
- `agents/missed_call_rescue/conversation.py` (the text flow)
- `agents/common/compliance.py` (quiet hours, opt-out detection)
- `docs/7-day-test.md` (the pilot design)
- The homeowner scripts from `agents/estimate_revival/agent.py` (`script_for`)

---

## 6. Sources reviewed before writing this brief (web search, not legal review)

- Quiet-hours coverage and the 2025 industry petition to the FCC on consenting recipients: Squire Patton Boggs, Nixon Peabody and Mondaq summaries (2026).
- *King v. Bon Charge* (D. Del., Apr. 30, 2026) on keyword opt-in as prior express permission and the heightened written-consent requirement for Do-Not-Call claims: summarized in a BMD LLC post.
- Statutory damages: $500 per violation, trebled to $1,500 for willful or knowing violations. A vendor blog claimed $25k per text; that figure was not verified and is not used here.

Counsel should verify each of these against primary sources (47 U.S.C. § 227, 47 C.F.R. § 64.1200, and current FCC orders) before relying on them.
