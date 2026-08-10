// A simple client-side cookie jar. Cookies captured from responses are stored
// per host and replayed on matching requests (host + path prefix).
import { openModal, toast } from './modal.js';

const KEY = 'b4call-cookies';

function readJar() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeJar(jar) {
  localStorage.setItem(KEY, JSON.stringify(jar));
}

function hostOf(url) {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).host;
  } catch {
    return '';
  }
}

// Parse a Set-Cookie string into { name, value, path }.
function parseSetCookie(raw) {
  const [pair, ...attrs] = raw.split(';');
  const eq = pair.indexOf('=');
  if (eq === -1) return null;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  let path = '/';
  attrs.forEach((attr) => {
    const [k, v] = attr.split('=');
    if (k.trim().toLowerCase() === 'path' && v) path = v.trim();
  });
  return { name, value, path };
}

export function captureSetCookies(url, setCookies) {
  if (!Array.isArray(setCookies) || setCookies.length === 0) return;
  const host = hostOf(url);
  if (!host) return;
  const jar = readJar();
  const list = jar[host] || [];
  setCookies.forEach((raw) => {
    const cookie = parseSetCookie(raw);
    if (!cookie) return;
    const idx = list.findIndex((c) => c.name === cookie.name && c.path === cookie.path);
    if (idx === -1) list.push(cookie);
    else list[idx] = cookie;
  });
  jar[host] = list;
  writeJar(jar);
}

export function cookieHeaderFor(url) {
  const host = hostOf(url);
  const list = readJar()[host] || [];
  if (!list.length) return '';
  return list.map((c) => `${c.name}=${c.value}`).join('; ');
}

// Add a Cookie header to a proxy payload if the jar has cookies for its host
// and the request does not already set one.
export function applyCookies(payload) {
  const hasCookie = Object.keys(payload.headers || {}).some((k) => k.toLowerCase() === 'cookie');
  if (hasCookie) return;
  const header = cookieHeaderFor(payload.url);
  if (header) payload.headers['Cookie'] = header;
}

export function openCookieDialog() {
  const jar = readJar();
  const container = document.createElement('div');
  container.className = 'cookie-jar';

  const hosts = Object.keys(jar);
  if (hosts.length === 0) {
    const note = document.createElement('p');
    note.className = 'modal-note';
    note.textContent = 'No cookies stored yet. They are captured automatically from Set-Cookie response headers.';
    container.appendChild(note);
  }

  hosts.forEach((host) => {
    const section = document.createElement('div');
    section.className = 'cookie-host';
    const header = document.createElement('div');
    header.className = 'cookie-host-header';
    const title = document.createElement('span');
    title.className = 'vars-title';
    title.style.margin = '0';
    title.textContent = host;
    const clear = document.createElement('button');
    clear.className = 'link-btn';
    clear.textContent = 'Clear';
    clear.addEventListener('click', () => {
      const next = readJar();
      delete next[host];
      writeJar(next);
      section.remove();
      toast(`Cleared cookies for ${host}`);
    });
    header.append(title, clear);
    section.appendChild(header);

    (jar[host] || []).forEach((cookie) => {
      const row = document.createElement('div');
      row.className = 'var-row';
      const name = document.createElement('span');
      name.className = 'var-name';
      name.textContent = cookie.name;
      const value = document.createElement('span');
      value.className = 'var-value';
      value.textContent = cookie.value;
      value.title = `path=${cookie.path}`;
      row.append(name, value);
      section.appendChild(row);
    });
    container.appendChild(section);
  });

  openModal('Cookie jar', [container], [
    { label: 'Clear all', onClick: (close) => { writeJar({}); toast('All cookies cleared'); close(); } },
    { label: 'Close', primary: true, onClick: (close) => close() },
  ]);
}
