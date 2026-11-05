# Workspace: Opus Build ("Generate → Print" platform)

Scope: build the platform in stages. Each run loads the base prompt sections plus ONE addendum module.
The base build prompt is about 67 KB, and the four addenda total about 50 KB. Do not load them all.

## Inputs
| Source       | File                                                          | Section / scope                                       | Why                              |
|--------------|---------------------------------------------------------------|-------------------------------------------------------|----------------------------------|
| Base rules   | ../../docs/opus-prompts/opus-build-prompt.md                  | §0 Role and operating rules                           | Always                           |
| Base rules   | ../../docs/opus-prompts/opus-build-prompt.md                  | §1 Verified competitive facts                         | Always (do not re-derive)        |
| Stage        | ../../docs/opus-prompts/opus-build-prompt.md                  | The one section for the current stage (§2–§10)        | Only the stage being built       |
| Module 4 & 5 | ../../docs/opus-prompts/opus-addendum-customizer-and-fitment.md | §0 plus the one module section (§1 or §2)            | Customizer / fitment             |
| Module 6     | ../../docs/opus-prompts/opus-addendum-design-copilot.md       | §0 plus the one feature section (§1–§7)               | Design copilot                   |
| Module 7     | ../../docs/opus-prompts/opus-addendum-industry-parity.md      | §0 plus the one feature area (§2.x)                   | Industry parity                  |
| Module 8     | ../../docs/opus-prompts/opus-addendum-free-stl-community.md   | §0 plus the one feature (§2.x)                        | Free STL community               |

Do not load `docs/opus-prompts/opus-workable-prompt.md` in the same run. It is a second, shorter build prompt with a [BRAND] placeholder. Pick one base prompt per project (open question below).

## Process
1. Identify the stage and module. Load only the sections in the table.
2. Build in `repos/<platform-name>/`, not in this workspace folder.
3. Record decisions in `docs/decisions.md` as the addenda require. This file does not exist yet. Create it on the first decision.
4. CHECKPOINT: operator confirms the stack ADR (base prompt §3) before the data model is written.

## Outputs
| Artifact         | Location                         | Format        |
|------------------|----------------------------------|---------------|
| Code             | repos/<platform-name>/           | Source code   |
| Decisions (ADRs) | docs/decisions.md                | Markdown      |

## Open questions
- Which base prompt is canonical: `opus-build-prompt.md` (67 KB) or `opus-workable-prompt.md` (31 KB)?
