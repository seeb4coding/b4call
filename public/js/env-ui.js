import { iconSvg } from './icons.js';
import { getEnvStore, setEnvStore, setActiveEnvironment } from './state.js';
import { createKvEditor } from './kv.js';
import { openModal, toast } from './modal.js';

let onEnvChanged = () => {};

// crypto.randomUUID is unavailable on insecure origins (http://<LAN-IP>),
// so fall back to getRandomValues, which works everywhere.
function newId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function refreshEnvSelect() {
  const select = document.getElementById('env-select');
  const envStore = getEnvStore();
  select.textContent = '';

  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'No Environment';
  select.appendChild(none);

  envStore.environments.forEach((env) => {
    const opt = document.createElement('option');
    opt.value = env.id;
    opt.textContent = env.name;
    select.appendChild(opt);
  });
  select.value = envStore.environments.some((e) => e.id === envStore.activeId)
    ? envStore.activeId
    : '';
}

export function initEnvSelector(onChanged) {
  onEnvChanged = onChanged || (() => {});
  refreshEnvSelect();
  document.getElementById('env-select').addEventListener('change', (e) => {
    setActiveEnvironment(e.target.value);
    onEnvChanged();
  });
  document.getElementById('env-btn').addEventListener('click', openEnvManager);
}

/* ---------- manage dialog ---------- */

export function openEnvManager() {
  let envStore = getEnvStore();
  let editingId = envStore.activeId || envStore.environments[0]?.id || '';

  const picker = document.createElement('label');
  picker.textContent = 'Environment';
  const pickerRow = document.createElement('div');
  pickerRow.className = 'env-picker-row';
  const select = document.createElement('select');
  const addBtn = document.createElement('button');
  addBtn.className = 'btn';
  addBtn.innerHTML = `${iconSvg('plus', 13)}New`;
  addBtn.classList.add('has-icon');
  const delBtn = document.createElement('button');
  delBtn.className = 'btn';
  delBtn.innerHTML = iconSvg('trash', 14);
  delBtn.classList.add('has-icon', 'icon-only');
  delBtn.title = 'Delete this environment';
  pickerRow.append(select, addBtn, delBtn);
  picker.appendChild(pickerRow);

  const nameField = document.createElement('label');
  nameField.textContent = 'Name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'e.g. MODINE, Staging, Production';
  nameField.appendChild(nameInput);

  const varsField = document.createElement('label');
  varsField.textContent = 'Variables — use as {{name}} anywhere in a request';
  const editorBox = document.createElement('div');
  const editor = createKvEditor(editorBox, { keyPlaceholder: 'variable', valuePlaceholder: 'value' });
  varsField.appendChild(editorBox);

  const emptyNote = document.createElement('p');
  emptyNote.className = 'modal-note';

  function currentEnv() {
    return envStore.environments.find((e) => e.id === editingId) || null;
  }

  function captureEdits() {
    const env = currentEnv();
    if (!env) return;
    const vars = {};
    editor.getRows().forEach((r) => {
      if (r.enabled && r.key) vars[r.key] = r.value;
    });
    const updated = { ...env, name: nameInput.value.trim() || env.name, vars };
    envStore = {
      ...envStore,
      environments: envStore.environments.map((e) => (e.id === env.id ? updated : e)),
    };
  }

  function renderPicker() {
    select.textContent = '';
    envStore.environments.forEach((env) => {
      const opt = document.createElement('option');
      opt.value = env.id;
      opt.textContent = env.name;
      select.appendChild(opt);
    });
    select.value = editingId;
    const hasEnvs = envStore.environments.length > 0;
    nameField.classList.toggle('hidden', !hasEnvs);
    varsField.classList.toggle('hidden', !hasEnvs);
    emptyNote.classList.toggle('hidden', hasEnvs);
    emptyNote.textContent = 'No environments yet — use the New button above to create one (e.g. Staging, Production).';
  }

  function loadEditor() {
    const env = currentEnv();
    if (!env) {
      renderPicker();
      return;
    }
    nameInput.value = env.name;
    editor.setRows(Object.entries(env.vars).map(([key, value]) => ({ enabled: true, key, value })));
    renderPicker();
  }

  select.addEventListener('change', () => {
    captureEdits();
    editingId = select.value;
    loadEditor();
  });

  addBtn.addEventListener('click', () => {
    captureEdits();
    const env = { id: newId(), name: `Environment ${envStore.environments.length + 1}`, vars: {} };
    envStore = { ...envStore, environments: [...envStore.environments, env] };
    editingId = env.id;
    loadEditor();
    nameInput.focus();
    nameInput.select();
  });

  delBtn.addEventListener('click', () => {
    const env = currentEnv();
    if (!env) return;
    if (!confirm(`Delete environment "${env.name}"?`)) return;
    envStore = {
      ...envStore,
      environments: envStore.environments.filter((e) => e.id !== env.id),
      activeId: envStore.activeId === env.id ? '' : envStore.activeId,
    };
    editingId = envStore.environments[0]?.id || '';
    loadEditor();
  });

  loadEditor();

  openModal('Manage environments', [picker, emptyNote, nameField, varsField], [
    { label: 'Cancel', onClick: (close) => close() },
    {
      label: 'Save',
      primary: true,
      onClick: (close) => {
        captureEdits();
        setEnvStore(envStore);
        refreshEnvSelect();
        close();
        toast('Environments saved');
        onEnvChanged();
      },
    },
  ]);
}
