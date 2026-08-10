import { scanRequestVars, getScopes, lookupVar } from './vars.js';

function scopeBadge(scope) {
  const badge = document.createElement('span');
  badge.className = `scope-badge scope-${scope}`;
  badge.textContent = scope;
  badge.title = { E: 'Environment', C: 'Collection', G: 'Globals', V: 'Local Vault' }[scope];
  return badge;
}

function varRow(badge, name, value, unresolved = false) {
  const row = document.createElement('div');
  row.className = 'var-row';
  const nameEl = document.createElement('span');
  nameEl.className = 'var-name';
  nameEl.textContent = name;
  const valueEl = document.createElement('span');
  valueEl.className = unresolved ? 'var-value var-unresolved' : 'var-value';
  valueEl.textContent = value;
  valueEl.title = value;
  row.append(badge ?? scopePlaceholder(), nameEl, valueEl);
  return row;
}

function scopePlaceholder() {
  const span = document.createElement('span');
  span.className = 'scope-badge scope-none';
  span.textContent = '?';
  span.title = 'Not defined in any scope';
  return span;
}

function sectionTitle(text) {
  const el = document.createElement('div');
  el.className = 'vars-title';
  el.textContent = text;
  return el;
}

function scopeHeader(scope, name, editLabel, onEdit) {
  const header = document.createElement('div');
  header.className = 'scope-header';
  header.append(scopeBadge(scope));
  const nameEl = document.createElement('span');
  nameEl.className = 'scope-name';
  nameEl.textContent = name;
  header.appendChild(nameEl);
  if (onEdit) {
    const link = document.createElement('button');
    link.className = 'link-btn';
    link.textContent = editLabel;
    link.addEventListener('click', onEdit);
    header.appendChild(link);
  }
  return header;
}

function note(text) {
  const el = document.createElement('div');
  el.className = 'empty-note vars-note';
  el.textContent = text;
  return el;
}

function spacerBadge() {
  const span = document.createElement('span');
  span.className = 'scope-badge scope-spacer';
  return span;
}

function scopeVarList(vars) {
  const box = document.createElement('div');
  Object.entries(vars).forEach(([name, value]) => {
    box.appendChild(varRow(spacerBadge(), name, value));
  });
  return box;
}

// Renders the whole panel: "Variables in request" + "All variables" by scope.
export function renderVariablesPanel({ container, request, collection, handlers }) {
  const scopes = getScopes(collection);
  container.textContent = '';

  /* --- variables used in the current request --- */
  container.appendChild(sectionTitle('Variables in request'));
  const used = scanRequestVars(request);
  if (used.length === 0) {
    container.appendChild(note('No {{variables}} used in this request yet.'));
  } else {
    used.forEach((name) => {
      const hit = lookupVar(name, scopes);
      if (hit) {
        container.appendChild(varRow(scopeBadge(hit.scope), name, hit.value));
      } else {
        container.appendChild(varRow(null, name, 'not defined in any scope', true));
      }
    });
  }

  /* --- all variables, by scope --- */
  container.appendChild(sectionTitle('All variables'));

  // E — active environment
  if (scopes.environment) {
    container.appendChild(
      scopeHeader('E', scopes.environment.name, 'Edit', handlers.onEditEnvironments)
    );
    const entries = Object.entries(scopes.environment.vars);
    if (entries.length === 0) {
      container.appendChild(note('No variables in this environment. Use “Edit” to add some.'));
    } else {
      container.appendChild(scopeVarList(scopes.environment.vars));
    }
  } else {
    container.appendChild(scopeHeader('E', 'No environment selected', 'Manage', handlers.onEditEnvironments));
    container.appendChild(note('Choose an environment in the top bar, or create one.'));
  }

  // C — collection variables
  if (scopes.collection) {
    container.appendChild(
      scopeHeader('C', scopes.collection.name, handlers.onEditCollectionVars ? 'Edit' : null, handlers.onEditCollectionVars)
    );
    const entries = Object.entries(scopes.collection.vars);
    if (entries.length === 0) {
      container.appendChild(note('No variables defined in this collection.'));
    } else {
      container.appendChild(scopeVarList(scopes.collection.vars));
    }
  } else {
    container.appendChild(scopeHeader('C', 'Collection', null, null));
    container.appendChild(note('Open a saved request to see its collection variables.'));
  }

  // G — globals
  container.appendChild(scopeHeader('G', 'Globals', 'Edit', handlers.onEditGlobals));
  const globalEntries = Object.entries(scopes.globals);
  if (globalEntries.length === 0) {
    container.appendChild(note('No global variables in this workspace.'));
  } else {
    container.appendChild(scopeVarList(scopes.globals));
  }

  // V — local vault (masked values)
  container.appendChild(scopeHeader('V', 'Local Vault', 'Edit', handlers.onEditVault));
  const vaultKeys = Object.keys(scopes.vault || {});
  if (vaultKeys.length === 0) {
    container.appendChild(note('No vault secrets. Use as {{vault:name}} — stored only in this browser, never shared.'));
  } else {
    const masked = Object.fromEntries(vaultKeys.map((key) => [`vault:${key}`, '••••••••']));
    container.appendChild(scopeVarList(masked));
  }
}
