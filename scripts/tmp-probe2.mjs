const BBOX = '33.05,35.10,34.69,36.61';
const URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
async function q(ql) {
  for (const url of URLS) {
    for (let a = 0; a < 3; a += 1) {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 110000);
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'chou-3abelak-menu/1.0 (probe)' },
          body: 'data=' + encodeURIComponent(ql),
          signal: ctl.signal,
        });
        clearTimeout(t);
        if (r.ok) return await r.json();
      } catch {}
      await new Promise((r) => setTimeout(r, 5000 * (a + 1)));
    }
  }
  return null;
}
for (const kind of ['locality', 'farm', 'borough', 'municipality', 'islet']) {
  const j = await q(`[out:json][timeout:100];(node["place"="${kind}"]["name"](${BBOX});way["place"="${kind}"]["name"](${BBOX}););out ids;`);
  console.log(kind, j && Array.isArray(j.elements) ? j.elements.length : 'FAIL');
}
// Tag sample: which extra name tags do Lebanese places carry?
const s = await q(`[out:json][timeout:100];node["place"](33.85,35.45,33.92,35.58);out tags;`);
if (s && Array.isArray(s.elements)) {
  const tags = {};
  let n = 0;
  for (const el of s.elements) {
    if (!el.tags || !el.tags.name) continue;
    n += 1;
    for (const k of Object.keys(el.tags)) {
      if (k === 'name' || k.startsWith('name:') || k === 'alt_name') tags[k] = (tags[k] || 0) + 1;
    }
    if (n >= 60) break;
  }
  console.log('sampled', n, JSON.stringify(tags));
  for (const el of s.elements.slice(0, 8)) {
    if (el.tags && el.tags.name) console.log('-', el.tags.name, '|', el.tags['name:ar'] || '', '|', el.tags['name:en'] || '', '|', el.tags.place);
  }
} else {
  console.log('sample FAIL');
}
