/**
 * Open Location Code (Plus Codes) encoder — Google's open, offline,
 * quota-free precise-location format. A pin becomes a short shareable
 * string ("7FG4GQ22+22") the driver pastes into any maps app.
 * Self-contained implementation of the public OLC algorithm (pair
 * encoding + grid refinement), no dependency and no network.
 */

const CODE_ALPHABET = '23456789CFGHJMPQRVWX';
const SEPARATOR = '+';
const SEPARATOR_POSITION = 8;
const LATITUDE_MAX = 90;
const LONGITUDE_MAX = 180;
const PAIR_RESOLUTIONS = [20.0, 1.0, 0.05, 0.0025, 0.000125];
const GRID_COLUMNS = 4;
const GRID_ROWS = 5;
const GRID_SIZE_DEGREES = 0.000125;

/**
 * Encode lat/lng to a full Open Location Code (default 10 significant
 * digits ≈ 13.5 m × 13.5 m — right for a delivery pin; 11 adds grid
 * refinement). Returns '' for non-finite input. Never throws.
 */
export function encodePlusCode(lat: number, lng: number, codeLength = 10): string {
  try {
    if (typeof lat !== 'number' || !Number.isFinite(lat)) return '';
    if (typeof lng !== 'number' || !Number.isFinite(lng)) return '';
    let length = Math.floor(codeLength);
    if (!Number.isFinite(length) || length < 2) return '';
    if (length > 15) length = 15;

    let latitude = Math.max(-LATITUDE_MAX, Math.min(LATITUDE_MAX, lat));
    if (latitude === LATITUDE_MAX) latitude -= 0.0000001;
    let longitude = lng;
    while (longitude < -LONGITUDE_MAX) longitude += 360;
    while (longitude >= LONGITUDE_MAX) longitude -= 360;

    let adjustedLat = latitude + LATITUDE_MAX;
    let adjustedLng = longitude + LONGITUDE_MAX;
    let code = '';
    let digits = 0;
    const pairLen = Math.min(length, 10);
    while (digits < pairLen) {
      const placeValue = PAIR_RESOLUTIONS[Math.floor(digits / 2)];
      const latDigit = Math.floor(adjustedLat / placeValue);
      adjustedLat -= latDigit * placeValue;
      code += CODE_ALPHABET[latDigit];
      digits += 1;
      const lngDigit = Math.floor(adjustedLng / placeValue);
      adjustedLng -= lngDigit * placeValue;
      code += CODE_ALPHABET[lngDigit];
      digits += 1;
      if (digits === SEPARATOR_POSITION && digits < length) code += SEPARATOR;
    }
    // Grid refinement for digits past 10: each cell splits into
    // GRID_ROWS × GRID_COLUMNS, digit = row * GRID_COLUMNS + col.
    let latGridSize = GRID_SIZE_DEGREES;
    let lngGridSize = GRID_SIZE_DEGREES;
    let latRem = adjustedLat;
    let lngRem = adjustedLng;
    while (digits < length) {
      const row = Math.min(GRID_ROWS - 1, Math.floor(latRem / (latGridSize / GRID_ROWS)));
      const col = Math.min(GRID_COLUMNS - 1, Math.floor(lngRem / (lngGridSize / GRID_COLUMNS)));
      latRem -= row * (latGridSize / GRID_ROWS);
      lngRem -= col * (lngGridSize / GRID_COLUMNS);
      latGridSize /= GRID_ROWS;
      lngGridSize /= GRID_COLUMNS;
      if (digits === SEPARATOR_POSITION) code += SEPARATOR;
      code += CODE_ALPHABET[row * GRID_COLUMNS + col];
      digits += 1;
    }
    if (digits < length && code.indexOf(SEPARATOR) < 0) code += SEPARATOR;
    return code;
  } catch {
    return '';
  }
}
