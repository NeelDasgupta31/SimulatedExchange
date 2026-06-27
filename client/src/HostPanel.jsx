import React, { useState, useEffect } from 'react';

const BG = '#f5f7fa'; const BG2 = '#ffffff'; const BG3 = '#eef0f5';
const BORDER = '#dde1ea'; const TEXT = '#1a2035'; const DIM = '#8892a4';
const GREEN = '#0d7a3e'; const RED = '#c0392b'; const BLUE = '#1a6ab5';
const GOLD = '#c07800';

const HOST_KEY = new URLSearchParams(window.location.search).get('key') || '';

const inp = {
  display: 'block', width: '100%', background: BG3, border: `1px solid ${BORDER}`,
  color: TEXT, padding: '4px 8px', fontSize: 11, boxSizing: 'border-box', marginBottom: 6, borderRadius: 2,
};
const btn = (color = BLUE) => ({
  background: color === BLUE ? BLUE : 'transparent', border: `1px solid ${color}`, color: color === BLUE ? '#fff' : color,
  padding: '5px 14px', cursor: 'pointer', fontSize: 11, borderRadius: 2,
});
const label = { display: 'block', color: DIM, fontSize: 9, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 1 };
const section = { background: BG2, border: `1px solid ${BORDER}`, padding: 16, marginBottom: 16 };

const OPTION_TYPES = new Set(['call', 'put', 'straddle', 'strangle', 'call_spread', 'put_spread']);
const COMBO_TYPES = new Set(['diff', 'sum', 'max_of', 'min_of']);

const DEFAULT_FORM = { type: 'underlying', name: '', refPrice: '', unit: '', underlyingId: '', strike: '', lowerStrike: '', upperStrike: '', leg1Id: '', leg2Id: '' };

function Row({ children, gap = 8, style = {} }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(${React.Children.count(children)}, 1fr)`, gap, ...style }}>{children}</div>;
}
function Field({ label: lbl, children }) {
  return <div><span style={label}>{lbl}</span>{children}</div>;
}

export function HostPanel() {
  const [markets, setMarkets] = useState([]);
  const [roundName, setRoundName] = useState('');
  const [tickSize, setTickSize] = useState('0.1');
  const [form, setForm] = useState(DEFAULT_FORM);
  const [phase, setPhase] = useState('setup'); // setup | active | settling | settled
  const [leaderboard, setLeaderboard] = useState([]);
  const [activeMarkets, setActiveMarkets] = useState([]);
  const [newsText, setNewsText] = useState('');
  const [settleValues, setSettleValues] = useState({}); // { [id]: string }
  const [msg, setMsg] = useState({ text: '', ok: true });

  const say = (text, ok = true) => setMsg({ text, ok });

  // Poll status when active
  useEffect(() => {
    if (phase === 'setup') return;
    const id = setInterval(async () => {
      try {
        const r = await fetch(`/api/host/status?key=${HOST_KEY}`);
        const d = await r.json();
        if (d.leaderboard) setLeaderboard(d.leaderboard);
        if (d.markets) setActiveMarkets(d.markets);
        if (d.markets?.every(m => m.revealed) && phase === 'settling') setPhase('settled');
      } catch {}
    }, 2000);
    return () => clearInterval(id);
  }, [phase]);

  function setF(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function addMarket() {
    const f = { ...form };
    if (!f.name.trim()) { say('Enter a name', false); return; }
    if (OPTION_TYPES.has(f.type) && !f.underlyingId) { say('Select an underlying', false); return; }
    if (COMBO_TYPES.has(f.type) && (!f.leg1Id || !f.leg2Id)) { say('Select both legs', false); return; }

    const m = { ...f, id: `m${Date.now()}` };
    if (m.refPrice) m.refPrice = parseFloat(m.refPrice);
    if (m.strike) m.strike = parseFloat(m.strike);
    if (m.lowerStrike) m.lowerStrike = parseFloat(m.lowerStrike);
    if (m.upperStrike) m.upperStrike = parseFloat(m.upperStrike);
    // remove unused fields
    delete m.trueValue; delete m.spread;

    setMarkets(prev => [...prev, m]);
    setForm({ ...DEFAULT_FORM, type: f.type, underlyingId: f.underlyingId, leg1Id: f.leg1Id, leg2Id: f.leg2Id });
    say('');
  }

  async function startRound() {
    if (!markets.length) { say('Add at least one market', false); return; }
    const ts = parseFloat(tickSize) || 0.1;
    say('Starting...');
    try {
      const r = await fetch(`/api/host/round/start?key=${HOST_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markets, roundName: roundName || 'ROUND-1', tickSize: ts }),
      });
      const d = await r.json();
      if (d.error) { say(d.error, false); return; }
      say('Round started! You can trade alongside your players.', true);
      setPhase('active');
    } catch (e) { say(e.message, false); }
  }

  async function sendNews() {
    if (!newsText.trim()) return;
    await fetch(`/api/host/news?key=${HOST_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: newsText }),
    });
    setNewsText('');
    say('News published');
  }

  async function settle() {
    // Validate all underlyings have a value
    const underlyings = activeMarkets.filter(m => m.type === 'underlying');
    const trueValues = {};
    for (const u of underlyings) {
      const v = parseFloat(settleValues[u.id]);
      if (isNaN(v)) { say(`Enter true value for ${u.name}`, false); return; }
      trueValues[u.id] = v;
    }
    say('Settling...');
    try {
      const r = await fetch(`/api/host/settle?key=${HOST_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trueValues }),
      });
      const d = await r.json();
      if (d.error) { say(d.error, false); return; }
      say('Settled! Results revealed to all players.', true);
      setPhase('settled');
    } catch (e) { say(e.message, false); }
  }

  function newRound() {
    setMarkets([]);
    setRoundName('');
    setTickSize('0.1');
    setPhase('setup');
    setLeaderboard([]);
    setActiveMarkets([]);
    setSettleValues({});
    say('');
  }

  const underlyings = markets.filter(m => m.type === 'underlying');
  const needsUnderlying = OPTION_TYPES.has(form.type);
  const needsLegs = COMBO_TYPES.has(form.type);
  const needsStrike = ['call', 'put', 'straddle'].includes(form.type);
  const needsBounds = ['strangle', 'call_spread', 'put_spread'].includes(form.type);

  return (
    <div style={{ minHeight: '100vh', background: BG, color: TEXT, fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: 12 }}>
      <div style={{ background: BG3, borderBottom: `1px solid ${BORDER}`, padding: '10px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: BLUE, fontWeight: 'bold', fontSize: 16 }}>SimExchange — Host Panel</span>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          {phase !== 'setup' && (
            <a href="/" target="_blank" rel="noreferrer" style={{ color: BLUE, fontSize: 10, textDecoration: 'none' }}>
              Open Trading View ↗
            </a>
          )}
          <span style={{ color: DIM, fontSize: 10 }}>key: {HOST_KEY || '(none)'}</span>
        </div>
      </div>

      <div style={{ maxWidth: 980, margin: '0 auto', padding: 24 }}>

        {phase === 'setup' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>

            {/* Left: Add market form */}
            <div style={section}>
              <div style={{ color: BLUE, fontWeight: 'bold', marginBottom: 14, fontSize: 13 }}>Add Market</div>

              <Field label="Type">
                <select value={form.type} onChange={e => setF('type', e.target.value)} style={{ ...inp }}>
                  <optgroup label="Underlying"><option value="underlying">Underlying</option></optgroup>
                  <optgroup label="Options">
                    <option value="call">Call</option>
                    <option value="put">Put</option>
                    <option value="straddle">Straddle</option>
                    <option value="strangle">Strangle</option>
                    <option value="call_spread">Call Spread</option>
                    <option value="put_spread">Put Spread</option>
                  </optgroup>
                  <optgroup label="Combinations">
                    <option value="diff">Diff (leg1 − leg2)</option>
                    <option value="sum">Sum (leg1 + leg2)</option>
                    <option value="max_of">Max(leg1, leg2)</option>
                    <option value="min_of">Min(leg1, leg2)</option>
                  </optgroup>
                </select>
              </Field>

              <Field label="Name">
                <input value={form.name} onChange={e => setF('name', e.target.value)}
                  placeholder={form.type === 'underlying' ? 'e.g. Apple Stock Price' : 'e.g. AAPL Call $180'}
                  style={inp} />
              </Field>

              {form.type === 'underlying' && (
                <Row>
                  <Field label="Reference Price (centers the ladder)">
                    <input value={form.refPrice} onChange={e => setF('refPrice', e.target.value)} type="number" placeholder="100" style={inp} />
                  </Field>
                  <Field label="Unit (optional)">
                    <input value={form.unit} onChange={e => setF('unit', e.target.value)} placeholder="$" style={inp} />
                  </Field>
                </Row>
              )}

              {needsUnderlying && (
                <>
                  <Field label="Underlying">
                    <select value={form.underlyingId} onChange={e => setF('underlyingId', e.target.value)} style={{ ...inp }}>
                      <option value="">— select —</option>
                      {underlyings.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </Field>
                  <Row>
                    {needsStrike && (
                      <Field label="Strike">
                        <input value={form.strike} onChange={e => setF('strike', e.target.value)} type="number" placeholder="180" style={inp} />
                      </Field>
                    )}
                    {needsBounds && (
                      <>
                        <Field label="Lower Strike">
                          <input value={form.lowerStrike} onChange={e => setF('lowerStrike', e.target.value)} type="number" placeholder="170" style={inp} />
                        </Field>
                        <Field label="Upper Strike">
                          <input value={form.upperStrike} onChange={e => setF('upperStrike', e.target.value)} type="number" placeholder="200" style={inp} />
                        </Field>
                      </>
                    )}
                  </Row>
                </>
              )}

              {needsLegs && (
                <Row>
                  <Field label="Leg 1">
                    <select value={form.leg1Id} onChange={e => setF('leg1Id', e.target.value)} style={{ ...inp }}>
                      <option value="">— select —</option>
                      {underlyings.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Leg 2">
                    <select value={form.leg2Id} onChange={e => setF('leg2Id', e.target.value)} style={{ ...inp }}>
                      <option value="">— select —</option>
                      {underlyings.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </Field>
                </Row>
              )}

              <button onClick={addMarket} style={{ ...btn(BLUE), width: '100%', padding: '7px', marginTop: 4 }}>
                + Add Market
              </button>
            </div>

            {/* Right: Market list + start */}
            <div>
              <div style={section}>
                <div style={{ color: BLUE, fontWeight: 'bold', marginBottom: 10 }}>
                  Markets ({markets.length})
                </div>
                {markets.length === 0
                  ? <div style={{ color: DIM, fontSize: 10 }}>No markets yet</div>
                  : markets.map((m, i) => (
                    <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: `1px solid ${BG3}`, fontSize: 10 }}>
                      <div>
                        <span style={{ color: TEXT }}>{m.name}</span>
                        <span style={{ color: DIM, marginLeft: 6 }}>{m.type}</span>
                        {m.refPrice != null && <span style={{ color: DIM, marginLeft: 6 }}>ref={m.refPrice}</span>}
                      </div>
                      <button onClick={() => setMarkets(prev => prev.filter((_, j) => j !== i))}
                        style={{ background: 'none', border: 'none', color: RED, cursor: 'pointer', fontSize: 11, padding: 0 }}>✕</button>
                    </div>
                  ))
                }
              </div>

              <div style={section}>
                <Field label="Round Name">
                  <input value={roundName} onChange={e => setRoundName(e.target.value)} placeholder="ROUND-1" style={inp} />
                </Field>
                <Field label="Tick Size (e.g. 0.1, 0.5, 1, 5)">
                  <input value={tickSize} onChange={e => setTickSize(e.target.value)} type="number" min="0.01" step="0.01" placeholder="0.1" style={inp} />
                </Field>
                <button onClick={startRound}
                  style={{ ...btn(GREEN), width: '100%', padding: '8px', fontWeight: 'bold', fontSize: 12 }}>
                  ▶ Start Round
                </button>
              </div>
            </div>
          </div>
        )}

        {(phase === 'active' || phase === 'settling' || phase === 'settled') && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

            {/* Left: Controls */}
            <div>
              <div style={section}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ color: BLUE, fontWeight: 'bold', fontSize: 13 }}>Live Controls</div>
                  {phase === 'active' && <span style={{ color: GREEN, fontSize: 10 }}>● {roundName || 'ROUND'} — trading open</span>}
                  {phase === 'settling' && <span style={{ color: GOLD, fontSize: 10 }}>⏳ Entering settlement values</span>}
                  {phase === 'settled' && <span style={{ color: GOLD, fontSize: 10 }}>★ {roundName || 'ROUND'} — settled</span>}
                </div>

                {phase === 'active' && (
                  <>
                    <Field label="Publish News / Hint">
                      <textarea value={newsText} onChange={e => setNewsText(e.target.value)}
                        rows={3}
                        placeholder="e.g. Recent data suggests the value may be higher than expected..."
                        style={{ ...inp, resize: 'vertical', height: 70, fontFamily: 'inherit' }} />
                    </Field>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                      <button onClick={sendNews} style={btn(BLUE)}>Publish</button>
                      <button onClick={() => setNewsText('')} style={{ ...btn(DIM), fontSize: 10 }}>Clear</button>
                    </div>

                    <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 14 }}>
                      <div style={{ color: DIM, fontSize: 10, marginBottom: 10 }}>
                        When trading is done, look up the true values online and enter them below to settle all markets.
                      </div>
                      <button onClick={() => setPhase('settling')}
                        style={{ ...btn(GOLD), width: '100%', padding: '8px', fontWeight: 'bold' }}>
                        ⚡ End Trading — Enter Settlement Values
                      </button>
                    </div>
                  </>
                )}

                {phase === 'settling' && (
                  <>
                    <div style={{ color: DIM, fontSize: 10, marginBottom: 12 }}>
                      Look up true values online (Wikipedia, news, etc.) and enter them below. All derivative payoffs will be computed automatically.
                    </div>
                    {activeMarkets.filter(m => m.type === 'underlying').map(m => (
                      <Field key={m.id} label={`True value — ${m.name}`}>
                        <input
                          type="number"
                          placeholder="e.g. 183.72"
                          value={settleValues[m.id] || ''}
                          onChange={e => setSettleValues(sv => ({ ...sv, [m.id]: e.target.value }))}
                          style={inp}
                        />
                      </Field>
                    ))}
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button onClick={settle}
                        style={{ ...btn(GREEN), flex: 1, padding: '8px', fontWeight: 'bold' }}>
                        Settle & Reveal
                      </button>
                      <button onClick={() => setPhase('active')} style={{ ...btn(DIM), fontSize: 10 }}>
                        Back
                      </button>
                    </div>
                  </>
                )}

                {phase === 'settled' && (
                  <>
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ color: DIM, fontSize: 10, marginBottom: 8 }}>Settlement Values</div>
                      {activeMarkets.filter(m => m.type === 'underlying').map(m => (
                        <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '2px 0' }}>
                          <span style={{ color: TEXT }}>{m.name}</span>
                          <span style={{ color: GOLD, fontWeight: 'bold' }}>{(m.settlementValue ?? m.trueValue)?.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                    <button onClick={newRound}
                      style={{ ...btn(GREEN), width: '100%', padding: '8px', fontWeight: 'bold' }}>
                      + New Round
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Right: Leaderboard */}
            <div style={section}>
              <div style={{ color: BLUE, fontWeight: 'bold', marginBottom: 12, fontSize: 13 }}>
                Leaderboard <span style={{ color: DIM, fontSize: 10, fontWeight: 'normal' }}>(live)</span>
              </div>
              {leaderboard.length === 0
                ? <div style={{ color: DIM, fontSize: 10 }}>No players yet — share the link with participants</div>
                : leaderboard.map((e, i) => (
                  <div key={e.traderId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 8px', borderBottom: `1px solid ${BG3}`, fontSize: 12 }}>
                    <span style={{ color: i === 0 ? GOLD : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : DIM }}>
                      #{i + 1} {e.displayName}
                    </span>
                    <span style={{ color: e.pnl >= 0 ? GREEN : RED, fontWeight: 'bold' }}>
                      {e.pnl >= 0 ? '+' : ''}{(e.pnl || 0).toFixed(2)}
                    </span>
                  </div>
                ))
              }
            </div>
          </div>
        )}

        {msg.text && (
          <div style={{ color: msg.ok ? GREEN : RED, marginTop: 8, fontSize: 11 }}>{msg.text}</div>
        )}
      </div>
    </div>
  );
}
