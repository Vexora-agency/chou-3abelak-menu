/**
 * Build a compact offline places library for a country/region from
 * OpenStreetMap (Overpass API): every named district, suburb, village,
 * town and city — the «areas» half of Talabat-style search, with zero
 * typing by the owner and zero network at query time.
 *
 * Run: node scripts/build-places-index.mjs --country=lb --id=places-lb --bbox=33.05,35.10,34.69,36.61
 *      node scripts/build-places-index.mjs --country=eg --id=places-eg-cities --bbox=21.9,24.7,31.7,35.2 --kinds=city,town,village --split=2 --append
 *
 * - Queries node+way place=* with a name tag, keeps the most significant
 *   record per normalized name (city > town > village > suburb >
 *   neighbourhood > quarter > hamlet), and writes
 *   public/data/places-index/<id>.json + manifest.json.
 * - Compact row: [nameAr, nameLatin|null, lat, lng, kind]. Coords round to
 *   5 decimals. Never logs coordinates (only counts).
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
const UA = 'chou-3abelak-menu/1.0 (places index build)';
const DEFAULT_KINDS = ['city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'quarter', 'isolated_dwelling'];
const KIND_RANK = { city: 0, town: 1, village: 2, suburb: 3, neighbourhood: 4, quarter: 5, hamlet: 6, isolated_dwelling: 7 };

function arg(name, fallback = '') {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

/** Same Arabic recall rules as the street index (alef unify, ة→ه, no tashkeel). */
function normName(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ً-ٰٟـ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

async function overpassQuery(q) {
  let last = null;
  for (const url of OVERPASS_URLS) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
          body: 'data=' + encodeURIComponent(q),
        });
        if (res.ok) return res;
        last = new Error(`overpass ${res.status} at ${url}`);
        if (res.status === 400 || res.status === 406) throw last;
      } catch (e) {
        last = e;
      }
      await new Promise((r) => setTimeout(r, 15000 * (attempt + 1)));
    }
  }
  throw last || new Error('overpass unreachable');
}

async function main() {
  const id = arg('id');
  const country = arg('country').toLowerCase();
  const kinds = arg('kinds', DEFAULT_KINDS.join(',')).split(',').map((k) => k.trim()).filter(Boolean);
  if (!id || !/^[a-z]{2}$/.test(country) || kinds.length === 0) {
    console.error('usage: node scripts/build-places-index.mjs --country=<cc> --id=<id> (--bbox=minLat,minLng,maxLat,maxLng | --center=lat,lng --radiusKm=N) [--kinds=city,town,...] [--split=N] [--append]');
    process.exit(1);
  }
  let minLat; let minLng; let maxLat; let maxLng;
  const centerRaw = arg('center');
  if (centerRaw) {
    const [cLat, cLng] = centerRaw.split(',').map(Number);
    const rKmRaw = Number(arg('radiusKm', '10'));
    const rKm = Number.isFinite(rKmRaw) && rKmRaw >= 1 && rKmRaw <= 100 ? rKmRaw : 10;
    if (!Number.isFinite(cLat) || Math.abs(cLat) > 90 || !Number.isFinite(cLng) || Math.abs(cLng) > 180) {
      console.error('usage: --center=lat,lng --radiusKm=N (1..100)');
      process.exit(1);
    }
    const dLat = rKm / 111;
    const dLng = rKm / (111.32 * Math.cos((cLat * Math.PI) / 180));
    minLat = cLat - dLat; minLng = cLng - dLng; maxLat = cLat + dLat; maxLng = cLng + dLng;
  } else {
    const parts = arg('bbox').split(',').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      console.error('usage: node scripts/build-places-index.mjs --country=<cc> --id=<id> (--bbox=... | --center=lat,lng [--radiusKm=N]) [--kinds=...] [--split=N] [--append]');
      process.exit(1);
    }
    [minLat, minLng, maxLat, maxLng] = parts;
  }
  const kindRe = `^(${kinds.map((k) => k.replace(/[^a-z_]/g, '')).filter(Boolean).join('|')})$`;
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
  const append = process.argv.includes('--append');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dir = path.join('public', 'data', 'places-index');
  fs.mkdirSync(dir, { recursive: true });

  const seen = new Map();
  const file = path.join(dir, `${id}.json`);
  if (append) {
    try {
      const prev = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (prev && Array.isArray(prev.entries)) {
        for (const row of prev.entries) {
          if (!Array.isArray(row) || row.length < 5) continue;
          const key = `${normName(row[0] || '')}|${String(row[4] || '')}`;
          if (key.replace('|', '') && !seen.has(key)) seen.set(key, row);
        }
      }
    } catch {}
  }

  let wayCount = 0;
  for (const [a, b, c, d] of tiles) {
    const q = `[out:json][timeout:180];(node["place"~"${kindRe}"]["name"](${a},${b},${c},${d});way["place"~"${kindRe}"]["name"](${a},${b},${c},${d}););out center tags;`;
    const res = await overpassQuery(q);
    const json = await res.json();
    const elements = Array.isArray(json.elements) ? json.elements : [];
    wayCount += elements.length;
    for (const el of elements) {
      if (!el || (el.type !== 'node' && el.type !== 'way') || !el.tags) continue;
      const tags = el.tags;
      const kind = typeof tags.place === 'string' ? tags.place : '';
      if (!kinds.includes(kind)) continue;
      const ar = typeof tags['name:ar'] === 'string' && tags['name:ar'].trim() ? tags['name:ar'].trim() : null;
      const raw = typeof tags.name === 'string' ? tags.name.trim() : '';
      if (!raw) continue;
      const isArabic = /[\u0600-\u06FF]/.test(raw);
      const nameAr = (ar || (isArabic ? raw : '')).slice(0, 120);
      const nameLatin = (!isArabic ? raw : (ar && raw !== ar ? raw : '')).slice(0, 120) || null;
      if (!nameAr && !nameLatin) continue;
      let lat = NaN;
      let lon = NaN;
      if (el.type === 'node') {
        lat = el.lat;
        lon = el.lon;
      } else if (el.center) {
        lat = el.center.lat;
        lon = el.center.lon;
      }
      if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) continue;
      const key = `${normName(nameAr).toLowerCase()}|${(nameLatin || '').toLowerCase()}`;
      if (!key.replace('|', '')) continue;
      const rank = KIND_RANK[kind] !== undefined ? KIND_RANK[kind] : 8;
      const row = [nameAr, nameLatin, Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, kind];
      const prevRow = seen.get(key);
      if (!prevRow || rank < (KIND_RANK[prevRow[4]] !== undefined ? KIND_RANK[prevRow[4]] : 8)) {
        seen.set(key, row);
      }
    }
  }

  const entries = [...seen.values()].sort((a, b) => String(a[0] || a[1]).localeCompare(String(b[0] || b[1]), 'ar'));
  const payload = { id, country, cityAr: '', cityEn: '', count: entries.length, entries };
  fs.writeFileSync(file, JSON.stringify(payload));

  let manifest = { indexes: [], attribution: '© OpenStreetMap contributors (ODbL)' };
  const mpath = path.join(dir, 'manifest.json');
  try {
    manifest = JSON.parse(fs.readFileSync(mpath, 'utf8'));
    if (!Array.isArray(manifest.indexes)) manifest.indexes = [];
  } catch {}
  manifest.attribution = '© OpenStreetMap contributors (ODbL)';
  let bbox = [minLat, minLng, maxLat, maxLng];
  const prevEntry = manifest.indexes.find((x) => x && x.id === id);
  if (append && prevEntry && Array.isArray(prevEntry.bbox) && prevEntry.bbox.length === 4
    && prevEntry.bbox.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    const [p0, p1, p2, p3] = prevEntry.bbox;
    bbox = [Math.min(p0, minLat), Math.min(p1, minLng), Math.max(p2, maxLat), Math.max(p3, maxLng)];
  }
  manifest.indexes = manifest.indexes.filter((x) => x && x.id !== id);
  manifest.indexes.push({ id, country, bbox, count: entries.length, kinds });
  fs.writeFileSync(mpath, JSON.stringify(manifest));
  console.log(`places-index: ${id} elements=${wayCount} places=${entries.length}`);
}

main().catch((e) => {
  console.error('places-index build failed');
  process.exit(1);
});
