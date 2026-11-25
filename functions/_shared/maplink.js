/**
 * Google Maps shared-link resolver helpers (pure, no network).
 *
 * Customers paste links like https://maps.app.goo.gl/AbC123 or a full
 * https://www.google.com/maps/place/.../@31.2056,29.9246,17z URL.
 * The route (/api/geo/resolve-link) follows the redirect server-side,
 * extracts coordinates from the final URL, and validates the country.
 * Never logs the URL.
 */

const ALLOWED_HOSTS = new Set([
  'maps.google.com',
  'www.google.com',
  'maps.app.goo.gl',
  'goo.gl',
]);

/** Only Google Maps hosts may be resolved (SSRF guard). */
export function isAllowedMapsHost(host) {
  try {
    if (typeof host !== 'string') return false;
    return ALLOWED_HOSTS.has(host.trim().toLowerCase());
  } catch {
    return false;
  }
}

/** Validate a pasted link: http(s) URL on an allowed host, ≤ 2000 chars. */
export function validateMapsLinkUrl(raw) {
  try {
    if (typeof raw !== 'string') return null;
    const text = raw.trim();
    if (!text || text.length > 2000) return null;
    const u = new URL(text);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!isAllowedMapsHost(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

/**
 * Extract { lat, lng } from a Google Maps URL. Supports the @lat,lng
 * form, the !3dLAT!4dLNG form, and ?q=/​?ll= coordinate pairs.
 * Returns null when no finite in-range coordinates are found.
 */
export function extractCoordsFromGoogleUrl(raw) {
  try {
    const u = typeof raw === 'string' ? new URL(raw.trim()) : raw;
    if (!u || typeof u.href !== 'string') return null;
    const href = u.href;
    const finish = (lat, lng) => {
      const la = Number(lat);
      const ln = Number(lng);
      if (!Number.isFinite(la) || Math.abs(la) > 90) return null;
      if (!Number.isFinite(ln) || Math.abs(ln) > 180) return null;
      return { lat: Math.round(la * 1e5) / 1e5, lng: Math.round(ln * 1e5) / 1e5 };
    };
    let m = href.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,|$)/);
    if (m) {
      const c = finish(m[1], m[2]);
      if (c) return c;
    }
    m = href.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    if (m) {
      const c = finish(m[1], m[2]);
      if (c) return c;
    }
    for (const key of ['q', 'll', 'center', 'destination']) {
      const v = u.searchParams.get(key);
      if (typeof v !== 'string') continue;
      const parts = v.split(',');
      if (parts.length === 2) {
        const c = finish(parts[0].trim(), parts[1].trim());
        if (c) return c;
      }
    }
    return null;
  } catch {
    return null;
  }
}
