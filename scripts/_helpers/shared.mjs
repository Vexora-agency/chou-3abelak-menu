// Shared assertion/reporting + fake KV + request helpers for runnable
// node scripts/test-*.mjs suites. Pure moves from the original suites:
// same counters, same FAIL format, same summary line + exit code.
export function createAsserts() {
  let passed = 0;
  let failed = 0;
  function ok(cond, name) {
    if (cond) {
      passed += 1;
    } else {
      failed += 1;
      console.error(`FAIL: ${name}`);
    }
  }
  function summary() {
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  }
  return { ok, summary };
}

export function makeKV() {
  const store = new Map(); // key -> { value, metadata, expiresAt }
  return {
    __store: store,
    __expire(key) {
      const e = store.get(key);
      if (e) e.expiresAt = Date.now() - 1;
    },
    async get(key, opts) {
      const e = store.get(key);
      if (!e) return null;
      if (e.expiresAt && Date.now() > e.expiresAt) {
        store.delete(key);
        return null;
      }
      if (opts && opts.type === 'json') {
        try {
          return JSON.parse(e.value);
        } catch {
          return null;
        }
      }
      return e.value;
    },
    async put(key, value, opts) {
      const o = opts || {};
      store.set(key, {
        value: typeof value === 'string' ? value : String(value),
        metadata: o.metadata,
        expiresAt: o.expirationTtl ? Date.now() + o.expirationTtl * 1000 : 0,
      });
    },
    async delete(key) {
      store.delete(key);
    },
    async list(opts) {
      const prefix = (opts && opts.prefix) || '';
      const limit = (opts && opts.limit) || 1000;
      const keys = [];
      for (const [name, e] of store) {
        if (!name.startsWith(prefix)) continue;
        if (e.expiresAt && Date.now() > e.expiresAt) continue;
        keys.push({ name, metadata: e.metadata });
        if (keys.length >= limit) break;
      }
      return { keys };
    },
  };
}

export const ADMIN_HEADERS = { 'X-Requested-With': 'menu-admin', Origin: 'https://x' };

export function makeReq(method, url, { headers, body } = {}) {
  return new Request(url, {
    method,
    headers: { ...ADMIN_HEADERS, ...(headers || {}) },
    body: body === undefined ? undefined : body,
  });
}

export async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
