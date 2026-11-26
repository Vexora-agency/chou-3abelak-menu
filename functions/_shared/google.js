/**
 * Google Places (New API) helpers — PRIMARY external suggestion pass.
 *
 * Order in the route: owner places → Google → Photon (free, keyless).
 * Geoapify was retired from this path by owner decision.
 *
 * Professional usage notes (per the official Places API (New) docs):
 * - Session tokens group one user's autocomplete keystrokes + the final
 *   place-details call into a billing session (client mints a UUID per
 *   search, the server forwards it as `sessionToken` to both calls).
 * - Soft `locationBias` from the live map viewport ranks nearby results
 *   first without ever excluding correctly-typed places; `regionCode`
 *   formats results, `includedRegionCodes` hard-restricts to the admin's
 *   delivery countries (every selected zone country, never outside).
 * - Field masks on both calls return only what the UI needs.
 * - Attribution must read exactly "Google Maps" (never localized).
 *
 * The key travels only in the server-to-server X-Goog-Api-Key header.
 * Coordinates resolve once on PICK via place-details — never per keystroke.
 */

const PLACES_AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const PLACES_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const PLACE_DETAILS_URL = 'https://places.googleapis.com/v1/places/';
const REQUEST_TIMEOUT_MS = 6000;
const MAX_LABEL_CHARS = 120;
export const GOOGLE_RESULT_LIMIT = 6;

const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,200}$/;

/** Trimmed string env read (per request). Returns '' when missing. */
export function trimGoogleEnv(env, key) {
  const value = env && typeof env[key] === 'string' ? env[key].trim() : '';
  return value;
}

/** True when a non-empty GOOGLE_PLACES_API_KEY is present. */
export function isGoogleConfigured(env) {
  return !!trimGoogleEnv(env, 'GOOGLE_PLACES_API_KEY');
}

/** Shared daily budget for autocomplete + details calls (default 300). */
export function googleDailyMax(env) {
  const raw = env && typeof env.GOOGLE_PLACES_DAILY_MAX === 'string'
    ? env.GOOGLE_PLACES_DAILY_MAX.trim()
    : env && env.GOOGLE_PLACES_DAILY_MAX;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 300;
}

/** 'ar' passes through, everything else falls back to 'en'. */
export function normalizeGoogleLang(lang) {
  return typeof lang === 'string' && lang.trim().toLowerCase() === 'ar' ? 'ar' : 'en';
}

/** Place IDs are URL-safe tokens; anything else is rejected (no lookup). */
export function validatePlaceId(v) {
  return typeof v === 'string' && PLACE_ID_RE.test(v) ? v : null;
}

/** Session token: user-generated billing-session id (UUID from the client). */
export function validateSessionToken(v) {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null;
}

/** Uppercase 2-letter region code or '' (omit the filter when unknown). */
export function normalizeRegionCode(v) {
  if (typeof v !== 'string') return '';
  const code = v.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : '';
}

/**
 * Uppercase 2-letter region list (unique, capped at 10) from a single code
 * or an array. Accepts the admin's full delivery-zone country list so the
 * search stays inside every country the owner sells in — never outside.
 */
export function normalizeRegionCodes(v) {
  const list = Array.isArray(v) ? v : [v];
  const out = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const code = item.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(code) && !out.includes(code)) out.push(code);
    if (out.length >= 10) break;
  }
  return out;
}

function trimText(v) {
  return typeof v === 'string' ? v.trim().slice(0, MAX_LABEL_CHARS) : '';
}

/**
 * Map a Places autocomplete response to client rows. Coordinates are
 * ALWAYS null here — resolution happens once on pick via place-details.
 * Drops predictions without a usable placeId + text. Never throws.
 */
export function sanitizeGooglePredictions(json) {
  const list = json && typeof json === 'object' && Array.isArray(json.suggestions) ? json.suggestions : [];
  const out = [];
  for (const s of list) {
    if (!s || typeof s !== 'object') continue;
    const p = s.placePrediction && typeof s.placePrediction === 'object' ? s.placePrediction : null;
    if (!p) continue;
    const placeId = validatePlaceId(p.placeId);
    if (!placeId) continue;
    const text = trimText(p.text && typeof p.text === 'object' ? p.text.text : '');
    if (!text) continue;
    const fmt = p.structuredFormat && typeof p.structuredFormat === 'object' ? p.structuredFormat : null;
    const main = trimText(fmt && fmt.mainText && typeof fmt.mainText === 'object' ? fmt.mainText.text : '');
    const secondary = trimText(fmt && fmt.secondaryText && typeof fmt.secondaryText === 'object' ? fmt.secondaryText.text : '');
    out.push({
      label: text,
      line1: main || text,
      line2: secondary,
      lat: null,
      lng: null,
      placeId,
    });
    if (out.length >= GOOGLE_RESULT_LIMIT) break;
  }
  return out;
}

/**
 * Map a Place Details response to { lat, lng, label }. Null when the
 * location is missing or non-finite. Never throws.
 */
export function sanitizePlaceDetails(json) {
  try {
    if (!json || typeof json !== 'object') return null;
    const loc = json.location && typeof json.location === 'object' ? json.location : null;
    if (!loc) return null;
    const lat = Number(loc.latitude);
    const lng = Number(loc.longitude);
    if (!Number.isFinite(lat) || Math.abs(lat) > 90) return null;
    if (!Number.isFinite(lng) || Math.abs(lng) > 180) return null;
    const name = trimText(json.displayName && typeof json.displayName === 'object' ? json.displayName.text : '');
    const addr = trimText(typeof json.formattedAddress === 'string' ? json.formattedAddress : '');
    return { lat, lng, label: addr || name || `${lat}, ${lng}` };
  } catch {
    return null;
  }
}

/**
 * Server-side Places autocomplete call. Never throws, never logs the key
 * or query. Accepts { text, lang, bias, region, sessionToken } — the
 * viewport bias is a soft ranking hint only, never a fence: correctly
 * typed places are never excluded. Result: { ok:true, results } or
 * { ok:false, error }.
 */
export async function fetchGoogleAutocomplete(env, params, fetchFn = fetch) {
  try {
    if (!isGoogleConfigured(env)) return { ok: false, error: 'not_configured' };
    const opts = params && typeof params === 'object' ? params : {};
    const raw = typeof opts.text === 'string' ? opts.text.trim() : '';
    if (raw.length < 3 || raw.length > 100) return { ok: false, error: 'bad_query' };
    const lang = normalizeGoogleLang(opts.lang);
    const body = {
      input: raw,
      languageCode: lang,
    };
    const regions = normalizeRegionCodes(
      Array.isArray(opts.regions) && opts.regions.length > 0 ? opts.regions : opts.region,
    );
    if (regions.length > 0) {
      body.includedRegionCodes = regions;
      body.regionCode = regions[0].toLowerCase();
    }
    const bias = opts.bias && typeof opts.bias === 'object' ? opts.bias : null;
    const lat = bias ? bias.lat : NaN;
    const lng = bias ? bias.lng : NaN;
    if (typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90
      && typeof lng === 'number' && Number.isFinite(lng) && Math.abs(lng) <= 180) {
      body.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 20000.0 } };
    }
    const sessionToken = validateSessionToken(opts.sessionToken);
    if (sessionToken) body.sessionToken = sessionToken;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      try {
        controller.abort();
      } catch {}
    }, REQUEST_TIMEOUT_MS);
    try {
      const res = await fetchFn(PLACES_AUTOCOMPLETE_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': trimGoogleEnv(env, 'GOOGLE_PLACES_API_KEY'),
          'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat',
        },
        body: JSON.stringify(body),
      });
      if (!res || !res.ok) return { ok: false, error: 'failed' };
      let json = null;
      try {
        json = await res.json();
      } catch {
        return { ok: false, error: 'failed' };
      }
      return { ok: true, results: sanitizeGooglePredictions(json) };
    } catch {
      return { ok: false, error: 'failed' };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { ok: false, error: 'failed' };
  }
}

/**
 * Text Search (places:searchText) fallback for detailed multi-results:
 * Autocomplete returns at most 5 predictions BY DESIGN, so when it stays
 * thin this pass fetches up to TEXT_SEARCH_LIMIT full places (name +
 * formatted address + coordinates included — no follow-up call needed to
 * pin). Same { text, lang, bias, region } shaping as
 * autocomplete. Never throws, never logs key/query.
 */
export const TEXT_SEARCH_LIMIT = 10;

export function sanitizeTextSearch(json) {
  const list = json && typeof json === 'object' && Array.isArray(json.places) ? json.places : [];
  const out = [];
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const placeId = validatePlaceId(p.id);
    if (!placeId) continue;
    const name = trimText(p.displayName && typeof p.displayName === 'object' ? p.displayName.text : '');
    const addr = trimText(typeof p.formattedAddress === 'string' ? p.formattedAddress : '');
    const label = addr || name;
    if (!label) continue;
    const loc = p.location && typeof p.location === 'object' ? p.location : null;
    const lat = loc ? Number(loc.latitude) : NaN;
    const lng = loc ? Number(loc.longitude) : NaN;
    if (!Number.isFinite(lat) || Math.abs(lat) > 90) continue;
    if (!Number.isFinite(lng) || Math.abs(lng) > 180) continue;
    out.push({
      label: label.slice(0, MAX_LABEL_CHARS),
      line1: (name || label).slice(0, MAX_LABEL_CHARS),
      line2: (addr && addr !== name ? addr : '').slice(0, MAX_LABEL_CHARS),
      lat,
      lng,
      placeId,
    });
    if (out.length >= TEXT_SEARCH_LIMIT) break;
  }
  return out;
}

export async function fetchTextSearch(env, params, fetchFn = fetch) {
  try {
    if (!isGoogleConfigured(env)) return { ok: false, error: 'not_configured' };
    const opts = params && typeof params === 'object' ? params : {};
    const raw = typeof opts.text === 'string' ? opts.text.trim() : '';
    if (raw.length < 6 || raw.length > 100) return { ok: false, error: 'bad_query' };
    const body = {
      textQuery: raw,
      languageCode: normalizeGoogleLang(opts.lang),
      pageSize: TEXT_SEARCH_LIMIT,
    };
    const regions = normalizeRegionCodes(
      Array.isArray(opts.regions) && opts.regions.length > 0 ? opts.regions : opts.region,
    );
    if (regions.length > 0) {
      body.includedRegionCodes = regions;
      body.regionCode = regions[0].toLowerCase();
    }
    const biasTs = opts.bias && typeof opts.bias === 'object' ? opts.bias : null;
    const latTs = biasTs ? biasTs.lat : NaN;
    const lngTs = biasTs ? biasTs.lng : NaN;
    if (typeof latTs === 'number' && Number.isFinite(latTs) && Math.abs(latTs) <= 90
      && typeof lngTs === 'number' && Number.isFinite(lngTs) && Math.abs(lngTs) <= 180) {
      body.locationBias = { circle: { center: { latitude: latTs, longitude: lngTs }, radius: 20000.0 } };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      try {
        controller.abort();
      } catch {}
    }, REQUEST_TIMEOUT_MS);
    try {
      const res = await fetchFn(PLACES_TEXT_SEARCH_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': trimGoogleEnv(env, 'GOOGLE_PLACES_API_KEY'),
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.id',
        },
        body: JSON.stringify(body),
      });
      if (!res || !res.ok) return { ok: false, error: 'failed' };
      let json = null;
      try {
        json = await res.json();
      } catch {
        return { ok: false, error: 'failed' };
      }
      return { ok: true, results: sanitizeTextSearch(json) };
    } catch {
      return { ok: false, error: 'failed' };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { ok: false, error: 'failed' };
  }
}

/**
 * Server-side Place Details call (one per PICK, never per keystroke,
 * same sessionToken to close the billing session). Never throws and never
 * logs the key. Result: { ok:true, ...coords } or
 * { ok:false, error: 'bad_query' | 'failed' | 'not_configured' }.
 */
export async function fetchPlaceDetails(env, params, fetchFn = fetch) {
  try {
    if (!isGoogleConfigured(env)) return { ok: false, error: 'not_configured' };
    const opts = params && typeof params === 'object' ? params : {};
    const placeId = validatePlaceId(opts.placeId);
    if (!placeId) return { ok: false, error: 'bad_query' };
    let url = `${PLACE_DETAILS_URL}${encodeURIComponent(placeId)}?fields=location,displayName,formattedAddress`;
    const sessionToken = validateSessionToken(opts.sessionToken);
    if (sessionToken) url += `&sessionToken=${encodeURIComponent(sessionToken)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      try {
        controller.abort();
      } catch {}
    }, REQUEST_TIMEOUT_MS);
    try {
      const res = await fetchFn(url, {
        signal: controller.signal,
        headers: { 'X-Goog-Api-Key': trimGoogleEnv(env, 'GOOGLE_PLACES_API_KEY') },
      });
      if (!res || !res.ok) return { ok: false, error: 'failed' };
      let json = null;
      try {
        json = await res.json();
      } catch {
        return { ok: false, error: 'failed' };
      }
      const coords = sanitizePlaceDetails(json);
      if (!coords) return { ok: false, error: 'failed' };
      return { ok: true, ...coords };
    } catch {
      return { ok: false, error: 'failed' };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { ok: false, error: 'failed' };
  }
}
