// ETA formatter unit tests (pure helpers, no DOM): node scripts/test-eta-format.mjs
// Imports the REAL src/utils/etaFormat.ts via a data: URL — the file is
// JSDoc-only (no TS syntax) so plain node runs it with zero tooling.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src', 'utils', 'etaFormat.ts'), 'utf8');
const { formatTime12, formatEtaRange, etaRange, formatEtaDay, formatEtaRangeWithDay, dayKeyInZone } = await import(
  'data:text/javascript;charset=utf-8,' + encodeURIComponent(src)
);

let fails = 0;
const check = (name, cond, extra = '') => {
  if (!cond) {
    fails++;
    console.error(`  FAIL ${name} ${extra}`);
  } else console.log(`  ok ${name}`);
};

// Local-time construction keeps assertions TZ-independent (build + format
// both use the device zone, like the real track page).
const iso = (y, mo, d, h, mi) => new Date(y, mo, d, h, mi).toISOString();
const AR_INDIC = /[\u0660-\u0669]/;

// ---- formatTime12 ----
{
  const en = formatTime12(iso(2026, 10, 2, 19, 37), 'en');
  check('en evening exact', en === '7:37 PM', JSON.stringify(en));
  const ar = formatTime12(iso(2026, 10, 2, 19, 37), 'ar');
  check('ar evening exact + latin digits', ar === '7:37 م' && !AR_INDIC.test(ar), JSON.stringify(ar));
  const enAm = formatTime12(iso(2026, 10, 2, 9, 5), 'en');
  check('en morning padded minutes', enAm === '9:05 AM', JSON.stringify(enAm));
  const arAm = formatTime12(iso(2026, 10, 2, 9, 5), 'ar');
  check('ar morning marker + latin digits', arAm === '9:05 ص' && !AR_INDIC.test(arAm), JSON.stringify(arAm));
  check('midnight is 12 AM', formatTime12(iso(2026, 10, 3, 0, 5), 'en') === '12:05 AM');
  check('noon is 12 PM', formatTime12(iso(2026, 10, 2, 12, 0), 'en') === '12:00 PM');
  check('garbage -> empty', formatTime12('not-a-date', 'en') === '' && formatTime12('', 'ar') === '');
}

// ---- etaRange: ±20% of remaining wait, min ±5 min ----
{
  const now = new Date(2026, 10, 2, 19, 0).getTime();
  const r50 = etaRange(new Date(now + 50 * 60000).toISOString(), now);
  check(
    '50min wait -> ±10min window',
    r50 !== null && Date.parse(r50.toIso) - Date.parse(r50.fromIso) === 20 * 60000,
    JSON.stringify(r50),
  );
  const r10 = etaRange(new Date(now + 10 * 60000).toISOString(), now);
  check(
    '10min wait -> ±5min floor',
    r10 !== null && Date.parse(r10.toIso) - Date.parse(r10.fromIso) === 10 * 60000,
    JSON.stringify(r10),
  );
  const rPast = etaRange(new Date(now - 60000).toISOString(), now);
  check(
    'past eta -> ±5min floor, symmetric',
    rPast !== null && Date.parse(rPast.toIso) - Date.parse(rPast.fromIso) === 10 * 60000,
    JSON.stringify(rPast),
  );
  check('garbage eta -> null', etaRange('bogus', now) === null);
  // Owner-reported bug: a ~30 h ETA printed a ±6 h site window whose start
  // edge ("tomorrow 4:05 PM") contradicted the email center ("10:04 PM").
  const rFar = etaRange(new Date(now + 30 * 3600000).toISOString(), now);
  check(
    '30h wait -> capped at ±30min window',
    rFar !== null && Date.parse(rFar.toIso) - Date.parse(rFar.fromIso) === 60 * 60000,
    JSON.stringify(rFar),
  );
  const rHuge = etaRange(new Date(now + 5 * 24 * 3600000).toISOString(), now);
  check(
    '5d wait -> still ±30min, never wider',
    rHuge !== null && Date.parse(rHuge.toIso) - Date.parse(rHuge.fromIso) === 60 * 60000,
    JSON.stringify(rHuge),
  );
  // The email center must always sit inside the site window, at most the cap
  // away from either edge — same order, same promise on both surfaces.
  const center = now + 30 * 3600000;
  const rC = etaRange(new Date(center).toISOString(), now);
  check(
    'site window brackets the email center within the cap',
    rC !== null &&
      Date.parse(rC.fromIso) <= center && center <= Date.parse(rC.toIso) &&
      center - Date.parse(rC.fromIso) <= 30 * 60000 &&
      Date.parse(rC.toIso) - center <= 30 * 60000,
    JSON.stringify(rC),
  );
}

// ---- formatEtaRange ----
{
  const sameEn = formatEtaRange(iso(2026, 10, 2, 19, 37), iso(2026, 10, 2, 19, 47), 'en');
  check('same period: marker once (en)', sameEn === '7:37 – 7:47 PM', JSON.stringify(sameEn));
  const sameAr = formatEtaRange(iso(2026, 10, 2, 19, 37), iso(2026, 10, 2, 19, 47), 'ar');
  check(
    'same period: marker once, latin digits (ar)',
    sameAr === '7:37 – 7:47 م' && !AR_INDIC.test(sameAr),
    JSON.stringify(sameAr),
  );
  const xEn = formatEtaRange(iso(2026, 10, 2, 23, 55), iso(2026, 10, 3, 0, 5), 'en');
  check('midnight cross: both markers (en)', xEn === '11:55 PM – 12:05 AM', JSON.stringify(xEn));
  const xAr = formatEtaRange(iso(2026, 10, 2, 23, 55), iso(2026, 10, 3, 0, 5), 'ar');
  check(
    'midnight cross: both markers, latin digits (ar)',
    xAr === '11:55 م – 12:05 ص' && !AR_INDIC.test(xAr),
    JSON.stringify(xAr),
  );
  const noonEn = formatEtaRange(iso(2026, 10, 2, 11, 55), iso(2026, 10, 2, 12, 5), 'en');
  check('AM->PM cross: both markers', noonEn === '11:55 AM – 12:05 PM', JSON.stringify(noonEn));
  const swap = formatEtaRange(iso(2026, 10, 2, 19, 47), iso(2026, 10, 2, 19, 37), 'en');
  check('inverted ends self-heal', swap === '7:37 – 7:47 PM', JSON.stringify(swap));
  check('garbage -> empty', formatEtaRange('x', iso(2026, 10, 2, 19, 47), 'en') === '');
}

// ---- etaRange + formatEtaRange compose (what the track page renders) ----
{
  const now = new Date(2026, 10, 2, 19, 0).getTime();
  const eta = new Date(now + 37 * 60000).toISOString();
  const r = etaRange(eta, now);
  const label = r ? formatEtaRange(r.fromIso, r.toIso, 'ar') : '';
  check('composed banner range renders', label === '7:29 – 7:44 م', JSON.stringify(label));
}

// ---- day-aware labels: track page + email share one zone + one instant ----
{
  const BEIRUT = 'Asia/Beirut';
  // Fixed wall-clock instants (offsets keep them exact in every CI zone).
  const now = Date.parse('2026-11-05T19:00:00+02:00');
  const sameDay = '2026-11-05T21:30:00+02:00';
  const nextDay = '2026-11-06T08:00:00+02:00';
  const farDay = '2026-11-10T08:00:00+02:00';
  check('today (ar)', formatEtaDay(sameDay, 'ar', BEIRUT, now) === 'اليوم', formatEtaDay(sameDay, 'ar', BEIRUT, now));
  check('today (en)', formatEtaDay(sameDay, 'en', BEIRUT, now) === 'Today', formatEtaDay(sameDay, 'en', BEIRUT, now));
  check('tomorrow (ar)', formatEtaDay(nextDay, 'ar', BEIRUT, now) === 'غداً', formatEtaDay(nextDay, 'ar', BEIRUT, now));
  check('tomorrow (en)', formatEtaDay(nextDay, 'en', BEIRUT, now) === 'Tomorrow', formatEtaDay(nextDay, 'en', BEIRUT, now));
  const farAr = formatEtaDay(farDay, 'ar', BEIRUT, now);
  check('far date (ar) has month + latin digits', farAr.includes('نوفمبر') && !AR_INDIC.test(farAr), JSON.stringify(farAr));
  const farEn = formatEtaDay(farDay, 'en', BEIRUT, now);
  check('far date (en) has month', farEn.includes('Nov'), JSON.stringify(farEn));
  // Same instant, different zone key: 23:30Z is Nov 5 in UTC, Nov 6 in Beirut.
  check('zone changes the day key', dayKeyInZone(Date.parse('2026-11-05T23:30:00Z'), 'UTC') === '2026-11-05' && dayKeyInZone(Date.parse('2026-11-05T23:30:00Z'), BEIRUT) === '2026-11-06');
  // Range composes with the midpoint day (far windows start a day early).
  const rFar = etaRange(new Date(Date.parse(farDay)).toISOString(), now);
  const lblFar = rFar ? formatEtaRangeWithDay(rFar.fromIso, rFar.toIso, 'ar', BEIRUT, now) : '';
  check('far range anchored on ETA day, latin digits', lblFar.startsWith('10 نوفمبر،') && !AR_INDIC.test(lblFar), JSON.stringify(lblFar));
  const rToday = etaRange(new Date(Date.parse(sameDay)).toISOString(), now);
  const lblToday = rToday ? formatEtaRangeWithDay(rToday.fromIso, rToday.toIso, 'ar', BEIRUT, now) : '';
  check('today range prefixed', lblToday.startsWith('اليوم،'), JSON.stringify(lblToday));
  const lblTodayEn = rToday ? formatEtaRangeWithDay(rToday.fromIso, rToday.toIso, 'en', BEIRUT, now) : '';
  check('today range prefixed (en)', lblTodayEn.startsWith('Today,'), JSON.stringify(lblTodayEn));
  check('garbage day -> empty', formatEtaDay('bogus', 'ar', BEIRUT, now) === '' && formatEtaRangeWithDay('x', 'y', 'ar', BEIRUT, now) === '');
}

console.log(fails ? `\n${fails} FAILED` : '\nall green');
if (fails) process.exit(1);
