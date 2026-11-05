# Workspace: Opus Build ("Generate → Print" platform)

Scope: build the platform in stages. Each run loads the base prompt sections plus ONE addendum module.
The base prompt is about 31 KB. The four addenda total about 50 KB. Do not load them all.

## Inputs
| Source       | File                                                            | Section / scope                              | Why                        |
|--------------|-----------------------------------------------------------------|----------------------------------------------|----------------------------|
| Base rules   | ../../docs/opus-prompts/opus-workable-prompt.md                 | §0 What you are building, §1 Non-negotiable rules | Always                |
| Stage        | ../../docs/opus-prompts/opus-workable-prompt.md                 | The one section for the current stage (§2–§10) | Only the stage being built |
| Module 4 & 5 | ../../docs/opus-prompts/opus-addendum-customizer-and-fitment.md | §0 plus the one module section (§1 or §2)    | Customizer / fitment       |
| Module 6     | ../../docs/opus-prompts/opus-addendum-design-copilot.md         | §0 plus the one feature section (§1–§7)      | Design copilot             |
| Module 7     | ../../docs/opus-prompts/opus-addendum-industry-parity.md        | §0 plus the one feature area (§2.x)          | Industry parity            |
| Module 8     | ../../docs/opus-prompts/opus-addendum-free-stl-community.md     | §0 plus the one feature (§2.x)               | Free STL community         |

The addenda are written to attach after `opus-workable-prompt.md`. Use that file as the only base prompt.

## Process
1. Identify the stage and module. Load only the sections in the table.
2. Build in `repos/<platform-name>/`, not in this workspace folder.
3. Record decisions in `docs/decisions.md` as the addenda require. This file does not exist yet. Create it on the first decision.
4. CHECKPOINT: operator confirms the stack (base prompt §2) before the data model (§7) is written.

## Outputs
| Artifact         | Location                | Format      |
|------------------|-------------------------|-------------|
| Code             | repos/<platform-name>/  | Source code |
| Decisions (ADRs) | docs/decisions.md       | Markdown    |
