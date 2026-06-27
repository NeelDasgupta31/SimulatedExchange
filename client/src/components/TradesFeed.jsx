import React, { useState } from 'react';

const BG = '#ffffff'; const BG2 = '#f0f2f5'; const BORDER = '#dde1ea';
const DIM = '#8892a4'; const GREEN = '#0d7a3e'; const RED = '#c0392b';
const BLUE = '#1a6ab5'; const TEXT = '#1a2035';

const S = {
  wrap: { height: '100%', display: 'flex', flexDirection: 'column', background: BG },
  header: { background: BG2, padding: '3px 8px', borderBottom: `1px solid ${BORDER}`, color: BLUE, fontWeight: 'bold', fontSize: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  filter: { background: BG, border: `1px solid ${BORDER}`, color: TEXT, fontSize: 10, padding: '1px 4px' },
  cols: { display: 'grid', gridTemplateColumns: '55px 1fr 55px 40px', padding: '2px 4px', background: BG2, color: DIM, fontSize: 9, borderBottom: `1px solid ${BORDER}` },
  body: { flex: 1, overflowY: 'auto' },
  row: { display: 'grid', gridTemplateColumns: '55px 1fr 55px 40px', padding: '2px 4px', borderBottom: `1px solid ${BORDER}`, fontSize: 9 },
};

function fmt(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

export function TradesFeed({ trades, markets, title = 'Trades Feed', showSide = false }) {
  const [filter, setFilter] = useState('');

  const filtered = filter
    ? trades.filter(t => t.productName?.toLowerCase().includes(filter.toLowerCase()))
    : trades;

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <span>{title}</span>
        <select style={S.filter} value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="">All Products</option>
          {markets.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
        </select>
      </div>
      <div style={S.cols}>
        <span>Time</span><span>Product</span><span>Price</span><span>{showSide ? 'Side' : 'Vol'}</span>
      </div>
      <div style={S.body}>
        {filtered.slice(0, 80).map((t, i) => (
          <div key={t.id || i} style={S.row}>
            <span style={{ color: DIM }}>{fmt(t.timestamp)}</span>
            <span style={{ color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.productName}</span>
            <span style={{ color: TEXT, fontWeight: 500 }}>{t.price}</span>
            {showSide
              ? <span style={{ color: t.side === 'BUY' ? GREEN : RED, fontWeight: 'bold' }}>{t.side === 'BUY' ? 'BUY' : 'SELL'}</span>
              : <span style={{ color: DIM }}>{t.volume}</span>
            }
          </div>
        ))}
      </div>
    </div>
  );
}
