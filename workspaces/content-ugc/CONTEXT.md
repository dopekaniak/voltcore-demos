# Workspace: Content and UGC Pipelines

Scope: high-retention short-form scripts and creator hook analysis.

## Inputs
| Source           | File / location                                           | Section / scope                                  | Why                       |
|------------------|-----------------------------------------------------------|--------------------------------------------------|---------------------------|
| Operator context | ../../about_me.md                                         | Core Operations (item 3)                         | UGC is a low-cost test    |
| Playbook         | ../../prompts/content_and_ugc/ugc_and_video_pipelines.md  | "SideShift & High-Retention UGC Script Generator" | Script generation rules   |
| Playbook         | ../../prompts/content_and_ugc/ugc_and_video_pipelines.md  | "Creator Hook Cloner"                            | Hook analysis rules       |

## Process
1. Load only the section that matches the request (script or hook analysis).
2. Write the script or hook breakdown. Keep it short and direct.
3. Video rendering, if needed: use the `hyperframes` skill (CLAUDE.md §3). Do not load other playbooks.
4. CHECKPOINT: operator approves the script before any asset generation.

## Outputs
| Artifact     | Location                                | Format   |
|--------------|-----------------------------------------|----------|
| Script       | workspaces/content-ugc/output/          | Markdown |
| Hook notes   | workspaces/content-ugc/output/          | Markdown |
