// Unit tests for the ordering state machine (DST-safe, business timezone)
// and the new validator fields (pause, announcement, privacy).
// Run: npx tsx scripts/test-status.mjs (tsx: src/utils imports use the @
// alias, which plain node cannot resolve).
import { getOrderingState } from '../functions/_shared/status.js';
import { validateMenu } from '../functions/_shared/validate.js';
import { applyDraftPause, isPollStale, pollIntervalMs, resolveLiveOrdering } from '../src/utils/ordering.ts';
import { formatHMS, formatMMSS } from '../src/utils/countdown.ts';

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

const TZ = 'Asia/Beirut';
// Beirut wall -> UTC ms helper (same algorithm as the implementation).
function off(tz, utc) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(utc)).map((x) => [x.type, x.value])
  );
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second) - utc) / 60000);
}
function wall(tz, y, mo, d, h, mi) {
  const w = Date.UTC(y, mo - 1, d, h, mi, 0);
  let g = w;
  for (let i = 0; i < 2; i++) g = w - off(tz, g) * 60000;
  return g;
}
const base = () => ({
  timezone: TZ,
  statusMode: 'auto',
  openTime: '12:00',
  closeTime: '00:00',
  workingDays: ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'],
  ordering: { enabled: true, acceptWhenClosed: false, paused: false, pausedUntil: null, pausedMessage: { en: '', ar: '' } },
});

/* ---------------- states ---------------- */
{
  ok(getOrderingState({ ordering: { enabled: false } }, 0).state === 'disabled', 'disabled when ordering off');
  // Monday Oct 26 2026 15:00 Beirut (UTC+2 in Oct? DST until Oct 25 -> +2) => open
  const monOpen = wall(TZ, 2026, 10, 26, 15, 0);
  ok(getOrderingState(base(), monOpen).state === 'open', 'open in hours');
  // 03:00 at night => closed (overnight close 00:00)
  const night = wall(TZ, 2026, 10, 26, 3, 0);
  const st = getOrderingState(base(), night);
  ok(st.state === 'closed' && typeof st.reopensAt === 'string', `closed at night + reopensAt (${st.state})`);
  ok(st.message.en.includes('We open at'), 'closed message has time');
  // overnight range 22:00-04:00: 02:00 open, 05:00 closed
  const s = base();
  s.openTime = '22:00';
  s.closeTime = '04:00';
  ok(getOrderingState(s, wall(TZ, 2026, 10, 26, 2, 0)).state === 'open', 'overnight open at 02:00');
  ok(getOrderingState(s, wall(TZ, 2026, 10, 26, 5, 0)).state === 'closed', 'overnight closed at 05:00');
  ok(getOrderingState(s, wall(TZ, 2026, 10, 26, 23, 0)).state === 'open', 'overnight open at 23:00');
  // midnight close 00:00 means midnight, not 24h: 23:30 open, 00:30 closed
  const m = base();
  m.openTime = '12:00';
  m.closeTime = '00:00';
  ok(getOrderingState(m, wall(TZ, 2026, 10, 26, 23, 30)).state === 'open', 'open before midnight close');
  ok(getOrderingState(m, wall(TZ, 2026, 10, 27, 0, 30)).state === 'closed', 'closed after midnight');
  // statusMode overrides
  const o = base();
  o.statusMode = 'open';
  ok(getOrderingState(o, night).state === 'open', 'statusMode open overrides hours');
  const c = base();
  c.statusMode = 'closed';
  const cs = getOrderingState(c, monOpen);
  ok(cs.state === 'closed' && cs.reopensAt === undefined, 'statusMode closed has no reopensAt');
  // working day off
  const w = base();
  w.workingDays = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu'];
  ok(getOrderingState(w, wall(TZ, 2026, 10, 30, 15, 0)).state === 'closed', 'friday off is closed');
  // DST day (Mar 29 2026, clocks jump 00:00->01:00... Beirut springs forward Mar 29): noon open
  ok(getOrderingState(base(), wall(TZ, 2026, 3, 29, 12, 0)).state === 'open', 'open on DST spring day');
  ok(getOrderingState(base(), wall(TZ, 2026, 10, 25, 12, 0)).state === 'open', 'open on DST fall day');
  // paused indefinitely + timed + expired + custom message
  const p = base();
  p.ordering.paused = true;
  const ps = getOrderingState(p, monOpen);
  ok(ps.state === 'paused' && ps.reopensAt === undefined, 'paused indefinitely');
  ok(ps.message.en.startsWith('We are not taking orders'), 'paused default EN');
  ok(ps.message.ar.length > 0, 'paused default AR');
  const pt = base();
  pt.ordering.paused = true;
  pt.ordering.pausedUntil = new Date(monOpen + 3600e3).toISOString();
  const pts = getOrderingState(pt, monOpen);
  ok(pts.state === 'paused' && pts.reopensAt === new Date(monOpen + 3600e3).toISOString(), 'paused with reopensAt');
  const pe = base();
  pe.ordering.paused = true;
  pe.ordering.pausedUntil = new Date(monOpen - 1000).toISOString();
  ok(getOrderingState(pe, monOpen).state === 'open', 'expired pause auto-resumes');
  const sh = base();
  sh.ordering.paused = false;
  sh.ordering.pausedUntil = new Date(monOpen + 3600e3).toISOString();
  ok(getOrderingState(sh, monOpen).state === 'open', 'stale pausedUntil ignored when not paused');
  // Settings-draft pause coherence: no stale or fake resume times.
  const dp = applyDraftPause({ paused: false, pausedUntil: '2026-10-28T21:18:18.798Z', pausedAt: '2026-10-28T20:18:18.798Z' }, true, '2026-10-28T21:05:00.000Z');
  ok(dp.paused === true && dp.pausedUntil === null && dp.pausedAt === '2026-10-28T21:05:00.000Z', 'draft pause stamps fresh start, no deadline');
  const dr = applyDraftPause({ paused: true, pausedUntil: '2026-10-28T21:18:18.798Z', pausedAt: '2026-10-28T20:18:18.798Z' }, false, '2026-10-28T21:05:00.000Z');
  ok(dr.paused === false && dr.pausedUntil === null && dr.pausedAt === null, 'draft resume clears stale stamps');
  const pc = base();
  pc.ordering.paused = true;
  pc.ordering.pausedMessage = { en: 'Back soon', ar: '' };
  const pcs = getOrderingState(pc, monOpen);
  ok(pcs.message.en === 'Back soon' && pcs.message.ar.length > 0, 'custom message with default fallback');
  // acceptWhenClosed
  const aw = base();
  aw.ordering.acceptWhenClosed = true;
  ok(getOrderingState(aw, night).state === 'open', 'acceptWhenClosed bypasses closed');
  // resolveLiveOrdering: poller wins unless provably stale (paused with a
  // reached deadline — a state the server never returns, so it must be old).
  const liveMenu = { settings: base() };
  const fresh = { state: 'paused', message: { en: '', ar: '' }, reopensAt: new Date(monOpen + 60000).toISOString() };
  ok(resolveLiveOrdering(fresh, liveMenu, monOpen) === fresh, 'fresh poller wins by identity');
  const stale = { state: 'paused', message: { en: '', ar: '' }, reopensAt: new Date(monOpen - 1000).toISOString() };
  ok(resolveLiveOrdering(stale, liveMenu, monOpen).state === 'open', 'stale paused poller recomputed to open');
  ok(resolveLiveOrdering(null, liveMenu, monOpen).state === 'open', 'null poller falls back to machine');
  ok(resolveLiveOrdering(undefined, liveMenu, night).state === 'closed', 'undefined poller falls back to machine');
  // countdown formatting shared by admin panel and customer line
  ok(formatMMSS(90000) === '1:30' && formatMMSS(61000) === '1:01' && formatMMSS(0) === '0:00', 'countdown mm:ss');
  ok(formatMMSS(3661000) === '1:01:01' && formatMMSS(-500) === '0:00', 'countdown hours + clamp');
  ok(formatHMS(3661000) === '01:01:01' && formatHMS(61000) === '00:01:01', 'countdown hh:mm:ss');
  // poll freshness guard: never fires before first success, fires past 2 periods
  ok(isPollStale(null, 1000000) === false, 'no staleness before first success');
  ok(isPollStale(1000000, 1000000 + 59000) === false, 'fresh poll trusted');
  ok(isPollStale(1000000, 1000000 + 120000) === false, 'two periods still trusted (boundary)');
  ok(isPollStale(1000000, 1000000 + 120001) === true, 'dead poll distrusted past boundary');
  // adaptive cadence: fast while paused, cheap when open
  ok(pollIntervalMs({ state: 'paused' }) === 3000, 'paused polls fast');
  ok(pollIntervalMs({ state: 'open' }) === 60000, 'open polls slow');
  ok(pollIntervalMs({ state: 'closed' }) === 60000, 'closed polls slow');
  ok(pollIntervalMs({ state: 'disabled' }) === 60000, 'disabled polls slow');
  ok(pollIntervalMs(null) === 60000, 'unknown polls slow');
  // fast window after opening/returning (fresh sessions decide fast)
  const t0 = 2000000;
  ok(pollIntervalMs({ state: 'open' }, t0, t0) === 5000, 'fresh open polls fast');
  ok(pollIntervalMs({ state: 'open' }, t0 + 119999, t0) === 5000, 'fast window holds');
  ok(pollIntervalMs({ state: 'open' }, t0 + 120000, t0) === 60000, 'fast window settles');
  ok(pollIntervalMs({ state: 'paused' }, t0, t0) === 3000, 'paused beats fast window');
  ok(pollIntervalMs(null, t0, t0) === 5000, 'unknown state still fast when fresh');
}

/* ---------------- validator additions ---------------- */

function minMenu() {
  return {
    version: 1,
    settings: {
      name: { en: 'X', ar: 'س' }, tagline: { en: '', ar: '' }, address: { en: '', ar: '' },
      hoursText: { en: '', ar: '' }, currency: { en: 'LBP', ar: 'ل.ل' }, logoText: 'X',
      phone: '', whatsapp: '', mapUrl: '', statusMode: 'auto', openTime: '12:00', closeTime: '00:00',
      workingDays: ['sat'], timezone: 'Asia/Beirut', social: {}, socialEnabled: {}, about: { en: '', ar: '' },
      ordering: { enabled: false },
    },
    categories: [], items: [],
  };
}
{
  const v = validateMenu(minMenu());
  ok(v.ok, 'minimal menu still validates');
  ok(v.value.settings.ordering.paused === false && v.value.settings.ordering.pausedUntil === null && v.value.settings.ordering.acceptWhenClosed === false, 'ordering defaults');
  ok(v.value.settings.announcement.enabled === false && v.value.settings.privacy.reviewed === false, 'announcement/privacy defaults');
  const m = minMenu();
  m.settings.ordering.paused = true;
  m.settings.ordering.pausedUntil = 'not-a-date';
  ok(validateMenu(m).ok === false, 'invalid pausedUntil rejected');
  const mw = minMenu();
  mw.settings.ordering.enabled = true;
  ok(validateMenu(mw).ok === false, 'enabling without whatsapp rejected');
  const mw2 = minMenu();
  mw2.settings.ordering.enabled = true;
  mw2.settings.whatsapp = '96170123456';
  const vw2 = validateMenu(mw2);
  ok(vw2.ok && vw2.value.settings.ordering.enabled === true, 'enabling with whatsapp kept');
  const mw3 = minMenu();
  mw3.settings.ordering.enabled = true;
  mw3.settings.whatsapp = '+961 70-123 456';
  ok(validateMenu(mw3).ok === true, 'formatted whatsapp normalized and accepted');
  const mw4 = minMenu();
  mw4.settings.ordering.enabled = true;
  mw4.settings.whatsapp = '070123456';
  ok(validateMenu(mw4).ok === false, 'leading-zero number rejected');
  const m2 = minMenu();
  m2.settings.ordering.pausedUntil = new Date(Date.now() + 3600e3).toISOString();
  m2.settings.ordering.pausedMessage = { en: 'x'.repeat(200), ar: '' };
  const v2 = validateMenu(m2);
  ok(v2.ok && v2.value.settings.ordering.pausedMessage.en.length === 160, 'pausedMessage trimmed to 160');
  const m3 = minMenu();
  m3.settings.announcement = { enabled: true, text: { en: '', ar: '' }, startsAt: null, expiresAt: null };
  ok(validateMenu(m3).ok === false, 'enabled announcement needs text');
  const m4 = minMenu();
  m4.settings.announcement = { enabled: true, text: { en: 'Hi', ar: '' }, startsAt: '2026-02-01T00:00:00.000Z', expiresAt: '2026-01-01T00:00:00.000Z' };
  ok(validateMenu(m4).ok === false, 'expiresAt before startsAt rejected');
  const m5 = minMenu();
  m5.settings.announcement = { enabled: true, text: { en: 'Hi', ar: '' }, startsAt: null, expiresAt: new Date(Date.now() + 400 * 86400000).toISOString() };
  ok(validateMenu(m5).ok === false, 'expiresAt beyond 365d rejected');
  const m6 = minMenu();
  m6.settings.announcement = { enabled: true, text: { en: 'Sale <b>50%</b>', ar: '' }, startsAt: null, expiresAt: null };
  const v6 = validateMenu(m6);
  ok(v6.ok && v6.value.settings.announcement.text.en === 'Sale <b>50%</b>', 'announcement keeps text (rendered as text node client-side)');
  const m7 = minMenu();
  m7.settings.privacy = { extra: { en: 'Legal Co\x00\x01', ar: '' }, reviewed: true };
  const v7 = validateMenu(m7);
  ok(v7.ok && v7.value.settings.privacy.extra.en === 'Legal Co' && v7.value.settings.privacy.reviewed === true, 'control chars stripped, reviewed kept');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
