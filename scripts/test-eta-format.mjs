// ETA formatter unit tests (pure helpers, no DOM): node scripts/test-eta-format.mjs
// Imports the REAL src/utils/etaFormat.ts via a data: URL — the file is
// JSDoc-only (no TS syntax) so plain node runs it with zero tooling.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src', 'utils', 'etaFormat.ts'), 'utf8');
const { formatTime12, formatEtaRange, etaRange } = await import(
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

console.log(fails ? `\n${fails} FAILED` : '\nall green');
if (fails) process.exit(1);
