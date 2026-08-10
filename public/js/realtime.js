// Live collaboration on a shared link.
//
// Everyone who opens /s/<token> joins a room over Server-Sent Events. The room
// carries presence (who is here, which request they're looking at), transient
// "X is editing" signals, a small chat, and change notifications so a save by
// one person refreshes everyone else's sidebar within a second.

import { getIdentity, setIdentity, initialsOf, identityColors } from './identity.js';
import { openModal, toast } from './modal.js';
import { iconSvg, iconEl } from './icons.js';

let source = null;
let token = null;
let people = [];
let deps = {
  onChanged: () => {},
  getActiveRequest: () => ({ id: null, name: '' }),
};
let editingTimers = new Map();
let chatLog = [];
let unreadChat = 0;

const $ = (sel) => document.querySelector(sel);

function post(path, body) {
  return fetch(`/api/realtime/${token}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: getIdentity().clientId, ...body }),
  }).catch(() => {
    /* presence is best-effort — a dropped beat is not worth an error toast */
  });
}

export function isConnected() {
  return source !== null;
}

export function connect(shareToken, dependencies = {}) {
  disconnect();
  token = shareToken;
  deps = { ...deps, ...dependencies };

  const me = getIdentity();
  const params = new URLSearchParams({
    clientId: me.clientId,
    name: me.name,
    color: me.color,
  });
  source = new EventSource(`/api/realtime/${token}/stream?${params}`);

  source.addEventListener('hello', (e) => {
    people = JSON.parse(e.data).people || [];
    renderPresence();
    announceActiveRequest();
  });

  source.addEventListener('presence', (e) => {
    people = JSON.parse(e.data).people || [];
    renderPresence();
  });

  source.addEventListener('joined', (e) => {
    const { person } = JSON.parse(e.data);
    toast(`${person.name} joined`);
  });

  source.addEventListener('left', (e) => {
    const { name } = JSON.parse(e.data);
    toast(`${name} left`);
  });

  source.addEventListener('changed', (e) => {
    const change = JSON.parse(e.data);
    const what = change.requestName ? `“${change.requestName}”` : 'the collection';
    toast(`${change.by} ${change.action} ${what}`);
    deps.onChanged(change);
  });

  source.addEventListener('editing', (e) => {
    showEditingHint(JSON.parse(e.data));
  });

  source.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    chatLog = [...chatLog, msg].slice(-100);
    if (msg.clientId !== getIdentity().clientId) {
      unreadChat += 1;
      toast(`${msg.name}: ${msg.text.slice(0, 60)}`);
    }
    renderChatLog();
    renderPresence();
  });

  source.onerror = () => {
    // EventSource reconnects on its own; just reflect the state in the strip.
    renderPresence({ reconnecting: true });
  };
}

export function disconnect() {
  if (source) {
    source.close();
    source = null;
  }
  people = [];
  editingTimers.forEach((timer) => clearTimeout(timer));
  editingTimers = new Map();
  renderPresence();
}

/* ---------------- presence strip ---------------- */

function presenceContainer() {
  let strip = $('#presence-strip');
  if (!strip) {
    strip = document.createElement('div');
    strip.id = 'presence-strip';
    strip.className = 'presence-strip';
    $('#share-banner')?.after(strip);
  }
  return strip;
}

function renderPresence({ reconnecting = false } = {}) {
  const strip = presenceContainer();
  strip.textContent = '';
  if (!token || !source) {
    strip.classList.add('hidden');
    return;
  }
  strip.classList.remove('hidden');

  const label = document.createElement('span');
  label.className = 'presence-label has-icon';
  label.appendChild(iconEl('users', 13));
  label.append(
    document.createTextNode(reconnecting ? 'Reconnecting…' : `${people.length} here`)
  );
  strip.appendChild(label);

  const me = getIdentity();
  people.forEach((person) => {
    const chip = document.createElement('span');
    chip.className = `presence-chip${person.clientId === me.clientId ? ' is-me' : ''}`;
    chip.style.background = person.color || '#888';
    chip.textContent = initialsOf(person.name);
    chip.title = person.requestName
      ? `${person.name} — viewing ${person.requestName}`
      : person.name;
    strip.appendChild(chip);
  });

  const nameBtn = document.createElement('button');
  nameBtn.className = 'link-btn has-icon';
  nameBtn.innerHTML = iconSvg('pencil', 12);
  nameBtn.append(document.createTextNode(`You are ${me.name}`));
  nameBtn.addEventListener('click', openIdentityDialog);
  strip.appendChild(nameBtn);

  const chatBtn = document.createElement('button');
  chatBtn.className = 'link-btn has-icon';
  chatBtn.innerHTML = iconSvg('chat', 12);
  chatBtn.append(document.createTextNode(unreadChat ? `Chat (${unreadChat})` : 'Chat'));
  chatBtn.addEventListener('click', openChatDialog);
  strip.appendChild(chatBtn);
}

export function openIdentityDialog() {
  const me = getIdentity();

  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'Display name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = me.name;
  nameInput.maxLength = 40;
  nameLabel.appendChild(nameInput);

  const swatchTitle = document.createElement('div');
  swatchTitle.className = 'vars-title';
  swatchTitle.textContent = 'Colour';

  const swatches = document.createElement('div');
  swatches.className = 'swatch-row';
  let picked = me.color;
  identityColors().forEach((color) => {
    const dot = document.createElement('button');
    dot.className = `swatch${color === picked ? ' active' : ''}`;
    dot.style.background = color;
    dot.addEventListener('click', () => {
      picked = color;
      [...swatches.children].forEach((c) => c.classList.remove('active'));
      dot.classList.add('active');
    });
    swatches.appendChild(dot);
  });

  const note = document.createElement('p');
  note.className = 'modal-note';
  note.textContent =
    'This name labels your presence, your comments and the request history you create. ' +
    'It is not a login — anyone with the link can pick any name.';

  openModal('Your collaborator name', [note, nameLabel, swatchTitle, swatches], [
    { label: 'Cancel', onClick: (close) => close() },
    {
      label: 'Save',
      primary: true,
      onClick: (close) => {
        setIdentity({ name: nameInput.value, color: picked });
        post('presence', { name: nameInput.value, color: picked });
        renderPresence();
        close();
      },
    },
  ]);
}

/* ---------------- editing hints ---------------- */

function showEditingHint({ clientId, name, color, requestId, field }) {
  const active = deps.getActiveRequest();
  if (!requestId || active.id !== requestId) return;

  let hint = $('#editing-hint');
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'editing-hint';
    hint.className = 'editing-hint';
    document.querySelector('.request-title-bar')?.appendChild(hint);
  }
  hint.textContent = '';
  hint.append(iconEl('pencil', 12), document.createTextNode(`${name} is editing${field ? ` the ${field}` : ''}…`));
  hint.style.color = color || 'var(--text-dim)';
  hint.classList.remove('hidden');

  clearTimeout(editingTimers.get(clientId));
  editingTimers.set(
    clientId,
    setTimeout(() => {
      hint.classList.add('hidden');
      editingTimers.delete(clientId);
    }, 3000)
  );
}

// Throttled outbound "I'm typing" signal.
let lastEditingSent = 0;
export function signalEditing(field) {
  if (!source) return;
  const now = Date.now();
  if (now - lastEditingSent < 1500) return;
  lastEditingSent = now;
  const active = deps.getActiveRequest();
  post('editing', { requestId: active.id, field });
}

// Tell the room which request this person is looking at.
export function announceActiveRequest() {
  if (!source) return;
  const active = deps.getActiveRequest();
  post('presence', { requestId: active.id, requestName: active.name });
}

/* ---------------- chat ---------------- */

let chatBody = null;

function renderChatLog() {
  if (!chatBody) return;
  chatBody.textContent = '';
  if (!chatLog.length) {
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent = 'No messages yet. Say hello.';
    chatBody.appendChild(note);
    return;
  }
  chatLog.forEach((msg) => {
    const row = document.createElement('div');
    row.className = 'chat-row';
    const who = document.createElement('span');
    who.className = 'chat-author';
    who.textContent = msg.name;
    who.style.color = msg.color || 'var(--text-dim)';
    const text = document.createElement('span');
    text.className = 'chat-text';
    text.textContent = msg.text;
    const time = document.createElement('span');
    time.className = 'chat-time';
    time.textContent = new Date(msg.at).toLocaleTimeString();
    row.append(who, text, time);
    chatBody.appendChild(row);
  });
  chatBody.scrollTop = chatBody.scrollHeight;
}

function openChatDialog() {
  unreadChat = 0;
  renderPresence();

  const wrap = document.createElement('div');
  chatBody = document.createElement('div');
  chatBody.className = 'chat-log';

  const row = document.createElement('div');
  row.className = 'chat-compose';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Message everyone on this link…';
  input.maxLength = 500;
  const sendBtn = document.createElement('button');
  sendBtn.className = 'btn btn-primary';
  sendBtn.textContent = 'Send';

  const send = () => {
    const text = input.value.trim();
    if (!text) return;
    post('message', { text });
    input.value = '';
  };
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send();
  });

  row.append(input, sendBtn);
  wrap.append(chatBody, row);
  renderChatLog();

  openModal('Collaborators', [wrap], [
    { label: 'Close', primary: true, onClick: (close) => close() },
  ]);
  setTimeout(() => input.focus(), 50);
}
