const { optionFairValue, settlementValue } = require('./marketGenerator');

// Normal distribution helpers
function normalCDF(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422820 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  return x >= 0 ? 1 - p : p;
}
function normalPDF(x) { return Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI); }
function randGaussian() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

class Bot {
  constructor(id, name, strategy, books, positions, limits) {
    this.id = id;
    this.name = name;
    this.strategy = strategy;
    this.books = books;
    this.positions = positions;
    this.limits = limits;
    this.lastAction = 0;
    this.intervalMs = 800 + Math.random() * 1500;
    this.estimates = {};   // underlyingId -> { mu, sigma }
    this.newsSignals = {}; // underlyingId -> [{mu, confidence}]
  }

  getPosition(productId) {
    const pos = this.positions.get(`${this.id}:${productId}`);
    return pos ? pos.net : 0;
  }

  // Update belief about underlying from news signal
  absorbNewsSignal(underlyingId, signalMu, confidence) {
    if (!this.estimates[underlyingId]) return;
    const prior = this.estimates[underlyingId];
    // Bayesian update (simplified): weighted average of prior mean and signal
    const priorWeight = 1 - confidence * 0.4;
    const signalWeight = confidence * 0.4;
    prior.mu = priorWeight * prior.mu + signalWeight * signalMu;
    // Reduce uncertainty a bit
    prior.sigma = prior.sigma * (1 - confidence * 0.15);
  }

  // Get fair value for a market given this bot's beliefs
  getFairValue(market, allMarkets) {
    if (market.type === 'underlying') {
      return this.estimates[market.id]?.mu ?? market.trueValue;
    }

    const underlyingId = market.underlyingId ?? market.leg1Id;
    const est = this.estimates[underlyingId];
    if (!est) return null;

    const { mu, sigma } = est;

    switch (market.type) {
      case 'call':   return optionFairValue('call', mu, sigma, market.strike);
      case 'put':    return optionFairValue('put', mu, sigma, market.strike);
      case 'straddle': return optionFairValue('straddle', mu, sigma, market.strike);
      case 'strangle': return optionFairValue('strangle', mu, sigma, 0, market.lowerStrike, market.upperStrike);
      case 'call_spread': return optionFairValue('call_spread', mu, sigma, 0, market.lowerStrike, market.upperStrike);
      case 'put_spread':  return optionFairValue('put_spread', mu, sigma, 0, market.lowerStrike, market.upperStrike);
      case 'spread': case 'diff': {
        const est2 = this.estimates[market.leg2Id];
        if (!est2) return null;
        return mu - est2.mu;
      }
      case 'sum': {
        const est2 = this.estimates[market.leg2Id];
        if (!est2) return null;
        return mu + est2.mu;
      }
      case 'max_of': {
        const est2 = this.estimates[market.leg2Id];
        if (!est2) return null;
        return Math.max(mu, est2.mu);
      }
      case 'min_of': {
        const est2 = this.estimates[market.leg2Id];
        if (!est2) return null;
        return Math.min(mu, est2.mu);
      }
      default: return null;
    }
  }

  act(markets) {
    const now = Date.now();
    if (now - this.lastAction < this.intervalMs) return [];
    this.lastAction = now;
    this.intervalMs = 800 + Math.random() * 1500;
    try {
      return this.strategy(markets, this.books, this);
    } catch (e) {
      return [];
    }
  }
}

// Initialize beliefs for all markets
function initBotEstimates(bot, markets, initialNoiseFactor = 1.0) {
  for (const market of markets) {
    if (market.type === 'underlying') {
      const noiseStd = market.trueValue * 0.08 * initialNoiseFactor;
      bot.estimates[market.id] = {
        mu: market.trueValue + randGaussian() * noiseStd,
        sigma: market.trueValue * 0.12 * initialNoiseFactor,
      };
    }
  }
}

// --- Strategies ---

// Market maker: quotes around fair value for all markets
function marketMakerStrategy(markets, books, bot) {
  const orders = [];
  for (const market of markets) {
    const book = books.get(market.id);
    if (!book) continue;

    const pos = bot.getPosition(market.id);
    if (Math.abs(pos) >= bot.limits - 2) continue;

    // Initialize estimates for underlyings if needed
    if (market.type === 'underlying' && !bot.estimates[market.id]) {
      initBotEstimates(bot, markets);
    }

    const fv = bot.getFairValue(market, markets);
    if (fv === null || fv < 0) continue;

    const halfSpread = market.spread * (0.7 + Math.random() * 0.6);
    const skew = pos * market.spread * 0.2;

    const bidPrice = Math.max(0, Math.round((fv - halfSpread - skew) * 10) / 10);
    const askPrice = Math.round((fv + halfSpread - skew) * 10) / 10;

    if (bidPrice < askPrice && askPrice > 0) {
      const vol = Math.ceil(Math.random() * 3);
      orders.push({ productId: market.id, side: 'BUY', price: bidPrice, volume: vol });
      orders.push({ productId: market.id, side: 'SELL', price: askPrice, volume: vol });
    }
  }
  return orders;
}

// Directional: aggressively trades when book is away from fair value
function directionalStrategy(markets, books, bot) {
  const orders = [];
  for (const market of markets) {
    const book = books.get(market.id);
    if (!book) continue;

    if (!bot.estimates[market.id] && market.type === 'underlying') {
      initBotEstimates(bot, markets, 1.5); // more uncertain
    }

    const fv = bot.getFairValue(market, markets);
    if (fv === null || fv < 0) continue;

    const bestBid = book.getBestBid();
    const bestAsk = book.getBestAsk();
    const pos = bot.getPosition(market.id);
    if (Math.abs(pos) >= bot.limits - 1) continue;

    if (bestAsk !== null && fv > bestAsk + market.spread * 0.5) {
      orders.push({ productId: market.id, side: 'BUY', price: bestAsk, volume: Math.ceil(Math.random() * 2) });
    } else if (bestBid !== null && fv < bestBid - market.spread * 0.5) {
      orders.push({ productId: market.id, side: 'SELL', price: bestBid, volume: Math.ceil(Math.random() * 2) });
    }
  }
  return orders;
}

// Noise trader: random activity
function noiseStrategy(markets, books, bot) {
  const orders = [];
  if (Math.random() > 0.35) return orders;
  const market = markets[Math.floor(Math.random() * markets.length)];
  if (!market) return orders;
  const book = books.get(market.id);
  if (!book) return orders;
  const pos = bot.getPosition(market.id);
  if (Math.abs(pos) >= bot.limits - 1) return orders;
  const bestBid = book.getBestBid();
  const bestAsk = book.getBestAsk();
  if (!bestBid || !bestAsk) return orders;
  const mid = (bestBid + bestAsk) / 2;
  const side = (pos < 0 || Math.random() > 0.5) ? 'BUY' : 'SELL';
  if (side === 'BUY' && pos >= bot.limits - 1) return orders;
  if (side === 'SELL' && pos <= -(bot.limits - 1)) return orders;
  const price = Math.max(0, Math.round((mid + (side === 'BUY' ? -1 : 1) * market.spread * Math.random() * 1.5) * 10) / 10);
  orders.push({ productId: market.id, side, price, volume: 1 });
  return orders;
}

// Options arb: trades put-call parity and spread relationships
function optionsArbStrategy(markets, books, bot) {
  const orders = [];

  // Find underlyings + their options
  const underlyings = markets.filter(m => m.type === 'underlying');

  for (const ul of underlyings) {
    if (!bot.estimates[ul.id]) initBotEstimates(bot, markets);
    const ulBook = books.get(ul.id);
    if (!ulBook) continue;
    const ulBid = ulBook.getBestBid(), ulAsk = ulBook.getBestAsk();
    if (!ulBid || !ulAsk) continue;
    const ulMid = (ulBid + ulAsk) / 2;

    // Find calls and puts on this underlying with same strike → put-call parity
    const derivs = markets.filter(m => m.underlyingId === ul.id);
    const calls = derivs.filter(m => m.type === 'call');
    const puts = derivs.filter(m => m.type === 'put');
    const straddles = derivs.filter(m => m.type === 'straddle');

    // Put-call parity: C - P = S - K  →  straddle ≈ 2 * min(call, put) + |S - K|
    for (const call of calls) {
      const matchPut = puts.find(p => p.strike === call.strike);
      if (!matchPut) continue;

      const callBook = books.get(call.id);
      const putBook = books.get(matchPut.id);
      if (!callBook || !putBook) continue;

      const callBid = callBook.getBestBid(), callAsk = callBook.getBestAsk();
      const putBid = putBook.getBestBid(), putAsk = putBook.getBestAsk();
      if (!callBid || !callAsk || !putBid || !putAsk) continue;

      // Synthetic: C - P = S - K
      const callMid = (callBid + callAsk) / 2;
      const putMid = (putBid + putAsk) / 2;
      const synth = callMid - putMid;  // should equal ulMid - call.strike
      const theoretical = ulMid - call.strike;
      const misPrice = synth - theoretical;
      const threshold = (call.spread + matchPut.spread + ul.spread) * 0.6;

      const posC = bot.getPosition(call.id);
      const posP = bot.getPosition(matchPut.id);

      if (misPrice > threshold && Math.random() < 0.5) {
        // C overpriced vs P: sell call, buy put
        if (Math.abs(posC) < bot.limits - 1) orders.push({ productId: call.id, side: 'SELL', price: callBid, volume: 1 });
        if (Math.abs(posP) < bot.limits - 1) orders.push({ productId: matchPut.id, side: 'BUY', price: putAsk, volume: 1 });
      } else if (misPrice < -threshold && Math.random() < 0.5) {
        // P overpriced vs C: buy call, sell put
        if (Math.abs(posC) < bot.limits - 1) orders.push({ productId: call.id, side: 'BUY', price: callAsk, volume: 1 });
        if (Math.abs(posP) < bot.limits - 1) orders.push({ productId: matchPut.id, side: 'SELL', price: putBid, volume: 1 });
      }
    }

    // Straddle vs call+put arb: straddle(K) ≈ call(K) + put(K)
    for (const straddle of straddles) {
      const matchCall = calls.find(c => c.strike === straddle.strike);
      const matchPut = puts.find(p => p.strike === straddle.strike);
      if (!matchCall || !matchPut) continue;
      const sBook = books.get(straddle.id);
      const cBook = books.get(matchCall.id);
      const pBook = books.get(matchPut.id);
      if (!sBook || !cBook || !pBook) continue;
      const sBid = sBook.getBestBid(), sAsk = sBook.getBestAsk();
      const cBid = cBook.getBestBid(), cAsk = cBook.getBestAsk();
      const pBid = pBook.getBestBid(), pAsk = pBook.getBestAsk();
      if (!sBid || !sAsk || !cBid || !cAsk || !pBid || !pAsk) continue;
      const straddleMid = (sBid + sAsk) / 2;
      const syntheticStraddle = (cBid + cAsk) / 2 + (pBid + pAsk) / 2;
      const misPrice = straddleMid - syntheticStraddle;
      const threshold = (straddle.spread + matchCall.spread + matchPut.spread) * 0.5;
      const posS = bot.getPosition(straddle.id);
      if (misPrice > threshold && Math.random() < 0.5 && Math.abs(posS) < bot.limits - 1) {
        orders.push({ productId: straddle.id, side: 'SELL', price: sBid, volume: 1 });
      } else if (misPrice < -threshold && Math.random() < 0.5 && Math.abs(posS) < bot.limits - 1) {
        orders.push({ productId: straddle.id, side: 'BUY', price: sAsk, volume: 1 });
      }
    }
  }

  // Spread market arb: spread(u1,u2) vs u1 - u2
  const spreadMarkets = markets.filter(m => m.type === 'spread');
  for (const sm of spreadMarkets) {
    const b1 = books.get(sm.leg1Id), b2 = books.get(sm.leg2Id), bs = books.get(sm.id);
    if (!b1 || !b2 || !bs) continue;
    const bid1 = b1.getBestBid(), ask1 = b1.getBestAsk();
    const bid2 = b2.getBestBid(), ask2 = b2.getBestAsk();
    const bidS = bs.getBestBid(), askS = bs.getBestAsk();
    if (!bid1 || !ask1 || !bid2 || !ask2 || !bidS || !askS) continue;
    const impliedSpread = (bid1 + ask1) / 2 - (bid2 + ask2) / 2;
    const spreadMid = (bidS + askS) / 2;
    const misPrice = spreadMid - impliedSpread;
    const threshold = sm.spread * 0.7;
    const pos = bot.getPosition(sm.id);
    if (Math.abs(misPrice) > threshold && Math.random() < 0.5 && Math.abs(pos) < bot.limits - 1) {
      if (misPrice > threshold) orders.push({ productId: sm.id, side: 'SELL', price: bidS, volume: 1 });
      else orders.push({ productId: sm.id, side: 'BUY', price: askS, volume: 1 });
    }
  }

  return orders;
}

// Gamma scalper: trades when straddle seems mispriced vs realized vol in the book
function gammaScalperStrategy(markets, books, bot) {
  const orders = [];
  const straddles = markets.filter(m => m.type === 'straddle' || m.type === 'strangle');
  for (const s of straddles) {
    if (!bot.estimates[s.underlyingId]) continue;
    const fv = bot.getFairValue(s, markets);
    if (fv === null) continue;
    const book = books.get(s.id);
    if (!book) continue;
    const bid = book.getBestBid(), ask = book.getBestAsk();
    if (!bid || !ask) continue;
    const mid = (bid + ask) / 2;
    const pos = bot.getPosition(s.id);
    if (Math.abs(pos) >= bot.limits - 1) continue;
    const edge = fv - mid;
    if (edge > s.spread * 0.4 && Math.random() < 0.4) {
      orders.push({ productId: s.id, side: 'BUY', price: ask, volume: 1 });
    } else if (edge < -s.spread * 0.4 && Math.random() < 0.4) {
      orders.push({ productId: s.id, side: 'SELL', price: bid, volume: 1 });
    }
  }
  return orders;
}

function createBots(books, positions, positionLimit) {
  const strategies = [];
  for (let i = 1; i <= 22; i++) strategies.push({ name: `MM-${i}`, fn: marketMakerStrategy });
  for (let i = 1; i <= 10; i++) strategies.push({ name: `Dir-${i}`, fn: directionalStrategy });
  for (let i = 1; i <= 8; i++) strategies.push({ name: `Noise-${i}`, fn: noiseStrategy });
  for (let i = 1; i <= 6; i++) strategies.push({ name: `Arb-${i}`, fn: optionsArbStrategy });
  for (let i = 1; i <= 4; i++) strategies.push({ name: `Gamma-${i}`, fn: gammaScalperStrategy });
  return strategies.map((s, i) => new Bot(`bot-${i}`, s.name, s.fn, books, positions, positionLimit));
}

module.exports = { createBots, initBotEstimates };
