// Smart ETA + receive-unlock backend core (migration 0022): pure ETA math,
// settings coercion, confirm stamping (both paths), the receive-unlock gate
// and the track response fields. DB access is through a mock-D1
// prepare/bind/first/run stand-in in the style of test-order-release.mjs
// (pure math needs no mock at all).
// Run: node scripts/test-eta.mjs
import {
  computeEta,
  countActiveKitchenOrders,
  stampConfirmation,
  updateOrderStatus,
} from '../functions/_shared/repositories/orders.repo.js';
import {
  ETA_DEFAULTS,
  haversineKm,
  orderDistanceKm,
  orderingEtaOrDefaults,
  parseMapUrlCoordsJs,
  receivableAtMs,
  receiveDelayMinFor,
} from '../functions/_shared/eta.js';
import { mapOrderRow } from '../functions/_shared/orders.js';
import { onRequest as trackOnRequest } from '../functions/api/track.js';
import { onRequest as receivedOnRequest } from '../functions/api/track/received.js';
import { createAsserts } from './_helpers/shared.mjs';

const { ok, summary } = createAsserts();
const MIN = 60 * 1000;
const T0 = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const TOK = 'a'.repeat(32);

// ---- 1. computeEta: pure delivery math ----
{
  const s = { prepMinutes: 15, kitchenMinutesPerOrder: 3, courierSpeedKmh: 25, roadFactor: 1.35, defaultDeliveryMinutes: 20 };
  // 5 km road-adjusted ride: 5*1.35/25*60 = 16.2; queue 2 -> 6; 15+6+16.2 = 37.2 -> 37.
  const r = computeEta({ confirmedAtMs: T0, orderType: 'delivery', queueLen: 2, distanceKm: 5, settings: s });
  ok(r.etaMinutes === 37, `delivery eta minutes (got ${r.etaMinutes})`);
  ok(r.etaAtMs === T0 + 37 * MIN, 'delivery eta instant = confirm + minutes');
}

// ---- 2. Counter types ignore distance ----
{
  const s = { prepMinutes: 15, kitchenMinutesPerOrder: 3, courierSpeedKmh: 25, roadFactor: 1.35, defaultDeliveryMinutes: 20 };
  const p = computeEta({ confirmedAtMs: T0, orderType: 'pickup', queueLen: 2, distanceKm: 50, settings: s });
  ok(p.etaMinutes === 21, 'pickup ignores distance (15+6)');
  const d = computeEta({ confirmedAtMs: T0, orderType: 'dinein', queueLen: 2, distanceKm: 50, settings: s });
  ok(d.etaMinutes === 21, 'dinein ignores distance (15+6)');
}

// ---- 3. Missing/negative distance falls back to the default leg ----
{
  const s = { prepMinutes: 15, kitchenMinutesPerOrder: 3, courierSpeedKmh: 25, roadFactor: 1.35, defaultDeliveryMinutes: 20 };
  ok(computeEta({ confirmedAtMs: T0, orderType: 'delivery', queueLen: 0, distanceKm: null, settings: s }).etaMinutes === 35, 'null distance uses default leg (15+20)');
  ok(computeEta({ confirmedAtMs: T0, orderType: 'delivery', queueLen: 0, distanceKm: undefined, settings: s }).etaMinutes === 35, 'undefined distance uses default leg');
  ok(computeEta({ confirmedAtMs: T0, orderType: 'delivery', queueLen: 0, distanceKm: -2, settings: s }).etaMinutes === 35, 'negative distance uses default leg');
  ok(computeEta({ confirmedAtMs: T0, orderType: 'spaceship', queueLen: 0, distanceKm: null, settings: s }).etaMinutes === 35, 'unknown type travels like delivery');
}

// ---- 4. Clamp [10,120] + rounding ----
{
  const s = { prepMinutes: 0, kitchenMinutesPerOrder: 0, courierSpeedKmh: 25, roadFactor: 1.35, defaultDeliveryMinutes: 0 };
  ok(computeEta({ confirmedAtMs: T0, orderType: 'pickup', queueLen: 0, distanceKm: null, settings: s }).etaMinutes === 10, 'zero work clamps to 10 min floor');
  ok(computeEta({ confirmedAtMs: T0, orderType: 'delivery', queueLen: 100, distanceKm: 200, settings: { ...s, prepMinutes: 15, kitchenMinutesPerOrder: 3 } }).etaMinutes === 120, 'huge queue clamps to 120 min ceiling');
  // 16.5 rounds half-up to 17 (15 prep + 1.5 kitchen).
  const half = computeEta({ confirmedAtMs: T0, orderType: 'pickup', queueLen: 1, distanceKm: null, settings: { prepMinutes: 15, kitchenMinutesPerOrder: 1.5 } });
  ok(half.etaMinutes === 17, `rounds half up (got ${half.etaMinutes})`);
  // Negative / fractional queue lengths are sanitized, never throw.
  ok(computeEta({ confirmedAtMs: T0, orderType: 'pickup', queueLen: -5, distanceKm: null, settings: s }).etaMinutes === 10, 'negative queue treated as 0');
  ok(computeEta({ confirmedAtMs: NaN, orderType: 'pickup', queueLen: 0, distanceKm: null, settings: s }).etaMinutes === 10, 'bad confirm instant falls back to now');
  ok(computeEta({ confirmedAtMs: T0, orderType: 'pickup', queueLen: 0, settings: null }).etaMinutes === 15, 'null settings use defaults');
}

// ---- 5. orderingEtaOrDefaults: defaults + server-side clamps ----
{
  const d = orderingEtaOrDefaults(null);
  ok(d.prepMinutes === 15 && d.kitchenMinutesPerOrder === 3 && d.courierSpeedKmh === 25 && d.roadFactor === 1.35 && d.defaultDeliveryMinutes === 20 && d.receiveDelayDeliveryMin === 30 && d.receiveDelayPickupMin === 15, 'null ordering yields ETA_DEFAULTS');
  ok(orderingEtaOrDefaults({}).prepMinutes === ETA_DEFAULTS.prepMinutes, 'empty ordering yields defaults');
  const c = orderingEtaOrDefaults({ prepMinutes: 999, kitchenMinutesPerOrder: -5, courierSpeedKmh: 3, roadFactor: 9, defaultDeliveryMinutes: 1000, receiveDelayDeliveryMin: -1, receiveDelayPickupMin: 5000 });
  ok(c.prepMinutes === 180 && c.kitchenMinutesPerOrder === 0 && c.courierSpeedKmh === 5 && c.roadFactor === 2 && c.defaultDeliveryMinutes === 180 && c.receiveDelayDeliveryMin === 0 && c.receiveDelayPickupMin === 720, 'out-of-range values clamp to edges');
  const k = orderingEtaOrDefaults({ prepMinutes: 20, roadFactor: 1.5, receiveDelayDeliveryMin: 45 });
  ok(k.prepMinutes === 20 && k.roadFactor === 1.5 && k.receiveDelayDeliveryMin === 45 && k.kitchenMinutesPerOrder === 3, 'in-range values pass through, missing default');
  ok(receiveDelayMinFor('delivery', null) === 30 && receiveDelayMinFor('pickup', null) === 15 && receiveDelayMinFor('dinein', null) === 15 && receiveDelayMinFor('bogus', null) === 15, 'receive delays: delivery 30, counter types 15');
}

// ---- 6. receivableAtMs: max(created+delay, eta), legacy-safe ----
{
  const created = iso(T0 - 60 * MIN);
  const confirmed = iso(T0 - 50 * MIN);
  const eta = iso(T0 + 60 * MIN);
  // eta (T0+60) beats created+30 (T0-30).
  ok(receivableAtMs({ confirmedAt: confirmed, createdAt: created, etaAt: eta, orderType: 'delivery', settings: null, nowMs: T0 }) === T0 + 60 * MIN, 'future eta wins over delay');
  // eta in the past: delay instant wins.
  ok(receivableAtMs({ confirmedAt: confirmed, createdAt: created, etaAt: iso(T0 - 90 * MIN), orderType: 'delivery', settings: null, nowMs: T0 }) === T0 - 20 * MIN, 'delay wins when eta already passed');
  // Legacy row (NULL stamps): unlock from created + delay.
  ok(receivableAtMs({ confirmedAt: null, createdAt: created, etaAt: null, orderType: 'delivery', settings: null, nowMs: T0 }) === T0 - 30 * MIN, 'legacy delivery unlocks from created+30');
  ok(receivableAtMs({ confirmedAt: null, createdAt: created, etaAt: null, orderType: 'pickup', settings: null, nowMs: T0 }) === T0 - 45 * MIN, 'legacy pickup unlocks from created+15');
  // confirmed_at preferred over created_at when both exist.
  ok(receivableAtMs({ confirmedAt: confirmed, createdAt: created, etaAt: null, orderType: 'delivery', settings: null, nowMs: T0 }) === T0 - 20 * MIN, 'confirmed_at preferred over created_at');
  // Corrupt dates fail open to now (never trap).
  ok(receivableAtMs({ confirmedAt: 'garbage', createdAt: null, etaAt: null, orderType: 'delivery', settings: null, nowMs: T0 }) === T0 + 30 * MIN, 'corrupt dates fail open to now+delay');
}

// ---- 7. Distance helpers ----
{
  ok(Math.abs(haversineKm(0, 0, 1, 0) - 111.195) < 0.01, '1 degree latitude ~111.2 km');
  ok(haversineKm(33.9, 35.5, 33.9, 35.5) === 0, 'same point is zero');
  ok(parseMapUrlCoordsJs('33.8938, 35.5018')?.lat === 33.8938, 'bare coords parse');
  ok(parseMapUrlCoordsJs('https://www.google.com/maps/search/?api=1&query=33.89,35.50')?.lng === 35.5, '?query= parses');
  ok(parseMapUrlCoordsJs('https://maps.app.goo.gl/AbC123xYz') === null, 'short link has no coords');
  ok(parseMapUrlCoordsJs('Hamra, Beirut') === null && parseMapUrlCoordsJs('') === null && parseMapUrlCoordsJs(null) === null, 'garbage/empty rejected');
  const row = { location_lat: 33.8938, location_lng: 35.5018 };
  const menu = { settings: { mapUrl: 'https://www.google.com/maps/search/?api=1&query=33.8938,35.5018' } };
  ok(orderDistanceKm(row, menu) === 0, 'same-spot order is 0 km');
  ok(orderDistanceKm({ location_lat: null, location_lng: null }, menu) === null, 'missing order location is null');
  ok(orderDistanceKm(row, { settings: {} }) === null, 'menu without coords is null');
  ok(orderDistanceKm(row, null) === null, 'missing menu is null');
}

// ---- 8. mapOrderRow exposes the new instants ----
{
  const mapped = mapOrderRow({
    id: 'x', number: 1, created_at: 't', status: 'confirmed', type: 'delivery',
    customer_name: 'A', customer_phone: '1', items_json: '[]', subtotal: 1,
    delivery_fee: 0, total: 1, confirmed_at: '2026-01-01T00:00:00.000Z', eta_at: '2026-01-01T00:40:00.000Z',
  });
  ok(mapped.confirmedAt === '2026-01-01T00:00:00.000Z' && mapped.etaAt === '2026-01-01T00:40:00.000Z', 'stamped row maps both instants');
  const legacy = mapOrderRow({
    id: 'y', number: 2, created_at: 't', status: 'new', type: 'pickup',
    customer_name: 'B', customer_phone: '2', items_json: '[]', subtotal: 1, delivery_fee: 0, total: 1,
  });
  ok(legacy.confirmedAt === null && legacy.etaAt === null, 'legacy row maps nulls (keys always present)');
}

// ---- 9. updateOrderStatus stamps on confirm (both paths share it) ----
function mockOrdersDb(seedRows, seen) {
  const rows = seedRows.map((r) => ({ ...r }));
  const byNum = (n) => rows.find((r) => r.number === n);
  const byId = (id) => rows.find((r) => r.id === id);
  return {
    rows,
    prepare(sql) {
      if (seen) seen.push(sql);
      const countAll = () => rows.filter((r) => r.status === 'new' || r.status === 'confirmed').length;
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes('SELECT COUNT(*) AS c')) return { c: countAll() };
              if (sql.includes('FROM orders WHERE number')) {
                if (sql.includes('SELECT 1 AS ok')) {
                  const r = byNum(args[0]);
                  return r && r.track_token === args[1] ? { ok: 1 } : null;
                }
                return byNum(args[0]) || null;
              }
              if (sql.includes('FROM orders WHERE id')) return byId(args[0]) || null;
              return null;
            },
            async all() { return { results: [] }; },
            async run() {
              if (sql.includes("SET status = 'completed'")) {
                const r = rows.find((x) => x.number === args[0] && x.track_token === args[1] && (x.status === 'confirmed' || x.status === 'ready'));
                if (!r) return { meta: { changes: 0 } };
                r.status = 'completed';
                r.updated_at = args[2];
                return { meta: { changes: 1 } };
              }
              if (sql.includes('SET confirmed_at')) {
                const r = rows.find((x) => x.id === args[2] && x.status === 'confirmed' && !x.confirmed_at);
                if (!r) return { meta: { changes: 0 } };
                r.confirmed_at = args[0];
                r.eta_at = args[1];
                r.updated_at = args[0];
                return { meta: { changes: 1 } };
              }
              if (sql.includes('UPDATE orders SET status')) {
                const r = byId(args[2]);
                if (!r) return { meta: { changes: 0 } };
                r.status = args[0];
                r.updated_at = args[1];
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
        async first() {
          if (sql.includes('SELECT COUNT(*) AS c')) return { c: countAll() };
          return null;
        },
      };
    },
  };
}

const orderSeed = (over = {}) => ({
  id: 'ord-1', number: 1001, track_token: TOK, status: 'new', type: 'delivery',
  customer_name: 'Ali', customer_phone: '70123456', customer_address: 'Hamra',
  customer_table: null, notes: null, location_lat: 33.9, location_lng: 35.5,
  items_json: '[]', subtotal: 100, delivery_fee: 0, total: 100, lang: 'ar',
  created_at: iso(T0 - 60 * MIN), updated_at: iso(T0 - 60 * MIN),
  confirmed_at: null, eta_at: null, ...over,
});

{
  // Primary status UPDATE keeps its exact shape (3 binds) — existing mocks
  // (Telegram suite) match on it.
  const seen = [];
  const db = mockOrdersDb([orderSeed()], seen);
  const out = await updateOrderStatus(db, 'ord-1', 'confirmed', { settings: null, queueLen: 0, distanceKm: null, nowMs: T0 });
  const primary = seen.find((s) => s.includes('UPDATE orders SET status'));
  ok(primary === 'UPDATE orders SET status = ?1, updated_at = ?2 WHERE id = ?3', 'primary status UPDATE text unchanged');
  ok(out && out.status === 'confirmed', 'confirm returns the mapped order');
  ok(out.confirmedAt === iso(T0) && out.etaAt === iso(T0 + 35 * MIN), `confirm stamps confirmed_at+eta_at (eta ${out && out.etaAt})`);
  const stored = db.rows[0];
  ok(stored.confirmed_at === iso(T0) && stored.eta_at === iso(T0 + 35 * MIN), 'stamp persisted (default leg 15+20 with empty queue)');
}

{
  // Precise inputs flow through: 2 queued + 5 km ride -> 37 min.
  const db = mockOrdersDb([orderSeed(), orderSeed({ id: 'ord-2', number: 1002 }), orderSeed({ id: 'ord-3', number: 1003, status: 'confirmed' })]);
  // Live kitchen count when queueLen is absent: ord-1 (new) + ord-2 (new)
  // + ord-3 (confirmed) = 3 active, minus self = 2 ahead
  // -> 15 + 2*3 + 16.2 = 37.2 -> 37 min.
  const out = await updateOrderStatus(db, 'ord-1', 'confirmed', {
    settings: { prepMinutes: 15, kitchenMinutesPerOrder: 3, courierSpeedKmh: 25, roadFactor: 1.35, defaultDeliveryMinutes: 20 },
    distanceKm: 5, nowMs: T0,
  });
  ok(out && out.etaAt === iso(T0 + 37 * MIN), `live kitchen count feeds the ETA (got ${out && out.etaAt})`);
}

{
  // Non-confirm transitions never stamp; explicit queueLen is honored.
  const seen = [];
  const db = mockOrdersDb([orderSeed({ status: 'confirmed', confirmed_at: iso(T0 - 10 * MIN), eta_at: iso(T0 + 25 * MIN) })], seen);
  const out = await updateOrderStatus(db, 'ord-1', 'ready');
  ok(out && out.confirmedAt === iso(T0 - 10 * MIN) && out.etaAt === iso(T0 + 25 * MIN), 'ready keeps original stamps');
  ok(!seen.some((s) => s.includes('SET confirmed_at')), 'no stamp UPDATE on non-confirm transitions');
  // Repeat confirm keeps the ORIGINAL instant (first-writer-wins).
  const out2 = await updateOrderStatus(db, 'ord-1', 'confirmed');
  ok(out2 && out2.confirmedAt === iso(T0 - 10 * MIN), 'repeat confirm preserves first stamp');
}

{
  // stampConfirmation unit checks: skips non-confirmed, null-safe.
  const db = mockOrdersDb([orderSeed()]);
  ok((await stampConfirmation(db, 'ord-1', { nowMs: T0 })) === null, 'no stamp while still new');
  ok((await stampConfirmation(null, 'ord-1')) === null, 'null db is null (never throws)');
  ok((await countActiveKitchenOrders({ prepare() { throw new Error('down'); } })) === 0, 'kitchen count fails open to 0');
}

// ---- 10. POST /api/track/received: 409 too_early vs flip ----
function mockKv(menu) {
  return {
    async get(k, opts) {
      if (k === 'menu') return opts && opts.type === 'json' ? menu : JSON.stringify(menu);
      return null;
    },
    async put() {},
  };
}
const recvReq = (number, t) => ({
  method: 'POST',
  url: 'https://shop.test/api/track/received',
  headers: new Headers({ 'Content-Type': 'application/json' }),
  text: async () => JSON.stringify({ number, t }),
});
const recvEnv = (db, menu) => ({ ORDERS_DB: db, MENU_KV: mockKv(menu), TELEGRAM_BOT_TOKEN: null });

{
  // Freshly confirmed + far-future ETA: locked.
  const db = mockOrdersDb([orderSeed({ status: 'confirmed', confirmed_at: iso(T0), eta_at: iso(T0 + 60 * MIN) })]);
  const r = await receivedOnRequest({ request: recvReq(1001, TOK), env: recvEnv(db, null) });
  ok(r.status === 409, 'fresh confirm is 409');
  const d = await r.json();
  ok(d.error === 'too_early' && d.status === 'confirmed' && typeof d.retryAfterSec === 'number' && d.retryAfterSec > 0, `too_early shape mirrors too_late + retryAfterSec (${JSON.stringify(d)})`);
  ok(db.rows[0].status === 'confirmed', 'locked tap flips nothing');
}

{
  // Legacy confirmed (old stamps, no eta): immediately receivable, flips.
  const db = mockOrdersDb([orderSeed({ status: 'confirmed', confirmed_at: iso(T0 - 60 * MIN), eta_at: null })]);
  const r = await receivedOnRequest({ request: recvReq(1001, TOK), env: recvEnv(db, null) });
  ok(r.status === 200, 'legacy confirmed flips (never trapped)');
  ok((await r.json()).status === 'completed' && db.rows[0].status === 'completed', 'atomic flip to completed');
}

{
  // Completed repeats answer idempotently; new orders + bad tokens stay 404.
  const db = mockOrdersDb([
    orderSeed({ status: 'completed' }),
    orderSeed({ id: 'ord-9', number: 1009, status: 'new' }),
  ]);
  const again = await receivedOnRequest({ request: recvReq(1001, TOK), env: recvEnv(db, null) });
  ok(again.status === 200 && (await again.json()).status === 'completed', 'completed repeats idempotently');
  const fresh = await receivedOnRequest({ request: recvReq(1009, TOK), env: recvEnv(db, null) });
  ok(fresh.status === 404, 'new order stays 404 (kitchen has not started)');
  const forged = await receivedOnRequest({ request: recvReq(1001, 'b'.repeat(32)), env: recvEnv(db, null) });
  ok(forged.status === 404, 'bad token is 404 (no oracle)');
}

// ---- 11. GET /api/track: etaAt + receivableAt ----
const trackReq = (number, t) => ({ method: 'GET', url: `https://shop.test/api/track?number=${number}&t=${t}`, headers: new Headers() });
const trackEnv = (db, menu) => ({ ORDERS_DB: db, MENU_KV: mockKv(menu) });

{
  const ordering = { receiveDelayDeliveryMin: 45, receiveDelayPickupMin: 10 };
  const db = mockOrdersDb([
    orderSeed({ status: 'confirmed', confirmed_at: iso(T0 - 10 * MIN), eta_at: iso(T0 + 30 * MIN) }),
    orderSeed({ id: 'ord-9', number: 1009, status: 'new' }),
    orderSeed({ id: 'ord-8', number: 1008, status: 'confirmed', confirmed_at: null, eta_at: null, created_at: iso(T0 - 120 * MIN) }),
  ]);
  const r = await trackOnRequest({ request: trackReq(1001, TOK), env: trackEnv(db, { settings: { ordering } }) });
  ok(r.status === 200, 'track 200 for valid pair');
  const d = await r.json();
  ok(d.etaAt === iso(T0 + 30 * MIN), 'track echoes stamped etaAt');
  // max(confirmed+45, eta): T0-10+45 = T0+35 beats the T0+30 eta.
  ok(d.receivableAt === iso(T0 + 35 * MIN), 'receivableAt = max(created+delay, eta) -> delay wins here');
  const n = await (await trackOnRequest({ request: trackReq(1009, TOK), env: trackEnv(db, { settings: { ordering } }) })).json();
  ok(n.etaAt === null && n.receivableAt === null, 'new order: both null');
  const leg = await (await trackOnRequest({ request: trackReq(1008, TOK), env: trackEnv(db, { settings: { ordering } }) })).json();
  ok(leg.etaAt === null && leg.receivableAt === iso(T0 - 75 * MIN), 'legacy confirmed: unlock from created+45 (custom delay honored)');
  const bad = await trackOnRequest({ request: trackReq(1001, 'b'.repeat(32)), env: trackEnv(mockOrdersDb([orderSeed({ status: 'confirmed' })]), null) });
  ok(bad.status === 404, 'bad token stays 404');
}

summary();
