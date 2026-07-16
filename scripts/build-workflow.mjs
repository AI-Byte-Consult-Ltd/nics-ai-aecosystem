import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const instrumentDefaults = JSON.parse(readFileSync(resolve(root, "config/instruments.example.json"), "utf8"));
const analysisSource = readFileSync(resolve(root, "src/technical-analysis.mjs"), "utf8")
  .replace(/\nexport\s*\{[\s\S]*?\};\s*$/, "\n");

const join = (lines) => lines.join("\n");
const makeNode = (id, name, type, typeVersion, position, parameters, extra = {}) => ({
  id, name, type, typeVersion, position, parameters, ...extra
});
const makeCodeNode = (id, name, position, jsCode) => (
  makeNode(id, name, "n8n-nodes-base.code", 2, position, { jsCode })
);
const modeCode = (mode) => join([
  "const input = $input.first()?.json ?? {};",
  "return [{ json: { ...input, _runMode: " + JSON.stringify(mode) + " } }];"
]);

const runtimeCode = join([
  "const input = $input.first()?.json ?? {};",
  "const environment = $env;",
  "const body = input.body ?? input;",
  "let instruments = " + JSON.stringify(instrumentDefaults.instruments) + ";",
  "if (environment.NICS_INSTRUMENTS_JSON) {",
  "  try {",
  "    const custom = JSON.parse(environment.NICS_INSTRUMENTS_JSON);",
  "    if (Array.isArray(custom) && custom.length) instruments = custom;",
  "  } catch (error) { throw new Error('NICS_INSTRUMENTS_JSON is not valid JSON'); }",
  "}",
  "const requestedSymbols = Array.isArray(body.symbols) ? body.symbols.map(String) : [];",
  "if (requestedSymbols.length) {",
  "  const bySymbol = new Map(instruments.map((instrument) => [instrument.symbol, instrument]));",
  "  instruments = requestedSymbols.map((symbol) => bySymbol.get(symbol) ?? {",
  "    symbol, label: symbol, assetClass: 'other', currencies: ['USD']",
  "  });",
  "}",
  "const tier = String(environment.NICS_SERVICE_TIER ?? 'elite').toLowerCase();",
  "const marketLimit = tier === 'essential' ? 1 : tier === 'professional' ? 3 : Infinity;",
  "instruments = instruments.slice(0, marketLimit);",
  "const requestedRisk = String(body.riskProfile ?? environment.NICS_RISK_PROFILE ?? 'balanced').toLowerCase();",
  "const riskProfile = ['conservative','balanced','aggressive'].includes(requestedRisk) ? requestedRisk : 'balanced';",
  "const config = {",
  "  instruments,",
  "  timeframes: " + JSON.stringify(instrumentDefaults.timeframes) + ",",
  "  riskProfile,",
  "  serviceTier: tier,",
  "  eventBlackoutMinutesBefore: " + instrumentDefaults.eventBlackoutMinutesBefore + ",",
  "  eventBlackoutMinutesAfter: " + instrumentDefaults.eventBlackoutMinutesAfter + ",",
  "  twelveDataApiKey: environment.TWELVE_DATA_API_KEY ?? '',",
  "  tradingEconomicsApiKey: environment.TRADING_ECONOMICS_API_KEY ?? '',",
  "  dashscopeApiKey: environment.DASHSCOPE_API_KEY ?? '',",
  "  modelStudioBaseUrl: environment.ALIBABA_MODEL_STUDIO_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',",
  "  qwenModel: environment.QWEN_MODEL ?? 'qwen-plus',",
  "  tradingViewSecret: environment.TRADINGVIEW_WEBHOOK_SECRET ?? '',",
  "  telegramBotToken: environment.TELEGRAM_BOT_TOKEN ?? '',",
  "  telegramChatId: environment.TELEGRAM_CHAT_ID ?? '',",
  "  whatsAppAccessToken: environment.WHATSAPP_ACCESS_TOKEN ?? '',",
  "  whatsAppPhoneNumberId: environment.WHATSAPP_PHONE_NUMBER_ID ?? '',",
  "  whatsAppTo: environment.WHATSAPP_TO ?? '',",
  "  notificationCooldownMinutes: 60",
  "};",
  "const runMode = input._runMode ?? 'manual';",
  "if (runMode === 'tradingview' || runMode === 'assistant') {",
  "  if (!config.tradingViewSecret || body.secret !== config.tradingViewSecret) {",
  "    throw new Error('Secured webhook rejected: invalid shared secret');",
  "  }",
  "}",
  "const missing = [",
  "  ['TWELVE_DATA_API_KEY', config.twelveDataApiKey],",
  "  ['TRADING_ECONOMICS_API_KEY', config.tradingEconomicsApiKey],",
  "  ['DASHSCOPE_API_KEY', config.dashscopeApiKey]",
  "].filter((entry) => !entry[1]).map((entry) => entry[0]);",
  "if (missing.length) throw new Error('Missing required n8n environment variables: ' + missing.join(', '));",
  "return [{ json: {",
  "  runId: $execution.id,",
  "  runMode,",
  "  requestedAt: new Date().toISOString(),",
  "  triggerPayload: (runMode === 'tradingview' || runMode === 'assistant') ? body : {},",
  "  config",
  "} }];"
]);

const marketRequestCode = join([
  "const runtime = $input.first().json;",
  "const config = runtime.config;",
  "const symbols = config.instruments.map((instrument) => instrument.symbol).join(',');",
  "return config.timeframes.map((interval) => ({ json: {",
  "  interval,",
  "  url: 'https://api.twelvedata.com/time_series?symbol=' + encodeURIComponent(symbols) +",
  "    '&interval=' + encodeURIComponent(interval) +",
  "    '&outputsize=240&timezone=UTC&format=JSON&apikey=' + encodeURIComponent(config.twelveDataApiKey)",
  "} }));"
]);

const technicalCode = analysisSource + "\n" + join([
  "const payloads = $input.all().map((item) => item.json);",
  "const runtime = $('Runtime Config').first().json;",
  "const technical = analyzeMarketPayloads(payloads, runtime.config);",
  "if (!technical.signals.length) throw new Error('Market provider returned no analyzable instruments');",
  "return [{ json: { technical, runMode: runtime.runMode, triggerPayload: runtime.triggerPayload } }];"
]);

const calendarRequestCode = join([
  "const input = $input.first().json;",
  "const config = $('Runtime Config').first().json.config;",
  "const start = new Date();",
  "const end = new Date(Date.now() + (36 * 60 * 60 * 1000));",
  "const day = (value) => value.toISOString().slice(0, 10);",
  "const countries = ['united states','euro area','united kingdom','japan','china','canada','australia','new zealand','switzerland'];",
  "const countryPath = countries.map(encodeURIComponent).join(',');",
  "const url = 'https://api.tradingeconomics.com/calendar/country/' + countryPath + '/' + day(start) + '/' + day(end) +",
  "  '?c=' + encodeURIComponent(config.tradingEconomicsApiKey) + '&f=json';",
  "return [{ json: { url, technical: input.technical, runMode: input.runMode, triggerPayload: input.triggerPayload } }];"
]);

const eventRiskCode = join([
  "const rawItems = $input.all().map((item) => item.json);",
  "const prior = $('Calendar Request').first().json;",
  "const config = $('Runtime Config').first().json.config;",
  "const events = rawItems.flatMap((item) => Array.isArray(item) ? item : [item]).filter((item) => item && (item.Event || item.event));",
  "const countryCurrency = {",
  "  'United States':'USD','Euro Area':'EUR','United Kingdom':'GBP','Japan':'JPY','China':'CNY',",
  "  'Canada':'CAD','Australia':'AUD','New Zealand':'NZD','Switzerland':'CHF'",
  "};",
  "const now = Date.now();",
  "const normalizedEvents = events.map((event) => {",
  "  const timestamp = new Date(event.Date ?? event.date).getTime();",
  "  return {",
  "    date: event.Date ?? event.date,",
  "    timestamp,",
  "    minutesFromNow: Number.isFinite(timestamp) ? Math.round((timestamp - now) / 60000) : null,",
  "    country: event.Country ?? event.country ?? '',",
  "    currency: countryCurrency[event.Country ?? event.country] ?? event.Currency ?? '',",
  "    event: event.Event ?? event.event ?? event.Category ?? '',",
  "    category: event.Category ?? event.category ?? '',",
  "    importance: Number(event.Importance ?? event.importance ?? 0),",
  "    actual: event.Actual ?? event.actual ?? '',",
  "    forecast: event.Forecast ?? event.forecast ?? '',",
  "    previous: event.Previous ?? event.previous ?? ''",
  "  };",
  "}).filter((event) => Number.isFinite(event.timestamp)).sort((a, b) => a.timestamp - b.timestamp);",
  "const signals = prior.technical.signals.map((signal) => {",
  "  const affectedCurrencies = new Set(signal.currencies ?? []);",
  "  if (signal.assetClass === 'crypto' || signal.assetClass === 'commodity') affectedCurrencies.add('USD');",
  "  const relevantEvents = normalizedEvents.filter((event) => affectedCurrencies.has(event.currency));",
  "  const blackout = relevantEvents.find((event) => event.importance >= 3 &&",
  "    event.minutesFromNow >= -config.eventBlackoutMinutesAfter &&",
  "    event.minutesFromNow <= config.eventBlackoutMinutesBefore);",
  "  return {",
  "    ...signal,",
  "    status: blackout ? 'WAIT_EVENT' : signal.status,",
  "    eventBlackout: blackout ?? null,",
  "    relevantEvents: relevantEvents.filter((event) => event.minutesFromNow >= -180 && event.minutesFromNow <= 1440).slice(0, 8)",
  "  };",
  "});",
  "return [{ json: {",
  "  generatedAt: prior.technical.generatedAt,",
  "  dataQuality: prior.technical.dataQuality,",
  "  signals,",
  "  events: normalizedEvents.filter((event) => event.minutesFromNow >= -180 && event.minutesFromNow <= 2160).slice(0, 40),",
  "  runMode: prior.runMode,",
  "  triggerPayload: prior.triggerPayload",
  "} }];"
]);

const lifecycleCode = join([
  "const context = $input.first().json;",
  "const state = $getWorkflowStaticData('global');",
  "state.openSignals = state.openSignals ?? {};",
  "state.performance = state.performance ?? { closed: 0, tp1Wins: 0, stopLosses: 0, reversals: 0 };",
  "const isHit = (direction, price, level, kind) => kind === 'tp'",
  "  ? (direction === 'LONG' ? price >= level : price <= level)",
  "  : (direction === 'LONG' ? price <= level : price >= level);",
  "const signals = context.signals.map((signal, index) => {",
  "  const previous = state.openSignals[signal.symbol];",
  "  let signalUpdate = signal.status === 'ACTIONABLE' ? 'NEW' : 'WATCH';",
  "  let hitTargets = previous?.hitTargets ?? [];",
  "  if (previous?.state === 'OPEN') {",
  "    if (previous.direction !== signal.direction && signal.status === 'ACTIONABLE') {",
  "      previous.state = 'REVERSED';",
  "      previous.closedAt = new Date().toISOString();",
  "      state.performance.closed += 1;",
  "      state.performance.reversals += 1;",
  "      signalUpdate = 'REVERSED';",
  "    } else if (isHit(previous.direction, signal.price, previous.stopLoss, 'sl')) {",
  "      previous.state = 'STOP_LOSS';",
  "      previous.closedAt = new Date().toISOString();",
  "      state.performance.closed += 1;",
  "      state.performance.stopLosses += 1;",
  "      signalUpdate = 'SL_HIT';",
  "    } else {",
  "      hitTargets = previous.takeProfits.map((target, targetIndex) =>",
  "        previous.hitTargets.includes(targetIndex + 1) || isHit(previous.direction, signal.price, target, 'tp') ? targetIndex + 1 : null",
  "      ).filter(Boolean);",
  "      if (hitTargets.length > previous.hitTargets.length) {",
  "        if (!previous.hitTargets.includes(1) && hitTargets.includes(1)) state.performance.tp1Wins += 1;",
  "        previous.hitTargets = hitTargets;",
  "        signalUpdate = 'TP' + Math.max(...hitTargets) + '_HIT';",
  "      } else signalUpdate = signal.status === 'ACTIONABLE' ? 'UPDATED' : 'HOLD';",
  "      if (hitTargets.includes(4)) { previous.state = 'TP4_COMPLETE'; previous.closedAt = new Date().toISOString(); state.performance.closed += 1; }",
  "    }",
  "  }",
  "  if (signal.status === 'ACTIONABLE' && (!previous || previous.state !== 'OPEN' || previous.direction !== signal.direction)) {",
  "    state.openSignals[signal.symbol] = {",
  "      state: 'OPEN', direction: signal.direction, openedAt: new Date().toISOString(),",
  "      entryZone: signal.entryZone, stopLoss: signal.stopLoss, takeProfits: signal.takeProfits, hitTargets: []",
  "    };",
  "    if (signalUpdate !== 'REVERSED') signalUpdate = 'NEW';",
  "  }",
  "  return {",
  "    ...signal,",
  "    opportunityRank: index + 1,",
  "    signalUpdate,",
  "    hitTargets,",
  "    vipPriority: signal.status === 'ACTIONABLE' && signal.opportunityScore >= 75 && signal.strategyAgreement >= 0.6",
  "  };",
  "});",
  "return [{ json: { ...context, signals, performance: state.performance } }];"
]);

const teNewsRequestCode = join([
  "const context = $input.first().json;",
  "const config = $('Runtime Config').first().json.config;",
  "const url = 'https://api.tradingeconomics.com/news?c=' + encodeURIComponent(config.tradingEconomicsApiKey) + '&f=json';",
  "return [{ json: { url, context } }];"
]);

const gdeltRequestCode = join([
  "const teNewsItems = $input.all().map((item) => item.json);",
  "const prior = $('Build Trading Economics News Request').first().json;",
  "const query = '(gold OR oil OR forex OR dollar OR inflation OR central bank OR bitcoin OR ethereum OR geopolitics)';",
  "const url = 'https://api.gdeltproject.org/api/v2/doc/doc?query=' + encodeURIComponent(query) +",
  "  '&mode=ArtList&maxrecords=50&format=json&sort=HybridRel&timespan=12h';",
  "return [{ json: { url, context: prior.context, teNewsItems } }];"
]);

const llmRequestCode = join([
  "const gdelt = $input.first()?.json ?? {};",
  "const prior = $('Build GDELT News Request').first().json;",
  "const config = $('Runtime Config').first().json.config;",
  "const gdeltNews = (gdelt.articles ?? gdelt.items ?? []).slice(0, 30).map((article) => ({",
  "  source: 'GDELT', title: article.title ?? '', domain: article.domain ?? article.source ?? '',",
  "  seenDate: article.seendate ?? article.date ?? '', url: article.url ?? '', tone: article.tone ?? null",
  "}));",
  "const teNews = prior.teNewsItems.flatMap((item) => Array.isArray(item) ? item : [item]).slice(0, 30).map((article) => ({",
  "  source: 'Trading Economics', title: article.title ?? article.Title ?? '',",
  "  description: article.description ?? article.Description ?? '',",
  "  date: article.date ?? article.Date ?? '', url: article.url ?? article.URL ?? ''",
  "}));",
  "const context = { ...prior.context, news: [...teNews, ...gdeltNews] };",
  "const publicContext = {",
  "  generatedAt: context.generatedAt, runMode: context.runMode, tradingViewAlert: context.triggerPayload,",
  "  riskProfile: config.riskProfile, serviceTier: config.serviceTier, dataQuality: context.dataQuality,",
  "  performance: context.performance, events: context.events, news: context.news, signals: context.signals",
  "};",
  "const system = [",
  "  'You are the explanation layer for NICS Professional Market Intelligence Agent.',",
  "  'All numeric levels are deterministic and immutable. Never recalculate, alter or invent Entry, TP or SL.',",
  "  'Cross-check the supplied macro events, multi-source headlines, TradingView alert and strategy ensemble.',",
  "  'Explain conflicts and uncertainty. Never promise profit or recommend leverage.',",
  "  'Return valid JSON only with analysis array and economicDigestRu, economicDigestEn, globalRiskRu, globalRiskEn.',",
  "  'Each analysis item must contain symbol, whyRu, whyEn, riskRu and riskEn.'",
  "].join(' ');",
  "const requestBody = {",
  "  model: config.qwenModel, temperature: 0.1, max_completion_tokens: 5000,",
  "  response_format: { type: 'json_object' },",
  "  messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(publicContext) }]",
  "};",
  "return [{ json: {",
  "  llmUrl: config.modelStudioBaseUrl.replace(/\\/$/, '') + '/chat/completions',",
  "  requestBody, context",
  "} }];"
]);

const formatCode = join([
  "const response = $input.first()?.json ?? {};",
  "const context = $('Build Qwen Request').first().json.context;",
  "let explanation = {};",
  "try {",
  "  const content = String(response.choices?.[0]?.message?.content ?? '{}');",
  "  const start = content.indexOf('{');",
  "  const end = content.lastIndexOf('}');",
  "  explanation = JSON.parse(start >= 0 && end >= start ? content.slice(start, end + 1) : '{}');",
  "} catch (error) {",
  "  explanation = { globalRiskRu: 'Модель объяснений вернула некорректный JSON.', globalRiskEn: 'The explanation model returned invalid JSON.' };",
  "}",
  "const explanationBySymbol = new Map((explanation.analysis ?? []).map((item) => [item.symbol, item]));",
  "const formatTime = (zone) => new Intl.DateTimeFormat('en-GB', {",
  "  timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',",
  "  hour: '2-digit', minute: '2-digit', hour12: false",
  "}).format(new Date());",
  "const lines = ['NICS PROFESSIONAL MARKET INTELLIGENCE'];",
  "lines.push('Sofia: ' + formatTime('Europe/Sofia') + ' | Rome: ' + formatTime('Europe/Rome') + ' | Auckland: ' + formatTime('Pacific/Auckland'));",
  "lines.push('Risk profile: ' + ($('Runtime Config').first().json.config.riskProfile ?? 'balanced') + ' | Performance: TP1 ' + context.performance.tp1Wins + ', SL ' + context.performance.stopLosses);",
  "lines.push('', 'ЭКОНОМИЧЕСКИЙ ДАЙДЖЕСТ');",
  "lines.push(explanation.economicDigestRu ?? 'Сводка формируется только из полученных событий и новостей.');",
  "lines.push(explanation.globalRiskRu ?? 'Проверьте ликвидность, спред и время следующего важного события.', '');",
  "const selected = [...context.signals].sort((a, b) => b.opportunityScore - a.opportunityScore).slice(0, context.runMode === 'digest' ? 8 : 5);",
  "for (const signal of selected) {",
  "  const note = explanationBySymbol.get(signal.symbol) ?? {};",
  "  lines.push((signal.vipPriority ? 'VIP | ' : '') + '#' + signal.opportunityRank + ' ' + signal.label + ' | ' + signal.status + ' | ' + signal.direction + ' | ' + signal.confidence + '%');",
  "  lines.push('Update: ' + signal.signalUpdate + ' | Opportunity: ' + signal.opportunityScore + ' | Strategies: ' + JSON.stringify(signal.strategies));",
  "  lines.push('Цена: ' + signal.price);",
  "  if (signal.yesterdayBox) lines.push('Yesterday Box: H ' + signal.yesterdayBox.high + ' | M ' + signal.yesterdayBox.mid + ' | L ' + signal.yesterdayBox.low);",
  "  if (signal.fibonacci) lines.push('Fibonacci ' + signal.fibonacci.impulse + ' | OTE ' + signal.fibonacci.oteZone[0] + '-' + signal.fibonacci.oteZone[1]);",
  "  lines.push('Entry: ' + signal.entryZone.join('-'));",
  "  signal.takeProfits.forEach((target, index) => lines.push('TP' + (index + 1) + ': ' + target));",
  "  lines.push('SL: ' + signal.stopLoss + ' | Risk: ' + signal.suggestedRiskPercent + '%');",
  "  lines.push('Почему: ' + (note.whyRu ?? 'Согласование таймфреймов, стратегий, Ichimoku, EMA, RSI, ATR, OTE и Yesterday Box.'));",
  "  if (signal.eventBlackout) lines.push('Блокировка: ' + signal.eventBlackout.event + ' через ' + signal.eventBlackout.minutesFromNow + ' мин.');",
  "  lines.push('Риск: ' + (note.riskRu ?? 'Дождитесь подтверждения, проверьте спред и отмените сценарий за SL.'), '');",
  "}",
  "lines.push('ECONOMIC DIGEST');",
  "lines.push(explanation.economicDigestEn ?? 'The digest uses only supplied events and headlines.');",
  "lines.push(explanation.globalRiskEn ?? 'Check liquidity, spread and the next high-impact event.', '');",
  "for (const signal of selected) {",
  "  const note = explanationBySymbol.get(signal.symbol) ?? {};",
  "  lines.push((signal.vipPriority ? 'VIP | ' : '') + '#' + signal.opportunityRank + ' ' + signal.label + ' | ' + signal.status + ' | ' + signal.direction + ' | ' + signal.confidence + '%');",
  "  lines.push('Update: ' + signal.signalUpdate + ' | Opportunity: ' + signal.opportunityScore + ' | Strategies: ' + JSON.stringify(signal.strategies));",
  "  lines.push('Current: ' + signal.price + ' | Entry: ' + signal.entryZone.join('-'));",
  "  lines.push('TP1-TP4: ' + signal.takeProfits.join(' / ') + ' | SL: ' + signal.stopLoss);",
  "  lines.push('Why: ' + (note.whyEn ?? 'Multi-timeframe and multi-strategy agreement with Ichimoku, EMA, RSI, ATR, OTE and Yesterday Box.'));",
  "  if (signal.eventBlackout) lines.push('Event blackout: ' + signal.eventBlackout.event + ' in ' + signal.eventBlackout.minutesFromNow + ' min.');",
  "  lines.push('Risk: ' + (note.riskEn ?? 'Wait for confirmation, check spread and invalidate beyond SL.'), '');",
  "}",
  "lines.push('NFA: Decision support only. This workflow does not place orders or guarantee profit.');",
  "const leader = selected[0];",
  "const tweet = leader ? ('$' + leader.symbol.replace('/', '') + ' ' + leader.direction + ' | Entry ' + leader.entryZone.join('-') + ' | TP ' + leader.takeProfits.join('/') + ' | SL ' + leader.stopLoss + ' | ' + leader.status + ' | NFA').slice(0, 280) : 'NICS market scan: no valid signal. NFA';",
  "return [{ json: {",
  "  generatedAt: new Date().toISOString(), runMode: context.runMode, report: lines.join('\\n'), tweet,",
  "  structured: { signals: context.signals, events: context.events, news: context.news, performance: context.performance, dataQuality: context.dataQuality },",
  "  modelUsage: response.usage ?? null",
  "} }];"
]);

const auditCode = join([
  "const item = $input.first().json;",
  "const state = $getWorkflowStaticData('global');",
  "state.audit = Array.isArray(state.audit) ? state.audit : [];",
  "state.audit.push({ generatedAt: item.generatedAt, runMode: item.runMode,",
  "  signals: item.structured.signals.map((signal) => ({ symbol: signal.symbol, status: signal.status, direction: signal.direction, confidence: signal.confidence, update: signal.signalUpdate }))",
  "});",
  "state.audit = state.audit.slice(-100);",
  "return [{ json: item }];"
]);

const notificationGate = [
  "const item = $input.first().json;",
  "const config = $('Runtime Config').first().json.config;",
  "const actionable = item.structured.signals.filter((signal) => signal.status === 'ACTIONABLE');",
  "const urgent = item.structured.signals.filter((signal) => signal.vipPriority || /_HIT$|REVERSED/.test(signal.signalUpdate));",
  "const state = $getWorkflowStaticData('global');",
  "state.notifications = state.notifications ?? {};",
  "const key = actionable.map((signal) => signal.symbol + ':' + signal.direction + ':' + signal.signalUpdate).sort().join('|') || 'digest';",
  "const last = state.notifications[key] ?? 0;",
  "const cooldown = config.notificationCooldownMinutes * 60000;",
  "if (item.runMode === 'scan' && !urgent.length && (!actionable.length || Date.now() - last < cooldown)) return [];",
  "state.notifications[key] = Date.now();"
];

const telegramCode = join([
  ...notificationGate,
  "if (!config.telegramBotToken || !config.telegramChatId) return [];",
  "const paragraphs = item.report.split('\\n\\n');",
  "const chunks = [];",
  "let current = '';",
  "for (const paragraph of paragraphs) {",
  "  if ((current + '\\n\\n' + paragraph).length > 3500 && current) { chunks.push(current); current = paragraph; }",
  "  else current = current ? current + '\\n\\n' + paragraph : paragraph;",
  "}",
  "if (current) chunks.push(current);",
  "return chunks.map((text) => ({ json: {",
  "  url: 'https://api.telegram.org/bot' + config.telegramBotToken + '/sendMessage',",
  "  body: { chat_id: config.telegramChatId, text, disable_web_page_preview: true }",
  "} }));"
]);

const whatsAppCode = join([
  ...notificationGate,
  "if (!config.whatsAppAccessToken || !config.whatsAppPhoneNumberId || !config.whatsAppTo) return [];",
  "const text = item.report.length > 3800 ? item.report.slice(0, 3790) + '\\n…' : item.report;",
  "return [{ json: {",
  "  url: 'https://graph.facebook.com/v23.0/' + config.whatsAppPhoneNumberId + '/messages',",
  "  token: config.whatsAppAccessToken,",
  "  body: { messaging_product: 'whatsapp', to: config.whatsAppTo, type: 'text', text: { preview_url: false, body: text } }",
  "} }];"
]);

const nodes = [
  makeNode("10000000-0000-4000-8000-000000000001", "Manual Test", "n8n-nodes-base.manualTrigger", 1, [-1200, 100], {}),
  makeNode("10000000-0000-4000-8000-000000000002", "Market Scan (15m)", "n8n-nodes-base.scheduleTrigger", 1.2, [-1200, -180], { rule: { interval: [{ field: "minutes", minutesInterval: 15 }] } }),
  makeNode("10000000-0000-4000-8000-000000000003", "Daily Digest (07:30)", "n8n-nodes-base.scheduleTrigger", 1.2, [-1200, -40], { rule: { interval: [{ field: "cronExpression", expression: "30 7 * * *" }] } }),
  makeNode("10000000-0000-4000-8000-000000000004", "TradingView Webhook", "n8n-nodes-base.webhook", 2.1, [-1200, 240], { httpMethod: "POST", path: "nics-tradingview-alert", responseMode: "onReceived", options: {} }, { webhookId: "7d489d50-227d-4c0b-8b02-1fb84d3c1ee1" }),
  makeNode("10000000-0000-4000-8000-000000000005", "Personal Market Query", "n8n-nodes-base.webhook", 2.1, [-1200, 380], { httpMethod: "POST", path: "nics-market-query", responseMode: "onReceived", options: {} }, { webhookId: "3456c8c7-7f02-4509-b5dc-685318c3f9bb" }),
  makeCodeNode("10000000-0000-4000-8000-000000000006", "Manual Mode", [-980, 100], modeCode("manual")),
  makeCodeNode("10000000-0000-4000-8000-000000000007", "Scan Mode", [-980, -180], modeCode("scan")),
  makeCodeNode("10000000-0000-4000-8000-000000000008", "Digest Mode", [-980, -40], modeCode("digest")),
  makeCodeNode("10000000-0000-4000-8000-000000000009", "TradingView Mode", [-980, 240], modeCode("tradingview")),
  makeCodeNode("10000000-0000-4000-8000-000000000010", "Assistant Mode", [-980, 380], modeCode("assistant")),
  makeCodeNode("10000000-0000-4000-8000-000000000011", "Runtime Config", [-740, 60], runtimeCode),
  makeCodeNode("10000000-0000-4000-8000-000000000012", "Build Market Requests", [-500, 60], marketRequestCode),
  makeNode("10000000-0000-4000-8000-000000000013", "Fetch Batched OHLC", "n8n-nodes-base.httpRequest", 4.2, [-260, 60], { url: "={{ $json.url }}", options: { timeout: 30000 } }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 1500 }),
  makeCodeNode("10000000-0000-4000-8000-000000000014", "Deterministic Technical Engine", [-20, 60], technicalCode),
  makeCodeNode("10000000-0000-4000-8000-000000000015", "Calendar Request", [220, 60], calendarRequestCode),
  makeNode("10000000-0000-4000-8000-000000000016", "Fetch Economic Calendar", "n8n-nodes-base.httpRequest", 4.2, [460, 60], { url: "={{ $json.url }}", options: { timeout: 30000 } }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 1500 }),
  makeCodeNode("10000000-0000-4000-8000-000000000017", "Event Risk Filter", [700, 60], eventRiskCode),
  makeCodeNode("10000000-0000-4000-8000-000000000018", "Signal Lifecycle and Performance", [940, 60], lifecycleCode),
  makeCodeNode("10000000-0000-4000-8000-000000000019", "Build Trading Economics News Request", [1180, 60], teNewsRequestCode),
  makeNode("10000000-0000-4000-8000-000000000020", "Fetch Trading Economics News", "n8n-nodes-base.httpRequest", 4.2, [1420, 60], { url: "={{ $json.url }}", options: { timeout: 30000 } }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 1500 }),
  makeCodeNode("10000000-0000-4000-8000-000000000021", "Build GDELT News Request", [1660, 60], gdeltRequestCode),
  makeNode("10000000-0000-4000-8000-000000000022", "Fetch GDELT News", "n8n-nodes-base.httpRequest", 4.2, [1900, 60], { url: "={{ $json.url }}", options: { timeout: 30000 } }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 1500 }),
  makeCodeNode("10000000-0000-4000-8000-000000000023", "Build Qwen Request", [2140, 60], llmRequestCode),
  makeNode("10000000-0000-4000-8000-000000000024", "Qwen Market Explanation", "n8n-nodes-base.httpRequest", 4.2, [2380, 60], {
    method: "POST", url: "={{ $json.llmUrl }}", sendHeaders: true,
    headerParameters: { parameters: [
      { name: "Authorization", value: "={{ 'Bearer ' + $('Runtime Config').first().json.config.dashscopeApiKey }}" },
      { name: "Content-Type", value: "application/json" }
    ] },
    sendBody: true, contentType: "raw", rawContentType: "application/json",
    body: "={{ JSON.stringify($json.requestBody) }}", options: { timeout: 120000 }
  }, { retryOnFail: true, maxTries: 2, waitBetweenTries: 3000 }),
  makeCodeNode("10000000-0000-4000-8000-000000000025", "Validate and Format Report", [2620, 60], formatCode),
  makeCodeNode("10000000-0000-4000-8000-000000000026", "Record Audit Snapshot", [2860, 60], auditCode),
  makeCodeNode("10000000-0000-4000-8000-000000000027", "Prepare Telegram Delivery", [3100, -20], telegramCode),
  makeNode("10000000-0000-4000-8000-000000000028", "Send Telegram Digest", "n8n-nodes-base.httpRequest", 4.2, [3340, -20], {
    method: "POST", url: "={{ $json.url }}", sendHeaders: true,
    headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
    sendBody: true, contentType: "raw", rawContentType: "application/json",
    body: "={{ JSON.stringify($json.body) }}", options: { timeout: 30000 }
  }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 1500 }),
  makeCodeNode("10000000-0000-4000-8000-000000000029", "Prepare WhatsApp Delivery", [3100, 140], whatsAppCode),
  makeNode("10000000-0000-4000-8000-000000000030", "Send WhatsApp Digest", "n8n-nodes-base.httpRequest", 4.2, [3340, 140], {
    method: "POST", url: "={{ $json.url }}", sendHeaders: true,
    headerParameters: { parameters: [
      { name: "Authorization", value: "={{ 'Bearer ' + $json.token }}" },
      { name: "Content-Type", value: "application/json" }
    ] },
    sendBody: true, contentType: "raw", rawContentType: "application/json",
    body: "={{ JSON.stringify($json.body) }}", options: { timeout: 30000 }
  }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 1500 })
];

const connections = {};
function connect(from, to) {
  connections[from] = connections[from] ?? { main: [[]] };
  connections[from].main[0].push({ node: to, type: "main", index: 0 });
}

connect("Manual Test", "Manual Mode");
connect("Market Scan (15m)", "Scan Mode");
connect("Daily Digest (07:30)", "Digest Mode");
connect("TradingView Webhook", "TradingView Mode");
connect("Personal Market Query", "Assistant Mode");
connect("Manual Mode", "Runtime Config");
connect("Scan Mode", "Runtime Config");
connect("Digest Mode", "Runtime Config");
connect("TradingView Mode", "Runtime Config");
connect("Assistant Mode", "Runtime Config");
connect("Runtime Config", "Build Market Requests");
connect("Build Market Requests", "Fetch Batched OHLC");
connect("Fetch Batched OHLC", "Deterministic Technical Engine");
connect("Deterministic Technical Engine", "Calendar Request");
connect("Calendar Request", "Fetch Economic Calendar");
connect("Fetch Economic Calendar", "Event Risk Filter");
connect("Event Risk Filter", "Signal Lifecycle and Performance");
connect("Signal Lifecycle and Performance", "Build Trading Economics News Request");
connect("Build Trading Economics News Request", "Fetch Trading Economics News");
connect("Fetch Trading Economics News", "Build GDELT News Request");
connect("Build GDELT News Request", "Fetch GDELT News");
connect("Fetch GDELT News", "Build Qwen Request");
connect("Build Qwen Request", "Qwen Market Explanation");
connect("Qwen Market Explanation", "Validate and Format Report");
connect("Validate and Format Report", "Record Audit Snapshot");
connect("Record Audit Snapshot", "Prepare Telegram Delivery");
connect("Prepare Telegram Delivery", "Send Telegram Digest");
connect("Record Audit Snapshot", "Prepare WhatsApp Delivery");
connect("Prepare WhatsApp Delivery", "Send WhatsApp Digest");

const workflow = {
  name: "NICS Professional Market Intelligence Agent V1",
  nodes,
  connections,
  settings: { executionOrder: "v1", timezone: "Europe/Sofia" }
};

const output = resolve(root, "n8n/NICS_Professional_Market_Intelligence_Agent.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(workflow, null, 2) + "\n");
console.log("workflow built: " + output);
