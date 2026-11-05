# CLAUDE.md — Master System & Operating Directives

## 1. Agentic Memory & Context Protocol
- On every session start, read `./about_me.md` to align with the operator's active business units, tech stack, and preferences.
- Whenever the operator shares new business decisions, API keys/endpoints, or workflow preferences, automatically append them to `./about_me.md` or `./memory/changelog.md`.
- Keep microservices strictly isolated: never mix Lead Generation logic, Inbox Triage logic, and Quant Trading logic in the same script or directory.
- Efficiency: start each unrelated task with `/clear`; use a subagent for broad searches so raw output stays out of the main context.
- Token-scoped context (ICM): for any prompt, playbook, or doc task, read `./CONTEXT.md`, then load ONLY the one `workspaces/<name>/CONTEXT.md` it routes to and only the sections that file lists. Do not read `prompts/` or `docs/opus-prompts/` wholesale.

## 2. Coding & Architecture Standards
- Route LLM API calls through the local OmniRoute proxy (`http://localhost:20128/v1/chat/completions`) whenever applicable to optimize token costs and provider fallbacks.
- Never hardcode secrets or API keys in source files; always use `.env` and maintain a `.env.example` template.
- Before marking any web app, scraper, or automation ready for production, enforce the **20-Point Vibecoded Launch Hardening Checklist** in `docs/launch-checklist.md` (load it only at that step).

## 3. Installed Skills & Tool Routing
- **Paid Media Audits:** Use the `claude-ads` skill (`/ads start`, `/ads audit`, `/ads meta`, `/ads google`, `/ads tiktok`).
- **Programmatic Video Rendering:** Use `hyperframes` skills (`/hyperframes`) to build deterministic MP4 videos from HTML/CSS.
- **Anti-Detect Scraping:** Prefer `Camoufox` + Playwright for lead scraping to prevent anti-bot blocks.
