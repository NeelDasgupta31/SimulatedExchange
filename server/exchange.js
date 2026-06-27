const { OrderBook } = require('./matchingEngine');
const { settlementValue, derivativeInitialMid } = require('./mathUtils');

const COMBO_TYPES = new Set(['spread', 'diff', 'sum', 'max_of', 'min_of']);

class Exchange {
  constructor() {
    this.markets = new Map();
    this.books = new Map();
    this.positions = new Map(); // "traderId:productId" -> position
    this.traderNames = new Map(); // traderId -> displayName
    this.positionLimit = 10;
    this.recentTrades = [];
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

  // suite.markets is a flat array of market configs
  setupMarkets(suite, roundName, revealAfterSeconds) {
    this.markets.clear();
    this.books.clear();
    this.positions.clear();
    this.recentTrades = [];
    this.newsItems = [];
    this.roundName = roundName || 'ROUND';
    this.roundActive = true;

    const allConfigs = suite.markets || [];

    // First pass: collect true values of underlyings
    const trueValues = {};
    for (const cfg of allConfigs) {
      if (cfg.type === 'underlying') trueValues[cfg.id] = cfg.trueValue;
    }

    for (const cfg of allConfigs) {
      const market = { ...cfg };

      if (cfg.type === 'underlying') {
        market.settlementValue = market.trueValue;
        market.initialMidPrice = Math.round(market.trueValue * 10) / 10;
      } else if (COMBO_TYPES.has(cfg.type)) {
        market.settlementValue = settlementValue(cfg, trueValues);
        market.trueValue = market.settlementValue;
        market.initialMidPrice = Math.round(market.trueValue * 10) / 10;
      } else {
        // Option/derivative
        const ulTv = trueValues[cfg.underlyingId] ?? 0;
        market.trueValue = derivativeInitialMid(cfg, ulTv);
        market.settlementValue = settlementValue(cfg, trueValues);
        market.initialMidPrice = Math.max(0, Math.round(market.trueValue * 10) / 10);
      }

      market.revealed = false;
      this.markets.set(cfg.id, market);
      this.books.set(cfg.id, new OrderBook(cfg.id));
    }

    if (this.revealTimeout) clearTimeout(this.revealTimeout);
    if (revealAfterSeconds > 0) {
      this.revealTimeout = setTimeout(() => this.revealTrueValues(), revealAfterSeconds * 1000);
    }

    for (const ws of this.listeners) {
      try {
        ws.send(JSON.stringify({ type: 'init', traderId: ws.traderId, state: this.getStateForTrader(ws.traderId) }));
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
      });
    }
    return this.positions.get(key);
  }

  _applyTrades(trades) {
    for (const { productId, price, volume, buyerId, sellerId } of trades) {
      const buyPos = this._getOrCreatePosition(buyerId, productId);
      buyPos.totalBuyCost += price * volume;
      buyPos.buyVolume += volume;
      buyPos.avgBuy = buyPos.totalBuyCost / buyPos.buyVolume;
      buyPos.net += volume;

      const sellPos = this._getOrCreatePosition(sellerId, productId);
      sellPos.totalSellRevenue += price * volume;
      sellPos.sellVolume += volume;
      sellPos.avgSell = sellPos.totalSellRevenue / sellPos.sellVolume;
      sellPos.net -= volume;

      this.recentTrades.unshift({ productId, price, volume, buyerId, sellerId, timestamp: Date.now() });
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
    const safePrice = Math.max(0, Math.round(price * 10) / 10);
    const result = book.addOrder(traderId, side, safePrice, volume);
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
      const state = this.getStateForTrader(traderId);
      for (const ws of this.listeners) {
        if (ws.traderId === traderId) {
          try {
            ws.send(JSON.stringify({ type: 'state_update', myPositions: state.myPositions, myTrades: state.myTrades, activeOrders: state.activeOrders, totalPnl: state.totalPnl }));
          } catch (e) {}
        }
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
      this.broadcast({ type: 'book_update', productId: marketId, ...snap });
    }
  }

  _computePnl(traderId) {
    let total = 0;
    for (const [key, pos] of this.positions) {
      if (!key.startsWith(traderId + ':')) continue;
      const market = this.markets.get(pos.productId);
      if (!market) continue;
      if (market.revealed) {
        const settleVal = market.settlementValue ?? market.trueValue;
        const avgEntry = pos.net > 0 ? pos.avgBuy : pos.avgSell;
        total += pos.net * (settleVal - avgEntry);
      } else {
        const book = this.books.get(pos.productId);
        const bid = book?.getBestBid(), ask = book?.getBestAsk();
        const mid = (bid != null && ask != null) ? (bid + ask) / 2 : (market.initialMidPrice ?? market.trueValue);
        const avgEntry = pos.net > 0 ? pos.avgBuy : (pos.avgSell || mid);
        total += pos.net * (mid - avgEntry);
      }
    }
    return Math.round(total * 100) / 100;
  }

  getLeaderboard() {
    const traderIds = new Set();
    for (const ws of this.listeners) {
      if (ws.traderId) traderIds.add(ws.traderId);
    }
    for (const key of this.positions.keys()) {
      traderIds.add(key.split(':')[0]);
    }
    return Array.from(traderIds)
      .map(tid => ({
        traderId: tid,
        displayName: this.traderNames.get(tid) || `Player-${tid.slice(-4)}`,
        pnl: this._computePnl(tid),
      }))
      .sort((a, b) => b.pnl - a.pnl);
  }

  _broadcastLeaderboard() {
    this.broadcast({ type: 'leaderboard', scores: this.getLeaderboard() });
  }

  getStateForTrader(traderId) {
    const markets = Array.from(this.markets.values()).map(m => ({
      id: m.id, name: m.name, type: m.type, description: m.description || '',
      spread: m.spread, revealed: m.revealed,
      strike: m.strike, lowerStrike: m.lowerStrike, upperStrike: m.upperStrike,
      underlyingId: m.underlyingId, leg1Id: m.leg1Id, leg2Id: m.leg2Id,
      unit: m.unit || '',
      trueValue: m.revealed ? m.trueValue : undefined,
      settlementValue: m.revealed ? m.settlementValue : undefined,
      initialMidPrice: m.initialMidPrice,
    }));

    const books = {};
    for (const [id, book] of this.books) {
      books[id] = book.getSnapshotForTrader(traderId);
    }

    const myPositions = [];
    for (const [key, pos] of this.positions) {
      if (!key.startsWith(traderId + ':')) continue;
      const market = this.markets.get(pos.productId);
      const book = this.books.get(pos.productId);
      const bid = book?.getBestBid(), ask = book?.getBestAsk();
      const mid = (bid != null && ask != null) ? (bid + ask) / 2 : (market?.initialMidPrice ?? 0);
      const settleVal = market?.revealed ? (market.settlementValue ?? market.trueValue) : mid;
      const avgEntry = pos.net > 0 ? pos.avgBuy : (pos.avgSell || mid);
      myPositions.push({
        productId: pos.productId,
        productName: market?.name || pos.productId,
        productType: market?.type,
        net: pos.net,
        avgBuy: Math.round(pos.avgBuy * 100) / 100,
        avgSell: Math.round(pos.avgSell * 100) / 100,
        buyVolume: pos.buyVolume,
        sellVolume: pos.sellVolume,
        unrealizedPnl: Math.round(pos.net * (settleVal - avgEntry) * 100) / 100,
      });
    }

    const myTrades = [];
    for (const trade of this.recentTrades) {
      if (trade.buyerId === traderId || trade.sellerId === traderId) {
        myTrades.push({
          ...trade,
          side: trade.buyerId === traderId ? 'BUY' : 'SELL',
          productName: this.markets.get(trade.productId)?.name || trade.productId,
        });
        if (myTrades.length >= 50) break;
      }
    }

    const activeOrders = [];
    for (const [, book] of this.books) {
      for (const o of book.getActiveOrdersForTrader(traderId)) {
        activeOrders.push({
          ...o,
          productName: this.markets.get(o.productId)?.name || o.productId,
          productType: this.markets.get(o.productId)?.type,
        });
      }
    }

    return {
      roundName: this.roundName,
      roundActive: this.roundActive,
      positionLimit: this.positionLimit,
      markets, books, myPositions, myTrades, activeOrders,
      totalPnl: this._computePnl(traderId),
      recentTrades: this.recentTrades.slice(0, 100).map(t => ({
        ...t,
        productName: this.markets.get(t.productId)?.name || t.productId,
      })),
      news: this.newsItems,
    };
  }

  revealTrueValues() {
    if (this.revealTimeout) { clearTimeout(this.revealTimeout); this.revealTimeout = null; }
    for (const [, market] of this.markets) market.revealed = true;
    const revealed = Array.from(this.markets.values()).map(m => ({
      id: m.id, name: m.name, type: m.type,
      trueValue: m.trueValue, settlementValue: m.settlementValue,
    }));
    this.broadcast({ type: 'reveal', markets: revealed });
    const lines = revealed
      .filter(m => m.type === 'underlying')
      .map(m => `${m.name}: ${(m.settlementValue ?? m.trueValue)?.toFixed(1)}`);
    this.addNews('TRUE VALUES REVEALED — ' + lines.join(' | '));
    this._broadcastLeaderboard();
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
