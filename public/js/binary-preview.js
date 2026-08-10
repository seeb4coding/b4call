// Preview for non-text responses. The proxy returns binary bodies as base64
// (up to 6 MB) plus a hex window, so images, PDFs, audio and video render
// inline and anything unrecognised still shows a hex dump instead of mojibake.

export function isBinaryResult(result) {
  return Boolean(result && result.isBinary);
}

export function binaryKind(contentType = '') {
  const type = String(contentType).split(';')[0].trim().toLowerCase();
  if (/^image\/svg/.test(type)) return 'svg';
  if (/^image\//.test(type)) return 'image';
  if (type === 'application/pdf') return 'pdf';
  if (/^audio\//.test(type)) return 'audio';
  if (/^video\//.test(type)) return 'video';
  if (/^font\//.test(type) || /(woff|ttf|otf)/.test(type)) return 'font';
  if (/(zip|gzip|tar|rar|7z)/.test(type)) return 'archive';
  return 'binary';
}

export function dataUri(result) {
  if (!result?.bodyBase64) return null;
  const type = (result.contentType || 'application/octet-stream').split(';')[0].trim();
  return `data:${type};base64,${result.bodyBase64}`;
}

export function binaryBlob(result) {
  if (!result?.bodyBase64) return null;
  const binary = atob(result.bodyBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const type = (result.contentType || 'application/octet-stream').split(';')[0].trim();
  return new Blob([bytes], { type });
}

function formatBytes(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function metaLine(result, kind) {
  const parts = [kind.toUpperCase(), result.contentType || 'unknown type', formatBytes(result.byteLength ?? result.size)];
  const el = document.createElement('div');
  el.className = 'binary-meta';
  el.textContent = parts.filter(Boolean).join('  ·  ');
  return el;
}

// Renders into `container`; returns the kind that was drawn.
export function renderBinaryPreview(container, result) {
  container.textContent = '';
  const kind = binaryKind(result.contentType);

  if (result.binaryTooLarge) {
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent =
      `This ${kind} response is ${formatBytes(result.byteLength)} — too large to preview inline. ` +
      'Use Download to save it.';
    container.append(metaLine(result, kind), note);
    return kind;
  }

  const uri = dataUri(result);
  if (!uri) {
    container.append(metaLine(result, kind), hexDump(result));
    return kind;
  }

  const wrap = document.createElement('div');
  wrap.className = 'binary-preview';

  if (kind === 'image' || kind === 'svg') {
    const img = document.createElement('img');
    img.src = uri;
    img.alt = 'Response image';
    img.className = 'binary-image';
    img.addEventListener('load', () => {
      const dims = document.createElement('div');
      dims.className = 'binary-meta';
      dims.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
      wrap.appendChild(dims);
    });
    wrap.appendChild(img);
  } else if (kind === 'pdf') {
    const frame = document.createElement('iframe');
    frame.src = uri;
    frame.className = 'binary-pdf';
    frame.title = 'PDF preview';
    wrap.appendChild(frame);
  } else if (kind === 'audio') {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = uri;
    wrap.appendChild(audio);
  } else if (kind === 'video') {
    const video = document.createElement('video');
    video.controls = true;
    video.src = uri;
    video.className = 'binary-video';
    wrap.appendChild(video);
  } else {
    wrap.appendChild(hexDump(result));
  }

  container.append(metaLine(result, kind), wrap);
  return kind;
}

// First 4 KB as offset / hex / ASCII columns.
export function hexDump(result) {
  const pre = document.createElement('pre');
  pre.className = 'hex-dump';
  const hex = result.hexPreview || '';
  if (!hex) {
    pre.textContent = '(no bytes captured)';
    return pre;
  }

  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));

  const lines = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const row = bytes.slice(offset, offset + 16);
    const hexPart = row
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ')
      .padEnd(47, ' ');
    const asciiPart = row
      .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.'))
      .join('');
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hexPart}  |${asciiPart}|`);
  }
  const total = result.byteLength ?? bytes.length;
  if (total > bytes.length) {
    lines.push(`… ${(total - bytes.length).toLocaleString()} more bytes not shown`);
  }
  pre.textContent = lines.join('\n');
  return pre;
}
