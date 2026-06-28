const { OrderBook } = require('./matchingEngine');
const { settlementValue, derivativeInitialMid } = require('./mathUtils');

const COMBO_TYPES = new Set(['spread', 'diff', 'sum', 'max_of', 'min_of']);

function roundToTick(price, tickSize) {
  return Math.round(price / tickSize) * tickSize;
}

class Exchange {
  constructor() {
    this.markets = new Map();
    this.books = new Map();
    this.positions = new Map();
    this.traderNames = new Map();
    this.positionLimit = 10;
    this.tickSize = 0.1;
    this.recentTrades = [];
    this.lastTradedPrice = new Map(); // productId -> last trade price
    this.newsItems = [];
    this.roundActive = false;
    this.roundName = '';
    this.listeners = new Set();
    this.revealTimeout = null;
  }

  addListener(ws) { this.listeners.add(ws); }
  removeListener(ws) { this.listeners.delete(ws); }
  setTraderName(traderId, name) {
    if (name) this.traderNames.set(traderId, String(name).slice(0, 20).trim());
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const ws of this.listeners) {
      try { ws.send(data); } catch (e) {}
    }
  }

  // markets: flat array, underlyings have refPrice (for ladder centering) but NOT trueValue
  // tickSize: e.g. 0.1, 0.5, 1, 5
  setupMarkets(suite, roundName, tickSize) {
    this.markets.clear();
    this.books.clear();
    this.positions.clear();
    this.recentTrades = [];
    this.lastTradedPrice.clear();
    this.newsItems = [];
    this.roundName = roundName || 'ROUND';
    this.roundActive = true;
    this.tickSize = tickSize || 0.1;

    const allConfigs = suite.markets || [];
    // refPrices used for option initial mid computation only (visible to all)
    const refPrices = {};
    for (const cfg of allConfigs) {
      if (cfg.type === 'underlying') refPrices[cfg.id] = cfg.refPrice || 100;
    }

    for (const cfg of allConfigs) {
      const market = { ...cfg };
      market.revealed = false;
      market.trueValue = undefined;
      market.settlementValue = undefined;
      const ts = market.tickSize || this.tickSize;
      market.tickSize = ts;

      if (cfg.type === 'underlying') {
        market.initialMidPrice = roundToTick(cfg.refPrice || 100, ts);
      } else if (COMBO_TYPES.has(cfg.type)) {
        const r1 = refPrices[cfg.leg1Id] || 0;
        const r2 = refPrices[cfg.leg2Id] || 0;
        let ref;
        switch (cfg.type) {
          case 'diff': case 'spread': ref = r1 - r2; break;
          case 'sum':    ref = r1 + r2; break;
          case 'max_of': ref = Math.max(r1, r2); break;
          case 'min_of': ref = Math.min(r1, r2); break;
          default: ref = r1;
        }
        market.initialMidPrice = roundToTick(Math.max(0, ref), ts);
      } else {
        const ulRef = refPrices[cfg.underlyingId] || 100;
        const approxFv = derivativeInitialMid(cfg, ulRef);
        market.initialMidPrice = roundToTick(Math.max(0, approxFv), ts);
      }

      this.markets.set(cfg.id, market);
      this.books.set(cfg.id, new OrderBook(cfg.id));
    }

    if (this.revealTimeout) clearTimeout(this.revealTimeout);

    for (const ws of this.listeners) {
      try {
        ws.send(JSON.stringify({ type: 'init', traderId: ws.traderId, state: this.getStateForTrader(ws.traderId) }));
      } catch (e) {}
    }
  }

  // Host enters true values after looking them up → settle all markets
  settle(trueValues) {
    // Set underlying true values
    for (const [id, market] of this.markets) {
      if (market.type === 'underlying' && trueValues[id] != null) {
        market.trueValue = parseFloat(trueValues[id]);
        market.settlementValue = market.trueValue;
      }
    }
    // Compute derivative/combo settlements from those true values
    const tvMap = {};
    for (const [id, market] of this.markets) {
      if (market.type === 'underlying') tvMap[id] = market.trueValue;
    }
    for (const [, market] of this.markets) {
      if (market.type !== 'underlying') {
        market.settlementValue = settlementValue(market, tvMap);
        market.trueValue = market.settlementValue;
      }
    }
    // Reveal all
    for (const [, market] of this.markets) market.revealed = true;
    this.roundActive = false;

    const revealed = Array.from(this.markets.values()).map(m => ({
      id: m.id, name: m.name, type: m.type,
      trueValue: m.trueValue, settlementValue: m.settlementValue,
    }));
    this.broadcast({ type: 'reveal', markets: revealed });

    const lines = revealed
      .filter(m => m.type === 'underlying')
      .map(m => `${m.name}: ${m.settlementValue?.toFixed(2)}`);
    this.addNews('SETTLED — ' + lines.join(' | '));
    this._broadcastLeaderboard();

    // Push final positions with settlement-based PnL to every trader
    for (const ws of this.listeners) {
      if (!ws.traderId) continue;
      try {
        const s = this.getStateForTrader(ws.traderId);
        ws.send(JSON.stringify({ type: 'state_update', myPositions: s.myPositions, myTrades: s.myTrades, activeOrders: s.activeOrders, totalPnl: s.totalPnl }));
      } catch (e) {}
    }
  }

  _getOrCreatePosition(traderId, productId) {
    const key = `${traderId}:${productId}`;
    if (!this.positions.has(key)) {
      this.positions.set(key, {
        traderId, productId, net: 0,
        buyVolume: 0, sellVolume: 0,
        avgBuy: 0, avgSell: 0,
        totalBuyCost: 0, totalSellRevenue: 0,
        realizedPnl: 0,
      });
    }
    return this.positions.get(key);
  }

  _applyTrades(trades) {
    for (const { productId, price, volume, buyerId, sellerId } of trades) {
      const bp = this._getOrCreatePosition(buyerId, productId);
      // If we're buying into a short, realize PnL on the covered portion
      if (bp.net < 0) {
        const covered = Math.min(volume, -bp.net);
        bp.realizedPnl += covered * (bp.avgSell - price);
      }
      bp.totalBuyCost += price * volume; bp.buyVolume += volume;
      bp.avgBuy = bp.totalBuyCost / bp.buyVolume; bp.net += volume;

      const sp = this._getOrCreatePosition(sellerId, productId);
      // If we're selling into a long, realize PnL on the closed portion
      if (sp.net > 0) {
        const closed = Math.min(volume, sp.net);
        sp.realizedPnl += closed * (price - sp.avgBuy);
      }
      sp.totalSellRevenue += price * volume; sp.sellVolume += volume;
      sp.avgSell = sp.totalSellRevenue / sp.sellVolume; sp.net -= volume;

      this.lastTradedPrice.set(productId, price);
      this.recentTrades.unshift({ productId, price, volume, buyerId, sellerId, timestamp: Date.now(), lastTradedPrice: price });
    }
    if (this.recentTrades.length > 500) this.recentTrades.length = 500;
  }

  _doPlaceOrder(traderId, productId, side, price, volume) {
    const book = this.books.get(productId);
    const market = this.markets.get(productId);
    if (!book || !market) return { error: 'Unknown product' };
    const pos = this._getOrCreatePosition(traderId, productId);
    if (side === 'BUY' && pos.net >= this.positionLimit) return { error: 'Position limit reached' };
    if (side === 'SELL' && pos.net <= -this.positionLimit) return { error: 'Position limit reached' };
    const tickSize = market.tickSize || this.tickSize;
    const safePrice = Math.max(0, roundToTick(price, tickSize));

    // Auto-cancel own orders that would cross the new order
    const myOrders = book.getActiveOrdersForTrader(traderId);
    if (side === 'SELL') {
      // Cancel own highest BUY at or above this sell price
      const crossingBuys = myOrders.filter(o => o.side === 'BUY' && o.price >= safePrice)
        .sort((a, b) => b.price - a.price);
      if (crossingBuys.length > 0) { book.cancelOrder(crossingBuys[0].id); return { trades: [], orderId: null, cancelled: true }; }
    } else {
      // Cancel own lowest SELL at or below this buy price
      const crossingSells = myOrders.filter(o => o.side === 'SELL' && o.price <= safePrice)
        .sort((a, b) => a.price - b.price);
      if (crossingSells.length > 0) { book.cancelOrder(crossingSells[0].id); return { trades: [], orderId: null, cancelled: true }; }
    }

    const result = book.addOrder(traderId, side, safePrice, Math.round(volume));
    this._applyTrades(result.trades);
    return result;
  }

  placeOrder(traderId, productId, side, price, volume) {
    const result = this._doPlaceOrder(traderId, productId, side, price, volume);
    if (!result.error) {
      this._broadcastBookUpdates();
      for (const trade of result.trades) {
        this.broadcast({ type: 'trade', trade: { ...trade, productName: this.markets.get(trade.productId)?.name } });
      }
      this._broadcastLeaderboard();
      // Send state updates to placer AND any counterparties whose positions changed
      const affected = new Set([traderId]);
      for (const trade of result.trades) { affected.add(trade.buyerId); affected.add(trade.sellerId); }
      for (const ws of this.listeners) {
        if (!affected.has(ws.traderId)) continue;
        try {
          const s = this.getStateForTrader(ws.traderId);
          ws.send(JSON.stringify({ type: 'state_update', myPositions: s.myPositions, myTrades: s.myTrades, activeOrders: s.activeOrders, totalPnl: s.totalPnl }));
        } catch (e) {}
      }
    }
    return result;
  }

  cancelOrder(traderId, orderId) {
    for (const book of this.books.values()) {
      const result = book.cancelOrder(orderId);
      if (result.found) {
        if (result.traderId !== traderId) return { error: 'Not your order' };
        this._broadcastBookUpdates();
        return { success: true };
      }
    }
    return { error: 'Order not found' };
  }

  _broadcastBookUpdates() {
    for (const [marketId, book] of this.books) {
      const snap = book.getSnapshot();
      this.broadcast({ type: 'book_update', productId: marketId, lastTradedPrice: this.lastTradedPrice.get(marketId) ?? null, ...snap });
    }
  }

  _positionPnl(pos, market) {
    // Realized PnL from closed round-trips
    let pnl = pos.realizedPnl || 0;
    // Unrealized PnL on open net position
    if (pos.net !== 0) {
      let mark;
      if (market?.revealed) {
        mark = market.settlementValue ?? 0;
      } else {
        // Use last traded price, fall back to mid, then initialMidPrice
        const ltp = this.lastTradedPrice.get(pos.productId);
        const book = this.books.get(pos.productId);
        const bid = book?.getBestBid(), ask = book?.getBestAsk();
        const mid = (bid != null && ask != null) ? (bid + ask) / 2 : null;
        mark = ltp ?? mid ?? (market?.initialMidPrice ?? 0);
      }
      const avgEntry = pos.net > 0 ? pos.avgBuy : pos.avgSell;
      pnl += pos.net * (mark - avgEntry);
    }
    return pnl;
  }

  _computePnl(traderId) {
    let total = 0;
    for (const [key, pos] of this.positions) {
      if (!key.startsWith(traderId + ':')) continue;
      const market = this.markets.get(pos.productId);
      total += this._positionPnl(pos, market);
    }
    return Math.round(total * 100) / 100;
  }

  getLeaderboard() {
    const traderIds = new Set();
    for (const ws of this.listeners) { if (ws.traderId) traderIds.add(ws.traderId); }
    for (const key of this.positions.keys()) traderIds.add(key.split(':')[0]);
    return Array.from(traderIds)
      .map(tid => ({ traderId: tid, displayName: this.traderNames.get(tid) || `Player-${tid.slice(-4)}`, pnl: this._computePnl(tid) }))
      .sort((a, b) => b.pnl - a.pnl);
  }

  _broadcastLeaderboard() {
    this.broadcast({ type: 'leaderboard', scores: this.getLeaderboard() });
  }

  getStateForTrader(traderId) {
    const markets = Array.from(this.markets.values()).map(m => ({
      id: m.id, name: m.name, type: m.type, description: m.description || '',
      refPrice: m.refPrice, revealed: m.revealed,
      strike: m.strike, lowerStrike: m.lowerStrike, upperStrike: m.upperStrike,
      underlyingId: m.underlyingId, leg1Id: m.leg1Id, leg2Id: m.leg2Id,
      unit: m.unit || '',
      trueValue: m.revealed ? m.trueValue : undefined,
      settlementValue: m.revealed ? m.settlementValue : undefined,
      initialMidPrice: m.initialMidPrice,
      tickSize: m.tickSize,
      lastTradedPrice: this.lastTradedPrice.get(m.id) ?? null,
    }));

    const books = {};
    for (const [id, book] of this.books) books[id] = book.getSnapshotForTrader(traderId);

    const myPositions = [];
    for (const [key, pos] of this.positions) {
      if (!key.startsWith(traderId + ':')) continue;
      const market = this.markets.get(pos.productId);
      const book = this.books.get(pos.productId);
      const bid = book?.getBestBid(), ask = book?.getBestAsk();
      myPositions.push({
        productId: pos.productId, productName: market?.name || pos.productId, productType: market?.type,
        net: pos.net, avgBuy: Math.round(pos.avgBuy * 100) / 100, avgSell: Math.round(pos.avgSell * 100) / 100,
        buyVolume: pos.buyVolume, sellVolume: pos.sellVolume,
        unrealizedPnl: Math.round(this._positionPnl(pos, market) * 100) / 100,
      });
    }

    const myTrades = [];
    for (const trade of this.recentTrades) {
      if (trade.buyerId === traderId || trade.sellerId === traderId) {
        myTrades.push({ ...trade, side: trade.buyerId === traderId ? 'BUY' : 'SELL', productName: this.markets.get(trade.productId)?.name || trade.productId });
        if (myTrades.length >= 50) break;
      }
    }

    const activeOrders = [];
    for (const [, book] of this.books) {
      for (const o of book.getActiveOrdersForTrader(traderId)) {
        activeOrders.push({ ...o, productName: this.markets.get(o.productId)?.name || o.productId, productType: this.markets.get(o.productId)?.type });
      }
    }

    return {
      roundName: this.roundName, roundActive: this.roundActive,
      positionLimit: this.positionLimit, tickSize: this.tickSize,
      markets, books, myPositions, myTrades, activeOrders,
      totalPnl: this._computePnl(traderId),
      recentTrades: this.recentTrades.slice(0, 100).map(t => ({ ...t, productName: this.markets.get(t.productId)?.name || t.productId })),
      news: this.newsItems,
    };
  }

  addNews(text) {
    const item = { text, timestamp: Date.now() };
    this.newsItems.unshift(item);
    if (this.newsItems.length > 50) this.newsItems.pop();
    this.broadcast({ type: 'news', item });
  }

  stop() {
    if (this.revealTimeout) { clearTimeout(this.revealTimeout); this.revealTimeout = null; }
    this.roundActive = false;
  }
}

module.exports = { Exchange };
