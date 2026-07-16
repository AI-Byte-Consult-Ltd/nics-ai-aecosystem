import assert from "node:assert/strict";
import { analyzeMarketPayloads, analyzeSeries } from "../src/technical-analysis.mjs";

function makeSeries(symbol, interval, direction = 1) {
  const stepMinutes = { "5min": 5, "15min": 15, "1h": 60, "4h": 240 }[interval] ?? 60;
  const values = [];
  const now = Date.now();
  let price = symbol === "XAU/USD" ? 2350 : 100;
  for (let i = 0; i < 240; i += 1) {
    const wave = Math.sin(i / 7) * 0.25;
    const drift = direction * 0.18;
    const open = price;
    const close = Math.max(0.01, open + drift + wave);
    const high = Math.max(open, close) + 0.35;
    const low = Math.min(open, close) - 0.35;
    values.push({
      datetime: new Date(now - ((239 - i) * stepMinutes * 60000)).toISOString(),
      open: String(open),
      high: String(high),
      low: String(low),
      close: String(close),
      volume: "1000"
    });
    price = close;
  }
  return { meta: { symbol, interval }, values: values.reverse(), status: "ok" };
}

const bullishPayloads = ["5min", "15min", "1h", "4h"].map((interval) => (
  makeSeries("XAU/USD", interval, 1)
));
const bullish = analyzeMarketPayloads(bullishPayloads, {
  instruments: [{ symbol: "XAU/USD", label: "Gold", assetClass: "commodity", currencies: ["USD"] }]
});
assert.equal(bullish.signals.length, 1);
assert.equal(bullish.signals[0].direction, "LONG");
assert.equal(bullish.signals[0].takeProfits.length, 4);
assert.ok(bullish.signals[0].stopLoss < bullish.signals[0].entryZone[0]);
assert.ok(bullish.signals[0].takeProfits[3] > bullish.signals[0].takeProfits[0]);

const bearishPayloads = ["5min", "15min", "1h", "4h"].map((interval) => (
  makeSeries("EUR/USD", interval, -1)
));
const bearish = analyzeMarketPayloads(bearishPayloads, {
  instruments: [{ symbol: "EUR/USD", label: "EUR/USD", assetClass: "forex", currencies: ["EUR", "USD"] }]
});
assert.equal(bearish.signals[0].direction, "SHORT");
assert.ok(bearish.signals[0].stopLoss > bearish.signals[0].entryZone[1]);
assert.ok(bearish.signals[0].takeProfits[3] < bearish.signals[0].takeProfits[0]);

const invalid = analyzeSeries({ meta: { symbol: "TEST", interval: "1h" }, values: [] });
assert.equal(invalid.valid, false);

console.log("technical-analysis tests: ok");
