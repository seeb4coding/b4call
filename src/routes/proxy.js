const express = require('express');
const crypto = require('crypto');
const { METHODS } = require('../request-model');
const { performRequest, MAX_RESPONSE_BYTES } = require('../http-client');

const router = express.Router();

// body may arrive as { fields: [{name,value}], files: [{name,filename,contentType,dataBase64}] }
// for form-data with file uploads — build the multipart payload server-side.
function buildMultipart({ fields = [], files = [] }) {
  const boundary = `----B4Call${crypto.randomBytes(8).toString('hex')}`;
  const parts = [];
  for (const field of fields) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"\r\n\r\n${field.value}\r\n`
      )
    );
  }
  for (const file of files) {
    parts.push(
      Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\n` +
            `Content-Type: ${file.contentType || 'application/octet-stream'}\r\n\r\n`
        ),
        Buffer.from(String(file.dataBase64 || ''), 'base64'),
        Buffer.from('\r\n'),
      ])
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

router.post('/', async (req, res) => {
  const { method, url, headers, body, settings, proxy } = req.body ?? {};

  if (!METHODS.includes(method)) {
    return res.status(400).json({ error: `Unsupported method: ${method}` });
  }

  let target;
  try {
    target = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return res.status(400).json({ error: 'Only http and https URLs are supported' });
  }

  const forwardHeaders = { ...(headers ?? {}) };
  let outgoingBody = null;
  if (!['GET', 'HEAD'].includes(method)) {
    if (typeof body === 'string' && body.length > 0) {
      outgoingBody = body;
    } else if (body && typeof body === 'object' && (body.fields || body.files)) {
      const multipart = buildMultipart(body);
      outgoingBody = multipart.body;
      forwardHeaders['Content-Type'] = multipart.contentType;
    }
  }

  const cfg = settings && typeof settings === 'object' ? settings : {};
  const clamp = (v, def, min, max) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.min(Math.max(Math.round(n), min), max);
  };

  try {
    const result = await performRequest({
      method,
      url: target.toString(),
      headers: forwardHeaders,
      body: outgoingBody,
      timeoutMs: clamp(cfg.timeoutMs, 30000, 0, 600000),
      followRedirects: cfg.followRedirects !== false,
      maxRedirects: clamp(cfg.maxRedirects, 5, 0, 20),
      rejectUnauthorized: cfg.rejectUnauthorized !== false,
      proxy: typeof proxy === 'string' ? proxy : '',
    });

    if (result.truncated && !result.isBinary) {
      result.body = `${result.body.slice(0, 100_000)}\n\n--- truncated: response larger than 10 MB ---`;
    }
    res.json(result);
  } catch (err) {
    const message =
      err.name === 'TimeoutError'
        ? `Request timed out after ${clamp(cfg.timeoutMs, 30000, 0, 600000)} ms`
        : `Could not reach ${target.hostname}: ${err.cause?.code || err.code || err.message}`;
    res.json({ error: message });
  }
});

// OAuth 2.0 token endpoint proxy — exchanges credentials for an access token
// server-side to avoid browser CORS on the token URL.
router.post('/oauth-token', async (req, res) => {
  const { tokenUrl, grantType, clientId, clientSecret, scope, username, password } = req.body ?? {};
  let target;
  try {
    target = new URL(tokenUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid token URL' });
  }

  const form = new URLSearchParams();
  form.set('grant_type', grantType || 'client_credentials');
  if (clientId) form.set('client_id', clientId);
  if (clientSecret) form.set('client_secret', clientSecret);
  if (scope) form.set('scope', scope);
  if (grantType === 'password') {
    form.set('username', username || '');
    form.set('password', password || '');
  }

  try {
    const result = await performRequest({
      method: 'POST',
      url: target.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: form.toString(),
      timeoutMs: 30000,
    });
    let parsed = {};
    try {
      parsed = JSON.parse(result.body);
    } catch {
      return res.status(502).json({ error: 'Token endpoint did not return JSON', raw: result.body.slice(0, 500) });
    }
    if (result.status >= 400) {
      return res.status(result.status).json({ error: parsed.error_description || parsed.error || 'Token request failed' });
    }
    res.json({ accessToken: parsed.access_token || '', tokenType: parsed.token_type || 'Bearer', expiresIn: parsed.expires_in || null, raw: parsed });
  } catch (err) {
    res.status(502).json({ error: `Token request failed: ${err.code || err.message}` });
  }
});

module.exports = { router, MAX_RESPONSE_BYTES };
