export const state = {
  collections: [],
  activeCollectionId: null,
  activeRequestId: null,
  shared: null, // { token, mode } when viewing via a share link
};

const ENVS_KEY = 'b4call-environments';
const GLOBALS_KEY = 'b4call-globals';
const LEGACY_ENV_KEY = 'b4call-env';
const HISTORY_KEY = 'b4call-history';
const HISTORY_LIMIT = 50;

function readJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

/* ---------- environments (multiple, named, one active) ---------- */

export function getEnvStore() {
  const stored = readJson(ENVS_KEY, null);
  if (stored && Array.isArray(stored.environments)) return stored;

  // Migrate the old single-environment storage into a named "Default" env.
  const legacyVars = readJson(LEGACY_ENV_KEY, {});
  const hasLegacy = Object.keys(legacyVars).length > 0;
  return {
    activeId: hasLegacy ? 'default' : '',
    environments: hasLegacy
      ? [{ id: 'default', name: 'Default', vars: legacyVars }]
      : [],
  };
}

export function setEnvStore(envStore) {
  localStorage.setItem(ENVS_KEY, JSON.stringify(envStore));
}

export function getActiveEnvironment() {
  const envStore = getEnvStore();
  return envStore.environments.find((e) => e.id === envStore.activeId) || null;
}

export function setActiveEnvironment(id) {
  setEnvStore({ ...getEnvStore(), activeId: id });
}

/* ---------- globals ---------- */

export function getGlobals() {
  const vars = readJson(GLOBALS_KEY, {});
  return typeof vars === 'object' && vars !== null ? vars : {};
}

export function setGlobals(vars) {
  localStorage.setItem(GLOBALS_KEY, JSON.stringify(vars));
}

/* ---------- local vault (secrets, never leave this browser) ---------- */

const VAULT_KEY = 'b4call-vault';
let decryptedVaultMem = null;

export function setDecryptedVaultMem(val) {
  decryptedVaultMem = val;
}

export function getVault() {
  if (decryptedVaultMem) return decryptedVaultMem;
  const isEncrypted = localStorage.getItem('b4call-vault-encrypted') === 'true';
  if (isEncrypted) return {}; // locked
  const vars = readJson(VAULT_KEY, {});
  return typeof vars === 'object' && vars !== null ? vars : {};
}

export function setVault(vars) {
  localStorage.setItem(VAULT_KEY, JSON.stringify(vars));
}

/* ---------- per-request response history ---------- */

const RESP_HISTORY_KEY = 'b4call-resp-history';
const RESP_HISTORY_LIMIT = 10;
const RESP_BODY_LIMIT = 50_000;

export function getRespHistory(requestId) {
  const all = readJson(RESP_HISTORY_KEY, {});
  const list = all && typeof all === 'object' ? all[requestId] : null;
  return Array.isArray(list) ? list : [];
}

export function addRespHistory(requestId, result) {
  if (!requestId) return;
  const all = readJson(RESP_HISTORY_KEY, {});
  const store = all && typeof all === 'object' ? all : {};
  // Binary payloads and hex windows are far too large to keep in localStorage.
  const { bodyBase64, hexPreview, ...rest } = result;
  const entry = {
    at: Date.now(),
    ...rest,
    body:
      typeof result.body === 'string' && result.body.length > RESP_BODY_LIMIT
        ? `${result.body.slice(0, RESP_BODY_LIMIT)}\n--- truncated for history ---`
        : result.body,
  };
  const list = [entry, ...getRespHistory(requestId)].slice(0, RESP_HISTORY_LIMIT);
  try {
    localStorage.setItem(RESP_HISTORY_KEY, JSON.stringify({ ...store, [requestId]: list }));
  } catch {
    // localStorage full — drop all response history rather than break sending.
    localStorage.removeItem(RESP_HISTORY_KEY);
  }
}

/* ---------- history ---------- */

export function getHistory() {
  const list = readJson(HISTORY_KEY, []);
  return Array.isArray(list) ? list : [];
}

export function addHistory(entry) {
  const list = [entry, ...getHistory()].slice(0, HISTORY_LIMIT);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
}

export function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
}
