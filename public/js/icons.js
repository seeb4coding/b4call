// A small stroke-based icon set (24px grid, currentColor, 1.75 weight) so the
// UI stops relying on emoji — which render differently on every platform and
// never match the surrounding text colour.
//
// Two ways to use it:
//   • markup:  <button data-icon="save">Save</button>  → hydrateIcons() fills it
//   • script:  iconEl('trash')                         → an <svg> element

const PATHS = {
  /* navigation & general */
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m5 13 4 4L19 7"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowDown: '<path d="M12 5v14M18 13l-6 6-6-6"/>',
  externalLink: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-.6 4"/><path d="M20 5v6h-6"/>',

  /* files & collections */
  folder: '<path d="M3 7a1 1 0 0 1 1-1h5l2 2.5h8a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z"/>',
  folderIn: '<path d="M3 7a1 1 0 0 1 1-1h5l2 2.5h8a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z"/><path d="M9 13h6m-2.5-2.5L15 13l-2.5 2.5"/>',
  fileText: '<path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4Z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="1.5"/><path d="M6 15H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1"/>',
  trash: '<path d="M4 7h16M10 7V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2"/><path d="M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12"/><path d="M10 11v6M14 11v6"/>',
  pencil: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="M15 6l3 3"/>',
  paperclip: '<path d="M20 11.5 12 19.5a4.5 4.5 0 0 1-6.4-6.4l8.4-8.4a3 3 0 0 1 4.3 4.3l-8.4 8.4a1.5 1.5 0 0 1-2.2-2.1l7.7-7.7"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  download: '<path d="M12 4v12m-5-5 5 5 5-5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><path d="M10 13h4"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',

  /* actions */
  send: '<path d="M21 3 3 10.5l7 3 3 7L21 3Z"/><path d="m10 13.5 4-4"/>',
  play: '<path d="M7 4.5 19 12 7 19.5v-15Z"/>',
  save: '<path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  code: '<path d="m9 8-5 4 5 4M15 8l5 4-5 4"/>',
  link: '<path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7L11.6 6.7"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.3 2.3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.3 10.8 7.4-4.3m0 11-7.4-4.3"/>',
  star: '<path d="m12 4 2.5 5.2 5.5.8-4 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4-3.9 5.5-.8L12 4Z"/>',
  pin: '<path d="M15 3 21 9l-4 1-4.5 4.5L11 19l-6-6 4.5-1.5L14 7l1-4Z"/><path d="m9 15-5 5"/>',
  printer: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="7" rx="1"/><path d="M7 14h10v6H7v-6Z"/>',
  diff: '<path d="M7 7H4l3-3m0 3v13"/><path d="M17 17h3l-3 3m0-3V4"/>',
  schema: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 9h18M9 9v11"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><circle cx="8.5" cy="10" r="1.5"/><path d="m5 17 4.5-4.5L13 16l2.5-2.5L20 18"/>',

  /* variables, security, network */
  braces: '<path d="M9 4c-2 0-2.5 1.2-2.5 3S6 10.5 4.5 10.5c1.5 0 2 1.7 2 3.5s.5 3 2.5 3"/><path d="M15 4c2 0 2.5 1.2 2.5 3s.5 3.5 2 3.5c-1.5 0-2 1.7-2 3.5s-.5 3-2.5 3"/>',
  lock: '<rect x="4.5" y="10" width="15" height="10" rx="1.5"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>',
  unlock: '<rect x="4.5" y="10" width="15" height="10" rx="1.5"/><path d="M8 10V7.5a4 4 0 0 1 7.6-1.7"/>',
  cookie: '<path d="M12 3a9 9 0 1 0 9 9 4 4 0 0 1-5-5 3.5 3.5 0 0 1-4-4Z"/><circle cx="9" cy="12" r="1"/><circle cx="13" cy="15.5" r="1"/><circle cx="15" cy="10" r="1"/>',
  flask: '<path d="M10 3v6L4.6 18A1.5 1.5 0 0 0 6 20.2h12A1.5 1.5 0 0 0 19.4 18L14 9V3"/><path d="M9 3h6M7.5 14h9"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5a14 14 0 0 1 0 17 14 14 0 0 1 0-17Z"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="1.5"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M6 13.5h.01M18 13.5h.01M9.5 13.5h5"/>',
  palette: '<path d="M12 3a9 9 0 0 0 0 18 2 2 0 0 0 1.6-3.2 2 2 0 0 1 1.6-3.2H18a3 3 0 0 0 3-3c0-4.8-4-8.6-9-8.6Z"/><circle cx="7.5" cy="12" r="1"/><circle cx="10" cy="8" r="1"/><circle cx="14.5" cy="7.5" r="1"/>',

  /* collaboration */
  chat: '<path d="M20 12a7 7 0 0 1-7 7H8l-4 3v-4.3A7 7 0 0 1 4 12a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7Z"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 5.3a3.2 3.2 0 0 1 0 5.4M17.5 14.2A5.5 5.5 0 0 1 20.5 19"/>',
  history: '<path d="M4 12a8 8 0 1 1 2.6 5.9"/><path d="M4 8v4h4"/><path d="M12 8v4.5l3 1.8"/>',
  comment: '<path d="M20 5.5a1.5 1.5 0 0 0-1.5-1.5h-13A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8l3 4 3-4h4.5a1.5 1.5 0 0 0 1.5-1.5v-9Z"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.8 9.5a2.3 2.3 0 1 1 3 2.2c-.5.2-.8.7-.8 1.3v.5"/><path d="M12 16.8h.01"/>',
};

const DEFAULT_SIZE = 15;

export function iconSvg(name, size = DEFAULT_SIZE) {
  const body = PATHS[name];
  if (!body) return '';
  return (
    `<svg class="icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ` +
    'stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" ' +
    `aria-hidden="true" focusable="false">${body}</svg>`
  );
}

export function iconEl(name, size = DEFAULT_SIZE) {
  const wrap = document.createElement('span');
  wrap.className = 'icon-wrap';
  wrap.innerHTML = iconSvg(name, size);
  return wrap.firstElementChild || wrap;
}

// A filled variant, used for the "this is on" state of toggles like Favorite.
export function iconElFilled(name, size = DEFAULT_SIZE) {
  const svg = iconEl(name, size);
  if (svg.tagName === 'svg') svg.setAttribute('fill', 'currentColor');
  return svg;
}

export function hasIcon(name) {
  return Boolean(PATHS[name]);
}

// Fills every element carrying data-icon="name" with its glyph, once.
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (el.dataset.iconDone === '1') return;
    const name = el.dataset.icon;
    if (!hasIcon(name)) return;
    el.dataset.iconDone = '1';
    el.insertAdjacentHTML('afterbegin', iconSvg(name, Number(el.dataset.iconSize) || DEFAULT_SIZE));
    el.classList.add('has-icon');
    if (!el.textContent.trim()) {
      el.classList.add('icon-only');
      if (!el.getAttribute('aria-label') && el.title) el.setAttribute('aria-label', el.title);
    }
  });
}
