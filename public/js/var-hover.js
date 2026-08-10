import { lookupVar } from './vars.js';

let tooltip = null;
let currentScopesProvider = null;

// Track dynamically-mirrored inputs
const dynamicMirrors = new WeakMap();

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---- Mirror sync: colors {{variables}} in-place ----

function syncMirror(input, mirror) {
  const value = input.value || '';

  if (!value.includes('{{')) {
    mirror.innerHTML = '';
    input.classList.remove('var-input-transparent');
    return;
  }

  const scopes = currentScopesProvider
    ? currentScopesProvider()
    : { environment: null, collection: null, globals: {}, vault: {} };

  // Build colorized HTML
  const parts = [];
  let lastIdx = 0;
  const regex = /\{\{\s*([\w.:-]+)\s*\}\}/g;
  let m;

  while ((m = regex.exec(value)) !== null) {
    if (m.index > lastIdx) {
      parts.push(escapeHtml(value.slice(lastIdx, m.index)));
    }
    const resolved = lookupVar(m[1], scopes);
    const scope = resolved ? resolved.scope : 'none';
    parts.push(`<span class="var-hl var-hl-${scope}">${escapeHtml(m[0])}</span>`);
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < value.length) {
    parts.push(escapeHtml(value.slice(lastIdx)));
  }

  mirror.innerHTML = parts.join('');

  // Copy font metrics from input to mirror so text aligns pixel-perfectly
  const cs = window.getComputedStyle(input);
  mirror.style.fontFamily = cs.fontFamily;
  mirror.style.fontSize = cs.fontSize;
  mirror.style.fontWeight = cs.fontWeight;
  mirror.style.lineHeight = cs.lineHeight;
  mirror.style.letterSpacing = cs.letterSpacing;
  mirror.style.padding = cs.padding;

  // Sync scroll position
  mirror.scrollLeft = input.scrollLeft;

  // Make the real input text transparent so the colored mirror shows through
  input.classList.add('var-input-transparent');
}

// ---- Dynamic mirror: wrap any input that contains {{ ----

function ensureDynamicMirror(input) {
  // Skip the static URL input — it's handled in HTML
  if (input.id === 'url') return null;

  // Already wrapped?
  if (dynamicMirrors.has(input)) {
    const info = dynamicMirrors.get(input);
    // Make sure it's still in the DOM
    if (info.wrapper.parentNode) return info;
    // Orphaned — clean up
    dynamicMirrors.delete(input);
  }

  // Already inside a mirror wrap (e.g. re-rendered)?
  if (input.parentNode && input.parentNode.classList.contains('var-mirror-wrap')) {
    const mirror = input.parentNode.querySelector('.var-mirror');
    if (mirror) {
      const info = { wrapper: input.parentNode, mirror };
      dynamicMirrors.set(input, info);
      return info;
    }
  }

  // Create wrapper + mirror
  const wrapper = document.createElement('div');
  wrapper.className = 'var-mirror-wrap';

  const mirror = document.createElement('div');
  mirror.className = 'var-mirror';

  // Insert wrapper before input, then move input inside
  input.parentNode.insertBefore(wrapper, input);
  wrapper.appendChild(mirror);
  wrapper.appendChild(input);

  // Scroll sync
  input.addEventListener('scroll', () => { mirror.scrollLeft = input.scrollLeft; });

  const info = { wrapper, mirror };
  dynamicMirrors.set(input, info);
  return info;
}

function removeDynamicMirror(input) {
  if (input.id === 'url') return;
  const info = dynamicMirrors.get(input);
  if (!info) return;

  // Move input back to its original position, remove wrapper
  if (info.wrapper.parentNode) {
    info.wrapper.parentNode.insertBefore(input, info.wrapper);
    info.wrapper.remove();
  }
  input.classList.remove('var-input-transparent');
  dynamicMirrors.delete(input);
}

function syncDynamicInput(input) {
  if (input.id === 'url') return; // handled statically

  const value = input.value || '';

  if (!value.includes('{{')) {
    // No variables — unwrap if it was wrapped
    if (dynamicMirrors.has(input)) {
      removeDynamicMirror(input);
    }
    return;
  }

  // Has variables — ensure mirror exists and sync
  const info = ensureDynamicMirror(input);
  if (info) {
    syncMirror(input, info.mirror);
  }
}

// ---- Tooltip on hover ----

function getCharIndex(el, event) {
  const cs = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const padL = parseFloat(cs.paddingLeft) || 0;
  const borL = parseFloat(cs.borderLeftWidth) || 0;
  const x = event.clientX - rect.left - padL - borL + el.scrollLeft;

  const cvs = getCharIndex._c || (getCharIndex._c = document.createElement('canvas'));
  const ctx = cvs.getContext('2d');
  ctx.font = `${cs.fontSize} ${cs.fontFamily}`;

  const text = el.value;
  let best = 0, bestD = Infinity;
  for (let i = 0; i <= text.length; i++) {
    const d = Math.abs(ctx.measureText(text.substring(0, i)).width - x);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function getRangeRect(el, start, end) {
  const cs = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const padL = parseFloat(cs.paddingLeft) || 0;
  const borL = parseFloat(cs.borderLeftWidth) || 0;

  const cvs = getRangeRect._c || (getRangeRect._c = document.createElement('canvas'));
  const ctx = cvs.getContext('2d');
  ctx.font = `${cs.fontSize} ${cs.fontFamily}`;

  const text = el.value;
  const sx = ctx.measureText(text.substring(0, start)).width;
  const ex = ctx.measureText(text.substring(0, end)).width;
  return {
    left: rect.left + padL + borL - el.scrollLeft + sx,
    width: ex - sx,
    top: rect.top,
    bottom: rect.bottom,
  };
}

function hideTooltip() {
  if (tooltip) {
    tooltip.classList.remove('visible');
    setTimeout(() => {
      if (!tooltip.classList.contains('visible')) tooltip.classList.add('hidden');
    }, 150);
  }
}

function showTooltip(name, rects) {
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'var-tooltip hidden';
    document.body.appendChild(tooltip);
  }

  const scopes = currentScopesProvider ? currentScopesProvider() : {};
  const resolved = lookupVar(name, scopes);
  tooltip.textContent = '';

  const header = document.createElement('div');
  header.className = 'var-tooltip-header';

  const scope = resolved ? resolved.scope : 'none';
  const badge = document.createElement('span');
  badge.className = `scope-badge scope-${scope}`;
  badge.textContent = scope === 'none' ? '?' : scope;

  const nameEl = document.createElement('span');
  nameEl.className = 'var-tooltip-name';
  nameEl.textContent = name;
  header.append(badge, nameEl);

  const valEl = document.createElement('div');
  valEl.className = resolved ? 'var-tooltip-value' : 'var-tooltip-value var-unresolved';
  valEl.textContent = resolved ? resolved.value : 'unresolved';

  tooltip.append(header, valEl);
  tooltip.classList.remove('hidden');

  const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
  let top = rects.top - th - 8;
  let left = rects.left + rects.width / 2 - tw / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
  if (top < 8) top = rects.bottom + 8;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
  tooltip.classList.add('visible');
}

function handleMouseMove(e) {
  const el = e.target;
  if (!((el.tagName === 'INPUT' && el.type === 'text') || el.tagName === 'TEXTAREA')) {
    hideTooltip(); return;
  }
  const value = el.value;
  if (!value || !value.includes('{{')) { hideTooltip(); return; }

  const idx = getCharIndex(el, e);
  const regex = /\{\{\s*([\w.:-]+)\s*\}\}/g;
  let m, found = false;
  while ((m = regex.exec(value)) !== null) {
    if (idx >= m.index && idx <= regex.lastIndex) {
      showTooltip(m[1], getRangeRect(el, m.index, regex.lastIndex));
      found = true;
      break;
    }
  }
  if (!found) hideTooltip();
}

// ---- Public API ----

function syncAllInputs() {
  // Static URL input
  const urlInput = document.getElementById('url');
  const urlMirror = document.getElementById('url-mirror');
  if (urlInput && urlMirror) syncMirror(urlInput, urlMirror);

  // All other inputs/textareas in the workspace
  const workspace = document.querySelector('.workspace');
  if (!workspace) return;

  const inputs = workspace.querySelectorAll('input, textarea');
  inputs.forEach(input => {
    if (input.id === 'url') return; // already handled
    if (input.type && input.type !== 'text') return; // skip checkboxes, radios, files
    syncDynamicInput(input);
  });
}

export function updateAllHighlights() {
  syncAllInputs();
}

export function initVarHover(getScopesFn) {
  currentScopesProvider = getScopesFn;

  const workspace = document.querySelector('.workspace');
  const urlInput = document.getElementById('url');
  const urlMirror = document.getElementById('url-mirror');

  // Tooltip on hover
  workspace.addEventListener('mousemove', handleMouseMove, { passive: true });
  workspace.addEventListener('mouseleave', hideTooltip);

  // Sync static URL mirror on every keystroke
  if (urlInput && urlMirror) {
    urlInput.addEventListener('input', () => syncMirror(urlInput, urlMirror));
    urlInput.addEventListener('scroll', () => { urlMirror.scrollLeft = urlInput.scrollLeft; });
    syncMirror(urlInput, urlMirror);
  }

  // Capture-phase input listener for ALL inputs in workspace (including dynamic KV rows)
  workspace.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'url') return; // handled above
    if ((el.tagName === 'INPUT' && (!el.type || el.type === 'text')) || el.tagName === 'TEXTAREA') {
      syncDynamicInput(el);
    }
  }, true);

  document.addEventListener('scroll', hideTooltip, true);
  window.addEventListener('resize', () => { hideTooltip(); updateAllHighlights(); });

  // Periodic sync for programmatic value changes and newly rendered inputs
  setInterval(syncAllInputs, 500);
}
