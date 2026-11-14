# Vibecoded App Hardening Checklist

Applies to every online business app, scraper, webhook, and automation in this workspace.
Companion to the 20-point launch checklist in `CLAUDE.md` (section 2). Run both before any app goes live.

Scope note: the source list is a short-form video ("20 ways a stranger hacks your vibecoded app"). Several items are real and well documented; others are vague or are platform patches (CDN/server), not app code. Each item below says what to check and whether it usually applies.

## The 20 items

| # | Item | Real-world check | Applies when |
|---|------|------------------|--------------|
| 1 | HTTP/2 Rapid Reset (CVE-2023-44487) | Confirm the host/CDN (Vercel, Cloudflare, Shopify, etc.) is patched; enable its rate limiting. You don't patch this in app code. | Any public site |
| 2 | 52-char username | Enforce max lengths on every text field, username, and API payload. | Any user input |
| 3 | SAML bypass (CVE-2024-45409) | Don't hand-roll SAML. Use a vetted auth provider and keep it updated. | You run SAML/SSO |
| 4 | nOAuth email spoof | Link accounts by the provider's stable subject ID, not by email, unless the email is verified. | OAuth login |
| 5 | GraphQL aliases brute force | Limit query depth, complexity, and aliases per request; rate limit per operation. | GraphQL API |
| 6 | 2FA code replay | Make codes single-use with short expiry; reject reuse. | 2FA/OTP |
| 7 | ReDoS regex | Don't run nested-quantifier regex on user input; cap input length. | Regex on input |
| 8 | JWT alg confusion | Pin the verify algorithm explicitly; reject `alg: none`; never accept HS256 with a public key. | JWT auth |
| 9 | Request smuggling | Keep the reverse proxy/server patched; avoid custom HTTP parsing. | Self-hosted proxy |
| 10 | Cache poisoning via X-Forwarded-Host | Never build absolute URLs from forwarded headers; set explicit base URLs; vary cache keys. | Cached pages |
| 11 | Spoofed IP header | Trust `X-Forwarded-For` only from your own proxy; rate limit on the real client IP. | Rate limiting |
| 12 | Views bypass RLS (Supabase) | Enable RLS on every exposed table; use `security_invoker` views; test with the anon key. | Supabase |
| 13 | Math.random tokens | Use `crypto.randomUUID()`, `crypto.getRandomValues()`, or Python `secrets`. | Tokens, reset links |
| 14 | Timing attack | Compare secrets with `hmac.compare_digest` / `crypto.timingSafeEqual`. | Token/signature checks |
| 15 | Padding oracle | Use authenticated encryption (AES-GCM); return generic errors. | Custom crypto |
| 16 | Prototype pollution | Validate input with a schema; don't deep-merge untrusted objects. | Node/JS apps |
| 17 | Template injection | Never render user input as a template; keep autoescaping on. | Server templates |
| 18 | XXE file read | Disable external entity resolution in XML parsers. | XML input |
| 19 | WebSocket hijack | Check `Origin` on the handshake and authenticate on connect. | WebSockets |
| 20 | Unicode username collisions (Spotify, 2013) | Normalize usernames (NFKC + casefold) before uniqueness checks; reject lookalike characters. | Usernames/signup |

## Universal items (from CLAUDE.md, run for every app)
- Rate limiting, API limits, spending caps, error handling, timeouts, duplicate payment/subscription guards
- Loading, empty, and failed-request states; paginate large results; cap upload size
- Secrets only in `.env` (never in source); keep `.env.example` current
- Error logging, uptime monitoring, a simultaneous-user test, and a restore test from backup

## Status: `voltcore-demos` (as of 2026-11-14)
- `scripts/camoufox_lead_scraper.py`: no login, no public endpoints. Items 1, 3–10, 12–19 are N/A. Applied: webhook must be HTTPS (or localhost), optional `X-Webhook-Token`, `--max-leads` capped at 200, timezone-aware timestamps. Item 20 is N/A (no usernames).
- Not yet verified: the live businesses (Shopify stores, LaunchLocal demo sites on Vercel, any Supabase/Base44 apps). They aren't in this repo, so each needs its own pass against this checklist.
