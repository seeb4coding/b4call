const express = require('express');
const store = require('../store');

const router = express.Router();

// token -> Map(clientId -> { res, name, color, requestId, requestName, at })
const rooms = new Map();

const HEARTBEAT_MS = 25000;
const MAX_CLIENTS_PER_ROOM = 50;

function roomOf(token) {
  if (!rooms.has(token)) rooms.set(token, new Map());
  return rooms.get(token);
}

function collectionForToken(token) {
  return store.shareMetaForToken(token);
}

function roster(token) {
  return [...roomOf(token).values()].map((client) => ({
    clientId: client.clientId,
    name: client.name,
    color: client.color,
    requestId: client.requestId,
    requestName: client.requestName,
  }));
}

function send(client, event, data) {
  try {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    /* the socket is gone; the close handler will clean it up */
  }
}

// Fan an event out to everyone in a room, optionally skipping the originator.
function broadcast(token, event, data, exceptClientId = null) {
  const room = rooms.get(token);
  if (!room) return;
  for (const client of room.values()) {
    if (exceptClientId && client.clientId === exceptClientId) continue;
    send(client, event, data);
  }
}

function broadcastPresence(token) {
  broadcast(token, 'presence', { people: roster(token) });
}

const clean = (value, max) => String(value ?? '').slice(0, max);

router.get('/:token/stream', (req, res) => {
  const { token } = req.params;
  if (!collectionForToken(token)) {
    return res.status(404).json({ error: 'Shared collection not found' });
  }

  const room = roomOf(token);
  if (room.size >= MAX_CLIENTS_PER_ROOM) {
    return res.status(429).json({ error: 'Too many people on this link right now' });
  }

  const clientId = clean(req.query.clientId, 64) || `c${Date.now()}${Math.random().toString(36).slice(2, 7)}`;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');

  const client = {
    clientId,
    res,
    name: clean(req.query.name, 40) || 'Guest',
    color: clean(req.query.color, 20) || '#888888',
    requestId: null,
    requestName: null,
    at: Date.now(),
  };
  room.set(clientId, client);

  send(client, 'hello', { clientId, people: roster(token) });
  broadcast(token, 'joined', { person: { clientId, name: client.name, color: client.color } }, clientId);
  broadcastPresence(token);

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* handled on close */
    }
  }, HEARTBEAT_MS);

  req.on('close', () => {
    clearInterval(heartbeat);
    room.delete(clientId);
    if (room.size === 0) rooms.delete(token);
    else {
      broadcast(token, 'left', { clientId, name: client.name });
      broadcastPresence(token);
    }
  });
});

// Presence updates: display name, colour, and which request the person is on.
router.post('/:token/presence', (req, res) => {
  const { token } = req.params;
  const room = rooms.get(token);
  const clientId = clean(req.body?.clientId, 64);
  const client = room?.get(clientId);
  if (!client) return res.status(404).json({ error: 'Not connected' });

  if (req.body.name !== undefined) client.name = clean(req.body.name, 40) || 'Guest';
  if (req.body.color !== undefined) client.color = clean(req.body.color, 20);
  if (req.body.requestId !== undefined) client.requestId = req.body.requestId ? clean(req.body.requestId, 64) : null;
  if (req.body.requestName !== undefined) client.requestName = clean(req.body.requestName, 200);
  client.at = Date.now();

  broadcastPresence(token);
  res.json({ ok: true });
});

// "Someone is typing in this request" — transient, never persisted.
router.post('/:token/editing', (req, res) => {
  const { token } = req.params;
  const clientId = clean(req.body?.clientId, 64);
  const client = rooms.get(token)?.get(clientId);
  if (!client) return res.status(404).json({ error: 'Not connected' });

  broadcast(
    token,
    'editing',
    {
      clientId,
      name: client.name,
      color: client.color,
      requestId: clean(req.body?.requestId, 64) || null,
      field: clean(req.body?.field, 40),
    },
    clientId
  );
  res.json({ ok: true });
});

// Free-form chat line so collaborators can talk without leaving the link.
router.post('/:token/message', (req, res) => {
  const { token } = req.params;
  const clientId = clean(req.body?.clientId, 64);
  const client = rooms.get(token)?.get(clientId);
  if (!client) return res.status(404).json({ error: 'Not connected' });

  const text = clean(req.body?.text, 500).trim();
  if (!text) return res.status(400).json({ error: 'Message is empty' });

  broadcast(token, 'message', {
    clientId,
    name: client.name,
    color: client.color,
    text,
    at: Date.now(),
  });
  res.json({ ok: true });
});

router.get('/:token/people', (req, res) => {
  res.json({ people: roster(req.params.token) });
});

// Called by the share routes after a successful mutation.
function notifyChanged(token, change) {
  broadcast(token, 'changed', { ...change, at: Date.now() });
}

module.exports = { router, broadcast, notifyChanged };
