// Tracking tokens + VAPID lazy-gen + notify guards (no infra).
// Usage: node scripts/test-track-push.mjs
import { newTrackToken, getVapidSettings, notifyOrderStatus, notifyNewOrder, nagUnackedOrders } from '../functions/_shared/push.js';

let fails = 0;
const check = (name, cond, extra = '') => {
  if (!cond) { fails++; console.error(`  FAIL ${name} ${extra}`); }
  else console.log(`  ok ${name}`);
};

// ---- tokens: shape + uniqueness ----
{
  const seen = new Set();
  let bad = false;
  for (let i = 0; i < 2000; i++) {
    const t = newTrackToken();
    if (!/^[0-9a-f]{32}$/.test(t) || seen.has(t)) { bad = true; break; }
    seen.add(t);
  }
  check('2000 unique 32-hex track tokens', !bad && seen.size === 2000);
}

// ---- fake D1 (prepare/bind/first/run/all) ----
function fakeDb() {
  const tables = { push_settings: [], push_subscriptions: [] };
  const api = {
    prepare(sql) {
      const q = {
        _sql: sql,
        _args: [],
        bind(...a) { q._args = a; return q; },
        async first() {
          if (q._sql.includes('FROM push_settings')) {
            const r = tables.push_settings.find((r) => r.id === 1);
            return r ? { ...r } : null;
          }
          return null;
        },
        async run() {
          if (q._sql.startsWith('INSERT OR IGNORE INTO push_settings')) {
            if (!tables.push_settings.some((r) => r.id === 1)) {
              tables.push_settings.push({ id: 1, public_key: q._args[0], private_key: q._args[1], subject: q._args[2], created_at: q._args[3] });
            }
            return {};
          }
          return {};
        },
        async all() {
          if (q._sql.includes('FROM push_subscriptions')) {
            return { results: tables.push_subscriptions.filter((r) => r.order_id === q._args[0]) };
          }
          return { results: [] };
        },
      };
      return q;
    },
  };
  return { api, tables };
}

// ---- lazy VAPID gen: stable singleton, race-safe ----
{
  const { api } = fakeDb();
  const a = await getVapidSettings(api, 'https://site.test');
  check('generates pair', !!(a && /^[A-Za-z0-9_-]{80,100}$/.test(a.public_key) && /^[A-Za-z0-9_-]{40,50}$/.test(a.private_key)), JSON.stringify(a && Object.keys(a)));
  const b = await getVapidSettings(api, 'https://other.test');
  check('second call reuses stored pair', b && b.public_key === a.public_key && b.private_key === a.private_key);
  check('subject pinned at first gen', b && b.subject === 'https://site.test');
}
{
  // Concurrent first-calls converge on one pair.
  const { api, tables } = fakeDb();
  const [a, b] = await Promise.all([
    getVapidSettings(api, 'https://site.test'),
    getVapidSettings(api, 'https://site.test'),
  ]);
  check('race converges', a.public_key === b.public_key && tables.push_settings.length === 1);
}

// ---- notify guards (never touches network here) ----
{
  const { api } = fakeDb();
  check('unknown status no-op', (await notifyOrderStatus(api, { orderId: 'x', status: 'new', orderNumber: 1 })).sent === 0);
  check('missing orderId no-op', (await notifyOrderStatus(api, { status: 'confirmed', orderNumber: 1 })).sent === 0);
  check('no subs no-op', (await notifyOrderStatus(api, { orderId: 'x', status: 'confirmed', orderNumber: 1 })).sent === 0);
}

// ---- kitchen loop guards (admin subs table empty here) ----
{
  const { api } = fakeDb();
  check('new-order bad number no-op', (await notifyNewOrder(api, { orderNumber: 0 })).sent === 0);
  check('new-order no devices no-op', (await notifyNewOrder(api, { orderNumber: 1007, total: 350000, currency: 'LBP' })).sent === 0);
}

// ---- nag pass guards (no unacked rows in the fake) ----
{
  const { api } = fakeDb();
  const out = await nagUnackedOrders(api, { storeName: 'T', currency: 'LBP', adminUrl: 'https://x/admin' });
  check('nag empty no-op', out.nagged === 0);
}

console.log(fails ? `\n${fails} FAILED` : '\nall green');
if (fails) process.exit(1);
