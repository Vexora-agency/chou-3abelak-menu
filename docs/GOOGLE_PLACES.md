# Google Places last-resort suggestions (optional, quota-guarded)

Egypt's informal addresses (numbered alleys, «جنب فرن فلان») are where free
OSM-based providers are thinnest — and where Google's index is strongest.
This integration adds Google as the FINAL pass only: owner places, the
local street index, Geoapify, and Photon all run first, and Google fires
only when everything free stays thin.

## Cost control (read before enabling)

- Disabled unless `GOOGLE_PLACES_API_KEY` is set — without it the app runs
  100% on free providers and no test or route changes behavior.
- Billing account required. About 10,000 calls/month free per Essentials
  SKU (Autocomplete counts; verify the current price page — terms changed
  in March 2025 and can change again).
- One shared daily budget `GOOGLE_PLACES_DAILY_MAX` (default 300 ≈
  9k/month with headroom) covers BOTH autocomplete and details calls,
  because a pick costs one details call. Per-IP burst cap 60/min on top.
- No per-keystroke waste by design: autocomplete runs at most once per
  thin query (debounced 350ms, cached per session); coordinates resolve
  once per PICK via `/api/geo/place-details?placeId=`.

## How it works

- `functions/_shared/google.js`: Places API (New) autocomplete
  (`X-Goog-Api-Key` header — never URL/body) with language, region code,
  and a 20km location bias; Place Details for one picked place.
- Predictions carry no geometry by design, so rows are
  `{ label, line1, line2, lat: null, lng: null, placeId }`. The client
  (`fetchPlaceCoords` in `useAddressAutocomplete`) resolves coordinates
  on select, then pins and moves the map exactly like any other row.
- `functions/api/geo/place-details.js`: owner-gated? No — customer
  header, same as autocomplete; placeId validated
  (`/^[A-Za-z0-9_-]{10,200}$/`), no-store, generic errors.
- Attribution: Google requires «Powered by Google» where Places results
  show — the suggestion list renders it under Google rows.

## Setup

1. Create a key at https://console.cloud.google.com/ (Places API (New)
   enabled, billing account attached, HTTP-referrer or IP restriction,
   plus a budget alert and a project quota cap as a second guard).
2. `npx wrangler pages secret put GOOGLE_PLACES_API_KEY` (production);
   `GOOGLE_PLACES_API_KEY=` in `.dev.vars` locally. Optional:
   `GOOGLE_PLACES_DAILY_MAX` (default 300).
3. Redeploy; type a side street that free passes miss — the Google row
   appears last, and picking it pins the map.

## Contracts

- `functions/_shared/google.js` + `functions/api/geo/autocomplete.js`
  (last-resort pass) + `functions/api/geo/place-details.js`.
- `node scripts/test-google-places.mjs` (wired into `npm run test:geo`):
  gating, mapping, header-only key, route merge, quota paths.
