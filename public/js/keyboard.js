// Keyboard-first navigation.
//
// Two layers: modifier shortcuts that work anywhere, and single-key commands
// (plus "g …" chords) that only fire when focus is not inside a text field —
// the same model as GitHub or Gmail. Single-key commands can be switched off
// in Appearance for people who dislike them.

const CHORD_TIMEOUT_MS = 900;
const MODE_KEY = 'b4call-keyboard-mode';

let deps = {};
let cursorIndex = -1;
let pendingChord = null;
let chordTimer = null;

const $ = (sel) => document.querySelector(sel);

export function isKeyboardModeOn() {
  return localStorage.getItem(MODE_KEY) !== 'off';
}

export function setKeyboardMode(on) {
  localStorage.setItem(MODE_KEY, on ? 'on' : 'off');
  if (!on) clearCursor();
}

function isTyping(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

/* ---------------- sidebar cursor ---------------- */

function items() {
  return [...document.querySelectorAll('#collections-list .request-item')];
}

function clearCursor() {
  document.querySelectorAll('.kbd-cursor').forEach((el) => el.classList.remove('kbd-cursor'));
}

function moveCursor(delta) {
  const list = items();
  if (!list.length) return;
  clearCursor();
  cursorIndex = Math.min(Math.max(cursorIndex + delta, 0), list.length - 1);
  const el = list[cursorIndex];
  el.classList.add('kbd-cursor');
  el.scrollIntoView({ block: 'nearest' });
}

function openCursor() {
  const list = items();
  if (cursorIndex < 0 || cursorIndex >= list.length) return;
  list[cursorIndex].click();
}

/* ---------------- chords ---------------- */

function startChord(key) {
  pendingChord = key;
  clearTimeout(chordTimer);
  chordTimer = setTimeout(() => {
    pendingChord = null;
    hideChordHint();
  }, CHORD_TIMEOUT_MS);
  showChordHint(key);
}

function endChord() {
  pendingChord = null;
  clearTimeout(chordTimer);
  hideChordHint();
}

function showChordHint(key) {
  let hint = $('#chord-hint');
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'chord-hint';
    hint.className = 'chord-hint';
    document.body.appendChild(hint);
  }
  hint.textContent = `${key} …`;
  hint.classList.remove('hidden');
}

function hideChordHint() {
  $('#chord-hint')?.classList.add('hidden');
}

/* ---------------- request / response tab helpers ---------------- */

function selectRequestTab(name) {
  const btn = document.querySelector(`.req-tab[data-tab="${name}"]`);
  if (btn) btn.click();
}

function selectSidebarView(view) {
  const btn = document.querySelector(`.sidebar-tab[data-view="${view}"]`);
  if (btn) btn.click();
}

const CHORDS = {
  g: {
    c: { label: 'Collections', run: () => selectSidebarView('collections') },
    h: { label: 'History', run: () => selectSidebarView('history') },
    p: { label: 'Params tab', run: () => selectRequestTab('params') },
    d: { label: 'Headers tab', run: () => selectRequestTab('headers') },
    b: { label: 'Body tab', run: () => selectRequestTab('body') },
    a: { label: 'Auth tab', run: () => selectRequestTab('auth') },
    s: { label: 'Scripts tab', run: () => selectRequestTab('scripts') },
    t: { label: 'Capture & Tests tab', run: () => selectRequestTab('capture') },
    o: { label: 'Docs tab', run: () => selectRequestTab('docs') },
    v: { label: 'Activity tab', run: () => selectRequestTab('activity') },
    e: { label: 'Settings tab', run: () => selectRequestTab('settings') },
  },
};

/* ---------------- key handling ---------------- */

function handleModifierShortcut(e) {
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl) return false;

  // Ctrl+Enter / Ctrl+S / Ctrl+K stay wired where they already live.
  if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    e.preventDefault();
    deps.cycleTab?.(e.key === 'ArrowRight' ? 1 : -1);
    return true;
  }
  if (e.key === 'PageDown' || e.key === 'PageUp') {
    e.preventDefault();
    deps.cycleTab?.(e.key === 'PageDown' ? 1 : -1);
    return true;
  }
  if (e.key === 'l' || e.key === 'L') {
    e.preventDefault();
    const url = $('#url');
    url.focus();
    url.select();
    return true;
  }
  if (e.altKey && (e.key === 't' || e.key === 'T')) {
    e.preventDefault();
    deps.newTab?.();
    return true;
  }
  if (e.altKey && (e.key === 'w' || e.key === 'W')) {
    e.preventDefault();
    deps.closeTab?.();
    return true;
  }
  if (e.shiftKey && (e.key === 'r' || e.key === 'R')) {
    e.preventDefault();
    deps.runCollection?.();
    return true;
  }
  if (e.shiftKey && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault();
    const search = $('#sidebar-search');
    search.focus();
    search.select();
    return true;
  }
  return false;
}

function handleAltNumber(e) {
  if (!e.altKey || e.ctrlKey || e.metaKey) return false;
  const n = Number(e.key);
  if (!Number.isInteger(n) || n < 1 || n > 9) return false;
  e.preventDefault();
  deps.activateTabIndex?.(n - 1);
  return true;
}

function handleNavKey(e) {
  const key = e.key;

  if (pendingChord) {
    const table = CHORDS[pendingChord];
    endChord();
    const action = table?.[key.toLowerCase()];
    if (action) {
      e.preventDefault();
      action.run();
      return true;
    }
    return false;
  }

  if (CHORDS[key]) {
    e.preventDefault();
    startChord(key);
    return true;
  }

  switch (key) {
    case 'j':
      e.preventDefault();
      moveCursor(cursorIndex === -1 ? 0 : 1);
      return true;
    case 'k':
      e.preventDefault();
      moveCursor(-1);
      return true;
    case 'Enter':
    case 'o':
      if (cursorIndex >= 0) {
        e.preventDefault();
        openCursor();
        return true;
      }
      return false;
    case '/':
      e.preventDefault();
      $('#sidebar-search').focus();
      return true;
    case 't':
      e.preventDefault();
      deps.newTab?.();
      return true;
    case 'x':
      e.preventDefault();
      deps.closeTab?.();
      return true;
    case 's':
      e.preventDefault();
      deps.send?.();
      return true;
    case 'e':
      e.preventDefault();
      $('#url').focus();
      return true;
    case '[':
      e.preventDefault();
      deps.cycleTab?.(-1);
      return true;
    case ']':
      e.preventDefault();
      deps.cycleTab?.(1);
      return true;
    case 'r':
      e.preventDefault();
      deps.runCollection?.();
      return true;
    case 'Escape':
      clearCursor();
      cursorIndex = -1;
      return false;
    default:
      return false;
  }
}

export function initKeyboard(dependencies = {}) {
  deps = { ...deps, ...dependencies };

  document.addEventListener('keydown', (e) => {
    if (handleModifierShortcut(e)) return;
    if (handleAltNumber(e)) return;

    if (isTyping(e.target)) {
      // Escape gets you out of a field and back to navigation.
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!isKeyboardModeOn()) return;
    handleNavKey(e);
  });

  // A re-rendered sidebar invalidates the cursor position.
  const list = document.getElementById('collections-list');
  if (list) {
    new MutationObserver(() => {
      if (!document.querySelector('.kbd-cursor')) cursorIndex = -1;
    }).observe(list, { childList: true, subtree: true });
  }
}

// Rows for the cheat sheet in the help dialog.
export const SHORTCUT_GROUPS = [
  [
    'Anywhere',
    [
      ['Ctrl / ⌘ + Enter', 'Send the current request'],
      ['Ctrl / ⌘ + S', 'Save the current request'],
      ['Ctrl / ⌘ + K', 'Global search / command palette'],
      ['Ctrl / ⌘ + L', 'Jump to the URL bar'],
      ['Ctrl / ⌘ + Shift + F', 'Jump to the sidebar filter'],
      ['Ctrl / ⌘ + Shift + R', 'Run the active collection'],
      ['Ctrl / ⌘ + Alt + T', 'New request tab'],
      ['Ctrl / ⌘ + Alt + W', 'Close the current tab'],
      ['Ctrl / ⌘ + Alt + ← / →', 'Previous / next tab'],
      ['Alt + 1…9', 'Jump to tab by position'],
      ['?', 'Show this cheat sheet'],
    ],
  ],
  [
    'Keyboard mode (no field focused)',
    [
      ['j / k', 'Move down / up the request list'],
      ['Enter or o', 'Open the highlighted request'],
      ['/', 'Filter the sidebar'],
      ['t', 'New tab'],
      ['x', 'Close tab'],
      ['s', 'Send'],
      ['e', 'Edit the URL'],
      ['[ / ]', 'Previous / next tab'],
      ['r', 'Run the collection'],
      ['Esc', 'Drop the cursor / leave the field'],
    ],
  ],
  [
    'Chords — press g, then',
    [
      ['g c', 'Collections'],
      ['g h', 'History'],
      ['g p', 'Params'],
      ['g d', 'Headers'],
      ['g b', 'Body'],
      ['g a', 'Auth'],
      ['g s', 'Scripts'],
      ['g t', 'Capture & Tests'],
      ['g o', 'Docs'],
      ['g v', 'Activity'],
      ['g e', 'Settings'],
    ],
  ],
  [
    'Mouse',
    [
      ['Middle-click a tab', 'Close it'],
      ['Right-click a tab', 'Pin / duplicate / close others'],
      ['Drag a tab', 'Reorder tabs'],
    ],
  ],
];
