const express = require('express');
const crypto = require('crypto');
const store = require('../store');
const { sanitizeRequest, sanitizeRows, sanitizeFolders } = require('../request-model');
const activityLog = require('../activity-log');
const { notifyChanged } = require('./realtime');

const router = express.Router();

const SHARE_MODES = ['readonly', 'edit'];

function authorOf(req) {
  return String(req.get('x-b4call-author') || req.body?._author || '').slice(0, 40) || 'A guest';
}

// Create (or update the mode of) a share link for a collection.
router.post('/', (req, res) => {
  const { collectionId, mode } = req.body ?? {};
  if (!SHARE_MODES.includes(mode)) {
    return res.status(400).json({ error: 'mode must be "readonly" or "edit"' });
  }

  const collection = store.getCollectionMeta(collectionId);
  if (!collection) return res.status(404).json({ error: 'Collection not found' });

  const token = collection.shareToken || crypto.randomBytes(9).toString('base64url');
  store.setShare(collectionId, token, mode);
  res.json({ token, mode });
});

// Public: anyone with the link can read the collection.
router.get('/:token', (req, res) => {
  const collection = store.findByShareToken(req.params.token);
  if (!collection) return res.status(404).json({ error: 'Shared collection not found' });

  res.json({
    mode: collection.shareMode,
    collection: {
      id: collection.id,
      name: collection.name,
      variables: collection.variables || [],
      folders: collection.folders || [],
      requests: collection.requests,
    },
  });
});

// Guard for the mutation endpoints below: only "edit" links may write.
function requireEditable(req, res, next) {
  const collection = store.shareMetaForToken(req.params.token);
  if (!collection) return res.status(404).json({ error: 'Shared collection not found' });
  if (collection.shareMode !== 'edit') {
    return res.status(403).json({ error: 'This shared collection is read-only' });
  }
  req.collection = collection;
  next();
}

router.put('/:token/bulk', requireEditable, (req, res) => {
  const { folders, requests, variables } = req.body ?? {};

  let sanitizedRequests;
  if (Array.isArray(requests)) {
    sanitizedRequests = [];
    for (const r of requests) {
      const existingId = typeof r?.id === 'string' && r.id ? r.id.slice(0, 64) : undefined;
      const { request, error } = sanitizeRequest(r, existingId);
      if (error) return res.status(400).json({ error });
      sanitizedRequests.push(request);
    }
  }

  store.replaceContents(req.collection.id, {
    folders: Array.isArray(folders) ? sanitizeFolders(folders) : undefined,
    requests: sanitizedRequests,
    variables: Array.isArray(variables) ? sanitizeRows(variables) : undefined,
  });
  notifyChanged(req.params.token, { by: authorOf(req), action: 'reorganised the collection' });
  res.json({ ok: true });
});

router.put('/:token/variables', requireEditable, (req, res) => {
  const variables = sanitizeRows(req.body?.variables);
  store.setVariables(req.collection.id, variables);
  notifyChanged(req.params.token, { by: authorOf(req), action: 'updated the collection variables' });
  res.json({ variables });
});

router.post('/:token/requests', requireEditable, (req, res) => {
  const { request, error } = sanitizeRequest(req.body);
  if (error) return res.status(400).json({ error });

  const created = store.insertRequest(req.collection.id, request);
  notifyChanged(req.params.token, {
    by: authorOf(req),
    action: 'added',
    requestId: created.id,
    requestName: created.name,
  });
  res.status(201).json(created);
});

router.put('/:token/requests/:requestId', requireEditable, (req, res) => {
  const found = store.getRequest(req.params.requestId);
  if (!found || found.collectionId !== req.collection.id) {
    return res.status(404).json({ error: 'Request not found' });
  }

  const { request, error } = sanitizeRequest(req.body, found.request.id);
  if (error) return res.status(400).json({ error });

  store.updateRequest(req.collection.id, request);
  activityLog.recordRevision(found.request.id, found.request, request, authorOf(req));
  notifyChanged(req.params.token, {
    by: authorOf(req),
    action: 'updated',
    requestId: request.id,
    requestName: request.name,
  });
  res.json(request);
});

router.delete('/:token/requests/:requestId', requireEditable, (req, res) => {
  const found = store.getRequest(req.params.requestId);
  if (!found || found.collectionId !== req.collection.id) {
    return res.status(404).json({ error: 'Request not found' });
  }
  store.deleteRequest(req.collection.id, req.params.requestId);

  notifyChanged(req.params.token, {
    by: authorOf(req),
    action: 'deleted',
    requestId: found.request.id,
    requestName: found.request.name,
  });
  res.json({ ok: true });
});

module.exports = router;
