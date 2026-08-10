// Advanced auth schemes applied to an outgoing proxy payload just before send.
// Simple schemes (bearer/basic/apikey) are handled synchronously in send.js.
import { api } from './api.js';

const encoder = new TextEncoder();

function base64url(bytes) {
  let binary = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  arr.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hasHeader(headers, name) {
  return Object.keys(headers).some((k) => k.toLowerCase() === name.toLowerCase());
}

/* ---------------- JWT (HMAC) ---------------- */

async function hmac(algo, keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: algo },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, dataBytes));
}

async function signJwt(auth, sub) {
  const algMap = { HS256: 'SHA-256', HS384: 'SHA-384', HS512: 'SHA-512' };
  const alg = algMap[auth.algorithm] ? auth.algorithm : 'HS256';
  const header = base64url(encoder.encode(JSON.stringify({ alg, typ: 'JWT' })));
  let payloadObj = {};
  const raw = sub(auth.payload || '').trim();
  if (raw) {
    try {
      payloadObj = JSON.parse(raw);
    } catch {
      throw new Error('JWT payload is not valid JSON');
    }
  }
  const payload = base64url(encoder.encode(JSON.stringify(payloadObj)));
  const signingInput = `${header}.${payload}`;
  const sig = await hmac(algMap[alg], encoder.encode(sub(auth.secret || '')), encoder.encode(signingInput));
  return `${signingInput}.${base64url(sig)}`;
}

/* ---------------- AWS Signature V4 ---------------- */

async function sha256Hex(dataBytes) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', dataBytes));
  return [...hash].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacRaw(keyBytes, msg) {
  return hmac('SHA-256', keyBytes, encoder.encode(msg));
}

async function awsSigV4(payload, auth, sub) {
  const url = new URL(payload.url);
  const region = sub(auth.region || 'us-east-1');
  const service = sub(auth.service || 'execute-api');
  const accessKeyId = sub(auth.accessKeyId || '');
  const secretKey = sub(auth.secretAccessKey || '');
  const sessionToken = sub(auth.sessionToken || '');

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const bodyStr = typeof payload.body === 'string' ? payload.body : '';
  const payloadHash = await sha256Hex(encoder.encode(bodyStr));

  const headers = { ...payload.headers, host: url.host, 'x-amz-date': amzDate };
  if (sessionToken) headers['x-amz-security-token'] = sessionToken;
  headers['x-amz-content-sha256'] = payloadHash;

  const signedHeaderKeys = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort();
  const canonicalHeaders = signedHeaderKeys
    .map((k) => {
      const actual = Object.keys(headers).find((h) => h.toLowerCase() === k);
      return `${k}:${String(headers[actual]).trim()}\n`;
    })
    .join('');
  const signedHeaders = signedHeaderKeys.join(';');

  const canonicalQuery = [...url.searchParams.entries()]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const canonicalRequest = [
    payload.method,
    url.pathname || '/',
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    await sha256Hex(encoder.encode(canonicalRequest)),
  ].join('\n');

  const kDate = await hmacRaw(encoder.encode(`AWS4${secretKey}`), dateStamp);
  const kRegion = await hmacRaw(kDate, region);
  const kService = await hmacRaw(kRegion, service);
  const kSigning = await hmacRaw(kService, 'aws4_request');
  const signature = [...(await hmacRaw(kSigning, stringToSign))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  payload.headers = headers;
  payload.headers['Authorization'] =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

/* ---------------- OAuth 2.0 ---------------- */

async function oauth2(payload, auth, sub) {
  let token = sub(auth.accessToken || '').trim();
  if (!token) {
    const result = await api.oauthToken({
      tokenUrl: sub(auth.tokenUrl || ''),
      grantType: auth.grantType || 'client_credentials',
      clientId: sub(auth.clientId || ''),
      clientSecret: sub(auth.clientSecret || ''),
      scope: sub(auth.scope || ''),
      username: sub(auth.username || ''),
      password: sub(auth.password || ''),
    });
    token = result.accessToken;
  }
  if (token && !hasHeader(payload.headers, 'authorization')) {
    payload.headers['Authorization'] = `Bearer ${token}`;
  }
}

/* ---------------- Digest (MD5) ---------------- */
// Compact MD5 — WebCrypto has no MD5 and digest auth still defaults to it.

function md5(str) {
  function toBytes(s) {
    const bytes = [];
    for (let i = 0; i < s.length; i += 1) {
      let c = s.charCodeAt(i);
      if (c < 128) bytes.push(c);
      else if (c < 2048) bytes.push(192 | (c >> 6), 128 | (c & 63));
      else bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
    }
    return bytes;
  }
  const x = toBytes(str);
  const add = (a, b) => (a + b) & 0xffffffff;
  const rol = (n, c) => (n << c) | (n >>> (32 - c));
  const cmn = (q, a, b, xk, s, t) => add(rol(add(add(a, q), add(xk, t)), s), b);
  const ff = (a, b, c, d, xk, s, t) => cmn((b & c) | (~b & d), a, b, xk, s, t);
  const gg = (a, b, c, d, xk, s, t) => cmn((b & d) | (c & ~d), a, b, xk, s, t);
  const hh = (a, b, c, d, xk, s, t) => cmn(b ^ c ^ d, a, b, xk, s, t);
  const ii = (a, b, c, d, xk, s, t) => cmn(c ^ (b | ~d), a, b, xk, s, t);

  const len = x.length;
  const words = [];
  for (let i = 0; i < len; i += 1) words[i >> 2] |= x[i] << ((i % 4) * 8);
  words[len >> 2] |= 0x80 << ((len % 4) * 8);
  words[(((len + 8) >> 6) * 16) + 14] = len * 8;

  let a = 1732584193;
  let b = -271733879;
  let c = -1732584194;
  let d = 271733878;
  const T = [
    -680876936, -389564586, 606105819, -1044525330, -176418897, 1200080426, -1473231341, -45705983,
    1770035416, -1958414417, -42063, -1990404162, 1804603682, -40341101, -1502002290, 1236535329,
    -165796510, -1069501632, 643717713, -373897302, -701558691, 38016083, -660478335, -405537848,
    568446438, -1019803690, -187363961, 1163531501, -1444681467, -51403784, 1735328473, -1926607734,
    -378558, -2022574463, 1839030562, -35309556, -1530992060, 1272893353, -155497632, -1094730640,
    681279174, -358537222, -722521979, 76029189, -640364487, -421815835, 530742520, -995338651,
    -198630844, 1126891415, -1416354905, -57434055, 1700485571, -1894986606, -1051523, -2054922799,
    1873313359, -30611744, -1560198380, 1309151649, -145523070, -1120210379, 718787259, -343485551,
  ];
  const S = [
    [7, 12, 17, 22],
    [5, 9, 14, 20],
    [4, 11, 16, 23],
    [6, 10, 15, 21],
  ];
  for (let i = 0; i < words.length; i += 16) {
    const oa = a;
    const ob = b;
    const oc = c;
    const od = d;
    for (let j = 0; j < 64; j += 1) {
      const round = Math.floor(j / 16);
      let g;
      let fn;
      if (round === 0) { g = j; fn = ff; }
      else if (round === 1) { g = (5 * j + 1) % 16; fn = gg; }
      else if (round === 2) { g = (3 * j + 5) % 16; fn = hh; }
      else { g = (7 * j) % 16; fn = ii; }
      const s = S[round][j % 4];
      const na = fn(a, b, c, d, words[i + g] | 0, s, T[j]);
      a = d; d = c; c = b; b = na;
    }
    a = add(a, oa); b = add(b, ob); c = add(c, oc); d = add(d, od);
  }
  const hex = (n) => {
    let out = '';
    for (let i = 0; i < 4; i += 1) out += ((n >> (i * 8)) & 0xff).toString(16).padStart(2, '0');
    return out;
  };
  return hex(a) + hex(b) + hex(c) + hex(d);
}

function parseChallenge(header) {
  const out = {};
  const regex = /(\w+)=(?:"([^"]*)"|([^,]*))/g;
  let m;
  while ((m = regex.exec(header))) out[m[1]] = m[2] ?? m[3];
  return out;
}

async function digest(payload, auth, sub) {
  const username = sub(auth.username || '');
  const password = sub(auth.password || '');
  // Preflight to obtain the WWW-Authenticate challenge.
  const preflight = await api.proxy({ method: payload.method, url: payload.url, headers: {}, body: null });
  const wwwAuth = preflight.headers?.['www-authenticate'] || preflight.headers?.['WWW-Authenticate'] || '';
  if (!/digest/i.test(wwwAuth)) return; // server didn't challenge with Digest
  const c = parseChallenge(wwwAuth);
  const url = new URL(payload.url);
  const uri = (url.pathname || '/') + (url.search || '');
  const ha1 = md5(`${username}:${c.realm}:${password}`);
  const ha2 = md5(`${payload.method}:${uri}`);
  const nc = '00000001';
  const cnonce = base64url(crypto.getRandomValues(new Uint8Array(8)));
  let response;
  if ((c.qop || '').includes('auth')) {
    response = md5(`${ha1}:${c.nonce}:${nc}:${cnonce}:auth:${ha2}`);
  } else {
    response = md5(`${ha1}:${c.nonce}:${ha2}`);
  }
  let authHeader =
    `Digest username="${username}", realm="${c.realm}", nonce="${c.nonce}", uri="${uri}", response="${response}"`;
  if (c.opaque) authHeader += `, opaque="${c.opaque}"`;
  if (c.qop) authHeader += `, qop=auth, nc=${nc}, cnonce="${cnonce}"`;
  payload.headers['Authorization'] = authHeader;
}

export async function applyAdvancedAuth(payload, auth, sub) {
  switch (auth.type) {
    case 'jwt': {
      const jwt = await signJwt(auth, sub);
      const prefix = sub(auth.headerPrefix || 'Bearer').trim();
      payload.headers['Authorization'] = prefix ? `${prefix} ${jwt}` : jwt;
      break;
    }
    case 'awssigv4':
      await awsSigV4(payload, auth, sub);
      break;
    case 'oauth2':
      await oauth2(payload, auth, sub);
      break;
    case 'digest':
      await digest(payload, auth, sub);
      break;
    default:
      break;
  }
}
