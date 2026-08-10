const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// SQLite connection, schema, and the one-time import from the old data/db.json.
//
// node:sqlite ships with Node (22.5+) so this adds no dependency. The schema is
// relational where relations matter — collections, folders, requests, comments,
// revisions — and keeps the order-sensitive row arrays a request owns (params,
// headers, tests, examples…) as JSON columns, because they are always read and
// written whole and splitting them would buy nothing but joins.

const DB_PATH =
  process.env.B4CALL_DB ||
  process.env.API_STUDIO_DB || // pre-rename env var, still honoured
  path.join(__dirname, '..', 'data', 'b4call.sqlite');

const LEGACY_JSON_PATH =
  process.env.B4CALL_LEGACY_JSON || path.join(__dirname, '..', 'data', 'db.json');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS collections (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  share_token  TEXT UNIQUE,
  share_mode   TEXT NOT NULL DEFAULT 'readonly',
  variables    TEXT NOT NULL DEFAULT '[]',
  position     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_collections_workspace ON collections(workspace_id);

CREATE TABLE IF NOT EXISTS folders (
  id            TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  parent_id     TEXT,
  name          TEXT NOT NULL,
  position      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_folders_collection ON folders(collection_id);

CREATE TABLE IF NOT EXISTS requests (
  id                 TEXT PRIMARY KEY,
  collection_id      TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  folder_id          TEXT,
  position           INTEGER NOT NULL DEFAULT 0,
  name               TEXT NOT NULL,
  method             TEXT NOT NULL DEFAULT 'GET',
  url                TEXT NOT NULL DEFAULT '',
  body_type          TEXT NOT NULL DEFAULT 'none',
  body_raw           TEXT NOT NULL DEFAULT '',
  graphql_query      TEXT NOT NULL DEFAULT '',
  graphql_variables  TEXT NOT NULL DEFAULT '',
  pre_request_script TEXT NOT NULL DEFAULT '',
  tests_script       TEXT NOT NULL DEFAULT '',
  docs               TEXT NOT NULL DEFAULT '',
  favorite           INTEGER NOT NULL DEFAULT 0,
  params             TEXT NOT NULL DEFAULT '[]',
  path_vars          TEXT NOT NULL DEFAULT '[]',
  headers            TEXT NOT NULL DEFAULT '[]',
  body_form          TEXT NOT NULL DEFAULT '[]',
  capture            TEXT NOT NULL DEFAULT '[]',
  tests              TEXT NOT NULL DEFAULT '[]',
  tags               TEXT NOT NULL DEFAULT '[]',
  examples           TEXT NOT NULL DEFAULT '[]',
  auth               TEXT NOT NULL DEFAULT '{}',
  settings           TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_requests_collection ON requests(collection_id, position);
CREATE INDEX IF NOT EXISTS idx_requests_folder ON requests(folder_id);

CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  at         INTEGER NOT NULL,
  edited_at  INTEGER,
  author     TEXT NOT NULL,
  text       TEXT NOT NULL,
  anchor     TEXT,
  resolved   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_comments_request ON comments(request_id, at);

CREATE TABLE IF NOT EXISTS revisions (
  id         TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  at         INTEGER NOT NULL,
  author     TEXT NOT NULL,
  summary    TEXT NOT NULL,
  snapshot   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revisions_request ON revisions(request_id, at DESC);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

let db = null;

function connect() {
  if (db) return db;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);

  // WAL keeps readers from blocking the writer, and NORMAL sync is the usual
  // durability/speed tradeoff for a local app.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  // Fold the write-ahead log back into the database file every ~1 MB. The
  // default (4 MB) is fine for durability but leaves the .sqlite file looking
  // suspiciously small next to a large -wal.
  db.exec('PRAGMA wal_autocheckpoint = 256');
  db.exec(SCHEMA);

  importLegacyJson();
  return db;
}

function getMeta(key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setMeta(key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

// One-time import of the pre-SQLite data/db.json. The JSON file is renamed to
// .imported rather than deleted, so there is always a way back.
function importLegacyJson() {
  if (getMeta('legacy_json_imported') === '1') return;
  if (!fs.existsSync(LEGACY_JSON_PATH)) {
    setMeta('legacy_json_imported', '1');
    return;
  }

  let legacy;
  try {
    legacy = JSON.parse(fs.readFileSync(LEGACY_JSON_PATH, 'utf8'));
  } catch (err) {
    console.error('[b4call] data/db.json is not valid JSON — starting empty:', err.message);
    setMeta('legacy_json_imported', '1');
    return;
  }
  if (!legacy || !Array.isArray(legacy.collections)) {
    setMeta('legacy_json_imported', '1');
    return;
  }

  // Records written by older versions predate fields like settings, tags and
  // auth.addTo. Run everything through the same sanitizer the API applies on
  // write, so imported rows are indistinguishable from freshly saved ones.
  const { sanitizeRequest, sanitizeRows, sanitizeFolders } = require('./request-model');
  const collections = legacy.collections.map((collection) => ({
    ...collection,
    variables: sanitizeRows(collection.variables),
    folders: sanitizeFolders(collection.folders),
    requests: (collection.requests || [])
      .map((raw) => {
        const named = String(raw?.name ?? '').trim()
          ? raw
          : { ...raw, name: String(raw?.url ?? '').trim() || 'Untitled request' };
        const { request, error } = sanitizeRequest(named, named.id);
        if (error) {
          console.warn(`[b4call] skipped an unreadable request during import: ${error}`);
          return null;
        }
        return request;
      })
      .filter(Boolean),
  }));

  const { writeFullDatabase } = require('./store');
  writeFullDatabase({
    collections,
    workspaces: Array.isArray(legacy.workspaces) ? legacy.workspaces : [],
    activity: legacy.activity && typeof legacy.activity === 'object' ? legacy.activity : {},
  });

  const requests = legacy.collections.reduce((n, c) => n + (c.requests || []).length, 0);
  console.log(
    `[b4call] imported ${legacy.collections.length} collection(s) and ${requests} request(s) ` +
      'from data/db.json into SQLite'
  );

  try {
    fs.renameSync(LEGACY_JSON_PATH, `${LEGACY_JSON_PATH}.imported`);
  } catch {
    /* keeping the original in place is harmless — the meta flag stops a re-import */
  }
  setMeta('legacy_json_imported', '1');
}

// Runs fn inside a transaction, rolling back if it throws.
function transaction(fn) {
  const handle = connect();
  handle.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(handle);
    handle.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      handle.exec('ROLLBACK');
    } catch {
      /* the transaction was already unwound */
    }
    throw err;
  }
}

function close() {
  if (!db) return;
  try {
    // Checkpoint and remove the -wal so the .sqlite file is self-contained —
    // which is what someone copying it for a backup expects.
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    /* nothing to checkpoint, or another connection is mid-write */
  }
  db.close();
  db = null;
}

module.exports = { connect, transaction, close, getMeta, setMeta, DB_PATH };
