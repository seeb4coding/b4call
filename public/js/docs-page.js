// Renders a published, read-only API reference for a shared collection.
// Everything comes from the same /api/share/:token payload the app uses, so a
// docs link never exposes more than the share link already does.

import { renderMarkdown } from './markdown.js';
import { generateSnippets } from './codegen.js';
import { copyText } from './clipboard.js';
import { toast } from './modal.js';
import { hydrateIcons, iconSvg } from './icons.js';
import { THEMES, DEFAULT_THEME, applyThemeAttributes } from './themes.js';

const $ = (sel) => document.querySelector(sel);

const token = location.pathname.match(/^\/docs\/([\w-]+)/)?.[1] || '';

let collection = null;
let variableMap = {};

function substitute(text) {
  return String(text ?? '').replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(variableMap, name) ? variableMap[name] : match
  );
}

/* ---------------- structure ---------------- */

function folderPath(folderId) {
  const names = [];
  let current = (collection.folders || []).find((f) => f.id === folderId);
  let guard = 0;
  while (current && guard < 10) {
    names.unshift(current.name);
    current = (collection.folders || []).find((f) => f.id === current.parentId);
    guard += 1;
  }
  return names;
}

function groupRequests(filter) {
  const needle = filter.trim().toLowerCase();
  const groups = new Map();
  (collection.requests || []).forEach((request) => {
    if (
      needle &&
      !`${request.name} ${request.url} ${request.method} ${(request.tags || []).join(' ')}`
        .toLowerCase()
        .includes(needle)
    ) {
      return;
    }
    const path = folderPath(request.folderId);
    const key = path.length ? path.join(' / ') : 'Ungrouped';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(request);
  });
  return groups;
}

const slug = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/* ---------------- rendering ---------------- */

function methodChip(method) {
  const chip = document.createElement('span');
  chip.className = `method-tag method-${method}`;
  chip.textContent = method;
  return chip;
}

function rowsTable(rows, headers) {
  const enabled = (rows || []).filter((r) => r && r.enabled !== false && r.key);
  if (!enabled.length) return null;
  const table = document.createElement('table');
  table.className = 'docs-table';
  const head = document.createElement('tr');
  headers.forEach((text) => {
    const th = document.createElement('th');
    th.textContent = text;
    head.appendChild(th);
  });
  table.appendChild(head);
  enabled.forEach((row) => {
    const tr = document.createElement('tr');
    const key = document.createElement('td');
    key.className = 'docs-key';
    key.textContent = row.key;
    const value = document.createElement('td');
    value.textContent = row.value || '';
    tr.append(key, value);
    table.appendChild(tr);
  });
  return table;
}

function sectionTitle(text) {
  const el = document.createElement('h4');
  el.className = 'docs-section-title';
  el.textContent = text;
  return el;
}

function codeBlock(text, language = '') {
  const wrap = document.createElement('div');
  wrap.className = 'docs-code';
  const pre = document.createElement('pre');
  pre.textContent = text;
  const copy = document.createElement('button');
  copy.className = 'btn docs-copy';
  copy.textContent = 'Copy';
  copy.addEventListener('click', async () => {
    const ok = await copyText(text);
    toast(ok ? 'Copied' : 'Copy failed');
  });
  if (language) {
    const tag = document.createElement('span');
    tag.className = 'docs-code-lang';
    tag.textContent = language;
    wrap.appendChild(tag);
  }
  wrap.append(pre, copy);
  return wrap;
}

function describeAuth(auth) {
  if (!auth || auth.type === 'none') return null;
  const map = {
    bearer: 'Bearer token',
    basic: 'HTTP Basic',
    apikey: `API key in ${auth.addTo === 'query' ? 'a query parameter' : 'a header'}${auth.key ? ` (${auth.key})` : ''}`,
    oauth2: `OAuth 2.0 (${auth.grantType || 'client_credentials'})`,
    awssigv4: `AWS Signature v4 (${auth.service || 'execute-api'} in ${auth.region || 'us-east-1'})`,
    digest: 'HTTP Digest',
    jwt: `JWT bearer (${auth.algorithm || 'HS256'})`,
  };
  return map[auth.type] || auth.type;
}

function bodySample(request) {
  if (request.bodyType === 'json' || request.bodyType === 'text') {
    return request.bodyRaw ? [request.bodyRaw, request.bodyType === 'json' ? 'json' : 'text'] : null;
  }
  if (request.bodyType === 'graphql') {
    const vars = request.graphqlVariables ? `\n\n# variables\n${request.graphqlVariables}` : '';
    return [`${request.graphqlQuery || ''}${vars}`, 'graphql'];
  }
  if (request.bodyType === 'form-urlencoded' || request.bodyType === 'form-data') {
    const rows = (request.bodyForm || []).filter((r) => r.enabled !== false && r.key);
    if (!rows.length) return null;
    return [rows.map((r) => `${r.key}=${r.value}`).join('\n'), request.bodyType];
  }
  return null;
}

function statusClass(status) {
  if (status >= 200 && status < 300) return 'status-2xx';
  if (status >= 300 && status < 400) return 'status-3xx';
  if (status >= 400 && status < 500) return 'status-4xx';
  return 'status-5xx';
}

function requestCard(request) {
  const card = document.createElement('section');
  card.className = 'docs-endpoint';
  card.id = `req-${slug(request.name)}-${request.id.slice(0, 6)}`;

  const header = document.createElement('div');
  header.className = 'docs-endpoint-head';
  const title = document.createElement('h3');
  title.textContent = request.name;
  header.append(methodChip(request.method), title);

  if ((request.tags || []).length) {
    const tags = document.createElement('span');
    tags.className = 'docs-tags';
    tags.textContent = request.tags.map((t) => `#${t}`).join(' ');
    header.appendChild(tags);
  }
  card.appendChild(header);

  const url = document.createElement('div');
  url.className = 'docs-url';
  url.textContent = substitute(request.url);
  card.appendChild(url);

  if (request.docs) {
    const docs = document.createElement('div');
    docs.className = 'docs-prose';
    docs.innerHTML = renderMarkdown(request.docs);
    card.appendChild(docs);
  }

  const pathVars = rowsTable(request.pathVars, ['Path variable', 'Example']);
  if (pathVars) {
    card.append(sectionTitle('Path variables'), pathVars);
  }

  const params = rowsTable(request.params, ['Query parameter', 'Example']);
  if (params) {
    card.append(sectionTitle('Query parameters'), params);
  }

  const headers = rowsTable(request.headers, ['Header', 'Value']);
  if (headers) {
    card.append(sectionTitle('Headers'), headers);
  }

  const auth = describeAuth(request.auth);
  if (auth) {
    const note = document.createElement('p');
    note.className = 'docs-auth';
    note.innerHTML = iconSvg('lock', 13);
    note.append(document.createTextNode(`Auth: ${auth}`));
    note.classList.add('has-icon');
    card.appendChild(note);
  }

  const body = bodySample(request);
  if (body) {
    card.append(sectionTitle('Request body'), codeBlock(substitute(body[0]), body[1]));
  }

  // Saved examples double as the response reference.
  if ((request.examples || []).length) {
    card.appendChild(sectionTitle('Example responses'));
    request.examples.forEach((example) => {
      const head = document.createElement('div');
      head.className = 'docs-example-head';
      const chip = document.createElement('span');
      chip.className = `status-chip ${statusClass(example.status)}`;
      chip.textContent = `${example.status} ${example.statusText || ''}`.trim();
      const name = document.createElement('span');
      name.className = 'docs-example-name';
      name.textContent = example.name;
      head.append(chip, name);
      card.appendChild(head);
      card.appendChild(codeBlock(prettyJson(example.body), example.contentType || ''));
    });
  }

  // cURL, always — the fastest way for a reader to try the endpoint.
  try {
    const snippets = generateSnippets(buildPayload(request));
    card.append(sectionTitle('Try it'), codeBlock(snippets.curl, 'curl'));
  } catch {
    /* a request with an unusable URL just doesn't get a snippet */
  }

  return card;
}

function prettyJson(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return String(text ?? '');
  }
}

// A trimmed-down version of the app's payload builder — enough for a snippet.
function buildPayload(request) {
  let url = substitute(request.url);
  (request.pathVars || []).forEach((row) => {
    if (row.key) url = url.replace(new RegExp(`:${row.key}\\b`, 'g'), substitute(row.value) || `:${row.key}`);
  });
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;

  const query = (request.params || [])
    .filter((r) => r.enabled !== false && r.key)
    .map((r) => `${encodeURIComponent(substitute(r.key))}=${encodeURIComponent(substitute(r.value))}`);
  if (query.length) url += (url.includes('?') ? '&' : '?') + query.join('&');

  const headers = {};
  (request.headers || [])
    .filter((r) => r.enabled !== false && r.key)
    .forEach((r) => {
      headers[substitute(r.key)] = substitute(r.value);
    });
  if (request.auth?.type === 'bearer') headers.Authorization = 'Bearer <token>';
  if (request.auth?.type === 'basic') headers.Authorization = 'Basic <credentials>';
  if (request.auth?.type === 'apikey' && request.auth.key && request.auth.addTo !== 'query') {
    headers[request.auth.key] = '<api-key>';
  }

  let body = null;
  const sample = bodySample(request);
  if (sample) {
    body = substitute(sample[0]);
    if (request.bodyType === 'json' && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    if (request.bodyType === 'graphql') {
      body = JSON.stringify({ query: substitute(request.graphqlQuery || ''), variables: {} });
      headers['Content-Type'] = 'application/json';
    }
  }

  return { method: request.method, url, headers, body };
}

function render(filter = '') {
  const main = $('#docs-main');
  const toc = $('#docs-toc');
  main.textContent = '';
  toc.textContent = '';

  const intro = document.createElement('section');
  intro.className = 'docs-intro';
  const heading = document.createElement('h1');
  heading.textContent = collection.name;
  intro.appendChild(heading);

  const count = (collection.requests || []).length;
  const meta = document.createElement('p');
  meta.className = 'docs-meta';
  meta.textContent = `${count} endpoint${count === 1 ? '' : 's'} · generated by B4Call`;
  intro.appendChild(meta);

  const vars = (collection.variables || []).filter((v) => v.enabled !== false && v.key);
  if (vars.length) {
    intro.appendChild(sectionTitle('Collection variables'));
    intro.appendChild(rowsTable(vars, ['Variable', 'Value']));
  }
  main.appendChild(intro);

  const groups = groupRequests(filter);
  if (groups.size === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-note';
    empty.textContent = filter ? 'No endpoints match that filter.' : 'This collection has no requests yet.';
    main.appendChild(empty);
    return;
  }

  groups.forEach((requests, groupName) => {
    const groupId = `group-${slug(groupName)}`;

    const tocGroup = document.createElement('div');
    tocGroup.className = 'docs-toc-group';
    const tocTitle = document.createElement('a');
    tocTitle.className = 'docs-toc-title';
    tocTitle.href = `#${groupId}`;
    tocTitle.textContent = groupName;
    tocGroup.appendChild(tocTitle);

    const groupHeading = document.createElement('h2');
    groupHeading.className = 'docs-group';
    groupHeading.id = groupId;
    groupHeading.textContent = groupName;
    main.appendChild(groupHeading);

    requests.forEach((request) => {
      const card = requestCard(request);
      main.appendChild(card);

      const link = document.createElement('a');
      link.className = 'docs-toc-link';
      link.href = `#${card.id}`;
      link.append(methodChip(request.method), document.createTextNode(request.name));
      tocGroup.appendChild(link);
    });

    toc.appendChild(tocGroup);
  });
}

/* ---------------- theme + boot ---------------- */

function initTheme() {
  const select = $('#docs-theme');
  THEMES.forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  });
  // Docs default to the light brand theme — made to be read and printed.
  const saved = localStorage.getItem('b4call-docs-theme') || DEFAULT_THEME;
  select.value = saved;
  applyThemeAttributes(saved);
  select.addEventListener('change', () => {
    localStorage.setItem('b4call-docs-theme', select.value);
    applyThemeAttributes(select.value);
  });
}

async function boot() {
  hydrateIcons();
  initTheme();
  $('#docs-print').addEventListener('click', () => window.print());
  $('#docs-open-app').href = `/s/${token}`;
  $('#docs-search').addEventListener('input', (e) => render(e.target.value));

  if (!token) {
    $('#docs-main').innerHTML =
      '<div class="empty-note">No collection in this URL. Open the docs from a share link.</div>';
    return;
  }

  try {
    const res = await fetch(`/api/share/${token}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load the collection');
    collection = data.collection;
    variableMap = Object.fromEntries(
      (collection.variables || [])
        .filter((v) => v.enabled !== false && v.key)
        .map((v) => [v.key, v.value])
    );
    document.title = `${collection.name} — API docs`;
    $('#docs-title').textContent = `${collection.name} — API docs`;
    render('');
  } catch (err) {
    $('#docs-main').innerHTML = `<div class="empty-note">⚠ ${err.message}</div>`;
  }
}

boot();
