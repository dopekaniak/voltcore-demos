# Memory Changelog

Append new business decisions, API endpoints/keys (names only, never values), and workflow preferences here with a date.

- 2026-10-23: Workspace initialized (about_me.md, CLAUDE.md, .mcp.json, scripts/install_ai_stack.sh, prompt library).
- 2026-10-23: Revenue target: "as much as possible, anything is better than nothing" (no fixed number yet).
- 2026-10-23: Preference: run locally where possible, use open-source tools, minimize API credit spend.
- 2026-10-23: Recommended focus: LaunchLocal Web Design (primary); UGC pipelines as a low-cost test (secondary); trading stays paper-only/research for 90 days; industrial/electrical deferred.
- 2026-10-23: Schedule: school Mon–Fri 5:00–10:30 p.m. is the only fixed commitment; all other hours are available. Current income is gig work (DoorDash, Walmart, Spark), so build time competes with it.
- 2026-10-23: Active accounts (names only): Anthropic Claude Pro ($20/mo, subscription, not API billing); "NAN" subscription; "RYZ" subscription; two Shopify stores; possibly 1–2 forgotten Shopify trials that may auto-bill. Action item: audit billing and cancel unused trials before they convert.
- 2026-10-23: Deployment decision: LaunchLocal lead pipeline is the first project. Shopify and UGC deferred.
- 2026-10-23: n8n Gmail check: the "Gmail account" credential (id P2oF4bFHAhGZZnMC) used by all VoltCore workflows is dopekaniak@gmail.com (verified by matching Gmail message IDs). "Gmail account 2" is unused by VoltCore.
- 2026-10-23: New n8n workflow "VoltCore - Gemini Leads Import" (Q2ix3UcAvZ44ZhTq, active): daily 10:15am ET, reads the newest "Gemini Daily Leads" email in dopekaniak Gmail, extracts businesses with Claude Haiku, adds up to 15 new website-less leads to the VoltCore Cold-Call Hit List, posts the list to #websiteless-scrapper. Sends nothing to businesses.
- 2026-10-23: "VoltCore - Lead Research & Drafts" now runs daily at 10:30am ET (was Mon/Wed/Fri 9am) so imported Gemini leads get researched and drafted the same day; prompt no longer invents a demo link for leads without one.
