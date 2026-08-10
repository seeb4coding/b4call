// Outbound HTTP proxy configuration, stored per browser. Requests are routed
// through this proxy by the server-side http client when enabled.
const KEY = 'b4call-proxy';

export function getProxyConfig() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY));
    if (parsed && typeof parsed === 'object') {
      return { enabled: parsed.enabled === true, url: String(parsed.url || '') };
    }
  } catch {
    /* fall through */
  }
  return { enabled: false, url: '' };
}

export function setProxyConfig(config) {
  localStorage.setItem(
    KEY,
    JSON.stringify({ enabled: Boolean(config.enabled), url: String(config.url || '') })
  );
}
