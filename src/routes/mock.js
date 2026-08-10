const express = require('express');
const store = require('../store');

const router = express.Router();

function pathnameOf(rawUrl) {
  try {
    const withProto = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    return new URL(withProto).pathname.replace(/\/+$/, '') || '/';
  } catch {
    const noQuery = String(rawUrl || '').split('?')[0];
    const afterHost = noQuery.replace(/^https?:\/\/[^/]+/i, '');
    return (afterHost || '/').replace(/\/+$/, '') || '/';
  }
}

// Any method under /mock/:collectionId/* is answered from a saved example whose
// request matches the method + path. Example selection: ?example=<name|id>.
router.all('/:collectionId/*', (req, res) => {
  const collection = store.getCollection(req.params.collectionId);
  if (!collection) {
    return res.status(404).json({ error: 'Mock collection not found' });
  }

  const wantedPath = ('/' + (req.params[0] || '')).replace(/\/+$/, '') || '/';
  const wantedMethod = req.method.toUpperCase();

  const candidates = (collection.requests || []).filter((r) => {
    if ((r.method || 'GET').toUpperCase() !== wantedMethod) return false;
    return pathnameOf(r.url) === wantedPath;
  });

  const request = candidates.find((r) => (r.examples || []).length > 0);
  if (!request) {
    return res.status(404).json({
      error: `No example for ${wantedMethod} ${wantedPath} in "${collection.name}"`,
    });
  }

  const wanted = req.query.example;
  const examples = request.examples;
  const example =
    (wanted && examples.find((e) => e.id === wanted || e.name === wanted)) || examples[0];

  Object.entries(example.headers || {}).forEach(([key, value]) => {
    if (!/^(content-length|transfer-encoding|connection)$/i.test(key)) {
      res.setHeader(key, value);
    }
  });
  if (example.contentType && !res.getHeader('content-type')) {
    res.setHeader('Content-Type', example.contentType);
  }
  res.status(example.status || 200).send(example.body ?? '');
});

module.exports = router;
