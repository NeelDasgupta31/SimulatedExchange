require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { Exchange } = require('./exchange');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client/dist')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const exchange = new Exchange();

const HOST_KEY = process.env.HOST_KEY || 'host123';

function authHost(req, res) {
  const key = req.query.key || req.headers['x-host-key'];
  if (key !== HOST_KEY) { res.status(401).json({ error: 'Invalid host key' }); return false; }
  return true;
}

// --- Host API (all require ?key=HOST_KEY) ---

app.post('/api/host/round/start', (req, res) => {
  if (!authHost(req, res)) return;
  const { markets, roundName, revealAfterSeconds } = req.body;
  if (!markets || !markets.length) return res.status(400).json({ error: 'No markets provided' });
  exchange.stop();
  exchange.setupMarkets({ markets }, roundName || 'ROUND', Number(revealAfterSeconds) || 0);
  exchange.addNews(`Round "${roundName || 'ROUND'}" is open — good luck!`);
  res.json({ success: true });
});

app.post('/api/host/news', (req, res) => {
  if (!authHost(req, res)) return;
  const { text } = req.body;
  if (text) exchange.addNews(String(text));
  res.json({ success: true });
});

app.post('/api/host/reveal', (req, res) => {
  if (!authHost(req, res)) return;
  exchange.revealTrueValues();
  res.json({ success: true });
});

app.get('/api/host/status', (req, res) => {
  if (!authHost(req, res)) return;
  res.json({
    roundActive: exchange.roundActive,
    roundName: exchange.roundName,
    leaderboard: exchange.getLeaderboard(),
    markets: Array.from(exchange.markets.values()).map(m => ({
      id: m.id, name: m.name, type: m.type, trueValue: m.trueValue, settlementValue: m.settlementValue, revealed: m.revealed,
    })),
  });
});

// Serve SPA for all routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

// --- WebSocket ---

wss.on('connection', (ws) => {
  const traderId = `trader-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  ws.traderId = traderId;
  exchange.addListener(ws);
  ws.send(JSON.stringify({ type: 'init', traderId, state: exchange.getStateForTrader(traderId) }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'set_name') {
      exchange.setTraderName(traderId, msg.name || '');
      exchange._broadcastLeaderboard();
    }

    if (msg.type === 'place_order') {
      const { productId, side, price, volume } = msg;
      if (!productId || !side || price == null || !volume) return;
      const result = exchange.placeOrder(traderId, productId, side, price, Math.round(volume));
      ws.send(JSON.stringify({ type: 'order_result', ...result, productId }));
    }

    if (msg.type === 'cancel_order') {
      const result = exchange.cancelOrder(traderId, msg.orderId);
      ws.send(JSON.stringify({ type: 'cancel_result', orderId: msg.orderId, ...result }));
      const state = exchange.getStateForTrader(traderId);
      ws.send(JSON.stringify({ type: 'state_update', myPositions: state.myPositions, myTrades: state.myTrades, activeOrders: state.activeOrders, totalPnl: state.totalPnl }));
    }

    if (msg.type === 'get_state') {
      ws.send(JSON.stringify({ type: 'init', traderId, state: exchange.getStateForTrader(traderId) }));
    }
  });

  ws.on('close', () => {
    exchange.removeListener(ws);
    exchange._broadcastLeaderboard();
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\nSimExchange running on port ${PORT}`);
  console.log(`Host panel:  http://localhost:${PORT}/host?key=${HOST_KEY}`);
  console.log(`Players join: http://<your-ip>:${PORT}\n`);
});
