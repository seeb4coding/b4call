import { api } from './api.js';
import { openModal, toast } from './modal.js';
import { copyText } from './clipboard.js';
import { iconSvg } from './icons.js';

export function parseShareToken() {
  const match = location.pathname.match(/^\/s\/([\w-]+)/);
  return match ? match[1] : null;
}

export async function openShareDialog(collection, onModeChanged) {
  let { token, mode } = await api.share(collection.id, collection.shareMode || 'readonly');
  const link = `${location.origin}/s/${token}`;

  const note = document.createElement('p');
  note.className = 'modal-note';
  note.textContent = 'Anyone with this link can open the collection and run its requests — no login needed.';

  const linkRow = document.createElement('div');
  linkRow.className = 'share-link-row';
  const linkInput = document.createElement('input');
  linkInput.type = 'text';
  linkInput.readOnly = true;
  linkInput.value = link;
  linkInput.addEventListener('focus', () => linkInput.select());
  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn btn-primary';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', async () => {
    const ok = await copyText(link);
    toast(ok ? 'Link copied to clipboard' : 'Copy failed — select the link manually');
  });
  linkRow.append(linkInput, copyBtn);

  const modeLabel = document.createElement('label');
  modeLabel.textContent = 'Permission for people with the link';
  const modeSelect = document.createElement('select');
  [['readonly', 'Read-only — can view and run requests'], ['edit', 'Can edit — anyone with the link can change requests']].forEach(
    ([value, text]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = text;
      modeSelect.appendChild(opt);
    }
  );
  modeSelect.value = mode;
  modeSelect.addEventListener('change', async () => {
    const updated = await api.share(collection.id, modeSelect.value);
    mode = updated.mode;
    toast(`Share mode set to ${mode === 'edit' ? 'can edit' : 'read-only'}`);
    if (onModeChanged) onModeChanged(mode);
  });
  modeLabel.appendChild(modeSelect);

  // Published documentation shares the same token, so it never exposes more
  // than the share link itself.
  const docsUrl = `${location.origin}/docs/${token}`;
  const docsNote = document.createElement('p');
  docsNote.className = 'modal-note';
  docsNote.style.marginTop = '12px';
  docsNote.textContent =
    'Prefer a reference your teammates can just read? The same link has a generated API docs page.';

  const docsRow = document.createElement('div');
  docsRow.className = 'share-link-row';
  const docsInput = document.createElement('input');
  docsInput.type = 'text';
  docsInput.readOnly = true;
  docsInput.value = docsUrl;
  docsInput.addEventListener('focus', () => docsInput.select());
  const docsCopy = document.createElement('button');
  docsCopy.className = 'btn';
  docsCopy.textContent = 'Copy';
  docsCopy.addEventListener('click', async () => {
    const ok = await copyText(docsUrl);
    toast(ok ? 'Docs link copied' : 'Copy failed — select the link manually');
  });
  const openDocs = document.createElement('button');
  openDocs.className = 'btn has-icon';
  openDocs.innerHTML = `${iconSvg('externalLink', 13)}Open`;
  openDocs.addEventListener('click', () => window.open(docsUrl, '_blank', 'noopener'));
  docsRow.append(docsInput, docsCopy, openDocs);

  openModal(`Share “${collection.name}”`, [note, linkRow, modeLabel, docsNote, docsRow], [
    { label: 'Done', primary: true, onClick: (close) => close() },
  ]);
}

// Used by the collection menu: make sure a link exists, then open the docs.
export async function openCollectionDocs(collection) {
  const { token } = await api.share(collection.id, collection.shareMode || 'readonly');
  window.open(`${location.origin}/docs/${token}`, '_blank', 'noopener');
}
