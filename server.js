const express = require('express');
const path = require('path');
const os = require('os');

const store = require('./src/store');
const collectionsRouter = require('./src/routes/collections');
const shareRouter = require('./src/routes/share');
const { router: proxyRouter } = require('./src/routes/proxy');
const workspacesRouter = require('./src/routes/workspaces');
const mockRouter = require('./src/routes/mock');
const { router: realtimeRouter } = require('./src/routes/realtime');
const activityRouter = require('./src/routes/activity');

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/collections', collectionsRouter);
app.use('/api/share', shareRouter);
app.use('/api/proxy', proxyRouter);
app.use('/api/workspaces', workspacesRouter);
app.use('/api/realtime', realtimeRouter);
app.use('/api/activity', activityRouter);
app.use('/mock', mockRouter);

// Deep link for shared collections — the SPA reads the token from the URL.
app.get('/s/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Published, read-only API documentation for a shared collection.
app.get('/docs/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'docs.html'));
});

app.use((err, req, res, next) => {
  console.error('[b4call] unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
    .map((iface) => iface.address);
}

const PORT = process.env.PORT || 2000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`B4Call running:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  lanAddresses().forEach((address) => {
    console.log(`  Network: http://${address}:${PORT}  (share links from this URL work for teammates)`);
  });
});

// Closing SQLite on the way out checkpoints the write-ahead log back into the
// database file, so an interrupted run never leaves a stale -wal behind.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[b4call] ${signal} — closing database…`);
  server.close(() => {
    try {
      store.close();
    } catch (err) {
      console.error('[b4call] could not close the database cleanly:', err.message);
    }
    process.exit(0);
  });
  // Don't hang forever on a stuck connection (an open SSE stream, say).
  setTimeout(() => {
    try {
      store.close();
    } catch {
      /* already closed */
    }
    process.exit(0);
  }, 3000).unref();
}

['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((signal) =>
  process.on(signal, () => shutdown(signal))
);
