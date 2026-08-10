// A dependency-free JSONPath engine for the response filter bar.
//
// Supported syntax:
//   $                      root
//   .name  ['name']        child
//   .*     [*]             wildcard
//   ..name  ..*            recursive descent
//   [0]  [-1]  [0,2,4]     index / union (negative counts from the end)
//   [1:5]  [::2]  [-3:]    slice
//   [?(@.age > 30)]        filter — @.path OP value, joined with && / ||
//                          OP: == != < <= > >= =~ (regex) , or bare @.path
//                          for "exists and is truthy"
//   .length                array/string length
//
// query() returns { values, paths } so the UI can show both the matches and
// where they came from. Syntax errors throw with a human-readable message.

/* ---------------- tokenizer ---------------- */

function parsePath(input) {
  const src = String(input ?? '').trim();
  if (!src) return [];

  let i = 0;
  const tokens = [];
  const fail = (msg) => {
    throw new Error(`${msg} at position ${i + 1}`);
  };

  if (src[i] === '$') i += 1;

  while (i < src.length) {
    const ch = src[i];

    if (ch === '.') {
      if (src[i + 1] === '.') {
        i += 2;
        if (src[i] === '*') {
          i += 1;
          tokens.push({ type: 'descend', name: null });
        } else if (src[i] === '[') {
          tokens.push({ type: 'descend', name: null });
        } else {
          const name = readName();
          if (!name) fail('Expected a property name after ".."');
          tokens.push({ type: 'descend', name });
        }
        continue;
      }
      i += 1;
      if (src[i] === '*') {
        i += 1;
        tokens.push({ type: 'wildcard' });
        continue;
      }
      const name = readName();
      if (!name) fail('Expected a property name after "."');
      tokens.push({ type: 'child', name });
      continue;
    }

    if (ch === '[') {
      i += 1;
      skipSpace();
      if (src[i] === '*') {
        i += 1;
        skipSpace();
        expect(']');
        tokens.push({ type: 'wildcard' });
        continue;
      }
      if (src[i] === '?') {
        i += 1;
        skipSpace();
        const wrapped = src[i] === '(';
        if (wrapped) i += 1;
        const expr = readUntilFilterEnd(wrapped);
        tokens.push({ type: 'filter', expr: parseFilter(expr) });
        continue;
      }
      if (src[i] === '"' || src[i] === "'") {
        const name = readQuoted(src[i]);
        skipSpace();
        expect(']');
        tokens.push({ type: 'child', name });
        continue;
      }
      // number, union or slice
      const raw = readUntil(']');
      expect(']');
      if (raw.includes(':')) {
        const [start, end, step] = raw.split(':').map((p) => p.trim());
        tokens.push({
          type: 'slice',
          start: start === '' ? null : Number(start),
          end: end === '' ? null : Number(end),
          step: step === undefined || step === '' ? 1 : Number(step),
        });
      } else if (raw.includes(',')) {
        tokens.push({
          type: 'index',
          indices: raw.split(',').map((p) => p.trim()),
        });
      } else {
        if (raw.trim() === '') fail('Empty [] is not a valid step');
        tokens.push({ type: 'index', indices: [raw.trim()] });
      }
      continue;
    }

    // A bare leading name ("data.items") is treated as a child of the root.
    if (tokens.length === 0 || /[\w$@]/.test(ch)) {
      const name = readName();
      if (!name) fail(`Unexpected character "${ch}"`);
      tokens.push({ type: 'child', name });
      continue;
    }

    fail(`Unexpected character "${ch}"`);
  }

  return tokens;

  function skipSpace() {
    while (i < src.length && /\s/.test(src[i])) i += 1;
  }
  function expect(char) {
    if (src[i] !== char) fail(`Expected "${char}"`);
    i += 1;
  }
  function readName() {
    const start = i;
    while (i < src.length && /[^.[\]\s]/.test(src[i])) i += 1;
    return src.slice(start, i);
  }
  function readQuoted(quote) {
    i += 1;
    let out = '';
    while (i < src.length && src[i] !== quote) {
      if (src[i] === '\\') i += 1;
      out += src[i];
      i += 1;
    }
    expect(quote);
    return out;
  }
  function readUntil(char) {
    const start = i;
    while (i < src.length && src[i] !== char) i += 1;
    return src.slice(start, i);
  }
  function readUntilFilterEnd(wrapped) {
    let depth = 0;
    const start = i;
    while (i < src.length) {
      const c = src[i];
      if (c === '"' || c === "'") {
        const quote = c;
        i += 1;
        while (i < src.length && src[i] !== quote) {
          if (src[i] === '\\') i += 1;
          i += 1;
        }
      } else if (c === '(' || c === '[') {
        depth += 1;
      } else if (c === ')' && wrapped && depth === 0) {
        const expr = src.slice(start, i);
        i += 1;
        skipSpace();
        expect(']');
        return expr;
      } else if (c === ']' && depth === 0) {
        const expr = src.slice(start, i);
        i += 1;
        return expr;
      } else if (c === ')' || c === ']') {
        depth -= 1;
      }
      i += 1;
    }
    fail('Unterminated filter expression');
    return '';
  }
}

/* ---------------- filter expressions ---------------- */

const COMPARATORS = ['=~', '==', '!=', '<=', '>=', '<', '>'];

function parseFilter(expr) {
  const text = String(expr ?? '').trim();
  if (!text) throw new Error('Empty filter expression');

  // Split on top-level && / || (no parentheses support — kept deliberately simple).
  const parts = [];
  let buffer = '';
  let op = null;
  for (let i = 0; i < text.length; i += 1) {
    const two = text.slice(i, i + 2);
    const inQuote = countUnescapedQuotes(buffer);
    if (!inQuote && (two === '&&' || two === '||')) {
      parts.push({ op, term: parseTerm(buffer) });
      op = two;
      buffer = '';
      i += 1;
      continue;
    }
    buffer += text[i];
  }
  parts.push({ op, term: parseTerm(buffer) });
  return parts;
}

function countUnescapedQuotes(text) {
  let single = 0;
  let double = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\\') {
      i += 1;
      continue;
    }
    if (text[i] === "'") single += 1;
    if (text[i] === '"') double += 1;
  }
  return single % 2 === 1 || double % 2 === 1;
}

function parseTerm(raw) {
  const text = String(raw).trim();
  if (!text) throw new Error('Empty condition in filter');

  for (const comparator of COMPARATORS) {
    const at = findComparator(text, comparator);
    if (at !== -1) {
      return {
        left: text.slice(0, at).trim(),
        comparator,
        right: text.slice(at + comparator.length).trim(),
      };
    }
  }
  return { left: text, comparator: null, right: null };
}

function findComparator(text, comparator) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble && text.startsWith(comparator, i)) {
      // "<" must not match the "<" inside "<=", and "==" must not match "=~".
      if (comparator === '<' && text[i + 1] === '=') continue;
      if (comparator === '>' && text[i + 1] === '=') continue;
      return i;
    }
  }
  return -1;
}

function literalValue(raw) {
  const text = String(raw).trim();
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  if (text === 'undefined') return undefined;
  if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) {
    return text.slice(1, -1);
  }
  const num = Number(text);
  return Number.isNaN(num) ? text : num;
}

function resolveOperand(raw, item) {
  const text = String(raw).trim();
  if (text === '@') return item;
  if (text.startsWith('@')) {
    const tokens = parsePath(text.slice(1).replace(/^\./, ''));
    const nodes = evaluate(item, tokens);
    return nodes.length ? nodes[0].value : undefined;
  }
  return literalValue(text);
}

function compare(left, comparator, right) {
  switch (comparator) {
    case '==':
      // eslint-disable-next-line eqeqeq
      return left == right;
    case '!=':
      // eslint-disable-next-line eqeqeq
      return left != right;
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    case '>':
      return left > right;
    case '>=':
      return left >= right;
    case '=~': {
      const match = String(right).match(/^\/(.*)\/([gimsuy]*)$/);
      const regex = match ? new RegExp(match[1], match[2]) : new RegExp(String(right));
      return regex.test(String(left ?? ''));
    }
    default:
      return false;
  }
}

function testFilter(parts, item) {
  let result = null;
  for (const { op, term } of parts) {
    const left = resolveOperand(term.left, item);
    const value = term.comparator
      ? compare(left, term.comparator, resolveOperand(term.right, item))
      : left !== undefined && left !== null && left !== false;
    if (result === null) result = value;
    else if (op === '&&') result = result && value;
    else result = result || value;
  }
  return Boolean(result);
}

/* ---------------- evaluation ---------------- */

const isContainer = (v) => v !== null && typeof v === 'object';

function childrenOf(node) {
  const { value, path } = node;
  if (Array.isArray(value)) {
    return value.map((v, index) => ({ value: v, path: `${path}[${index}]` }));
  }
  if (isContainer(value)) {
    return Object.keys(value).map((key) => ({
      value: value[key],
      path: /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}['${key}']`,
    }));
  }
  return [];
}

function descendants(node, out = []) {
  for (const child of childrenOf(node)) {
    out.push(child);
    if (isContainer(child.value)) descendants(child, out);
  }
  return out;
}

function normalizeIndex(raw, length) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n < 0 ? length + n : n;
}

function evaluate(root, tokens) {
  let nodes = [{ value: root, path: '$' }];

  for (const token of tokens) {
    const next = [];

    for (const node of nodes) {
      switch (token.type) {
        case 'child': {
          if (token.name === 'length' && (Array.isArray(node.value) || typeof node.value === 'string')) {
            next.push({ value: node.value.length, path: `${node.path}.length` });
            break;
          }
          if (!isContainer(node.value)) break;
          if (!(token.name in node.value)) break;
          next.push({
            value: node.value[token.name],
            path: /^[A-Za-z_$][\w$]*$/.test(token.name)
              ? `${node.path}.${token.name}`
              : `${node.path}['${token.name}']`,
          });
          break;
        }
        case 'wildcard':
          next.push(...childrenOf(node));
          break;
        case 'descend': {
          if (token.name === null) {
            next.push(...descendants(node));
            break;
          }
          // ..name = the "name" property of this node and of every descendant.
          for (const candidate of [node, ...descendants(node)]) {
            if (!isContainer(candidate.value) || Array.isArray(candidate.value)) continue;
            if (!(token.name in candidate.value)) continue;
            next.push({
              value: candidate.value[token.name],
              path: /^[A-Za-z_$][\w$]*$/.test(token.name)
                ? `${candidate.path}.${token.name}`
                : `${candidate.path}['${token.name}']`,
            });
          }
          break;
        }
        case 'index': {
          for (const raw of token.indices) {
            if (Array.isArray(node.value)) {
              const index = normalizeIndex(raw, node.value.length);
              if (index === null || index < 0 || index >= node.value.length) continue;
              next.push({ value: node.value[index], path: `${node.path}[${index}]` });
            } else if (isContainer(node.value)) {
              const key = String(raw).replace(/^['"]|['"]$/g, '');
              if (key in node.value) {
                next.push({ value: node.value[key], path: `${node.path}['${key}']` });
              }
            }
          }
          break;
        }
        case 'slice': {
          if (!Array.isArray(node.value)) break;
          const length = node.value.length;
          const step = token.step || 1;
          let start = token.start == null ? (step > 0 ? 0 : length - 1) : normalizeIndex(token.start, length);
          let end = token.end == null ? (step > 0 ? length : -1) : normalizeIndex(token.end, length);
          if (step > 0) {
            start = Math.max(start, 0);
            end = Math.min(end, length);
            for (let index = start; index < end; index += step) {
              next.push({ value: node.value[index], path: `${node.path}[${index}]` });
            }
          } else {
            start = Math.min(start, length - 1);
            for (let index = start; index > end; index += step) {
              if (index < 0) break;
              next.push({ value: node.value[index], path: `${node.path}[${index}]` });
            }
          }
          break;
        }
        case 'filter': {
          for (const child of childrenOf(node)) {
            if (testFilter(token.expr, child.value)) next.push(child);
          }
          break;
        }
        default:
          break;
      }
    }

    nodes = next;
    if (nodes.length === 0) break;
  }

  return nodes;
}

/* ---------------- public API ---------------- */

export function query(data, path) {
  const tokens = parsePath(path);
  if (!tokens.length) return { values: [data], paths: ['$'] };
  const nodes = evaluate(data, tokens);
  return {
    values: nodes.map((n) => n.value),
    paths: nodes.map((n) => n.path),
  };
}

// Convenience for the filter bar: one match returns the value itself, many
// matches return an array, no match returns undefined.
export function queryOne(data, path) {
  const { values } = query(data, path);
  if (values.length === 0) return undefined;
  return values.length === 1 ? values[0] : values;
}

export const JSONPATH_EXAMPLES = [
  ['$.data.items[0].id', 'first item’s id'],
  ['$.items[*].name', 'every item name'],
  ['$..email', 'every email, at any depth'],
  ['$.users[?(@.age > 30)]', 'filter by a field'],
  ['$.users[?(@.role == "admin" && @.active)]', 'combined filters'],
  ['$.items[0:5]', 'slice'],
  ['$.items.length', 'count'],
];
