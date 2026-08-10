import { lookupVar } from './vars.js';

// Autocomplete for {{variables}} in the request editor.
// Attaches (capture-phase) to the workspace so it covers the URL bar,
// kv editors, the raw body textarea, and auth fields — including rows
// the kv editor adds later.
let menu = null;
let items = [];
let activeIndex = 0;
let target = null;
let matchStart = 0;
let scopesProvider = () => ({ environment: null, collection: null, globals: {} });

function isTextField(el) {
  return (el.tagName === 'INPUT' && el.type === 'text') || el.tagName === 'TEXTAREA';
}

function allVars(scopes) {
  const names = new Set([
    ...Object.keys(scopes.globals || {}),
    ...Object.keys(scopes.collection ? scopes.collection.vars : {}),
    ...Object.keys(scopes.environment ? scopes.environment.vars : {}),
    ...Object.keys(scopes.vault || {}).map((key) => `vault:${key}`),
  ]);
  return [...names].sort().map((name) => ({ name, ...lookupVar(name, scopes) }));
}

function hide() {
  if (menu) menu.classList.add('hidden');
  items = [];
  target = null;
}

function highlight() {
  [...menu.querySelectorAll('.var-menu-item')].forEach((el, i) => {
    el.classList.toggle('active', i === activeIndex);
    if (i === activeIndex) el.scrollIntoView({ block: 'nearest' });
  });
}

function pick(index) {
  const variable = items[index];
  const el = target;
  if (!variable || !el) return hide();

  const caret = el.selectionStart;
  const after = el.value.slice(caret);
  const closing = after.startsWith('}}') ? '' : '}}';
  el.setRangeText(`{{${variable.name}${closing}`, matchStart, caret, 'end');
  hide();
  el.focus();
  // Re-fire input so kv rows / listeners pick up the programmatic change.
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function show(el, vars) {
  target = el;
  items = vars;
  activeIndex = 0;
  menu.textContent = '';

  if (vars.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'var-menu-empty';
    empty.textContent = 'No matching variables — define them via {{ }} Manage or the Variables tab';
    menu.appendChild(empty);
  }

  vars.forEach((variable, i) => {
    const item = document.createElement('div');
    item.className = 'var-menu-item';

    const badge = document.createElement('span');
    badge.className = `scope-badge scope-${variable.scope}`;
    badge.textContent = variable.scope;

    const name = document.createElement('span');
    name.className = 'var-menu-name';
    name.textContent = variable.name;

    const value = document.createElement('span');
    value.className = 'var-menu-value';
    value.textContent = variable.value;
    value.title = variable.value;

    item.append(badge, name, value);
    // mousedown (not click) so the input never loses focus.
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      pick(i);
    });
    menu.appendChild(item);
  });

  highlight();
  const rect = el.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 348))}px`;
  menu.style.top = `${rect.bottom + 4}px`;
  menu.classList.remove('hidden');
}

function onInput(e) {
  const el = e.target;
  if (!isTextField(el)) return;
  const caret = el.selectionStart;
  const before = el.value.slice(0, caret);
  const match = before.match(/\{\{\s*([\w.-]*)$/);
  if (!match) return hide();

  matchStart = caret - match[0].length;
  const prefix = match[1].toLowerCase();
  const vars = allVars(scopesProvider()).filter((v) =>
    v.name.toLowerCase().startsWith(prefix)
  );
  show(el, vars);
}

function onKeydown(e) {
  if (!menu || menu.classList.contains('hidden')) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex = Math.min(activeIndex + 1, items.length - 1);
    highlight();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex = Math.max(activeIndex - 1, 0);
    highlight();
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    if (items.length > 0) {
      e.preventDefault();
      e.stopPropagation(); // keep Enter from also triggering Send
      pick(activeIndex);
    } else {
      hide();
    }
  } else if (e.key === 'Escape') {
    hide();
  }
}

export function initVarAutocomplete(getScopesFn) {
  scopesProvider = getScopesFn;

  menu = document.createElement('div');
  menu.className = 'var-menu hidden';
  document.body.appendChild(menu);

  const workspace = document.querySelector('.workspace');
  workspace.addEventListener('input', onInput, true);
  workspace.addEventListener('keydown', onKeydown, true);
  workspace.addEventListener('focusout', () => setTimeout(hide, 100));
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
}
