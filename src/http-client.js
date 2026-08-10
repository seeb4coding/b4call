const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { URL } = require('url');

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
// Binary bodies above this are not base64-encoded back to the browser — the
// preview would be unusable and the JSON payload enormous.
const MAX_BINARY_PREVIEW_BYTES = 6 * 1024 * 1024;

// Hop-by-hop / auto-computed headers that must not be forwarded verbatim.
const STRIPPED_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
]);

const BINARY_TYPE_PATTERN =
  /^(image|audio|video|font)\/|^application\/(pdf|zip|gzip|x-gzip|x-tar|x-7z|x-rar|octet-stream|wasm|x-protobuf|vnd\.ms-|vnd\.openxmlformats|msword|x-msdownload|java-archive)/i;

// Content types that are binary by declaration, plus a NUL-byte sniff for
// responses that arrive without a usable Content-Type.
function looksBinary(contentType, buffer) {
  const type = String(contentType || '').split(';')[0].trim();
  if (type) {
    if (BINARY_TYPE_PATTERN.test(type)) return true;
    if (/^(text\/|application\/(json|javascript|xml|x-www-form-urlencoded|graphql))/i.test(type)) {
      return false;
    }
    if (/\+(json|xml)$/i.test(type)) return false;
  }
  const probe = buffer.subarray(0, 1024);
  for (let i = 0; i < probe.length; i += 1) {
    if (probe[i] === 0) return true;
  }
  return false;
}

function buildForwardHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (typeof value !== 'string') continue;
    if (STRIPPED_HEADERS.has(key.toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

function decodeBody(buffer, encoding) {
  try {
    if (/\bgzip\b/i.test(encoding)) return zlib.gunzipSync(buffer);
    if (/\bdeflate\b/i.test(encoding)) return zlib.inflateSync(buffer);
    if (/\bbr\b/i.test(encoding)) return zlib.brotliDecompressSync(buffer);
  } catch {
    /* fall through — return raw bytes */
  }
  return buffer;
}

// Establish a CONNECT tunnel through an HTTP proxy for https targets.
function connectThroughProxy(proxyUrl, target) {
  return new Promise((resolve, reject) => {
    const proxy = new URL(proxyUrl);
    const req = http.request({
      host: proxy.hostname,
      port: proxy.port || 80,
      method: 'CONNECT',
      path: `${target.hostname}:${target.port || 443}`,
      headers: proxyAuthHeader(proxy),
      timeout: 20000,
    });
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Proxy CONNECT failed with status ${res.statusCode}`));
        return;
      }
      resolve(socket);
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Proxy connection timed out')));
    req.end();
  });
}

function proxyAuthHeader(proxy) {
  if (!proxy.username) return {};
  const creds = Buffer.from(
    `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`
  ).toString('base64');
  return { 'Proxy-Authorization': `Basic ${creds}` };
}

// Turn absolute event timestamps into the phase durations the waterfall draws.
// Phases that never happened (no DNS for an IP literal, no TLS for http://)
// come back as null so the UI can leave them out instead of drawing a 0 bar.
function phasesFrom(marks) {
  const span = (from, to) =>
    marks[from] != null && marks[to] != null ? Math.max(marks[to] - marks[from], 0) : null;

  const connectStart = marks.lookupEnd ?? marks.socket;
  const firstByte = marks.responseStart;
  const sendDone = marks.secureConnect ?? marks.connect ?? marks.socket;

  return {
    queue: span('start', 'socket'),
    dns: span('socket', 'lookupEnd'),
    tcp: connectStart != null && marks.connect != null
      ? Math.max(marks.connect - connectStart, 0)
      : null,
    tls: span('connect', 'secureConnect'),
    ttfb: sendDone != null && firstByte != null ? Math.max(firstByte - sendDone, 0) : null,
    download: span('responseStart', 'end'),
    total: span('start', 'end'),
  };
}

// One HTTP(S) request (no redirect following). Returns a raw response object.
async function singleRequest({ method, url, headers, body, timeoutMs, rejectUnauthorized, proxy }) {
  const target = new URL(url);
  const isHttps = target.protocol === 'https:';
  const transport = isHttps ? https : http;

  const requestHeaders = { ...headers, Host: target.host };

  const options = {
    method,
    headers: requestHeaders,
    timeout: timeoutMs > 0 ? timeoutMs : 0,
  };

  const marks = { start: Date.now() };
  let tunnelSocket = null;

  if (proxy && proxy.trim()) {
    if (isHttps) {
      tunnelSocket = await connectThroughProxy(proxy, target);
      options.socket = tunnelSocket;
      options.agent = false;
      options.host = target.hostname;
      options.port = target.port || 443;
      options.path = target.pathname + target.search;
      if (rejectUnauthorized === false) options.rejectUnauthorized = false;
      options.servername = target.hostname;
      // The tunnel is already open, so DNS/TCP happened inside the proxy hop.
      marks.proxyConnect = Date.now();
    } else {
      // Plain HTTP proxying: send the absolute URI to the proxy.
      const proxyUrl = new URL(proxy);
      options.host = proxyUrl.hostname;
      options.port = proxyUrl.port || 80;
      options.path = target.toString();
      Object.assign(requestHeaders, proxyAuthHeader(proxyUrl));
    }
  } else {
    options.host = target.hostname;
    options.port = target.port || (isHttps ? 443 : 80);
    options.path = target.pathname + target.search;
    if (isHttps && rejectUnauthorized === false) options.rejectUnauthorized = false;
  }

  return new Promise((resolve, reject) => {
    const req = transport.request(options, (res) => {
      marks.responseStart = Date.now();
      const chunks = [];
      let bytes = 0;
      let truncated = false;

      const finish = (wasTruncated) => {
        marks.end = Date.now();
        const raw = Buffer.concat(chunks);
        const decoded = decodeBody(raw, res.headers['content-encoding'] || '');
        resolve({
          status: res.statusCode,
          statusText: res.statusMessage || '',
          headers: res.headers,
          setCookies: res.headers['set-cookie'] || [],
          bodyBuffer: decoded,
          size: bytes,
          truncated: wasTruncated,
          location: res.headers.location,
          timings: phasesFrom(marks),
          remoteAddress: res.socket?.remoteAddress || null,
        });
      };

      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes <= MAX_RESPONSE_BYTES) {
          chunks.push(chunk);
        } else if (!truncated) {
          truncated = true;
          res.destroy();
        }
      });
      res.on('end', () => finish(truncated));
      res.on('close', () => {
        if (truncated) finish(true);
      });
    });

    // Connection lifecycle marks feed the waterfall.
    req.on('socket', (socket) => {
      marks.socket = Date.now();
      if (tunnelSocket) {
        // Tunnelled: DNS + TCP already paid during CONNECT.
        marks.connect = marks.socket;
      }
      socket.on('lookup', () => {
        marks.lookupEnd = Date.now();
      });
      socket.on('connect', () => {
        marks.connect = Date.now();
      });
      socket.on('secureConnect', () => {
        marks.secureConnect = Date.now();
      });
      if (socket.connecting === false && marks.connect == null) {
        // Reused / already-open socket — no DNS or handshake to measure.
        marks.connect = marks.socket;
      }
    });

    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { name: 'TimeoutError' })));
    req.on('error', reject);
    if (body != null && !['GET', 'HEAD'].includes(method)) {
      req.write(typeof body === 'string' ? body : Buffer.from(body));
    }
    req.end();
  });
}

// Sum the per-hop phases so a redirected request still shows one waterfall.
function mergeTimings(hops) {
  const keys = ['queue', 'dns', 'tcp', 'tls', 'ttfb', 'download'];
  const merged = {};
  for (const key of keys) {
    const values = hops.map((h) => h.timings?.[key]).filter((v) => typeof v === 'number');
    merged[key] = values.length ? values.reduce((a, b) => a + b, 0) : null;
  }
  return merged;
}

// Full request with manual redirect following honoring maxRedirects.
async function performRequest(params) {
  const {
    method,
    url,
    headers,
    body,
    timeoutMs = 30000,
    followRedirects = true,
    maxRedirects = 5,
    rejectUnauthorized = true,
    proxy = '',
  } = params;

  const started = Date.now();
  let currentUrl = url;
  let currentMethod = method;
  let currentBody = body;
  let redirects = 0;
  const forwardHeaders = buildForwardHeaders(headers);
  const collectedCookies = [];
  const hops = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await singleRequest({
      method: currentMethod,
      url: currentUrl,
      headers: forwardHeaders,
      body: currentBody,
      timeoutMs,
      rejectUnauthorized,
      proxy,
    });
    if (Array.isArray(res.setCookies)) collectedCookies.push(...res.setCookies);
    hops.push({
      url: currentUrl,
      method: currentMethod,
      status: res.status,
      size: res.size,
      timings: res.timings,
      remoteAddress: res.remoteAddress,
    });

    const isRedirect = res.status >= 300 && res.status < 400 && res.location;
    if (isRedirect && followRedirects && redirects < maxRedirects) {
      redirects += 1;
      currentUrl = new URL(res.location, currentUrl).toString();
      // 303, or 301/302 on POST → switch to GET and drop the body (per browsers).
      if (res.status === 303 || (currentMethod === 'POST' && (res.status === 301 || res.status === 302))) {
        currentMethod = 'GET';
        currentBody = null;
        delete forwardHeaders['Content-Type'];
        delete forwardHeaders['content-type'];
      }
      continue;
    }

    const flatHeaders = Object.fromEntries(
      Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v])
    );
    const contentType = flatHeaders['content-type'] || '';
    const binary = looksBinary(contentType, res.bodyBuffer);
    const timeMs = Date.now() - started;

    const out = {
      status: res.status,
      statusText: res.statusText,
      headers: flatHeaders,
      setCookies: collectedCookies,
      body: binary ? '' : res.bodyBuffer.toString('utf8'),
      size: res.size,
      truncated: res.truncated,
      timeMs,
      redirects,
      timings: { ...mergeTimings(hops), total: timeMs },
      hops,
      isBinary: binary,
      contentType,
    };

    if (binary) {
      if (res.bodyBuffer.length <= MAX_BINARY_PREVIEW_BYTES) {
        out.bodyBase64 = res.bodyBuffer.toString('base64');
      } else {
        out.binaryTooLarge = true;
      }
      // A short hex window keeps the Body tab useful for unknown formats.
      out.hexPreview = res.bodyBuffer.subarray(0, 4096).toString('hex');
      out.byteLength = res.bodyBuffer.length;
    }

    return out;
  }
}

module.exports = {
  performRequest,
  MAX_RESPONSE_BYTES,
  MAX_BINARY_PREVIEW_BYTES,
  looksBinary,
};
