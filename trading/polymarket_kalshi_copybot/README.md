# Polymarket → Kalshi Copy Bot

Follows the top traders on the Polymarket leaderboard, watches every trade they make, finds the
equivalent market on Kalshi, and mirrors the trade there with hard risk caps. Their exits are mirrored too.
It runs in **paper mode by default**: fills are simulated against the live Kalshi order book, with no
account or money needed.

```
Polymarket leaderboard ──► top N wallets (by PnL, refreshed hourly)
        │
        ▼  poll /v2/activity every 30s
leader BUY/SELL fills ──► dedupe + aggregate ──► filters (size, price, age, slug)
        │
        ▼
match to Kalshi market + side  ──(unclear)──► review queue / optional LLM check (OmniRoute)
        │ (clear)
        ▼
risk sizing & caps ──► IOC limit order on Kalshi (paper or live) ──► positions, PnL, settlement
```

## Quick start (paper trading, no Kalshi account)

```bash
cd trading/polymarket_kalshi_copybot
pip install -r requirements.txt
cp .env.example .env            # defaults are paper mode + small caps

python -m copybot leaders       # who you'd be following right now
python -m copybot run           # start (first run downloads ~170k Kalshi markets, ~2 min, cached)
python -m copybot status        # paper cash, positions, PnL, last signals (in another terminal)
```

Stop with Ctrl-C. To pause new entries without stopping, `touch data/STOP` (delete it to resume).

## How a trade gets copied

1. **Leaders**: `/v2/leaderboard` (time period/category/PnL floor from `.env`), plus any wallets you add.
2. **Detection**: each leader's `/v2/activity?type=TRADE` is polled. On first sight of a leader the bot
   starts *from now* and never copies old history. Every fill is recorded, so a restart or retry
   can't copy the same trade twice.
3. **Filters**: leader size ≥ `MIN_LEADER_TRADE_USD`, price within `[MIN, MAX]_ENTRY_PRICE`, fresh
   (`MAX_TRADE_AGE_SEC`), not an ultra-short "up/down" crypto market.
4. **Matching** (`copybot/matcher.py`): turns the Polymarket outcome into a proposition and the Kalshi
   side that expresses it, for example:
   - `Spread: Mavericks (-3.5)` bought **Pacers** → Kalshi `Dallas wins by over 3.5 points` **NO**
   - `O/U 229.5` bought **Under** → Kalshi `Over 229.5 points` **NO**
   - `Will X win the 2028 Republican nomination?` **No** → Kalshi `KXPRESNOMR-28-X` **NO**

   Candidates are scored on wording overlap and expiry date. A match is auto-traded only if it passes
   every hard gate: same date window, same lines and thresholds, the outcome named on Kalshi's YES side,
   no meaning-changing word on only one side (vice, caucus, conference, first half, leave/out, 5pm EST…),
   and a clear lead over the next candidate. Anything less goes to the **review queue**. Team
   nicknames map to Kalshi's city labels through `aliases.json`, scoped by league.
5. **Sizing** (`copybot/risk.py`): `COPY_USD_PER_TRADE` (or leader size × `COPY_RATIO`) clipped by
   max order, % of equity, per-market cap, total exposure, daily spend, and available cash. Contracts are
   sized against the worst accepted price *plus fees*.
6. **Price guard**: the bot buys only if Kalshi's ask is ≤ the leader's fill price + `MAX_PRICE_GAP`. Orders
   are immediate-or-cancel limits, so they never rest on the book.
7. **Exits**: when a leader sells, the bot sells the same fraction of its position (worked out from the
   leader's remaining shares). Settled Kalshi markets are paid out in the books automatically.

## Commands

| Command | What it does |
|---|---|
| `run` / `run --once` | Run the copy loop (or one cycle) |
| `leaders` | Show the wallets being followed |
| `match <slug\|url\|condition_id> [--outcome X]` | Show how a Polymarket market maps to Kalshi |
| `review` | List matches waiting for a human decision |
| `approve <id> [--ticker T --side yes\|no]` / `reject <id>` | Decide a queued match. Future trades in it get copied (approve) or ignored (reject) |
| `status` | Cash/equity, open positions with marks, today's spend, recent signals |
| `check-kalshi` | Verify API keys and show the real Kalshi balance |
| `refresh-universe` | Re-download all open Kalshi markets now |

`market_map.json` (see `market_map.example.json`) pins or blocks specific Polymarket outcomes by hand.

## Going live (only after paper results justify it)

1. Create an API key in Kalshi (Account → API Keys). Save the private key **outside the repo**, e.g.
   `~/.kalshi/kalshi_private_key.pem`, and set `KALSHI_API_KEY_ID` + `KALSHI_PRIVATE_KEY_PATH`.
2. Rehearse on Kalshi's demo exchange first: `KALSHI_ENV=demo` with demo keys, `MODE=live`,
   `LIVE_TRADING_CONFIRM=I_ACCEPT_REAL_MONEY_RISK`, then `python -m copybot check-kalshi`.
3. Switch to `KALSHI_ENV=prod` with prod keys and keep the caps small.

Live orders use Kalshi's V2 endpoint (`POST /portfolio/events/orders`, YES-book `bid`/`ask`, dollar
prices). Each order's `client_order_id` is derived from the leader's fills, so a crash or retry can't
double-buy, and orders are never retried after a timeout.

## Things to know before trusting it with money

- **You are always late.** Fills show up in the API after the trade, and the bot polls every 30s. Leaders
  who scalp in-play sports or news will have moved the price before you see the trade; the
  `MAX_PRICE_GAP` guard skips those trades rather than chasing them.
- **Coverage is partial on purpose.** In a live sample of 182 open leader positions (Nov 2026), 31 (17%)
  auto-matched and 25 (14%) went to review; the rest had no clean Kalshi equivalent. Every auto-match in
  that sample was checked by hand and was correct (NBA/NFL moneylines, spreads and totals, nominations,
  esports, crypto thresholds). Enable `LLM_VERIFY_MODE=review` (local OmniRoute) or work the review queue to
  raise coverage.
- **Top-PnL wallets are not all copyable.** Some are market makers, arbitrageurs, or hedge across venues.
  Use `LEADER_WALLETS_EXCLUDE` and `LEADER_CATEGORY` to narrow the list.
- **Equivalent ≠ identical.** Polymarket and Kalshi can use different resolution sources, times, and tie
  rules. The gates catch the obvious mismatches; read the rules before approving review items.
- Paper fills assume you get only the displayed top-of-book size at the current ask, with Kalshi's
  standard taker fee formula. That's conservative, but not a promise of live results.

## Launch-hardening checklist (CLAUDE.md, 20 points)

| # | Item | Status |
|---|---|---|
| 1 | Rate limiting | Per-host request pacing; slower crawl for Kalshi's expensive event pages |
| 2 | API limits | Backoff on 429/5xx, honours `Retry-After`; page caps per poll |
| 3 | Spending caps | Per-order, % equity, per-market, total exposure, daily spend, orders/hour |
| 4 | Error handling | Per-signal isolation; a failed signal is logged and the loop continues |
| 5 | Loading states | Universe download logs progress; trades wait (`deferred`) until the matcher is ready |
| 6 | Empty states | Empty leaderboard, review queue, and positions all handled and reported |
| 7 | Failed requests | Typed `HttpError`; leader poll failures skip that leader for one cycle |
| 8 | API timeouts | Timeouts on every request; orders never retried after a read timeout |
| 9 | Duplicate subscriptions | Seen-fill table + per-leader watermark; leader list deduplicated |
| 10 | Duplicate payments | Deterministic `client_order_id` + unique DB constraint |
| 11 | Optimize DB queries | WAL mode, small hot-path queries |
| 12 | DB indexes | On signals, orders, positions, review queue, seen fills |
| 13 | Paginate large results | Cursor pagination on Kalshi events/positions and Polymarket activity |
| 14 | Compress files | Kalshi universe cache gzipped (~2.7 MB for 170k markets) |
| 15 | Limit upload size | N/A (no uploads) |
| 16 | Cache repeat requests | Universe cache on disk, Polymarket metadata cache, cached match decisions |
| 17 | Uptime monitoring | `data/heartbeat.json` each cycle + optional `HEALTHCHECK_URL` ping |
| 18 | Error logging | Rotating `data/copybot.log` (5 × 5 MB) |
| 19 | Test simultaneous users | N/A (single-operator bot); SQLite is thread-safe for the background refresh |
| 20 | Test backup restoration | **TODO.** Back up with `sqlite3 data/copybot.sqlite3 ".backup data/backup.sqlite3"`; a restore drill has not been run yet |

## Tests

```bash
python -m unittest discover -s tests -t .
```

The tests cover matching (spreads, totals, moneylines, President vs VP, nomination vs caucus, polarity
traps, date windows), Kalshi request signing (RSA-PSS and Ed25519), live order side/price mapping, risk
sizing and caps, and full paper-mode cycles: copy once, no history copying, partial exits,
settlement, kill switch, and the daily loss halt.

## Layout

```
copybot/
  config.py     settings from .env, live-mode safety checks
  polymarket.py leaderboard, activity, positions, Gamma metadata
  kalshi.py     signed client, universe crawl + gzip cache, V2 orders
  matcher.py    normalization, index, scoring, gates, side mapping
  risk.py       sizing, fees, caps
  executor.py   paper and live execution
  llm.py        optional OmniRoute match verifier
  engine.py     the loop: leaders → signals → match → trade → settle
  store.py      SQLite schema and queries
  cli.py        commands
aliases.json    nickname → Kalshi label maps (editable)
data/           runtime state, logs, caches (git-ignored)
```
