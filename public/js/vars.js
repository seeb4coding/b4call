import { getActiveEnvironment, getGlobals, getVault } from './state.js';

// Allows vault:name and res:Name.body.path[0] chaining references too.
export const VAR_PATTERN = /\{\{\s*([\w.:\-[\]]+)\s*\}\}/g;

const enabledRows = (rows) => (rows || []).filter((r) => r.enabled && r.key);

export function rowsToVars(rows) {
  const vars = {};
  enabledRows(rows).forEach((r) => {
    vars[r.key] = r.value;
  });
  return vars;
}

// Every string in the request where {{variables}} may appear.
function collectRequestStrings(req) {
  const strings = [req.url];
  enabledRows(req.params).forEach((r) => strings.push(r.key, r.value));
  enabledRows(req.headers).forEach((r) => strings.push(r.key, r.value));
  if (req.bodyType === 'json' || req.bodyType === 'text') {
    strings.push(req.bodyRaw);
  } else if (req.bodyType === 'form-urlencoded' || req.bodyType === 'form-data') {
    enabledRows(req.bodyForm).forEach((r) => strings.push(r.key, r.value));
  } else if (req.bodyType === 'graphql') {
    strings.push(req.graphqlQuery, req.graphqlVariables);
  }
  (req.pathVars || []).forEach((r) => strings.push(r.value));
  const auth = req.auth || {};
  if (auth.type === 'bearer') strings.push(auth.token);
  if (auth.type === 'basic') strings.push(auth.username, auth.password);
  if (auth.type === 'apikey') strings.push(auth.key, auth.value);
  return strings;
}

// Ordered unique list of variable names used anywhere in the request.
export function scanRequestVars(req) {
  const names = [];
  for (const str of collectRequestStrings(req)) {
    for (const match of String(str ?? '').matchAll(VAR_PATTERN)) {
      if (!names.includes(match[1])) names.push(match[1]);
    }
  }
  return names;
}

// The scopes, resolved for the current context.
export function getScopes(collection) {
  return {
    environment: getActiveEnvironment(), // { id, name, vars } | null
    collection: collection
      ? { name: collection.name, vars: rowsToVars(collection.variables) }
      : null,
    globals: getGlobals(),
    vault: getVault(), // referenced as {{vault:name}}
  };
}

// Precedence (highest wins): Vault > Environment > Collection > Globals.
export function mergedVars(scopes) {
  const vaultEntries = Object.fromEntries(
    Object.entries(scopes.vault || {}).map(([key, value]) => [`vault:${key}`, value])
  );
  return {
    ...scopes.globals,
    ...(scopes.collection ? scopes.collection.vars : {}),
    ...(scopes.environment ? scopes.environment.vars : {}),
    ...vaultEntries,
  };
}

// Where does a single variable resolve from? → { value, scope: 'V'|'E'|'C'|'G' } | null
export function lookupVar(name, scopes) {
  if (name.startsWith('vault:')) {
    const key = name.slice('vault:'.length);
    if (scopes.vault && key in scopes.vault) {
      return { value: scopes.vault[key], scope: 'V' };
    }
    return null;
  }
  if (scopes.environment && name in scopes.environment.vars) {
    return { value: scopes.environment.vars[name], scope: 'E' };
  }
  if (scopes.collection && name in scopes.collection.vars) {
    return { value: scopes.collection.vars[name], scope: 'C' };
  }
  if (name in scopes.globals) {
    return { value: scopes.globals[name], scope: 'G' };
  }
  return null;
}
