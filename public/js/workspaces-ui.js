import { iconSvg } from './icons.js';
// Workspace switcher + manager. The active workspace scopes which collections
// are listed. Environments/globals remain browser-global.
import { api } from './api.js';
import { openModal, toast } from './modal.js';

const KEY = 'b4call-workspace';
let workspaces = [{ id: 'default', name: 'Personal Workspace' }];
let onChanged = () => {};

export function getActiveWorkspaceId() {
  return localStorage.getItem(KEY) || 'default';
}

function setActiveWorkspaceId(id) {
  localStorage.setItem(KEY, id);
}

function renderSelect() {
  const select = document.getElementById('workspace-select');
  if (!select) return;
  select.textContent = '';
  workspaces.forEach((ws) => {
    const opt = document.createElement('option');
    opt.value = ws.id;
    opt.textContent = ws.name;
    select.appendChild(opt);
  });
  const active = getActiveWorkspaceId();
  select.value = workspaces.some((w) => w.id === active) ? active : 'default';
  if (select.value !== active) setActiveWorkspaceId(select.value);
}

export async function initWorkspaces(onWorkspaceChanged) {
  onChanged = onWorkspaceChanged || (() => {});
  await refreshWorkspaces();
  const select = document.getElementById('workspace-select');
  select.addEventListener('change', () => {
    setActiveWorkspaceId(select.value);
    onChanged();
  });
  document.getElementById('workspace-btn').addEventListener('click', openWorkspaceManager);
}

export async function refreshWorkspaces() {
  try {
    workspaces = await api.listWorkspaces();
    if (!workspaces.some((w) => w.id === 'default')) {
      workspaces = [{ id: 'default', name: 'Personal Workspace' }, ...workspaces];
    }
  } catch {
    workspaces = [{ id: 'default', name: 'Personal Workspace' }];
  }
  renderSelect();
}

function openWorkspaceManager() {
  const container = document.createElement('div');
  container.className = 'workspace-manager';

  const list = document.createElement('div');
  const renderList = () => {
    list.textContent = '';
    workspaces.forEach((ws) => {
      const row = document.createElement('div');
      row.className = 'var-row';
      const name = document.createElement('span');
      name.className = 'var-name';
      name.textContent = ws.name;
      row.appendChild(name);
      if (ws.id !== 'default') {
        const rename = document.createElement('button');
        rename.className = 'link-btn';
        rename.textContent = 'Rename';
        rename.addEventListener('click', async () => {
          const next = prompt('Rename workspace', ws.name);
          if (!next) return;
          await api.renameWorkspace(ws.id, next.trim());
          await refreshWorkspaces();
          renderList();
          onChanged();
        });
        const del = document.createElement('button');
        del.className = 'link-btn';
        del.textContent = 'Delete';
        del.addEventListener('click', async () => {
          if (!confirm(`Delete workspace "${ws.name}"? Its collections move to the default workspace.`)) return;
          await api.deleteWorkspace(ws.id);
          if (getActiveWorkspaceId() === ws.id) setActiveWorkspaceId('default');
          await refreshWorkspaces();
          renderList();
          onChanged();
        });
        row.append(rename, del);
      }
      list.appendChild(row);
    });
  };
  renderList();

  const newRow = document.createElement('div');
  newRow.className = 'env-picker-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'New workspace name';
  const addBtn = document.createElement('button');
  addBtn.className = 'btn';
  addBtn.innerHTML = `${iconSvg('plus', 13)}Create`;
  addBtn.classList.add('has-icon');
  addBtn.addEventListener('click', async () => {
    const value = input.value.trim();
    if (!value) return toast('Give the workspace a name');
    const ws = await api.createWorkspace(value);
    input.value = '';
    await refreshWorkspaces();
    setActiveWorkspaceId(ws.id);
    renderSelect();
    renderList();
    onChanged();
    toast(`Created workspace “${ws.name}”`);
  });
  newRow.append(input, addBtn);

  openModal('Workspaces', [list, newRow], [
    { label: 'Close', primary: true, onClick: (close) => close() },
  ]);
}
