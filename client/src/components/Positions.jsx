import React from 'react';

const BG = '#ffffff'; const BG3 = '#f0f2f5'; const BORDER = '#dde1ea';
const DIM = '#8892a4'; const GREEN = '#0d7a3e'; const RED = '#c0392b';
const BLUE = '#1a6ab5'; const TEXT = '#1a2035';

const S = {
  wrap: { height: '100%', overflow: 'auto', background: BG },
  header: { background: BG3, padding: '3px 8px', borderBottom: `1px solid ${BORDER}`, color: BLUE, fontWeight: 'bold', fontSize: 10 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 9 },
  th: { padding: '2px 4px', color: DIM, textAlign: 'left', borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap' },
  td: { padding: '2px 4px', borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap', color: TEXT },
  empty: { color: DIM, padding: '8px', textAlign: 'center', fontSize: 10 },
};

export function Positions({ positions, totalPnl }) {
  return (
    <div style={S.wrap}>
      <div style={S.header}>
        Positions &nbsp; <span style={{ color: totalPnl >= 0 ? GREEN : RED }}>Total PnL: {totalPnl?.toFixed(2)}</span>
      </div>
      {positions.length === 0 ? (
        <div style={S.empty}>No positions</div>
      ) : (
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Product</th>
              <th style={S.th}>Net</th>
              <th style={S.th}>Avg Buy</th>
              <th style={S.th}>Avg Sell</th>
              <th style={S.th}>BuyVol</th>
              <th style={S.th}>SellVol</th>
              <th style={S.th}>P&L</th>
            </tr>
          </thead>
          <tbody>
            {positions.map(p => (
              <tr key={p.productId}>
                <td style={{ ...S.td, color: BLUE, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.productName}</td>
                <td style={{ ...S.td, color: p.net > 0 ? GREEN : p.net < 0 ? RED : DIM }}>{p.net}</td>
                <td style={{ ...S.td, color: GREEN }}>{p.avgBuy > 0 ? p.avgBuy.toFixed(2) : '-'}</td>
                <td style={{ ...S.td, color: RED }}>{p.avgSell > 0 ? p.avgSell.toFixed(2) : '-'}</td>
                <td style={S.td}>{p.buyVolume}</td>
                <td style={S.td}>{p.sellVolume}</td>
                <td style={{ ...S.td, color: p.unrealizedPnl >= 0 ? GREEN : RED }}>{p.unrealizedPnl?.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
