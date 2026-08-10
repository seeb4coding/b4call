const express = require('express');
const store = require('../store');

const router = express.Router();

const DEFAULT_WORKSPACE = { id: 'default', name: 'Personal Workspace' };

// Always surface a "default" workspace so pre-existing collections have a home.
function listWorkspaces() {
  const stored = store.listWorkspaces();
  return stored.some((w) => w.id === 'default') ? stored : [DEFAULT_WORKSPACE, ...stored];
}

router.get('/', (req, res) => {
  res.json(listWorkspaces());
});

router.post('/', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'Workspace name is required' });
  res.status(201).json(store.createWorkspace(name.slice(0, 200)));
});

router.put('/:id', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'Workspace name is required' });
  if (req.params.id === 'default') {
    return res.status(400).json({ error: 'The default workspace cannot be renamed' });
  }

  const updated = store.renameWorkspace(req.params.id, name.slice(0, 200));
  if (!updated) return res.status(404).json({ error: 'Workspace not found' });
  res.json(updated);
});

// Deleting a workspace moves its collections back to the default workspace so
// nothing is silently destroyed.
router.delete('/:id', (req, res) => {
  if (req.params.id === 'default') {
    return res.status(400).json({ error: 'The default workspace cannot be deleted' });
  }
  store.deleteWorkspace(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
