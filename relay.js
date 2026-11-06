// Co-op relay: forwards each player's messages to everyone else in the same room.
// The game connects to ws://<host>:8787/<ROOM> (wss:// on Render). Run: npm install && node relay.js
// A plain GET answers "ok": hosts check that, and the page knocks on it to wake a sleeping free server early.
const http = require('http');
const { WebSocketServer } = require('ws');

const port = Number(process.env.PORT) || 8787;
const MAX_SOCKETS = 200;  // it's open to the internet: a limit on how much anyone can pile in
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
  res.end('ok\n');
});
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });
const rooms = new Map(); // room name -> Map(playerId -> socket)

server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.log(`Port ${port} is already taken: a relay is most likely running already, so you're all set.`);
  process.exit(0);
});

// Tell everyone their id, who hosts (lowest id), and how many are in the room.
function announce(room) {
  const ids = [...room.keys()];
  const host = Math.min(...ids);
  for (const [id, s] of room) if (s.readyState === 1) s.send(Buffer.from([255, 67 /* 'C' */, id, host, ids.length]));
}

wss.on('connection', (ws, req) => {
  ws.on('error', () => {});  // an oversized message or a dropped connection is that player's problem: without this it would take down everyone's game
  if (wss.clients.size > MAX_SOCKETS) return ws.close(1013, 'server full');
  const name = (req.url || '/').slice(1).replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || 'lobby';
  const room = rooms.get(name) || new Map();
  let id = 0;
  while (room.has(id)) id++;
  if (id >= 4) return ws.close(1013, 'room full');
  rooms.set(name, room);
  room.set(id, ws);
  announce(room);

  ws.on('message', (data, isBinary) => {
    if (!isBinary) return;
    const out = Buffer.concat([Buffer.from([id]), data]);
    for (const [other, s] of room) if (other !== id && s.readyState === 1) s.send(out);
  });
  ws.on('close', () => {
    room.delete(id);
    if (room.size) announce(room);
    else rooms.delete(name);
  });
});

server.listen(port, () => console.log(`relay listening on :${port}`));
