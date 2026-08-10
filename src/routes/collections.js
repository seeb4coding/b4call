const express = require('express');
const store = require('../store');
const { sanitizeRequest, sanitizeRows, sanitizeFolders } = require('../request-model');
const activityLog = require('../activity-log');
const { notifyChanged } = require('./realtime');

const router = express.Router();

// The client sends a display name so comments and revisions have an author.
function authorOf(req) {
  return String(req.get('x-b4call-author') || req.body?._author || '').slice(0, 40) || 'Someone';
}

// Change events only go out on collections that actually have a share link.
function announce(collectionId, change) {
  const meta = store.getCollectionMeta(collectionId);
  if (meta?.shareToken) notifyChanged(meta.shareToken, change);
}

router.get('/', (req, res) => {
  const workspaceId = req.query.workspaceId;
  res.json(
    typeof workspaceId === 'string' && workspaceId
      ? store.listCollections(workspaceId)
      : store.listCollections()
  );
});

router.post('/', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'Collection name is required' });

  const workspaceId =
    typeof req.body?.workspaceId === 'string' && req.body.workspaceId
      ? req.body.workspaceId.slice(0, 64)
      : 'default';

  res.status(201).json(store.createCollection({ name: name.slice(0, 200), workspaceId }));
});

router.put('/:id', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'Collection name is required' });

  const updated = store.renameCollection(req.params.id, name.slice(0, 200));
  if (!updated) return res.status(404).json({ error: 'Collection not found' });
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  if (!store.deleteCollection(req.params.id)) {
    return res.status(404).json({ error: 'Collection not found' });
  }
  res.json({ ok: true });
});

// Bulk update: replace folders and/or the full ordered requests array in one
// transaction. Used by import, reorder, move-to-folder, and folder management.
router.put('/:id/bulk', (req, res) => {
  const { name, folders, requests, variables } = req.body ?? {};

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

  const ok = store.replaceContents(req.params.id, {
    name,
    folders: Array.isArray(folders) ? sanitizeFolders(folders) : undefined,
    requests: sanitizedRequests,
    variables: Array.isArray(variables) ? sanitizeRows(variables) : undefined,
  });
  if (!ok) return res.status(404).json({ error: 'Collection not found' });

  announce(req.params.id, { by: authorOf(req), action: 'reorganised the collection' });
  res.json(store.getCollection(req.params.id));
});

router.put('/:id/variables', (req, res) => {
  const variables = sanitizeRows(req.body?.variables);
  if (!store.setVariables(req.params.id, variables)) {
    return res.status(404).json({ error: 'Collection not found' });
  }
  announce(req.params.id, { by: authorOf(req), action: 'updated the collection variables' });
  res.json({ variables });
});

router.post('/:id/requests', (req, res) => {
  const { request, error } = sanitizeRequest(req.body);
  if (error) return res.status(400).json({ error });

  const created = store.insertRequest(req.params.id, request);
  if (!created) return res.status(404).json({ error: 'Collection not found' });

  announce(req.params.id, {
    by: authorOf(req),
    action: 'added',
    requestId: created.id,
    requestName: created.name,
  });
  res.status(201).json(created);
});

router.put('/:id/requests/:requestId', (req, res) => {
  const found = store.getRequest(req.params.requestId);
  if (!found || found.collectionId !== req.params.id) {
    return res.status(404).json({ error: 'Request not found' });
  }

  const { request, error } = sanitizeRequest(req.body, found.request.id);
  if (error) return res.status(400).json({ error });

  const updated = store.updateRequest(req.params.id, request);
  if (!updated) return res.status(404).json({ error: 'Request not found' });

  // Keep the pre-save state so the change can be reviewed and rolled back.
  activityLog.recordRevision(found.request.id, found.request, request, authorOf(req));
  announce(req.params.id, {
    by: authorOf(req),
    action: 'updated',
    requestId: request.id,
    requestName: request.name,
  });
  res.json(request);
});

router.delete('/:id/requests/:requestId', (req, res) => {
  const found = store.getRequest(req.params.requestId);
  if (!found || found.collectionId !== req.params.id) {
    return res.status(404).json({ error: 'Request not found' });
  }
  if (!store.deleteRequest(req.params.id, req.params.requestId)) {
    return res.status(404).json({ error: 'Request not found' });
  }

  announce(req.params.id, {
    by: authorOf(req),
    action: 'deleted',
    requestId: found.request.id,
    requestName: found.request.name,
  });
  res.json({ ok: true });
});

module.exports = router;
