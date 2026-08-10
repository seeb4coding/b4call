import { iconSvg } from './icons.js';
// Ctrl+K global search across every request in the loaded collections,
// matching name, URL, method, tags, and docs. Selecting one opens it.
let deps = { getCollections: () => [], onOpenRequest: () => {}, actions: [] };
let overlay = null;
let results = [];
let activeIndex = 0;

export function initCommandPalette(dependencies) {
  deps = { ...deps, ...dependencies };
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      openPalette();
    } else if (e.key === 'Escape' && overlay) {
      closePalette();
    }
  });
  const btn = document.getElementById('global-search-btn');
  if (btn) btn.addEventListener('click', openPalette);
}

function collectItems(query) {
  const q = query.trim().toLowerCase();
  const items = [];

  deps.getCollections().forEach((collection) => {
    (collection.requests || []).forEach((req) => {
      const haystack = [
        req.name,
        req.url,
        req.method,
        (req.tags || []).join(' '),
        req.docs || '',
      ]
        .join(' ')
        .toLowerCase();
      if (!q || haystack.includes(q)) {
        items.push({
          type: 'request',
          method: req.method,
          title: req.name,
          subtitle: `${collection.name} · ${req.url || ''}`,
          run: () => deps.onOpenRequest(collection, req),
        });
      }
    });
  });

  (deps.actions || []).forEach((action) => {
    if (!q || action.title.toLowerCase().includes(q)) {
      items.push({ type: 'action', title: action.title, subtitle: 'Action', run: action.run });
    }
  });

  return items.slice(0, 50);
}

function render(input) {
  const listEl = overlay.querySelector('.palette-list');
  results = collectItems(input.value);
  activeIndex = Math.min(activeIndex, Math.max(results.length - 1, 0));
  listEl.textContent = '';
  if (results.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-note';
    empty.textContent = 'No matches';
    listEl.appendChild(empty);
    return;
  }
  results.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = `palette-item${index === activeIndex ? ' active' : ''}`;
    if (item.type === 'request') {
      const method = document.createElement('span');
      method.className = `method-tag method-${item.method || 'GET'}`;
      method.textContent = item.method || 'GET';
      row.appendChild(method);
    } else {
      const icon = document.createElement('span');
      icon.className = 'method-tag';
      icon.innerHTML = iconSvg('play', 13);
      row.appendChild(icon);
    }
    const text = document.createElement('div');
    text.className = 'palette-text';
    const title = document.createElement('div');
    title.className = 'palette-title';
    title.textContent = item.title;
    const subtitle = document.createElement('div');
    subtitle.className = 'palette-subtitle';
    subtitle.textContent = item.subtitle;
    text.append(title, subtitle);
    row.appendChild(text);
    row.addEventListener('click', () => choose(index));
    listEl.appendChild(row);
  });
}

function choose(index) {
  const item = results[index];
  closePalette();
  if (item) item.run();
}

function openPalette() {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.className = 'palette-overlay';
  overlay.innerHTML = `
    <div class="palette">
      <input class="palette-input" type="text" placeholder="Search requests and actions…" spellcheck="false">
      <div class="palette-list"></div>
      <div class="palette-hint">↑↓ navigate · Enter open · Esc close</div>
    </div>`;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closePalette();
  });
  document.body.appendChild(overlay);

  const input = overlay.querySelector('.palette-input');
  activeIndex = 0;
  render(input);
  input.focus();
  input.addEventListener('input', () => {
    activeIndex = 0;
    render(input);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, results.length - 1);
      render(input);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      render(input);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(activeIndex);
    }
  });
}

function closePalette() {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
}
