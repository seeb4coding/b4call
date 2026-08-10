// Renders the connection timing breakdown the proxy measured for a response:
// queueing, DNS, TCP, TLS, waiting (TTFB) and content download, plus one row
// per redirect hop.

const PHASES = [
  ['queue', 'Queueing', 'phase-queue', 'Waiting for a socket'],
  ['dns', 'DNS lookup', 'phase-dns', 'Resolving the hostname'],
  ['tcp', 'TCP connect', 'phase-tcp', 'Opening the connection'],
  ['tls', 'TLS handshake', 'phase-tls', 'Negotiating HTTPS'],
  ['ttfb', 'Waiting (TTFB)', 'phase-ttfb', 'Server processing until the first byte'],
  ['download', 'Content download', 'phase-download', 'Reading the response body'],
];

const ms = (value) => (value == null ? '—' : `${value} ms`);

function bar(label, className, value, total, hint) {
  const row = document.createElement('div');
  row.className = 'timing-row';

  const name = document.createElement('span');
  name.className = 'timing-label';
  name.textContent = label;
  name.title = hint || '';

  const track = document.createElement('div');
  track.className = 'timing-track';

  const fill = document.createElement('div');
  fill.className = `timing-fill ${className}`;
  const pct = total > 0 && value != null ? Math.max((value / total) * 100, value > 0 ? 1 : 0) : 0;
  fill.style.width = `${Math.min(pct, 100)}%`;
  track.appendChild(fill);

  const amount = document.createElement('span');
  amount.className = 'timing-value';
  amount.textContent = ms(value);

  row.append(name, track, amount);
  return row;
}

export function renderTimings(container, result) {
  container.textContent = '';

  const timings = result?.timings;
  if (!timings) {
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent = 'No timing data for this response. Send the request again to measure it.';
    container.appendChild(note);
    return;
  }

  const total = timings.total ?? result.timeMs ?? 0;

  const summary = document.createElement('div');
  summary.className = 'timing-summary';
  summary.innerHTML =
    `<b>${ms(total)}</b> total` +
    (result.redirects ? ` · ${result.redirects} redirect${result.redirects > 1 ? 's' : ''}` : '') +
    (result.hops?.[result.hops.length - 1]?.remoteAddress
      ? ` · ${result.hops[result.hops.length - 1].remoteAddress}`
      : '');
  container.appendChild(summary);

  // Stacked overview bar, so the shape of the request reads at a glance.
  const stack = document.createElement('div');
  stack.className = 'timing-stack';
  PHASES.forEach(([key, label, className]) => {
    const value = timings[key];
    if (!value) return;
    const segment = document.createElement('div');
    segment.className = `timing-stack-segment ${className}`;
    segment.style.flexGrow = String(value);
    segment.title = `${label}: ${ms(value)}`;
    stack.appendChild(segment);
  });
  if (stack.childElementCount) container.appendChild(stack);

  const bars = document.createElement('div');
  bars.className = 'timing-bars';
  PHASES.forEach(([key, label, className, hint]) => {
    if (timings[key] == null) return;
    bars.appendChild(bar(label, className, timings[key], total, hint));
  });
  bars.appendChild(bar('Total', 'phase-total', total, total, 'Wall clock, including redirects'));
  container.appendChild(bars);

  const unmeasured = PHASES.filter(([key]) => timings[key] == null).map(([, label]) => label);
  if (unmeasured.length) {
    const note = document.createElement('p');
    note.className = 'modal-note';
    note.textContent = `Not applicable for this request: ${unmeasured.join(', ')}.`;
    container.appendChild(note);
  }

  // Per-hop table when redirects were followed.
  if (Array.isArray(result.hops) && result.hops.length > 1) {
    const title = document.createElement('div');
    title.className = 'vars-title';
    title.textContent = 'Redirect chain';
    container.appendChild(title);

    const table = document.createElement('table');
    table.className = 'viz-table';
    const head = document.createElement('tr');
    ['#', 'Status', 'URL', 'DNS', 'TCP', 'TLS', 'TTFB', 'Download'].forEach((text) => {
      const th = document.createElement('th');
      th.textContent = text;
      head.appendChild(th);
    });
    table.appendChild(head);

    result.hops.forEach((hop, index) => {
      const tr = document.createElement('tr');
      const cells = [
        String(index + 1),
        String(hop.status ?? ''),
        hop.url || '',
        ms(hop.timings?.dns),
        ms(hop.timings?.tcp),
        ms(hop.timings?.tls),
        ms(hop.timings?.ttfb),
        ms(hop.timings?.download),
      ];
      cells.forEach((text, i) => {
        const td = document.createElement('td');
        td.textContent = text;
        if (i === 2) {
          td.className = 'timing-url';
          td.title = text;
        }
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    container.appendChild(table);
  }
}
