// The Activity tab: threaded comments on a request, plus its change history
// with a diff against the live version and one-click restore.

import { api } from './api.js';
import { openModal, toast } from './modal.js';
import { getIdentity } from './identity.js';
import { renderMarkdown } from './markdown.js';
import { diffLines, diffStats } from './response-diff.js';

const $ = (sel) => document.querySelector(sel);

let deps = {
  getRequestId: () => null,
  onRestore: () => {},
  canEdit: () => true,
};
let loadedFor = null;

export function initActivityPanel(dependencies = {}) {
  deps = { ...deps, ...dependencies };
}

function relativeTime(at) {
  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} d ago`;
  return new Date(at).toLocaleDateString();
}

// Called whenever the Activity tab is shown or the active request changes.
export async function refreshActivityPanel({ force = false } = {}) {
  const container = $('#activity-body');
  if (!container) return;

  const requestId = deps.getRequestId();
  if (!requestId) {
    loadedFor = null;
    container.textContent = '';
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent =
      'Save this request first — comments and change history are kept per saved request.';
    container.appendChild(note);
    return;
  }
  if (!force && loadedFor === requestId) return;
  loadedFor = requestId;

  container.textContent = '';
  const loading = document.createElement('div');
  loading.className = 'empty-note';
  loading.textContent = 'Loading activity…';
  container.appendChild(loading);

  try {
    const { comments, revisions } = await api.getActivity(requestId);
    container.textContent = '';
    container.appendChild(commentsSection(requestId, comments));
    container.appendChild(revisionsSection(requestId, revisions));
  } catch (err) {
    container.textContent = '';
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent = `Could not load activity: ${err.message}`;
    container.appendChild(note);
  }
}

/* ---------------- comments ---------------- */

function commentsSection(requestId, comments) {
  const section = document.createElement('div');

  const title = document.createElement('div');
  title.className = 'vars-title';
  title.style.marginTop = '0';
  const open = comments.filter((c) => !c.resolved).length;
  title.textContent = `Comments (${open} open${comments.length - open ? `, ${comments.length - open} resolved` : ''})`;
  section.appendChild(title);

  const list = document.createElement('div');
  list.className = 'comment-list';
  if (!comments.length) {
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent = 'No comments yet. Leave a note for whoever picks this request up next.';
    list.appendChild(note);
  }

  comments
    .slice()
    .sort((a, b) => Number(a.resolved) - Number(b.resolved) || b.at - a.at)
    .forEach((comment) => list.appendChild(commentRow(requestId, comment)));
  section.appendChild(list);

  // Composer.
  const composer = document.createElement('div');
  composer.className = 'comment-composer';

  const input = document.createElement('textarea');
  input.placeholder = 'Add a comment… Markdown works. Ctrl+Enter to post.';
  input.rows = 3;

  const actions = document.createElement('div');
  actions.className = 'comment-composer-actions';
  const who = document.createElement('span');
  who.className = 'comment-as';
  who.textContent = `as ${getIdentity().name}`;
  const post = document.createElement('button');
  post.className = 'btn btn-primary';
  post.textContent = 'Comment';

  const submit = async () => {
    const text = input.value.trim();
    if (!text) return;
    post.disabled = true;
    try {
      await api.addComment(requestId, { author: getIdentity().name, text });
      input.value = '';
      await refreshActivityPanel({ force: true });
    } catch (err) {
      toast(err.message);
    } finally {
      post.disabled = false;
    }
  };
  post.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  });

  actions.append(who, post);
  composer.append(input, actions);
  section.appendChild(composer);

  return section;
}

function commentRow(requestId, comment) {
  const row = document.createElement('div');
  row.className = `comment${comment.resolved ? ' resolved' : ''}`;

  const head = document.createElement('div');
  head.className = 'comment-head';
  const author = document.createElement('span');
  author.className = 'comment-author';
  author.textContent = comment.author;
  const when = document.createElement('span');
  when.className = 'comment-time';
  when.textContent = relativeTime(comment.at) + (comment.editedAt ? ' · edited' : '');
  head.append(author, when);

  const resolveBtn = document.createElement('button');
  resolveBtn.className = 'link-btn';
  resolveBtn.textContent = comment.resolved ? 'Reopen' : 'Resolve';
  resolveBtn.addEventListener('click', async () => {
    try {
      await api.updateComment(requestId, comment.id, { resolved: !comment.resolved });
      await refreshActivityPanel({ force: true });
    } catch (err) {
      toast(err.message);
    }
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'link-btn danger';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', async () => {
    if (!confirm('Delete this comment?')) return;
    try {
      await api.deleteComment(requestId, comment.id);
      await refreshActivityPanel({ force: true });
    } catch (err) {
      toast(err.message);
    }
  });

  head.append(resolveBtn, deleteBtn);

  const body = document.createElement('div');
  body.className = 'comment-body';
  body.innerHTML = renderMarkdown(comment.text);

  row.append(head, body);
  return row;
}

/* ---------------- revisions ---------------- */

function revisionsSection(requestId, revisions) {
  const section = document.createElement('div');

  const title = document.createElement('div');
  title.className = 'vars-title';
  title.textContent = `Change history (${revisions.length})`;
  section.appendChild(title);

  const note = document.createElement('p');
  note.className = 'modal-note';
  note.textContent =
    'Every save keeps a snapshot of what the request looked like beforehand. ' +
    'Restore loads an old version back into the editor — it is not written until you press Save.';
  section.appendChild(note);

  if (!revisions.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-note';
    empty.textContent = 'No changes recorded yet.';
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement('div');
  list.className = 'revision-list';

  revisions.forEach((revision) => {
    const row = document.createElement('div');
    row.className = 'revision';

    const main = document.createElement('div');
    main.className = 'revision-main';
    const who = document.createElement('span');
    who.className = 'revision-author';
    who.textContent = revision.author;
    const summary = document.createElement('span');
    summary.className = 'revision-summary';
    summary.textContent = revision.summary;
    const when = document.createElement('span');
    when.className = 'revision-time';
    when.textContent = relativeTime(revision.at);
    when.title = new Date(revision.at).toLocaleString();
    main.append(who, summary, when);

    const actions = document.createElement('div');
    actions.className = 'revision-actions';

    const diffBtn = document.createElement('button');
    diffBtn.className = 'link-btn';
    diffBtn.textContent = 'Compare with now';
    diffBtn.addEventListener('click', () => openRevisionDiff(requestId, revision));

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'link-btn';
    restoreBtn.textContent = 'Restore';
    restoreBtn.disabled = !deps.canEdit();
    restoreBtn.addEventListener('click', () => restoreRevision(requestId, revision));

    actions.append(diffBtn, restoreBtn);
    row.append(main, actions);
    list.appendChild(row);
  });

  section.appendChild(list);
  return section;
}

// A request has no single "body" to diff, so compare a normalised JSON view of
// the whole definition — headers, params, auth, scripts and all.
function requestToText(request) {
  const ordered = {};
  Object.keys(request)
    .filter((key) => key !== 'id')
    .sort()
    .forEach((key) => {
      ordered[key] = request[key];
    });
  return JSON.stringify(ordered, null, 2);
}

async function openRevisionDiff(requestId, revisionMeta) {
  try {
    const [revision, current] = await Promise.all([
      api.getRevision(requestId, revisionMeta.id),
      api.getCurrentRequest(requestId),
    ]);
    const rows = diffLines(requestToText(revision.snapshot), requestToText(current.request));
    const stats = diffStats(rows);

    const wrap = document.createElement('div');
    const head = document.createElement('p');
    head.className = 'modal-note';
    head.textContent =
      `${revision.author} · ${new Date(revision.at).toLocaleString()} — ` +
      `${stats.added} line(s) added, ${stats.removed} removed since this version.`;
    wrap.appendChild(head);

    const body = document.createElement('div');
    body.className = 'diff-body diff-compact';
    rows
      .filter((row, index) => {
        if (row.type !== 'same') return true;
        // Keep one line of context around each change.
        return rows[index - 1]?.type !== 'same' || rows[index + 1]?.type !== 'same';
      })
      .forEach((row) => {
        const line = document.createElement('div');
        line.className = `diff-row diff-${row.type}`;
        const leftNo = document.createElement('span');
        leftNo.className = 'diff-lineno';
        leftNo.textContent = row.leftNo ?? '';
        const leftText = document.createElement('span');
        leftText.className = 'diff-text';
        leftText.textContent = row.left ?? '';
        const rightNo = document.createElement('span');
        rightNo.className = 'diff-lineno';
        rightNo.textContent = row.rightNo ?? '';
        const rightText = document.createElement('span');
        rightText.className = 'diff-text';
        rightText.textContent = row.right ?? '';
        line.append(leftNo, leftText, rightNo, rightText);
        body.appendChild(line);
      });
    if (!body.hasChildNodes()) {
      const same = document.createElement('div');
      same.className = 'empty-note';
      same.textContent = 'This version is identical to the current request.';
      body.appendChild(same);
    }
    wrap.appendChild(body);

    openModal(`Version from ${relativeTime(revision.at)}`, [wrap], [
      {
        label: 'Restore this version',
        onClick: (close) => {
          close();
          restoreRevision(requestId, revisionMeta, revision);
        },
      },
      { label: 'Close', primary: true, onClick: (close) => close() },
    ]);
  } catch (err) {
    toast(err.message);
  }
}

async function restoreRevision(requestId, revisionMeta, preloaded) {
  if (!deps.canEdit()) return toast('This shared collection is read-only');
  try {
    const revision = preloaded || (await api.getRevision(requestId, revisionMeta.id));
    deps.onRestore(revision.snapshot);
    toast('Old version loaded into the editor — press Save to keep it');
  } catch (err) {
    toast(err.message);
  }
}

// Lets the rest of the app force a reload (e.g. after a collaborator's save).
export function invalidateActivity() {
  loadedFor = null;
}
