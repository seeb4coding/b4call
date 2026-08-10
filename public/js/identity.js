// The display name and colour this browser presents to collaborators. There
// are no accounts in B4Call, so this is a label people choose, not an identity
// claim — it is used for presence chips, comment authors and revision entries.

const KEY = 'b4call-identity';

const PALETTE = [
  '#ff6c37', '#4caf7d', '#5b9bd5', '#d4b13f', '#b06ad6',
  '#e05d5d', '#3fb6b6', '#e08b3d', '#7f8cff', '#d95f96',
];

const ADJECTIVES = ['Swift', 'Quiet', 'Bright', 'Calm', 'Bold', 'Keen', 'Warm', 'Sharp'];
const ANIMALS = ['Otter', 'Falcon', 'Fox', 'Heron', 'Ibex', 'Lynx', 'Moth', 'Wren'];

function randomOf(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function create() {
  return {
    clientId:
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `c${Date.now()}${Math.random().toString(36).slice(2, 8)}`,
    name: `${randomOf(ADJECTIVES)} ${randomOf(ANIMALS)}`,
    color: randomOf(PALETTE),
  };
}

let cached = null;

export function getIdentity() {
  if (cached) return cached;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY));
    if (parsed && parsed.clientId && parsed.name) {
      cached = { color: PALETTE[0], ...parsed };
      return cached;
    }
  } catch {
    /* fall through and mint a new one */
  }
  cached = create();
  localStorage.setItem(KEY, JSON.stringify(cached));
  return cached;
}

export function setIdentity(patch) {
  const next = { ...getIdentity(), ...patch };
  next.name = String(next.name || '').trim().slice(0, 40) || 'Guest';
  cached = next;
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function identityColors() {
  return [...PALETTE];
}

// Two-letter monogram for presence chips.
export function initialsOf(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
