# NICS Professional Market Intelligence Agent

Production-oriented market intelligence workflow for the NICS AI Ecosystem. It combines deterministic technical analysis, official TradingView alert webhooks, macroeconomic events, financial news and a Qwen explanation layer.

The workflow never lets the language model calculate or alter Entry, TP1-TP4 or Stop Loss. Those levels are produced by tested JavaScript. Qwen receives the finished market snapshot and explains why the scenario may matter.

## What it does

- scans gold, silver, major FX pairs, WTI/Brent and BTC/ETH/SOL;
- uses 5m, 15m, 1h and 4h OHLC data;
- calculates EMA 20/50/200, RSI 14, ATR 14, Ichimoku, Fibonacci OTE and Yesterday Box;
- scores multi-timeframe trend agreement;
- runs a five-strategy ensemble: trend, momentum, breakout, OTE pullback and mean reversion;
- supports conservative, balanced and aggressive risk profiles;
- ranks opportunities by confidence, timeframe agreement and strategy agreement;
- returns LONG, SHORT or WAIT with Entry zone, TP1-TP4, SL and confidence;
- blocks actionable signals around relevant high-impact economic events;
- marks stale or incomplete market data instead of guessing;
- accepts TradingView alerts through an authenticated HTTPS webhook;
- produces Russian and English reports plus a tweet-sized English summary;
- can send deduplicated reports to Telegram;
- supports optional WhatsApp Cloud API delivery;
- tracks signal lifecycle, TP/SL progress and rolling performance after activation;
- exposes a secured custom market-query webhook for the personal assistant mode;
- keeps a compact audit snapshot in n8n workflow static data.

## Repository layout

- \`src/technical-analysis.mjs\` — deterministic market engine.
- \`tests/technical-analysis.test.mjs\` — synthetic bullish/bearish safety tests.
- \`scripts/build-workflow.mjs\` — generates the importable n8n workflow.
- \`scripts/validate-workflow.mjs\` — structural workflow validation.
- \`n8n/NICS_Professional_Market_Intelligence_Agent.json\` — generated workflow.
- \`config/instruments.example.json\` — default instrument universe.
- \`schemas/tradingview-alert.schema.json\` — TradingView webhook payload contract.
- \`docs/ARCHITECTURE.md\` — architecture and decision rules.
- \`docs/SETUP.md\` — deployment, keys and activation checklist.
- \`docs/SERVICE_TIERS.md\` — Essential, Professional and Elite capability mapping.

## Validate

\`\`\`bash
npm run validate
\`\`\`

## Safety

This is decision support, not autonomous execution and not financial advice. The workflow does not place orders. A valid signal still requires spread, liquidity, broker symbol, contract size, leverage and risk checks at the execution venue.

## Primary references

- n8n public API and workflow import documentation: https://docs.n8n.io/connect/n8n-api/
- TradingView webhook alerts: https://www.tradingview.com/support/solutions/43000529348-how-to-configure-webhook-alerts/
- Twelve Data API documentation: https://twelvedata.com/docs
- Trading Economics calendar API: https://docs.tradingeconomics.com/economic_calendar/country/
- Alibaba Cloud Model Studio OpenAI-compatible API: https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope
- GDELT DOC 2.0 API: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
