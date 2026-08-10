import { copyText } from './clipboard.js';
import { iconSvg } from './icons.js';
import { openModal, toast } from './modal.js';
import { getRespHistory } from './state.js';
import { query as jsonPathQuery, JSONPATH_EXAMPLES } from './jsonpath.js';
import { inferJsonSchema, inferTypeScript } from './schema-infer.js';
import { diffLines, diffStats, diffHeaders, normalizeForDiff } from './response-diff.js';
import { shouldVirtualize, renderVirtualText } from './virtual-text.js';
import { renderTimings } from './timing-waterfall.js';
import { isBinaryResult, renderBinaryPreview, binaryBlob, binaryKind, hexDump } from './binary-preview.js';

const $ = (sel) => document.querySelector(sel);

let lastResult = null;
let lastTests = [];
let lastRequestId = null;
let prettyCache = '';
let virtualView = null; // handle from renderVirtualText, when active
let deps = { onSaveExample: () => {}, getExamples: () => [], onLoadExample: () => {} };

// History entries picked for comparison (#9).
let diffSelection = [];

const PANES = [
  'body', 'preview', 'visualize', 'timing', 'headers',
  'cookies', 'tests', 'history', 'examples', 'diff',
];

function paneId(name) {
  return `#response-${name}`;
}

function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function prettyBody(text, contentType = '') {
  if (!text) return '(empty body)';
  if (contentType.includes('json') || /^[\[{]/.test(text.trim())) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      /* raw */
    }
  }
  return text;
}

function statusClass(status) {
  if (status >= 200 && status < 300) return 'status-2xx';
  if (status >= 300 && status < 400) return 'status-3xx';
  if (status >= 400 && status < 500) return 'status-4xx';
  return 'status-5xx';
}

function contentType(result = lastResult) {
  return result?.contentType || result?.headers?.['content-type'] || '';
}

function parsedBody(result = lastResult) {
  if (!result || result.error || result.isBinary) return undefined;
  try {
    return JSON.parse(result.body);
  } catch {
    return undefined;
  }
}

function destroyVirtualView() {
  if (virtualView) {
    virtualView.destroy();
    virtualView = null;
  }
}

function showRespTab(name) {
  document.querySelectorAll('.resp-tab').forEach((b) =>
    b.classList.toggle('active', b.dataset.rtab === name)
  );

  PANES.forEach((pane) => {
    const el = $(paneId(pane));
    if (el) el.classList.toggle('hidden', pane !== name);
  });
  // The Preview tab owns the iframe and the binary viewer.
  $('#response-binary')?.classList.toggle('hidden', name !== 'preview');
  // The Body tab owns two elements: the text view and the JSON tree.
  if (name === 'body') {
    renderResponseBody();
  } else {
    $('#response-body').classList.add('hidden');
    $('#response-json-tree').classList.add('hidden');
    destroyVirtualView();
  }

  if (name === 'preview') renderPreviewPane();
  if (name === 'history') renderHistoryPane();
  if (name === 'visualize') renderVisualizePane();
  if (name === 'examples') renderExamplesPane();
  if (name === 'timing') renderTimings($('#response-timing'), lastResult);
}

/* ---------------- JSONPath filter (#10) ---------------- */

function setFilterStatus(text, bad = false) {
  const el = $('#resp-filter-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = `resp-filter-status${bad ? ' bad' : ''}`;
}

// Runs the JSONPath in the filter bar and swaps the Body pane for the matches.
function applyFilter() {
  const path = $('#resp-filter').value.trim();
  if (!path) {
    setFilterStatus('');
    renderResponseBody();
    return;
  }

  const data = parsedBody();
  if (data === undefined) {
    setFilterStatus('response is not JSON', true);
    return;
  }

  let result;
  try {
    result = jsonPathQuery(data, path);
  } catch (err) {
    setFilterStatus(err.message, true);
    return;
  }

  const { values, paths } = result;
  setFilterStatus(`${values.length} match${values.length === 1 ? '' : 'es'}`);

  destroyVirtualView();
  $('#response-json-tree').classList.add('hidden');
  const bodyEl = $('#response-body');
  bodyEl.classList.remove('hidden');

  if (values.length === 0) {
    bodyEl.textContent = `(no match for ${path})`;
    return;
  }

  const output =
    values.length === 1
      ? stringify(values[0])
      : values
          .map((value, index) => `// ${paths[index]}\n${stringify(value)}`)
          .join('\n\n');

  if (shouldVirtualize(output)) {
    virtualView = renderVirtualText(bodyEl, output);
  } else {
    bodyEl.textContent = output;
  }
}

function stringify(value) {
  return typeof value === 'object' && value !== null
    ? JSON.stringify(value, null, 2)
    : String(value);
}

function openJsonPathHelp() {
  const list = document.createElement('div');
  const intro = document.createElement('p');
  intro.className = 'modal-note';
  intro.textContent =
    'The filter bar accepts JSONPath. Click an example to run it against the current response.';
  list.appendChild(intro);

  JSONPATH_EXAMPLES.forEach(([expr, description]) => {
    const row = document.createElement('div');
    row.className = 'jsonpath-example';
    const code = document.createElement('code');
    code.textContent = expr;
    const desc = document.createElement('span');
    desc.textContent = description;
    row.append(code, desc);
    row.addEventListener('click', () => {
      $('#resp-filter').value = expr;
      applyFilter();
      showRespTab('body');
      document.querySelector('#modal-close')?.click();
    });
    list.appendChild(row);
  });

  openModal('JSONPath filter', [list], [
    { label: 'Close', primary: true, onClick: (close) => close() },
  ]);
}

/* ---------------- schema inference (#11) ---------------- */

function openSchemaDialog() {
  const data = parsedBody();
  if (data === undefined) return toast('Schema inference needs a JSON response');

  const name = (deps.getRequestName?.() || 'Response').replace(/[^A-Za-z0-9]+/g, ' ').trim() || 'Response';
  const schema = JSON.stringify(inferJsonSchema(data, { title: name }), null, 2);
  const types = inferTypeScript(data, { rootName: name });

  const tabs = document.createElement('div');
  tabs.className = 'schema-tabs';
  const pre = document.createElement('pre');
  pre.className = 'schema-output';

  const views = [
    ['JSON Schema', schema, 'schema.json', 'application/json'],
    ['TypeScript', types, 'types.ts', 'text/plain'],
  ];
  let active = 0;

  const paint = () => {
    [...tabs.children].forEach((btn, index) => btn.classList.toggle('active', index === active));
    pre.textContent = views[active][1];
  };

  views.forEach(([label], index) => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      active = index;
      paint();
    });
    tabs.appendChild(btn);
  });
  paint();

  openModal('Inferred schema', [tabs, pre], [
    {
      label: 'Copy',
      onClick: async () => {
        const ok = await copyText(views[active][1]);
        toast(ok ? `${views[active][0]} copied` : 'Copy failed');
      },
    },
    {
      label: 'Download',
      onClick: () => {
        const [, text, filename, type] = views[active];
        downloadText(text, filename, type);
      },
    },
    { label: 'Close', primary: true, onClick: (close) => close() },
  ]);
}

/* ---------------- response diff (#9) ---------------- */

function snapshotOfCurrent() {
  if (!lastResult || lastResult.error) return null;
  return {
    at: Date.now(),
    label: 'Current response',
    status: lastResult.status,
    headers: lastResult.headers || {},
    body: lastResult.body || '',
    timeMs: lastResult.timeMs,
    size: lastResult.size,
  };
}

function updateDiffToolbar() {
  const btn = $('#resp-diff-run');
  if (!btn) return;
  btn.disabled = diffSelection.length !== 2;
  btn.classList.add('has-icon');
  btn.innerHTML = iconSvg('diff', 13);
  btn.append(
    document.createTextNode(
      diffSelection.length === 2
        ? 'Diff the 2 selected'
        : `Diff (${diffSelection.length}/2 selected)`
    )
  );
}

function toggleDiffSelection(entry, checked) {
  if (checked) {
    diffSelection = [...diffSelection, entry].slice(-2);
  } else {
    diffSelection = diffSelection.filter((e) => e !== entry);
  }
  updateDiffToolbar();
  // Reflect the trimmed selection in the checkboxes.
  document.querySelectorAll('.resp-history-item input[type="checkbox"]').forEach((box) => {
    const owned = box.__entry;
    box.checked = diffSelection.includes(owned);
  });
}

function runDiff(left, right) {
  const sortKeys = $('#diff-sort-keys')?.checked !== false;
  const leftText = normalizeForDiff(left.body, { sortKeys });
  const rightText = normalizeForDiff(right.body, { sortKeys });
  const rows = diffLines(leftText, rightText);
  const stats = diffStats(rows);

  const pane = $('#response-diff');
  pane.textContent = '';

  const header = document.createElement('div');
  header.className = 'diff-header';

  const describe = (entry) =>
    `${entry.label || new Date(entry.at).toLocaleString()} · ${entry.error ? 'Error' : entry.status} · ${entry.timeMs ?? '—'} ms · ${formatSize(entry.size)}`;

  const leftTitle = document.createElement('div');
  leftTitle.className = 'diff-side-title';
  leftTitle.textContent = `A  ${describe(left)}`;
  const rightTitle = document.createElement('div');
  rightTitle.className = 'diff-side-title';
  rightTitle.textContent = `B  ${describe(right)}`;
  header.append(leftTitle, rightTitle);
  pane.appendChild(header);

  const summary = document.createElement('div');
  summary.className = 'diff-summary';
  summary.innerHTML =
    `<span class="diff-badge diff-badge-add">+${stats.added}</span>` +
    `<span class="diff-badge diff-badge-del">−${stats.removed}</span>` +
    `<span class="diff-meta">${stats.unchanged} unchanged line(s)</span>`;

  const onlyChanges = document.createElement('label');
  onlyChanges.className = 'diff-toggle';
  const onlyBox = document.createElement('input');
  onlyBox.type = 'checkbox';
  onlyBox.id = 'diff-only-changes';
  onlyBox.checked = rows.length > 400;
  onlyChanges.append(onlyBox, document.createTextNode(' Only changed lines'));
  summary.appendChild(onlyChanges);

  const sortToggle = document.createElement('label');
  sortToggle.className = 'diff-toggle';
  const sortBox = document.createElement('input');
  sortBox.type = 'checkbox';
  sortBox.id = 'diff-sort-keys';
  sortBox.checked = sortKeys;
  sortToggle.append(sortBox, document.createTextNode(' Sort JSON keys'));
  sortBox.addEventListener('change', () => runDiff(left, right));
  summary.appendChild(sortToggle);

  pane.appendChild(summary);

  const headerDiff = diffHeaders(left.headers, right.headers);
  if (headerDiff.length) {
    const details = document.createElement('details');
    details.className = 'diff-headers';
    const sum = document.createElement('summary');
    sum.textContent = `${headerDiff.length} header(s) differ`;
    details.appendChild(sum);
    const table = document.createElement('table');
    table.className = 'viz-table';
    headerDiff.forEach((row) => {
      const tr = document.createElement('tr');
      [row.key, row.left ?? '(absent)', row.right ?? '(absent)'].forEach((text) => {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    details.appendChild(table);
    pane.appendChild(details);
  }

  const body = document.createElement('div');
  body.className = 'diff-body';
  pane.appendChild(body);

  const paint = () => {
    body.textContent = '';
    const changesOnly = onlyBox.checked;
    const visible = changesOnly ? withContext(rows, 2) : rows;
    if (!visible.length) {
      const note = document.createElement('div');
      note.className = 'empty-note';
      note.textContent = 'The two responses are identical.';
      body.appendChild(note);
      return;
    }
    const fragment = document.createDocumentFragment();
    visible.forEach((row) => {
      if (row.gap) {
        const gap = document.createElement('div');
        gap.className = 'diff-gap';
        gap.textContent = `… ${row.gap} unchanged line(s)`;
        fragment.appendChild(gap);
        return;
      }
      fragment.appendChild(diffRow(row));
    });
    body.appendChild(fragment);
  };
  onlyBox.addEventListener('change', paint);
  paint();

  makeTabVisible('diff');
  showRespTab('diff');
}

function diffRow(row) {
  const el = document.createElement('div');
  el.className = `diff-row diff-${row.type}`;

  const leftNo = document.createElement('span');
  leftNo.className = 'diff-lineno';
  leftNo.textContent = row.leftNo ?? '';
  const leftText = document.createElement('span');
  leftText.className = 'diff-text';
  leftText.textContent = row.left ?? '';

  const rightNo = document.createElement('span');
  rightNo.className = 'diff-lineno';
  rightNo.textContent = row.rightNo ?? '';
  const rightText = document.createElement('span');
  rightText.className = 'diff-text';
  rightText.textContent = row.right ?? '';

  el.append(leftNo, leftText, rightNo, rightText);
  return el;
}

// Collapse long identical stretches into "… N unchanged lines" markers.
function withContext(rows, context) {
  const keep = new Set();
  rows.forEach((row, index) => {
    if (row.type === 'same') return;
    for (let i = index - context; i <= index + context; i += 1) {
      if (i >= 0 && i < rows.length) keep.add(i);
    }
  });
  const out = [];
  let skipped = 0;
  rows.forEach((row, index) => {
    if (keep.has(index)) {
      if (skipped) {
        out.push({ gap: skipped });
        skipped = 0;
      }
      out.push(row);
    } else {
      skipped += 1;
    }
  });
  if (skipped) out.push({ gap: skipped });
  return out;
}

function makeTabVisible(name) {
  document.querySelector(`.resp-tab[data-rtab="${name}"]`)?.classList.remove('hidden');
}

/* ---------------- visualize ---------------- */

function renderVisualizePane() {
  const el = $('#response-visualize');
  el.textContent = '';
  if (!lastResult || lastResult.error) {
    el.innerHTML = '<div class="empty-note">No response to visualize.</div>';
    return;
  }
  const data = parsedBody();
  if (data === undefined) {
    el.innerHTML = '<div class="empty-note">Visualize needs a JSON response.</div>';
    return;
  }

  // Array of numbers → bar chart. Array of objects → table. Object → kv table.
  if (Array.isArray(data) && data.length && data.every((v) => typeof v === 'number')) {
    el.appendChild(barChart(data.map((v, i) => [String(i), v])));
    return;
  }
  if (Array.isArray(data) && data.length && data.every((v) => v && typeof v === 'object' && !Array.isArray(v))) {
    el.appendChild(objectTable(data));
    return;
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const numericEntries = Object.entries(data).filter(([, v]) => typeof v === 'number');
    if (numericEntries.length >= 2 && numericEntries.length === Object.keys(data).length) {
      el.appendChild(barChart(numericEntries));
      return;
    }
    el.appendChild(keyValueTable(data));
    return;
  }
  el.innerHTML = '<div class="empty-note">Nothing to chart for this shape of data.</div>';
}

function barChart(pairs) {
  const wrap = document.createElement('div');
  wrap.className = 'viz-bars';
  const max = Math.max(...pairs.map(([, v]) => Math.abs(v)), 1);
  pairs.slice(0, 100).forEach(([label, value]) => {
    const row = document.createElement('div');
    row.className = 'viz-bar-row';
    const labelEl = document.createElement('span');
    labelEl.className = 'viz-bar-label';
    labelEl.textContent = label;
    const track = document.createElement('div');
    track.className = 'viz-bar-track';
    const bar = document.createElement('div');
    bar.className = 'viz-bar-fill';
    bar.style.width = `${(Math.abs(value) / max) * 100}%`;
    const val = document.createElement('span');
    val.className = 'viz-bar-value';
    val.textContent = String(value);
    track.append(bar, val);
    row.append(labelEl, track);
    wrap.appendChild(row);
  });
  return wrap;
}

function objectTable(arr) {
  const columns = [...new Set(arr.flatMap((o) => Object.keys(o)))].slice(0, 30);
  const table = document.createElement('table');
  table.className = 'viz-table';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  columns.forEach((c) => {
    const th = document.createElement('th');
    th.textContent = c;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  arr.slice(0, 500).forEach((obj) => {
    const tr = document.createElement('tr');
    columns.forEach((c) => {
      const td = document.createElement('td');
      const v = obj[c];
      td.textContent = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function keyValueTable(obj) {
  const table = document.createElement('table');
  table.className = 'viz-table';
  Object.entries(obj).forEach(([k, v]) => {
    const tr = document.createElement('tr');
    const tdKey = document.createElement('td');
    tdKey.textContent = k;
    const tdVal = document.createElement('td');
    tdVal.textContent = typeof v === 'object' ? JSON.stringify(v) : String(v);
    tr.append(tdKey, tdVal);
    table.appendChild(tr);
  });
  return table;
}

/* ---------------- examples pane ---------------- */

function renderExamplesPane() {
  const el = $('#response-examples');
  el.textContent = '';
  const examples = deps.getExamples();
  if (!examples.length) {
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent = 'No saved examples. Send a request and click Example to save one.';
    el.appendChild(note);
    return;
  }
  examples.forEach((ex) => {
    const row = document.createElement('div');
    row.className = 'resp-history-item';
    const chip = document.createElement('span');
    chip.className = `status-chip ${statusClass(ex.status)}`;
    chip.textContent = ex.status;
    const name = document.createElement('span');
    name.className = 'response-meta';
    name.textContent = ex.name;
    row.append(chip, name);
    row.addEventListener('click', () => {
      renderResponse(
        { status: ex.status, statusText: ex.statusText, headers: ex.headers, body: ex.body, timeMs: 0, size: (ex.body || '').length },
        { tests: [], requestId: lastRequestId }
      );
      deps.onLoadExample?.(ex);
    });
    el.appendChild(row);
  });
}

/* ---------------- search / copy / download ---------------- */

function applySearch() {
  const query = $('#resp-search').value.trim();
  const bodyEl = $('#response-body');

  if (virtualView) {
    const hits = virtualView.findMatches(query);
    setFilterStatus(query ? `${hits.length} matching line(s)` : '');
    if (hits.length) virtualView.scrollToLine(hits[0]);
    return;
  }

  if (!query) {
    bodyEl.textContent = prettyCache;
    return;
  }
  const needle = query.toLowerCase();
  const lines = prettyCache.split('\n');
  const matches = lines.filter((line) => line.toLowerCase().includes(needle));
  bodyEl.textContent =
    `--- ${matches.length} matching line(s) for "${query}" ---\n` +
    (matches.length ? matches.join('\n') : '(no matches)');
}

function downloadText(text, filename, type) {
  const blob = new Blob([text], { type: type || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function extensionFor(type) {
  const map = [
    [/json/, 'json'], [/html/, 'html'], [/xml/, 'xml'], [/csv/, 'csv'],
    [/pdf/, 'pdf'], [/png/, 'png'], [/jpe?g/, 'jpg'], [/gif/, 'gif'],
    [/webp/, 'webp'], [/svg/, 'svg'], [/zip/, 'zip'], [/mpeg|mp3/, 'mp3'],
    [/mp4/, 'mp4'], [/wasm/, 'wasm'],
  ];
  for (const [pattern, ext] of map) {
    if (pattern.test(type)) return ext;
  }
  return 'txt';
}

function downloadResponse() {
  if (!lastResult) return;
  const type = contentType();
  const ext = extensionFor(type);
  const name = `response-${lastResult.status || 'error'}.${ext}`;

  if (isBinaryResult(lastResult)) {
    const blob = binaryBlob(lastResult);
    if (!blob) return toast('This response was too large to bring back for download');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return;
  }
  downloadText(lastResult.body || '', name, type || 'text/plain');
}

/* ---------------- panes ---------------- */

function renderPreviewPane() {
  const frame = $('#response-preview');
  const binary = $('#response-binary');
  const isHtml = contentType().includes('html') && !isBinaryResult(lastResult);

  frame.classList.toggle('hidden', !isHtml);
  binary.classList.toggle('hidden', isHtml);

  if (isHtml) {
    frame.srcdoc = lastResult?.body || '';
    binary.textContent = '';
    return;
  }
  frame.srcdoc = '';
  if (isBinaryResult(lastResult)) {
    renderBinaryPreview(binary, lastResult);
  } else {
    binary.innerHTML = '<div class="empty-note">Nothing to preview for this content type.</div>';
  }
}

function renderHeadersPane() {
  const headersEl = $('#response-headers');
  headersEl.textContent = '';
  const table = document.createElement('table');
  Object.entries(lastResult.headers || {}).forEach(([key, value]) => {
    const tr = document.createElement('tr');
    const tdKey = document.createElement('td');
    tdKey.textContent = key;
    const tdVal = document.createElement('td');
    tdVal.textContent = value;
    tr.append(tdKey, tdVal);
    table.appendChild(tr);
  });
  headersEl.appendChild(table);
}

function renderCookiesPane() {
  const el = $('#response-cookies');
  el.textContent = '';
  const cookies = lastResult.setCookies || [];
  if (cookies.length === 0) {
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent = 'No cookies set by this response';
    el.appendChild(note);
    return;
  }
  const table = document.createElement('table');
  cookies.forEach((cookie) => {
    const [pair, ...attrs] = cookie.split(';');
    const eq = pair.indexOf('=');
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.textContent = eq === -1 ? pair : pair.slice(0, eq);
    const tdVal = document.createElement('td');
    tdVal.textContent = eq === -1 ? '' : pair.slice(eq + 1);
    const tdAttrs = document.createElement('td');
    tdAttrs.textContent = attrs.join(';').trim();
    tr.append(tdName, tdVal, tdAttrs);
    table.appendChild(tr);
  });
  el.appendChild(table);
}

function renderTestsPane() {
  const el = $('#response-tests');
  el.textContent = '';
  if (!lastTests.length) {
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent = 'No tests on this request. Add them in the Capture & Tests tab.';
    el.appendChild(note);
    return;
  }
  lastTests.forEach((test) => {
    const row = document.createElement('div');
    row.className = `test-row ${test.pass ? 'test-pass' : 'test-fail'}`;
    const mark = document.createElement('span');
    mark.textContent = test.pass ? '✓' : '✗';
    const label = document.createElement('span');
    label.textContent = test.label;
    row.append(mark, label);
    if (!test.pass) {
      const actual = document.createElement('span');
      actual.className = 'test-actual';
      actual.textContent = `actual: ${test.actual}`;
      row.appendChild(actual);
    }
    el.appendChild(row);
  });
}

function renderHistoryPane() {
  const el = $('#response-history');
  el.textContent = '';
  diffSelection = [];

  if (!lastRequestId) {
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent = 'Save this request to keep a response history for it.';
    el.appendChild(note);
    return;
  }
  const entries = getRespHistory(lastRequestId);
  if (entries.length === 0) {
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent = 'No previous responses for this request yet.';
    el.appendChild(note);
    return;
  }

  // Response-time & size trend across recent responses (oldest → newest).
  if (entries.length >= 2) {
    const trend = document.createElement('div');
    trend.className = 'resp-trend';
    const title = document.createElement('div');
    title.className = 'vars-title';
    title.style.marginTop = '0';
    title.textContent = 'Response time trend (ms)';
    trend.appendChild(title);
    const chron = [...entries].reverse();
    const maxTime = Math.max(...chron.map((e) => e.timeMs || 0), 1);
    const bars = document.createElement('div');
    bars.className = 'resp-trend-bars';
    chron.forEach((e) => {
      const bar = document.createElement('div');
      bar.className = `resp-trend-bar ${e.error ? 'status-err' : statusClass(e.status)}`;
      bar.style.height = `${Math.max(((e.timeMs || 0) / maxTime) * 100, 4)}%`;
      bar.title = `${e.error ? 'Error' : e.status} · ${e.timeMs ?? '—'} ms · ${formatSize(e.size)}`;
      bars.appendChild(bar);
    });
    trend.appendChild(bars);
    el.appendChild(trend);
  }

  // Diff toolbar (#9).
  const bar = document.createElement('div');
  bar.className = 'diff-toolbar';
  const runBtn = document.createElement('button');
  runBtn.id = 'resp-diff-run';
  runBtn.className = 'btn';
  runBtn.disabled = true;
  runBtn.addEventListener('click', () => {
    if (diffSelection.length !== 2) return;
    // Older on the left, newer on the right.
    const [a, b] = [...diffSelection].sort((x, y) => (x.at || 0) - (y.at || 0));
    runDiff(a, b);
  });
  const vsCurrent = document.createElement('button');
  vsCurrent.className = 'btn has-icon';
  vsCurrent.innerHTML = `${iconSvg('diff', 13)}Diff newest vs current`;
  vsCurrent.addEventListener('click', () => {
    const current = snapshotOfCurrent();
    if (!current) return toast('No current response to compare');
    runDiff(entries[0], current);
  });
  bar.append(runBtn, vsCurrent);
  el.appendChild(bar);
  updateDiffToolbar();

  entries.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'resp-history-item';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.title = 'Select for diff';
    box.__entry = entry;
    box.addEventListener('click', (e) => e.stopPropagation());
    box.addEventListener('change', () => toggleDiffSelection(entry, box.checked));

    const chip = document.createElement('span');
    chip.className = `status-chip ${entry.error ? 'status-err' : statusClass(entry.status)}`;
    chip.textContent = entry.error ? 'Error' : entry.status;
    const meta = document.createElement('span');
    meta.className = 'response-meta';
    meta.textContent = `${new Date(entry.at).toLocaleString()}   ·   ${entry.timeMs ?? '—'} ms   ·   ${formatSize(entry.size)}`;

    row.append(box, chip, meta);
    row.addEventListener('click', () =>
      renderResponse(entry, { tests: [], requestId: lastRequestId, fromHistory: true })
    );
    el.appendChild(row);
  });
}

let responseMode = 'pretty';

function setResponseMode(mode) {
  responseMode = mode;
  $('#resp-mode-pretty').classList.toggle('active', mode === 'pretty');
  $('#resp-mode-raw').classList.toggle('active', mode === 'raw');
  if (lastResult) renderResponseBody();
}

/* ---------------- JSON tree (lazy, chunked — #13) ---------------- */

const TREE_CHUNK = 200;
const AUTO_EXPAND_DEPTH = 2;
const AUTO_EXPAND_MAX_CHILDREN = 100;

function primitiveNode(value) {
  const span = document.createElement('span');
  if (value === null) {
    span.className = 'json-tree-val-null';
    span.textContent = 'null';
  } else if (typeof value === 'boolean') {
    span.className = 'json-tree-val-boolean';
    span.textContent = String(value);
  } else if (typeof value === 'number') {
    span.className = 'json-tree-val-number';
    span.textContent = String(value);
  } else {
    span.className = 'json-tree-val-string';
    span.textContent = `"${value}"`;
  }
  return span;
}

// Children are built the first time a node is expanded, and in pages of 200,
// so a 50k-element array costs one row until you actually open it.
function createJsonNode(key, value, path = '', depth = 0) {
  const container = document.createElement('div');
  container.className = 'json-tree-node';

  const keySpan = document.createElement('span');
  keySpan.className = 'json-tree-key';
  keySpan.textContent = key !== null ? `"${key}": ` : '';

  const isArray = Array.isArray(value);
  const isObject = value !== null && typeof value === 'object' && !isArray;

  if (!isArray && !isObject) {
    container.append(keySpan, primitiveNode(value));
    appendCopyPath(container, path);
    return container;
  }

  const entries = isArray
    ? value.map((v, i) => [i, v])
    : Object.keys(value).map((k) => [k, value[k]]);
  const openChar = isArray ? '[' : '{';
  const closeChar = isArray ? ']' : '}';
  const countLabel = isArray
    ? `${entries.length} item${entries.length === 1 ? '' : 's'}`
    : `${entries.length} key${entries.length === 1 ? '' : 's'}`;

  container.classList.add('collapsible');

  const arrow = document.createElement('span');
  arrow.className = 'json-tree-arrow';
  arrow.innerHTML = iconSvg('chevronRight', 11);

  const openBracket = document.createElement('span');
  openBracket.textContent = openChar;

  container.append(arrow, keySpan, openBracket);

  const children = document.createElement('div');
  children.style.paddingLeft = '14px';
  children.style.display = 'none';

  const closeBracket = document.createElement('div');
  closeBracket.textContent = closeChar;
  closeBracket.style.paddingLeft = '18px';
  closeBracket.style.display = 'none';

  container.append(children, closeBracket);

  let rendered = 0;
  let built = false;

  const renderChunk = () => {
    const moreBtn = children.querySelector('.json-tree-more');
    if (moreBtn) moreBtn.remove();
    const limit = Math.min(rendered + TREE_CHUNK, entries.length);
    const fragment = document.createDocumentFragment();
    for (let i = rendered; i < limit; i += 1) {
      const [childKey, childValue] = entries[i];
      const childPath = isArray
        ? `${path}[${childKey}]`
        : path
          ? `${path}.${childKey}`
          : String(childKey);
      fragment.appendChild(
        createJsonNode(isArray ? null : String(childKey), childValue, childPath, depth + 1)
      );
    }
    children.appendChild(fragment);
    rendered = limit;
    if (rendered < entries.length) {
      const more = document.createElement('button');
      more.className = 'json-tree-more';
      more.textContent = `Show ${Math.min(TREE_CHUNK, entries.length - rendered)} more of ${entries.length}`;
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        renderChunk();
      });
      children.appendChild(more);
    }
  };

  const setExpanded = (expanded) => {
    arrow.classList.toggle('expanded', expanded);
    if (expanded && !built) {
      built = true;
      renderChunk();
    }
    children.style.display = expanded ? 'block' : 'none';
    closeBracket.style.display = expanded ? 'block' : 'none';
    openBracket.textContent = expanded ? openChar : `${openChar} … ${closeChar} (${countLabel})`;
  };

  arrow.addEventListener('click', (e) => {
    e.stopPropagation();
    setExpanded(!arrow.classList.contains('expanded'));
  });
  container.addEventListener('click', (e) => {
    if (e.target === container || e.target === keySpan || e.target === openBracket) {
      setExpanded(!arrow.classList.contains('expanded'));
    }
  });

  setExpanded(depth < AUTO_EXPAND_DEPTH && entries.length <= AUTO_EXPAND_MAX_CHILDREN);
  appendCopyPath(container, path);
  return container;
}

function appendCopyPath(container, path) {
  if (!path) return;
  const btn = document.createElement('span');
  btn.className = 'json-tree-copy-path';
  btn.textContent = 'Copy Path';
  btn.title = `Copy path: ${path}`;
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const ok = await copyText(path);
    toast(ok ? `Copied path: ${path}` : 'Failed to copy path');
  });
  container.appendChild(btn);
}

function renderResponseBody() {
  const bodyEl = $('#response-body');
  const treeEl = $('#response-json-tree');

  destroyVirtualView();
  bodyEl.classList.add('hidden');
  treeEl.classList.add('hidden');
  treeEl.textContent = '';

  if (!lastResult) return;

  if (lastResult.error) {
    bodyEl.textContent = lastResult.error;
    bodyEl.classList.remove('hidden');
    return;
  }

  // Binary bodies have no text to show — hand them to the hex/preview view.
  if (isBinaryResult(lastResult)) {
    bodyEl.textContent = '';
    bodyEl.classList.remove('hidden');
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent =
      `${binaryKind(contentType())} response (${formatSize(lastResult.byteLength ?? lastResult.size)}) — ` +
      'see the Preview tab, or download it. First bytes:';
    bodyEl.textContent = '';
    bodyEl.append(note, hexDump(lastResult));
    return;
  }

  const isJson = contentType().includes('json') || /^[\[{]/.test((lastResult.body || '').trim());

  if (isJson && responseMode === 'pretty') {
    try {
      const parsed = JSON.parse(lastResult.body);
      treeEl.appendChild(createJsonNode(null, parsed, '', 0));
      treeEl.classList.remove('hidden');
      prettyCache = prettyBody(lastResult.body, contentType());
      return;
    } catch (err) {
      console.warn('Failed to parse JSON for explorer, falling back to raw:', err);
    }
  }

  prettyCache = prettyBody(lastResult.body, contentType());
  bodyEl.classList.remove('hidden');
  if (shouldVirtualize(prettyCache)) {
    virtualView = renderVirtualText(bodyEl, prettyCache, { highlight: $('#resp-search').value.trim() });
  } else {
    bodyEl.textContent = prettyCache;
  }
}

/* ---------------- main entry points ---------------- */

export function initResponsePanel(dependencies = {}) {
  deps = { ...deps, ...dependencies };
  document.querySelectorAll('.resp-tab').forEach((btn) => {
    btn.addEventListener('click', () => showRespTab(btn.dataset.rtab));
  });

  $('#resp-mode-pretty').addEventListener('click', () => setResponseMode('pretty'));
  $('#resp-mode-raw').addEventListener('click', () => setResponseMode('raw'));

  $('#resp-search').addEventListener('input', applySearch);
  $('#resp-filter').addEventListener('input', applyFilter);
  $('#resp-filter-help')?.addEventListener('click', openJsonPathHelp);
  $('#resp-schema')?.addEventListener('click', openSchemaDialog);
  $('#resp-save-example').addEventListener('click', () => {
    if (!lastResult || lastResult.error) return toast('No successful response to save');
    deps.onSaveExample(buildExampleFromResult());
  });
  $('#resp-copy').addEventListener('click', async () => {
    if (!lastResult) return;
    if (isBinaryResult(lastResult)) return toast('Binary response — use Download instead');
    const ok = await copyText(lastResult.body || '');
    toast(ok ? 'Response copied' : 'Copy failed');
  });
  $('#resp-download').addEventListener('click', downloadResponse);
}

function buildExampleFromResult() {
  return {
    status: lastResult.status,
    statusText: lastResult.statusText || '',
    contentType: contentType(),
    headers: lastResult.headers || {},
    body: lastResult.body || '',
  };
}

// Resets the panel to its empty state (used when a tab has no response yet).
export function clearResponse() {
  destroyVirtualView();
  lastResult = null;
  lastTests = [];
  lastRequestId = null;
  prettyCache = '';
  diffSelection = [];
  $('#response-empty').classList.remove('hidden');
  $('#response-status').classList.add('hidden');
  $('#resp-tabs').classList.add('hidden');
  $('#response-toolbar').classList.add('hidden');
  ['json-tree', 'binary', ...PANES].forEach((pane) =>
    $(`#response-${pane}`)?.classList.add('hidden')
  );
}

export function renderResponse(result, { tests = [], requestId = null } = {}) {
  destroyVirtualView();
  lastResult = result;
  lastTests = tests;
  lastRequestId = requestId;

  $('#response-empty').classList.add('hidden');
  $('#response-status').classList.remove('hidden');

  const statusEl = $('#response-status');
  statusEl.textContent = '';

  if (result.error) {
    const chip = document.createElement('span');
    chip.className = 'status-chip status-err';
    chip.textContent = 'Error';
    const msg = document.createElement('span');
    msg.className = 'response-meta';
    msg.textContent = result.error;
    statusEl.append(chip, msg);

    $('#resp-tabs').classList.remove('hidden');
    $('#response-toolbar').classList.add('hidden');
    prettyCache = result.error;
    lastTests = tests;
    renderTestsPane();
    showRespTab('body');
    return;
  }

  const chip = document.createElement('span');
  chip.className = `status-chip ${statusClass(result.status)}`;
  chip.textContent = `${result.status} ${result.statusText || ''}`.trim();

  const meta = document.createElement('span');
  meta.className = 'response-meta';
  meta.textContent = `${result.timeMs} ms   ·   ${formatSize(result.size)}${result.truncated ? '   ·   truncated' : ''}`;

  statusEl.append(chip, meta);
  if (tests.length) {
    const passed = tests.filter((t) => t.pass).length;
    const summary = document.createElement('span');
    summary.className = passed === tests.length ? 'tests-summary ok' : 'tests-summary bad';
    summary.textContent = `Tests: ${passed}/${tests.length} passed`;
    statusEl.appendChild(summary);
  }

  $('#resp-tabs').classList.remove('hidden');
  $('#response-toolbar').classList.remove('hidden');
  $('#resp-search').value = '';
  $('#resp-filter').value = '';
  setFilterStatus('');

  $('#resp-mode-pretty').classList.toggle('active', responseMode === 'pretty');
  $('#resp-mode-raw').classList.toggle('active', responseMode === 'raw');

  // Preview is for HTML and for anything binary; Timing needs measurements.
  const previewable = contentType().includes('html') || isBinaryResult(result);
  document.querySelector('.resp-tab[data-rtab="preview"]').classList.toggle('hidden', !previewable);
  document.querySelector('.resp-tab[data-rtab="timing"]').classList.toggle('hidden', !result.timings);
  document.querySelector('.resp-tab[data-rtab="diff"]').classList.add('hidden');

  renderHeadersPane();
  renderCookiesPane();
  renderTestsPane();
  showRespTab('body');
}
