// Runs after a response arrives: capture variables from the response and
// evaluate simple test assertions.
import { getEnvStore, setEnvStore, getGlobals, setGlobals } from './state.js';

// "data.token", "$.data.token" and "items[0].id" style paths.
export function getJsonPath(obj, path) {
  const clean = String(path).replace(/^\$\.?/, '');
  const segments = clean
    .split('.')
    .flatMap((s) => s.split(/[\[\]]/).filter(Boolean));
  let current = obj;
  for (const segment of segments) {
    if (current == null) return undefined;
    current = current[/^\d+$/.test(segment) ? Number(segment) : segment];
  }
  return current;
}

function saveVar(name, value) {
  const envStore = getEnvStore();
  const active = envStore.environments.find((e) => e.id === envStore.activeId);
  if (active) {
    setEnvStore({
      ...envStore,
      environments: envStore.environments.map((e) =>
        e.id === active.id ? { ...e, vars: { ...e.vars, [name]: value } } : e
      ),
    });
  } else {
    setGlobals({ ...getGlobals(), [name]: value });
  }
}

function parseJsonBody(result) {
  try {
    return JSON.parse(result.body);
  } catch {
    return null;
  }
}

// rows: [{ enabled, key: <response path | "status">, value: <variable name> }]
// Saves into the active environment (or globals if none is selected).
export function applyCapture(rows, result) {
  const saved = [];
  if (!rows?.length || result.error) return saved;
  const json = parseJsonBody(result);

  for (const row of rows.filter((r) => r.enabled && r.key && r.value)) {
    let value;
    if (row.key === 'status') value = result.status;
    else if (json !== null) value = getJsonPath(json, row.key);
    if (value === undefined || value === null) continue;
    const stored = typeof value === 'object' ? JSON.stringify(value) : String(value);
    saveVar(row.value, stored);
    saved.push({ name: row.value, value: stored });
  }
  return saved;
}

// rows: [{ enabled, key: <"status" | "body-contains" | json path>, value: <expected> }]
export function runTests(rows, result) {
  const results = [];
  if (!rows?.length) return results;
  const json = result.error ? null : parseJsonBody(result);

  for (const row of rows.filter((r) => r.enabled && r.key)) {
    const expected = String(row.value ?? '').trim();
    let pass = false;
    let actual;

    if (result.error) {
      actual = `request failed: ${result.error}`;
    } else if (row.key === 'status') {
      actual = String(result.status);
      pass = actual === expected;
    } else if (row.key === 'body-contains') {
      actual = expected;
      pass = String(result.body ?? '').includes(row.value);
    } else {
      const found = json === null ? undefined : getJsonPath(json, row.key);
      actual =
        found === undefined
          ? '(not found)'
          : typeof found === 'object'
            ? JSON.stringify(found)
            : String(found);
      // Empty expected value means "path must exist".
      pass = expected === '' ? found !== undefined : actual === expected;
    }

    results.push({
      label: expected ? `${row.key} = ${expected}` : `${row.key} exists`,
      pass,
      actual,
    });
  }
  return results;
}
