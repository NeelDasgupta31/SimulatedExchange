import React, { useState } from 'react';

const S = {
  wrap: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
  panel: { background: '#0a0a1a', border: '1px solid #2a2a3a', padding: 24, maxWidth: 560, width: '92%', maxHeight: '85vh', overflowY: 'auto' },
  title: { color: '#7ec8e3', fontSize: 15, fontWeight: 'bold', marginBottom: 16 },
  section: { marginBottom: 18 },
  sTitle: { color: '#888', fontSize: 11, marginBottom: 8, borderBottom: '1px solid #1a1a2a', paddingBottom: 4 },
  btn: { background: '#0f1e2e', border: '1px solid #2d5a8a', color: '#7ec8e3', padding: '6px 14px', cursor: 'pointer', marginRight: 8, marginBottom: 6, fontSize: 11 },
  btnDanger: { background: '#1e0f0f', border: '1px solid #6a2020', color: '#f44336', padding: '6px 14px', cursor: 'pointer', fontSize: 11 },
  input: { background: '#0f0f1e', border: '1px solid #2a2a3a', color: '#e0e0e0', padding: '5px 8px', fontSize: 11, width: '100%', marginBottom: 8 },
  status: { color: '#4caf50', fontSize: 11, marginTop: 10 },
  error: { color: '#f44336', fontSize: 11, marginTop: 10 },
  close: { float: 'right', background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 18 },
  hint: { color: '#444', fontSize: 9, lineHeight: 1.4 },
  exampleGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 },
  exCard: { background: '#111', border: '1px solid #222', padding: '5px 8px', cursor: 'pointer' },
  exName: { color: '#aaa', fontSize: 9, fontWeight: 'bold' },
};

const EXAMPLE_TOPICS = [
  { label: 'Populations', topics: 'Population of USA (millions)\nPopulation of China (millions)\nPopulation of India (millions)' },
  { label: 'Distances', topics: 'Distance Earth to Mars (million km)\nDistance Earth to Jupiter (million km)' },
  { label: 'GDP', topics: 'GDP of USA (trillion USD)\nGDP of China (trillion USD)\nGDP of Japan (trillion USD)' },
  { label: 'Sports Records', topics: 'World record 100m sprint (seconds)\n100m world record year' },
];

export function RoundControl({ onClose }) {
  const [customTopics, setCustomTopics] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function startRandom() {
    setLoading(true); setError(''); setStatus('AI is generating markets + options...');
    try {
      const r = await fetch('/api/round/start-random', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const d = await r.json();
      if (d.error) setError(d.error);
      else { setStatus(`Round started: ${d.theme}`); setTimeout(onClose, 1500); }
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  async function startCustom() {
    const topics = customTopics.split('\n').map(t => t.trim()).filter(Boolean);
    if (!topics.length) { setError('Enter at least one topic'); return; }
    setLoading(true); setError(''); setStatus('AI is building markets + derivatives...');
    try {
      const r = await fetch('/api/round/start-custom', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topics }) });
      const d = await r.json();
      if (d.error) setError(d.error);
      else { setStatus(`Round started: ${d.theme}`); setTimeout(onClose, 1500); }
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  async function revealNow() {
    await fetch('/api/round/reveal', { method: 'POST' });
    setStatus('True values revealed!');
  }

  return (
    <div style={S.wrap} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.panel}>
        <button style={S.close} onClick={onClose}>✕</button>
        <div style={S.title}>New Round</div>

        <div style={S.section}>
          <div style={S.sTitle}>AI Random Round</div>
          <p style={S.hint}>AI picks an interesting topic and generates 1-2 underlying markets plus options: calls, puts, straddles, strangles, call spreads, put spreads, and spread markets. News feed generates clues every 60-90 seconds.</p>
          <button style={{ ...S.btn, marginTop: 8 }} onClick={startRandom} disabled={loading}>Generate Random Round</button>
        </div>

        <div style={S.section}>
          <div style={S.sTitle}>Custom Topics (one per line)</div>
          <div style={S.exampleGrid}>
            {EXAMPLE_TOPICS.map(ex => (
              <div key={ex.label} style={S.exCard} onClick={() => setCustomTopics(ex.topics)}>
                <div style={S.exName}>{ex.label}</div>
                <div style={{ ...S.hint, color: '#333' }}>{ex.topics.split('\n')[0]}...</div>
              </div>
            ))}
          </div>
          <textarea
            style={{ ...S.input, height: 90, resize: 'vertical', fontFamily: 'monospace' }}
            placeholder={'Population of France (millions)\nPopulation of Germany (millions)\n(AI will add options & spreads automatically)'}
            value={customTopics}
            onChange={e => setCustomTopics(e.target.value)}
          />
          <p style={S.hint}>Enter the underlying topics. AI will automatically add calls, puts, straddles, spreads etc.</p>
          <button style={S.btn} onClick={startCustom} disabled={loading}>Start Custom Round</button>
        </div>

        <div style={S.section}>
          <div style={S.sTitle}>Controls</div>
          <button style={S.btnDanger} onClick={revealNow} disabled={loading}>Reveal True Values Now</button>
        </div>

        {status && <div style={S.status}>{status}</div>}
        {error && <div style={S.error}>{error}</div>}
      </div>
    </div>
  );
}
