const crypto = require('crypto');

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const BODY_TYPES = ['none', 'json', 'text', 'form-urlencoded', 'form-data', 'graphql'];
const AUTH_TYPES = ['none', 'bearer', 'basic', 'apikey', 'oauth2', 'awssigv4', 'digest', 'jwt'];

// String fields an auth object may carry (union across all auth types).
const AUTH_STRING_FIELDS = [
  'token', 'username', 'password', 'key', 'value',
  'accessToken', 'tokenUrl', 'clientId', 'clientSecret', 'scope', 'grantType',
  'accessKeyId', 'secretAccessKey', 'region', 'service', 'sessionToken',
  'secret', 'algorithm', 'payload', 'headerPrefix',
];

function sanitizeRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && typeof r === 'object')
    .map((r) => ({
      enabled: r.enabled !== false,
      key: String(r.key ?? ''),
      value: String(r.value ?? ''),
    }));
}

function sanitizeAuth(auth) {
  const src = auth && typeof auth === 'object' ? auth : {};
  const type = AUTH_TYPES.includes(src.type) ? src.type : 'none';
  const out = {
    type,
    addTo: src.addTo === 'query' ? 'query' : 'header',
  };
  for (const field of AUTH_STRING_FIELDS) {
    out[field] = String(src[field] ?? '');
  }
  return out;
}

function sanitizeSettings(settings) {
  const src = settings && typeof settings === 'object' ? settings : {};
  const clampInt = (val, def, min, max) => {
    const n = Number(val);
    if (!Number.isFinite(n)) return def;
    return Math.min(Math.max(Math.round(n), min), max);
  };
  return {
    timeoutMs: clampInt(src.timeoutMs, 30000, 0, 600000),
    followRedirects: src.followRedirects !== false,
    maxRedirects: clampInt(src.maxRedirects, 5, 0, 20),
    rejectUnauthorized: src.rejectUnauthorized !== false,
  };
}

function sanitizeExamples(examples) {
  if (!Array.isArray(examples)) return [];
  return examples
    .filter((e) => e && typeof e === 'object')
    .slice(0, 50)
    .map((e) => ({
      id: typeof e.id === 'string' && e.id ? e.id.slice(0, 64) : crypto.randomUUID(),
      name: String(e.name ?? 'Example').slice(0, 200),
      status: Number.isFinite(Number(e.status)) ? Number(e.status) : 200,
      statusText: String(e.statusText ?? '').slice(0, 200),
      contentType: String(e.contentType ?? '').slice(0, 200),
      headers:
        e.headers && typeof e.headers === 'object' && !Array.isArray(e.headers)
          ? Object.fromEntries(
              Object.entries(e.headers)
                .slice(0, 100)
                .map(([k, v]) => [String(k).slice(0, 200), String(v).slice(0, 4000)])
            )
          : {},
      body: String(e.body ?? '').slice(0, 500000),
    }));
}

function sanitizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map((t) => String(t ?? '').trim()).filter(Boolean))]
    .slice(0, 30)
    .map((t) => t.slice(0, 40));
}

// Whitelists the fields a stored request may contain, so arbitrary client
// payloads can never grow the database schema.
function sanitizeRequest(input, existingId) {
  const src = input && typeof input === 'object' ? input : {};
  const name = String(src.name ?? '').trim();
  if (!name) {
    return { error: 'Request name is required' };
  }
  return {
    request: {
      id: existingId || crypto.randomUUID(),
      name: name.slice(0, 200),
      method: METHODS.includes(src.method) ? src.method : 'GET',
      url: String(src.url ?? ''),
      folderId:
        typeof src.folderId === 'string' && src.folderId
          ? src.folderId.slice(0, 64)
          : null,
      params: sanitizeRows(src.params),
      pathVars: sanitizeRows(src.pathVars),
      headers: sanitizeRows(src.headers),
      bodyType: BODY_TYPES.includes(src.bodyType) ? src.bodyType : 'none',
      bodyRaw: String(src.bodyRaw ?? ''),
      bodyForm: sanitizeRows(src.bodyForm),
      graphqlQuery: String(src.graphqlQuery ?? ''),
      graphqlVariables: String(src.graphqlVariables ?? ''),
      auth: sanitizeAuth(src.auth),
      capture: sanitizeRows(src.capture),
      tests: sanitizeRows(src.tests),
      preRequestScript: String(src.preRequestScript ?? '').slice(0, 100000),
      testsScript: String(src.testsScript ?? '').slice(0, 100000),
      settings: sanitizeSettings(src.settings),
      docs: String(src.docs ?? '').slice(0, 100000),
      tags: sanitizeTags(src.tags),
      favorite: src.favorite === true,
      examples: sanitizeExamples(src.examples),
    },
  };
}

function sanitizeFolders(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((f) => f && typeof f === 'object' && String(f.name ?? '').trim())
    .map((f) => ({
      id:
        typeof f.id === 'string' && f.id
          ? f.id.slice(0, 64)
          : crypto.randomUUID(),
      name: String(f.name).trim().slice(0, 200),
      parentId:
        typeof f.parentId === 'string' && f.parentId
          ? f.parentId.slice(0, 64)
          : null,
    }));
}

module.exports = {
  sanitizeRequest,
  sanitizeRows,
  sanitizeFolders,
  METHODS,
  BODY_TYPES,
  AUTH_TYPES,
};
