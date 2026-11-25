/**
 * Owner-curated delivery places (areas & landmarks) repository.
 *
 * Pure D1 access — no HTTP, no logging. All functions never throw for
 * missing tables (fresh installs read as empty) but validation errors are
 * returned as { ok:false, error } so routes can answer 400 precisely.
 */

const KINDS = new Set(['area', 'landmark', 'street']);
const MAX_NAME = 80;

function cleanName(v) {
  return typeof v === 'string' ? v.trim().slice(0, MAX_NAME) : '';
}

function cleanCoords(lat, lng) {
  const la = typeof lat === 'string' ? Number(lat.trim()) : lat;
  const ln = typeof lng === 'string' ? Number(lng.trim()) : lng;
  if (typeof la !== 'number' || !Number.isFinite(la) || Math.abs(la) > 90) return null;
  if (typeof ln !== 'number' || !Number.isFinite(ln) || Math.abs(ln) > 180) return null;
  return { lat: Math.round(la * 1e5) / 1e5, lng: Math.round(ln * 1e5) / 1e5 };
}

/** Normalize both sides of a name match: alef unify, ة→ه, ى→ي, no tashkeel. */
export function normalizePlaceText(s) {
  try {
    if (typeof s !== 'string') return '';
    return s
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/[ً-ٰٟـ]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}

function mapRow(r) {  return {
    id: r.id,
    name_ar: r.name_ar,
    name_en: typeof r.name_en === 'string' && r.name_en ? r.name_en : null,
    lat: r.lat,
    lng: r.lng,
    kind: KINDS.has(r.kind) ? r.kind : 'landmark',
    created_at: typeof r.created_at === 'string' ? r.created_at : null,
    updated_at: typeof r.updated_at === 'string' ? r.updated_at : null,
  };
}

/** All places, newest first (tables are tiny — capped at 500). */
export async function listCustomPlaces(db) {
  try {
    const res = await db
      .prepare('SELECT id, name_ar, name_en, lat, lng, kind, created_at, updated_at FROM custom_places ORDER BY created_at DESC LIMIT 500')
      .all();
    const rows = (res && res.results) || [];
    return rows.filter((r) => r && typeof r.name_ar === 'string' && r.name_ar).map(mapRow);
  } catch {
    return [];
  }
}

/**
 * Owner places matching a customer query (substring on normalized names,
 * Arabic and Latin), most recent first, capped at 6 for the suggestion
 * list. Never throws (empty on any failure).
 */
export async function searchCustomPlaces(db, q, lang) {
  try {
    if (!db) return [];
    const needle = normalizePlaceText(q);
    if (needle.length < 2) return [];
    const all = await listCustomPlaces(db);
    const out = [];
    for (const p of all) {
      const ar = normalizePlaceText(p.name_ar);
      const en = normalizePlaceText(p.name_en || '');
      if ((ar && ar.includes(needle)) || (en && en.includes(needle))) {
        out.push(p);
        if (out.length >= 6) break;
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Owner place → client suggestion row: { label, line1, line2, lat, lng }.
 * line2 marks the saved place («مكان محفوظ»); the other-language name
 * rides as details when present. Null for unusable rows. Never throws.
 */
export function customPlaceToSuggestion(p, lang) {
  try {
    if (!p || typeof p !== 'object') return null;
    const ar = typeof p.name_ar === 'string' ? p.name_ar.trim() : '';
    const en = typeof p.name_en === 'string' ? p.name_en.trim() : '';
    const name = lang === 'ar' ? ar || en : en || ar;
    if (!name) return null;
    if (typeof p.lat !== 'number' || !Number.isFinite(p.lat)) return null;
    if (typeof p.lng !== 'number' || !Number.isFinite(p.lng)) return null;
    const item = {
      label: name.slice(0, 120),
      line1: name.slice(0, 120),
      line2: lang === 'ar' ? 'مكان محفوظ' : 'Saved place',
      lat: p.lat,
      lng: p.lng,
    };
    const alt = lang === 'ar' ? en : ar;
    if (alt && alt !== name) item.details = alt.slice(0, 120);
    return item;
  } catch {
    return null;
  }
}

export function validateCustomPlace(body) {
  const b = body && typeof body === 'object' ? body : {};
  const nameAr = cleanName(b.name_ar);
  if (nameAr.length < 2) return { ok: false, error: 'invalid_name' };
  const nameEn = cleanName(b.name_en);
  const coords = cleanCoords(b.lat, b.lng);
  if (!coords) return { ok: false, error: 'invalid_coords' };
  const kind = typeof b.kind === 'string' && KINDS.has(b.kind.trim().toLowerCase())
    ? b.kind.trim().toLowerCase()
    : 'landmark';
  return { ok: true, value: { name_ar: nameAr, name_en: nameEn || null, ...coords, kind } };
}

/** Insert a place. Returns { ok:true, place } or { ok:false, error }. */
export async function addCustomPlace(db, body) {
  const v = validateCustomPlace(body);
  if (!v.ok) return v;
  try {
    const now = new Date().toISOString();
    const res = await db
      .prepare('INSERT INTO custom_places (name_ar, name_en, lat, lng, kind, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
      .bind(v.value.name_ar, v.value.name_en, v.value.lat, v.value.lng, v.value.kind, now)
      .run();
    const id = res && res.meta && typeof res.meta.last_row_id === 'number' ? res.meta.last_row_id : null;
    return { ok: true, place: { id, ...v.value, created_at: now, updated_at: null } };
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}

/** Rename/retag a place (coords immutable — delete + re-add to move a pin). */
export async function updateCustomPlace(db, id, body) {
  const numId = typeof id === 'string' ? Number(id) : id;
  if (!Number.isInteger(numId) || numId <= 0) return { ok: false, error: 'invalid_id' };
  const b = body && typeof body === 'object' ? body : {};
  const nameAr = cleanName(b.name_ar);
  if (nameAr.length < 2) return { ok: false, error: 'invalid_name' };
  const nameEn = cleanName(b.name_en);
  const kind = typeof b.kind === 'string' && KINDS.has(b.kind.trim().toLowerCase())
    ? b.kind.trim().toLowerCase()
    : 'landmark';
  try {
    const now = new Date().toISOString();
    const res = await db
      .prepare('UPDATE custom_places SET name_ar = ?1, name_en = ?2, kind = ?3, updated_at = ?4 WHERE id = ?5')
      .bind(nameAr, nameEn || null, kind, now, numId)
      .run();
    const changed = res && res.meta ? res.meta.changes : 0;
    if (changed !== 1) return { ok: false, error: 'not_found' };
    return { ok: true, place: { id: numId, name_ar: nameAr, name_en: nameEn || null, kind, updated_at: now } };
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}

/** Delete a place. Returns true only when a row was removed. */
export async function removeCustomPlace(db, id) {
  try {
    const numId = typeof id === 'string' ? Number(id) : id;
    if (!Number.isInteger(numId) || numId <= 0) return false;
    const res = await db.prepare('DELETE FROM custom_places WHERE id = ?1').bind(numId).run();
    const changed = res && res.meta ? res.meta.changes : 0;
    return changed === 1;
  } catch {
    return false;
  }
}
