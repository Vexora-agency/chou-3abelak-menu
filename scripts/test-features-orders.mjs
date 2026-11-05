// Feature tests: pause/closed blocking, location sharing,
// ordering-state + pause endpoints. Pure split of test-features.mjs.
// Run: node scripts/test-features-orders.mjs
import { validateOrderInput } from '../functions/_shared/orders.js';
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
  // Delivery REQUIRES a freshly picked pin every order (pins are never
  // remembered): absent/null/non-object locations fail closed.
  const noPin = validateOrderInput(orderBody(), m);
  ok(noPin.ok === false && noPin.errors.includes('invalid_location') && noPin.cleaned === null, 'absent location rejected for delivery');
  ok(validateOrderInput(orderBody({ location: null }), m).errors.includes('invalid_location'), 'null location rejected');
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

/* ---------------- 2b. badged-spicy strips heat levels ---------------- */
{
  // A badged-spicy item IS the heat (sheet hides the slider, admin editor
  // blocks new attaches): a stale/tampered line carrying a heat level must
  // still record clean — dropped, never rejected.
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
  // Badged: heat level stripped, order accepted.
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
    ok(Array.isArray(stored) && stored.length === 1 && stored[0].addonIds === undefined && stored[0].addonNames === undefined, 'heat level stripped from badged line');
  }
  // Badged + split counts: stripped too, nothing stored.
  {
    const m = { ...spicyMenu, items: [shish(['spicy'])] };
    const kv = makeKV();
    await kv.put('menu', JSON.stringify(m));
    const db = makeDB([]);
    const r = await postOrder(
      { MENU_KV: kv, ORDERS_DB: db },
      orderBody({ location: pin, items: [{ id: 'shish', qty: 2, addonIds: ['spicy-medium'], addonQty: { 'spicy-medium': 1 } }] }),
    );
    ok(r.status === 200, 'badged-spicy split heat accepted');
    const stored = JSON.parse(db.orders[0].items_json);
    ok(stored[0].addonIds === undefined && stored[0].addonQty === undefined, 'split heat stripped from badged line');
  }
  // Control: unbadged item keeps its picked level.
  {
    const m = { ...spicyMenu, items: [shish([])] };
    const kv = makeKV();
    await kv.put('menu', JSON.stringify(m));
    const db = makeDB([]);
    const r = await postOrder(
      { MENU_KV: kv, ORDERS_DB: db },
      orderBody({ location: pin, items: [{ id: 'shish', qty: 1, addonIds: ['spicy-medium'] }] }),
    );
    ok(r.status === 200, 'unbadged order with heat level accepted');
    const stored = JSON.parse(db.orders[0].items_json);
    ok(Array.isArray(stored[0].addonIds) && stored[0].addonIds.includes('spicy-medium'), 'heat level kept without badge');
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
