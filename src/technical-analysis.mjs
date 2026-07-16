const TIMEFRAME_MINUTES = {
  "1min": 1,
  "5min": 5,
  "15min": 15,
  "30min": 30,
  "45min": 45,
  "1h": 60,
  "2h": 120,
  "4h": 240,
  "1day": 1440
};

const TIMEFRAME_WEIGHTS = {
  "1min": 0.05,
  "5min": 0.15,
  "15min": 0.25,
  "30min": 0.30,
  "45min": 0.30,
  "1h": 0.35,
  "2h": 0.40,
  "4h": 0.45,
  "1day": 0.50
};

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function precisionFor(price) {
  if (price >= 1000) return 2;
  if (price >= 100) return 3;
  if (price >= 1) return 5;
  return 7;
}

function rounded(value, reference) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(precisionFor(reference ?? value)));
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function ema(values, period) {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return null;
  const seed = valid.slice(0, Math.min(period, valid.length));
  let result = average(seed);
  const multiplier = 2 / (period + 1);
  for (let i = seed.length; i < valid.length; i += 1) {
    result = (valid[i] - result) * multiplier + result;
  }
  return result;
}

function rsi(values, period = 14) {
  if (values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const delta = values[i] - values[i - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    const gain = Math.max(delta, 0);
    const loss = Math.max(-delta, 0);
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const relativeStrength = avgGain / avgLoss;
  return 100 - (100 / (1 + relativeStrength));
}

function atr(candles, period = 14) {
  if (candles.length < 2) return null;
  const ranges = [];
  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i];
    const previous = candles[i - 1];
    ranges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    ));
  }
  return average(ranges.slice(-period));
}

function rangeMidpoint(candles, period) {
  const sample = candles.slice(-period);
  if (!sample.length) return null;
  const high = Math.max(...sample.map((candle) => candle.high));
  const low = Math.min(...sample.map((candle) => candle.low));
  return (high + low) / 2;
}

function ichimoku(candles) {
  if (candles.length < 52) return null;
  const tenkan = rangeMidpoint(candles, 9);
  const kijun = rangeMidpoint(candles, 26);
  const spanA = (tenkan + kijun) / 2;
  const spanB = rangeMidpoint(candles, 52);
  return {
    tenkan,
    kijun,
    spanA,
    spanB,
    cloudTop: Math.max(spanA, spanB),
    cloudBottom: Math.min(spanA, spanB)
  };
}

function fibonacci(candles, lookback = 100) {
  const sample = candles.slice(-lookback);
  if (!sample.length) return null;
  let high = -Infinity;
  let low = Infinity;
  let highIndex = -1;
  let lowIndex = -1;
  sample.forEach((candle, index) => {
    if (candle.high > high) {
      high = candle.high;
      highIndex = index;
    }
    if (candle.low < low) {
      low = candle.low;
      lowIndex = index;
    }
  });
  const range = high - low;
  if (!(range > 0)) return null;
  const impulse = highIndex > lowIndex ? "bullish" : "bearish";
  const oteLow = impulse === "bullish" ? high - (range * 0.79) : low + (range * 0.62);
  const oteHigh = impulse === "bullish" ? high - (range * 0.62) : low + (range * 0.79);
  return {
    impulse,
    high,
    low,
    oteLow: Math.min(oteLow, oteHigh),
    oteHigh: Math.max(oteLow, oteHigh)
  };
}

function yesterdayBox(candles) {
  if (!candles.length) return null;
  const days = new Map();
  for (const candle of candles) {
    const dateKey = candle.datetime.slice(0, 10);
    if (!days.has(dateKey)) days.set(dateKey, []);
    days.get(dateKey).push(candle);
  }
  const keys = [...days.keys()].sort();
  if (keys.length < 2) return null;
  const prior = days.get(keys[keys.length - 2]);
  const high = Math.max(...prior.map((candle) => candle.high));
  const low = Math.min(...prior.map((candle) => candle.low));
  return { date: keys[keys.length - 2], high, low, mid: (high + low) / 2 };
}

function parseCandles(payload) {
  const values = Array.isArray(payload?.values) ? payload.values : [];
  const parsed = values.map((value) => ({
    datetime: String(value.datetime ?? value.timestamp ?? ""),
    open: number(value.open),
    high: number(value.high),
    low: number(value.low),
    close: number(value.close),
    volume: number(value.volume)
  })).filter((candle) => (
    candle.datetime &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close)
  ));
  parsed.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
  return parsed;
}

function analyzeSeries(payload) {
  const candles = parseCandles(payload);
  const meta = payload?.meta ?? {};
  const symbol = String(meta.symbol ?? payload?.symbol ?? "UNKNOWN");
  const interval = String(meta.interval ?? payload?.interval ?? "unknown");
  if (candles.length < 60) {
    return {
      symbol,
      interval,
      valid: false,
      error: "At least 60 OHLC candles are required",
      candleCount: candles.length
    };
  }

  const closes = candles.map((candle) => candle.close);
  const current = candles[candles.length - 1];
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(candles, 14);
  const cloud = ichimoku(candles);
  const fib = fibonacci(candles);
  const box = yesterdayBox(candles);
  const recent = candles.slice(-20);
  const recentHigh = Math.max(...recent.map((candle) => candle.high));
  const recentLow = Math.min(...recent.map((candle) => candle.low));

  let score = 0;
  const reasons = [];
  if (current.close > ema20) {
    score += 1;
    reasons.push("price_above_ema20");
  } else {
    score -= 1;
    reasons.push("price_below_ema20");
  }
  if (ema20 > ema50) {
    score += 1;
    reasons.push("ema20_above_ema50");
  } else {
    score -= 1;
    reasons.push("ema20_below_ema50");
  }
  if (Number.isFinite(ema200)) {
    score += current.close > ema200 ? 0.75 : -0.75;
  }
  if (cloud) {
    if (current.close > cloud.cloudTop) {
      score += 1.5;
      reasons.push("price_above_ichimoku_cloud");
    } else if (current.close < cloud.cloudBottom) {
      score -= 1.5;
      reasons.push("price_below_ichimoku_cloud");
    } else {
      reasons.push("price_inside_ichimoku_cloud");
    }
    score += cloud.tenkan > cloud.kijun ? 0.75 : -0.75;
  }
  if (Number.isFinite(rsi14)) {
    if (rsi14 > 55 && rsi14 < 75) score += 0.5;
    if (rsi14 < 45 && rsi14 > 25) score -= 0.5;
    if (rsi14 >= 75) reasons.push("rsi_overbought");
    if (rsi14 <= 25) reasons.push("rsi_oversold");
  }
  if (box) {
    if (current.close > box.high) {
      score += 0.75;
      reasons.push("above_yesterday_high");
    } else if (current.close < box.low) {
      score -= 0.75;
      reasons.push("below_yesterday_low");
    } else {
      reasons.push("inside_yesterday_box");
    }
  }

  const strategyVotes = {
    trend: Math.sign(
      (current.close > ema20 ? 1 : -1) +
      (ema20 > ema50 ? 1 : -1) +
      (cloud ? (current.close > cloud.cloudTop ? 1 : current.close < cloud.cloudBottom ? -1 : 0) : 0)
    ),
    momentum: Number.isFinite(rsi14)
      ? (rsi14 >= 55 && current.close > ema20 ? 1 : rsi14 <= 45 && current.close < ema20 ? -1 : 0)
      : 0,
    breakout: box
      ? (current.close > box.high ? 1 : current.close < box.low ? -1 : 0)
      : 0,
    otePullback: fib && current.close >= fib.oteLow && current.close <= fib.oteHigh
      ? (fib.impulse === "bullish" ? 1 : -1)
      : 0,
    meanReversion: Number.isFinite(rsi14)
      ? (rsi14 <= 25 ? 1 : rsi14 >= 75 ? -1 : 0)
      : 0
  };

  const intervalMinutes = TIMEFRAME_MINUTES[interval] ?? 60;
  const lastCandleMs = new Date(current.datetime).getTime();
  const ageMinutes = Number.isFinite(lastCandleMs) ? (Date.now() - lastCandleMs) / 60000 : Infinity;
  const stale = ageMinutes > Math.max(intervalMinutes * 3.5, 30);

  return {
    symbol,
    interval,
    valid: true,
    candleCount: candles.length,
    lastCandle: current.datetime,
    ageMinutes: Math.max(0, ageMinutes),
    stale,
    price: current.close,
    score,
    strategyVotes,
    reasons,
    indicators: { ema20, ema50, ema200, rsi14, atr14, ichimoku: cloud },
    fibonacci: fib,
    yesterdayBox: box,
    recentHigh,
    recentLow
  };
}

function flattenPayloads(payloads) {
  const series = [];
  for (const payload of payloads) {
    if (payload?.values && payload?.meta) {
      series.push(payload);
      continue;
    }
    for (const value of Object.values(payload ?? {})) {
      if (value?.values && value?.meta) series.push(value);
    }
  }
  return series;
}

function buildSignal(symbol, frames, instrumentConfig = {}) {
  const valid = frames.filter((frame) => frame.valid);
  if (!valid.length) {
    return { symbol, status: "NO_DATA", direction: "WAIT", confidence: 0, timeframes: frames };
  }
  let weightedScore = 0;
  let totalWeight = 0;
  for (const frame of valid) {
    const weight = TIMEFRAME_WEIGHTS[frame.interval] ?? 0.25;
    weightedScore += frame.score * weight;
    totalWeight += weight;
  }
  weightedScore = totalWeight ? weightedScore / totalWeight : 0;
  const riskProfile = instrumentConfig.riskProfile ?? "balanced";
  const riskRules = {
    conservative: { threshold: 1.6, agreement: 0.65, atrStop: 1.8, riskPercent: 0.5 },
    balanced: { threshold: 1.15, agreement: 0.5, atrStop: 1.6, riskPercent: 1.0 },
    aggressive: { threshold: 0.75, agreement: 0.4, atrStop: 1.35, riskPercent: 1.5 }
  };
  const selectedRisk = riskRules[riskProfile] ?? riskRules.balanced;
  const strategyNames = ["trend", "momentum", "breakout", "otePullback", "meanReversion"];
  const strategyScores = Object.fromEntries(strategyNames.map((strategy) => {
    const votes = valid.map((frame) => frame.strategyVotes?.[strategy] ?? 0);
    return [strategy, Number((average(votes) ?? 0).toFixed(2))];
  }));
  const priority = ["5min", "15min", "1h", "4h", "1day"];
  const executionFrame = [...valid].sort((a, b) => (
    priority.indexOf(a.interval) - priority.indexOf(b.interval)
  ))[0] ?? valid[0];
  const anchor = valid.find((frame) => frame.interval === "1h") ?? executionFrame;
  const price = executionFrame.price;
  const atrValue = anchor.indicators.atr14 ?? executionFrame.indicators.atr14 ?? price * 0.005;
  const direction = weightedScore >= 0 ? "LONG" : "SHORT";
  const agreement = valid.filter((frame) => Math.sign(frame.score) === Math.sign(weightedScore)).length / valid.length;
  const stale = valid.every((frame) => frame.stale);
  const directionalStrategyVotes = Object.values(strategyScores).filter((value) => value !== 0);
  const strategyAgreement = directionalStrategyVotes.length
    ? directionalStrategyVotes.filter((value) => Math.sign(value) === Math.sign(weightedScore)).length / directionalStrategyVotes.length
    : 0;
  const weak = Math.abs(weightedScore) < selectedRisk.threshold ||
    agreement < selectedRisk.agreement ||
    strategyAgreement < 0.5;
  const status = stale ? "STALE_DATA" : weak ? "WAIT_CONFIRMATION" : "ACTIONABLE";
  const fib = anchor.fibonacci;

  let entryLow;
  let entryHigh;
  if (fib && direction === "LONG" && fib.impulse === "bullish" && price >= fib.oteLow - atrValue && price <= fib.oteHigh + atrValue) {
    entryLow = fib.oteLow;
    entryHigh = fib.oteHigh;
  } else if (fib && direction === "SHORT" && fib.impulse === "bearish" && price >= fib.oteLow - atrValue && price <= fib.oteHigh + atrValue) {
    entryLow = fib.oteLow;
    entryHigh = fib.oteHigh;
  } else {
    entryLow = direction === "LONG" ? price - (atrValue * 0.20) : price - (atrValue * 0.10);
    entryHigh = direction === "LONG" ? price + (atrValue * 0.10) : price + (atrValue * 0.20);
  }
  const entry = (entryLow + entryHigh) / 2;
  const structuralStop = direction === "LONG"
    ? Math.min(anchor.recentLow, entry - (atrValue * selectedRisk.atrStop))
    : Math.max(anchor.recentHigh, entry + (atrValue * selectedRisk.atrStop));
  const risk = Math.max(Math.abs(entry - structuralStop), atrValue);
  const multiplier = direction === "LONG" ? 1 : -1;
  const takeProfits = [1, 1.5, 2, 3].map((multiple) => entry + (multiplier * risk * multiple));
  const confidence = Math.max(35, Math.min(88, Math.round(
    48 + (Math.abs(weightedScore) * 5) + (agreement * 18) - (stale ? 30 : 0)
  )));

  return {
    symbol,
    label: instrumentConfig.label ?? symbol,
    assetClass: instrumentConfig.assetClass ?? "other",
    currencies: instrumentConfig.currencies ?? [],
    status,
    direction,
    confidence,
    price: rounded(price, price),
    entryZone: [rounded(Math.min(entryLow, entryHigh), price), rounded(Math.max(entryLow, entryHigh), price)],
    stopLoss: rounded(structuralStop, price),
    takeProfits: takeProfits.map((target) => rounded(target, price)),
    riskDistance: rounded(risk, price),
    riskProfile,
    suggestedRiskPercent: selectedRisk.riskPercent,
    score: Number(weightedScore.toFixed(3)),
    timeframeAgreement: Number(agreement.toFixed(2)),
    strategyAgreement: Number(strategyAgreement.toFixed(2)),
    strategies: strategyScores,
    opportunityScore: Math.round(confidence * (0.65 + (agreement * 0.2) + (strategyAgreement * 0.15))),
    dataFresh: !stale,
    fibonacci: fib ? {
      impulse: fib.impulse,
      swingLow: rounded(fib.low, price),
      swingHigh: rounded(fib.high, price),
      oteZone: [rounded(fib.oteLow, price), rounded(fib.oteHigh, price)]
    } : null,
    yesterdayBox: anchor.yesterdayBox ? {
      date: anchor.yesterdayBox.date,
      high: rounded(anchor.yesterdayBox.high, price),
      mid: rounded(anchor.yesterdayBox.mid, price),
      low: rounded(anchor.yesterdayBox.low, price)
    } : null,
    timeframes: valid.map((frame) => ({
      interval: frame.interval,
      score: Number(frame.score.toFixed(2)),
      price: rounded(frame.price, price),
      rsi14: rounded(frame.indicators.rsi14, 100),
      atr14: rounded(frame.indicators.atr14, price),
      ichimokuBias: frame.indicators.ichimoku
        ? frame.price > frame.indicators.ichimoku.cloudTop
          ? "bullish"
          : frame.price < frame.indicators.ichimoku.cloudBottom
            ? "bearish"
            : "neutral"
        : "unavailable",
      stale: frame.stale,
      reasons: frame.reasons
    }))
  };
}

function analyzeMarketPayloads(payloads, config = {}) {
  const series = flattenPayloads(payloads);
  const analyses = series.map(analyzeSeries);
  const groups = new Map();
  for (const analysis of analyses) {
    if (!groups.has(analysis.symbol)) groups.set(analysis.symbol, []);
    groups.get(analysis.symbol).push(analysis);
  }
  const instruments = config.instruments ?? [];
  const instrumentMap = new Map(instruments.map((instrument) => [
    instrument.symbol,
    { ...instrument, riskProfile: instrument.riskProfile ?? config.riskProfile ?? "balanced" }
  ]));
  const signals = [...groups.entries()].map(([symbol, frames]) => (
    buildSignal(symbol, frames, instrumentMap.get(symbol))
  ));
  signals.sort((a, b) => b.opportunityScore - a.opportunityScore);
  const errors = analyses.filter((analysis) => !analysis.valid);
  return {
    generatedAt: new Date().toISOString(),
    signals,
    dataQuality: {
      receivedSeries: series.length,
      validSeries: analyses.length - errors.length,
      invalidSeries: errors.length,
      errors
    }
  };
}

export {
  analyzeMarketPayloads,
  analyzeSeries,
  buildSignal,
  fibonacci,
  yesterdayBox
};
