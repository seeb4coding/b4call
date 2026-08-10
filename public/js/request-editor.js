import { createKvEditor } from './kv.js';
import { renderMarkdown } from './markdown.js';
import { iconEl, iconElFilled } from './icons.js';

const $ = (sel) => document.querySelector(sel);

export const paramsEditor = createKvEditor($('#params-editor'), { bulkEdit: true });
export const headersEditor = createKvEditor($('#headers-editor'), { bulkEdit: true });
export const bodyFormEditor = createKvEditor($('#body-form-editor'), {
  keyPlaceholder: 'field',
  valuePlaceholder: 'value',
  bulkEdit: true,
});
export const captureEditor = createKvEditor($('#capture-editor'), {
  keyPlaceholder: 'response path — e.g. data.token (or: status)',
  valuePlaceholder: 'save as variable — e.g. token',
});
export const testsEditor = createKvEditor($('#tests-editor'), {
  keyPlaceholder: 'status | body-contains | json path e.g. data.user.id',
  valuePlaceholder: 'expected value (empty = just must exist)',
});

// Files attached to a form-data body. Kept in memory only — file bytes are
// never stored in collections.
let bodyFiles = [];

// Folder the current request belongs to (not shown in the editor UI, but must
// survive a load → save round trip).
let currentFolderId = null;

// Fields carried through load → read that have no always-on input of their own.
let currentExamples = [];
let currentFavorite = false;
let pathVarValues = {};

const PATH_VAR_PATTERN = /:([A-Za-z_][A-Za-z0-9_]*)/g;

function detectPathVars(url) {
  const names = [];
  for (const match of String(url ?? '').matchAll(PATH_VAR_PATTERN)) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

export function renderPathVars() {
  const url = $('#url').value;
  const names = detectPathVars(url);
  const section = $('#path-vars-section');
  const editor = $('#path-vars-editor');
  const paramsTitle = $('#params-title');
  section.classList.toggle('hidden', names.length === 0);
  paramsTitle.classList.toggle('hidden', names.length === 0);
  if (names.length === 0) {
    editor.textContent = '';
    return;
  }
  editor.textContent = '';
  names.forEach((name) => {
    const row = document.createElement('div');
    row.className = 'kv-row';
    const label = document.createElement('span');
    label.className = 'path-var-name';
    label.textContent = `:${name}`;
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = `value for :${name}`;
    input.value = pathVarValues[name] ?? '';
    input.addEventListener('input', () => {
      pathVarValues[name] = input.value;
    });
    row.append(label, input);
    editor.appendChild(row);
  });
}

function readPathVars() {
  const names = detectPathVars($('#url').value);
  return names.map((name) => ({ enabled: true, key: name, value: pathVarValues[name] ?? '' }));
}

export function getExamples() {
  return [...currentExamples];
}

export function setExamples(examples) {
  currentExamples = Array.isArray(examples) ? [...examples] : [];
}

export function getFavorite() {
  return currentFavorite;
}

export function setFavorite(value) {
  currentFavorite = Boolean(value);
  renderFavoriteStar();
}

function renderFavoriteStar() {
  const btn = document.querySelector('#favorite-btn');
  if (!btn) return;
  btn.textContent = '';
  btn.appendChild(currentFavorite ? iconElFilled('star', 16) : iconEl('star', 16));
  btn.classList.toggle('active', currentFavorite);
}

function renderDocsPreview() {
  const preview = document.querySelector('#req-docs-preview');
  const src = document.querySelector('#req-docs');
  if (preview && src) preview.innerHTML = renderMarkdown(src.value);
}

function selectedBodyType() {
  return document.querySelector('input[name="bodyType"]:checked')?.value || 'none';
}

/* ---------------- body raw editor: gutter + JSON validation ---------------- */

function updateGutter() {
  const textarea = $('#body-raw');
  const gutter = $('#body-gutter');
  const lines = textarea.value.split('\n').length;
  gutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
  gutter.scrollTop = textarea.scrollTop;
}

function updateJsonStatus() {
  const statusEl = $('#json-status');
  if (selectedBodyType() !== 'json') {
    statusEl.textContent = '';
    return;
  }
  const text = $('#body-raw').value.trim();
  if (!text) {
    statusEl.textContent = '';
    return;
  }
  try {
    JSON.parse(text);
    statusEl.textContent = '✓ Valid JSON';
    statusEl.className = 'json-status ok';
  } catch (err) {
    statusEl.textContent = `✗ Invalid JSON: ${err.message.slice(0, 80)}`;
    statusEl.className = 'json-status bad';
  }
}

export function initBodyEditor() {
  const textarea = $('#body-raw');
  textarea.addEventListener('input', () => {
    updateGutter();
    updateJsonStatus();
  });
  textarea.addEventListener('scroll', () => {
    $('#body-gutter').scrollTop = textarea.scrollTop;
  });
  $('#beautify-btn').addEventListener('click', () => {
    try {
      textarea.value = JSON.stringify(JSON.parse(textarea.value), null, 2);
      updateGutter();
      updateJsonStatus();
    } catch {
      updateJsonStatus();
    }
  });
  $('#req-docs').addEventListener('input', renderDocsPreview);
  $('#url').addEventListener('input', renderPathVars);
  $('#favorite-btn').addEventListener('click', () => setFavorite(!currentFavorite));
  $('#add-file-btn').addEventListener('click', () => $('#file-picker').click());
  $('#file-picker').addEventListener('change', async (e) => {
    for (const file of e.target.files) {
      const dataBase64 = await readFileBase64(file);
      bodyFiles = [
        ...bodyFiles,
        { name: file.name.replace(/\.[^.]*$/, '') || 'file', filename: file.name, contentType: file.type, dataBase64 },
      ];
    }
    e.target.value = '';
    renderBodyFiles();
  });
  updateGutter();
}

function readFileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function renderBodyFiles() {
  const list = $('#body-files-list');
  list.textContent = '';
  bodyFiles.forEach((file, index) => {
    const row = document.createElement('div');
    row.className = 'file-row';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = file.name;
    nameInput.title = 'form field name';
    nameInput.addEventListener('input', () => {
      bodyFiles = bodyFiles.map((f, i) => (i === index ? { ...f, name: nameInput.value } : f));
    });

    const label = document.createElement('span');
    label.className = 'file-label';
    label.append(iconEl('paperclip', 13), document.createTextNode(file.filename));

    const remove = document.createElement('button');
    remove.className = 'icon-btn';
    remove.appendChild(iconEl('close', 13));
    remove.addEventListener('click', () => {
      bodyFiles = bodyFiles.filter((_, i) => i !== index);
      renderBodyFiles();
    });

    row.append(nameInput, label, remove);
    list.appendChild(row);
  });
}

export function updateBodyVisibility() {
  const type = selectedBodyType();
  $('#body-raw-wrap').classList.toggle('hidden', type !== 'json' && type !== 'text');
  $('#body-tools').classList.toggle('hidden', type !== 'json');
  $('#body-form-editor').classList.toggle('hidden', type !== 'form-urlencoded' && type !== 'form-data');
  $('#body-files').classList.toggle('hidden', type !== 'form-data');
  $('#body-graphql').classList.toggle('hidden', type !== 'graphql');
  if (type === 'json' || type === 'text') updateGutter();
  updateJsonStatus();
}

/* ---------------- auth ---------------- */

function authField(box, labelText, inputType, id, value, placeholder = '') {
  const label = document.createElement('label');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.type = inputType;
  input.id = id;
  input.value = value ?? '';
  input.placeholder = placeholder;
  label.appendChild(input);
  box.appendChild(label);
}

function authSelect(box, labelText, id, options, value) {
  const label = document.createElement('label');
  label.textContent = labelText;
  const sel = document.createElement('select');
  sel.id = id;
  options.forEach(([v, text]) => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = text;
    sel.appendChild(opt);
  });
  sel.value = value || options[0][0];
  label.appendChild(sel);
  box.appendChild(label);
}

export function renderAuthFields(auth = {}) {
  const box = $('#auth-fields');
  box.textContent = '';
  const type = $('#auth-type').value;

  if (type === 'bearer') {
    authField(box, 'Token', 'text', 'auth-token', auth.token, 'my-secret-token or {{token}}');
  } else if (type === 'jwt') {
    authField(box, 'Secret', 'text', 'auth-secret', auth.secret, 'signing secret or {{jwtSecret}}');
    authSelect(box, 'Algorithm', 'auth-algorithm', [['HS256', 'HS256'], ['HS384', 'HS384'], ['HS512', 'HS512']], auth.algorithm);
    authField(box, 'Payload (JSON)', 'text', 'auth-payload', auth.payload, '{ "sub": "123", "exp": 0 }');
    authField(box, 'Header prefix', 'text', 'auth-headerPrefix', auth.headerPrefix || 'Bearer', 'Bearer');
  } else if (type === 'basic') {
    authField(box, 'Username', 'text', 'auth-username', auth.username);
    authField(box, 'Password', 'password', 'auth-password', auth.password);
  } else if (type === 'digest') {
    authField(box, 'Username', 'text', 'auth-username', auth.username);
    authField(box, 'Password', 'password', 'auth-password', auth.password);
    const note = document.createElement('p');
    note.className = 'modal-note';
    note.textContent = 'Digest auth performs a challenge/response handshake automatically on send.';
    box.appendChild(note);
  } else if (type === 'apikey') {
    authField(box, 'Key name', 'text', 'auth-key', auth.key, 'X-API-Key');
    authField(box, 'Key value', 'text', 'auth-value', auth.value);
    authSelect(box, 'Add to', 'auth-addto', [['header', 'Header'], ['query', 'Query param']], auth.addTo);
  } else if (type === 'oauth2') {
    authSelect(box, 'Grant type', 'auth-grantType',
      [['client_credentials', 'Client Credentials'], ['password', 'Password'], ['authorization_code', 'Authorization Code (token)']],
      auth.grantType);
    authField(box, 'Access token URL', 'text', 'auth-tokenUrl', auth.tokenUrl, 'https://auth.example.com/oauth/token');
    authField(box, 'Client ID', 'text', 'auth-clientId', auth.clientId);
    authField(box, 'Client secret', 'password', 'auth-clientSecret', auth.clientSecret);
    authField(box, 'Scope', 'text', 'auth-scope', auth.scope, 'read write');
    authField(box, 'Username', 'text', 'auth-username', auth.username, '(password grant only)');
    authField(box, 'Password', 'password', 'auth-password', auth.password, '(password grant only)');
    authField(box, 'Access token', 'text', 'auth-accessToken', auth.accessToken, 'auto-fetched, or paste one');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'oauth-fetch-btn';
    btn.className = 'btn';
    btn.textContent = 'Get new access token';
    box.appendChild(btn);
  } else if (type === 'awssigv4') {
    authField(box, 'Access key ID', 'text', 'auth-accessKeyId', auth.accessKeyId);
    authField(box, 'Secret access key', 'password', 'auth-secretAccessKey', auth.secretAccessKey);
    authField(box, 'Session token', 'text', 'auth-sessionToken', auth.sessionToken, 'optional');
    authField(box, 'Region', 'text', 'auth-region', auth.region, 'us-east-1');
    authField(box, 'Service', 'text', 'auth-service', auth.service, 'execute-api');
  }
}

const AUTH_FIELD_IDS = [
  'token', 'username', 'password', 'key', 'value', 'accessToken', 'tokenUrl',
  'clientId', 'clientSecret', 'scope', 'grantType', 'accessKeyId',
  'secretAccessKey', 'region', 'service', 'sessionToken', 'secret',
  'algorithm', 'payload', 'headerPrefix',
];

function readAuth() {
  const type = $('#auth-type').value;
  const auth = { type, addTo: $('#auth-addto')?.value ?? 'header' };
  AUTH_FIELD_IDS.forEach((field) => {
    auth[field] = $(`#auth-${field}`)?.value ?? '';
  });
  return auth;
}

/* ---------------- load / read ---------------- */

export function setRequestName(name) {
  $('#request-name').textContent = name || 'Untitled request';
}

export function loadRequestIntoEditor(req) {
  currentFolderId = req.folderId || null;
  $('#method').value = req.method || 'GET';
  $('#url').value = req.url || '';
  paramsEditor.setRows(req.params || []);
  headersEditor.setRows(req.headers || []);
  bodyFormEditor.setRows(req.bodyForm || []);
  captureEditor.setRows(req.capture || []);
  testsEditor.setRows(req.tests || []);
  $('#body-raw').value = req.bodyRaw || '';
  $('#graphql-query').value = req.graphqlQuery || '';
  $('#graphql-variables').value = req.graphqlVariables || '';
  $('#pre-request-script').value = req.preRequestScript || '';
  $('#tests-script').value = req.testsScript || '';
  bodyFiles = Array.isArray(req.bodyFiles) ? [...req.bodyFiles] : [];
  renderBodyFiles();

  const bodyType = req.bodyType || 'none';
  const radio = document.querySelector(`input[name="bodyType"][value="${bodyType}"]`);
  if (radio) radio.checked = true;
  updateBodyVisibility();

  $('#auth-type').value = req.auth?.type || 'none';
  renderAuthFields(req.auth || {});

  // Docs, tags, favorite, settings, examples.
  $('#req-docs').value = req.docs || '';
  $('#req-tags').value = (req.tags || []).join(', ');
  renderDocsPreview();
  const settings = req.settings || {};
  $('#set-timeout').value = settings.timeoutMs ?? 30000;
  $('#set-follow').checked = settings.followRedirects !== false;
  $('#set-max-redirects').value = settings.maxRedirects ?? 5;
  $('#set-ssl').checked = settings.rejectUnauthorized !== false;
  currentExamples = Array.isArray(req.examples) ? [...req.examples] : [];
  currentFavorite = req.favorite === true;
  renderFavoriteStar();

  pathVarValues = {};
  (req.pathVars || []).forEach((r) => {
    if (r && r.key) pathVarValues[r.key] = r.value ?? '';
  });
  renderPathVars();

  setRequestName(req.name);
}

export function readRequestFromEditor() {
  return {
    name: $('#request-name').textContent.trim(),
    method: $('#method').value,
    url: $('#url').value.trim(),
    folderId: currentFolderId,
    params: paramsEditor.getRows(),
    pathVars: readPathVars(),
    headers: headersEditor.getRows(),
    bodyType: selectedBodyType(),
    bodyRaw: $('#body-raw').value,
    graphqlQuery: $('#graphql-query').value,
    graphqlVariables: $('#graphql-variables').value,
    preRequestScript: $('#pre-request-script').value,
    testsScript: $('#tests-script').value,
    bodyForm: bodyFormEditor.getRows(),
    bodyFiles: [...bodyFiles],
    auth: readAuth(),
    capture: captureEditor.getRows(),
    tests: testsEditor.getRows(),
    settings: {
      timeoutMs: Number($('#set-timeout').value) || 0,
      followRedirects: $('#set-follow').checked,
      maxRedirects: Number($('#set-max-redirects').value) || 0,
      rejectUnauthorized: $('#set-ssl').checked,
    },
    docs: $('#req-docs').value,
    tags: $('#req-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
    favorite: currentFavorite,
    examples: [...currentExamples],
  };
}
