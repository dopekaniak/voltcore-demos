# CONTEXT.md — Task Router (ICM Layer 1)

Read this file only when a task needs a prompt, playbook, or reference doc.
Then load ONE workspace contract from the table below, and only the sections it lists.

| If the task is about...                                  | Load                                          |
|----------------------------------------------------------|-----------------------------------------------|
| Local business lead scraping and outreach drafts         | workspaces/lead-generation/CONTEXT.md         |
| Inbox triage, chief-of-staff, money audit                | workspaces/inbox-triage/CONTEXT.md            |
| Algo / prediction-market bots (paper only)               | workspaces/quant-trading/CONTEXT.md           |
| UGC scripts and creator hook analysis                    | workspaces/content-ugc/CONTEXT.md             |
| Leverage and strategy prompts                            | workspaces/executive-strategy/CONTEXT.md      |
| Building the "Generate → Print" platform (Opus prompts)  | workspaces/opus-build/CONTEXT.md              |

## Rules

1. Always loaded: `CLAUDE.md` and `about_me.md`. Nothing else is loaded by default.
2. Do not read `prompts/` or `docs/opus-prompts/` wholesale. Each workspace contract names the exact file and section to read.
3. Workspaces never reference each other (one-way rule). Lead generation, inbox triage, and quant trading stay isolated (CLAUDE.md §1).
4. Write outputs only to the location a workspace contract names. Never write output into `prompts/` or `docs/`.
5. Secrets: read variable names from `.env.example`. Never read or print values from `.env`.
