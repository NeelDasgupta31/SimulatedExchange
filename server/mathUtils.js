function normalCDF(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422820 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  return x >= 0 ? 1 - p : p;
}
function normalPDF(x) { return Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI); }

function optionFairValue(type, mu, sigma, strike, lowerStrike, upperStrike) {
  if (sigma <= 0) sigma = 0.001;
  switch (type) {
    case 'call': {
      const d = (mu - strike) / sigma;
      return Math.max(0, (mu - strike) * normalCDF(d) + sigma * normalPDF(d));
    }
    case 'put': {
      const d = (mu - strike) / sigma;
      return Math.max(0, (strike - mu) * normalCDF(-d) + sigma * normalPDF(d));
    }
    case 'straddle': {
      const d = (mu - strike) / sigma;
      return Math.max(0, 2 * sigma * normalPDF(d) + (mu - strike) * (2 * normalCDF(d) - 1));
    }
    case 'strangle': {
      const dU = (mu - upperStrike) / sigma;
      const dL = (mu - lowerStrike) / sigma;
      return Math.max(0,
        (mu - upperStrike) * normalCDF(dU) + sigma * normalPDF(dU) +
        (lowerStrike - mu) * normalCDF(-dL) + sigma * normalPDF(dL));
    }
    case 'call_spread': {
      return Math.max(0, optionFairValue('call', mu, sigma, lowerStrike) - optionFairValue('call', mu, sigma, upperStrike));
    }
    case 'put_spread': {
      return Math.max(0, optionFairValue('put', mu, sigma, upperStrike) - optionFairValue('put', mu, sigma, lowerStrike));
    }
    default: return mu;
  }
}

function derivativeInitialMid(market, underlyingTrueValue) {
  const sigma = underlyingTrueValue * 0.10;
  switch (market.type) {
    case 'call':        return optionFairValue('call', underlyingTrueValue, sigma, market.strike);
    case 'put':         return optionFairValue('put', underlyingTrueValue, sigma, market.strike);
    case 'straddle':    return optionFairValue('straddle', underlyingTrueValue, sigma, market.strike);
    case 'strangle':    return optionFairValue('strangle', underlyingTrueValue, sigma, 0, market.lowerStrike, market.upperStrike);
    case 'call_spread': return optionFairValue('call_spread', underlyingTrueValue, sigma, 0, market.lowerStrike, market.upperStrike);
    case 'put_spread':  return optionFairValue('put_spread', underlyingTrueValue, sigma, 0, market.lowerStrike, market.upperStrike);
    default: return underlyingTrueValue;
  }
}

function settlementValue(market, trueValues) {
  const ul = trueValues[market.underlyingId] ?? market.trueValue ?? 0;
  const v1 = () => trueValues[market.leg1Id] ?? 0;
  const v2 = () => trueValues[market.leg2Id] ?? 0;
  switch (market.type) {
    case 'underlying':  return market.trueValue;
    case 'call':        return Math.max(0, ul - market.strike);
    case 'put':         return Math.max(0, market.strike - ul);
    case 'straddle':    return Math.abs(ul - market.strike);
    case 'strangle':    return Math.max(0, ul - market.upperStrike) + Math.max(0, market.lowerStrike - ul);
    case 'call_spread': return Math.min(Math.max(0, ul - market.lowerStrike), market.upperStrike - market.lowerStrike);
    case 'put_spread':  return Math.min(Math.max(0, market.upperStrike - ul), market.upperStrike - market.lowerStrike);
    case 'spread': case 'diff': return v1() - v2();
    case 'sum':    return v1() + v2();
    case 'max_of': return Math.max(v1(), v2());
    case 'min_of': return Math.min(v1(), v2());
    default: return market.trueValue ?? 0;
  }
}

module.exports = { optionFairValue, derivativeInitialMid, settlementValue };
