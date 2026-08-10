import { state, getHistory } from './state.js';
import { iconEl, iconElFilled, iconSvg } from './icons.js';

const expandedCollections = new Set();
const collapsedCollections = new Set(); // for collections that default open
const expandedFolders = new Set();

export function expandCollection(id) {
  expandedCollections.add(id);
  collapsedCollections.delete(id);
}

export function expandFolder(id) {
  expandedFolders.add(id);
}

let activeDropdown = null;

function closeDropdown() {
  if (activeDropdown) {
    activeDropdown.remove();
    activeDropdown = null;
  }
}

// Close dropdown on click outside
document.addEventListener('click', (e) => {
  if (activeDropdown && !activeDropdown.contains(e.target)) {
    closeDropdown();
  }
}, true);

// Close dropdown on resize or scroll
window.addEventListener('resize', closeDropdown);
document.addEventListener('scroll', closeDropdown, true);

function showDropdown(anchorEl, items) {
  closeDropdown();

  const menu = document.createElement('div');
  menu.className = 'dropdown-menu';

  items.forEach(item => {
    if (!item) return;
    const btn = document.createElement('button');
    btn.className = 'dropdown-item';
    if (item.danger) btn.classList.add('danger');

    const icon = document.createElement('span');
    icon.className = 'dropdown-item-icon';
    icon.appendChild(iconEl(item.icon, 14));

    const label = document.createElement('span');
    label.className = 'dropdown-item-label';
    label.textContent = item.label;

    btn.append(icon, label);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeDropdown();
      item.onClick();
    });
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);
  activeDropdown = menu;

  const rect = anchorEl.getBoundingClientRect();
  menu.style.display = 'block';

  const menuWidth = menu.offsetWidth || 180;
  const menuHeight = menu.offsetHeight || 200;

  // Align with the right side of the options button
  let left = rect.right - menuWidth;
  if (left < 10) left = 10;

  let top = rect.bottom + 4;
  if (top + menuHeight > window.innerHeight) {
    top = rect.top - menuHeight - 4;
  }

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function methodTag(method) {
  const tag = document.createElement('span');
  tag.className = `method-tag method-${method}`;
  tag.textContent = method;
  return tag;
}

function matchesFilter(req, filter) {
  if (!filter) return true;
  const q = filter.toLowerCase();
  if (q === 'is:favorite' || q === 'is:favourite' || q === 'is:starred') {
    return req.favorite === true;
  }
  return (
    (req.name || '').toLowerCase().includes(q) ||
    (req.url || '').toLowerCase().includes(q) ||
    (req.tags || []).some((t) => String(t).toLowerCase().includes(q))
  );
}

// folder → true when it (or any descendant folder) contains a matching request
function folderHasMatch(collection, folderId, filter) {
  const direct = collection.requests.some(
    (r) => r.folderId === folderId && matchesFilter(r, filter)
  );
  if (direct) return true;
  return (collection.folders || [])
    .filter((f) => f.parentId === folderId)
    .some((f) => folderHasMatch(collection, f.id, filter));
}

export function renderCollections(handlers) {
  const {
    onOpenRequest,
    onAddRequest,
    onAddFolder,
    onRenameFolder,
    onDeleteFolder,
    onDuplicateRequest,
    onMoveRequest,
    onReorderRequest,
    onDeleteRequest,
    onDeleteCollection,
    onRenameCollection,
    onDuplicateCollection,
    onRunCollection,
    onExportCollection,
    onShare,
    onPublishDocs,
    onCopyCurl,
    canEdit,
    filter = '',
  } = handlers;

  const list = document.getElementById('collections-list');
  list.textContent = '';

  if (state.collections.length === 0) {
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent = 'No collections yet. Create one or import a Postman collection.';
    list.appendChild(note);
    return;
  }

  const requestItem = (collection, req) => {
    const item = document.createElement('div');
    item.className = 'request-item';
    if (req.id === state.activeRequestId) item.classList.add('active');

    const nameEl = document.createElement('span');
    nameEl.className = 'req-name';
    nameEl.textContent = req.name;
    nameEl.title = req.url || req.name;

    item.append(methodTag(req.method), nameEl);
    if (req.favorite) {
      const star = document.createElement('span');
      star.className = 'req-fav';
      star.appendChild(iconElFilled('star', 12));
      star.title = 'Favorite';
      item.appendChild(star);
    }
    if (canEdit) {
      const optionsBtn = document.createElement('button');
      optionsBtn.className = 'menu-btn';
      optionsBtn.innerHTML = iconSvg('more', 15);
      optionsBtn.title = 'Options';
      optionsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const actions = [
          { icon: 'copy', label: 'Duplicate', onClick: () => onDuplicateRequest(collection, req) },
          { icon: 'code', label: 'Copy as cURL', onClick: () => onCopyCurl(collection, req) },
          { icon: 'arrowUp', label: 'Move up', onClick: () => onReorderRequest(collection, req, -1) },
          { icon: 'arrowDown', label: 'Move down', onClick: () => onReorderRequest(collection, req, 1) },
          { icon: 'folderIn', label: 'Move to folder…', onClick: () => onMoveRequest(collection, req) },
          { icon: 'trash', label: 'Delete', danger: true, onClick: () => onDeleteRequest(collection, req) }
        ];
        showDropdown(optionsBtn, actions);
      });
      item.appendChild(optionsBtn);
    }
    item.addEventListener('click', () => onOpenRequest(collection, req));
    return item;
  };

  // Renders folders + requests under one parent (null = collection root).
  const renderLevel = (collection, parentId, container, depth) => {
    const subFolders = (collection.folders || []).filter((f) => f.parentId === parentId);

    subFolders.forEach((folder) => {
      if (filter && !folderHasMatch(collection, folder.id, filter)) return;
      if (depth > 6) return; // guard against pathological nesting

      const isOpen = filter ? true : expandedFolders.has(folder.id);

      const header = document.createElement('div');
      header.className = 'folder-header';
      header.style.paddingLeft = `${10 + depth * 14}px`;

      const caret = document.createElement('span');
      caret.className = 'tree-caret';
      caret.appendChild(iconEl(isOpen ? 'chevronDown' : 'chevronRight', 13));
      const nameEl = document.createElement('span');
      nameEl.className = 'folder-name';
      nameEl.append(iconEl('folder', 13), document.createTextNode(folder.name));

      header.append(caret, nameEl);
      if (canEdit) {
        const optionsBtn = document.createElement('button');
        optionsBtn.className = 'menu-btn';
        optionsBtn.innerHTML = iconSvg('more', 15);
        optionsBtn.title = 'Options';
        optionsBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const actions = [
            { icon: 'plus', label: 'Add request here', onClick: () => onAddRequest(collection, folder.id) },
            { icon: 'folder', label: 'Add subfolder', onClick: () => onAddFolder(collection, folder.id) },
            { icon: 'pencil', label: 'Rename folder', onClick: () => onRenameFolder(collection, folder) },
            { icon: 'trash', label: 'Delete folder', danger: true, onClick: () => onDeleteFolder(collection, folder) }
          ];
          showDropdown(optionsBtn, actions);
        });
        header.appendChild(optionsBtn);
      }
      header.addEventListener('click', () => {
        if (expandedFolders.has(folder.id)) expandedFolders.delete(folder.id);
        else expandedFolders.add(folder.id);
        renderCollections(handlers);
      });
      container.appendChild(header);

      if (isOpen) {
        const inner = document.createElement('div');
        renderLevel(collection, folder.id, inner, depth + 1);
        container.appendChild(inner);
      }
    });

    collection.requests
      .filter((r) => (r.folderId || null) === parentId && matchesFilter(r, filter))
      .forEach((req) => {
        const item = requestItem(collection, req);
        item.style.paddingLeft = `${18 + depth * 14}px`;
        container.appendChild(item);
      });
  };

  state.collections.forEach((collection) => {
    if (
      filter &&
      !collection.requests.some((r) => matchesFilter(r, filter)) &&
      !collection.name.toLowerCase().includes(filter.toLowerCase())
    ) {
      return;
    }

    const box = document.createElement('div');
    box.className = 'collection';

    const header = document.createElement('div');
    header.className = 'collection-header';

    const caret = document.createElement('span');
    caret.className = 'tree-caret';
    // A lone collection starts open, but the user can still collapse it.
    const defaultOpen = state.collections.length === 1;
    const isOpen =
      Boolean(filter) ||
      expandedCollections.has(collection.id) ||
      (defaultOpen && !collapsedCollections.has(collection.id));
    caret.appendChild(iconEl(isOpen ? 'chevronDown' : 'chevronRight', 13));

    const name = document.createElement('span');
    name.className = 'collection-name';
    name.textContent = collection.name;

    header.append(caret, name);
    const collectionActions = [];
    if (canEdit) {
      collectionActions.push({ icon: 'plus', label: 'New request tab', onClick: () => onAddRequest(collection, null) });
      collectionActions.push({ icon: 'folder', label: 'Add folder', onClick: () => onAddFolder(collection, null) });
    }
    if (canEdit && !state.shared) {
      collectionActions.push({ icon: 'pencil', label: 'Rename collection', onClick: () => onRenameCollection(collection) });
      collectionActions.push({ icon: 'copy', label: 'Duplicate collection', onClick: () => onDuplicateCollection(collection) });
    }
    collectionActions.push({ icon: 'play', label: 'Run all requests', onClick: () => onRunCollection(collection) });
    if (!state.shared) {
      collectionActions.push({ icon: 'share', label: 'Share', onClick: () => onShare(collection) });
      collectionActions.push({ icon: 'fileText', label: 'Publish API docs', onClick: () => onPublishDocs(collection) });
      collectionActions.push({ icon: 'download', label: 'Export collection', onClick: () => onExportCollection(collection) });
    }
    if (canEdit && !state.shared) {
      collectionActions.push({ icon: 'trash', label: 'Delete collection', danger: true, onClick: () => onDeleteCollection(collection) });
    }

    if (collectionActions.length > 0) {
      const optionsBtn = document.createElement('button');
      optionsBtn.className = 'menu-btn';
      optionsBtn.innerHTML = iconSvg('more', 15);
      optionsBtn.title = 'Options';
      optionsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showDropdown(optionsBtn, collectionActions);
      });
      header.appendChild(optionsBtn);
    }
    header.addEventListener('click', () => {
      if (isOpen) {
        expandedCollections.delete(collection.id);
        collapsedCollections.add(collection.id);
      } else {
        expandedCollections.add(collection.id);
        collapsedCollections.delete(collection.id);
      }
      renderCollections(handlers);
    });

    box.appendChild(header);

    if (isOpen) {
      const body = document.createElement('div');
      body.className = 'collection-requests';
      renderLevel(collection, null, body, 0);
      if (!body.hasChildNodes()) {
        const note = document.createElement('div');
        note.className = 'empty-note';
        note.textContent = filter ? 'No matches' : 'Empty — add a request from the menu';
        body.appendChild(note);
      }
      box.appendChild(body);
    }

    list.appendChild(box);
  });

  if (!list.hasChildNodes()) {
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent = 'Nothing matches your search';
    list.appendChild(note);
  }
}

export function renderHistory({ onPick }) {
  const list = document.getElementById('history-list');
  list.textContent = '';

  const entries = getHistory();
  if (entries.length === 0) {
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent = 'No requests sent yet';
    list.appendChild(note);
    return;
  }

  entries.forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'history-item';

    const url = document.createElement('span');
    url.className = 'hist-url';
    url.textContent = entry.url;
    url.title = entry.url;

    item.append(methodTag(entry.method), url);
    item.addEventListener('click', () => onPick(entry));
    list.appendChild(item);
  });
}
