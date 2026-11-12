/**
 * Customer order shelf: every order placed on THIS device is remembered for
 * 12 hours so the floating bell can list it ("Track", "Did you receive it?")
 * without any account. Entries are { n: number, t: 32-hex token, at: ISO time }.
 * The token IS the capability (same as /api/track) — never display it,
 * only send it back to the two token-gated endpoints.
 * 12h matches the auto-complete window: an unconfirmed order is marked
 * complete by the system at 12h, so the shelf never outlives the question.
 */

export interface StoredCustomerOrder {
  n: number;
  t: string;
  at: string;
}

export const CUSTOMER_ORDERS_KEY = 'customer_orders_v1';
export const CUSTOMER_ORDERS_TTL_MS = 12 * 3600 * 1000;

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

/** Orders of the last 12h, newest first (also prunes the stored shelf). */
export function loadCustomerOrders(nowMs: number = Date.now()): StoredCustomerOrder[] {
  const pruned = pruneOrders(readRaw(), nowMs);
  try {
    window.localStorage.setItem(CUSTOMER_ORDERS_KEY, JSON.stringify(pruned));
  } catch {}
  return pruned;
}

const SOUND_KEY = 'customer_orders_sound_v1';

/**
 * Global bell sound switch (one clear button in the panel header).
 * OFF = the bell stays fully visual (badge + motion) but never chimes.
 * Defaults ON — sound works unless the customer muted it. A brand-new
 * order re-arms the bell (see saveCustomerOrder): every order rings like
 * a fresh one, a mute never leaks into the next order.
 */
export function isSoundOff(): boolean {
  try {
    const shelf = detailsShelf();
    if (!shelf) return false;
    return shelf.getItem(SOUND_KEY) === 'off';
  } catch {
    return false;
  }
}

export function setSoundOff(off: boolean): void {
  try {
    const shelf = detailsShelf();
    if (!shelf) return;
    if (off) shelf.setItem(SOUND_KEY, 'off');
    else shelf.removeItem(SOUND_KEY);
  } catch {}
}

function detailsShelf(): Storage | null {
  try {
    const s = (globalThis as unknown as { localStorage?: Storage }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

/**
 * Remembered checkout details ("remember me on this device").
 * Presence of a saved record means the box was checked, so loading
 * always returns remember:true. Forcing false here was the "second visit
 * wipes everything" bug: unchecked box + submit = removeItem.
 */

/**
 * Strip the delivery address before remembering: the address is typed
 * fresh on EVERY order and must never persist (a stale address from
 * another visit/city is worse than an empty field). Everything else
 * (name, phone, email, remember flag) passes through untouched.
 */
export function withoutAddress<T extends { address?: unknown }>(customer: T): Omit<T, 'address'> {
  const { address: _omit, ...rest } = customer;
  void _omit;
  return rest;
}
const DETAILS_KEY = 'customer_details_v1';

export function loadRememberedDetails(): Record<string, unknown> | null {
  try {
    const shelf = detailsShelf();
    if (!shelf) return null;
    const raw = shelf.getItem(DETAILS_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return { ...(parsed as Record<string, unknown>), remember: true };
  } catch {
    return null;
  }
}

/** Persist on submit when checked; erase when the customer unchecked. */
export function saveRememberedDetails<T extends { remember?: boolean }>(customer: T): void {
  try {
    const shelf = detailsShelf();
    if (!shelf) return;
    if (customer.remember) shelf.setItem(DETAILS_KEY, JSON.stringify(customer));
    else shelf.removeItem(DETAILS_KEY);
  } catch {}
}

/**
 * Map pins are SESSION-ONLY by design and are never remembered, so no
 * storage helpers exist here on purpose — a stale pin from another
 * visit/city can never ride along silently. (An orphaned
 * `customer_location_v1` key from older app versions is simply never read.)
 */

/** Drop one order from the shelf (dismissed finished/orphan entries). */
export function removeCustomerOrder(n: number): StoredCustomerOrder[] {
  if (!Number.isInteger(n) || n <= 0) return loadCustomerOrders();
  const raw = readRaw();
  const rest: unknown[] = Array.isArray(raw) ? raw : [];
  const next = pruneOrders(
    rest.filter((v) => !(isStoredOrder(v) && v.n === n)),
    Date.now()
  );
  try {
    window.localStorage.setItem(CUSTOMER_ORDERS_KEY, JSON.stringify(next));
  } catch {}
  try {
    window.dispatchEvent(new Event('customer-orders-changed'));
  } catch {}
  return next;
}

const RUNG_KEY = 'customer_orders_rung_v1';

/** Order numbers that already rang (persisted — survives reloads/tab kills). */
export function loadRung(): number[] {
  try {
    const shelf = detailsShelf();
    if (!shelf) return [];
    const raw = shelf.getItem(RUNG_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is number => Number.isInteger(n) && (n as number) > 0);
  } catch {
    return [];
  }
}

/** Mark orders as rung (deduped, capped). */
export function markRung(numbers: number[]): void {
  try {
    const shelf = detailsShelf();
    if (!shelf) return;
    const valid = numbers.filter((n) => Number.isInteger(n) && n > 0);
    const merged = [...new Set([...loadRung(), ...valid])].slice(-100);
    shelf.setItem(RUNG_KEY, JSON.stringify(merged));
  } catch {}
}

/**
 * Standalone email memory (device-only, no account). The email is saved on
 * EVERY successful submit — independent of the "remember my details"
 * checkbox — so a customer who typed it once finds it prefilled on their
 * next visit even if they never checked the box. Name/phone/address keep
 * the strict opt-in rule; the email alone is low-risk and high-convenience.
 */
const CUSTOMER_EMAIL_KEY = 'customer_email_v1';
const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function cleanEmail(v: unknown): string {
  if (typeof v !== 'string') return '';
  const out = v.trim().toLowerCase().slice(0, 254);
  return EMAIL_SHAPE_RE.test(out) ? out : '';
}

/** Last validated email typed on this device ('' when none). */
export function loadSavedEmail(): string {
  try {
    const shelf = detailsShelf();
    if (!shelf) return '';
    return cleanEmail(shelf.getItem(CUSTOMER_EMAIL_KEY));
  } catch {
    return '';
  }
}

/** Persist a validated email; invalid/empty values never erase the stored one. */
export function saveEmailAddress(email: unknown): void {
  try {
    const shelf = detailsShelf();
    if (!shelf) return;
    const v = cleanEmail(email);
    if (!v) return;
    shelf.setItem(CUSTOMER_EMAIL_KEY, v);
  } catch {}
}

/** Remember a fresh order (newest first, deduped by number, 12h window). */
export function saveCustomerOrder(n: number, t: string, nowMs: number = Date.now()): StoredCustomerOrder[] {
  if (!Number.isInteger(n) || n <= 0 || typeof t !== 'string' || !TOKEN_RE.test(t)) {
    return loadCustomerOrders(nowMs);
  }
  const at = new Date(Number.isFinite(nowMs) ? nowMs : Date.now()).toISOString();
  const raw = readRaw();
  const rest: unknown[] = Array.isArray(raw) ? raw : [];
  const already = rest.some((v) => isStoredOrder(v) && v.n === n);
  const next = pruneOrders([{ n, t, at }, ...rest], nowMs);
  try {
    window.localStorage.setItem(CUSTOMER_ORDERS_KEY, JSON.stringify(next));
  } catch {}
  // Wake the floating bell instantly (same-tab storage events don't fire).
  // Brand-new orders only — re-saves never re-ring.
  if (!already) {
    // A new order re-arms a muted bell: the customer muted the OLD order,
    // this one deserves its chime. (Manual re-mute stays possible after.)
    try {
      setSoundOff(false);
    } catch {}
    try {
      window.dispatchEvent(new Event('customer-orders-changed'));
    } catch {}
  }
  return next;
}
