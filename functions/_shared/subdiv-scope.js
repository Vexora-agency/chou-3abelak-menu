/**
 * Delivery-subdivision scope — applies the admin's selected subdivisions
 * (governorates) to the search filter, not just to order-submit blocking.
 *
 * Data: hand-verified bounding boxes per ISO 3166-2 subdivision code,
 * sourced once from OpenStreetMap administrative boundaries
 * (`out bb` per relation) and committed here. Client and server share
 * nothing at runtime: the route post-filters every provider row by
 * coordinates, and the response carries `zoneScope` (country + boxes)
 * so the on-device indexes filter their rows the same way.
 *
 * Fail-open everywhere: unknown subdivisions, unknown countries, rows
 * without finite coordinates (e.g. Google predictions, resolved on pick),
 * and `subdivisions: 'ALL'` all pass through unfiltered. A wrongly hidden
 * street strands a paying customer; a wrongly shown one is still blocked
 * at submit by the zone check.
 */

/**
 * Bounding boxes as [minLat, minLng, maxLat, maxLng] per subdivision code.
 * Source: GADM v4.1 Lebanon level 1 (8 governorates) + level 2 union of
 * Kasrouane and Jubail districts for Keserwan-Jbeil (LB-KJ, split from
 * Mount Lebanon in 2017). Boxes are coarse allow-list filters — overlaps
 * between neighbours only ever ADD recall, never strand a valid street.
 * Absent entries simply never filter (fail open).
 */
export const SUBDIV_BBOXES = {
  LB: {
    'LB-AK': [34.2396, 35.748, 34.6914, 36.4638],
    'LB-BH': [33.8156, 35.8772, 34.523, 36.6218],
    'LB-BA': [33.8629, 35.4659, 33.9162, 35.5413],
    'LB-BI': [33.3455, 35.6081, 33.9345, 36.0993],
    'LB-KJ': [33.9404, 35.5945, 34.2113, 36.0139],
    'LB-JL': [33.4922, 35.3849, 34.2113, 36.0139],
    'LB-NA': [33.055, 35.2936, 33.5114, 35.7948],
    'LB-AS': [34.1267, 35.6469, 34.5127, 36.1829],
    'LB-JA': [33.0859, 35.1026, 33.5976, 35.6364],
  },
};

/** Uppercase 2-letter country code or '' (omit when unknown). */
function normCc(v) {
  if (typeof v !== 'string') return '';
  const code = v.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : '';
}

/** Subdivision code as stored by the admin (e.g. 'LB-JL'), trimmed. */
function normSubdiv(v) {
  if (typeof v !== 'string') return '';
  return v.trim().toUpperCase().slice(0, 12);
}

/**
 * Selected subdivisions per country from the stored menu:
 * { CC: 'ALL' | string[] }. Only the explicit `selected` zone list
 * counts — anything else means worldwide service and returns {}.
 * Never throws.
 */
export function extractServiceSubdivisions(menu) {
  try {
    const settings = menu && typeof menu === 'object' ? menu.settings : null;
    const ordering = settings && typeof settings === 'object' ? settings.ordering : null;
    const zones = ordering && typeof ordering === 'object' ? ordering.deliveryZones : null;
    if (!zones || typeof zones !== 'object' || zones.mode !== 'selected') return {};
    const list = Array.isArray(zones.countries) ? zones.countries : [];
    const out = {};
    for (const c of list) {
      if (!c || typeof c !== 'object') continue;
      const cc = normCc(c.cc);
      if (!cc) continue;
      const sub = c.subdivisions;
      if (sub === 'ALL' || sub === undefined || sub === null) {
        out[cc] = 'ALL';
        continue;
      }
      const codes = (Array.isArray(sub) ? sub : []).map(normSubdiv).filter(Boolean).slice(0, 50);
      out[cc] = codes.length > 0 ? [...new Set(codes)] : 'ALL';
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Active search scope from the menu: [{ cc, bboxes }] with at least one
 * known box, or null when nothing restricts the search (no menu, wrong
 * mode, every country ALL, or no known boxes). Never throws.
 */
export function buildZoneScope(menu) {
  try {
    const perCountry = extractServiceSubdivisions(menu);
    const out = [];
    for (const cc of Object.keys(perCountry)) {
      const sel = perCountry[cc];
      if (sel === 'ALL') continue;
      const known = SUBDIV_BBOXES[cc] && typeof SUBDIV_BBOXES[cc] === 'object' ? SUBDIV_BBOXES[cc] : null;
      if (!known) continue;
      const bboxes = [];
      for (const code of sel) {
        const b = known[code];
        if (Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === 'number' && Number.isFinite(n))) {
          bboxes.push(b);
        }
      }
      if (bboxes.length > 0) out.push({ cc, bboxes });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** True when (lat,lng) falls inside any of the boxes. Never throws. */
export function inScopeBoxes(lat, lng, bboxes) {
  try {
    if (typeof lat !== 'number' || !Number.isFinite(lat)) return false;
    if (typeof lng !== 'number' || !Number.isFinite(lng)) return false;
    if (!Array.isArray(bboxes)) return false;
    return bboxes.some((b) => Array.isArray(b) && b.length === 4
      && lat >= b[0] && lat <= b[2] && lng >= b[1] && lng <= b[3]);
  } catch {
    return false;
  }
}

/**
 * Keep rows inside ANY scope box; rows without finite coordinates pass
 * through (their zone is enforced at pick/submit, never by hiding).
 * Null scope (unrestricted) returns the input untouched. Never throws.
 */
export function filterRowsByScope(rows, scope) {
  try {
    if (!Array.isArray(scope) || scope.length === 0) return Array.isArray(rows) ? rows : [];
    const boxes = [];
    for (const entry of scope) {
      if (entry && Array.isArray(entry.bboxes)) boxes.push(...entry.bboxes);
    }
    if (boxes.length === 0) return Array.isArray(rows) ? rows : [];
    const list = Array.isArray(rows) ? rows : [];
    return list.filter((r) => {
      if (!r || typeof r !== 'object') return false;
      const lat = typeof r.lat === 'number' ? r.lat : NaN;
      const lng = typeof r.lng === 'number' ? r.lng : NaN;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return true;
      return inScopeBoxes(lat, lng, boxes);
    });
  } catch {
    return Array.isArray(rows) ? rows : [];
  }
}
