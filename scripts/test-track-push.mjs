// Tracking tokens + VAPID lazy-gen + notify guards (no infra).
// Usage: node scripts/test-track-push.mjs
import { readFileSync } from 'node:fs';
import { newTrackToken, getVapidSettings, notifyOrderStatus, notifyNewOrder, nagUnackedOrders, resolveStatusCopy, validatePushSub } from '../functions/_shared/push.js';

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
  check('ready copy follows order type', resolveStatusCopy('ready', 'delivery').ar(7).includes('خارج للتوصيل') && resolveStatusCopy('ready', 'pickup').en(7).includes('ready for pickup') && resolveStatusCopy('ready', 'dinein').ar(7).includes('جاهز'));
  check('ready copy falls back to delivery', resolveStatusCopy('ready', undefined).en(7).includes('out for delivery'));
  check('plain statuses pass through', resolveStatusCopy('confirmed', 'delivery').en(7).includes('being prepared') && resolveStatusCopy('bogus', 'delivery') === null);
}

// ---- kitchen loop guards (admin subs table empty here) ----
{
  const { api } = fakeDb();
  check('new-order bad number no-op', (await notifyNewOrder(api, { orderNumber: 0 })).sent === 0);
  check('new-order no devices no-op', (await notifyNewOrder(api, { orderNumber: 1007, total: 350000, currency: 'LBP' })).sent === 0);
}

// ---- subscription shape: std base64 AND base64url, field-precise rejects ----
{
  const std = {
    endpoint: 'https://web.push.apple.com/abc123',
    p256dh: 'B'.repeat(87) + '=',
    auth: 'C'.repeat(22) + '==',
  };
  const r1 = validatePushSub(std);
  check('std-base64 sub accepted', r1.ok === true);
  const url = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/xyz',
    p256dh: 'D'.repeat(86) + '_-',
    auth: 'E'.repeat(22) + '==',
  };
  check('base64url sub accepted', validatePushSub(url).ok === true);
  const noEp = validatePushSub({ ...std, endpoint: 'http://evil.test/x' });
  check('http endpoint names field', noEp.ok === false && noEp.field === 'endpoint');
  const badKey = validatePushSub({ ...std, p256dh: '!!!' });
  check('bad key names field', badKey.ok === false && badKey.field === 'p256dh');
  const noAuth = validatePushSub({ endpoint: std.endpoint, p256dh: std.p256dh });
  check('missing auth names field', noAuth.ok === false && noAuth.field === 'auth');
  const empty = validatePushSub({});
  check('empty names endpoint first', empty.ok === false && empty.field === 'endpoint');
}

// ---- nag pass guards (no unacked rows in the fake) ----
{
  const { api } = fakeDb();
  const out = await nagUnackedOrders(api, { storeName: 'T', currency: 'LBP', adminUrl: 'https://x/admin' });
  check('nag empty no-op', out.nagged === 0);
}

// ---- kitchen push UI wiring ----
{
  const dashboard = readFileSync(new URL('../src/features/orders/components/OrdersDashboard.tsx', import.meta.url), 'utf8');
  const push = readFileSync(new URL('../src/features/orders/hooks/useKitchenPush.ts', import.meta.url), 'utf8');
  const panels = readFileSync(new URL('../src/features/orders/components/orders/OrdersDashPanels.tsx', import.meta.url), 'utf8');
  const track = readFileSync(new URL('../src/features/track/TrackView.tsx', import.meta.url), 'utf8');
  const orders = readFileSync(new URL('../src/features/orders/components/orders/OrdersDashList.tsx', import.meta.url), 'utf8');
  check(
    'admin dashboard hides the push setup card',
    !dashboard.includes('KitchenPushCard')
  );
  check(
    'the bell drives push and the short off notice',
    dashboard.includes('useKitchenPush')
      && dashboard.includes('enablePush(false)')
      && dashboard.includes('enablePush(true)')
      && dashboard.includes('disablePush()')
      && dashboard.includes('setPushNotice(t.notificationsOff)')
      && panels.includes('data-sound-toggle="1"')
  );
  check(
    'an existing browser subscription is re-registered from the bell hook',
    push.includes('getExistingSub()')
      && push.includes('postJson(')
      && push.includes("'/api/admin/push-subscriptions'")
      && push.includes('unsubscribeLocal')
  );
  check(
    'track page header carries a centered page title + store name',
    track.includes("'Order tracking'") && track.includes("'تتبع الطلب'") && track.includes('border-b border-white/5')
  );
  const notesAt = orders.indexOf('{o.notes &&');
  const totalsAt = orders.indexOf('pt-1.5 border-t border-neutral-800 space-y-1 text-xs text-neutral-400');
  check(
    'order notes render with the items, above the money block',
    notesAt > -1 && totalsAt > -1 && notesAt < totalsAt && orders.includes('StickyNote') && orders.includes('role="note"')
  );
}

console.log(fails ? `\n${fails} FAILED` : '\nall green');
if (fails) process.exit(1);
