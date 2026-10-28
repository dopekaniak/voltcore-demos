# Top 10 risks

Likelihood and impact are rated Low / Medium / High. Owners are roles; assign names at
kickoff.

| # | Risk | Likelihood | Impact | Mitigation | Owner |
| --- | --- | --- | --- | --- | --- |
| 1 | **Sandbox escape by AI-written forge code** (network access, file access, denial of service). | Medium | High | Static AST check; browser worker in a cross-origin sandboxed iframe with CSP; server child process under Node's permission model, memory cap, 20 s kill, no egress in production; tests for fetch, unlisted import, infinite loop (ADR-008). | Security lead |
| 2 | **Print cost underestimation** while quotes come from the estimator, not a slicer. | High | High | Estimate quotes are labeled and cannot be ordered in production (ADR-010); golden fixtures; reprice tolerance 2 %; ADR-002b to add a licensed slicer. | Print ops lead |
| 3 | **Slicer licensing** (AGPL-3.0 PrusaSlicer/CuraEngine; Bambu Studio reported AGPL). | Medium | High | No slicer in any shipped service until ADR-002b and counsel review (rule 6). | Counsel / CTO |
| 4 | **Provider price or terms change** (Meshy credit costs, retention, model retirement such as `lowpoly` on 2026-10-30). | Medium | Medium | Costs in seed data, not code; provider behind `ModelProvider`; mock always available; ADR-006 lists the facts we depend on. | Product lead |
| 5 | **Provider webhook unreliability** (no signature, out-of-order and duplicate deliveries). | High | Medium | Never trust the body; fetch-back by GET; dedupe on id + status; forward-only state; poll fallback after twice the typical time. | Backend lead |
| 6 | **Print partner quality** (failed prints, wrong material, late delivery). | Medium | High | QC state with automatic rework (max 2) then escalation; partner capacity checks; only mock partners until real contracts exist. | Print ops lead |
| 7 | **Shipping damage and loss.** | Medium | Medium | Problem report on orders, 14-day problem window, refunds with second approval above threshold; carrier insurance when a real carrier is integrated. | Support lead |
| 8 | **Chargebacks and payment fraud.** | Medium | Medium | Stripe Checkout only; `PAID` only on matching amount and currency; idempotent webhooks; audit log; refunds admin-initiated with reasons. | Finance lead |
| 9 | **Copyright claims on public models and generated content** (and creator fraud in Release 2 listings). | Medium | High | Licenses stored per model; moderation before listings go live; takedown workflow; payouts accrue only and are held for the problem window. | Trust & safety lead |
| 10 | **Tax compliance** (no automated tax collection in Release 1). | High | High | Stripe Tax before selling where collection is required; "tax calculated where applicable" copy; gap recorded in ADR-016. | Finance lead / counsel |
