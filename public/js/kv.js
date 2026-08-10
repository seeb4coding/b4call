import { iconSvg } from './icons.js';
// Key-value row editor (params, headers, form bodies).
// Rows are mutated in place and DOM nodes are added/removed individually
// so typing never triggers a re-render that would steal input focus.
//
// With { bulkEdit: true } a "Bulk edit" toggle swaps the table for a raw
// textarea (one `key: value` per line, `#` prefix disables a row).
export function createKvEditor(
  container,
  { keyPlaceholder = 'Key', valuePlaceholder = 'Value', bulkEdit = false } = {}
) {
  let rows = [];
  let mode = 'table';

  const blankRow = () => ({ enabled: true, key: '', value: '' });

  const toolbar = document.createElement('div');
  toolbar.className = 'kv-toolbar';
  const bulkToggle = document.createElement('button');
  bulkToggle.type = 'button';
  bulkToggle.className = 'link-btn kv-bulk-toggle';
  bulkToggle.textContent = 'Bulk edit';
  toolbar.appendChild(bulkToggle);

  const rowsBox = document.createElement('div');
  rowsBox.className = 'kv-rows';

  const bulkArea = document.createElement('textarea');
  bulkArea.className = 'kv-bulk-area body-raw hidden';
  bulkArea.spellcheck = false;
  bulkArea.placeholder = 'key: value\n# disabled: line';

  container.textContent = '';
  if (bulkEdit) container.appendChild(toolbar);
  container.append(rowsBox, bulkArea);

  function buildRow(row) {
    const div = document.createElement('div');
    div.className = 'kv-row';

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = row.enabled;
    check.title = 'Include this row';
    check.addEventListener('change', () => { row.enabled = check.checked; });

    const key = document.createElement('input');
    key.type = 'text';
    key.placeholder = keyPlaceholder;
    key.value = row.key;

    const value = document.createElement('input');
    value.type = 'text';
    value.placeholder = valuePlaceholder;
    value.value = row.value;

    const onType = () => {
      row.key = key.value;
      row.value = value.value;
      if (rows[rows.length - 1] === row) appendRow(blankRow());
    };
    key.addEventListener('input', onType);
    value.addEventListener('input', onType);

    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.innerHTML = iconSvg('close', 13);
    del.title = 'Remove row';
    del.addEventListener('click', () => {
      if (rows.length === 1) {
        row.key = '';
        row.value = '';
        key.value = '';
        value.value = '';
        return;
      }
      rows = rows.filter((r) => r !== row);
      div.remove();
    });

    div.append(check, key, value, del);
    return div;
  }

  function appendRow(row) {
    rows = [...rows, row];
    rowsBox.appendChild(buildRow(row));
  }

  function renderTable() {
    rowsBox.textContent = '';
    const existing = rows;
    rows = [];
    existing.forEach((r) => appendRow(r));
    appendRow(blankRow());
  }

  function toBulkText() {
    return rows
      .filter((r) => r.key !== '' || r.value !== '')
      .map((r) => `${r.enabled ? '' : '# '}${r.key}: ${r.value}`)
      .join('\n');
  }

  function fromBulkText(text) {
    const parsed = [];
    text.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const disabled = trimmed.startsWith('#');
      const body = disabled ? trimmed.replace(/^#\s?/, '') : trimmed;
      const sep = body.search(/[:=]/);
      if (sep === -1) {
        parsed.push({ enabled: !disabled, key: body.trim(), value: '' });
      } else {
        parsed.push({
          enabled: !disabled,
          key: body.slice(0, sep).trim(),
          value: body.slice(sep + 1).trim(),
        });
      }
    });
    rows = parsed;
  }

  bulkToggle.addEventListener('click', () => {
    if (mode === 'table') {
      bulkArea.value = toBulkText();
      rowsBox.classList.add('hidden');
      bulkArea.classList.remove('hidden');
      bulkToggle.textContent = 'Table edit';
      mode = 'bulk';
    } else {
      fromBulkText(bulkArea.value);
      bulkArea.classList.add('hidden');
      rowsBox.classList.remove('hidden');
      bulkToggle.textContent = 'Bulk edit';
      mode = 'table';
      renderTable();
    }
  });

  function setRows(newRows) {
    mode = 'table';
    bulkArea.classList.add('hidden');
    rowsBox.classList.remove('hidden');
    bulkToggle.textContent = 'Bulk edit';
    rows = [];
    rowsBox.textContent = '';
    (newRows || []).forEach((r) =>
      appendRow({ enabled: r.enabled !== false, key: r.key ?? '', value: r.value ?? '' })
    );
    appendRow(blankRow());
  }

  function getRows() {
    if (mode === 'bulk') fromBulkText(bulkArea.value);
    return rows
      .filter((r) => r.key !== '' || r.value !== '')
      .map((r) => ({ ...r }));
  }

  setRows([]);
  return { setRows, getRows };
}
