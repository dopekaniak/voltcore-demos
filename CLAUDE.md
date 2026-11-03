# CLAUDE.md — Master System & Operating Directives

## 1. Agentic Memory & Context Protocol
- On every session start, read `./about_me.md` to align with the operator's active business units, tech stack, and preferences.
- Whenever the operator shares new business decisions, API keys/endpoints, or workflow preferences, automatically append them to `./about_me.md` or `./memory/changelog.md`.
- Keep microservices strictly isolated: never mix Lead Generation logic, Inbox Triage logic, and Quant Trading logic in the same script or directory.

## 2. Coding & Architecture Standards
- Route LLM API calls through the local OmniRoute proxy (`http://localhost:20128/v1/chat/completions`) whenever applicable to optimize token costs and provider fallbacks.
- Never hardcode secrets or API keys in source files; always use `.env` and maintain a `.env.example` template.
- Before marking any web app, scraper, or automation ready for production, enforce the **20-Point Vibecoded Launch Hardening Checklist**:
  1. Add rate limiting
  2. Set API limits
  3. Set spending caps
  4. Add error handling
  5. Add loading states
  6. Add empty states
  7. Handle failed requests
  8. Handle API timeouts
  9. Prevent duplicate subscriptions
  10. Prevent duplicate payments
  11. Optimize DB queries
  12. Add DB indexes
  13. Paginate large results
  14. Compress files
  15. Limit upload size
  16. Cache repeat requests
  17. Add uptime monitoring
  18. Add error logging
  19. Test simultaneous users
  20. Test backup restoration

## 3. Installed Skills & Tool Routing
- **Paid Media Audits:** Use the `claude-ads` skill (`/ads start`, `/ads audit`, `/ads meta`, `/ads google`, `/ads tiktok`).
- **Programmatic Video Rendering:** Use `hyperframes` skills (`/hyperframes`) to build deterministic MP4 videos from HTML/CSS.
- **Anti-Detect Scraping:** Prefer `Camoufox` + Playwright for lead scraping to prevent anti-bot blocks.
