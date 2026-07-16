# Setup

## 1. Required provider access

Configure these variables on the n8n service or its task runner:

| Variable | Required | Purpose |
| --- | --- | --- |
| \`TWELVE_DATA_API_KEY\` | yes | Batched OHLC market data |
| \`TRADING_ECONOMICS_API_KEY\` | yes | Economic calendar |
| \`DASHSCOPE_API_KEY\` | yes | Qwen analysis layer |
| \`ALIBABA_MODEL_STUDIO_BASE_URL\` | recommended | Workspace-specific OpenAI-compatible base URL ending in \`/v1\` |
| \`QWEN_MODEL\` | no | Defaults to \`qwen-plus\` |
| \`TRADINGVIEW_WEBHOOK_SECRET\` | yes for TradingView | Long random shared secret |
| \`TELEGRAM_BOT_TOKEN\` | optional | Telegram delivery |
| \`TELEGRAM_CHAT_ID\` | optional | Telegram destination |
| \`WHATSAPP_ACCESS_TOKEN\` | optional | WhatsApp Cloud API delivery |
| \`WHATSAPP_PHONE_NUMBER_ID\` | optional | WhatsApp sender number ID |
| \`WHATSAPP_TO\` | optional | WhatsApp recipient in international format |
| \`NICS_RISK_PROFILE\` | no | \`conservative\`, \`balanced\` or \`aggressive\` |
| \`NICS_SERVICE_TIER\` | no | Defaults to \`elite\` |
| \`NICS_INSTRUMENTS_JSON\` | no | JSON array overriding the default market universe |

Alibaba recommends a workspace-specific Model Studio endpoint. Example for Singapore:

\`\`\`text
https://YOUR_WORKSPACE_ID.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1
\`\`\`

Keep secrets only in the server environment or n8n credentials. Never commit a real key.

## 2. n8n v2 environment access

n8n v2 blocks Code-node access to environment variables by default. This workflow uses server-side environment variables so secrets do not live in the exported workflow JSON. On a private self-hosted instance, add:

\`\`\`text
N8N_BLOCK_ENV_ACCESS_IN_NODE=false
\`\`\`

Restart the n8n container after adding the variables. Limit editor access because users who can edit Code nodes may be able to read these values. A stricter alternative is to refactor the HTTP nodes to n8n credential objects after import.

## 3. Import

The workflow file is:

\`\`\`text
n8n/NICS_Professional_Market_Intelligence_Agent.json
\`\`\`

Import it through the n8n editor or create it with:

\`\`\`bash
curl -X POST "$N8N_BASE_URL/api/v1/workflows" \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @n8n/NICS_Professional_Market_Intelligence_Agent.json
\`\`\`

The public API requires \`name\`, \`nodes\`, \`connections\` and \`settings\`.

## 4. Test before activation

1. Keep the workflow inactive.
2. Run \`Manual Test\`.
3. Confirm all expected instruments return at least three valid timeframes.
4. Verify timestamps and broker prices against TradingView.
5. Confirm an upcoming high-impact USD event moves XAU/USD, USD pairs, oil and crypto to \`WAIT_EVENT\`.
6. Confirm Entry, SL and all four targets are on the correct side of the trade.
7. Enable Telegram only after inspecting the full manual output.
8. Activate the workflow after at least one weekday and one weekend crypto test.

## 5. TradingView

After activation, copy the production webhook URL from \`TradingView Webhook\`. Create a TradingView alert and use the JSON example in \`docs/ARCHITECTURE.md\`. TradingView expects HTTPS and may time out if the receiver does not acknowledge quickly; this workflow acknowledges immediately and continues processing.

## 6. Instrument changes

Edit the \`instruments\` array in the \`Runtime Config\` Code node and rebuild the checked-in workflow if source control must remain synchronized. Verify the exact provider symbol first. Different brokers may use suffixes or a different oil symbol.

## 7. Operational limits

- Provider quotas depend on your plans and the number of symbols.
- The workflow batches symbols by timeframe, but providers may still count credits per symbol.
- Scheduled executions should use retries and execution pruning.
- Telegram delivery is deduplicated for 60 minutes per instrument and direction.
- Static data persists only on active production executions, not ordinary manual tests.
