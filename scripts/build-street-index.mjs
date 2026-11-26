/**
 * Build a compact local street index for one delivery region from
 * OpenStreetMap (Overpass API), so side streets suggest instantly —
 * before (and without) any provider round-trip.
 *
 * Run: node scripts/build-street-index.mjs --bbox=31.19,29.93,31.24,30.00 --id=alex-east --cityAr="الإسكندرية" --cityEn="Alexandria" --country=eg
 *
 * - Queries named highways (any highway=* with a name tag) with way
 *   centers, dedupes segments sharing one normalized name, and writes
 *   public/data/street-index/<id>.json + manifest.json.
 * - Compact row: [nameAr, nameLatin|null, lat, lng]. Names cap at 120 chars,
 *   coords round to 5 decimals. Never logs coordinates (only counts).
 * - Center on the restaurant pin from the admin map with a generous radius
 *   (--center=lat,lng --radiusKm=N, bbox derived automatically) so the
 *   index covers the whole delivery area with room to spare.
 * - --append merges into an existing file: build large areas quadrant by
 *   quadrant across separate runs (busy Overpass servers drop big queries).
 * - ODbL data: the manifest carries the OpenStreetMap attribution that the
 *   client must keep (the map tiles already credit OSM).
 */

const OVERPASS_URLS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
const UA = 'chou-3abelak-menu/1.0 (street index build)';

async function overpassQuery(q) {
  let last = null;
  for (const url of OVERPASS_URLS) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const ctl = new AbortController();
      // Client-side ceiling above the server [timeout]: a hanging mirror
      // must fail fast to the next one instead of stalling the run forever.
      const timer = setTimeout(() => {
        try {
          ctl.abort();
        } catch {}
      }, 150000);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
          body: 'data=' + encodeURIComponent(q),
          signal: ctl.signal,
        });
        clearTimeout(timer);
        if (res.ok) return res;
        last = new Error(`overpass ${res.status} at ${url}`);
        if (res.status === 400 || res.status === 406) throw last;
      } catch (e) {
        clearTimeout(timer);
        last = e;
      }
      await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
    }
  }
  throw last || new Error('overpass unreachable');
}

function arg(name, fallback = '') {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

/** Same Arabic recall rules as the client index (alef unify, ة→ه, no tashkeel). */
function normName(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ً-ٰٟـ]/g, '').replace(/\s+/g, ' ').trim();
}

async function main() {
  const id = arg('id');
  const cityAr = arg('cityAr');
  const cityEn = arg('cityEn');
  const country = arg('country').toLowerCase();
  const append = process.argv.includes('--append');
  // Explicit bbox, or derived from the restaurant pin (--center) with a
  // generous radius (--radiusKm, default 10): the index then covers the
  // whole delivery area with room to spare.
  let minLat; let minLng; let maxLat; let maxLng;
  const centerRaw = arg('center');
  if (centerRaw) {
    const [cLat, cLng] = centerRaw.split(',').map(Number);
    const rKmRaw = Number(arg('radiusKm', '10'));
    const rKm = Number.isFinite(rKmRaw) && rKmRaw >= 1 && rKmRaw <= 50 ? rKmRaw : 10;
    if (!Number.isFinite(cLat) || Math.abs(cLat) > 90 || !Number.isFinite(cLng) || Math.abs(cLng) > 180) {
      console.error('usage: --center=lat,lng --radiusKm=N (1..50)');
      process.exit(1);
    }
    const dLat = rKm / 111;
    const dLng = rKm / (111.32 * Math.cos((cLat * Math.PI) / 180));
    minLat = cLat - dLat; minLng = cLng - dLng; maxLat = cLat + dLat; maxLng = cLng + dLng;
  } else {
    const parts = arg('bbox').split(',').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      console.error('usage: node scripts/build-street-index.mjs (--bbox=minLat,minLng,maxLat,maxLng | --center=lat,lng [--radiusKm=N]) --id=<id> --cityAr=<ar> --cityEn=<en> --country=<cc> [--split=N] [--append]');
      process.exit(1);
    }
    [minLat, minLng, maxLat, maxLng] = parts;
  }
  if (!id || !cityAr || !country) {
    console.error('usage: node scripts/build-street-index.mjs (--bbox=... | --center=lat,lng [--radiusKm=N]) --id=<id> --cityAr=<ar> --cityEn=<en> --country=<cc> [--split=N] [--append]');
    process.exit(1);
  }
  // Tile big regions: small queries survive busy Overpass servers where one
  // big query times out. --split=2 yields 2x2 tiles merged below.
  const splitRaw = Number(arg('split', '1'));
  const split = Number.isInteger(splitRaw) && splitRaw >= 1 && splitRaw <= 4 ? splitRaw : 1;
  const tiles = [];
  for (let i = 0; i < split; i += 1) {
    for (let j = 0; j < split; j += 1) {
      tiles.push([
        minLat + ((maxLat - minLat) * i) / split,
        minLng + ((maxLng - minLng) * j) / split,
        minLat + ((maxLat - minLat) * (i + 1)) / split,
        minLng + ((maxLng - minLng) * (j + 1)) / split,
      ]);
    }
  }
  const elements = [];
  for (const [a, b, c, d] of tiles) {
    const q = `[out:json][timeout:120];way["highway"]["name"](${a},${b},${c},${d});out center tags;`;
    const res = await overpassQuery(q);
    const json = await res.json();
    if (Array.isArray(json.elements)) elements.push(...json.elements);
  }

  const seen = new Map();
  for (const el of elements) {
    if (!el || el.type !== 'way' || !el.tags) continue;
    const tags = el.tags;
    const ar = typeof tags['name:ar'] === 'string' && tags['name:ar'].trim() ? tags['name:ar'].trim() : null;
    const raw = typeof tags.name === 'string' ? tags.name.trim() : '';
    if (!raw) continue;
    const isArabic = /[\u0600-\u06FF]/.test(raw);
    const nameAr = (ar || (isArabic ? raw : '')).slice(0, 120);
    const nameLatin = (!isArabic ? raw : (ar && raw !== ar ? raw : '')).slice(0, 120) || null;
    if (!nameAr && !nameLatin) continue;
    const c = el.center;
    if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
    const key = `${normName(nameAr).toLowerCase()}|${(nameLatin || '').toLowerCase()}`;
    if (!key.replace('|', '')) continue;
    if (seen.has(key)) continue; // one row per street: segments share a name
    seen.set(key, [
      nameAr,
      nameLatin,
      Math.round(c.lat * 1e5) / 1e5,
      Math.round(c.lon * 1e5) / 1e5,
    ]);
  }

  const entries = [...seen.values()].sort((a, b) => String(a[0] || a[1]).localeCompare(String(b[0] || b[1]), 'ar'));
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dir = path.join('public', 'data', 'street-index');
  fs.mkdirSync(dir, { recursive: true });
  // --append: keep streets gathered by earlier quadrant runs (busy servers
  // drop big queries, so large areas are built tile by tile, then merged).
  if (append) {
    try {
      const prev = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'));
      if (prev && Array.isArray(prev.entries)) {
        for (const row of prev.entries) {
          if (!Array.isArray(row) || row.length < 4) continue;
          const key = `${normName(row[0] || '').toLowerCase()}|${String(row[1] || '').toLowerCase()}`;
          if (key.replace('|', '') && !seen.has(key)) seen.set(key, row);
        }
      }
    } catch {}
    entries.length = 0;
    entries.push(...[...seen.values()].sort((a, b) => String(a[0] || a[1]).localeCompare(String(b[0] || b[1]), 'ar')));
  }
  const payload = { id, cityAr, cityEn, country, count: entries.length, entries };
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(payload));

  // Manifest: which index covers a query (country match or bias-in-bbox).
  let manifest = { indexes: [], attribution: '© OpenStreetMap contributors (ODbL)' };
  const mpath = path.join(dir, 'manifest.json');
  try {
    manifest = JSON.parse(fs.readFileSync(mpath, 'utf8'));
    if (!Array.isArray(manifest.indexes)) manifest.indexes = [];
  } catch {}
  manifest.attribution = '© OpenStreetMap contributors (ODbL)';
  const prevEntry = manifest.indexes.find((x) => x && x.id === id);
  let bbox = [minLat, minLng, maxLat, maxLng];
  // --append across quadrant runs: the manifest keeps the UNION bbox so the
  // client loads the index for any viewport inside the whole built area.
  if (append && prevEntry && Array.isArray(prevEntry.bbox) && prevEntry.bbox.length === 4
    && prevEntry.bbox.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    const [a, b, c, d] = prevEntry.bbox;
    bbox = [Math.min(a, minLat), Math.min(b, minLng), Math.max(c, maxLat), Math.max(d, maxLng)];
  }
  manifest.indexes = manifest.indexes.filter((x) => x && x.id !== id);
  manifest.indexes.push({ id, country, cityAr, cityEn, bbox, count: entries.length });
  fs.writeFileSync(mpath, JSON.stringify(manifest));
  console.log(`street-index: ${id} ways=${elements.length} streets=${entries.length}`);
}

main().catch((e) => {
  console.error('street-index build failed');
  process.exit(1);
});
