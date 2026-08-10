// Remembers the most recent response per request name so later requests can
// chain off them with {{res:RequestName.body.path}} references.
const responses = new Map();

export function recordResponse(name, result) {
  if (!name || !result || result.error) return;
  let json = null;
  try {
    json = JSON.parse(result.body);
  } catch {
    /* not JSON — only body/headers/status refs will work */
  }
  responses.set(name, {
    status: result.status,
    headers: result.headers || {},
    body: result.body || '',
    json,
  });
}

export function knownResponseNames() {
  return [...responses.keys()];
}

// Walk a dotted/indexed path (a.b[0].c) through a parsed value.
function digPath(value, path) {
  if (!path) return value;
  const tokens = path.match(/[^.[\]]+/g) || [];
  let current = value;
  for (const token of tokens) {
    if (current == null) return undefined;
    current = current[token];
  }
  return current;
}

// Resolve "Name.body.path" | "Name.headers.Header-Name" | "Name.status".
export function resolveResponseRef(ref) {
  const match = String(ref).match(/^(.*?)\.(body|headers|status)(?:\.(.*))?$/);
  if (!match) return undefined;
  const [, name, field, path] = match;
  const entry = responses.get(name);
  if (!entry) return undefined;

  if (field === 'status') return String(entry.status ?? '');
  if (field === 'headers') {
    if (!path) return undefined;
    const key = Object.keys(entry.headers).find((k) => k.toLowerCase() === path.toLowerCase());
    return key ? String(entry.headers[key]) : undefined;
  }
  // body
  if (entry.json != null) {
    const found = digPath(entry.json, path);
    if (found === undefined) return undefined;
    return typeof found === 'object' ? JSON.stringify(found) : String(found);
  }
  return path ? undefined : entry.body;
}
