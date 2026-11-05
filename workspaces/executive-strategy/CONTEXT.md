# Workspace: Executive Strategy

Scope: leverage and strategy prompts. Load one prompt section per run.

## Inputs
| Source           | File / location                                   | Section / scope                              | Why                     |
|------------------|---------------------------------------------------|----------------------------------------------|-------------------------|
| Operator context | ../../about_me.md                                 | Core Operations & Business Units             | Current business units  |
| Playbook         | ../../prompts/executive/leverage_and_strategy.md  | One section, chosen by the task:             |                         |
|                  |                                                   | "The Ruthless Leverage Finder"               | Find highest-leverage actions |
|                  |                                                   | "The Money Flow Hijacker"                    | Revenue-path analysis   |
|                  |                                                   | "The Time vs. Wealth Rewire"                 | Time allocation         |
|                  |                                                   | "The Perception Control & Unfair Advantage"  | Positioning             |

## Process
1. Pick the one section that matches the question. Do not load the others.
2. Ground the answer in about_me.md constraints (school 5–10:30 p.m. Mon–Fri, gig income).
3. Output a short recommendation with the top 3 actions.

## Outputs
| Artifact        | Location                                  | Format   |
|-----------------|-------------------------------------------|----------|
| Strategy memo   | workspaces/executive-strategy/output/     | Markdown |
