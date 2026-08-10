// Infers a JSON Schema (draft-07) and TypeScript types from a sample response.
//
// Arrays are merged across every element so `[{a:1},{a:1,b:2}]` yields one item
// shape where `b` is optional, and unions ("string | null") are produced when a
// field genuinely varies. Formats (date-time, email, uri, uuid) are sniffed
// from string values so the schema is useful for contract checks.

const FORMAT_TESTS = [
  ['uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i],
  ['date-time', /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:?\d{2})?$/],
  ['date', /^\d{4}-\d{2}-\d{2}$/],
  ['email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/],
  ['uri', /^https?:\/\/\S+$/i],
  ['ipv4', /^(\d{1,3}\.){3}\d{1,3}$/],
];

function detectFormat(value) {
  for (const [format, pattern] of FORMAT_TESTS) {
    if (pattern.test(value)) return format;
  }
  return null;
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value; // string | number | boolean | object
}

// Build a schema node for one value.
function describe(value, options) {
  const type = typeOf(value);

  if (type === 'array') {
    if (value.length === 0) return { type: 'array', items: {} };
    const items = value.slice(0, options.sampleLimit).map((v) => describe(v, options));
    return { type: 'array', items: mergeAll(items) };
  }

  if (type === 'object') {
    const properties = {};
    const required = [];
    for (const [key, child] of Object.entries(value)) {
      properties[key] = describe(child, options);
      required.push(key);
    }
    const node = { type: 'object', properties };
    if (required.length) node.required = required;
    return node;
  }

  const node = { type };
  if (type === 'string') {
    const format = detectFormat(value);
    if (format) node.format = format;
    if (options.includeExamples && value.length <= 80) node.examples = [value];
  } else if ((type === 'number' || type === 'integer' || type === 'boolean') && options.includeExamples) {
    node.examples = [value];
  }
  return node;
}

function unionTypes(a, b) {
  let list = [...new Set([...[].concat(a), ...[].concat(b)])];
  // integer is a subset of number — collapse the pair.
  if (list.includes('number') && list.includes('integer')) {
    list = list.filter((t) => t !== 'integer');
  }
  return list.length === 1 ? list[0] : list;
}

// Merge two schema nodes describing the same position in different samples.
function merge(a, b) {
  if (!a) return b;
  if (!b) return a;

  const type = unionTypes(a.type, b.type);
  const types = [].concat(type);

  if (types.includes('object') && a.properties && b.properties) {
    const keys = [...new Set([...Object.keys(a.properties), ...Object.keys(b.properties)])];
    const properties = {};
    for (const key of keys) {
      properties[key] = merge(a.properties[key], b.properties[key]);
    }
    const required = (a.required || []).filter((k) => (b.required || []).includes(k));
    const node = { type, properties };
    if (required.length) node.required = required;
    return node;
  }

  if (types.includes('array') && (a.items || b.items)) {
    return { type, items: merge(a.items, b.items) };
  }

  const node = { type };
  const format = a.format && a.format === b.format ? a.format : null;
  if (format) node.format = format;
  const examples = [...new Set([...(a.examples || []), ...(b.examples || [])])].slice(0, 3);
  if (examples.length) node.examples = examples;
  return node;
}

function mergeAll(nodes) {
  return nodes.reduce((acc, node) => merge(acc, node), null) || {};
}

export function inferJsonSchema(data, { title = 'Response', sampleLimit = 200, includeExamples = false } = {}) {
  const schema = describe(data, { sampleLimit, includeExamples });
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title,
    ...schema,
  };
}

/* ---------------- TypeScript ---------------- */

const RESERVED = /^[A-Za-z_$][\w$]*$/;

function pascal(name) {
  return String(name)
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^[a-z]/, (c) => c.toUpperCase()) || 'Value';
}

function singular(name) {
  if (/ies$/i.test(name)) return `${name.slice(0, -3)}y`;
  if (/(ses|xes|zes|ches|shes)$/i.test(name)) return name.slice(0, -2);
  if (/s$/i.test(name) && !/ss$/i.test(name)) return name.slice(0, -1);
  return `${name}Item`;
}

// Emits a set of named interfaces plus the root type expression.
export function inferTypeScript(data, { rootName = 'Response', sampleLimit = 200 } = {}) {
  const schema = describe(data, { sampleLimit, includeExamples: false });
  const interfaces = [];
  const usedNames = new Set();

  const uniqueName = (base) => {
    let name = pascal(base);
    let n = 2;
    while (usedNames.has(name)) {
      name = `${pascal(base)}${n}`;
      n += 1;
    }
    usedNames.add(name);
    return name;
  };

  const render = (node, nameHint) => {
    const types = [].concat(node.type ?? 'any');

    const single = (type) => {
      if (type === 'object') {
        if (!node.properties || Object.keys(node.properties).length === 0) {
          return 'Record<string, unknown>';
        }
        const name = uniqueName(nameHint);
        const lines = Object.entries(node.properties).map(([key, child]) => {
          const optional = node.required && !node.required.includes(key) ? '?' : '';
          const propName = RESERVED.test(key) ? key : JSON.stringify(key);
          return `  ${propName}${optional}: ${render(child, singularHintFor(nameHint, key))};`;
        });
        interfaces.push(`export interface ${name} {\n${lines.join('\n')}\n}`);
        return name;
      }
      if (type === 'array') {
        const inner = render(node.items || {}, singular(nameHint));
        return inner.includes(' | ') ? `(${inner})[]` : `${inner}[]`;
      }
      if (type === 'integer') return 'number';
      if (type === 'null') return 'null';
      if (type === 'string' || type === 'number' || type === 'boolean') return type;
      return 'unknown';
    };

    const rendered = [...new Set(types.map(single))];
    return rendered.join(' | ');
  };

  const singularHintFor = (parentHint, key) => pascal(key);

  const root = render(schema, rootName);
  const body = interfaces.join('\n\n');
  if (interfaces.some((def) => def.startsWith(`export interface ${pascal(rootName)} `))) {
    return body;
  }
  return `${body}${body ? '\n\n' : ''}export type ${pascal(rootName)}Body = ${root};`;
}
