# Architecture

## Pipeline

1. Manual, 15-minute schedule, 07:30 Sofia digest or TradingView webhook starts the workflow.
2. Runtime configuration is loaded from self-hosted n8n environment variables.
3. Four batched Twelve Data requests collect 5m, 15m, 1h and 4h OHLC series.
4. The deterministic engine calculates indicators, data freshness and multi-timeframe agreement.
5. Trading Economics provides the current and next-day calendar.
6. Relevant high-impact events put affected instruments into \`WAIT_EVENT\`.
7. GDELT provides recent macro and market headlines.
8. Qwen explains the already-calculated scenarios in Russian and English.
9. A validator rebuilds all numeric signal lines from deterministic data.
10. Signal lifecycle logic detects new, updated, cancelled, TP-hit and SL-hit states.
11. Static workflow data records a compact audit/performance snapshot and suppresses duplicate notifications.
12. Reports can be delivered through Telegram and WhatsApp.

## Signal rules

Each timeframe receives a signed score from:

- price versus EMA 20 and EMA 200;
- EMA 20 versus EMA 50;
- price versus the Ichimoku cloud;
- Tenkan versus Kijun;
- RSI regime;
- break or rejection of Yesterday High/Low.

Timeframes are weighted, then combined. Weak agreement returns \`WAIT_CONFIRMATION\`. Stale feeds return \`STALE_DATA\`. A relevant high-impact event inside the configured blackout window returns \`WAIT_EVENT\`.

Five independent strategies vote on direction: trend following, momentum, breakout, Fibonacci OTE pullback and mean reversion. The ensemble and timeframe agreement determine the opportunity score. The highest score is not a profit guarantee; it is a risk-adjusted ranking of the best currently confirmed setup.

## Risk levels

- Entry is the Fibonacci 62%-79% OTE zone when the current impulse and direction agree and price is sufficiently close.
- Otherwise Entry is an ATR-based retest zone.
- SL is beyond recent structure and at least 1.6 ATR from the entry midpoint.
- TP1, TP2, TP3 and TP4 are 1R, 1.5R, 2R and 3R.
- The LLM cannot replace these values.

## TradingView integration

TradingView does not expose a general-purpose public endpoint for reading an authenticated user chart. The supported integration is an alert webhook. TradingView posts indicator and strategy values from the chart to the n8n HTTPS endpoint. The payload is treated as confirmation context, not as a substitute for fresh OHLC data.

Example TradingView alert message:

\`\`\`json
{
  "secret": "REPLACE_WITH_LONG_RANDOM_SECRET",
  "ticker": "{{ticker}}",
  "exchange": "{{exchange}}",
  "interval": "{{interval}}",
  "close": "{{close}}",
  "time": "{{time}}",
  "alertName": "NICS confirmation",
  "strategyAction": "none"
}
\`\`\`

Never put API keys, broker credentials or passwords into a TradingView alert body.

## Deliberate exclusions

- no broker order placement;
- no martingale or automatic position sizing;
- no fabricated signal when data is missing;
- no TradingView screen scraping;
- no LLM-generated price levels;
- no claim of guaranteed or maximum profit;
- no activation before keys and manual validation are complete.
