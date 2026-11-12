// Feature tests: pause/closed blocking, location sharing,
// ordering-state + pause endpoints. Pure split of test-features.mjs.
// Run: node scripts/test-features-orders.mjs
import { validateOrderInput } from '../functions/_shared/orders.js';
import { validateMenu } from '../functions/_shared/validate.js';
import { onRequest as ordersReq } from '../functions/api/orders.js';
import { onRequest as stateReq } from '../functions/api/ordering-state.js';
import { onRequest as pauseReq } from '../functions/api/admin/ordering/pause.js';
import { createAsserts, makeKV, makeReq, readJson } from './_helpers/shared.mjs';
import { makeDB, MENU, orderBody } from './_helpers/features-cases.mjs';

const { ok, summary } = createAsserts();
const req = makeReq;
const json = readJson;

/* ---------------- 1. location validation ---------------- */
{
  const m = JSON.parse(JSON.stringify(MENU));
  const good = validateOrderInput(orderBody({ location: { lat: 33.89352, lng: 35.50161, accuracy: 25 } }), m);
  ok(good.ok && good.cleaned.location && good.cleaned.location.lat === 33.89352, 'valid location accepted + kept');
  ok(validateOrderInput(orderBody({ location: { lat: 91, lng: 0 } }), m).errors.includes('invalid_location'), 'lat > 90 rejected');
  ok(validateOrderInput(orderBody({ location: { lat: 0, lng: -181 } }), m).errors.includes('invalid_location'), 'lng < -180 rejected');
  ok(validateOrderInput(orderBody({ location: { lat: NaN, lng: 0 } }), m).errors.includes('invalid_location'), 'NaN rejected');
  const rounded = validateOrderInput(orderBody({ location: { lat: 33.8935249, lng: 35.5016151 } }), m);
  ok(rounded.ok && rounded.cleaned.location.lat === 33.89352 && rounded.cleaned.location.lng === 35.50162, 'rounded to 5 decimals');
  const pickup = validateOrderInput(orderBody({ type: 'pickup', location: { lat: 10, lng: 10 } }), { ...m, settings: { ...m.settings, ordering: { ...m.settings.ordering, types: ['delivery', 'pickup'] } } });
  ok(pickup.ok && pickup.cleaned.location === null, 'location ignored for non-delivery');
  const pickupNoPin = validateOrderInput(orderBody({ type: 'pickup' }), { ...m, settings: { ...m.settings, ordering: { ...m.settings.ordering, types: ['delivery', 'pickup'] } } });
  ok(pickupNoPin.ok === true, 'pickup needs no pin');
  // Delivery pin is OPTIONAL (manual addresses allowed): absent/null pass
  // with a null location (address-only order); present-but-malformed
  // locations still fail closed.
  const noPin = validateOrderInput(orderBody(), m);
  ok(noPin.ok === true && noPin.cleaned.location === null, 'absent location allowed (address-only)');
  ok(validateOrderInput(orderBody({ location: null }), m).ok === true, 'null location allowed (address-only)');
  ok(validateOrderInput(orderBody({ location: 'Beirut' }), m).errors.includes('invalid_location'), 'non-object location rejected');
  const withPin = validateOrderInput(orderBody({ location: { lat: 33.9, lng: 35.5, accuracy: 30 } }), m);
  ok(withPin.ok === true && withPin.cleaned.phoneNorm === '70123456', 'phone_norm filled');
}

/* ---------------- 2. POST /api/orders gating + insert ---------------- */
async function postOrder(env, body) {
  const res = await ordersReq({
    request: req('POST', 'https://x/api/orders', { headers: { 'Content-Type': 'application/json', Origin: 'https://x' }, body: JSON.stringify(body) }),
    env,
  });
  return { status: res.status, data: await json(res) };
}
{
  // paused -> 403, nothing recorded
  const kv = makeKV();
  await kv.put('menu', JSON.stringify({ ...MENU, settings: { ...MENU.settings, ordering: { ...MENU.settings.ordering, paused: true } } }));
  const db = makeDB([]);
  const r = await postOrder({ MENU_KV: kv, ORDERS_DB: db }, orderBody());
  ok(r.status === 403 && r.data.error === 'paused' && r.data.message && r.data.message.en.length > 0, 'POST 403 when paused with message');
  ok(db.orders.length === 0, 'paused order not recorded');
  // disabled -> 403 disabled
  const kv2 = makeKV();
  await kv2.put('menu', JSON.stringify({ ...MENU, settings: { ...MENU.settings.ordering, enabled: false } }));
  const r2 = await postOrder({ MENU_KV: kv2, ORDERS_DB: makeDB([]) }, orderBody());
  ok(r2.status === 403 && r2.data.error === 'disabled', 'POST 403 when disabled');
  // closed (statusMode) -> 403 closed
  const kv3 = makeKV();
  await kv3.put('menu', JSON.stringify({ ...MENU, settings: { ...MENU.settings, statusMode: 'closed' } }));
  const r3 = await postOrder({ MENU_KV: kv3, ORDERS_DB: makeDB([]) }, orderBody());
  ok(r3.status === 403 && r3.data.error === 'closed', 'POST 403 when closed');
  // open -> 200 with location + phone_norm stored
  const kv4 = makeKV();
  await kv4.put('menu', JSON.stringify(MENU));
  const db4 = makeDB([]);
  const r4 = await postOrder({ MENU_KV: kv4, ORDERS_DB: db4 }, orderBody({ location: { lat: 33.9, lng: 35.5, accuracy: 30 } }));
  if (r4.status !== 200) console.log('DBG open:', r4.status, JSON.stringify(r4.data));
  ok(r4.status === 200 && db4.orders.length === 1, 'open order recorded');
  ok(db4.orders[0].location_lat === 33.9 && db4.orders[0].location_lng === 35.5 && db4.orders[0].phone_norm === '70123456', 'location + phone_norm stored');
  // invalid location -> 400, nothing stored
  const r5 = await postOrder({ MENU_KV: kv4, ORDERS_DB: db4 }, orderBody({ location: { lat: 200, lng: 0 } }));
  ok(r5.status === 400 && db4.orders.length === 1, 'invalid location rejected');
}

/* ---------------- 2c. atomic spam cap (15/10min/IP, D1 UPSERT) ---------------- */
{
  const pin = { lat: 33.9, lng: 35.5, accuracy: 30 };
  const freshEnv = () => {
    const kv = makeKV();
    return { kv, db: makeDB([]), ready: kv.put('menu', JSON.stringify(MENU)) };
  };
  // 15 distinct orders pass, the 16th is capped — sequentially.
  // Distinct phones per order: the per-phone daily cap (3/day, migration
  // 0032) would otherwise fire before the IP cap under test here.
  {
    const { kv, db, ready } = freshEnv();
    await ready;
    const statuses = [];
    for (let i = 0; i < 16; i++) {
      const r = await postOrder({ MENU_KV: kv, ORDERS_DB: db }, orderBody({ customer: { name: 'John', phone: `78${100000 + i}`, address: 'Hamra' }, location: pin, idemKey: `seq-${i}` }));
      statuses.push(r.status);
    }
    ok(statuses.slice(0, 15).every((s) => s === 200), 'first 15 distinct orders accepted');
    ok(statuses[15] === 429, '16th distinct order rate_limited');
    ok(db.orders.length === 15, 'exactly 15 rows stored');
  }
  // Parallel burst (30 at once): the atomic reserve holds the cap exactly.
  {
    const { kv, db, ready } = freshEnv();
    await ready;
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => postOrder({ MENU_KV: kv, ORDERS_DB: db }, orderBody({ customer: { name: 'John', phone: `78${200000 + i}`, address: 'Hamra' }, location: pin, idemKey: `burst-${i}` })))
    );
    const okCount = results.filter((r) => r.status === 200).length;
    const limitedCount = results.filter((r) => r.status === 429).length;
    ok(okCount === 15 && limitedCount === 15, `parallel burst capped exactly (200x${okCount}, 429x${limitedCount})`);
    ok(db.orders.length === 15, 'burst stores exactly 15 rows');
  }
  // Same-key retries are free: 20 repeats, one row, budget untouched.
  {
    const { kv, db, ready } = freshEnv();
    await ready;
    const body = orderBody({ location: pin, idemKey: 'retry-same' });
    const results = [];
    for (let i = 0; i < 20; i++) results.push(await postOrder({ MENU_KV: kv, ORDERS_DB: db }, body));
    ok(results.every((r) => r.status === 200), '20 same-key retries all accepted');
    ok(db.orders.length === 1, 'retry stores a single row');
    ok(results.every((r) => r.data.orderNumber === results[0].data.orderNumber), 'retries return the original number');
  }
  // Rejected bodies (400) consume no budget: 15 still pass afterwards.
  {
    const { kv, db, ready } = freshEnv();
    await ready;
    const env = { MENU_KV: kv, ORDERS_DB: db };
    const bad = await postOrder(env, orderBody({ location: { lat: 200, lng: 0 }, idemKey: 'bad-1' }));
    ok(bad.status === 400, 'invalid body rejected');
    const statuses = [];
    for (let i = 0; i < 15; i++) {
      statuses.push((await postOrder(env, orderBody({ customer: { name: 'John', phone: `78${300000 + i}`, address: 'Hamra' }, location: pin, idemKey: `after-bad-${i}` }))).status);
    }
    ok(statuses.every((s) => s === 200), '400s consumed no budget');
  }
  // D1 failure on the counter fails OPEN (dinner orders survive a blip).
  {
    const { kv, db, ready } = freshEnv();
    await ready;
    const basePrepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      if (typeof sql === 'string' && sql.includes('rate_counters')) {
        return { bind: () => ({ first: async () => { throw new Error('d1 down'); }, all: async () => { throw new Error('d1 down'); }, run: async () => { throw new Error('d1 down'); } }) };
      }
      return basePrepare(sql);
    };
    const r = await postOrder({ MENU_KV: kv, ORDERS_DB: db }, orderBody({ location: pin, idemKey: 'failopen-1' }));
    ok(r.status === 200 && db.orders.length === 1, 'counter failure fails open, order recorded');
  }
}

/* ---------------- 2b. badged-spicy REQUIRES a heat degree ---------------- */
{
  // A badged-spicy item forces one heat pick on the customer sheet, and
  // the server rejects heatless (or partially heated) badged lines with
  // heat_required — never silently drops. Unbadged items keep heat
  // optional, exactly as before.
  const spicyMenu = JSON.parse(JSON.stringify(MENU));
  spicyMenu.settings.featureGroups = [
    { id: 'spicy', name: { en: 'Make it Spicy', ar: 'خليه حار' }, selection: 'single', prompt: { en: '', ar: '' } },
  ];
  spicyMenu.settings.featureDefs = [
    { id: 'spicy-mild', groupId: 'spicy', name: { en: 'Mild', ar: 'خفيف' } },
    { id: 'spicy-medium', groupId: 'spicy', name: { en: 'Medium', ar: 'متوسط' } },
    { id: 'spicy-hot', groupId: 'spicy', name: { en: 'Extra Hot', ar: 'حار جداً' } },
  ];
  const shish = (badges) => ({
    id: 'shish', categoryId: 'c1', name: { en: 'Shish', ar: 'شيش' }, description: { en: '', ar: '' },
    pricing: { unit: 'pc', minQty: 1, step: 1, maxQty: 50, showUnit: false, price: 100000 },
    addons: [{ featureId: 'spicy-mild', price: 0 }, { featureId: 'spicy-medium', price: 0 }, { featureId: 'spicy-hot', price: 0 }],
    badges, featured: false, available: true,
  });
  const pin = { lat: 33.9, lng: 35.5, accuracy: 30 };
  // Badged: exactly one heat level accepted AND kept (kitchen sees it).
  {
    const m = { ...spicyMenu, items: [shish(['spicy'])] };
    const kv = makeKV();
    await kv.put('menu', JSON.stringify(m));
    const db = makeDB([]);
    const r = await postOrder(
      { MENU_KV: kv, ORDERS_DB: db },
      orderBody({ location: pin, items: [{ id: 'shish', qty: 1, addonIds: ['spicy-medium'] }] }),
    );
    ok(r.status === 200, 'badged-spicy order with heat level accepted');
    const stored = JSON.parse(db.orders[0].items_json);
    ok(Array.isArray(stored) && stored.length === 1 && Array.isArray(stored[0].addonIds) && stored[0].addonIds.includes('spicy-medium'), 'heat level kept on badged line');
  }
  // Badged: split degrees across units accepted when fully covered.
  {
    const m = { ...spicyMenu, items: [shish(['spicy'])] };
    const kv = makeKV();
    await kv.put('menu', JSON.stringify(m));
    const db = makeDB([]);
    const r = await postOrder(
      { MENU_KV: kv, ORDERS_DB: db },
      orderBody({ location: pin, items: [{ id: 'shish', qty: 2, addonIds: ['spicy-medium', 'spicy-hot'], addonQty: { 'spicy-medium': 1, 'spicy-hot': 1 } }] }),
    );
    ok(r.status === 200, 'badged-spicy fully covered split accepted');
    const stored = JSON.parse(db.orders[0].items_json);
    ok(stored[0].addonQty && stored[0].addonQty['spicy-medium'] === 1 && stored[0].addonQty['spicy-hot'] === 1, 'split heat kept on badged line');
  }
  // Badged: heatless line rejected.
  {
    const m = { ...spicyMenu, items: [shish(['spicy'])] };
    const kv = makeKV();
    await kv.put('menu', JSON.stringify(m));
    const db = makeDB([]);
    const r = await postOrder(
      { MENU_KV: kv, ORDERS_DB: db },
      orderBody({ location: pin, items: [{ id: 'shish', qty: 1 }] }),
    );
    ok(r.status === 400 && r.data.error === 'heat_required' && db.orders.length === 0, 'badged-spicy heatless line rejected with heat_required');
  }
  // Badged: partial split (one of two units heatless) rejected.
  {
    const m = { ...spicyMenu, items: [shish(['spicy'])] };
    const kv = makeKV();
    await kv.put('menu', JSON.stringify(m));
    const db = makeDB([]);
    const r = await postOrder(
      { MENU_KV: kv, ORDERS_DB: db },
      orderBody({ location: pin, items: [{ id: 'shish', qty: 2, addonIds: ['spicy-medium'], addonQty: { 'spicy-medium': 1 } }] }),
    );
    ok(r.status === 400 && r.data.error === 'heat_required' && db.orders.length === 0, 'badged-spicy partial heat rejected');
  }
  // Badged: two full levels on one unit rejected (double cover).
  {
    const m = { ...spicyMenu, items: [shish(['spicy'])] };
    const kv = makeKV();
    await kv.put('menu', JSON.stringify(m));
    const db = makeDB([]);
    const r = await postOrder(
      { MENU_KV: kv, ORDERS_DB: db },
      orderBody({ location: pin, items: [{ id: 'shish', qty: 1, addonIds: ['spicy-medium', 'spicy-hot'] }] }),
    );
    ok(r.status === 400 && r.data.error === 'heat_required' && db.orders.length === 0, 'badged-spicy double heat rejected');
  }
  // Control: unbadged item without heat still accepted (optional as before).
  {
    const m = { ...spicyMenu, items: [shish([])] };
    const kv = makeKV();
    await kv.put('menu', JSON.stringify(m));
    const db = makeDB([]);
    const r = await postOrder(
      { MENU_KV: kv, ORDERS_DB: db },
      orderBody({ location: pin, items: [{ id: 'shish', qty: 1 }] }),
    );
    ok(r.status === 200, 'unbadged heatless order still accepted');
  }
}

/* ---------------- 2c. noHeat opt-out: no offer, tamper-proof, save gate ---------------- */
{
  // A drink-style item: customizable (has add-ons) but heat makes no sense.
  const pin = { lat: 33.9, lng: 35.5, accuracy: 30 };
  const heatLib = {
    settings: {
      ...(MENU.settings || {}),
      featureGroups: [
        { id: 'spicy', name: { en: 'Make it Spicy', ar: 'خليه حار' }, selection: 'single', prompt: { en: '', ar: '' } },
        { id: 'choice', name: { en: 'Choice', ar: 'الاختيار' }, selection: 'single', prompt: { en: 'Pick one', ar: 'اختار' } },
      ],
      featureDefs: [
        { id: 'spicy-mild', groupId: 'spicy', name: { en: 'Mild', ar: 'خفيف' } },
        { id: 'spicy-medium', groupId: 'spicy', name: { en: 'Medium', ar: 'متوسط' } },
        { id: 'spicy-hot', groupId: 'spicy', name: { en: 'Extra Hot', ar: 'حار جداً' } },
        { id: 'regular', groupId: 'choice', name: { en: 'Regular', ar: 'عادي' } },
      ],
    },
  };
  const cola = () => ({
    id: 'cola', categoryId: 'c1', name: { en: 'Cola', ar: 'كولا' }, description: { en: '', ar: '' },
    pricing: { unit: 'pc', minQty: 1, step: 1, maxQty: 50, showUnit: false, price: 150 },
    badges: [], featured: false, available: true, noHeat: true,
    addons: [{ featureId: 'regular', price: 0 }],
  });
  const m = { ...MENU, ...heatLib, items: [cola()] };
  // Heatless order accepted; the stored line carries no heat.
  {
    const kv = makeKV();
    await kv.put('menu', JSON.stringify(m));
    const db = makeDB([]);
    const r = await postOrder(
      { MENU_KV: kv, ORDERS_DB: db },
      orderBody({ location: pin, items: [{ id: 'cola', qty: 1 }] }),
    );
    ok(r.status === 200, 'noHeat heatless order accepted');
    const stored = JSON.parse(db.orders[0].items_json);
    ok(Array.isArray(stored) && stored.length === 1 && !stored[0].addonIds, 'noHeat stored line has no heat');
  }
  // A tampered heat id is an unknown add-on after normalize strips/injects
  // nothing — rejected, nothing stored.
  {
    const kv = makeKV();
    await kv.put('menu', JSON.stringify(m));
    const db = makeDB([]);
    const r = await postOrder(
      { MENU_KV: kv, ORDERS_DB: db },
      orderBody({ location: pin, idemKey: 'noheat-tamper', items: [{ id: 'cola', qty: 1, addonIds: ['spicy-medium'] }] }),
    );
    ok(r.status === 400 && db.orders.length === 0, 'tampered heat on noHeat item rejected');
  }
  // Save gate: Spicy badge + noHeat is contradictory (heat would be both
  // required and impossible) — rejected instead of saved.
  {
    const bad = JSON.parse(JSON.stringify(MENU));
    bad.settings = heatLib.settings;
    bad.items = [{ ...cola(), id: 'colax', badges: ['spicy'] }];
    const v = validateMenu(bad);
    ok(v.ok === false && v.errors.some((e) => String(e).includes('no-heat')), 'spicy badge + noHeat rejected at save');
  }
  // Save gate: lone noHeat survives validation untouched.
  {
    const good = JSON.parse(JSON.stringify(MENU));
    good.settings = heatLib.settings;
    good.items = [cola()];
    const v = validateMenu(good);
    ok(v.ok === true && v.value.items[0].noHeat === true, 'lone noHeat preserved at save');
  }
  // Save strips stored heat rows on noHeat items (the section X removed
  // them) — re-imports and manual edits cannot resurrect them.
  {
    const doc = JSON.parse(JSON.stringify(MENU));
    doc.settings = heatLib.settings;
    doc.items = [{ ...cola(), id: 'colax', addons: [{ featureId: 'regular', price: 0 }, { featureId: 'spicy-medium', price: 0 }] }];
    const v = validateMenu(doc);
    const rows = (v.value && v.value.items[0] && v.value.items[0].addons) || [];
    ok(v.ok === true && rows.length === 1 && rows[0].featureId === 'regular', 'stored heat rows stripped on noHeat save');
  }
}

/* ---------------- 3. ordering-state + pause endpoints ---------------- */
{
  const kv = makeKV();
  await kv.put('menu', JSON.stringify(MENU));
  const res = await stateReq({ request: req('GET', 'https://x/api/ordering-state'), env: { MENU_KV: kv } });
  const d = await json(res);
  ok(res.status === 200 && d.state === 'open' && typeof d.serverTime === 'string', 'ordering-state open shape');
  const kv2 = makeKV();
  await kv2.put('menu', JSON.stringify({ ...MENU, settings: { ...MENU.settings, ordering: { ...MENU.settings.ordering, paused: true, pausedUntil: null } } }));
  const res2 = await stateReq({ request: req('GET', 'https://x/api/ordering-state'), env: { MENU_KV: kv2 } });
  const d2 = await json(res2);
  ok(d2.state === 'paused' && d2.message.en.length > 0 && !d2.reopensAt, 'ordering-state paused indefinite');
  // pause endpoint validation
  const bad = await pauseReq({ request: req('POST', 'https://x/api/admin/ordering/pause', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minutes: 45 }) }), env: { MENU_KV: kv } });
  ok(bad.status === 400, 'pause rejects bad minutes');
  const p1 = await pauseReq({ request: req('POST', 'https://x/api/admin/ordering/pause', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minutes: 30 }) }), env: { MENU_KV: kv } });
  const p1d = await json(p1);
  ok(p1.status === 200 && p1d.ok && p1d.paused === true && typeof p1d.pausedUntil === 'string', 'pause 30m works');
  const afterPause = await kv.get('menu', { type: 'json' });
  ok(afterPause.settings.ordering.paused === true && afterPause.version === 4, 'only pause fields change + version bump');
  const pr = await pauseReq({ request: req('POST', 'https://x/api/admin/ordering/pause', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resume: true }) }), env: { MENU_KV: kv } });
  const prd = await json(pr);
  ok(prd.ok && prd.paused === false && prd.pausedUntil === null, 'resume clears pause');
}

summary();
