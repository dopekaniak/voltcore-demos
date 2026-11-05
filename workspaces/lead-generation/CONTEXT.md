# Workspace: Lead Generation (LaunchLocal)

Scope: find local businesses, tier them by website presence, draft outreach for approval.
Nothing is sent without operator approval (about_me.md, Deployment Priority).

## Inputs
| Source           | File / location                        | Section / scope                 | Why                                      |
|------------------|----------------------------------------|---------------------------------|------------------------------------------|
| Operator context | ../../about_me.md                      | Deployment Priority             | Approval rule and current priority       |
| Extractor        | ../../scripts/camoufox_lead_scraper.py | Full file                       | Camoufox anti-detect scraper and CLI     |
| Config names     | ../../.env.example                     | Lead scraper block              | Env var names only (never values)        |

## Process
1. Confirm the search query with the operator (business type + city).
2. Run the extractor, for example:
   `python scripts/camoufox_lead_scraper.py -q "HVAC contractors in Mooresville NC" -m 25 --only-websiteless`
   It writes CSV and JSON to `./projects/leads/`.
3. Tier results: no website or social-only links = Priority 1. Everything else = lower tier.
4. Draft one outreach message per Priority 1 lead. Drafts only. Do not send anything.
5. CHECKPOINT: operator approves the lead list and drafts before any send step.

## Outputs
| Artifact        | Location                    | Format                              |
|-----------------|-----------------------------|-------------------------------------|
| Lead list       | ./projects/leads/           | CSV + JSON (written by the script)  |
| Outreach drafts | ./projects/leads/           | Markdown, marked "PENDING APPROVAL" |
