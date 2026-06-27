const { v4: uuidv4 } = require('uuid');

class OrderBook {
  constructor(productId) {
    this.productId = productId;
    this.bids = []; // [{price, orders: [{id, traderId, volume, timestamp}]}]
    this.asks = [];
    this.trades = [];
  }

  _getBidLevel(price) { return this.bids.find(l => l.price === price); }
  _getAskLevel(price) { return this.asks.find(l => l.price === price); }

  addOrder(traderId, side, price, volume) {
    const orderId = uuidv4();
    const order = { id: orderId, traderId, volume, timestamp: Date.now() };
    const newTrades = [];

    if (side === 'BUY') {
      while (volume > 0 && this.asks.length > 0 && this.asks[0].price <= price) {
        const askLevel = this.asks[0];
        // remove own orders from consideration (no self-trade), iterate safely
        let matched = false;
        for (let i = 0; i < askLevel.orders.length && volume > 0; ) {
          const askOrder = askLevel.orders[i];
          if (askOrder.traderId === traderId) { i++; continue; }
          matched = true;
          const fillVol = Math.min(volume, askOrder.volume);
          newTrades.push({ id: uuidv4(), productId: this.productId, price: askLevel.price, volume: fillVol, buyerId: traderId, sellerId: askOrder.traderId, timestamp: Date.now() });
          this.trades.unshift(newTrades[newTrades.length - 1]);
          if (this.trades.length > 200) this.trades.pop();
          volume -= fillVol;
          askOrder.volume -= fillVol;
          if (askOrder.volume === 0) askLevel.orders.splice(i, 1);
          else i++;
        }
        // Remove level if empty; if only own orders remain, stop matching this level
        const nonOwn = askLevel.orders.filter(o => o.traderId !== traderId);
        if (nonOwn.length === 0 && askLevel.orders.length === 0) this.asks.shift();
        if (!matched) break; // only own orders at this and better prices
      }
      if (volume > 0) {
        let level = this._getBidLevel(price);
        if (!level) { level = { price, orders: [] }; this.bids.push(level); this.bids.sort((a, b) => b.price - a.price); }
        order.volume = volume;
        level.orders.push(order);
      } else {
        return { orderId, trades: newTrades, resting: false };
      }
    } else {
      while (volume > 0 && this.bids.length > 0 && this.bids[0].price >= price) {
        const bidLevel = this.bids[0];
        let matched = false;
        for (let i = 0; i < bidLevel.orders.length && volume > 0; ) {
          const bidOrder = bidLevel.orders[i];
          if (bidOrder.traderId === traderId) { i++; continue; }
          matched = true;
          const fillVol = Math.min(volume, bidOrder.volume);
          newTrades.push({ id: uuidv4(), productId: this.productId, price: bidLevel.price, volume: fillVol, buyerId: bidOrder.traderId, sellerId: traderId, timestamp: Date.now() });
          this.trades.unshift(newTrades[newTrades.length - 1]);
          if (this.trades.length > 200) this.trades.pop();
          volume -= fillVol;
          bidOrder.volume -= fillVol;
          if (bidOrder.volume === 0) bidLevel.orders.splice(i, 1);
          else i++;
        }
        const nonOwn = bidLevel.orders.filter(o => o.traderId !== traderId);
        if (nonOwn.length === 0 && bidLevel.orders.length === 0) this.bids.shift();
        if (!matched) break;
      }
      if (volume > 0) {
        let level = this._getAskLevel(price);
        if (!level) { level = { price, orders: [] }; this.asks.push(level); this.asks.sort((a, b) => a.price - b.price); }
        order.volume = volume;
        level.orders.push(order);
      } else {
        return { orderId, trades: newTrades, resting: false };
      }
    }

    return { orderId, trades: newTrades, resting: true };
  }

  cancelOrder(orderId) {
    for (const level of this.bids) {
      const idx = level.orders.findIndex(o => o.id === orderId);
      if (idx !== -1) {
        const [order] = level.orders.splice(idx, 1);
        if (level.orders.length === 0) this.bids.splice(this.bids.indexOf(level), 1);
        return { found: true, traderId: order.traderId };
      }
    }
    for (const level of this.asks) {
      const idx = level.orders.findIndex(o => o.id === orderId);
      if (idx !== -1) {
        const [order] = level.orders.splice(idx, 1);
        if (level.orders.length === 0) this.asks.splice(this.asks.indexOf(level), 1);
        return { found: true, traderId: order.traderId };
      }
    }
    return { found: false };
  }

  getSnapshot(depth = 20) {
    const bids = this.bids.slice(0, depth).map(l => ({ price: l.price, volume: l.orders.reduce((s, o) => s + o.volume, 0), ownVolume: 0 }));
    const asks = this.asks.slice(0, depth).map(l => ({ price: l.price, volume: l.orders.reduce((s, o) => s + o.volume, 0), ownVolume: 0 }));
    return { bids, asks };
  }

  getSnapshotForTrader(traderId, depth = 20) {
    return {
      bids: this.bids.slice(0, depth).map(l => ({
        price: l.price,
        volume: l.orders.reduce((s, o) => s + o.volume, 0),
        ownVolume: l.orders.filter(o => o.traderId === traderId).reduce((s, o) => s + o.volume, 0),
      })),
      asks: this.asks.slice(0, depth).map(l => ({
        price: l.price,
        volume: l.orders.reduce((s, o) => s + o.volume, 0),
        ownVolume: l.orders.filter(o => o.traderId === traderId).reduce((s, o) => s + o.volume, 0),
      })),
    };
  }

  getBestBid() { return this.bids.length > 0 ? this.bids[0].price : null; }
  getBestAsk() { return this.asks.length > 0 ? this.asks[0].price : null; }

  getActiveOrdersForTrader(traderId) {
    const orders = [];
    for (const level of this.bids)
      for (const o of level.orders)
        if (o.traderId === traderId) orders.push({ id: o.id, side: 'BUY', price: level.price, volume: o.volume, productId: this.productId });
    for (const level of this.asks)
      for (const o of level.orders)
        if (o.traderId === traderId) orders.push({ id: o.id, side: 'SELL', price: level.price, volume: o.volume, productId: this.productId });
    return orders;
  }
}

module.exports = { OrderBook };
