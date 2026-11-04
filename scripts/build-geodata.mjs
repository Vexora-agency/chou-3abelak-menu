/**
 * Build the delivery-zones geodata from pinned upstream datasets.
 * Run: node scripts/build-geodata.mjs
 * Requires network (fetches the pinned raw files once, then writes
 * trimmed, committed outputs — the app itself never fetches upstream).
 *
 * Upstream (pinned by commit SHA, see docs/GEODATA.md):
 * - mledoze/countries → country list + Arabic names (translations.ara).
 * - dr5hn/countries-states-cities-database → subdivisions (ISO 3166-2 codes
 *   + Arabic translations where available).
 * - Lebanon is curated by hand below (9 governorates, bilingual + match
 *   aliases). Notably Keserwan-Jbeil has NO ISO code even in 2026, so it
 *   carries our stable code LB-KJ and matches by name as well.
 *
 * Outputs (all committed):
 * - src/data/geo/countries.json                  — client country list
 * - functions/_shared/geodata/countries.json      — identical server copy
 * - public/geo/subdivisions/<CC>.json             — lazy per-country lists
 * - <each dir>/geodata.meta.json                  — source SHAs + license
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MLEDOZE_SHA = 'fa4f62182d19ff4f8b325cde6387c9cd9d80955a';
const DR5HN_SHA = '20de077b176b00ba0fc0f298a55caa1dc6337a86';
const MLEDOZE_URL = `https://raw.githubusercontent.com/mledoze/countries/${MLEDOZE_SHA}/countries.json`;
const DR5HN_URL = `https://raw.githubusercontent.com/dr5hn/countries-states-cities-database/${DR5HN_SHA}/json/states.json`;

/** Hand-curated Lebanon: display names + match aliases (see docs/GEODATA.md). */
const LB_CURATED = [
  { code: 'LB-BA', en: 'Beirut', ar: 'بيروت', aliases: ['beirut', 'beyrouth', 'بيروت'] },
  { code: 'LB-JL', en: 'Mount Lebanon', ar: 'جبل لبنان', aliases: ['mount lebanon', 'mont liban', 'جبل لبنان'] },
  { code: 'LB-AS', en: 'North', ar: 'الشمال', aliases: ['north', 'north lebanon', 'liban-nord', 'nord', 'الشمال', 'شمال'] },
  { code: 'LB-JA', en: 'South', ar: 'الجنوب', aliases: ['south', 'south lebanon', 'liban-sud', 'sud', 'الجنوب', 'جنوب'] },
  { code: 'LB-BI', en: 'Beqaa', ar: 'البقاع', aliases: ['beqaa', 'bekaa', 'bekka', 'البقاع', 'بقاع'] },
  { code: 'LB-BH', en: 'Baalbek-Hermel', ar: 'بعلبك-الهرمل', aliases: ['baalbek-hermel', 'baalbek', 'hermel', 'بعلبك', 'بعلبك-الهرمل', 'الهرمل'] },
  { code: 'LB-AK', en: 'Akkar', ar: 'عكار', aliases: ['akkar', 'عكار'] },
  { code: 'LB-NA', en: 'Nabatieh', ar: 'النبطية', aliases: ['nabatieh', 'nabatiyeh', 'nabatieh', 'النبطية'] },
  // No ISO code exists for Keserwan-Jbeil (confirmed 2023-2026): stable
  // house code LB-KJ + name matching. Deliberately NO city aliases here
  // (Jounieh etc. belong to cities, not to this governorate row).
  { code: 'LB-KJ', en: 'Keserwan-Jbeil', ar: 'كسروان-جبيل', aliases: ['keserwan-jbeil', 'keserwan', 'kesrouan', 'kesserwan', 'jbeil', 'byblos', 'كسروان', 'كسروان-جبيل', 'جبيل'] },
];

async function getJson(url, label) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${label} failed: ${res.status}`);
  return res.json();
}

const normKey = (s) => String(s || '').trim().toLowerCase();

function main(countriesUp, statesUp) {
  // ---- countries: [{cc, en, ar}] sorted by English name ----
  const seen = new Set();
  const countries = [];
  for (const c of countriesUp) {
    const cc = typeof c.cca2 === 'string' ? c.cca2.trim().toUpperCase() : '';
    if (!/^[A-Z]{2}$/.test(cc) || seen.has(cc)) continue;
    seen.add(cc);
    const en = c?.name?.common?.trim() || cc;
    const ar = c?.translations?.ara?.common?.trim() || null;
    countries.push({ cc, en, ar });
  }
  countries.sort((a, b) => (a.en < b.en ? -1 : a.en > b.en ? 1 : 0));

  // ---- subdivisions per country: [{code, en, ar|null}] ----
  const byCountry = new Map();
  for (const s of statesUp) {
    const cc = typeof s.country_code === 'string' ? s.country_code.trim().toUpperCase() : '';
    if (!/^[A-Z]{2}$/.test(cc)) continue;
    const code = typeof s.iso3166_2 === 'string' && s.iso3166_2.trim()
      ? s.iso3166_2.trim().toUpperCase()
      : (typeof s.iso2 === 'string' && s.iso2.trim() ? `${cc}-${s.iso2.trim().toUpperCase()}` : null);
    const en = typeof s.name === 'string' ? s.name.trim() : '';
    if (!code || !en) continue;
    if (!byCountry.has(cc)) byCountry.set(cc, new Map());
    const bucket = byCountry.get(cc);
    if (bucket.has(code)) continue;
    const ar = (s.translations && typeof s.translations.ar === 'string' && s.translations.ar.trim()) || null;
    bucket.set(code, { code, en, ar });
  }
  // Lebanon: curated bilingual list (with aliases) wins over upstream.
  byCountry.set('LB', new Map(LB_CURATED.map((g) => [g.code, { code: g.code, en: g.en, ar: g.ar, aliases: g.aliases }])));

  // ---- write outputs ----
  const meta = {
    sources: [
      { dataset: 'mledoze/countries', sha: MLEDOZE_SHA, license: 'ODbL-1.0' },
      { dataset: 'dr5hn/countries-states-cities-database', sha: DR5HN_SHA, license: 'ODbL-1.0' },
      { dataset: 'hand-curated LB governorates', license: 'CC0 (ours)' },
    ],
    generatedAt: new Date().toISOString(),
    countries: countries.length,
    subdivisionFiles: 0,
  };

  const clientCountries = join(ROOT, 'src/data/geo/countries.json');
  // Server twin: plain .js data module (Cloudflare's esbuild predates
  // `import ... with {type:'json'}`, so the server cannot import JSON).
  // Same content as the client JSON, written by this same script.
  const serverCountries = join(ROOT, 'functions/_shared/geodata/countries.js');
  mkdirSync(dirname(clientCountries), { recursive: true });
  mkdirSync(dirname(serverCountries), { recursive: true });
  writeFileSync(clientCountries, JSON.stringify(countries, null, 1) + '\n');
  writeFileSync(serverCountries, 'export default ' + JSON.stringify(countries) + ';\n');
  writeFileSync(join(dirname(clientCountries), 'geodata.meta.json'), JSON.stringify(meta, null, 1) + '\n');
  writeFileSync(join(dirname(serverCountries), 'geodata.meta.json'), JSON.stringify(meta, null, 1) + '\n');

  const subDir = join(ROOT, 'public/geo/subdivisions');
  mkdirSync(subDir, { recursive: true });
  let files = 0;
  for (const [cc, bucket] of [...byCountry.entries()].sort()) {
    const list = [...bucket.values()].sort((a, b) => (a.en < b.en ? -1 : a.en > b.en ? 1 : 0));
    if (!list.length) continue;
    writeFileSync(join(subDir, `${cc}.json`), JSON.stringify(list, null, 1) + '\n');
    files++;
  }
  meta.subdivisionFiles = files;
  writeFileSync(join(dirname(clientCountries), 'geodata.meta.json'), JSON.stringify(meta, null, 1) + '\n');
  writeFileSync(join(dirname(serverCountries), 'geodata.meta.json'), JSON.stringify(meta, null, 1) + '\n');

  console.log(`countries: ${countries.length} (ar: ${countries.filter((c) => c.ar).length})`);
  console.log(`subdivision files: ${files}`);
  const lb = byCountry.get('LB');
  console.log('LB subdivisions: ' + [...lb.values()].map((g) => g.code + '=' + (g.ar || g.en)).join(' | '));
}

const [countriesUp, statesUp] = await Promise.all([
  getJson(MLEDOZE_URL, 'countries'),
  getJson(DR5HN_URL, 'states'),
]);
main(countriesUp, statesUp);
