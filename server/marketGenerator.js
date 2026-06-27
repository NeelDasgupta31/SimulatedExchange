const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

// Settlement payoff functions
function settlementValue(market, trueValues) {
  const underlying = trueValues[market.underlyingId] ?? market.trueValue;
  const v1 = () => trueValues[market.leg1Id] ?? 0;
  const v2 = () => trueValues[market.leg2Id] ?? 0;
  switch (market.type) {
    case 'underlying': return market.trueValue;
    case 'call':   return Math.max(0, underlying - market.strike);
    case 'put':    return Math.max(0, market.strike - underlying);
    case 'straddle': return Math.abs(underlying - market.strike);
    case 'strangle': return Math.max(0, underlying - market.upperStrike) + Math.max(0, market.lowerStrike - underlying);
    case 'call_spread': return Math.min(Math.max(0, underlying - market.lowerStrike), market.upperStrike - market.lowerStrike);
    case 'put_spread':  return Math.min(Math.max(0, market.upperStrike - underlying), market.upperStrike - market.lowerStrike);
    case 'spread': case 'diff': return v1() - v2();
    case 'sum':    return v1() + v2();
    case 'max_of': return Math.max(v1(), v2());
    case 'min_of': return Math.min(v1(), v2());
    default: return market.trueValue;
  }
}

// Options fair value for a normal distribution N(mu, sigma)
function normalCDF(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422820 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  return x >= 0 ? 1 - p : p;
}
function normalPDF(x) { return Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI); }

function optionFairValue(type, mu, sigma, strike, lowerStrike, upperStrike) {
  if (sigma <= 0) sigma = 0.001;
  const d = (mu - strike) / sigma;
  switch (type) {
    case 'call':
      return (mu - strike) * normalCDF(d) + sigma * normalPDF(d);
    case 'put':
      return (strike - mu) * normalCDF(-d) + sigma * normalPDF(d);
    case 'straddle': {
      const ds = (mu - strike) / sigma;
      return 2 * sigma * normalPDF(ds) + (mu - strike) * (2 * normalCDF(ds) - 1);
    }
    case 'strangle': {
      const dU = (mu - upperStrike) / sigma;
      const dL = (mu - lowerStrike) / sigma;
      return (mu - upperStrike) * normalCDF(dU) + sigma * normalPDF(dU)
           + (lowerStrike - mu) * normalCDF(-dL) + sigma * normalPDF(dL);
    }
    case 'call_spread': {
      const callL = optionFairValue('call', mu, sigma, lowerStrike);
      const callU = optionFairValue('call', mu, sigma, upperStrike);
      return Math.max(0, callL - callU);
    }
    case 'put_spread': {
      const putU = optionFairValue('put', mu, sigma, upperStrike);
      const putL = optionFairValue('put', mu, sigma, lowerStrike);
      return Math.max(0, putU - putL);
    }
    default: return mu;
  }
}

// Initial mid-price for a derivative given true value and spread
function derivativeInitialMid(market, underlyingTrueValue, sigma) {
  switch (market.type) {
    case 'call':   return optionFairValue('call', underlyingTrueValue, sigma, market.strike);
    case 'put':    return optionFairValue('put', underlyingTrueValue, sigma, market.strike);
    case 'straddle': return optionFairValue('straddle', underlyingTrueValue, sigma, market.strike);
    case 'strangle': return optionFairValue('strangle', underlyingTrueValue, sigma, 0, market.lowerStrike, market.upperStrike);
    case 'call_spread': return optionFairValue('call_spread', underlyingTrueValue, sigma, 0, market.lowerStrike, market.upperStrike);
    case 'put_spread':  return optionFairValue('put_spread', underlyingTrueValue, sigma, 0, market.lowerStrike, market.upperStrike);
    default: return underlyingTrueValue;
  }
}

async function generateRandomMarketSuite() {
  const prompt = `You are designing markets for a simulated trading exchange game. Players estimate hidden real-world values and trade.

Generate EXACTLY 6 markets total around ONE interesting real-world topic. Structure them in this JSON format with "underlyings", "derivatives", and "combinations" arrays.

UNDERLYING types (1-3 markets): base real-world quantities. Each needs: id, type="underlying", name, trueValue, spread (~1-3% of trueValue), description, unit.

DERIVATIVE types (options on a single underlying): call, put, straddle, strangle, call_spread, put_spread.
Each needs: id, type, underlyingId, name, spread, description.
Options also need: strike (within ±15% of trueValue).
call_spread/put_spread need: lowerStrike, upperStrike (both within ±20%, lower < upper).
strangle needs: lowerStrike < trueValue < upperStrike.

COMBINATION types (on pairs of underlyings): diff (leg1-leg2), sum (leg1+leg2), max_of (max(leg1,leg2)), min_of (min(leg1,leg2)).
Each needs: id, type, leg1Id, leg2Id, name, spread, description.

RULES:
- Total across all three arrays must be EXACTLY 6 markets.
- Pick a creative mix — sometimes mostly underlyings+combinations, sometimes 1 underlying+many options.
- Spread field = bid-ask spread (not market spread). ~1-3% of price for underlyings, ~5-15% for derivatives/combinations.
- True values must require real knowledge to estimate (history, geography, science, sports records, etc).

Example structures (pick your own topic — do NOT use population):
Option A: 2 underlyings + 2 options + 2 combinations = 6
Option B: 3 underlyings + 3 combinations = 6
Option C: 1 underlying + 5 options = 6

Return ONLY this JSON:
{
  "theme": "...",
  "roundName": "SHORT-CODE",
  "underlyings": [...],
  "derivatives": [...],
  "combinations": [...]
}
No extra text.`;

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = msg.content[0].text.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in LLM response: ' + text.slice(0, 200));
  return JSON.parse(jsonMatch[0]);
}

async function generateCustomMarketSuite(topics) {
  const prompt = `You are designing markets for a simulated trading exchange game.

The user wants markets on these topics: ${topics.join(', ')}

Create EXACTLY 6 markets total. Use the same JSON structure with "underlyings", "derivatives", "combinations" arrays.

UNDERLYING: id, type="underlying", name, trueValue, spread (~1-3% of trueValue), description, unit.
DERIVATIVE (options): type=call/put/straddle/strangle/call_spread/put_spread, id, underlyingId, name, spread, description, strike (or lowerStrike+upperStrike). Strikes within ±15% of trueValue.
COMBINATION: type=diff/sum/max_of/min_of, id, leg1Id, leg2Id, name, spread, description.

Keep total to exactly 6 markets across all three arrays.

Return ONLY:
{
  "theme": "...",
  "roundName": "SHORT",
  "underlyings": [...],
  "derivatives": [...],
  "combinations": [...]
}`;

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = msg.content[0].text.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in LLM response');
  return JSON.parse(jsonMatch[0]);
}

async function generateNews(markets, newsHistory) {
  const marketSummary = markets.map(m => {
    if (m.type === 'underlying') return `${m.name}: true value = ${m.trueValue} ${m.unit || ''}`;
    return `${m.name}: type=${m.type}`;
  }).join('\n');

  const recentNews = newsHistory.slice(0, 3).map(n => n.text).join('\n');

  const prompt = `You are generating news for a simulated trading exchange. Players trade markets where the true values are hidden.

Markets in play:
${marketSummary}

Recent news already published:
${recentNews || '(none yet)'}

Generate ONE realistic news item that:
1. Gives a NOISY signal about the true value (not exact, could be off by 5-15%)
2. Sounds like a realistic news headline + 1 sentence
3. Is relevant to the market topic
4. Sometimes confirms, sometimes misleads slightly

Also include a "signal" - your best estimate of what a careful reader would infer about the underlying value(s).

Return JSON:
{
  "headline": "string - news headline",
  "body": "string - one sentence elaboration",
  "signals": [
    {"underlyingId": "u1", "estimatedValue": 67.5, "confidence": 0.6}
  ]
}

Only return the JSON.`;

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = msg.content[0].text.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  return JSON.parse(jsonMatch[0]);
}

module.exports = { generateRandomMarketSuite, generateCustomMarketSuite, generateNews, settlementValue, optionFairValue, derivativeInitialMid };
