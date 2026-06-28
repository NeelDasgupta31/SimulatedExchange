import React, { useState, useRef, useEffect, useCallback } from 'react';

const BG  = '#ffffff';
const BG2 = '#f5f7fa';
const BG3 = '#eef0f5';
const BORDER = '#dde1ea';
const DIM  = '#9099b0';
const TEXT = '#1a2035';

const TYPE_COLORS = {
  underlying: '#1a6ab5', call: '#0d7a3e', put: '#c0392b',
  straddle: '#c07800', strangle: '#b54a00',
  call_spread: '#4a7a1a', put_spread: '#7a1a9a',
  spread: '#6a1a9a', diff: '#6a1a9a',
  sum: '#0a7a8a', max_of: '#6a7a00', min_of: '#c07800',
};
const TYPE_LABELS = {
  underlying: 'UL', call: 'CALL', put: 'PUT', straddle: 'STRD',
  strangle: 'STNG', call_spread: 'C-SP', put_spread: 'P-SP',
  spread: 'DIFF', diff: 'DIFF', sum: 'SUM', max_of: 'MAX', min_of: 'MIN',
};

function marketSubtitle(m) {
  if (!m) return '';
  switch (m.type) {
    case 'call': return `K=${m.strike}  payoff max(0,X-${m.strike})`;
    case 'put':  return `K=${m.strike}  payoff max(0,${m.strike}-X)`;
    case 'straddle': return `K=${m.strike}  payoff |X-${m.strike}|`;
    case 'strangle': return `${m.lowerStrike}/${m.upperStrike}  OTM wings`;
    case 'call_spread': return `${m.lowerStrike}/${m.upperStrike}  max ${m.upperStrike-m.lowerStrike}`;
    case 'put_spread':  return `${m.lowerStrike}/${m.upperStrike}  max ${m.upperStrike-m.lowerStrike}`;
    case 'diff': case 'spread': return 'leg1 − leg2';
    case 'sum':    return 'leg1 + leg2';
    case 'max_of': return 'max(leg1, leg2)';
    case 'min_of': return 'min(leg1, leg2)';
    default: return m.description || '';
  }
}

const INIT_RANGE = 100;
const EXTEND = 80;
const ROW_H = 20; // taller rows = slower-feeling scroll

export function OrderBook({ market, book, position, onPlaceOrder, activeOrders = [], onCancel, positionLimit }) {
  const [volume, setVolume] = useState(1);
  const [tickBounds, setTickBounds] = useState(null);
  const midRowRef = useRef(null);
  const scrollRef = useRef(null);
  const prevMidRef = useRef(null); // stores last known midTick for "freeze" behaviour
  const hasScrolledRef = useRef(false); // tracks whether initial scroll happened
  const marketIdRef = useRef(null);

  if (!market) return null;

  const tickSize = market.tickSize ?? 0.1;

  const cancelSide = useCallback((side) => {
    for (const o of activeOrders) {
      if (o.side === side) onCancel(o.id);
    }
  }, [activeOrders, onCancel]);

  // Reset state when market changes — must happen before any calculations
  if (marketIdRef.current !== market.id) {
    marketIdRef.current = market.id;
    prevMidRef.current = null;
    hasScrolledRef.current = false;
  }

  const { bids = [], asks = [], lastTradedPrice = null } = book || {};
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  const INV = Math.round(1 / tickSize);

  // Black line priority: LTP > mid > bid+tick > ask-tick > freeze
  function calcLinePrice() {
    if (lastTradedPrice != null) return lastTradedPrice;
    if (bestBid != null && bestAsk != null) return (bestBid + bestAsk) / 2;
    if (bestBid != null) return bestBid + tickSize;
    if (bestAsk != null) return bestAsk - tickSize;
    return null;
  }

  const computedLine = calcLinePrice();
  if (computedLine != null) prevMidRef.current = Math.round(computedLine * INV);
  const midTick = prevMidRef.current ?? Math.round((market.initialMidPrice ?? 0) * INV);

  const bounds = tickBounds && marketIdRef.current === market.id
    ? tickBounds
    : { top: midTick + INIT_RANGE, bot: midTick - INIT_RANGE };

  const bidMap = {};
  for (const b of bids) {
    const t = Math.round(b.price * INV);
    if (!bidMap[t]) bidMap[t] = { volume: 0, ownVolume: 0 };
    bidMap[t].volume += b.volume;
    bidMap[t].ownVolume += b.ownVolume || 0;
  }
  const askMap = {};
  for (const a of asks) {
    const t = Math.round(a.price * INV);
    if (!askMap[t]) askMap[t] = { volume: 0, ownVolume: 0 };
    askMap[t].volume += a.volume;
    askMap[t].ownVolume += a.ownVolume || 0;
  }

  const ticks = [];
  for (let t = bounds.top; t >= Math.max(0, bounds.bot); t--) ticks.push(t);

  const maxVol = Math.max(
    ...Object.values(bidMap).map(b => b.volume),
    ...Object.values(askMap).map(a => a.volume),
    1
  );

  function handleScroll(e) {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    if (scrollTop < 300) {
      setTickBounds(b => b ? { top: b.top + EXTEND, bot: b.bot } : null);
    }
    if (scrollHeight - scrollTop - clientHeight < 300) {
      setTickBounds(b => b ? { top: b.top, bot: Math.max(0, b.bot - EXTEND) } : null);
    }
  }

  // Auto-scroll only on initial load for this market
  useEffect(() => {
    if (!hasScrolledRef.current && midTick != null) {
      hasScrolledRef.current = true;
      setTickBounds({ top: midTick + INIT_RANGE, bot: midTick - INIT_RANGE });
      requestAnimationFrame(() => {
        const el = midRowRef.current;
        const container = scrollRef.current;
        if (el && container) {
          container.scrollTop = el.offsetTop - container.clientHeight / 2 + ROW_H / 2;
        }
      });
    }
  }, [midTick]);

  const net = position?.net || 0;
  const pnl = position?.unrealizedPnl || 0;
  const color = TYPE_COLORS[market.type] || '#555';
  const GREEN = '#0d7a3e'; const RED = '#c0392b'; const BLUE = '#1a6ab5'; const GOLD = '#c07800';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, background: BG }}>

      {/* Header */}
      <div style={{ background: BG3, padding: '3px 5px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 1 }}>
          <span style={{ background: color+'18', border: `1px solid ${color}55`, color, fontSize: 7, fontWeight: 'bold', padding: '1px 3px', borderRadius: 2, flexShrink: 0 }}>
            {TYPE_LABELS[market.type] || market.type.toUpperCase()}
          </span>
          <span style={{ color: TEXT, fontWeight: 'bold', fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{market.name}</span>
        </div>
        <div style={{ color: DIM, fontSize: 7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{marketSubtitle(market)}</div>
      </div>

      {/* Pos / PnL row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 5px', background: BG2, borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
        <span style={{ fontSize: 8, color: DIM }}>
          Pos: <span style={{ color: net > 0 ? GREEN : net < 0 ? RED : DIM }}>{net}</span>
          <span style={{ marginLeft: 5, color: pnl >= 0 ? GREEN : RED }}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(1)}</span>
        </span>
        <span style={{ fontSize: 7, color: DIM }}>±{positionLimit}</span>
      </div>

      {/* Volume + clear buttons */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px', background: BG2, borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
        <button onClick={() => cancelSide('BUY')}
          style={{ background: '#e8f5ee', border: `1px solid ${GREEN}55`, color: GREEN, fontSize: 7, padding: '1px 5px', cursor: 'pointer' }}>✕B</button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <button onClick={() => setVolume(v => Math.max(1, v - 1))} style={{ background: BG3, border: `1px solid ${BORDER}`, color: DIM, width: 15, height: 15, cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: 0 }}>−</button>
          <span style={{ color: TEXT, fontSize: 9, minWidth: 18, textAlign: 'center', fontWeight: 'bold' }}>{volume}</span>
          <button onClick={() => setVolume(v => Math.min(10, v + 1))} style={{ background: BG3, border: `1px solid ${BORDER}`, color: DIM, width: 15, height: 15, cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: 0 }}>+</button>
        </div>

        <button onClick={() => cancelSide('SELL')}
          style={{ background: '#fdecea', border: `1px solid ${RED}55`, color: RED, fontSize: 7, padding: '1px 5px', cursor: 'pointer' }}>✕S</button>
      </div>

      {/* Column labels: Own | Bid Vol | Price | Ask Vol | Own */}
      <div style={{ display: 'grid', gridTemplateColumns: '26px 1fr 44px 1fr 26px', background: BG3, borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
        <span style={{ fontSize: 6, color: GOLD, textAlign: 'center', padding: '1px 0' }}>Own</span>
        <span style={{ fontSize: 7, color: GREEN, textAlign: 'right', padding: '1px 4px 1px 0' }}>Bid Vol</span>
        <span style={{ fontSize: 7, color: DIM, textAlign: 'center', padding: '1px 0' }}>Price</span>
        <span style={{ fontSize: 7, color: RED, textAlign: 'left', padding: '1px 0 1px 4px' }}>Ask Vol</span>
        <span style={{ fontSize: 6, color: GOLD, textAlign: 'center', padding: '1px 0' }}>Own</span>
      </div>

      {/* Settlement banner */}
      {market.revealed && (
        <div style={{ background: '#fffbe6', borderBottom: `1px solid #ffe066`, padding: '2px 5px', textAlign: 'center', fontSize: 8, flexShrink: 0 }}>
          <span style={{ color: GOLD, fontWeight: 'bold' }}>SETTLE {(market.settlementValue ?? market.trueValue)?.toFixed(1)}</span>
        </div>
      )}

      {/* Price ladder */}
      <div ref={scrollRef} onScroll={handleScroll} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', background: BG }}>
        {ticks.map(t => {
          const price = t / INV;
          const bid = bidMap[t];
          const ask = askMap[t];
          const isMid = t === midTick;
          const isBestBid = bestBid != null && Math.round(bestBid * INV) === t;
          const isBestAsk = bestAsk != null && Math.round(bestAsk * INV) === t;

          const bidAlpha = bid ? Math.min(0.55, 0.12 + 0.43 * bid.volume / maxVol) : 0;
          const askAlpha = ask ? Math.min(0.55, 0.12 + 0.43 * ask.volume / maxVol) : 0;
          const marketBidVol = bid ? bid.volume - (bid.ownVolume || 0) : 0;
          const marketAskVol = ask ? ask.volume - (ask.ownVolume || 0) : 0;

          return (
            <div
              key={t}
              ref={isMid ? midRowRef : null}
              style={{ display: 'grid', gridTemplateColumns: '26px 1fr 44px 1fr 26px', height: ROW_H, borderBottom: isMid ? `1px solid ${BORDER}` : 'none' }}
            >
              {/* Own buy volume */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: `1px solid ${BORDER}` }}>
                {bid?.ownVolume > 0 && <span style={{ color: GOLD, fontSize: 7, fontWeight: 'bold' }}>{bid.ownVolume}</span>}
              </div>

              {/* Bid volume (market depth) */}
              <div
                onClick={() => onPlaceOrder(market.id, 'BUY', price, volume)}
                style={{
                  background: marketBidVol > 0 ? `rgba(13,122,62,${bidAlpha})` : 'transparent',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                  paddingRight: 4,
                }}
              >
                {marketBidVol > 0 && <span style={{ color: GREEN, fontSize: 8 }}>{marketBidVol}</span>}
              </div>

              {/* Price */}
              <div style={{
                textAlign: 'center', fontSize: 8,
                color: isMid ? BLUE : isBestBid ? GREEN : isBestAsk ? RED : BORDER,
                fontWeight: isMid || isBestBid || isBestAsk ? 'bold' : 'normal',
                background: isMid ? BG3 : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {tickSize >= 1 ? price.toFixed(0) : tickSize >= 0.1 ? price.toFixed(1) : price.toFixed(2)}
              </div>

              {/* Ask volume (market depth) */}
              <div
                onClick={() => onPlaceOrder(market.id, 'SELL', price, volume)}
                style={{
                  background: marketAskVol > 0 ? `rgba(192,57,43,${askAlpha})` : 'transparent',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center',
                  paddingLeft: 4,
                }}
              >
                {marketAskVol > 0 && <span style={{ color: RED, fontSize: 8 }}>{marketAskVol}</span>}
              </div>

              {/* Own sell volume */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: `1px solid ${BORDER}` }}>
                {ask?.ownVolume > 0 && <span style={{ color: GOLD, fontSize: 7, fontWeight: 'bold' }}>{ask.ownVolume}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
