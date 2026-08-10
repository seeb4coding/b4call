import { addHistory } from './state.js';
import { api } from './api.js';
import { VAR_PATTERN, scanRequestVars } from './vars.js';
import { applyAdvancedAuth } from './auth.js';
import { getProxyConfig } from './proxy-config.js';
import { resolveResponseRef } from './response-store.js';
import { applyCookies, captureSetCookies } from './cookie-jar.js';

// Resolve {{res:Name.body.path}} chaining refs used anywhere in the request
// and fold them into the env map so normal substitution picks them up.
function withChainVars(req, env) {
  const merged = { ...env };
  for (const name of scanRequestVars(req)) {
    if (name.startsWith('res:') && !(name in merged)) {
      const value = resolveResponseRef(name.slice('res:'.length));
      if (value !== undefined) merged[name] = value;
    }
  }
  return merged;
}

export function substituteVars(str, env) {
  return String(str ?? '').replace(VAR_PATTERN, (match, name) =>
    Object.prototype.hasOwnProperty.call(env, name) ? env[name] : match
  );
}

const enabledRows = (rows) => (rows || []).filter((r) => r.enabled && r.key);

export function buildProxyPayload(req, env) {
  const sub = (s) => substituteVars(s, env);

  let url = sub(req.url);
  // Substitute :name path parameters before the URL is used.
  const pathVars = req.pathVars || [];
  if (pathVars.length) {
    const map = {};
    pathVars.forEach((r) => {
      if (r.key) map[r.key] = sub(r.value);
    });
    url = url.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(map, name) ? encodeURIComponent(map[name]) : match
    );
  }
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;

  const query = enabledRows(req.params).map(
    (r) => `${encodeURIComponent(sub(r.key))}=${encodeURIComponent(sub(r.value))}`
  );

  const headers = {};
  for (const r of enabledRows(req.headers)) headers[sub(r.key)] = sub(r.value);
  const hasHeader = (name) =>
    Object.keys(headers).some((k) => k.toLowerCase() === name);

  const auth = req.auth || { type: 'none' };
  if (auth.type === 'bearer' && auth.token) {
    headers['Authorization'] = `Bearer ${sub(auth.token)}`;
  } else if (auth.type === 'basic') {
    headers['Authorization'] = `Basic ${btoa(`${sub(auth.username)}:${sub(auth.password)}`)}`;
  } else if (auth.type === 'apikey' && auth.key) {
    if (auth.addTo === 'query') {
      query.push(`${encodeURIComponent(sub(auth.key))}=${encodeURIComponent(sub(auth.value))}`);
    } else {
      headers[sub(auth.key)] = sub(auth.value);
    }
  }

  if (query.length) url += (url.includes('?') ? '&' : '?') + query.join('&');

  let body = null;
  if (req.bodyType === 'json') {
    body = sub(req.bodyRaw);
    if (!hasHeader('content-type')) headers['Content-Type'] = 'application/json';
  } else if (req.bodyType === 'text') {
    body = sub(req.bodyRaw);
    if (!hasHeader('content-type')) headers['Content-Type'] = 'text/plain';
  } else if (req.bodyType === 'form-urlencoded') {
    body = enabledRows(req.bodyForm)
      .map((r) => `${encodeURIComponent(sub(r.key))}=${encodeURIComponent(sub(r.value))}`)
      .join('&');
    if (!hasHeader('content-type')) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
  } else if (req.bodyType === 'form-data') {
    // The proxy assembles the multipart payload (fields + real files).
    body = {
      fields: enabledRows(req.bodyForm).map((r) => ({
        name: sub(r.key),
        value: sub(r.value),
      })),
      files: (req.bodyFiles || []).map((f) => ({
        name: f.name,
        filename: f.filename,
        contentType: f.contentType,
        dataBase64: f.dataBase64,
      })),
    };
  } else if (req.bodyType === 'graphql') {
    let variables = {};
    const rawVars = sub(req.graphqlVariables || '').trim();
    if (rawVars) {
      try {
        variables = JSON.parse(rawVars);
      } catch {
        throw new Error('GraphQL variables are not valid JSON');
      }
    }
    body = JSON.stringify({ query: sub(req.graphqlQuery || ''), variables });
    if (!hasHeader('content-type')) headers['Content-Type'] = 'application/json';
  }

  return { method: req.method, url, headers, body };
}

export async function sendRequest(req, vars) {
  const env = withChainVars(req, vars || {});
  const payload = buildProxyPayload(req, env);
  if (!payload.url) throw new Error('Enter a URL first');

  // Auth types that need crypto or a token exchange are applied here.
  await applyAdvancedAuth(payload, req.auth || {}, (s) => substituteVars(s, env));

  // Replay stored cookies for this host.
  applyCookies(payload);

  // Per-request settings + workspace proxy config travel with the payload.
  payload.settings = req.settings || undefined;
  const proxyCfg = getProxyConfig();
  if (proxyCfg.enabled && proxyCfg.url) payload.proxy = proxyCfg.url;

  // Strip file contents (large base64 blobs) out of history entries.
  const { bodyFiles, ...historyReq } = req;
  addHistory({ method: payload.method, url: payload.url, at: Date.now(), request: historyReq });

  const result = await api.proxy(payload);
  if (result && Array.isArray(result.setCookies)) {
    captureSetCookies(payload.url, result.setCookies);
  }
  return result;
}
