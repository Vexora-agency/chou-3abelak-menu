/**
 * Customer order shelf: every order placed on THIS device is remembered for
 * 48 hours so the floating bell can list it ("Track", "Received?") without
 * any account. Entries are { n: number, t: 32-hex token, at: ISO time }.
 * The token IS the capability (same as /api/track) — never display it,
 * only send it back to the two token-gated endpoints.
 */

export interface StoredCustomerOrder {
  n: number;
  t: string;
  at: string;
}

export const CUSTOMER_ORDERS_KEY = 'customer_orders_v1';
export const CUSTOMER_ORDERS_TTL_MS = 48 * 3600 * 1000;

const TOKEN_RE = /^[0-9a-f]{32}$/;

export function isStoredOrder(v: unknown): v is StoredCustomerOrder {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    Number.isInteger(o.n) &&
    (o.n as number) > 0 &&
    typeof o.t === 'string' &&
    TOKEN_RE.test(o.t) &&
    typeof o.at === 'string' &&
    !Number.isNaN(Date.parse(o.at))
  );
}

/** Pure: drop expired/malformed entries (testable without localStorage). */
export function pruneOrders(list: unknown, nowMs: number = Date.now()): StoredCustomerOrder[] {
  if (!Array.isArray(list)) return [];
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const seen = new Set<number>();
  const out: StoredCustomerOrder[] = [];
  for (const v of list) {
    if (!isStoredOrder(v)) continue;
    if (now - Date.parse(v.at) > CUSTOMER_ORDERS_TTL_MS) continue;
    if (seen.has(v.n)) continue;
    seen.add(v.n);
    out.push({ n: v.n, t: v.t, at: v.at });
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

function readRaw(): unknown {
  try {
    const raw = window.localStorage.getItem(CUSTOMER_ORDERS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** Orders of the last 48h, newest first (also prunes the stored shelf). */
export function loadCustomerOrders(nowMs: number = Date.now()): StoredCustomerOrder[] {
  const pruned = pruneOrders(readRaw(), nowMs);
  try {
    window.localStorage.setItem(CUSTOMER_ORDERS_KEY, JSON.stringify(pruned));
  } catch {}
  return pruned;
}

/** Remember a fresh order (newest first, deduped by number, 48h window). */
export function saveCustomerOrder(n: number, t: string, nowMs: number = Date.now()): StoredCustomerOrder[] {
  if (!Number.isInteger(n) || n <= 0 || typeof t !== 'string' || !TOKEN_RE.test(t)) {
    return loadCustomerOrders(nowMs);
  }
  const at = new Date(Number.isFinite(nowMs) ? nowMs : Date.now()).toISOString();
  const raw = readRaw();
  const rest: unknown[] = Array.isArray(raw) ? raw : [];
  const next = pruneOrders([{ n, t, at }, ...rest], nowMs);
  try {
    window.localStorage.setItem(CUSTOMER_ORDERS_KEY, JSON.stringify(next));
  } catch {}
  return next;
}
