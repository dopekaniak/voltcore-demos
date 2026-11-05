# Workspace: Quant Trading (research only)

Scope: strategy research and bot design. Paper mode only.
about_me.md and the changelog set trading to paper-only research for 90 days from 2026-10-23.

## Inputs
| Source           | File / location                                     | Section / scope                              | Why                                  |
|------------------|-----------------------------------------------------|----------------------------------------------|--------------------------------------|
| Operator context | ../../about_me.md                                   | Deployment Priority                          | Trading is deferred, paper-only      |
| Playbook         | ../../prompts/quant_and_trading/algo_bot_prompts.md | "Top-N Rotation & Prediction Market Bot"     | Bot design prompt                    |
| Safety caps      | ../../.env.example                                  | Trading safety caps block                    | Names of MODE and risk caps (never values) |

## Process
1. Confirm the strategy idea and the market (equities, crypto, or prediction markets).
2. Design or backtest only. Use `MODE=paper`. Never enable live execution.
3. Apply the caps by name from `.env` (`MAX_RISK_PCT_PER_TRADE`, `DAILY_LOSS_LIMIT_PCT`, `MAX_SLIPPAGE`). Do not hardcode values.
4. CHECKPOINT: operator reviews the design before any code runs against a live feed.

## Outputs
| Artifact        | Location                                  | Format             |
|-----------------|-------------------------------------------|--------------------|
| Strategy notes  | workspaces/quant-trading/output/          | Markdown           |
| Paper results   | workspaces/quant-trading/output/          | CSV or Markdown    |

## Isolation
Keep this logic out of lead-generation and inbox-triage folders (CLAUDE.md §1).
