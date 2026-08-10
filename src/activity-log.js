const crypto = require('crypto');
const store = require('./store');

// Per-request comments and version history. These live in their own SQLite
// tables (comments, revisions) keyed by request id, so a request keeps its
// history when it moves between folders, and a 400-request collection does not
// have to be read to answer "what changed here?".

const MAX_REVISIONS = 30;

// Fields worth naming in a change summary.
const TRACKED_FIELDS = [
  'name', 'method', 'url', 'bodyType', 'bodyRaw', 'graphqlQuery', 'graphqlVariables',
  'preRequestScript', 'testsScript', 'docs', 'folderId',
];

const TRACKED_STRUCTURES = [
  'params', 'headers', 'bodyForm', 'pathVars', 'capture', 'tests',
  'auth', 'settings', 'tags', 'examples',
];

function summarizeChange(previous, next) {
  if (!previous) return 'created';
  const changed = [];
  for (const field of [...TRACKED_FIELDS, ...TRACKED_STRUCTURES]) {
    if (JSON.stringify(previous[field]) !== JSON.stringify(next[field])) changed.push(field);
  }
  if (changed.length === 0) return 'saved with no field changes';
  return `changed ${changed.slice(0, 6).join(', ')}${changed.length > 6 ? `, +${changed.length - 6} more` : ''}`;
}

function activityOf(requestId) {
  return {
    comments: store.listComments(requestId),
    revisions: store.listRevisions(requestId, { withSnapshot: true }),
  };
}

// Records the PREVIOUS state of a request before an update overwrites it, so
// "restore" always has something to go back to.
function recordRevision(requestId, previousRequest, nextRequest, author) {
  if (!requestId || !previousRequest) return null;
  return store.insertRevision(
    requestId,
    {
      id: crypto.randomUUID(),
      at: Date.now(),
      author: String(author ?? '').slice(0, 40) || 'Someone',
      summary: summarizeChange(previousRequest, nextRequest || previousRequest),
      snapshot: previousRequest,
    },
    MAX_REVISIONS
  );
}

function listRevisionMeta(requestId) {
  return store.listRevisions(requestId);
}

function getRevision(requestId, revisionId) {
  return store.getRevision(requestId, revisionId);
}

function listComments(requestId) {
  return store.listComments(requestId);
}

function addComment(requestId, { author, text, anchor }) {
  return store.insertComment(requestId, {
    id: crypto.randomUUID(),
    at: Date.now(),
    author: String(author ?? '').slice(0, 40) || 'Someone',
    text: String(text ?? '').slice(0, 4000),
    anchor: anchor ? String(anchor).slice(0, 80) : null,
    resolved: false,
  });
}

function updateComment(requestId, commentId, patch) {
  return store.patchComment(requestId, commentId, patch);
}

function deleteComment(requestId, commentId) {
  return store.removeComment(requestId, commentId);
}

function dropActivity(requestId) {
  store.dropActivity(requestId);
}

module.exports = {
  activityOf,
  recordRevision,
  listRevisionMeta,
  getRevision,
  listComments,
  addComment,
  updateComment,
  deleteComment,
  dropActivity,
  summarizeChange,
  MAX_REVISIONS,
};
