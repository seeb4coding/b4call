import { openModal, toast } from './modal.js';
import { getProxyConfig, setProxyConfig } from './proxy-config.js';
import { iconSvg } from './icons.js';
import { SHORTCUT_GROUPS, isKeyboardModeOn } from './keyboard.js';

/* ---------------- keyboard shortcut cheatsheet (#27) ---------------- */

function shortcutTable(rows) {
  const table = document.createElement('table');
  table.className = 'shortcut-table';
  rows.forEach(([keys, desc]) => {
    const tr = document.createElement('tr');
    const tdKeys = document.createElement('td');
    tdKeys.innerHTML = keys
      .split(' + ')
      .map((k) => `<span class="kbd">${k}</span>`)
      .join(' + ');
    const tdDesc = document.createElement('td');
    tdDesc.textContent = desc;
    tr.append(tdKeys, tdDesc);
    table.appendChild(tr);
  });
  return table;
}

export function openHelpDialog() {
  const nodes = [];
  SHORTCUT_GROUPS.forEach(([groupTitle, rows]) => {
    const title = document.createElement('div');
    title.className = 'vars-title';
    title.textContent = groupTitle;
    if (groupTitle.startsWith('Keyboard mode') && !isKeyboardModeOn()) {
      const off = document.createElement('span');
      off.className = 'modal-note';
      off.style.display = 'inline';
      off.textContent = '  — currently off, enable it in Appearance';
      title.appendChild(off);
    }
    nodes.push(title, shortcutTable(rows));
  });

  const varsNote = document.createElement('div');
  varsNote.innerHTML = `
    <div class="vars-title">Variable references</div>
    <ul class="help-list">
      <li><code>{{var}}</code> — environment / collection / global variable</li>
      <li><code>{{vault:name}}</code> — local vault secret (never leaves this browser)</li>
      <li><code>{{res:RequestName.body.path}}</code> — chain off a previous response</li>
      <li><code>:name</code> in the URL — editable path variable</li>
    </ul>`;

  openModal('Keyboard shortcuts & tips', [...nodes, varsNote], [
    { label: 'Close', primary: true, onClick: (close) => close() },
  ]);
}

/* ---------------- mock server (#29) ---------------- */

export function openMockDialog(collections) {
  const container = document.createElement('div');
  const note = document.createElement('p');
  note.className = 'modal-note';
  note.textContent =
    'Save example responses on a request (Response → Example), then call the URLs below. ' +
    'The mock matches by method + path and replies with the first saved example.';
  container.appendChild(note);

  if (!collections.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-note';
    empty.textContent = 'No collections yet.';
    container.appendChild(empty);
  }

  collections.forEach((collection) => {
    const withExamples = (collection.requests || []).filter((r) => (r.examples || []).length > 0);
    const row = document.createElement('div');
    row.className = 'mock-row';
    const title = document.createElement('div');
    title.className = 'vars-title';
    title.style.margin = '6px 0 2px';
    title.textContent = `${collection.name} — ${withExamples.length} mocked request(s)`;
    const url = document.createElement('div');
    url.className = 'mock-url';
    const base = `${window.location.origin}/mock/${collection.id}`;
    url.textContent = `${base}/<path>`;
    const copy = document.createElement('button');
    copy.className = 'link-btn has-icon';
    copy.innerHTML = `${iconSvg('copy', 12)}Copy base`;
    copy.addEventListener('click', async () => {
      await navigator.clipboard.writeText(base).catch(() => {});
      toast('Mock base URL copied');
    });
    row.append(title, url, copy);
    container.appendChild(row);
  });

  openModal('Mock server', [container], [
    { label: 'Close', primary: true, onClick: (close) => close() },
  ]);
}

/* ---------------- outbound proxy config (#30) ---------------- */

export function openProxyDialog() {
  const cfg = getProxyConfig();
  const note = document.createElement('p');
  note.className = 'modal-note';
  note.textContent =
    'Route outgoing requests through an HTTP proxy. Supports http/https targets and basic proxy auth in the URL (http://user:pass@host:port).';

  const enabledLabel = document.createElement('label');
  enabledLabel.className = 'setting-row';
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = cfg.enabled;
  const enabledText = document.createElement('span');
  enabledText.textContent = 'Enable proxy for all requests';
  enabledLabel.append(enabledText, enabled);

  const urlLabel = document.createElement('label');
  urlLabel.textContent = 'Proxy URL';
  const url = document.createElement('input');
  url.type = 'text';
  url.placeholder = 'http://127.0.0.1:8080';
  url.value = cfg.url;
  urlLabel.appendChild(url);

  openModal('Outbound proxy', [note, enabledLabel, urlLabel], [
    { label: 'Cancel', onClick: (close) => close() },
    {
      label: 'Save',
      primary: true,
      onClick: (close) => {
        setProxyConfig({ enabled: enabled.checked, url: url.value.trim() });
        toast('Proxy settings saved');
        close();
      },
    },
  ]);
}
