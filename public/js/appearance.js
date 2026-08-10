// Theme, type size, density and accent colour. Everything is a CSS custom
// property on :root, so a change applies instantly with no re-render.

import { openModal, toast } from './modal.js';
import { isKeyboardModeOn, setKeyboardMode } from './keyboard.js';
import { THEMES, DEFAULT_THEME, applyThemeAttributes } from './themes.js';

const KEY = 'b4call-appearance';

export { THEMES };

// The first three are lifted straight off the logo.
const ACCENTS = [
  ['', 'Theme default'],
  ['#7c5cff', 'Brand violet'],
  ['#f97316', 'Astronaut orange'],
  ['#e83e8c', 'Thruster magenta'],
  ['#4c8dff', 'Azure'],
  ['#4caf7d', 'Mint'],
  ['#e0b23d', 'Amber'],
];

const DEFAULTS = {
  theme: DEFAULT_THEME,
  fontSize: 13,
  monoSize: 12.5,
  density: 'comfortable', // comfortable | compact
  accent: '',
  radius: 6,
};

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY));
    if (parsed && typeof parsed === 'object') return { ...DEFAULTS, ...parsed };
  } catch {
    /* fall through */
  }
  // Carry over the pre-Appearance theme picker's choice.
  const legacyTheme = localStorage.getItem('b4call-theme');
  return { ...DEFAULTS, ...(legacyTheme ? { theme: legacyTheme } : {}) };
}

function write(settings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
  localStorage.setItem('b4call-theme', settings.theme);
}

let current = read();

export function getAppearance() {
  return { ...current };
}

export function applyAppearance(settings = current) {
  current = { ...DEFAULTS, ...settings };
  const root = document.documentElement;

  applyThemeAttributes(current.theme);
  root.setAttribute('data-density', current.density);
  root.style.setProperty('--ui-font-size', `${current.fontSize}px`);
  root.style.setProperty('--mono-font-size', `${current.monoSize}px`);
  root.style.setProperty('--radius', `${current.radius}px`);

  if (current.accent) {
    root.style.setProperty('--accent', current.accent);
    root.style.setProperty('--accent-hover', lighten(current.accent, 0.15));
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-hover');
  }

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.content = getComputedStyle(root).getPropertyValue('--bg-panel').trim() || '#1e293b';
  }
}

function lighten(hex, amount) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!match) return hex;
  const value = parseInt(match[1], 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((c) =>
    Math.round(c + (255 - c) * amount)
  );
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export function initAppearance() {
  applyAppearance(current);

  // The top bar keeps a quick theme switcher; the dialog holds the rest.
  const select = document.querySelector('#theme-select');
  if (select) {
    select.textContent = '';
    THEMES.forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    });
    select.value = current.theme;
    select.addEventListener('change', () => {
      current = { ...current, theme: select.value };
      write(current);
      applyAppearance(current);
    });
  }
}

/* ---------------- dialog ---------------- */

function labelledRow(labelText, control, hint) {
  const row = document.createElement('label');
  row.className = 'setting-row';
  const text = document.createElement('span');
  text.textContent = labelText;
  if (hint) {
    const small = document.createElement('small');
    small.className = 'setting-hint';
    small.textContent = hint;
    text.appendChild(small);
  }
  row.append(text, control);
  return row;
}

export function openAppearanceDialog() {
  const draft = { ...current };
  const preview = () => applyAppearance(draft);

  const themeSelect = document.createElement('select');
  THEMES.forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    themeSelect.appendChild(option);
  });
  themeSelect.value = draft.theme;
  themeSelect.addEventListener('change', () => {
    draft.theme = themeSelect.value;
    preview();
  });

  const accentRow = document.createElement('div');
  accentRow.className = 'swatch-row';
  ACCENTS.forEach(([value, label]) => {
    const dot = document.createElement('button');
    dot.className = `swatch${value === draft.accent ? ' active' : ''}`;
    dot.title = label;
    if (value) dot.style.background = value;
    else dot.classList.add('swatch-default');
    dot.addEventListener('click', () => {
      draft.accent = value;
      [...accentRow.children].forEach((c) => c.classList.remove('active'));
      dot.classList.add('active');
      preview();
    });
    accentRow.appendChild(dot);
  });

  const fontSize = document.createElement('input');
  fontSize.type = 'range';
  fontSize.min = '11';
  fontSize.max = '18';
  fontSize.step = '0.5';
  fontSize.value = String(draft.fontSize);
  const fontValue = document.createElement('span');
  fontValue.className = 'range-value';
  fontValue.textContent = `${draft.fontSize}px`;
  fontSize.addEventListener('input', () => {
    draft.fontSize = Number(fontSize.value);
    fontValue.textContent = `${draft.fontSize}px`;
    preview();
  });
  const fontWrap = document.createElement('span');
  fontWrap.className = 'range-wrap';
  fontWrap.append(fontSize, fontValue);

  const monoSize = document.createElement('input');
  monoSize.type = 'range';
  monoSize.min = '10';
  monoSize.max = '18';
  monoSize.step = '0.5';
  monoSize.value = String(draft.monoSize);
  const monoValue = document.createElement('span');
  monoValue.className = 'range-value';
  monoValue.textContent = `${draft.monoSize}px`;
  monoSize.addEventListener('input', () => {
    draft.monoSize = Number(monoSize.value);
    monoValue.textContent = `${draft.monoSize}px`;
    preview();
  });
  const monoWrap = document.createElement('span');
  monoWrap.className = 'range-wrap';
  monoWrap.append(monoSize, monoValue);

  const density = document.createElement('select');
  [['comfortable', 'Comfortable'], ['compact', 'Compact']].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    density.appendChild(option);
  });
  density.value = draft.density;
  density.addEventListener('change', () => {
    draft.density = density.value;
    preview();
  });

  const radius = document.createElement('input');
  radius.type = 'range';
  radius.min = '0';
  radius.max = '14';
  radius.step = '1';
  radius.value = String(draft.radius);
  const radiusValue = document.createElement('span');
  radiusValue.className = 'range-value';
  radiusValue.textContent = `${draft.radius}px`;
  radius.addEventListener('input', () => {
    draft.radius = Number(radius.value);
    radiusValue.textContent = `${draft.radius}px`;
    preview();
  });
  const radiusWrap = document.createElement('span');
  radiusWrap.className = 'range-wrap';
  radiusWrap.append(radius, radiusValue);

  const keyboard = document.createElement('input');
  keyboard.type = 'checkbox';
  keyboard.checked = isKeyboardModeOn();

  const sample = document.createElement('div');
  sample.className = 'appearance-sample';
  sample.innerHTML = `
    <div class="appearance-sample-row"><span class="method-tag method-GET">GET</span> <b>List users</b></div>
    <pre class="appearance-sample-code">{ "id": 42, "name": "Ada", "active": true }</pre>
    <div class="appearance-sample-row"><span class="status-chip status-2xx">200 OK</span> <span class="response-meta">128 ms · 2.4 KB</span></div>`;

  openModal(
    'Appearance',
    [
      labelledRow('Theme', themeSelect),
      labelledRow('Accent colour', accentRow),
      labelledRow('Interface text', fontWrap, 'Menus, labels, sidebar'),
      labelledRow('Code text', monoWrap, 'Bodies, responses, editors'),
      labelledRow('Density', density, 'Compact tightens padding and row height'),
      labelledRow('Corner rounding', radiusWrap),
      labelledRow('Single-key shortcuts', keyboard, 'j/k, /, t, s and g-chords'),
      sample,
    ],
    [
      {
        label: 'Reset',
        onClick: () => {
          Object.assign(draft, DEFAULTS);
          themeSelect.value = draft.theme;
          fontSize.value = String(draft.fontSize);
          fontValue.textContent = `${draft.fontSize}px`;
          monoSize.value = String(draft.monoSize);
          monoValue.textContent = `${draft.monoSize}px`;
          density.value = draft.density;
          radius.value = String(draft.radius);
          radiusValue.textContent = `${draft.radius}px`;
          [...accentRow.children].forEach((c, i) => c.classList.toggle('active', i === 0));
          preview();
        },
      },
      {
        label: 'Cancel',
        onClick: (close) => {
          applyAppearance(read());
          close();
        },
      },
      {
        label: 'Save',
        primary: true,
        onClick: (close) => {
          current = { ...draft };
          write(current);
          applyAppearance(current);
          setKeyboardMode(keyboard.checked);
          const select = document.querySelector('#theme-select');
          if (select) select.value = current.theme;
          toast('Appearance saved');
          close();
        },
      },
    ]
  );
}
