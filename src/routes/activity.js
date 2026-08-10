const express = require('express');
const store = require('../store');
const activityLog = require('../activity-log');

const router = express.Router();

// Comments and revision history for a single request. Reads are public (the
// same audience that can read a shared collection), writes carry an author name
// supplied by the client — this app has no accounts, so the name is a label,
// not an identity claim.

router.get('/:requestId', (req, res) => {
  res.json({
    comments: activityLog.listComments(req.params.requestId),
    // Snapshots are big; the list view only needs the metadata.
    revisions: activityLog.listRevisionMeta(req.params.requestId),
  });
});

router.get('/:requestId/revisions/:revisionId', (req, res) => {
  const revision = activityLog.getRevision(req.params.requestId, req.params.revisionId);
  if (!revision) return res.status(404).json({ error: 'Revision not found' });
  res.json(revision);
});

// The live request, so the client can diff "now" against an old revision.
router.get('/:requestId/current', (req, res) => {
  const found = store.getRequest(req.params.requestId);
  if (!found) return res.status(404).json({ error: 'Request not found' });
  res.json({ request: found.request, collectionId: found.collectionId });
});

router.post('/:requestId/comments', (req, res) => {
  const text = String(req.body?.text ?? '').trim();
  if (!text) return res.status(400).json({ error: 'Comment text is required' });

  if (!store.getRequest(req.params.requestId)) {
    return res.status(404).json({ error: 'Request not found' });
  }

  res.status(201).json(
    activityLog.addComment(req.params.requestId, {
      author: req.body?.author,
      text,
      anchor: req.body?.anchor,
    })
  );
});

router.put('/:requestId/comments/:commentId', (req, res) => {
  const comment = activityLog.updateComment(req.params.requestId, req.params.commentId, {
    text: req.body?.text,
    resolved: req.body?.resolved,
  });
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  res.json(comment);
});

router.delete('/:requestId/comments/:commentId', (req, res) => {
  if (!activityLog.deleteComment(req.params.requestId, req.params.commentId)) {
    return res.status(404).json({ error: 'Comment not found' });
  }
  res.json({ ok: true });
});

module.exports = router;
