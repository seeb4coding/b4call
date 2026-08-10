// Line diff between two response bodies, plus a status/headers/timing summary.
// Uses a classic LCS table with a fast common-prefix/suffix trim so large but
// mostly-identical payloads stay cheap.

const MAX_LCS_LINES = 3000;

function lcsMatrix(a, b) {
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

// Returns [{ type: 'same'|'add'|'del', left, right, leftNo, rightNo }]
export function diffLines(leftText, rightText) {
  const a = String(leftText ?? '').split('\n');
  const b = String(rightText ?? '').split('\n');

  const rows = [];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  for (let i = 0; i < start; i += 1) {
    rows.push({ type: 'same', left: a[i], right: b[i], leftNo: i + 1, rightNo: i + 1 });
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  if (midA.length > MAX_LCS_LINES || midB.length > MAX_LCS_LINES) {
    // Too big for an exact diff — fall back to a block replace.
    midA.forEach((line, i) =>
      rows.push({ type: 'del', left: line, right: null, leftNo: start + i + 1, rightNo: null })
    );
    midB.forEach((line, i) =>
      rows.push({ type: 'add', left: null, right: line, leftNo: null, rightNo: start + i + 1 })
    );
  } else {
    const table = lcsMatrix(midA, midB);
    let i = 0;
    let j = 0;
    while (i < midA.length && j < midB.length) {
      if (midA[i] === midB[j]) {
        rows.push({
          type: 'same',
          left: midA[i],
          right: midB[j],
          leftNo: start + i + 1,
          rightNo: start + j + 1,
        });
        i += 1;
        j += 1;
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        rows.push({ type: 'del', left: midA[i], right: null, leftNo: start + i + 1, rightNo: null });
        i += 1;
      } else {
        rows.push({ type: 'add', left: null, right: midB[j], leftNo: null, rightNo: start + j + 1 });
        j += 1;
      }
    }
    while (i < midA.length) {
      rows.push({ type: 'del', left: midA[i], right: null, leftNo: start + i + 1, rightNo: null });
      i += 1;
    }
    while (j < midB.length) {
      rows.push({ type: 'add', left: null, right: midB[j], leftNo: null, rightNo: start + j + 1 });
      j += 1;
    }
  }

  const tailStartA = endA;
  const tailStartB = endB;
  for (let k = 0; k < a.length - endA; k += 1) {
    rows.push({
      type: 'same',
      left: a[tailStartA + k],
      right: b[tailStartB + k],
      leftNo: tailStartA + k + 1,
      rightNo: tailStartB + k + 1,
    });
  }

  return rows;
}

// Pretty-print JSON before diffing so key order noise is the only difference
// that survives formatting differences between two captures.
export function normalizeForDiff(text, { sortKeys = true } = {}) {
  const raw = String(text ?? '');
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(sortKeys ? sortDeep(parsed) : parsed, null, 2);
  } catch {
    return raw;
  }
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortDeep(value[key])])
    );
  }
  return value;
}

export function diffStats(rows) {
  return {
    added: rows.filter((r) => r.type === 'add').length,
    removed: rows.filter((r) => r.type === 'del').length,
    unchanged: rows.filter((r) => r.type === 'same').length,
  };
}

// Header-level comparison for the summary strip above the body diff.
export function diffHeaders(leftHeaders = {}, rightHeaders = {}) {
  const keys = [...new Set([...Object.keys(leftHeaders), ...Object.keys(rightHeaders)])].sort();
  return keys
    .map((key) => ({
      key,
      left: leftHeaders[key] ?? null,
      right: rightHeaders[key] ?? null,
    }))
    .filter((row) => row.left !== row.right);
}
