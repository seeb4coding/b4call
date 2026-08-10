// Multiple request tabs. Each tab holds an editor snapshot; switching tabs
// saves the current editor state into the old tab and loads the new one.
import { iconEl } from './icons.js';

let tabs = [];
let activeId = null;
let deps = null; // { container, getSnapshot(), onActivate(tab) }
let counter = 0;
let dragTabId = null;

const uid = () => `tab-${(counter += 1)}`;

// Reorder by dropping one tab onto another. Pinned tabs stay grouped up front.
function reorderTab(sourceId, targetId) {
  if (!sourceId || sourceId === targetId) return;
  const source = byId(sourceId);
  const target = byId(targetId);
  if (!source || !target || source.pinned !== target.pinned) return;
  const without = tabs.filter((t) => t.id !== sourceId);
  const targetIndex = without.findIndex((t) => t.id === targetId);
  tabs = [...without.slice(0, targetIndex), source, ...without.slice(targetIndex)];
  render();
}

let tabMenu = null;
function closeTabMenu() {
  if (tabMenu) {
    tabMenu.remove();
    tabMenu = null;
  }
}
document.addEventListener('click', closeTabMenu, true);
window.addEventListener('blur', closeTabMenu);

function showTabMenu(event, tab) {
  closeTabMenu();
  const menu = document.createElement('div');
  menu.className = 'dropdown-menu';
  const items = [
    { icon: 'pin', label: tab.pinned ? 'Unpin tab' : 'Pin tab', onClick: () => pinTab(tab.id) },
    { icon: 'copy', label: 'Duplicate tab', onClick: () => duplicateTab(tab.id) },
    { icon: 'close', label: 'Close tab', onClick: () => closeTab(tab.id) },
    { icon: 'filter', label: 'Close others', onClick: () => closeOtherTabs(tab.id) },
    { icon: 'arrowDown', label: 'Close to the right', onClick: () => closeTabsToRight(tab.id) },
  ];
  items.forEach((item) => {
    const btn = document.createElement('button');
    btn.className = 'dropdown-item';
    const icon = document.createElement('span');
    icon.className = 'dropdown-item-icon';
    icon.appendChild(iconEl(item.icon, 14));
    const label = document.createElement('span');
    label.className = 'dropdown-item-label';
    label.textContent = item.label;
    btn.append(icon, label);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTabMenu();
      item.onClick();
    });
    menu.appendChild(btn);
  });
  document.body.appendChild(menu);
  tabMenu = menu;
  menu.style.display = 'block';
  menu.style.left = `${Math.min(event.clientX, window.innerWidth - (menu.offsetWidth || 180) - 10)}px`;
  menu.style.top = `${event.clientY + 4}px`;
}

export function blankSnapshot() {
  return {
    name: 'Untitled request',
    method: 'GET',
    url: '',
    folderId: null,
    params: [],
    pathVars: [],
    headers: [],
    bodyType: 'none',
    bodyRaw: '',
    graphqlQuery: '',
    graphqlVariables: '',
    preRequestScript: '',
    testsScript: '',
    bodyForm: [],
    bodyFiles: [],
    auth: { type: 'none' },
    capture: [],
    tests: [],
    settings: defaultSettings(),
    docs: '',
    tags: [],
    favorite: false,
    examples: [],
  };
}

export function defaultSettings() {
  return { timeoutMs: 30000, followRedirects: true, maxRedirects: 5, rejectUnauthorized: true };
}

export function pinTab(id) {
  const tab = byId(id);
  if (!tab) return;
  tab.pinned = !tab.pinned;
  // Keep pinned tabs grouped at the front, preserving relative order.
  tabs = [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];
  render();
}

export function duplicateTab(id) {
  const tab = byId(id);
  if (!tab) return;
  if (id === activeId) saveActiveSnapshot();
  const copy = {
    id: uid(),
    requestId: null,
    collectionId: tab.collectionId,
    title: `${tab.title} (copy)`,
    dirty: true,
    pinned: false,
    snapshot: structuredClone(tab.snapshot),
  };
  const index = tabs.findIndex((t) => t.id === id);
  tabs = [...tabs.slice(0, index + 1), copy, ...tabs.slice(index + 1)];
  activate(copy.id);
}

export function closeOtherTabs(id) {
  const keep = byId(id);
  if (!keep) return;
  tabs = tabs.filter((t) => t.id === id || t.pinned);
  if (activeId !== id) {
    activeId = id;
    deps.onActivate(keep);
  }
  render();
}

export function closeTabsToRight(id) {
  const index = tabs.findIndex((t) => t.id === id);
  if (index === -1) return;
  const removed = tabs.slice(index + 1).filter((t) => !t.pinned);
  if (removed.some((t) => t.id === activeId)) {
    activeId = id;
    deps.onActivate(byId(id));
  }
  const removedIds = new Set(removed.map((t) => t.id));
  tabs = tabs.filter((t) => !removedIds.has(t.id));
  render();
}

export function getTabs() {
  return tabs.map((t) => ({ id: t.id, title: t.title, method: t.snapshot?.method, active: t.id === activeId }));
}

function byId(id) {
  return tabs.find((t) => t.id === id);
}

function saveActiveSnapshot() {
  const current = byId(activeId);
  if (!current) return;
  current.snapshot = deps.getSnapshot();
  current.title = current.snapshot.name || 'Untitled request';
}

function activate(id) {
  if (id === activeId) return render();
  saveActiveSnapshot();
  activeId = id;
  const tab = byId(id);
  deps.onActivate(tab);
  render();
}

function render() {
  const bar = deps.container;
  bar.textContent = '';

  tabs.forEach((tab) => {
    const el = document.createElement('div');
    el.className = `tab${tab.id === activeId ? ' active' : ''}${tab.pinned ? ' pinned' : ''}`;
    el.draggable = true;

    if (tab.pinned) {
      const pin = document.createElement('span');
      pin.className = 'tab-pin';
      pin.appendChild(iconEl('pin', 11));
      pin.title = 'Pinned';
      el.appendChild(pin);
    }

    const method = document.createElement('span');
    method.className = `method-tag method-${tab.snapshot?.method || 'GET'}`;
    method.textContent = tab.snapshot?.method || 'GET';

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title || 'Untitled request';
    title.title = tab.title || '';

    el.append(method, title);

    if (tab.dirty) {
      const dot = document.createElement('span');
      dot.className = 'tab-dirty';
      dot.title = 'Unsaved changes';
      el.appendChild(dot);
    }

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.appendChild(iconEl('close', 12));
    close.title = 'Close tab';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });

    el.appendChild(close);
    el.addEventListener('click', () => activate(tab.id));
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) closeTab(tab.id); // middle-click closes, like a browser
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showTabMenu(e, tab);
    });

    // Drag to reorder.
    el.addEventListener('dragstart', (e) => {
      dragTabId = tab.id;
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => {
      dragTabId = null;
      el.classList.remove('dragging');
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      reorderTab(dragTabId, tab.id);
    });
    bar.appendChild(el);
  });

  const add = document.createElement('button');
  add.className = 'tab-add';
  add.appendChild(iconEl('plus', 13));
  add.title = 'New tab';
  add.addEventListener('click', () => openBlankTab());
  bar.appendChild(add);
}

export function initRequestTabs(dependencies) {
  deps = dependencies;
  tabs = [];
  activeId = null;
  openBlankTab();
}

// A blank tab, optionally pre-targeted at a collection/folder so Save lands there.
export function openBlankTab({ collectionId = null, folderId = null } = {}) {
  const tab = {
    id: uid(),
    requestId: null,
    collectionId,
    title: 'Untitled request',
    dirty: false,
    pinned: false,
    snapshot: { ...blankSnapshot(), folderId },
  };
  tabs = [...tabs, tab];
  activate(tab.id);
}

// Opens a saved request: reuses an existing tab for that request if open.
export function openRequestTab({ requestId, collectionId, snapshot }) {
  const existing = tabs.find((t) => t.requestId === requestId && requestId);
  if (existing) {
    existing.collectionId = collectionId;
    // Preserve unsaved edits: only refresh the snapshot from the saved copy
    // when the tab has no pending changes. Otherwise the user's in-progress
    // edits (which survive tab switches) would be wiped on re-open.
    if (!existing.dirty) {
      existing.snapshot = snapshot;
      existing.title = snapshot.name;
    }
    activate(existing.id);
    return;
  }
  const tab = {
    id: uid(),
    requestId,
    collectionId,
    title: snapshot.name || 'Untitled request',
    dirty: false,
    pinned: false,
    snapshot,
  };
  tabs = [...tabs, tab];
  activate(tab.id);
}

export function closeTab(id) {
  const index = tabs.findIndex((t) => t.id === id);
  if (index === -1) return;
  const closingActive = id === activeId;
  tabs = tabs.filter((t) => t.id !== id);

  if (tabs.length === 0) {
    activeId = null;
    openBlankTab();
    return;
  }
  if (closingActive) {
    activeId = null; // prevent snapshot-save into the removed tab
    const neighbor = tabs[Math.max(0, index - 1)];
    activeId = neighbor.id;
    deps.onActivate(neighbor);
  }
  render();
}

export function getActiveTab() {
  return byId(activeId) || null;
}

// Keyboard navigation helpers: wrap around the open tabs, jump by position,
// and close whatever is in front of the user.
export function cycleTab(delta) {
  if (tabs.length < 2) return;
  const index = tabs.findIndex((t) => t.id === activeId);
  const next = (index + delta + tabs.length) % tabs.length;
  activate(tabs[next].id);
}

export function activateTabIndex(index) {
  const tab = tabs[index];
  if (tab) activate(tab.id);
}

export function closeActiveTab() {
  if (activeId) closeTab(activeId);
}

// Called after save/rename so the tab reflects the request's identity.
export function updateActiveTabMeta({ title, requestId, collectionId, dirty }) {
  const tab = byId(activeId);
  if (!tab) return;
  if (title !== undefined) tab.title = title;
  if (requestId !== undefined) tab.requestId = requestId;
  if (collectionId !== undefined) tab.collectionId = collectionId;
  if (dirty !== undefined) tab.dirty = dirty;
  render();
}

// Marks the active tab as having unsaved edits (shows the ● dot).
export function markActiveTabDirty() {
  const tab = byId(activeId);
  if (!tab || tab.dirty) return;
  tab.dirty = true;
  render();
}

// Refresh the active tab's stored method (for the method chip) without switching.
export function touchActiveTab() {
  saveActiveSnapshot();
  render();
}
