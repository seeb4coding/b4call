const crypto = require('crypto');
const { connect, transaction, close, DB_PATH } = require('./db');

// Storage gateway. Everything that touches the database goes through here.
//
// Two layers live side by side on purpose:
//   • granular accessors (getCollection, findByShareToken, upsertRequest…)
//     which is what the routes use — one indexed query instead of reading the
//     whole dataset;
//   • load()/save(), which materialise or replace the entire object graph.
//     Bulk import/restore genuinely needs that, and it keeps the shape the rest
//     of the app already understands.

const json = (value, fallback) => {
  if (value == null) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const str = (value, fallback = '') => (value == null ? fallback : String(value));

/* ---------------- row ⇄ object mapping ---------------- */

function rowToRequest(row) {
  return {
    id: row.id,
    name: row.name,
    method: row.method,
    url: row.url,
    folderId: row.folder_id ?? null,
    params: json(row.params, []),
    pathVars: json(row.path_vars, []),
    headers: json(row.headers, []),
    bodyType: row.body_type,
    bodyRaw: row.body_raw,
    bodyForm: json(row.body_form, []),
    graphqlQuery: row.graphql_query,
    graphqlVariables: row.graphql_variables,
    auth: json(row.auth, { type: 'none' }),
    capture: json(row.capture, []),
    tests: json(row.tests, []),
    preRequestScript: row.pre_request_script,
    testsScript: row.tests_script,
    settings: json(row.settings, {}),
    docs: row.docs,
    tags: json(row.tags, []),
    favorite: row.favorite === 1,
    examples: json(row.examples, []),
  };
}

function requestParams(collectionId, request, position) {
  return [
    request.id,
    collectionId,
    request.folderId || null,
    position,
    str(request.name),
    str(request.method, 'GET'),
    str(request.url),
    str(request.bodyType, 'none'),
    str(request.bodyRaw),
    str(request.graphqlQuery),
    str(request.graphqlVariables),
    str(request.preRequestScript),
    str(request.testsScript),
    str(request.docs),
    request.favorite === true ? 1 : 0,
    JSON.stringify(request.params ?? []),
    JSON.stringify(request.pathVars ?? []),
    JSON.stringify(request.headers ?? []),
    JSON.stringify(request.bodyForm ?? []),
    JSON.stringify(request.capture ?? []),
    JSON.stringify(request.tests ?? []),
    JSON.stringify(request.tags ?? []),
    JSON.stringify(request.examples ?? []),
    JSON.stringify(request.auth ?? { type: 'none' }),
    JSON.stringify(request.settings ?? {}),
  ];
}

const REQUEST_COLUMNS = `
  id, collection_id, folder_id, position, name, method, url, body_type, body_raw,
  graphql_query, graphql_variables, pre_request_script, tests_script, docs, favorite,
  params, path_vars, headers, body_form, capture, tests, tags, examples, auth, settings`;

const REQUEST_PLACEHOLDERS = new Array(25).fill('?').join(', ');

const UPSERT_REQUEST = `
INSERT INTO requests (${REQUEST_COLUMNS}) VALUES (${REQUEST_PLACEHOLDERS})
ON CONFLICT(id) DO UPDATE SET
  collection_id = excluded.collection_id,
  folder_id = excluded.folder_id,
  position = excluded.position,
  name = excluded.name,
  method = excluded.method,
  url = excluded.url,
  body_type = excluded.body_type,
  body_raw = excluded.body_raw,
  graphql_query = excluded.graphql_query,
  graphql_variables = excluded.graphql_variables,
  pre_request_script = excluded.pre_request_script,
  tests_script = excluded.tests_script,
  docs = excluded.docs,
  favorite = excluded.favorite,
  params = excluded.params,
  path_vars = excluded.path_vars,
  headers = excluded.headers,
  body_form = excluded.body_form,
  capture = excluded.capture,
  tests = excluded.tests,
  tags = excluded.tags,
  examples = excluded.examples,
  auth = excluded.auth,
  settings = excluded.settings`;

function rowToCollectionMeta(row) {
  return {
    id: row.id,
    name: row.name,
    workspaceId: row.workspace_id,
    shareToken: row.share_token ?? null,
    shareMode: row.share_mode,
    variables: json(row.variables, []),
  };
}

/* ---------------- reads ---------------- */

function hydrate(handle, metaRow) {
  const collection = rowToCollectionMeta(metaRow);
  collection.folders = handle
    .prepare('SELECT id, parent_id, name FROM folders WHERE collection_id = ? ORDER BY position, rowid')
    .all(collection.id)
    .map((row) => ({ id: row.id, name: row.name, parentId: row.parent_id ?? null }));
  collection.requests = handle
    .prepare(`SELECT ${REQUEST_COLUMNS} FROM requests WHERE collection_id = ? ORDER BY position, rowid`)
    .all(collection.id)
    .map(rowToRequest);
  return collection;
}

function listCollections(workspaceId) {
  const handle = connect();
  const rows =
    typeof workspaceId === 'string' && workspaceId
      ? handle
          .prepare('SELECT * FROM collections WHERE workspace_id = ? ORDER BY position, rowid')
          .all(workspaceId)
      : handle.prepare('SELECT * FROM collections ORDER BY position, rowid').all();
  return rows.map((row) => hydrate(handle, row));
}

function getCollection(id) {
  const handle = connect();
  const row = handle.prepare('SELECT * FROM collections WHERE id = ?').get(id);
  return row ? hydrate(handle, row) : null;
}

// Metadata only — no folders or requests. Used where the caller just needs the
// name, share mode or workspace of a collection.
function getCollectionMeta(id) {
  const handle = connect();
  const row = handle.prepare('SELECT * FROM collections WHERE id = ?').get(id);
  return row ? rowToCollectionMeta(row) : null;
}

function findByShareToken(token) {
  const handle = connect();
  const row = handle.prepare('SELECT * FROM collections WHERE share_token = ?').get(token);
  return row ? hydrate(handle, row) : null;
}

function shareMetaForToken(token) {
  const handle = connect();
  const row = handle.prepare('SELECT * FROM collections WHERE share_token = ?').get(token);
  return row ? rowToCollectionMeta(row) : null;
}

function getRequest(requestId) {
  const handle = connect();
  const row = handle
    .prepare(`SELECT ${REQUEST_COLUMNS} FROM requests WHERE id = ?`)
    .get(requestId);
  if (!row) return null;
  return { request: rowToRequest(row), collectionId: row.collection_id };
}

function collectionIdOfRequest(requestId) {
  const handle = connect();
  const row = handle.prepare('SELECT collection_id FROM requests WHERE id = ?').get(requestId);
  return row ? row.collection_id : null;
}

/* ---------------- collections ---------------- */

function createCollection({ name, workspaceId = 'default' }) {
  const collection = {
    id: crypto.randomUUID(),
    name,
    workspaceId,
    shareToken: null,
    shareMode: 'readonly',
    variables: [],
    folders: [],
    requests: [],
  };
  transaction((handle) => {
    const max = handle.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM collections').get();
    handle
      .prepare(
        'INSERT INTO collections (id, name, workspace_id, share_token, share_mode, variables, position) VALUES (?, ?, ?, NULL, ?, ?, ?)'
      )
      .run(collection.id, name, workspaceId, 'readonly', '[]', max.p + 1);
  });
  return collection;
}

function renameCollection(id, name) {
  const changes = transaction((handle) =>
    handle.prepare('UPDATE collections SET name = ? WHERE id = ?').run(name, id).changes
  );
  return changes > 0 ? getCollectionMeta(id) : null;
}

function deleteCollection(id) {
  return transaction((handle) => {
    // Activity is keyed by request id and has no FK, so clear it explicitly.
    const requestIds = handle.prepare('SELECT id FROM requests WHERE collection_id = ?').all(id);
    const dropComments = handle.prepare('DELETE FROM comments WHERE request_id = ?');
    const dropRevisions = handle.prepare('DELETE FROM revisions WHERE request_id = ?');
    for (const row of requestIds) {
      dropComments.run(row.id);
      dropRevisions.run(row.id);
    }
    return handle.prepare('DELETE FROM collections WHERE id = ?').run(id).changes > 0;
  });
}

function setShare(collectionId, token, mode) {
  return transaction(
    (handle) =>
      handle
        .prepare('UPDATE collections SET share_token = ?, share_mode = ? WHERE id = ?')
        .run(token, mode, collectionId).changes > 0
  );
}

function setVariables(collectionId, variables) {
  return transaction(
    (handle) =>
      handle
        .prepare('UPDATE collections SET variables = ? WHERE id = ?')
        .run(JSON.stringify(variables ?? []), collectionId).changes > 0
  );
}

// Replaces the folders/requests/variables of one collection in a single
// transaction. Backs import, reorder, move-to-folder and folder management.
function replaceContents(collectionId, { name, folders, requests, variables }) {
  return transaction((handle) => {
    const exists = handle.prepare('SELECT id FROM collections WHERE id = ?').get(collectionId);
    if (!exists) return false;

    if (typeof name === 'string' && name.trim()) {
      handle.prepare('UPDATE collections SET name = ? WHERE id = ?').run(name.trim(), collectionId);
    }
    if (Array.isArray(variables)) {
      handle
        .prepare('UPDATE collections SET variables = ? WHERE id = ?')
        .run(JSON.stringify(variables), collectionId);
    }
    if (Array.isArray(folders)) {
      handle.prepare('DELETE FROM folders WHERE collection_id = ?').run(collectionId);
      const insert = handle.prepare(
        'INSERT INTO folders (id, collection_id, parent_id, name, position) VALUES (?, ?, ?, ?, ?)'
      );
      folders.forEach((folder, index) => {
        insert.run(folder.id, collectionId, folder.parentId || null, folder.name, index);
      });
    }
    if (Array.isArray(requests)) {
      const keep = new Set(requests.map((r) => r.id));
      const existing = handle
        .prepare('SELECT id FROM requests WHERE collection_id = ?')
        .all(collectionId);
      const drop = handle.prepare('DELETE FROM requests WHERE id = ?');
      const dropComments = handle.prepare('DELETE FROM comments WHERE request_id = ?');
      const dropRevisions = handle.prepare('DELETE FROM revisions WHERE request_id = ?');
      for (const row of existing) {
        if (keep.has(row.id)) continue;
        drop.run(row.id);
        dropComments.run(row.id);
        dropRevisions.run(row.id);
      }
      const upsert = handle.prepare(UPSERT_REQUEST);
      requests.forEach((request, index) => {
        upsert.run(...requestParams(collectionId, request, index));
      });
    }
    return true;
  });
}

/* ---------------- requests ---------------- */

function insertRequest(collectionId, request) {
  return transaction((handle) => {
    const exists = handle.prepare('SELECT id FROM collections WHERE id = ?').get(collectionId);
    if (!exists) return null;
    const max = handle
      .prepare('SELECT COALESCE(MAX(position), -1) AS p FROM requests WHERE collection_id = ?')
      .get(collectionId);
    handle.prepare(UPSERT_REQUEST).run(...requestParams(collectionId, request, max.p + 1));
    return request;
  });
}

function updateRequest(collectionId, request) {
  return transaction((handle) => {
    const current = handle
      .prepare('SELECT position FROM requests WHERE id = ? AND collection_id = ?')
      .get(request.id, collectionId);
    if (!current) return null;
    handle.prepare(UPSERT_REQUEST).run(...requestParams(collectionId, request, current.position));
    return request;
  });
}

function deleteRequest(collectionId, requestId) {
  return transaction((handle) => {
    const removed = handle
      .prepare('DELETE FROM requests WHERE id = ? AND collection_id = ?')
      .run(requestId, collectionId).changes;
    if (removed) {
      handle.prepare('DELETE FROM comments WHERE request_id = ?').run(requestId);
      handle.prepare('DELETE FROM revisions WHERE request_id = ?').run(requestId);
    }
    return removed > 0;
  });
}

/* ---------------- workspaces ---------------- */

function listWorkspaces() {
  return connect()
    .prepare('SELECT id, name FROM workspaces ORDER BY position, rowid')
    .all()
    .map((row) => ({ id: row.id, name: row.name }));
}

function createWorkspace(name) {
  const workspace = { id: crypto.randomUUID(), name };
  transaction((handle) => {
    const max = handle.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM workspaces').get();
    handle
      .prepare('INSERT INTO workspaces (id, name, position) VALUES (?, ?, ?)')
      .run(workspace.id, workspace.name, max.p + 1);
  });
  return workspace;
}

function renameWorkspace(id, name) {
  const changes = transaction(
    (handle) => handle.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(name, id).changes
  );
  return changes > 0 ? { id, name } : null;
}

// Collections in a deleted workspace fall back to the default one so nothing
// is silently destroyed.
function deleteWorkspace(id) {
  return transaction((handle) => {
    handle.prepare("UPDATE collections SET workspace_id = 'default' WHERE workspace_id = ?").run(id);
    return handle.prepare('DELETE FROM workspaces WHERE id = ?').run(id).changes > 0;
  });
}

/* ---------------- activity: comments & revisions ---------------- */

function rowToComment(row) {
  return {
    id: row.id,
    at: row.at,
    editedAt: row.edited_at ?? undefined,
    author: row.author,
    text: row.text,
    anchor: row.anchor ?? null,
    resolved: row.resolved === 1,
  };
}

function listComments(requestId) {
  return connect()
    .prepare('SELECT * FROM comments WHERE request_id = ? ORDER BY at')
    .all(requestId)
    .map(rowToComment);
}

function insertComment(requestId, comment) {
  transaction((handle) => {
    handle
      .prepare(
        'INSERT INTO comments (id, request_id, at, author, text, anchor, resolved) VALUES (?, ?, ?, ?, ?, ?, 0)'
      )
      .run(comment.id, requestId, comment.at, comment.author, comment.text, comment.anchor);
  });
  return comment;
}

function patchComment(requestId, commentId, patch) {
  return transaction((handle) => {
    const row = handle
      .prepare('SELECT * FROM comments WHERE id = ? AND request_id = ?')
      .get(commentId, requestId);
    if (!row) return null;

    const text = patch.text !== undefined ? String(patch.text).slice(0, 4000) : row.text;
    const resolved = patch.resolved !== undefined ? (patch.resolved === true ? 1 : 0) : row.resolved;
    const editedAt = patch.text !== undefined ? Date.now() : row.edited_at;

    handle
      .prepare('UPDATE comments SET text = ?, resolved = ?, edited_at = ? WHERE id = ?')
      .run(text, resolved, editedAt, commentId);
    return rowToComment({ ...row, text, resolved, edited_at: editedAt });
  });
}

function removeComment(requestId, commentId) {
  return transaction(
    (handle) =>
      handle
        .prepare('DELETE FROM comments WHERE id = ? AND request_id = ?')
        .run(commentId, requestId).changes > 0
  );
}

function listRevisions(requestId, { withSnapshot = false } = {}) {
  const columns = withSnapshot
    ? 'id, at, author, summary, snapshot'
    : 'id, at, author, summary';
  return connect()
    .prepare(`SELECT ${columns} FROM revisions WHERE request_id = ? ORDER BY at DESC, rowid DESC`)
    .all(requestId)
    .map((row) => ({
      id: row.id,
      at: row.at,
      author: row.author,
      summary: row.summary,
      ...(withSnapshot ? { snapshot: json(row.snapshot, null) } : {}),
    }));
}

function getRevision(requestId, revisionId) {
  const row = connect()
    .prepare('SELECT * FROM revisions WHERE id = ? AND request_id = ?')
    .get(revisionId, requestId);
  if (!row) return null;
  return {
    id: row.id,
    at: row.at,
    author: row.author,
    summary: row.summary,
    snapshot: json(row.snapshot, null),
  };
}

// Inserts a revision and trims the request's history to `limit` entries.
function insertRevision(requestId, revision, limit) {
  transaction((handle) => {
    handle
      .prepare(
        'INSERT INTO revisions (id, request_id, at, author, summary, snapshot) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        revision.id,
        requestId,
        revision.at,
        revision.author,
        revision.summary,
        JSON.stringify(revision.snapshot)
      );
    if (limit > 0) {
      handle
        .prepare(
          `DELETE FROM revisions WHERE request_id = ? AND id NOT IN (
             SELECT id FROM revisions WHERE request_id = ? ORDER BY at DESC, rowid DESC LIMIT ?
           )`
        )
        .run(requestId, requestId, limit);
    }
  });
  return revision;
}

function dropActivity(requestId) {
  transaction((handle) => {
    handle.prepare('DELETE FROM comments WHERE request_id = ?').run(requestId);
    handle.prepare('DELETE FROM revisions WHERE request_id = ?').run(requestId);
  });
}

/* ---------------- whole-database load / save ---------------- */

// The full object graph, in the shape the app used before SQLite. Bulk paths
// (backup, restore, legacy import) still want it; routes should not.
function load() {
  const handle = connect();
  const collections = listCollections();
  const workspaces = listWorkspaces();

  const activity = {};
  const requestIds = handle.prepare('SELECT id FROM requests').all().map((r) => r.id);
  for (const id of requestIds) {
    const comments = listComments(id);
    const revisions = listRevisions(id, { withSnapshot: true });
    if (comments.length || revisions.length) activity[id] = { comments, revisions };
  }

  return { collections, workspaces, activity };
}

// Replaces everything. Used by load()/save() callers and the legacy import.
function writeFullDatabase(db) {
  const collections = Array.isArray(db?.collections) ? db.collections : [];
  const workspaces = Array.isArray(db?.workspaces) ? db.workspaces : [];
  const activity = db?.activity && typeof db.activity === 'object' ? db.activity : {};

  transaction((handle) => {
    handle.exec('DELETE FROM comments');
    handle.exec('DELETE FROM revisions');
    handle.exec('DELETE FROM requests');
    handle.exec('DELETE FROM folders');
    handle.exec('DELETE FROM collections');
    handle.exec('DELETE FROM workspaces');

    const insertWorkspace = handle.prepare(
      'INSERT INTO workspaces (id, name, position) VALUES (?, ?, ?)'
    );
    workspaces.forEach((workspace, index) => {
      insertWorkspace.run(workspace.id, str(workspace.name), index);
    });

    const insertCollection = handle.prepare(
      'INSERT INTO collections (id, name, workspace_id, share_token, share_mode, variables, position) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const insertFolder = handle.prepare(
      'INSERT INTO folders (id, collection_id, parent_id, name, position) VALUES (?, ?, ?, ?, ?)'
    );
    const upsertRequest = handle.prepare(UPSERT_REQUEST);

    collections.forEach((collection, index) => {
      insertCollection.run(
        collection.id,
        str(collection.name),
        str(collection.workspaceId, 'default') || 'default',
        collection.shareToken || null,
        str(collection.shareMode, 'readonly') || 'readonly',
        JSON.stringify(collection.variables ?? []),
        index
      );
      (collection.folders ?? []).forEach((folder, folderIndex) => {
        insertFolder.run(
          folder.id,
          collection.id,
          folder.parentId || null,
          str(folder.name),
          folderIndex
        );
      });
      (collection.requests ?? []).forEach((request, requestIndex) => {
        upsertRequest.run(...requestParams(collection.id, request, requestIndex));
      });
    });

    const insertComment = handle.prepare(
      'INSERT INTO comments (id, request_id, at, edited_at, author, text, anchor, resolved) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertRevisionRow = handle.prepare(
      'INSERT INTO revisions (id, request_id, at, author, summary, snapshot) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const [requestId, entry] of Object.entries(activity)) {
      (entry?.comments ?? []).forEach((comment) => {
        insertComment.run(
          comment.id || crypto.randomUUID(),
          requestId,
          Number(comment.at) || Date.now(),
          comment.editedAt ? Number(comment.editedAt) : null,
          str(comment.author, 'Someone'),
          str(comment.text),
          comment.anchor || null,
          comment.resolved === true ? 1 : 0
        );
      });
      (entry?.revisions ?? []).forEach((revision) => {
        insertRevisionRow.run(
          revision.id || crypto.randomUUID(),
          requestId,
          Number(revision.at) || Date.now(),
          str(revision.author, 'Someone'),
          str(revision.summary),
          JSON.stringify(revision.snapshot ?? null)
        );
      });
    }
  });
}

module.exports = {
  // whole-graph (bulk paths only)
  load,
  save: writeFullDatabase,
  writeFullDatabase,

  // collections
  listCollections,
  getCollection,
  getCollectionMeta,
  findByShareToken,
  shareMetaForToken,
  createCollection,
  renameCollection,
  deleteCollection,
  setShare,
  setVariables,
  replaceContents,

  // requests
  getRequest,
  collectionIdOfRequest,
  insertRequest,
  updateRequest,
  deleteRequest,

  // workspaces
  listWorkspaces,
  createWorkspace,
  renameWorkspace,
  deleteWorkspace,

  // activity
  listComments,
  insertComment,
  patchComment,
  removeComment,
  listRevisions,
  getRevision,
  insertRevision,
  dropActivity,

  close,
  DB_PATH,
};
