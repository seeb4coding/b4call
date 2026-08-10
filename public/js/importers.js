// Postman Collection v2.1 import/export and cURL import.

function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function looksLikeJson(text) {
  return /^\s*[\[{]/.test(String(text ?? ''));
}

function rowFromPostman(entry) {
  return {
    enabled: entry.disabled !== true,
    key: String(entry.key ?? ''),
    value: String(entry.value ?? ''),
  };
}

/* ---------------- Postman v2.1 → B4Call ---------------- */

function convertAuth(auth) {
  const none = { type: 'none' };
  if (!auth || !auth.type) return none;
  // Postman stores auth params either as [{key,value}] arrays or plain objects.
  const get = (section, key) => {
    if (Array.isArray(section)) {
      return String(section.find((e) => e.key === key)?.value ?? '');
    }
    return String(section?.[key] ?? '');
  };
  if (auth.type === 'bearer') {
    return { type: 'bearer', token: get(auth.bearer, 'token') };
  }
  if (auth.type === 'basic') {
    return {
      type: 'basic',
      username: get(auth.basic, 'username'),
      password: get(auth.basic, 'password'),
    };
  }
  if (auth.type === 'apikey') {
    return {
      type: 'apikey',
      key: get(auth.apikey, 'key'),
      value: get(auth.apikey, 'value'),
      addTo: get(auth.apikey, 'in') === 'query' ? 'query' : 'header',
    };
  }
  return none;
}

function parseQueryFromRaw(rawUrl) {
  const queryString = String(rawUrl).split('?')[1];
  if (!queryString) return [];
  return queryString.split('&').filter(Boolean).map((pair) => {
    const eq = pair.indexOf('=');
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const value = eq === -1 ? '' : pair.slice(eq + 1);
    return { enabled: true, key, value };
  });
}

function convertRequest(item, folderId) {
  const req =
    typeof item.request === 'string'
      ? { method: 'GET', url: item.request }
      : item.request || {};

  const rawUrl = typeof req.url === 'string' ? req.url : String(req.url?.raw ?? '');
  const urlBase = rawUrl.split('?')[0];

  const params =
    typeof req.url === 'object' && Array.isArray(req.url?.query)
      ? req.url.query.map(rowFromPostman)
      : parseQueryFromRaw(rawUrl);

  const headers = (req.header || []).map(rowFromPostman);

  let bodyType = 'none';
  let bodyRaw = '';
  let bodyForm = [];
  const body = req.body || {};
  if (body.mode === 'raw') {
    bodyRaw = String(body.raw ?? '');
    const language = body.options?.raw?.language;
    bodyType = language === 'json' || (!language && looksLikeJson(bodyRaw)) ? 'json' : 'text';
  } else if (body.mode === 'urlencoded') {
    bodyType = 'form-urlencoded';
    bodyForm = (body.urlencoded || []).map(rowFromPostman);
  } else if (body.mode === 'formdata') {
    bodyType = 'form-data';
    // File entries can't be imported (the export has no file content) — keep
    // them as disabled rows so the user sees they existed.
    bodyForm = (body.formdata || []).map((entry) =>
      entry.type === 'file'
        ? { enabled: false, key: String(entry.key ?? ''), value: '(file — re-attach after import)' }
        : rowFromPostman(entry)
    );
  }

  return {
    name: String(item.name || urlBase || 'Request'),
    method: String(req.method || 'GET').toUpperCase(),
    url: urlBase,
    folderId,
    params,
    headers,
    bodyType,
    bodyRaw,
    bodyForm,
    auth: convertAuth(req.auth),
  };
}

export function parsePostmanCollection(json) {
  if (!json || typeof json !== 'object' || !json.info || !Array.isArray(json.item)) {
    throw new Error(
      'This is not a Postman collection export. In Postman use Export → Collection v2.1.'
    );
  }

  const folders = [];
  const requests = [];

  function walk(items, parentId) {
    for (const item of items || []) {
      if (Array.isArray(item.item)) {
        const folder = { id: newId(), name: String(item.name || 'Folder'), parentId };
        folders.push(folder);
        walk(item.item, folder.id);
      } else if (item.request) {
        requests.push(convertRequest(item, parentId));
      }
    }
  }
  walk(json.item, null);

  const variables = (json.variable || [])
    .map(rowFromPostman)
    .filter((row) => row.key);

  return {
    name: String(json.info.name || 'Imported collection'),
    folders,
    requests,
    variables,
  };
}

/* ---------------- B4Call → Postman v2.1 ---------------- */

function authToPostman(auth) {
  if (!auth || auth.type === 'none') return undefined;
  if (auth.type === 'bearer') {
    return { type: 'bearer', bearer: [{ key: 'token', value: auth.token, type: 'string' }] };
  }
  if (auth.type === 'basic') {
    return {
      type: 'basic',
      basic: [
        { key: 'username', value: auth.username, type: 'string' },
        { key: 'password', value: auth.password, type: 'string' },
      ],
    };
  }
  if (auth.type === 'apikey') {
    return {
      type: 'apikey',
      apikey: [
        { key: 'key', value: auth.key, type: 'string' },
        { key: 'value', value: auth.value, type: 'string' },
        { key: 'in', value: auth.addTo === 'query' ? 'query' : 'header', type: 'string' },
      ],
    };
  }
  return undefined;
}

function requestToPostman(request) {
  const rows = (list) => (list || []).filter((row) => row.key);

  const query = rows(request.params).map((row) => ({
    key: row.key,
    value: row.value,
    disabled: !row.enabled,
  }));
  const activeQuery = query.filter((q) => !q.disabled);
  const rawUrl =
    request.url +
    (activeQuery.length
      ? `?${activeQuery.map((q) => `${q.key}=${q.value}`).join('&')}`
      : '');

  let body;
  if (request.bodyType === 'json' || request.bodyType === 'text') {
    body = {
      mode: 'raw',
      raw: request.bodyRaw,
      options: { raw: { language: request.bodyType === 'json' ? 'json' : 'text' } },
    };
  } else if (request.bodyType === 'form-urlencoded') {
    body = {
      mode: 'urlencoded',
      urlencoded: rows(request.bodyForm).map((row) => ({
        key: row.key,
        value: row.value,
        disabled: !row.enabled,
        type: 'text',
      })),
    };
  } else if (request.bodyType === 'form-data') {
    body = {
      mode: 'formdata',
      formdata: rows(request.bodyForm).map((row) => ({
        key: row.key,
        value: row.value,
        disabled: !row.enabled,
        type: 'text',
      })),
    };
  }

  const auth = authToPostman(request.auth);
  return {
    name: request.name,
    request: {
      method: request.method,
      header: rows(request.headers).map((row) => ({
        key: row.key,
        value: row.value,
        disabled: !row.enabled,
      })),
      url: query.length ? { raw: rawUrl, query } : rawUrl,
      ...(body ? { body } : {}),
      ...(auth ? { auth } : {}),
    },
    response: [],
  };
}

export function toPostmanCollection(collection) {
  const folderNodes = new Map();
  (collection.folders || []).forEach((folder) => {
    folderNodes.set(folder.id, { name: folder.name, item: [] });
  });

  const rootItems = [];
  (collection.folders || []).forEach((folder) => {
    const node = folderNodes.get(folder.id);
    const parent = folder.parentId ? folderNodes.get(folder.parentId) : null;
    (parent ? parent.item : rootItems).push(node);
  });
  (collection.requests || []).forEach((request) => {
    const node = requestToPostman(request);
    const parent = request.folderId ? folderNodes.get(request.folderId) : null;
    (parent ? parent.item : rootItems).push(node);
  });

  return {
    info: {
      _postman_id: collection.id,
      name: collection.name,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: rootItems,
    variable: (collection.variables || [])
      .filter((row) => row.enabled && row.key)
      .map((row) => ({ key: row.key, value: row.value })),
  };
}

/* ---------------- OpenAPI 3 / Swagger 2 → B4Call ---------------- */

const OPENAPI_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

function openApiBaseUrl(spec) {
  if (Array.isArray(spec.servers) && spec.servers[0]?.url) {
    return String(spec.servers[0].url).replace(/\/$/, '');
  }
  if (spec.host) {
    const scheme = (spec.schemes && spec.schemes[0]) || 'https';
    return `${scheme}://${spec.host}${spec.basePath || ''}`.replace(/\/$/, '');
  }
  return '';
}

// A tiny JSON sample generator from a schema (enough for request-body stubs).
function sampleFromSchema(schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 6) return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  const type = schema.type || (schema.properties ? 'object' : undefined);
  if (type === 'object' || schema.properties) {
    const out = {};
    Object.entries(schema.properties || {}).forEach(([key, prop]) => {
      out[key] = sampleFromSchema(prop, depth + 1);
    });
    return out;
  }
  if (type === 'array') return [sampleFromSchema(schema.items, depth + 1)].filter((v) => v !== null);
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'boolean') return false;
  if (type === 'string') return schema.format === 'date-time' ? new Date().toISOString() : 'string';
  return null;
}

function openApiBody(operation, spec) {
  // OpenAPI 3 requestBody
  const content = operation.requestBody?.content;
  if (content) {
    const json = content['application/json'];
    if (json) {
      const sample = json.example ?? sampleFromSchema(json.schema);
      return { bodyType: 'json', bodyRaw: JSON.stringify(sample ?? {}, null, 2), bodyForm: [] };
    }
    const form = content['application/x-www-form-urlencoded'];
    if (form?.schema?.properties) {
      return {
        bodyType: 'form-urlencoded',
        bodyRaw: '',
        bodyForm: Object.keys(form.schema.properties).map((key) => ({ enabled: true, key, value: '' })),
      };
    }
  }
  // Swagger 2 body parameter
  const bodyParam = (operation.parameters || []).find((p) => p.in === 'body');
  if (bodyParam) {
    return { bodyType: 'json', bodyRaw: JSON.stringify(sampleFromSchema(bodyParam.schema) ?? {}, null, 2), bodyForm: [] };
  }
  return { bodyType: 'none', bodyRaw: '', bodyForm: [] };
}

export function parseOpenApi(spec) {
  if (!spec || typeof spec !== 'object' || (!spec.openapi && !spec.swagger) || !spec.paths) {
    throw new Error('Not an OpenAPI 3 or Swagger 2 document (missing "openapi"/"swagger" and "paths").');
  }

  const baseUrl = openApiBaseUrl(spec);
  const folders = [];
  const folderByTag = new Map();
  const requests = [];

  const ensureFolder = (tag) => {
    if (!tag) return null;
    if (folderByTag.has(tag)) return folderByTag.get(tag);
    const folder = { id: newId(), name: tag, parentId: null };
    folders.push(folder);
    folderByTag.set(tag, folder.id);
    return folder.id;
  };

  Object.entries(spec.paths).forEach(([rawPath, pathItem]) => {
    const pathLevelParams = pathItem.parameters || [];
    OPENAPI_METHODS.forEach((method) => {
      const operation = pathItem[method];
      if (!operation || typeof operation !== 'object') return;

      const allParams = [...pathLevelParams, ...(operation.parameters || [])];
      const query = allParams
        .filter((p) => p.in === 'query')
        .map((p) => ({ enabled: p.required === true, key: p.name, value: '' }));
      const headers = allParams
        .filter((p) => p.in === 'header')
        .map((p) => ({ enabled: p.required === true, key: p.name, value: '' }));

      // Convert {param} path templating into :param.
      const path = rawPath.replace(/\{([^}]+)\}/g, ':$1');
      const { bodyType, bodyRaw, bodyForm } = openApiBody(operation, spec);
      const tag = (operation.tags && operation.tags[0]) || null;

      requests.push({
        name: operation.operationId || operation.summary || `${method.toUpperCase()} ${rawPath}`,
        method: method.toUpperCase(),
        url: `${baseUrl ? '{{baseUrl}}' : ''}${path}`,
        folderId: ensureFolder(tag),
        params: query,
        headers,
        bodyType,
        bodyRaw,
        bodyForm,
        auth: { type: 'none' },
        docs: operation.description || operation.summary || '',
        tags: operation.tags || [],
      });
    });
  });

  const variables = baseUrl ? [{ enabled: true, key: 'baseUrl', value: baseUrl }] : [];

  return {
    name: String(spec.info?.title || 'Imported API'),
    folders,
    requests,
    variables,
  };
}

export function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'export.json';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ---------------- cURL import ---------------- */

function tokenizeCurl(text) {
  const tokens = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && text[i + 1] === '"') {
        current += '"';
        i += 1;
      } else current += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current) tokens.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

export function parseCurl(text) {
  // Join bash (\), cmd (^) and PowerShell (`) line continuations.
  const cleaned = String(text).replace(/[\\^`]\r?\n/g, ' ').trim();
  if (!/^curl(\s|$)/i.test(cleaned)) {
    throw new Error('That does not look like a curl command');
  }
  const tokens = tokenizeCurl(cleaned).slice(1);

  let method = null;
  let url = '';
  const headers = [];
  const dataParts = [];
  const formRows = [];
  let user = null;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const next = () => tokens[(i += 1)] ?? '';
    if (token === '-X' || token === '--request') method = next().toUpperCase();
    else if (token === '-H' || token === '--header') {
      const header = next();
      const colon = header.indexOf(':');
      if (colon > 0) {
        headers.push({
          enabled: true,
          key: header.slice(0, colon).trim(),
          value: header.slice(colon + 1).trim(),
        });
      }
    } else if (['-d', '--data', '--data-raw', '--data-binary', '--data-urlencode'].includes(token)) {
      dataParts.push(next());
    } else if (token === '-F' || token === '--form') {
      const field = next();
      const eq = field.indexOf('=');
      if (eq > 0) {
        formRows.push({ enabled: true, key: field.slice(0, eq), value: field.slice(eq + 1) });
      }
    } else if (token === '-u' || token === '--user') user = next();
    else if (token === '--url') url = next();
    else if (['-o', '--output', '-A', '--user-agent', '-b', '--cookie', '-e', '--referer', '--connect-timeout', '-m', '--max-time'].includes(token)) {
      next(); // known flags with an argument we ignore
    } else if (!token.startsWith('-') && !url) url = token;
  }

  const data = dataParts.join('&');
  let bodyType = 'none';
  let bodyRaw = '';
  let bodyForm = [];
  if (formRows.length) {
    bodyType = 'form-data';
    bodyForm = formRows;
  } else if (data) {
    if (looksLikeJson(data)) {
      bodyType = 'json';
      bodyRaw = data;
    } else if (/^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(data)) {
      bodyType = 'form-urlencoded';
      bodyForm = data.split('&').map((pair) => {
        const eq = pair.indexOf('=');
        return { enabled: true, key: pair.slice(0, eq), value: pair.slice(eq + 1) };
      });
    } else {
      bodyType = 'text';
      bodyRaw = data;
    }
  }

  const urlBase = url.split('?')[0];
  const params = parseQueryFromRaw(url);

  let auth = { type: 'none' };
  if (user) {
    const colon = user.indexOf(':');
    auth = {
      type: 'basic',
      username: colon === -1 ? user : user.slice(0, colon),
      password: colon === -1 ? '' : user.slice(colon + 1),
    };
  }

  return {
    name: 'Imported from cURL',
    method: method || (bodyType !== 'none' ? 'POST' : 'GET'),
    url: urlBase,
    params,
    headers,
    bodyType,
    bodyRaw,
    bodyForm,
    auth,
  };
}
