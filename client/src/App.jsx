import React, { useState } from 'react';
import { useExchange } from './hooks/useExchange';
import { OrderBook } from './components/OrderBook';
import { Positions } from './components/Positions';
import { TradesFeed } from './components/TradesFeed';
import { ActiveOrders } from './components/ActiveOrders';

const BG = '#f5f7fa'; const BG2 = '#ffffff'; const BG3 = '#eef0f5';
const BORDER = '#dde1ea'; const TEXT = '#1a2035'; const DIM = '#8892a4';
const GREEN = '#0d7a3e'; const RED = '#c0392b'; const BLUE = '#1a6ab5';
const GOLD = '#c07800';

function fmt(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

const COMBO = new Set(['spread','diff','sum','max_of','min_of']);
function groupMarkets(markets) {
  const underlyings = markets.filter(m => m.type === 'underlying');
  const combos = markets.filter(m => COMBO.has(m.type));
  const derivs = markets.filter(m => !COMBO.has(m.type) && m.type !== 'underlying');
  const groups = [];
  for (const ul of underlyings) {
    groups.push(ul);
    groups.push(...derivs.filter(d => d.underlyingId === ul.id));
  }
  groups.push(...combos);
  return groups;
}

function NameModal({ onConfirm }) {
  const [name, setName] = useState('');
  const submit = () => onConfirm(name.trim() || 'Anonymous');
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }}>
      <div style={{ background: BG2, border: `1px solid ${BORDER}`, borderRadius: 4, padding: 32, width: 320, textAlign: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.15)' }}>
        <div style={{ color: BLUE, fontSize: 18, fontWeight: 'bold', marginBottom: 6 }}>SimExchange-v4</div>
        <div style={{ color: DIM, fontSize: 11, marginBottom: 20 }}>Enter your name to join</div>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="Your name"
          maxLength={20}
          style={{ width: '100%', background: BG3, border: `1px solid ${BORDER}`, color: TEXT, padding: '8px 10px', fontSize: 13, boxSizing: 'border-box', marginBottom: 12, textAlign: 'center', borderRadius: 2 }}
        />
        <button onClick={submit}
          style={{ width: '100%', background: BLUE, border: 'none', color: '#fff', padding: '8px', cursor: 'pointer', fontSize: 12, borderRadius: 2 }}>
          Join Game
        </button>
      </div>
    </div>
  );
}

function ResultsModal({ markets, leaderboard, myPositions, traderId, totalPnl, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
      <div style={{ background: BG2, border: `1px solid ${BORDER}`, borderRadius: 4, padding: 28, width: 480, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.15)' }}>
        <div style={{ color: GOLD, fontSize: 18, fontWeight: 'bold', marginBottom: 4, textAlign: 'center' }}>ROUND COMPLETE</div>
        <div style={{ color: DIM, fontSize: 11, textAlign: 'center', marginBottom: 18 }}>True values revealed — final settlement</div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ color: DIM, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, borderBottom: `1px solid ${BORDER}`, paddingBottom: 4, marginBottom: 6 }}>Settlement Values</div>
          {markets.filter(m => m.type === 'underlying').map(m => (
            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '2px 0', color: TEXT }}>
              <span>{m.name}</span>
              <span style={{ color: GOLD, fontWeight: 'bold' }}>{(m.settlementValue ?? m.trueValue)?.toFixed(1)}</span>
            </div>
          ))}
        </div>

        <div style={{ marginBottom: 16, background: BG3, border: `1px solid ${BORDER}`, borderRadius: 2, padding: 12 }}>
          <div style={{ color: DIM, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Your Final P&L</div>
          <div style={{ fontSize: 32, fontWeight: 'bold', color: totalPnl >= 0 ? GREEN : RED, textAlign: 'center' }}>
            {totalPnl >= 0 ? '+' : ''}{totalPnl?.toFixed(2)}
          </div>
          {myPositions.filter(p => p.net !== 0).map(p => (
            <div key={p.productId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, padding: '2px 0', color: DIM }}>
              <span style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.productName}</span>
              <span style={{ color: p.unrealizedPnl >= 0 ? GREEN : RED }}>{p.unrealizedPnl >= 0 ? '+' : ''}{p.unrealizedPnl?.toFixed(2)}</span>
            </div>
          ))}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ color: DIM, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, borderBottom: `1px solid ${BORDER}`, paddingBottom: 4, marginBottom: 6 }}>Final Leaderboard</div>
          {leaderboard.slice(0, 10).map((e, i) => (
            <div key={e.traderId} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 6px', fontSize: 11, background: e.traderId === traderId ? '#e8f5ee' : 'transparent', borderBottom: `1px solid ${BORDER}` }}>
              <span style={{ color: i === 0 ? GOLD : i === 1 ? '#888' : i === 2 ? '#a0622a' : DIM }}>
                #{i+1} {e.traderId === traderId ? `${e.displayName} (you)` : e.displayName}
              </span>
              <span style={{ color: e.pnl >= 0 ? GREEN : RED, fontWeight: 'bold' }}>{e.pnl >= 0 ? '+' : ''}{(e.pnl||0).toFixed(2)}</span>
            </div>
          ))}
        </div>

        <button onClick={onClose} style={{ width: '100%', background: BG3, border: `1px solid ${BORDER}`, color: BLUE, padding: '8px', cursor: 'pointer', fontSize: 12, borderRadius: 2 }}>
          Close
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const { state, placeOrder, cancelOrder, setName } = useExchange();
  const [playerName, setPlayerName] = useState(null);
  const [showResults, setShowResults] = useState(false);
  const [resultsShown, setResultsShown] = useState(false);

  const { traderId, markets, books, myPositions, myTrades, activeOrders, totalPnl, recentTrades, news, leaderboard, connected, roundName, positionLimit, tickSize } = state;

  const allRevealed = markets.length > 0 && markets.every(m => m.revealed);
  if (allRevealed && !resultsShown) { setShowResults(true); setResultsShown(true); }
  if (!allRevealed && resultsShown) { setResultsShown(false); }

  const myRankEntry = leaderboard.findIndex(e => e.traderId === traderId);
  const myRank = myRankEntry >= 0 ? myRankEntry + 1 : '—';
  const orderedMarkets = groupMarkets(markets);

  function handleNameConfirm(name) {
    setPlayerName(name);
    setName(name);
  }

  if (playerName === null) {
    return <NameModal onConfirm={handleNameConfirm} />;
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: BG, color: TEXT, overflow: 'hidden', fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: 11 }}>

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 14px', background: BG2, borderBottom: `1px solid ${BORDER}`, minHeight: 36, flexShrink: 0, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: BLUE, fontWeight: 'bold', fontSize: 14, letterSpacing: 1 }}>SimExchange-v4</span>
          <span style={{ color: DIM, fontSize: 9 }}>{playerName}</span>
        </div>

        <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: DIM, fontSize: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Total PnL</div>
            <div style={{ fontSize: 16, fontWeight: 'bold', color: totalPnl >= 0 ? GREEN : RED }}>{(totalPnl || 0).toFixed(2)}</div>
          </div>
          <div style={{ background: BG3, border: `1px solid ${BORDER}`, padding: '2px 12px', textAlign: 'center', borderRadius: 2 }}>
            <div style={{ color: DIM, fontSize: 8, textTransform: 'uppercase' }}>Rank</div>
            <div style={{ color: TEXT, fontSize: 10 }}>#{myRank} / {leaderboard.length}</div>
          </div>
          <div style={{ background: BG3, border: `1px solid ${BORDER}`, padding: '2px 12px', textAlign: 'center', borderRadius: 2 }}>
            <div style={{ color: DIM, fontSize: 8, textTransform: 'uppercase' }}>Round</div>
            <div style={{ color: TEXT, fontSize: 10, fontWeight: 'bold' }}>{roundName || '—'}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: connected ? GREEN : RED, display: 'inline-block' }} />
          {allRevealed && (
            <button onClick={() => setShowResults(true)} style={{ background: '#fffbe6', border: `1px solid ${GOLD}`, color: GOLD, padding: '2px 10px', cursor: 'pointer', fontSize: 10, borderRadius: 2 }}>Results</button>
          )}
        </div>
      </div>

      {/* Main body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Order books */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {markets.length === 0 ? (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: DIM, fontSize: 13, flexDirection: 'column', gap: 8 }}>
              <div>Waiting for the host to start a round...</div>
              <div style={{ fontSize: 10, color: DIM }}>Connected as <span style={{ color: BLUE }}>{playerName}</span></div>
            </div>
          ) : (
            <div style={{ height: '100%', display: 'flex', overflowX: 'auto', overflowY: 'hidden' }}>
              {orderedMarkets.map(market => (
                <div key={market.id} style={{ width: 182, minWidth: 182, flexShrink: 0, borderRight: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column', background: '#fff' }}>
                  <OrderBook
                    market={market}
                    book={books[market.id]}
                    position={myPositions.find(p => p.productId === market.id)}
                    onPlaceOrder={placeOrder}
                    activeOrders={activeOrders.filter(o => o.productId === market.id)}
                    onCancel={cancelOrder}
                    positionLimit={positionLimit}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right panel */}
        <div style={{ width: 375, display: 'flex', flexDirection: 'column', borderLeft: `1px solid ${BORDER}`, overflow: 'hidden', flexShrink: 0 }}>
          <div style={{ flex: '0 0 155px', borderBottom: `1px solid ${BORDER}`, overflow: 'hidden' }}>
            <Positions positions={myPositions} totalPnl={totalPnl} />
          </div>
          <div style={{ flex: '0 0 180px', borderBottom: `1px solid ${BORDER}`, overflow: 'hidden' }}>
            <TradesFeed trades={myTrades} markets={markets} title="Own Trades" showSide />
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <TradesFeed trades={recentTrades} markets={markets} title="Trades Feed" />
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div style={{ display: 'flex', borderTop: `1px solid ${BORDER}`, flexShrink: 0, height: 155, overflow: 'hidden' }}>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <ActiveOrders orders={activeOrders} onCancel={cancelOrder} />
        </div>

        {/* News */}
        <div style={{ flex: 1.2, overflow: 'hidden', borderLeft: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column', background: BG2 }}>
          <div style={{ background: BG3, padding: '3px 8px', borderBottom: `1px solid ${BORDER}`, color: BLUE, fontWeight: 'bold', fontSize: 10 }}>News</div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '3px 6px' }}>
            {news.length === 0 && <div style={{ color: DIM, fontSize: 10, padding: 4 }}>No news yet</div>}
            {news.map((n, i) => (
              <div key={i} style={{ fontSize: 9, padding: '2px 0', borderBottom: `1px solid ${BG3}`, color: i === 0 ? TEXT : DIM }}>
                <span style={{ color: DIM }}>{fmt(n.timestamp)} </span>{n.text}
              </div>
            ))}
          </div>
        </div>

        {/* Leaderboard */}
        <div style={{ width: 160, display: 'flex', flexDirection: 'column', borderLeft: `1px solid ${BORDER}`, overflow: 'hidden', background: BG2 }}>
          <div style={{ background: BG3, padding: '3px 8px', borderBottom: `1px solid ${BORDER}`, color: BLUE, fontWeight: 'bold', fontSize: 10 }}>Leaderboard</div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {leaderboard.map((e, i) => (
              <div key={e.traderId} style={{ padding: '3px 8px', fontSize: 9, borderBottom: `1px solid ${BORDER}`, background: e.traderId === traderId ? '#e8f5ee' : 'transparent', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: i === 0 ? GOLD : i === 1 ? '#888' : i === 2 ? '#a0622a' : DIM, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 95 }}>
                  #{i+1} {e.traderId === traderId ? `${e.displayName} ★` : e.displayName}
                </span>
                <span style={{ color: e.pnl >= 0 ? GREEN : RED, fontWeight: 500 }}>{(e.pnl||0).toFixed(1)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showResults && (
        <ResultsModal
          markets={markets}
          leaderboard={leaderboard}
          myPositions={myPositions}
          traderId={traderId}
          totalPnl={totalPnl}
          onClose={() => setShowResults(false)}
        />
      )}
    </div>
  );
}
