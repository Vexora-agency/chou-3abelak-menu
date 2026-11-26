// Local region street index (instant side-street suggestions, zero network).
// Run: npx tsx scripts/test-street-index.mjs
import { existsSync, readFileSync } from 'node:fs';
import {
  inScopeBoxes,
  loadRecentPlaces,
  loadStreetIndex,
  matchRecentPlaces,
  mergeLocalFirst,
  normalizeStreetText,
  saveRecentPlace,
  searchStreetIndex,
} from '../src/utils/streetIndex.ts';

let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.error(`FAIL: ${name}`);
  }
};

ok('normalize unifies alef and strips ال', normalizeStreetText('الإسكندرية') === 'اسكندريه');
ok('normalize maps ة→ه and ى→ي and strips ال', normalizeStreetText('المنيرة الكبرى') === 'منيره كبري');
ok('normalize converts arabic-indic digits', normalizeStreetText('شارع ١٦') === 'شارع 16');
ok('normalize expands standalone ش', normalizeStreetText('ش 16') === 'شارع 16');
ok('normalize strips tashkeel', normalizeStreetText('شَارع') === 'شارع');
ok('normalize unifies hamza seats ؤ/ئ→ء and strips ال', normalizeStreetText('رئيس الوزراء') === 'رءيس وزراء');
ok('normalize trims and collapses', normalizeStreetText('  السيوف   شارع  ') === 'سيوف شارع');

const entries = [
  { ar: 'شارع 16', la: 'Street 16', lat: 31.202, lng: 29.952 },
  { ar: 'شارع 45', la: 'Street 45', lat: 31.201, lng: 29.951 },
  { ar: 'شارع أحمد لطفي السيد', la: 'Ahmed Lotfy El-Sayed Street', lat: 31.205, lng: 29.924 },
  { ar: 'السيوف', la: 'El Soyouf', lat: 31.2, lng: 29.95 },
  { ar: '', la: '', lat: 1, lng: 1 },
  { ar: 'شارع بلا إحداثيات', la: null, lat: NaN, lng: 1 },
];

const found = searchStreetIndex(entries, 'السيوف شارع 16', 'الإسكندرية', 'Alexandria', 'ar');
ok('every token must match (exact street)', found.length === 1 && found[0].line1 === 'شارع 16');
ok('label carries the city', found.length === 1 && found[0].label === 'شارع 16، الإسكندرية');
ok('latin query matches latin names', searchStreetIndex(entries, 'street 16', 'الإسكندرية', 'Alexandria', 'en')[0]?.line1 === 'Street 16');
ok('ال-flexibility: bare and article queries match either spelling', (() => {
  const es = [{ ar: 'شارع الحمرا', la: null, lat: 1, lng: 1 }];
  const a = searchStreetIndex(es, 'حمرا', 'بيروت', 'Beirut', 'ar');
  const b = searchStreetIndex(es, 'الحمرا', 'بيروت', 'Beirut', 'ar');
  return a.length === 1 && b.length === 1;
})());
ok('scope boxes admit inside, reject outside, pass when unrestricted', (() => {
  const boxes = [[33.8, 35.4, 33.95, 35.55]];
  return inScopeBoxes(33.88, 35.5, boxes) === true
    && inScopeBoxes(34.5, 36.0, boxes) === false
    && inScopeBoxes(34.5, 36.0, null) === true
    && inScopeBoxes(null, 35.5, boxes) === true;
})());
ok('latinized شارع matches street', (() => {
  const r = searchStreetIndex(entries, 'السيوف street', 'الإسكندرية', 'Alexandria', 'ar');
  return r.length === 3 && r[0].line1 === 'شارع 16';
})());
ok('partial prefix matches', searchStreetIndex(entries, 'أحمد لطفي', 'الإسكندرية', 'Alexandria', 'ar')[0]?.line1 === 'شارع أحمد لطفي السيد');
ok('missing token means no rows', searchStreetIndex(entries, 'السيوف القاهرة', 'الإسكندرية', 'Alexandria', 'ar').length === 0);
ok('short query is empty', searchStreetIndex(entries, 'س', 'الإسكندرية', 'Alexandria', 'ar').length === 0);
ok('digit-only query matches numbered streets', searchStreetIndex(entries, '16', 'الإسكندرية', 'Alexandria', 'ar')[0]?.line1 === 'شارع 16');
ok('deep suffix backoff resolves through dialect area spellings', (() => {
  const r = searchStreetIndex(entries, 'السيوف شماعة شارع 45', 'الإسكندرية', 'Alexandria', 'ar');
  return r.length === 1 && r[0].line1 === 'شارع 45';
})());
ok('digit boost orders numbered first', (() => {
  const r = searchStreetIndex(entries, 'شارع 45', 'الإسكندرية', 'Alexandria', 'ar');
  return r.length === 1 && r[0].line1 === 'شارع 45';
})());
ok('limit caps rows', searchStreetIndex(entries, 'شارع', 'الإسكندرية', 'Alexandria', 'ar', 2).length === 2);
ok('near orders equally scored streets closest-first', (() => {
  const far = { ar: 'شارع 16', la: null, lat: 31.3, lng: 30.0 };
  const close = { ar: 'شارع 16', la: null, lat: 31.205, lng: 29.945 };
  const r = searchStreetIndex([far, close], 'شارع 16', 'الإسكندرية', 'Alexandria', 'ar', 8, { lat: 31.205, lng: 29.945 });
  return r.length === 2 && r[0].lat === 31.205 && r[1].lat === 31.3;
})());
ok('garbage entries skipped', searchStreetIndex(entries, 'شارع', 'الإسكندرية', 'Alexandria', 'ar').every((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng)));

const local = [{ label: 'A', line1: 'A', line2: '', lat: 1.00001, lng: 2.00001 }];
const server = [
  { label: 'A copy', line1: 'A', line2: '', lat: 1.00002, lng: 2.00002 },
  { label: 'B', line1: 'B', line2: '', lat: 3, lng: 4 },
];
const merged = mergeLocalFirst(local, server);
ok('local first, server deduped', merged.length === 2 && merged[0] === local[0] && merged[1] === server[1]);
ok('merge never throws on garbage', mergeLocalFirst(null, null).length === 0);

ok('irrelevant country loads nothing (no network)', await loadStreetIndex('fr', null) === null);

/* Device-local recents (private by design: this device only). */{
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => void store.set(k, String(v)),
      removeItem: (k) => void store.delete(k),
    },
  };
  saveRecentPlace({ label: 'دوار السيوف، الإسكندرية', line1: 'دوار السيوف', line2: 'الإسكندرية', lat: 31.205, lng: 29.945 });
  saveRecentPlace({ label: 'Bad row', line1: '', line2: '', lat: NaN, lng: 1 });
  const recents = loadRecentPlaces();
  ok('recents keep valid picks newest-first', recents.length === 1 && recents[0].label === 'دوار السيوف، الإسكندرية');
  ok('recents match by substring', matchRecentPlaces('السيوف').length === 1);
  ok('recents ignore short queries', matchRecentPlaces('س').length === 0);
  ok('recents cap at 5, newest kept', (() => {
    for (let i = 0; i < 7; i += 1) {
      saveRecentPlace({ label: `مكان ${i}`, line1: `مكان ${i}`, line2: '', lat: 31.2 + i * 0.001, lng: 29.95 });
    }
    const all = loadRecentPlaces();
    return all.length === 5 && all[0].label === 'مكان 6';
  })());
  delete globalThis.window;
}

// Committed region fixture (built by scripts/build-street-index.mjs).
const fixture = 'public/data/street-index/alex-east.json';
if (!existsSync(fixture)) {
  console.log('info: region fixture missing (build not run yet) — skipping file assertions');
} else {
  const file = JSON.parse(readFileSync(fixture, 'utf8'));
  ok('fixture has entries', Array.isArray(file.entries) && file.entries.length > 500);
  ok('fixture rows are [ar, la|null, lat, lng]',
    file.entries.every((r) => Array.isArray(r) && r.length === 4 && typeof r[2] === 'number' && Number.isFinite(r[2]) && typeof r[3] === 'number' && Number.isFinite(r[3])));
  const mapped = file.entries.map((r) => ({ ar: r[0] || '', la: r[1], lat: r[2], lng: r[3] }));
  const smoke = searchStreetIndex(mapped, 'شارع', file.cityAr, file.cityEn, 'ar');
  ok('fixture answers شارع instantly', smoke.length > 0 && smoke.length <= 8);
  const dialectLocal = searchStreetIndex(mapped, 'الإسكندرية السويف شماعة شارع 16', file.cityAr, file.cityEn, 'ar');
  ok('fixture resolves the dialect query via suffix backoff', dialectLocal.length >= 1 && (dialectLocal[0].line1 || '').includes('16'));
  // Loader integration (stubbed network): manifest → file → search.
  // Runs BEFORE the no-network tests so a real failed fetch can never
  // poison the 30s manifest retry window.
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.endsWith('/manifest.json')) {
        return { ok: true, json: async () => ({ indexes: [{ id: 'alex-east', country: 'eg', bbox: [31.1, 29.8, 31.3, 30.1] }] }) };
      }
      if (u.endsWith('/alex-east.json')) return { ok: true, json: async () => file };
      return { ok: false, status: 404, json: async () => ({}) };
    };
    const byCountry = await loadStreetIndex('eg', null);
    ok('loader picks the index by country', !!byCountry && byCountry.entries.length > 500);
    const byViewport = await loadStreetIndex('', { lat: 31.2, lng: 29.95 });
    ok('loader picks the index by viewport bbox', !!byViewport && byViewport.id === 'alex-east');
    ok('loader refuses a wrong-city file (Cairo bias never loads Alexandria)', await loadStreetIndex('eg', { lat: 30.05, lng: 31.25 }) === null);
    if (byCountry) {
      const exact = searchStreetIndex(byCountry.entries, 'شارع السيوف', byCountry.cityAr, byCountry.cityEn, 'ar');
      ok('loader + search resolve شارع السيوف', exact.length >= 1 && exact[0].line1.includes('السيوف'));
      const near = searchStreetIndex(byCountry.entries, 'شارع 16', byCountry.cityAr, byCountry.cityEn, 'ar', 8, { lat: 31.2, lng: 29.95 });
      ok('loader + search resolve شارع 16', near.length >= 1 && near[0].line1.includes('16'));
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  ok('irrelevant viewport loads nothing (Beirut outside every bbox)', await loadStreetIndex('', { lat: 33.9, lng: 35.5 }) === null);
}

console.log(`street-index: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
