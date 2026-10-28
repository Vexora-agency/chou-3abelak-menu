/* Launch-features scenarios: ordering-state logic + live pause/countdown + customer-data lifecycle.
 * Run: npx tsx scripts/test-launch-features.ts   (needs local server on :3000 with seeded test orders test-cd-9x) */
import { getOrderingState } from '../functions/_shared/status.js';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
};

const BASE: any = {
  timezone: 'Asia/Beirut', statusMode: 'auto', openTime: '12:00', closeTime: '00:00',
  workingDays: ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'],
  ordering: {
    enabled: true, types: ['delivery'], minOrder: 0, minOrderEnabled: false,
    deliveryFee: 0, deliveryFeeEnabled: false, note: { en: '', ar: '' },
    paused: false, pausedUntil: null, pausedAt: null,
    pausedMessage: { en: '', ar: '' }, acceptWhenClosed: false,
  },
};
const S = (over: any) => JSON.parse(JSON.stringify({ ...BASE, ...over, ordering: { ...BASE.ordering, ...(over.ordering || {}) } }));

// Fixed instants (UTC). 2026-10-27T20:00Z = 22:00 Beirut (UTC+2, DST off).
const T_OPEN = Date.UTC(2026, 9, 27, 20, 0); // 22:00 Beirut, inside 12:00-00:00
const T_MIDDAY = Date.UTC(2026, 9, 27, 10, 0); // 12:00 Beirut sharp

// 1. open by schedule
{
  const r: any = getOrderingState(S({}), T_OPEN);
  ok('open by schedule', r.state === 'open', r.state);
}
// 2. timed pause
{
  const until = new Date(T_OPEN + 30 * 60000).toISOString();
  const r: any = getOrderingState(S({ ordering: { paused: true, pausedUntil: until } }), T_OPEN);
  // NOTE: our API names the resume instant `reopensAt` (package calls it resumesAt).
  ok('timed pause + reopensAt', r.state === 'paused' && r.reopensAt === until, JSON.stringify({ s: r.state, r: r.reopensAt }));
}
// 3. indefinite pause
{
  const r: any = getOrderingState(S({ ordering: { paused: true, pausedUntil: null } }), T_OPEN);
  ok('indefinite pause (no reopensAt)', r.state === 'paused' && !r.reopensAt, JSON.stringify({ s: r.state, r: r.reopensAt }));
}
// 4. expired pause auto-resumes
{
  const r: any = getOrderingState(S({ ordering: { paused: true, pausedUntil: new Date(T_OPEN - 60000).toISOString() } }), T_OPEN);
  ok('expired pause resumes', r.state === 'open', r.state);
}
// 5. disabled
{
  const r: any = getOrderingState(S({ ordering: { enabled: false } }), T_OPEN);
  ok('disabled ordering', r.state === 'disabled', r.state);
}
// 6. closed by hours + reopensAt next day 12:00
{
  const r: any = getOrderingState(S({ openTime: '12:00', closeTime: '14:00' }), T_OPEN);
  ok('closed by hours', r.state === 'closed' && !!r.reopensAt, JSON.stringify({ s: r.state, r: r.reopensAt }));
}
// 7. overnight range open at 22:30, closed at midday
{
  const night = Date.UTC(2026, 9, 27, 20, 30);
  const ro: any = getOrderingState(S({ openTime: '22:00', closeTime: '04:00' }), night);
  const rc: any = getOrderingState(S({ openTime: '22:00', closeTime: '04:00' }), T_MIDDAY);
  ok('overnight open', ro.state === 'open', ro.state);
  ok('overnight closed at midday', rc.state === 'closed', rc.state);
}
// 8. working day excluded -> closed
{
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Beirut', weekday: 'short' }).format(new Date(T_OPEN)).toLowerCase().slice(0, 3);
  const days = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'].filter((d) => d !== wd);
  const r: any = getOrderingState(S({ workingDays: days }), T_OPEN);
  ok('excluded weekday closed', r.state === 'closed', `${r.state} (today=${wd})`);
}
// 9. custom paused message wins; default fallback otherwise
{
  const r: any = getOrderingState(S({ ordering: { paused: true, pausedUntil: null, pausedMessage: { en: 'Hi', ar: '' } } }), T_OPEN);
  ok('custom paused message', r.message.en === 'Hi' && !!r.message.ar, JSON.stringify(r.message));
  const d: any = getOrderingState(S({ ordering: { paused: true, pausedUntil: null } }), T_OPEN);
  ok('default paused message', !!d.message.en && !!d.message.ar, JSON.stringify(d.message));
}
// 10. acceptWhenClosed overrides closed hours
{
  const r: any = getOrderingState(S({ openTime: '12:00', closeTime: '14:00', ordering: { acceptWhenClosed: true } }), T_OPEN);
  ok('acceptWhenClosed overrides', r.state === 'open', r.state);
}

// ---- live API ----
const H = (tok: string) => ({ 'X-Requested-With': 'menu-admin', Origin: 'http://127.0.0.1:3000', Cookie: `__Host-admin-session=${tok}` });
async function login(): Promise<string> {
  const r = await fetch('http://127.0.0.1:3000/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'menu-admin', Origin: 'http://127.0.0.1:3000' },
    body: JSON.stringify({ username: 'admin', password: 'admin123', remember: false }),
  });
  const sc = r.headers.get('set-cookie') || '';
  const m = /__Host-admin-session=([^;]+)/.exec(sc);
  if (!r.ok || !m) throw new Error('login failed: ' + r.status);
  return m[1];
}
async function menuOrdering() {
  const m: any = await fetch('http://127.0.0.1:3000/api/menu').then((r) => r.json());
  return m.settings.ordering;
}
async function orderingState() {
  return fetch('http://127.0.0.1:3000/api/ordering-state').then((r) => r.json()) as Promise<any>;
}

const tok = await login();
console.log('PASS admin login');

// A. pause 30 min -> menu + ordering-state reflect immediately (cache purge)
{
  const before = Date.now();
  const pr: any = await fetch('http://127.0.0.1:3000/api/admin/ordering/pause', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...H(tok) }, body: JSON.stringify({ minutes: 30 }),
  }).then((r) => r.json());
  const o = await menuOrdering();
  const st = await orderingState();
  const delta = Date.parse(o.pausedUntil) - before;
  void pr;
  ok('pause 30: menu fresh immediately', o.paused === true && delta > 28 * 60000 && delta <= 31 * 60000, JSON.stringify({ p: o.paused, d: Math.round(delta / 60000) + 'min' }));
  ok('pause 30: ordering-state paused', st.state === 'paused', st.state);
  ok('pause 30: countdown target valid', !!st.reopensAt && Math.abs(Date.parse(st.reopensAt) - Date.parse(o.pausedUntil)) < 5000, st.reopensAt);
}

// B. resume -> flags cleared
{
  await fetch('http://127.0.0.1:3000/api/admin/ordering/pause', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...H(tok) }, body: JSON.stringify({ resume: true }),
  });
  const o = await menuOrdering();
  ok('resume clears flags', o.paused === false && o.pausedUntil === null, JSON.stringify({ p: o.paused, u: o.pausedUntil }));
}

// C. indefinite pause -> no resumesAt
{
  await fetch('http://127.0.0.1:3000/api/admin/ordering/pause', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...H(tok) }, body: JSON.stringify({ minutes: null }),
  });
  const st = await orderingState();
  ok('indefinite pause (no reopensAt)', st.state === 'paused' && !st.reopensAt, JSON.stringify({ s: st.state, r: st.reopensAt }));
  await fetch('http://127.0.0.1:3000/api/admin/ordering/pause', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...H(tok) }, body: JSON.stringify({ resume: true }),
  });
}

// D. customer lifecycle on seeded orders test-cd-91/92 (inserted separately)
{
  const q = '709991117';
  const s1: any = await fetch(`http://127.0.0.1:3000/api/admin/customer-data/search?phone=${q}`, { headers: H(tok) }).then((r) => r.json());
  ok('search masked result', s1.count === 1 && s1.results[0].name.includes('***') && s1.results[0].phone.includes('***'), JSON.stringify(s1.results[0] || null));
  const post = (body: any) => fetch('http://127.0.0.1:3000/api/admin/customer-data/action', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...H(tok) }, body: JSON.stringify(body),
  });
  const badPw = await post({ phone: q, mode: 'anonymize', password: 'wrong', confirm: 'DELETE' });
  ok('wrong password rejected', badPw.status === 403, String(badPw.status));
  const badWord = await post({ phone: q, mode: 'anonymize', password: 'admin123', confirm: 'WRONG' });
  ok('wrong confirm word rejected', badWord.status === 400, String(badWord.status));
  const an = await post({ phone: q, mode: 'anonymize', password: 'admin123', confirm: 'DELETE' }).then((r) => r.json());
  ok('anonymize ok', an.ok === true && an.count === 1, JSON.stringify(an));
  const s2: any = await fetch(`http://127.0.0.1:3000/api/admin/customer-data/search?phone=${q}`, { headers: H(tok) }).then((r) => r.json());
  ok('anonymized no longer searchable', s2.count === 0, JSON.stringify(s2));
  const ex = await post({ phone: '709991118', mode: 'export', password: 'admin123', confirm: 'DELETE' });
  const exBytes = new Uint8Array(await ex.arrayBuffer());
  // BOM lives in the raw bytes (decoders legitimately strip U+FEFF when decoding text).
  const hasBom = exBytes[0] === 0xef && exBytes[1] === 0xbb && exBytes[2] === 0xbf;
  ok('export CSV with BOM', ex.status === 200 && (ex.headers.get('content-type') || '').includes('text/csv') && hasBom, `status=${ex.status} bom=${hasBom}`);
  const del = await post({ phone: '709991118', mode: 'delete', password: 'admin123', confirm: 'DELETE' }).then((r) => r.json());
  ok('delete ok', del.ok === true && del.count === 1, JSON.stringify(del));
  const s3: any = await fetch(`http://127.0.0.1:3000/api/admin/customer-data/search?phone=709991118`, { headers: H(tok) }).then((r) => r.json());
  ok('deleted gone', s3.count === 0, JSON.stringify(s3));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
