// WhatsApp Cloud API unit tests (no infra; fetch stubbed).
// Usage: node scripts/test-whatsapp-api.mjs
import {
  WA_API_VERSION,
  sanitizeWaConfig,
  isCompleteConfig,
  toApiPhone,
  itemsSummary,
  buildOwnerParams,
  templatePayload,
  sendTemplate,
  checkCap,
  incrCap,
  waDayKey,
} from '../functions/_shared/whatsapp-api.js';

let fails = 0;
const check = (name, cond, extra = '') => {
  if (!cond) { fails++; console.error(`  FAIL ${name} ${extra}`); }
  else console.log(`  ok ${name}`);
};

// ---- config sanitize ----
{
  const full = {
    enabled: true, phoneNumberId: '123456789012345', ownerRecipient: '96170123456',
    ownerTemplate: 'order_received', customerTemplate: 'order_confirmed',
    customerUpdates: true, dailyCap: 200,
  };
  const r = sanitizeWaConfig(full);
  check('complete config passes', r.errors.length === 0 && isCompleteConfig(r.config));
  const miss = sanitizeWaConfig({ enabled: true });
  check('enabled+empty errors', miss.errors.length >= 3 && !isCompleteConfig(miss.config), miss.errors.join('|'));
  const badT = sanitizeWaConfig({ enabled: true, phoneNumberId: '1', ownerRecipient: '96170', ownerTemplate: 'Bad Name!' });
  check('bad template name rejected', badT.errors.some((e) => e.includes('ownerTemplate')));
  const off = sanitizeWaConfig({});
  check('disabled is incomplete but error-free', off.errors.length === 0 && !isCompleteConfig(off.config) && off.config.dailyCap === 100);
  const cap = sanitizeWaConfig({ dailyCap: 99999 });
  check('cap falls back on absurd', cap.config.dailyCap === 100);
}

// ---- phones ----
{
  check('local gets cc', toApiPhone('70123456') === '96170123456');
  check('intl kept', toApiPhone('96170123456') === '96170123456');
  check('other-intl kept', toApiPhone('14155552671') === '14155552671');
  check('empty safe', toApiPhone('abc') === '');
}

// ---- summary + params ----
{
  const items = [
    { id: 'a', qty: 2, name: { en: 'Sujuk', ar: 'سجق' }, variantName: { en: 'Regular', ar: 'عادي' } },
    { id: 'b', qty: 1, name: { en: 'Juice', ar: 'عصير' } },
  ];
  const s = itemsSummary(items);
  check('summary shape', s.includes('2 أصناف') && s.includes('(5 قطع)') === false && s.includes('سجق (عادي) ×2'), s);
  const long = itemsSummary(Array.from({ length: 30 }, (_, i) => ({ id: `${i}`, qty: 1, name: { ar: `صنف طويل الاسم جدا رقم ${i}` } })));
  check('summary capped', long.length <= 150 && long.endsWith('…'));
  const p = buildOwnerParams({ number: 1013, items, total: 430000, currency: 'LBP', name: 'Mina', phone: '96170' });
  check('owner 5 params', p.length === 5 && p[0] === '1013' && p[2] === '430,000 LBP');
}

// ---- payload + send (stubbed fetch) ----
{
  const seen = {};
  globalThis.fetch = async (url, init) => {
    seen.url = url;
    seen.init = init;
    return { ok: true, json: async () => ({ messages: [{ id: 'wamid.X' }] }) };
  };
  const r = await sendTemplate({ token: 'TOK', phoneNumberId: 'PNID', to: '96170', templateName: 'order_received', params: ['a', 'b'] });
  check('send ok + id', r.ok === true && r.id === 'wamid.X');
  check('version pinned', seen.url === `https://graph.facebook.com/${WA_API_VERSION}/PNID/messages`, seen.url);
  check('bearer auth', seen.init.headers.Authorization === 'Bearer TOK');
  const body = JSON.parse(seen.init.body);
  check('template body', body.messaging_product === 'whatsapp' && body.type === 'template' && body.template.name === 'order_received' && body.template.language.code === 'ar' && body.template.components[0].parameters.length === 2);

  globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: '(#132000) bad param' } }) });
  const bad = await sendTemplate({ token: 'T', phoneNumberId: 'P', to: '1', templateName: 'x', params: [] });
  check('meta error surfaced', bad.ok === false && bad.error.includes('#132000'), bad.error);

  globalThis.fetch = async () => { throw new Error('down'); };
  let threw = false;
  try { await sendTemplate({ token: 'T', phoneNumberId: 'P', to: '1', templateName: 'x', params: [] }); }
  catch { threw = true; }
  check('transport collapse throws (caller handles)', threw === true);
  delete globalThis.fetch;
}

// ---- cap (fake KV) ----
{
  const store = {};
  const kv = {
    get: async (k) => (k in store ? store[k] : null),
    put: async (k, v) => { store[k] = v; },
  };
  check('fresh allowed', (await checkCap(kv, 2)).allowed === true);
  await incrCap(kv);
  await incrCap(kv);
  const c = await checkCap(kv, 2);
  check('cap blocks at limit', c.allowed === false && c.used === 2);
  check('day key shape', waDayKey(new Date('2026-10-30T12:00:00Z')) === 'waapi:day:2026-10-30');
  check('null kv fail-open', (await checkCap(null, 1)).allowed === true);
}

// ---- templatePayload export sanity ----
{
  const p = templatePayload({ to: '1', templateName: 't', params: ['x'] });
  check('default lang ar', p.template.language.code === 'ar');
}

console.log(fails ? `\n${fails} FAILED` : '\nall green');
if (fails) process.exit(1);
