// Collection-level actions: import/export, duplicate, reorder, move-to-folder,
// and folder management. All mutations go through the bulk endpoint.
import { state } from './state.js';
import { api } from './api.js';
import { openModal, toast } from './modal.js';
import { parsePostmanCollection, parseOpenApi, toPostmanCollection, parseCurl, downloadJson } from './importers.js';

let deps = { reloadCollections: async () => { }, openImportedRequest: () => { } };

export function initCollectionActions(dependencies) {
  deps = dependencies;
}

async function saveBulk(collection, payload) {
  if (state.shared) return api.sharedBulkUpdate(state.shared.token, payload);
  return api.bulkUpdate(collection.id, payload);
}

function labelInput(labelText, value = '', placeholder = '') {
  const label = document.createElement('label');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  label.appendChild(input);
  return { label, input };
}

/* ---------------- import (Postman JSON file or cURL) ---------------- */

export function openImportDialog() {
  const note = document.createElement('p');
  note.className = 'modal-note';
  note.textContent =
    'Import a Postman collection (Export → Collection v2.1), an OpenAPI 3 / Swagger 2 spec (.json), or paste a cURL command.';

  const fileLabel = document.createElement('label');
  fileLabel.textContent = 'Postman collection or OpenAPI/Swagger file (.json)';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileLabel.appendChild(fileInput);

  const curlLabel = document.createElement('label');
  curlLabel.textContent = 'Or paste a cURL command';
  const curlInput = document.createElement('textarea');
  curlInput.rows = 5;
  curlInput.placeholder = "curl -X POST 'https://api.example.com/login' -H 'Content-Type: application/json' --data '{...}'";
  curlInput.spellcheck = false;
  curlLabel.appendChild(curlInput);

  openModal('Import', [note, fileLabel, curlLabel], [
    { label: 'Cancel', onClick: (close) => close() },
    {
      label: 'Import',
      primary: true,
      onClick: async (close) => {
        try {
          const file = fileInput.files[0];
          const curlText = curlInput.value.trim();
          if (file) {
            const text = await file.text();
            const doc = JSON.parse(text);
            // Auto-detect: OpenAPI/Swagger vs Postman collection.
            const parsed = (doc.openapi || doc.swagger || doc.paths)
              ? parseOpenApi(doc)
              : parsePostmanCollection(doc);
            const collection = await api.createCollection(parsed.name, deps.getWorkspaceId?.());
            await api.bulkUpdate(collection.id, {
              folders: parsed.folders,
              requests: parsed.requests,
              variables: parsed.variables,
            });
            close();
            toast(`Imported “${parsed.name}” — ${parsed.requests.length} requests, ${parsed.folders.length} folders`);
            await deps.reloadCollections();
          } else if (curlText) {
            const request = parseCurl(curlText);
            close();
            deps.openImportedRequest(request);
            toast('cURL imported into a new tab — Save to keep it');
          } else {
            toast('Choose a file or paste a cURL command');
          }
        } catch (err) {
          toast(err.message);
        }
      },
    },
  ]);
}

/* ---------------- export ---------------- */

export function exportCollection(collection) {
  const json = toPostmanCollection(collection);
  const safeName = collection.name.replace(/[^\w.-]+/g, '_');
  downloadJson(json, `${safeName}.collection.json`);
  toast('Collection exported — importable straight into Postman');
}

/* ---------------- request operations ---------------- */

export async function duplicateRequest(collection, req) {
  const index = collection.requests.findIndex((r) => r.id === req.id);
  const copy = { ...structuredClone(req), id: undefined, name: `${req.name} (copy)` };
  const requests = [
    ...collection.requests.slice(0, index + 1),
    copy,
    ...collection.requests.slice(index + 1),
  ];
  await saveBulk(collection, { requests });
  await deps.reloadCollections();
}

// Swaps with the neighboring request inside the same folder.
export async function reorderRequest(collection, req, direction) {
  const siblings = collection.requests.filter(
    (r) => (r.folderId || null) === (req.folderId || null)
  );
  const pos = siblings.findIndex((r) => r.id === req.id);
  const swapWith = siblings[pos + direction];
  if (!swapWith) return;

  const requests = collection.requests.map((r) => {
    if (r.id === req.id) return swapWith;
    if (r.id === swapWith.id) return req;
    return r;
  });
  await saveBulk(collection, { requests });
  await deps.reloadCollections();
}

export function openMoveDialog(collection, req) {
  const label = document.createElement('label');
  label.textContent = 'Move to';
  const select = document.createElement('select');

  const rootOpt = document.createElement('option');
  rootOpt.value = '';
  rootOpt.textContent = `${collection.name} (root)`;
  select.appendChild(rootOpt);

  const addFolderOptions = (parentId, depth) => {
    (collection.folders || [])
      .filter((f) => f.parentId === parentId)
      .forEach((folder) => {
        const opt = document.createElement('option');
        opt.value = folder.id;
        opt.textContent = `${'\u00a0\u00a0'.repeat(depth + 1)}${folder.name}/`;
        select.appendChild(opt);
        addFolderOptions(folder.id, depth + 1);
      });
  };
  addFolderOptions(null, 0);
  select.value = req.folderId || '';
  label.appendChild(select);

  openModal(`Move “${req.name}”`, [label], [
    { label: 'Cancel', onClick: (close) => close() },
    {
      label: 'Move',
      primary: true,
      onClick: async (close) => {
        try {
          const requests = collection.requests.map((r) =>
            r.id === req.id ? { ...r, folderId: select.value || null } : r
          );
          await saveBulk(collection, { requests });
          close();
          await deps.reloadCollections();
        } catch (err) {
          toast(err.message);
        }
      },
    },
  ]);
}

/* ---------------- folder operations ---------------- */

export function openNewFolderDialog(collection, parentId) {
  const name = labelInput('Folder name', '', 'e.g. DEV, traffic');
  openModal('New folder', [name.label], [
    { label: 'Cancel', onClick: (close) => close() },
    {
      label: 'Create',
      primary: true,
      onClick: async (close) => {
        const value = name.input.value.trim();
        if (!value) return toast('Give the folder a name');
        try {
          const folders = [...(collection.folders || []), { name: value, parentId: parentId || null }];
          await saveBulk(collection, { folders });
          close();
          await deps.reloadCollections();
        } catch (err) {
          toast(err.message);
        }
      },
    },
  ]);
}

export function openRenameFolderDialog(collection, folder) {
  const name = labelInput('Folder name', folder.name);
  openModal('Rename folder', [name.label], [
    { label: 'Cancel', onClick: (close) => close() },
    {
      label: 'Rename',
      primary: true,
      onClick: async (close) => {
        const value = name.input.value.trim();
        if (!value) return toast('Give the folder a name');
        try {
          const folders = (collection.folders || []).map((f) =>
            f.id === folder.id ? { ...f, name: value } : f
          );
          await saveBulk(collection, { folders });
          close();
          await deps.reloadCollections();
        } catch (err) {
          toast(err.message);
        }
      },
    },
  ]);
}

// Deleting a folder keeps its contents: children move up to the parent.
export async function deleteFolder(collection, folder) {
  if (!confirm(`Delete folder "${folder.name}"? Its requests move up a level.`)) return;
  const folders = (collection.folders || [])
    .filter((f) => f.id !== folder.id)
    .map((f) => (f.parentId === folder.id ? { ...f, parentId: folder.parentId } : f));
  const requests = collection.requests.map((r) =>
    r.folderId === folder.id ? { ...r, folderId: folder.parentId } : r
  );
  await saveBulk(collection, { folders, requests });
  await deps.reloadCollections();
}

function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function duplicateCollection(collection) {
  try {
    const newCollection = await api.createCollection(`${collection.name} (copy)`);

    const folderIdMap = {};
    const foldersCopy = (collection.folders || []).map((f) => {
      const newFid = newId();
      folderIdMap[f.id] = newFid;
      return { ...f, id: newFid };
    });

    foldersCopy.forEach((f) => {
      if (f.parentId) {
        f.parentId = folderIdMap[f.parentId] || null;
      }
    });

    const requestsCopy = (collection.requests || []).map((r) => {
      return {
        ...structuredClone(r),
        id: undefined,
        folderId: r.folderId ? (folderIdMap[r.folderId] || null) : null
      };
    });

    await api.bulkUpdate(newCollection.id, {
      folders: foldersCopy,
      requests: requestsCopy,
      variables: collection.variables || []
    });

    toast(`Duplicated collection “${collection.name}”`);
    await deps.reloadCollections();
  } catch (err) {
    toast(err.message);
  }
}

