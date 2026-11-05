# Workspace: Inbox Triage and Chief of Staff

Scope: triage messages, draft replies, and run the money audit. Draft-only mode.
This workspace never sends email and never moves money.

## Inputs
| Source           | File / location                                          | Section / scope                              | Why                              |
|------------------|----------------------------------------------------------|----------------------------------------------|----------------------------------|
| Operator context | ../../about_me.md                                        | Schedule & Constraints                       | Time blocks and income constraints |
| Playbook         | ../../prompts/operations/chief_of_staff_and_inbox.md     | "AI Chief of Staff"                          | Triage and prioritization rules  |
| Playbook         | ../../prompts/operations/chief_of_staff_and_inbox.md     | "AI Inbox Manager (Draft-Only Mode)"         | Reply drafting rules             |
| Playbook         | ../../prompts/operations/chief_of_staff_and_inbox.md     | "Money Audit Engine"                         | Only when the task is a billing audit |

## Process
1. Read only the playbook section that matches the task. Load the other sections only if asked.
2. Sort incoming items into: act today / reply this week / archive / ignore.
3. Draft replies in the operator's direct style (about_me.md, Communication Style).
4. CHECKPOINT: operator approves each draft. No sends.
5. Money audit: list active subscriptions and trials with renewal dates. Flag unused ones for cancellation. Do not cancel anything.

## Outputs
| Artifact            | Location                              | Format                 |
|---------------------|---------------------------------------|------------------------|
| Triage list         | workspaces/inbox-triage/output/       | Markdown               |
| Reply drafts        | workspaces/inbox-triage/output/       | Markdown, "DRAFT" tag  |
| Billing audit       | workspaces/inbox-triage/output/       | Markdown table         |
