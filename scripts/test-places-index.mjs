// Downloadable per-country places libraries (districts, suburbs, villages,
// towns, cities) — the «areas» half of Talabat-style search, zero typing
// and zero network at query time. Run: npx tsx scripts/test-places-index.mjs
import { existsSync, readFileSync } from 'node:fs';
import {
  kindLabel,
  loadPlacesIndex,
  searchPlaces,
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

const entries = [
  { ar: 'السيوف', la: 'El Soyouf', lat: 31.205, lng: 29.945, kind: 'suburb' },
  { ar: 'شماعة', la: 'Shamaa', lat: 31.206, lng: 29.946, kind: 'neighbourhood' },
  { ar: 'الإسكندرية', la: 'Alexandria', lat: 31.2, lng: 29.95, kind: 'city' },
  { ar: 'بيروت', la: 'Beirut', lat: 33.8938, lng: 35.5018, kind: 'city' },
  { ar: '', la: null, lat: 0, lng: 0, kind: 'suburb' },
];

ok('kind labels are bilingual', kindLabel('suburb', 'ar') === 'حي' && kindLabel('village', 'en') === 'Village' && kindLabel('nope', 'ar') === '');
ok('area name matches with kind context', (() => {
  const r = searchPlaces(entries, 'السيوف', 'ar');
  return r.length >= 1 && r[0].line1 === 'السيوف' && r[0].line2 === 'حي';
})());
ok('latin matches latin names', (() => {
  const r = searchPlaces(entries, 'soy ouf'.replace(' ', ''), 'en');
  return r.length >= 1 && r[0].line1 === 'El Soyouf';
})());
ok('short query is empty', searchPlaces(entries, 'س', 'ar').length === 0);
ok('missing token means no rows', searchPlaces(entries, 'السيوف القاهرة', 'ar').length === 0);
ok('garbage entries skipped', searchPlaces(entries, 'السيوف', 'ar').every((r) => Number.isFinite(r.lat)));
ok('caps rows', searchPlaces(entries, 'ا', 'ar', 2).length <= 2);
ok('near orders equally scored areas closest-first', (() => {
  const far = { ar: 'السيوف', la: null, lat: 33.0, lng: 35.0, kind: 'suburb' };
  const close = { ar: 'السيوف', la: null, lat: 31.205, lng: 29.945, kind: 'suburb' };
  const r = searchPlaces([far, close], 'السيوف', 'ar', 8, { lat: 31.205, lng: 29.945 });
  return r.length === 2 && r[0].lat === 31.205 && r[1].lat === 33.0;
})());
ok('irrelevant country loads nothing (no network)', await loadPlacesIndex('fr', null) === null);
ok('irrelevant viewport loads nothing (no network)', await loadPlacesIndex('', { lat: 0, lng: 0 }) === null);

// Committed country fixtures (built by scripts/build-places-index.mjs).
for (const fixture of ['public/data/places-index/places-lb.json', 'public/data/places-index/places-eg.json']) {
  if (!existsSync(fixture)) {
    console.log(`info: region fixture missing (${fixture}) — skipping file assertions`);
    continue;
  }
  const file = JSON.parse(readFileSync(fixture, 'utf8'));
  ok(`${fixture} has entries`, Array.isArray(file.entries) && file.entries.length > 100);
  ok(`${fixture} rows are [ar, la|null, lat, lng, kind]`, file.entries.every((r) => Array.isArray(r) && r.length === 5 && typeof r[2] === 'number' && Number.isFinite(r[2]) && typeof r[3] === 'number' && Number.isFinite(r[3]) && typeof r[4] === 'string'));
}

console.log(`places-index: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
