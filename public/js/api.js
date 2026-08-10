import { getIdentity } from './identity.js';

async function call(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      // Labels the author of revisions and change notifications. Not auth.
      'x-b4call-author': getIdentity().name,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

const json = (payload) => JSON.stringify(payload);

export const api = {
  listCollections: (workspaceId) =>
    call(`/api/collections${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`),
  createCollection: (name, workspaceId) =>
    call('/api/collections', { method: 'POST', body: json({ name, workspaceId }) }),
  renameCollection: (id, name) =>
    call(`/api/collections/${id}`, { method: 'PUT', body: json({ name }) }),
  deleteCollection: (id) =>
    call(`/api/collections/${id}`, { method: 'DELETE' }),

  createRequest: (collectionId, request) =>
    call(`/api/collections/${collectionId}/requests`, { method: 'POST', body: json(request) }),
  updateRequest: (collectionId, requestId, request) =>
    call(`/api/collections/${collectionId}/requests/${requestId}`, { method: 'PUT', body: json(request) }),
  deleteRequest: (collectionId, requestId) =>
    call(`/api/collections/${collectionId}/requests/${requestId}`, { method: 'DELETE' }),

  bulkUpdate: (collectionId, payload) =>
    call(`/api/collections/${collectionId}/bulk`, { method: 'PUT', body: json(payload) }),
  sharedBulkUpdate: (token, payload) =>
    call(`/api/share/${token}/bulk`, { method: 'PUT', body: json(payload) }),

  updateCollectionVariables: (collectionId, variables) =>
    call(`/api/collections/${collectionId}/variables`, { method: 'PUT', body: json({ variables }) }),
  sharedUpdateVariables: (token, variables) =>
    call(`/api/share/${token}/variables`, { method: 'PUT', body: json({ variables }) }),

  share: (collectionId, mode) =>
    call('/api/share', { method: 'POST', body: json({ collectionId, mode }) }),
  getShared: (token) => call(`/api/share/${token}`),
  sharedCreateRequest: (token, request) =>
    call(`/api/share/${token}/requests`, { method: 'POST', body: json(request) }),
  sharedUpdateRequest: (token, requestId, request) =>
    call(`/api/share/${token}/requests/${requestId}`, { method: 'PUT', body: json(request) }),
  sharedDeleteRequest: (token, requestId) =>
    call(`/api/share/${token}/requests/${requestId}`, { method: 'DELETE' }),

  proxy: (payload) => call('/api/proxy', { method: 'POST', body: json(payload) }),
  oauthToken: (payload) => call('/api/proxy/oauth-token', { method: 'POST', body: json(payload) }),

  getActivity: (requestId) => call(`/api/activity/${requestId}`),
  getRevision: (requestId, revisionId) =>
    call(`/api/activity/${requestId}/revisions/${revisionId}`),
  getCurrentRequest: (requestId) => call(`/api/activity/${requestId}/current`),
  addComment: (requestId, payload) =>
    call(`/api/activity/${requestId}/comments`, { method: 'POST', body: json(payload) }),
  updateComment: (requestId, commentId, payload) =>
    call(`/api/activity/${requestId}/comments/${commentId}`, { method: 'PUT', body: json(payload) }),
  deleteComment: (requestId, commentId) =>
    call(`/api/activity/${requestId}/comments/${commentId}`, { method: 'DELETE' }),

  listWorkspaces: () => call('/api/workspaces'),
  createWorkspace: (name) =>
    call('/api/workspaces', { method: 'POST', body: json({ name }) }),
  renameWorkspace: (id, name) =>
    call(`/api/workspaces/${id}`, { method: 'PUT', body: json({ name }) }),
  deleteWorkspace: (id) =>
    call(`/api/workspaces/${id}`, { method: 'DELETE' }),
};
