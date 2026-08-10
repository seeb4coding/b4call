import {
  state,
  getGlobals,
  setGlobals,
  getVault,
  setVault,
  clearHistory,
  addRespHistory,
  getEnvStore,
  setEnvStore,
  setDecryptedVaultMem,
  getHistory,
} from './state.js';
import { api } from './api.js';
import { createKvEditor } from './kv.js';
import { openModal, toast } from './modal.js';
import {
  loadRequestIntoEditor,
  readRequestFromEditor,
  setRequestName,
  updateBodyVisibility,
  renderAuthFields,
  initBodyEditor,
} from './request-editor.js';
import { sendRequest, buildProxyPayload, substituteVars } from './send.js';
import { initResponsePanel, renderResponse, clearResponse } from './response-panel.js';
import { renderCollections, renderHistory, expandCollection, expandFolder } from './sidebar.js';
import { parseShareToken, openShareDialog, openCollectionDocs } from './share.js';
import { getScopes, mergedVars } from './vars.js';
import { initEnvSelector, openEnvManager } from './env-ui.js';
import { renderVariablesPanel } from './variables-panel.js';
import { generateSnippets } from './codegen.js';
import { copyText } from './clipboard.js';
import { initVarAutocomplete } from './autocomplete.js';
import { initVarHover, updateAllHighlights } from './var-hover.js';
import {
  initRequestTabs,
  openRequestTab,
  openBlankTab,
  blankSnapshot,
  updateActiveTabMeta,
  touchActiveTab,
  markActiveTabDirty,
  getActiveTab,
} from './tabs.js';
import {
  initCollectionActions,
  openImportDialog,
  exportCollection,
  duplicateRequest,
  duplicateCollection,
  reorderRequest,
  openMoveDialog,
  openNewFolderDialog,
  openRenameFolderDialog,
  deleteFolder,
} from './collection-actions.js';
import { openRunner } from './runner.js';
import { applyCapture, runTests } from './post-response.js';
import { runPreRequestScript, runTestsScript } from './script-sandbox.js';
import { recordResponse } from './response-store.js';
import { getExamples, setExamples } from './request-editor.js';
import { initWorkspaces, getActiveWorkspaceId } from './workspaces-ui.js';
import { initCommandPalette } from './command-palette.js';
import { openCookieDialog } from './cookie-jar.js';
import { openHelpDialog, openMockDialog, openProxyDialog } from './misc-dialogs.js';
import * as wsClient from './ws-client.js';
import * as cryptoVault from './crypto-vault.js';
import { initAppearance, openAppearanceDialog } from './appearance.js';
import { initKeyboard } from './keyboard.js';
import { hydrateIcons, iconSvg } from './icons.js';
import * as realtime from './realtime.js';
import { initActivityPanel, refreshActivityPanel, invalidateActivity } from './activity-panel.js';
import {
  cycleTab,
  activateTabIndex,
  closeActiveTab,
} from './tabs.js';

const $ = (sel) => document.querySelector(sel);

const canEdit = () => !state.shared || state.shared.mode === 'edit';

// The collection the current request belongs to (shared views have exactly one).
function activeCollection() {
  return (
    state.collections.find((c) => c.id === state.activeCollectionId) ||
    (state.shared ? state.collections[0] : null) ||
    null
  );
}

function currentVars() {
  return mergedVars(getScopes(activeCollection()));
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

/* ---------------- sidebar ---------------- */

function refreshSidebar() {
  $('#save-btn').classList.toggle('hidden', !canEdit());
  renderCollections({
    canEdit: canEdit(),
    filter: $('#sidebar-search').value.trim(),
    onCopyCurl: async (collection, req) => {
      try {
        const payload = buildProxyPayload(req, currentVars());
        const snippets = generateSnippets(payload);
        const ok = await copyText(snippets.curl);
        toast(ok ? 'cURL command copied to clipboard' : 'Failed to copy cURL');
      } catch (err) {
        toast(err.message);
      }
    },
    onOpenRequest: (collection, req) => {
      openRequestTab({
        requestId: req.id,
        collectionId: collection.id,
        snapshot: structuredClone(req),
      });
    },
    // Browser-style: just open a blank tab targeted at this collection/folder.
    // Nothing is created in the collection until the user hits Save.
    onAddRequest: (collection, folderId) => {
      openBlankTab({ collectionId: collection.id, folderId });
      $('#url').focus();
    },
    onAddFolder: (collection, parentId) => openNewFolderDialog(collection, parentId),
    onRenameFolder: (collection, folder) => openRenameFolderDialog(collection, folder),
    onDeleteFolder: (collection, folder) => deleteFolder(collection, folder).catch((e) => toast(e.message)),
    onDuplicateRequest: (collection, req) =>
      duplicateRequest(collection, req).catch((e) => toast(e.message)),
    onDuplicateCollection: (collection) =>
      duplicateCollection(collection).catch((e) => toast(e.message)),
    onMoveRequest: (collection, req) => openMoveDialog(collection, req),
    onReorderRequest: (collection, req, dir) =>
      reorderRequest(collection, req, dir).catch((e) => toast(e.message)),
    onDeleteRequest: async (collection, req) => {
      if (!confirm(`Delete request "${req.name}"?`)) return;
      try {
        if (state.shared) await api.sharedDeleteRequest(state.shared.token, req.id);
        else await api.deleteRequest(collection.id, req.id);
        if (state.activeRequestId === req.id) state.activeRequestId = null;
        await reloadCollections();
      } catch (err) {
        toast(err.message);
      }
    },
    onRenameCollection: (collection) => {
      const name = labelInput('Collection name', collection.name);
      openModal('Rename collection', [name.label], [
        { label: 'Cancel', onClick: (close) => close() },
        {
          label: 'Rename',
          primary: true,
          onClick: async (close) => {
            const value = name.input.value.trim();
            if (!value) return toast('Give the collection a name');
            try {
              await api.renameCollection(collection.id, value);
              close();
              await reloadCollections();
            } catch (err) {
              toast(err.message);
            }
          },
        },
      ]);
    },
    onDeleteCollection: async (collection) => {
      if (!confirm(`Delete collection "${collection.name}" and all its requests?`)) return;
      try {
        await api.deleteCollection(collection.id);
        if (state.activeCollectionId === collection.id) {
          state.activeCollectionId = null;
          state.activeRequestId = null;
        }
        await reloadCollections();
      } catch (err) {
        toast(err.message);
      }
    },
    onRunCollection: (collection) =>
      openRunner(collection, { getVars: () => mergedVars(getScopes(collection)) }),
    onExportCollection: (collection) => exportCollection(collection),
    onShare: (collection) => {
      openShareDialog(collection, () => reloadCollections()).catch((err) => toast(err.message));
    },
    onPublishDocs: (collection) => {
      openCollectionDocs(collection).catch((err) => toast(err.message));
    },
  });
}

function refreshHistory() {
  renderHistory({
    onPick: (entry) => {
      openRequestTab({
        requestId: null,
        collectionId: null,
        snapshot: { ...blankSnapshot(), ...structuredClone(entry.request) },
      });
    },
  });
}

async function reloadCollections() {
  if (state.shared) {
    const { collection, mode } = await api.getShared(state.shared.token);
    state.shared = { ...state.shared, mode };
    state.collections = [collection];
  } else {
    state.collections = await api.listCollections(getActiveWorkspaceId());
  }
  refreshSidebar();
  renderVarsTab();
}

/* ---------------- send ---------------- */

let vaultPassword = null;
let decryptedVault = null;

function logWsMessage(direction, data) {
  const logContainer = document.querySelector('.ws-log');
  if (!logContainer) return;
  
  const item = document.createElement('div');
  item.className = 'ws-log-item';
  
  const time = document.createElement('span');
  time.className = 'ws-time';
  time.textContent = new Date().toLocaleTimeString();
  
  const dir = document.createElement('span');
  dir.className = `ws-dir ws-dir-${direction}`;
  dir.textContent = direction === 'in' ? '←' : direction === 'out' ? '→' : 'ℹ';
  
  const text = document.createElement('span');
  text.className = 'ws-msg-text';
  text.textContent = data;
  
  item.append(time, dir, text);
  logContainer.appendChild(item);
  logContainer.scrollTop = logContainer.scrollHeight;
}

function updateWsUiState(status) {
  const btn = $('#send-btn');
  if (status === 'connected') {
    btn.textContent = 'Disconnect';
    btn.disabled = false;
    btn.style.background = 'var(--red)';
    btn.style.borderColor = 'var(--red)';
  } else if (status === 'connecting') {
    btn.textContent = 'Connecting…';
    btn.disabled = true;
  } else {
    btn.textContent = 'Connect';
    btn.disabled = false;
    btn.style.background = '';
    btn.style.borderColor = '';
  }
}

function setupWsConsole() {
  const method = $('#method').value;
  const isWs = method === 'WS';
  
  const treeEl = $('#response-json-tree');
  treeEl.textContent = '';
  treeEl.className = 'response-body';
  treeEl.classList.remove('hidden');
  $('#response-body').classList.add('hidden');
  $('#resp-tabs').classList.add('hidden');
  $('#response-toolbar').classList.add('hidden');
  $('#response-empty').classList.add('hidden');
  $('#response-status').classList.remove('hidden');
  $('#response-status').innerHTML = `<span class="status-chip status-2xx">${method} Console</span>`;
  
  const wsConsole = document.createElement('div');
  wsConsole.className = 'ws-console';
  
  if (isWs) {
    const controls = document.createElement('div');
    controls.className = 'ws-controls';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Type message to send...';
    input.className = 'url-input';
    
    const sendBtn = document.createElement('button');
    sendBtn.className = 'btn btn-primary';
    sendBtn.textContent = 'Send Message';
    
    const sendMsg = () => {
      const val = input.value.trim();
      if (!val) return;
      if (wsClient.sendWsMessage(val, { onLog: logWsMessage })) {
        input.value = '';
      }
    };
    
    sendBtn.addEventListener('click', sendMsg);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendMsg();
    });
    
    controls.append(input, sendBtn);
    wsConsole.appendChild(controls);
  }
  
  const log = document.createElement('div');
  log.className = 'ws-log';
  wsConsole.appendChild(log);
  
  treeEl.appendChild(wsConsole);
}

async function onSend() {
  const method = $('#method').value;
  
  if (method === 'WS' || method === 'SSE') {
    if (wsClient.isConnected()) {
      wsClient.disconnect();
      updateWsUiState('disconnected');
      logWsMessage('info', 'Connection terminated by user.');
      return;
    }
    
    const url = $('#url').value.trim();
    if (!url) return toast('Enter a URL first');
    
    setupWsConsole();
    
    if (method === 'WS') {
      let wsUrl = url;
      if (!/^wss?:\/\//i.test(wsUrl)) {
        wsUrl = wsUrl.replace(/^https?:\/\//i, '');
        wsUrl = `wss://${wsUrl}`;
      }
      wsClient.connectWs(wsUrl, {
        onLog: logWsMessage,
        onStateChange: updateWsUiState
      });
    } else {
      wsClient.connectSse(url, {
        onLog: logWsMessage,
        onStateChange: updateWsUiState
      });
    }
    return;
  }

  const btn = $('#send-btn');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    const req = readRequestFromEditor();
    let finalReq = { ...req };
    
    if (req.preRequestScript && req.preRequestScript.trim()) {
      const envStore = getEnvStore();
      const activeEnv = envStore.environments.find((e) => e.id === envStore.activeId)?.vars || {};
      const globals = getGlobals();
      
      const scriptResult = runPreRequestScript(req.preRequestScript, {
        environment: activeEnv,
        globals: globals,
        request: buildProxyPayload(req, currentVars())
      });
      
      const active = envStore.environments.find((e) => e.id === envStore.activeId);
      if (active) {
        active.vars = scriptResult.environment;
        setEnvStore(envStore);
      } else {
        setGlobals(scriptResult.globals);
      }
      
      finalReq.method = scriptResult.request.method;
      finalReq.url = scriptResult.request.url;
      if (scriptResult.request.headers) {
        finalReq.headers = Object.entries(scriptResult.request.headers).map(([key, value]) => ({
          enabled: true, key, value
        }));
      }
      if (scriptResult.request.body && typeof scriptResult.request.body === 'string') {
        finalReq.bodyRaw = scriptResult.request.body;
      }
    }

    const result = await sendRequest(finalReq, currentVars());

    const captured = applyCapture(finalReq.capture, result);
    const tests = runTests(finalReq.tests, result);

    let jsTests = [];
    if (finalReq.testsScript && finalReq.testsScript.trim()) {
      const envStore = getEnvStore();
      const activeEnv = envStore.environments.find((e) => e.id === envStore.activeId)?.vars || {};
      const globals = getGlobals();
      
      const scriptResult = runTestsScript(finalReq.testsScript, {
        environment: activeEnv,
        globals: globals,
        request: buildProxyPayload(finalReq, currentVars()),
        response: result
      });
      
      const active = envStore.environments.find((e) => e.id === envStore.activeId);
      if (active) {
        active.vars = scriptResult.environment;
        setEnvStore(envStore);
      } else {
        setGlobals(scriptResult.globals);
      }
      
      jsTests = scriptResult.testResults;
    }

    const allTests = [...tests, ...jsTests];

    if (state.activeRequestId && !result.error) {
      addRespHistory(state.activeRequestId, result);
    }
    recordResponse(finalReq.name, result);

    const view = { result, tests: allTests, requestId: state.activeRequestId };
    renderResponse(view.result, { tests: view.tests, requestId: view.requestId });
    const activeTab = getActiveTab();
    if (activeTab) activeTab.response = view;

    if (captured.length) {
      toast(`Captured: ${captured.map((c) => c.name).join(', ')}`);
    }
    renderVarsTab();
    refreshHistory();
    touchActiveTab();
  } catch (err) {
    const view = { result: { error: err.message }, tests: [], requestId: null };
    renderResponse(view.result);
    const activeTab = getActiveTab();
    if (activeTab) activeTab.response = view;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send';
  }
}

/* ---------------- save ---------------- */

function openSaveDialog(req) {
  const name = labelInput('Request name', req.name === 'Untitled request' ? '' : req.name, 'e.g. Get users');

  const colLabel = document.createElement('label');
  colLabel.textContent = 'Save into collection';
  const select = document.createElement('select');
  state.collections.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    select.appendChild(opt);
  });
  if (!state.shared) {
    const opt = document.createElement('option');
    opt.value = '__new__';
    opt.textContent = '+ Create new collection…';
    select.appendChild(opt);
  }
  colLabel.appendChild(select);

  // Pre-select the collection this tab was opened from (the sidebar's + button).
  if (state.activeCollectionId && state.collections.some((c) => c.id === state.activeCollectionId)) {
    select.value = state.activeCollectionId;
  }

  const newCol = labelInput('New collection name', '', 'e.g. My API');

  const folderLabel = document.createElement('label');
  folderLabel.textContent = 'Folder';
  const folderSelect = document.createElement('select');
  folderLabel.appendChild(folderSelect);

  const refreshFolderOptions = () => {
    folderSelect.textContent = '';
    const collection = state.collections.find((c) => c.id === select.value);
    const hasFolders = collection && (collection.folders || []).length > 0;
    folderLabel.classList.toggle('hidden', !hasFolders);
    if (!hasFolders) return;

    const rootOpt = document.createElement('option');
    rootOpt.value = '';
    rootOpt.textContent = '(collection root)';
    folderSelect.appendChild(rootOpt);

    const addOptions = (parentId, depth) => {
      collection.folders
        .filter((f) => f.parentId === parentId)
        .forEach((folder) => {
          const opt = document.createElement('option');
          opt.value = folder.id;
          opt.textContent = `${'\u00a0\u00a0'.repeat(depth + 1)}${folder.name}/`;
          folderSelect.appendChild(opt);
          addOptions(folder.id, depth + 1);
        });
    };
    addOptions(null, 0);
    // Pre-select the folder this tab was opened from.
    if (req.folderId && collection.folders.some((f) => f.id === req.folderId)) {
      folderSelect.value = req.folderId;
    }
  };

  const syncNewColVisibility = () => {
    newCol.label.classList.toggle('hidden', select.value !== '__new__');
    refreshFolderOptions();
  };
  select.addEventListener('change', syncNewColVisibility);
  if (state.collections.length === 0 && !state.shared) select.value = '__new__';
  syncNewColVisibility();

  openModal('Save request', [name.label, colLabel, folderLabel, newCol.label], [
    { label: 'Cancel', onClick: (close) => close() },
    {
      label: 'Save',
      primary: true,
      onClick: async (close) => {
        const reqName = name.input.value.trim();
        if (!reqName) return toast('Give the request a name');
        try {
          const folderId = folderLabel.classList.contains('hidden')
            ? null
            : folderSelect.value || null;
          const payload = { ...req, name: reqName, folderId };
          let created;
          let collectionId;
          if (state.shared) {
            created = await api.sharedCreateRequest(state.shared.token, payload);
            collectionId = state.collections[0]?.id ?? null;
          } else {
            collectionId = select.value;
            if (collectionId === '__new__') {
              const colName = newCol.input.value.trim();
              if (!colName) return toast('Give the collection a name');
              const collection = await api.createCollection(colName, getActiveWorkspaceId());
              collectionId = collection.id;
            }
            created = await api.createRequest(collectionId, payload);
          }
          state.activeCollectionId = collectionId;
          state.activeRequestId = created.id;
          setRequestName(reqName);
          expandCollection(collectionId);
          if (folderId) expandFolder(folderId);
          updateActiveTabMeta({ title: reqName, requestId: created.id, collectionId, dirty: false });
          close();
          toast('Request saved');
          await reloadCollections();
        } catch (err) {
          toast(err.message);
        }
      },
    },
  ]);
}

async function onSave() {
  const req = readRequestFromEditor();
  if (!req.url) return toast('Enter a URL before saving');
  if (state.shared && state.shared.mode !== 'edit') {
    return toast('This shared collection is read-only');
  }

  try {
    if (state.activeRequestId) {
      if (state.shared) {
        await api.sharedUpdateRequest(state.shared.token, state.activeRequestId, req);
      } else {
        await api.updateRequest(state.activeCollectionId, state.activeRequestId, req);
      }
      updateActiveTabMeta({ title: req.name, dirty: false });
      toast('Request saved');
      return await reloadCollections();
    }
    openSaveDialog(req);
  } catch (err) {
    toast(err.message);
  }
}

/* ---------------- rename ---------------- */

function openRenameDialog() {
  if (!canEdit()) return;
  const current = $('#request-name').textContent.trim();
  const name = labelInput('Request name', current === 'Untitled request' ? '' : current, 'e.g. Login');

  openModal('Rename request', [name.label], [
    { label: 'Cancel', onClick: (close) => close() },
    {
      label: 'Rename',
      primary: true,
      onClick: async (close) => {
        const value = name.input.value.trim();
        if (!value) return toast('Give the request a name');
        setRequestName(value);
        updateActiveTabMeta({ title: value });
        try {
          if (state.activeRequestId) {
            const req = readRequestFromEditor();
            if (state.shared) {
              await api.sharedUpdateRequest(state.shared.token, state.activeRequestId, req);
            } else {
              await api.updateRequest(state.activeCollectionId, state.activeRequestId, req);
            }
            await reloadCollections();
          }
          close();
        } catch (err) {
          toast(err.message);
        }
      },
    },
  ]);
}

/* ---------------- variables: globals, vault, collection vars, inspector ---------------- */

function kvDialog({ title, note, entries, onSave }) {
  const noteEl = document.createElement('p');
  noteEl.className = 'modal-note';
  noteEl.textContent = note;

  const container = document.createElement('div');
  const editor = createKvEditor(container, { keyPlaceholder: 'variable', valuePlaceholder: 'value' });
  editor.setRows(entries.map(([key, value]) => ({ enabled: true, key, value })));

  openModal(title, [noteEl, container], [
    { label: 'Cancel', onClick: (close) => close() },
    {
      label: 'Save',
      primary: true,
      onClick: async (close) => {
        const vars = {};
        editor.getRows().forEach((r) => {
          if (r.enabled && r.key) vars[r.key] = r.value;
        });
        await onSave(vars);
        close();
        renderVarsTab();
      },
    },
  ]);
}

function openGlobalsDialog() {
  kvDialog({
    title: 'Global variables',
    note: 'Global variables apply everywhere in this browser. Environments, collection variables, and vault override them.',
    entries: Object.entries(getGlobals()),
    onSave: (vars) => {
      setGlobals(vars);
      toast('Globals saved');
    },
  });
}

function checkVaultLockState() {
  const isEncrypted = localStorage.getItem('b4call-vault-encrypted') === 'true';
  const isVaultLocked = isEncrypted && decryptedVault === null;
  const vaultBtn = $('#vault-btn');
  if (vaultBtn) {
    // The padlock closes when the vault is encrypted and still locked.
    vaultBtn.innerHTML = iconSvg(isEncrypted && isVaultLocked ? 'lock' : 'unlock', 15);
    vaultBtn.append(
      document.createTextNode(isEncrypted && isVaultLocked ? 'Unlock Vault' : 'Vault')
    );
    vaultBtn.classList.add('has-icon');
  }
}

async function openVaultDialog() {
  const isEncrypted = localStorage.getItem('b4call-vault-encrypted') === 'true';
  
  if (isEncrypted && decryptedVault === null) {
    const pass = labelInput('Master Password', '', 'Enter password to unlock vault');
    pass.input.type = 'password';
    
    openModal('Unlock Local Vault', [pass.label], [
      { label: 'Cancel', onClick: (close) => close() },
      {
        label: 'Unlock',
        primary: true,
        onClick: async (close) => {
          const password = pass.input.value.trim();
          if (!password) return toast('Please enter password');
          try {
            const encryptedData = localStorage.getItem('b4call-vault');
            const decrypted = await cryptoVault.decrypt(encryptedData, password);
            decryptedVault = JSON.parse(decrypted);
            setDecryptedVaultMem(decryptedVault);
            vaultPassword = password;
            toast('Vault unlocked!');
            close();
            checkVaultLockState();
            openVaultDialog();
          } catch (err) {
            toast('Unlock failed: ' + err.message);
          }
        }
      }
    ]);
    return;
  }
  
  const currentData = decryptedVault || getVault();
  
  const noteEl = document.createElement('p');
  noteEl.className = 'modal-note';
  noteEl.textContent = 'Vault values stay in this browser only — they are never stored on the server. Use them as {{vault:name}}.';
  
  const container = document.createElement('div');
  const editor = createKvEditor(container, { keyPlaceholder: 'variable', valuePlaceholder: 'value' });
  editor.setRows(Object.entries(currentData).map(([key, value]) => ({ enabled: true, key, value })));
  
  const encryptionPanel = document.createElement('div');
  encryptionPanel.style.marginTop = '15px';
  encryptionPanel.style.padding = '10px';
  encryptionPanel.style.border = '1px solid var(--border)';
  encryptionPanel.style.borderRadius = 'var(--radius)';
  encryptionPanel.style.background = 'var(--bg)';
  
  if (isEncrypted) {
    encryptionPanel.innerHTML = `
      <div style="font-weight: 600; font-size: 12.5px; margin-bottom: 4px; color: var(--green);">✓ Vault is Encrypted</div>
      <p class="modal-note" style="margin-bottom: 8px;">Your secrets are safe behind AES-256-GCM encryption.</p>
      <button id="vault-decrypt-btn" class="btn btn-ghost" style="width: 100%;">Remove Encryption (Store as Plaintext)</button>
    `;
  } else {
    encryptionPanel.innerHTML = `
      <div style="font-weight: 600; font-size: 12.5px; margin-bottom: 4px; color: var(--text-dim);">Vault is Unencrypted</div>
      <p class="modal-note" style="margin-bottom: 8px;">Encrypt your secrets locally with a master password.</p>
      <button id="vault-encrypt-btn" class="btn btn-ghost" style="width: 100%;">Encrypt Vault with Password</button>
    `;
  }
  
  openModal('Manage Local Vault', [noteEl, container, encryptionPanel], [
    { label: 'Cancel', onClick: (close) => close() },
    {
      label: 'Save',
      primary: true,
      onClick: async (close) => {
        const vars = {};
        editor.getRows().forEach((r) => {
          if (r.enabled && r.key) vars[r.key] = r.value;
        });
        
        if (isEncrypted) {
          const encryptedData = await cryptoVault.encrypt(JSON.stringify(vars), vaultPassword);
          localStorage.setItem('b4call-vault', encryptedData);
          decryptedVault = vars;
          setDecryptedVaultMem(vars);
        } else {
          setVault(vars);
        }
        
        toast('Vault saved');
        close();
        renderVarsTab();
        checkVaultLockState();
      }
    }
  ]);
  
  const encryptBtn = document.getElementById('vault-encrypt-btn');
  if (encryptBtn) {
    encryptBtn.addEventListener('click', () => {
      const pass = labelInput('Set Master Password', '', 'Enter password to encrypt vault');
      pass.input.type = 'password';
      openModal('Encrypt Vault', [pass.label], [
        { label: 'Cancel', onClick: (close) => close() },
        {
          label: 'Encrypt',
          primary: true,
          onClick: async (close) => {
            const password = pass.input.value.trim();
            if (!password) return toast('Please enter a password');
            try {
              const vars = {};
              editor.getRows().forEach((r) => {
                if (r.enabled && r.key) vars[r.key] = r.value;
              });
              const encryptedData = await cryptoVault.encrypt(JSON.stringify(vars), password);
              localStorage.setItem('b4call-vault', encryptedData);
              localStorage.setItem('b4call-vault-encrypted', 'true');
              vaultPassword = password;
              decryptedVault = vars;
              setDecryptedVaultMem(vars);
              toast('Vault encrypted successfully!');
              close();
              document.querySelector('.modal-backdrop').remove(); // close both modals
              checkVaultLockState();
            } catch (err) {
              toast('Encryption failed: ' + err.message);
            }
          }
        }
      ]);
    });
  }
  
  const decryptBtn = document.getElementById('vault-decrypt-btn');
  if (decryptBtn) {
    decryptBtn.addEventListener('click', () => {
      const vars = decryptedVault || {};
      setVault(vars);
      localStorage.removeItem('b4call-vault-encrypted');
      vaultPassword = null;
      decryptedVault = null;
      setDecryptedVaultMem(null);
      toast('Vault encryption removed.');
      document.querySelector('.modal-backdrop').remove();
      checkVaultLockState();
    });
  }
}

function openCollectionVarsDialog(collection) {
  const note = document.createElement('p');
  note.className = 'modal-note';
  note.textContent = 'Collection variables are saved on the server, so they travel with the share link.';

  const container = document.createElement('div');
  const editor = createKvEditor(container, { keyPlaceholder: 'variable', valuePlaceholder: 'value' });
  editor.setRows(collection.variables || []);

  openModal(`Variables — ${collection.name}`, [note, container], [
    { label: 'Cancel', onClick: (close) => close() },
    {
      label: 'Save',
      primary: true,
      onClick: async (close) => {
        try {
          if (state.shared) {
            await api.sharedUpdateVariables(state.shared.token, editor.getRows());
          } else {
            await api.updateCollectionVariables(collection.id, editor.getRows());
          }
          close();
          toast('Collection variables saved');
          await reloadCollections();
        } catch (err) {
          toast(err.message);
        }
      },
    },
  ]);
}

function renderVarsTab() {
  const container = $('#variables-sidebar');
  if (!container) return;
  const collection = activeCollection();
  renderVariablesPanel({
    container,
    request: readRequestFromEditor(),
    collection,
    handlers: {
      onEditEnvironments: openEnvManager,
      onEditGlobals: openGlobalsDialog,
      onEditVault: openVaultDialog,
      onEditCollectionVars:
        collection && canEdit() ? () => openCollectionVarsDialog(collection) : null,
    },
  });
}

/* ---------------- response examples (#8) ---------------- */

function saveResponseExample(example) {
  const defaultName = `${$('#method').value} ${example.status}`;
  const name = prompt('Name this example', defaultName);
  if (name === null) return;
  const withId = {
    id:
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : String(Date.now()),
    name: name.trim() || defaultName,
    ...example,
  };
  setExamples([...getExamples(), withId]);
  markActiveTabDirty();
  toast('Example saved — Save the request to keep it');
  // Persist immediately if the request already exists on the server.
  if (state.activeRequestId) onSave();
}

/* ---------------- oauth token fetch (#2) ---------------- */

async function fetchOAuthToken() {
  const readField = (id) => document.querySelector(`#auth-${id}`)?.value ?? '';
  const sub = (s) => substituteVars(s, currentVars());
  const btn = $('#oauth-fetch-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Fetching…';
  }
  try {
    const result = await api.oauthToken({
      tokenUrl: sub(readField('tokenUrl')),
      grantType: readField('grantType') || 'client_credentials',
      clientId: sub(readField('clientId')),
      clientSecret: sub(readField('clientSecret')),
      scope: sub(readField('scope')),
      username: sub(readField('username')),
      password: sub(readField('password')),
    });
    const tokenInput = $('#auth-accessToken');
    if (tokenInput) tokenInput.value = result.accessToken || '';
    markActiveTabDirty();
    toast(result.accessToken ? 'Access token fetched' : 'No token returned');
  } catch (err) {
    toast(err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Get new access token';
    }
  }
}

/* ---------------- code generation ---------------- */

function openCodeDialog() {
  const req = readRequestFromEditor();
  if (!req.url) return toast('Enter a URL first');
  const snippets = generateSnippets(buildProxyPayload(req, currentVars()));

  const nodes = [];
  [['curl', snippets.curl], ['JavaScript fetch', snippets.fetch], ['axios', snippets.axios]].forEach(
    ([title, code]) => {
      const titleEl = document.createElement('div');
      titleEl.className = 'code-title';
      titleEl.textContent = title;

      const block = document.createElement('div');
      block.className = 'code-block';
      const pre = document.createElement('pre');
      pre.textContent = code;
      const copy = document.createElement('button');
      copy.className = 'btn';
      copy.textContent = 'Copy';
      copy.addEventListener('click', async () => {
        const ok = await copyText(code);
        toast(ok ? `${title} snippet copied` : 'Copy failed — select the text manually');
      });
      block.append(pre, copy);
      nodes.push(titleEl, block);
    }
  );

  openModal('Code snippets', nodes, [
    { label: 'Done', primary: true, onClick: (close) => close() },
  ]);
}

/* ---------------- new collection ---------------- */

function openNewCollectionDialog() {
  const name = labelInput('Collection name', '', 'e.g. My API');
  openModal('New collection', [name.label], [
    { label: 'Cancel', onClick: (close) => close() },
    {
      label: 'Create',
      primary: true,
      onClick: async (close) => {
        const value = name.input.value.trim();
        if (!value) return toast('Give the collection a name');
        try {
          await api.createCollection(value, getActiveWorkspaceId());
          close();
          await reloadCollections();
        } catch (err) {
          toast(err.message);
        }
      },
    },
  ]);
}

/* ---------------- collaboration wiring (#24, #25) ---------------- */

// Everyone on a share link joins the same room: presence, live change
// notifications, "X is editing", and a small chat.
function startCollaboration() {
  if (!state.shared) return;
  realtime.connect(state.shared.token, {
    getActiveRequest: () => ({
      id: state.activeRequestId,
      name: $('#request-name').textContent.trim(),
    }),
    onChanged: async (change) => {
      // Someone else saved — pull the collection and refresh what's on screen.
      try {
        await reloadCollections();
      } catch {
        /* the toast from realtime already told the user something happened */
      }
      invalidateActivity();
      if (change.requestId && change.requestId === state.activeRequestId) {
        refreshActivityPanel({ force: true });
      }
    },
  });
}

function activityTabIsOpen() {
  return !$('#tab-activity').classList.contains('hidden');
}

// Human-readable name for the field being edited, used in the "X is editing…"
// hint other collaborators see.
function fieldNameOf(target) {
  if (!target) return '';
  if (target.closest('.url-bar')) return 'URL';
  const panel = target.closest('.req-panel');
  if (!panel) return '';
  const id = panel.id.replace('tab-', '');
  const names = {
    params: 'query params',
    headers: 'headers',
    body: 'body',
    auth: 'auth',
    scripts: 'scripts',
    capture: 'tests',
    docs: 'docs',
    settings: 'settings',
  };
  return names[id] || '';
}

function openBackupDialog() {
  const content = document.createElement('div');
  content.style.display = 'flex';
  content.style.flexDirection = 'column';
  content.style.gap = '14px';

  const exportBtn = document.createElement('button');
  exportBtn.className = 'btn btn-primary btn-block';
  exportBtn.innerHTML = `${iconSvg('download', 14)}Export Entire Workspace Backup`;
  exportBtn.classList.add('has-icon');
  exportBtn.addEventListener('click', () => {
    const backupData = {
      collections: state.collections,
      environments: getEnvStore(),
      globals: getGlobals(),
      vault: getVault(),
      history: getHistory()
    };
    
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `b4call-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Workspace backup downloaded!');
  });

  const importContainer = document.createElement('div');
  importContainer.style.display = 'flex';
  importContainer.style.flexDirection = 'column';
  importContainer.style.gap = '6px';
  importContainer.innerHTML = `
    <div class="vars-title" style="margin: 0;">Restore Workspace Backup</div>
    <p class="modal-note" style="margin-bottom: 6px;">Importing a backup file will restore all collections, environments, globals, history, and vault keys. <b>Note:</b> Current collections will be overwritten.</p>
    <input type="file" id="backup-file-picker" accept=".json" class="btn btn-block" style="padding: 10px;">
  `;

  content.append(exportBtn, importContainer);

  openModal('Backup & Restore Workspace', [content], [
    { label: 'Cancel', onClick: (close) => close() },
    {
      label: 'Restore Backup',
      primary: true,
      onClick: async (close) => {
        const picker = document.getElementById('backup-file-picker');
        const file = picker?.files?.[0];
        if (!file) return toast('Please select a backup file to restore.');

        try {
          const text = await file.text();
          const backup = JSON.parse(text);
          if (!backup || typeof backup !== 'object') {
            throw new Error('Invalid backup file structure.');
          }

          if (backup.environments) setEnvStore(backup.environments);
          if (backup.globals) setGlobals(backup.globals);
          if (backup.vault) setVault(backup.vault);
          if (backup.history) {
            localStorage.setItem('b4call-history', JSON.stringify(backup.history));
          }

          if (Array.isArray(backup.collections)) {
            for (const col of backup.collections) {
              const existing = state.collections.find(c => c.name === col.name);
              if (existing) {
                await api.bulkUpdate(existing.id, {
                  folders: col.folders || [],
                  requests: col.requests || [],
                  variables: col.variables || []
                });
              } else {
                const created = await api.createCollection(col.name);
                await api.bulkUpdate(created.id, {
                  folders: col.folders || [],
                  requests: col.requests || [],
                  variables: col.variables || []
                });
              }
            }
          }

          toast('Workspace restored successfully!');
          close();
          await reloadCollections();
        } catch (err) {
          toast(`Restore failed: ${err.message}`);
        }
      }
    }
  ]);
}

/* ---------------- event wiring ---------------- */

function bindEvents() {
  $('#send-btn').addEventListener('click', onSend);
  $('#url').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onSend();
  });
  $('#save-btn').addEventListener('click', onSave);
  $('#code-btn').addEventListener('click', openCodeDialog);
  $('#request-name').addEventListener('click', openRenameDialog);
  $('#vault-btn').addEventListener('click', openVaultDialog);
  $('#backup-btn').addEventListener('click', openBackupDialog);
  $('#cookies-btn').addEventListener('click', openCookieDialog);
  $('#appearance-btn').addEventListener('click', openAppearanceDialog);
  $('#mock-btn').addEventListener('click', () => openMockDialog(state.collections));
  $('#help-btn').addEventListener('click', openHelpDialog);
  $('#open-proxy-btn').addEventListener('click', openProxyDialog);
  $('#new-collection-btn').addEventListener('click', openNewCollectionDialog);
  $('#import-btn').addEventListener('click', openImportDialog);
  $('#sidebar-search').addEventListener('input', refreshSidebar);

  // Sidebar quick-filter chips (All / Favorites).
  document.querySelectorAll('.sidebar-filter-chips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-filter-chips .chip').forEach((c) =>
        c.classList.toggle('active', c === chip)
      );
      $('#sidebar-search').value = chip.dataset.filter || '';
      refreshSidebar();
    });
  });

  // "?" opens the shortcut cheatsheet when not typing in a field.
  document.addEventListener('keydown', (e) => {
    if (e.key === '?' && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !e.target.isContentEditable) {
      openHelpDialog();
    }
  });

  // OAuth "Get new access token" button (auth fields are re-rendered often).
  $('#auth-fields').addEventListener('click', (e) => {
    if (e.target && e.target.id === 'oauth-fetch-btn') fetchOAuthToken();
  });
  $('#clear-history-btn').addEventListener('click', () => {
    clearHistory();
    refreshHistory();
  });
  $('#method').addEventListener('change', () => {
    const method = $('#method').value;
    const btn = $('#send-btn');
    if (method === 'WS' || method === 'SSE') {
      btn.textContent = 'Connect';
      btn.disabled = false;
    } else {
      wsClient.disconnect();
      btn.textContent = 'Send';
      btn.disabled = false;
      btn.style.background = '';
      btn.style.borderColor = '';
      $('#resp-tabs').classList.add('hidden');
      $('#response-toolbar').classList.add('hidden');
      $('#response-empty').classList.remove('hidden');
      $('#response-status').classList.add('hidden');
    }
    touchActiveTab();
  });

  // Unsaved-changes dot: any edit inside the request editor marks the tab dirty.
  const workspace = document.querySelector('.workspace');
  const markDirtyIfEditing = (e) => {
    if (!e.target.closest('.url-bar, .req-panels')) return;
    markActiveTabDirty();
    // Let collaborators on the same link see that this request is being worked on.
    realtime.signalEditing(fieldNameOf(e.target));
  };
  workspace.addEventListener('input', markDirtyIfEditing, true);
  workspace.addEventListener('change', markDirtyIfEditing, true);

  // Keep the always-visible Variables sidebar in sync while editing the request.
  let varsRefreshTimer = null;
  const refreshVarsSidebar = (e) => {
    if (!e.target.closest('.url-bar, .req-panels')) return;
    clearTimeout(varsRefreshTimer);
    varsRefreshTimer = setTimeout(renderVarsTab, 250);
  };
  workspace.addEventListener('input', refreshVarsSidebar, true);
  workspace.addEventListener('change', refreshVarsSidebar, true);

  // Resizable sidebar — drag the divider; width is remembered.
  const sidebar = document.querySelector('.sidebar');
  const resizer = $('#sidebar-resizer');
  const savedWidth = Number(localStorage.getItem('b4call-sidebar-width'));
  if (savedWidth >= 200) sidebar.style.width = `${savedWidth}px`;
  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    resizer.classList.add('dragging');
    document.body.style.userSelect = 'none';
    const onMove = (ev) => {
      const width = Math.min(Math.max(ev.clientX, 200), window.innerWidth * 0.6);
      sidebar.style.width = `${width}px`;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      resizer.classList.remove('dragging');
      document.body.style.userSelect = '';
      localStorage.setItem('b4call-sidebar-width', String(sidebar.offsetWidth));
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Resizable right sidebar (variables) — drag the divider; width is remembered.
  const rightSidebar = document.querySelector('.right-sidebar');
  const rightResizer = $('#right-sidebar-resizer');
  const savedRightWidth = Number(localStorage.getItem('b4call-right-sidebar-width'));
  if (savedRightWidth >= 200) rightSidebar.style.width = `${savedRightWidth}px`;
  rightResizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    rightResizer.classList.add('dragging');
    document.body.style.userSelect = 'none';
    const onMove = (ev) => {
      const width = Math.min(Math.max(window.innerWidth - ev.clientX, 200), window.innerWidth * 0.6);
      rightSidebar.style.width = `${width}px`;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      rightResizer.classList.remove('dragging');
      document.body.style.userSelect = '';
      localStorage.setItem('b4call-right-sidebar-width', String(rightSidebar.offsetWidth));
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Resizable response panel — drag the divider; height is remembered.
  const reqPanels = document.querySelector('.req-panels');
  const respResizer = $('#response-resizer');
  const savedHeight = Number(localStorage.getItem('b4call-req-panels-height'));
  if (savedHeight >= 100) reqPanels.style.height = `${savedHeight}px`;
  
  respResizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    respResizer.classList.add('dragging');
    document.body.style.userSelect = 'none';
    const startHeight = reqPanels.offsetHeight;
    const startY = e.clientY;
    
    const onMove = (ev) => {
      const deltaY = ev.clientY - startY;
      const height = Math.min(Math.max(startHeight + deltaY, 100), window.innerHeight - 200);
      reqPanels.style.height = `${height}px`;
    };
    
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      respResizer.classList.remove('dragging');
      document.body.style.userSelect = '';
      localStorage.setItem('b4call-req-panels-height', String(reqPanels.offsetHeight));
    };
    
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Keyboard shortcuts: Ctrl+Enter = Send, Ctrl+S = Save.
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      onSend();
    } else if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      onSave();
    }
  });

  document.querySelectorAll('.req-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.req-tab').forEach((b) =>
        b.classList.toggle('active', b === btn)
      );
      ['params', 'headers', 'body', 'auth', 'scripts', 'capture', 'docs', 'activity', 'settings'].forEach(
        (tab) => $(`#tab-${tab}`).classList.toggle('hidden', tab !== btn.dataset.tab)
      );
      if (btn.dataset.tab === 'activity') refreshActivityPanel();
    });
  });

  document.querySelectorAll('.sidebar-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-tab').forEach((b) =>
        b.classList.toggle('active', b === btn)
      );
      $('#collections-view').classList.toggle('hidden', btn.dataset.view !== 'collections');
      $('#history-view').classList.toggle('hidden', btn.dataset.view !== 'history');
    });
  });

  document.querySelectorAll('input[name="bodyType"]').forEach((radio) => {
    radio.addEventListener('change', updateBodyVisibility);
  });

  $('#auth-type').addEventListener('change', () => renderAuthFields({}));
}

/* ---------------- boot ---------------- */

async function boot() {
  hydrateIcons();
  initAppearance();
  checkVaultLockState();
  initResponsePanel({
    onSaveExample: saveResponseExample,
    getExamples,
    onLoadExample: () => {},
    getRequestName: () => $('#request-name').textContent.trim(),
  });
  initBodyEditor();
  bindEvents();
  await initWorkspaces(reloadCollections);
  initCommandPalette({
    getCollections: () => state.collections,
    onOpenRequest: (collection, req) =>
      openRequestTab({ requestId: req.id, collectionId: collection.id, snapshot: structuredClone(req) }),
    actions: [
      { title: 'New collection', run: openNewCollectionDialog },
      { title: 'Import…', run: openImportDialog },
      { title: 'Manage environments', run: openEnvManager },
      { title: 'Cookie jar', run: openCookieDialog },
      { title: 'Appearance — theme, text size, density', run: openAppearanceDialog },
      { title: 'Change my collaborator name', run: realtime.openIdentityDialog },
      { title: 'Keyboard shortcuts', run: openHelpDialog },
    ],
  });
  initKeyboard({
    send: onSend,
    newTab: () => openBlankTab(),
    closeTab: closeActiveTab,
    cycleTab,
    activateTabIndex,
    runCollection: () => {
      const collection = activeCollection();
      if (!collection) return toast('Open a collection first');
      openRunner(collection, { getVars: () => mergedVars(getScopes(collection)) });
    },
  });
  initActivityPanel({
    getRequestId: () => state.activeRequestId,
    canEdit,
    onRestore: (snapshot) => {
      loadRequestIntoEditor({ ...blankSnapshot(), ...snapshot, id: undefined });
      markActiveTabDirty();
      updateActiveTabMeta({ title: snapshot.name });
    },
  });
  registerServiceWorker();
  initEnvSelector(renderVarsTab);
  initVarAutocomplete(() => getScopes(activeCollection()));
  initVarHover(() => getScopes(activeCollection()));
  initCollectionActions({
    reloadCollections,
    onCopyCurl: async (collection, req) => {
      try {
        const payload = buildProxyPayload(req, currentVars());
        const snippets = generateSnippets(payload);
        const ok = await copyText(snippets.curl);
        toast(ok ? 'cURL command copied to clipboard' : 'Failed to copy cURL');
      } catch (err) {
        toast(err.message);
      }
    },
    openImportedRequest: (req) => {
      openRequestTab({
        requestId: null,
        collectionId: null,
        snapshot: { ...blankSnapshot(), ...req },
      });
    },
    getWorkspaceId: getActiveWorkspaceId,
  });
  initRequestTabs({
    container: $('#tab-bar'),
    getSnapshot: readRequestFromEditor,
    onActivate: (tab) => {
      state.activeCollectionId = tab.collectionId;
      state.activeRequestId = tab.requestId;
      loadRequestIntoEditor(tab.snapshot);
      // Each tab keeps its own response; restore it or clear the panel.
      if (tab.response) {
        renderResponse(tab.response.result, {
          tests: tab.response.tests,
          requestId: tab.response.requestId,
        });
      } else {
        clearResponse();
      }
      refreshSidebar();
      renderVarsTab();
      // Tell collaborators which request this person moved to, and reload the
      // comments/history for the newly active request.
      realtime.announceActiveRequest();
      invalidateActivity();
      if (activityTabIsOpen()) refreshActivityPanel();
      // Ensure variable highlights update instantly
      setTimeout(updateAllHighlights, 50);
    },
  });

  const token = parseShareToken();
  if (token) {
    try {
      const { collection, mode } = await api.getShared(token);
      state.shared = { token, mode };
      state.collections = [collection];
      const banner = $('#share-banner');
      banner.classList.remove('hidden');
      banner.textContent = '';
      banner.insertAdjacentHTML('afterbegin', iconSvg('share', 14));
      banner.append(
        document.createTextNode(
          mode === 'edit'
            ? `Shared collection “${collection.name}” — anyone with this link can run and edit requests`
            : `Shared collection “${collection.name}” — read-only (you can still run every request)`
        )
      );
      banner.classList.add('has-icon');
      $('#new-collection-btn').classList.add('hidden');
      $('#import-btn').classList.add('hidden');
      startCollaboration();
    } catch (err) {
      const banner = $('#share-banner');
      banner.classList.remove('hidden');
      banner.textContent = `⚠ ${err.message}`;
    }
  } else {
    try {
      state.collections = await api.listCollections(getActiveWorkspaceId());
    } catch (err) {
      toast(err.message);
    }
  }

  refreshSidebar();
  refreshHistory();
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline support is best-effort */
    });
  }
}

boot();
