import React from 'react';

const BG = '#ffffff'; const BG2 = '#f0f2f5'; const BORDER = '#dde1ea';
const DIM = '#8892a4'; const GREEN = '#0d7a3e'; const RED = '#c0392b';
const BLUE = '#1a6ab5'; const TEXT = '#1a2035';

const S = {
  wrap: { height: '100%', display: 'flex', flexDirection: 'column', background: BG },
  header: { background: BG2, padding: '3px 8px', borderBottom: `1px solid ${BORDER}`, color: BLUE, fontWeight: 'bold', fontSize: 10 },
  cols: { display: 'grid', gridTemplateColumns: '1fr 50px 55px 40px 60px', padding: '2px 4px', background: BG2, color: DIM, fontSize: 9, borderBottom: `1px solid ${BORDER}` },
  body: { flex: 1, overflowY: 'auto' },
  row: { display: 'grid', gridTemplateColumns: '1fr 50px 55px 40px 60px', padding: '2px 4px', borderBottom: `1px solid ${BORDER}`, fontSize: 9, alignItems: 'center' },
  cancelBtn: { background: '#fff0f0', border: `1px solid ${RED}`, color: RED, padding: '1px 6px', cursor: 'pointer', fontSize: 9 },
  empty: { color: DIM, padding: '8px', textAlign: 'center', fontSize: 10 },
};

export function ActiveOrders({ orders, onCancel }) {
  return (
    <div style={S.wrap}>
      <div style={S.header}>Active Orders</div>
      <div style={S.cols}>
        <span>Product</span><span>Side</span><span>Price</span><span>Vol</span><span>Action</span>
      </div>
      <div style={S.body}>
        {orders.length === 0
          ? <div style={S.empty}>No active orders</div>
          : orders.map(o => (
            <div key={o.id} style={S.row}>
              <span style={{ color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.productName}</span>
              <span style={{ color: o.side === 'BUY' ? GREEN : RED, fontWeight: 'bold' }}>{o.side}</span>
              <span style={{ color: TEXT }}>{o.price}</span>
              <span style={{ color: DIM }}>{o.volume}</span>
              <button style={S.cancelBtn} onClick={() => onCancel(o.id)}>Cancel</button>
            </div>
          ))
        }
      </div>
    </div>
  );
}
