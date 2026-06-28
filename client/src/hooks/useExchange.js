import { useState, useEffect, useRef, useCallback } from 'react';

export function useExchange() {
  const [state, setState] = useState({
    traderId: null,
    roundName: '',
    roundActive: false,
    positionLimit: 10,
    tickSize: 0.1,
    markets: [],
    books: {},
    myPositions: [],
    myTrades: [],
    activeOrders: [],
    totalPnl: 0,
    recentTrades: [],
    news: [],
    leaderboard: [],
    connected: false,
  });
  const ws = useRef(null);
  const reconnectTimer = useRef(null);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}`);
    ws.current = socket;

    socket.onopen = () => setState(s => ({ ...s, connected: true }));
    socket.onclose = () => {
      setState(s => ({ ...s, connected: false }));
      reconnectTimer.current = setTimeout(connect, 2000);
    };
    socket.onmessage = (evt) => handleMessage(JSON.parse(evt.data));
  }, []);

  function handleMessage(msg) {
    switch (msg.type) {
      case 'init':
        setState(s => ({ ...s, traderId: msg.traderId, ...msg.state }));
        break;
      case 'book_update':
        setState(s => ({
          ...s,
          books: { ...s.books, [msg.productId]: { bids: msg.bids, asks: msg.asks, lastTradedPrice: msg.lastTradedPrice ?? s.books[msg.productId]?.lastTradedPrice ?? null } },
        }));
        break;
      case 'trade':
        setState(s => ({
          ...s,
          recentTrades: [{ ...msg.trade, productName: msg.trade.productName || s.markets.find(m => m.id === msg.trade.productId)?.name }, ...s.recentTrades].slice(0, 100),
        }));
        break;
      case 'state_update':
        setState(s => ({ ...s, ...msg }));
        break;
      case 'leaderboard':
        setState(s => ({ ...s, leaderboard: msg.scores }));
        break;
      case 'news':
        setState(s => ({ ...s, news: [msg.item, ...s.news].slice(0, 30) }));
        break;
      case 'reveal':
        setState(s => ({
          ...s,
          markets: s.markets.map(m => {
            const rev = msg.markets.find(r => r.id === m.id);
            return rev ? { ...m, revealed: true, trueValue: rev.trueValue, settlementValue: rev.settlementValue } : m;
          }),
        }));
        break;
    }
  }

  useEffect(() => {
    connect();
    return () => { clearTimeout(reconnectTimer.current); ws.current?.close(); };
  }, [connect]);

  const placeOrder = useCallback((productId, side, price, volume) => {
    ws.current?.send(JSON.stringify({ type: 'place_order', productId, side, price, volume }));
  }, []);

  const cancelOrder = useCallback((orderId) => {
    ws.current?.send(JSON.stringify({ type: 'cancel_order', orderId }));
  }, []);

  const setName = useCallback((name) => {
    ws.current?.send(JSON.stringify({ type: 'set_name', name }));
  }, []);

  return { state, placeOrder, cancelOrder, setName };
}
