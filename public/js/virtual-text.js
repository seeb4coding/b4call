// Virtual scroller for very large response bodies.
//
// A 40 MB JSON payload pretty-printed into a <pre> locks the tab up for
// seconds; this renders only the ~80 lines currently on screen and moves them
// as the user scrolls, so cost is independent of body size. Falls back to a
// plain <pre> under the threshold, because plain text supports native find.

const LINE_HEIGHT = 18;
const OVERSCAN = 20;

export const VIRTUALIZE_LINE_THRESHOLD = 2500;

export function shouldVirtualize(text) {
  if (typeof text !== 'string') return false;
  if (text.length < 200_000) return false;
  return countLines(text) > VIRTUALIZE_LINE_THRESHOLD;
}

function countLines(text) {
  let count = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1;
  }
  return count;
}

// Mounts a virtual view of `text` inside `container` (which is emptied first).
// Returns a handle with { destroy, scrollToLine, highlight, lineCount }.
export function renderVirtualText(container, text, { highlight = '' } = {}) {
  const lines = String(text ?? '').split('\n');
  container.textContent = '';
  container.classList.add('virtual-text');

  const spacer = document.createElement('div');
  spacer.className = 'virtual-text-spacer';
  spacer.style.height = `${lines.length * LINE_HEIGHT}px`;

  const viewport = document.createElement('div');
  viewport.className = 'virtual-text-viewport';

  spacer.appendChild(viewport);
  container.appendChild(spacer);

  const notice = document.createElement('div');
  notice.className = 'virtual-text-notice';
  notice.textContent =
    `Large response — showing ${lines.length.toLocaleString()} lines in a virtual view. ` +
    'Use the search box or Download for the full text.';
  container.appendChild(notice);

  let query = highlight;
  let frame = null;

  const paint = () => {
    frame = null;
    const scrollTop = container.scrollTop;
    const height = container.clientHeight || 400;
    const first = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN);
    const visible = Math.ceil(height / LINE_HEIGHT) + OVERSCAN * 2;
    const last = Math.min(lines.length, first + visible);

    viewport.style.transform = `translateY(${first * LINE_HEIGHT}px)`;
    viewport.textContent = '';

    const fragment = document.createDocumentFragment();
    for (let i = first; i < last; i += 1) {
      const row = document.createElement('div');
      row.className = 'virtual-text-line';

      const gutter = document.createElement('span');
      gutter.className = 'virtual-text-gutter';
      gutter.textContent = String(i + 1);

      const content = document.createElement('span');
      content.className = 'virtual-text-content';
      appendWithHighlight(content, lines[i], query);

      row.append(gutter, content);
      fragment.appendChild(row);
    }
    viewport.appendChild(fragment);
  };

  const onScroll = () => {
    if (frame === null) frame = requestAnimationFrame(paint);
  };

  container.addEventListener('scroll', onScroll, { passive: true });
  const onResize = () => paint();
  window.addEventListener('resize', onResize);
  paint();

  return {
    lineCount: lines.length,
    scrollToLine(index) {
      container.scrollTop = Math.max(0, (index - 3) * LINE_HEIGHT);
      paint();
    },
    // Returns the 0-based indexes of lines containing the query.
    findMatches(text2) {
      query = text2 || '';
      const needle = query.toLowerCase();
      const hits = [];
      if (needle) {
        for (let i = 0; i < lines.length; i += 1) {
          if (lines[i].toLowerCase().includes(needle)) hits.push(i);
        }
      }
      paint();
      return hits;
    },
    destroy() {
      container.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      container.classList.remove('virtual-text');
      container.textContent = '';
    },
  };
}

function appendWithHighlight(target, line, query) {
  if (!query) {
    target.textContent = line;
    return;
  }
  const needle = query.toLowerCase();
  const haystack = line.toLowerCase();
  let from = 0;
  let at = haystack.indexOf(needle, from);
  if (at === -1) {
    target.textContent = line;
    return;
  }
  while (at !== -1) {
    if (at > from) target.appendChild(document.createTextNode(line.slice(from, at)));
    const mark = document.createElement('mark');
    mark.textContent = line.slice(at, at + query.length);
    target.appendChild(mark);
    from = at + query.length;
    at = haystack.indexOf(needle, from);
  }
  if (from < line.length) target.appendChild(document.createTextNode(line.slice(from)));
}
