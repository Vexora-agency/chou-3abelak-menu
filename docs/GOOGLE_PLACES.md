# Google Places (primary external provider, quota-guarded)

Egypt's informal addresses (numbered alleys, «جنب فرن فلان») are where free
OSM-based providers are thinnest — and where Google's index is strongest.
Google is the PRIMARY external pass: owner places first, then Google;
Photon (free, keyless) covers thin results, capped budgets, and missing keys.

## Professional usage (per the official Places API (New) docs)

- **Session billing**: the client mints one UUID per search
  (`takePlaceSession`, rotated after pick or 3 minutes) and sends it as
  `session`; the server forwards it as `sessionToken` to BOTH autocomplete
  and place-details, grouping each search + pick into one billing session.
- **Restriction over bias**: when the restaurant pin and an explicit admin
  `maxKm` exist, results are restricted INSIDE the delivery circle
  (`locationRestriction`, capped at the 50 000 m API limit); otherwise the
  live map viewport biases (`locationBias`), per Google's viewport guidance.
  `regionCode` formats, `includedRegionCodes` hard-restricts the country.
- **Field masks** on both calls return only what the UI needs; no query
  predictions are requested.
- **Attribution**: exactly `Google Maps` (never localized, `translate="no"`),
  rendered under Google rows, visually separated — per the current Google
  Maps attribution policy («Powered by Google» alone is legacy).
- **End-user address exception**: the address a customer picks for their own
  order is not subject to Maps content restrictions — storing the confirmed
  delivery address (and the device-local recents) is the compliant path.

## Cost control

- Disabled unless `GOOGLE_PLACES_API_KEY` is set — without it the app runs
  100% on free providers and no test or route changes behavior.
- Billing account required. About 10,000 calls/month free per Essentials
  SKU (verify the current price page before enabling).
- One shared daily budget `GOOGLE_PLACES_DAILY_MAX` (default 300 ≈
  9k/month with headroom) covers BOTH autocomplete and details calls.
  Per-IP burst cap 60/min on top. When spent, Photon + local index answer.
- No per-keystroke waste by design: autocomplete runs at most once per
  distinct query (debounced 350 ms, cached per session); coordinates
  resolve once per PICK via `/api/geo/place-details?placeId=`.

## How it works

- `functions/_shared/google.js`: Places API (New) autocomplete
  (`X-Goog-Api-Key` header — never URL/body) with languageCode,
  regionCode, restriction-or-bias, and sessionToken.
- Predictions carry no geometry by design, so rows are
  `{ label, line1, line2, lat: null, lng: null, placeId }`. The client
  (`fetchPlaceCoords` in `src/hooks/useAddressAutocomplete`) resolves
  coordinates on select, then pins and moves the map exactly like any
  other row.
- `functions/api/geo/place-details.js`: customer-header GET, placeId
  validated (`/^[A-Za-z0-9_-]{10,200}$/`), session forwarded, no-store,
  generic errors. The API key travels only server-to-server.

## Setup

1. Create a key at https://console.cloud.google.com/ (Places API (New)
   enabled, billing account attached, API-restricted to Places API (New),
   plus a budget alert and a project quota cap as a second guard).
2. `npx wrangler pages secret put GOOGLE_PLACES_API_KEY` (production);
   `GOOGLE_PLACES_API_KEY=` in `.dev.vars` locally. Optional:
   `GOOGLE_PLACES_DAILY_MAX` (default 300).
3. Redeploy (secrets apply to new deployments only), then verify live:
   devtools → Network → autocomplete request → `google: "ok"` and
   `"sources": [..., "google"]`; rows show the «Google Maps» attribution.

## Contracts

- `functions/_shared/google.js` + `functions/api/geo/autocomplete.js`
  (primary pass) + `functions/api/geo/place-details.js`.
- `node scripts/test-google-places.mjs` (wired into `npm run test:geo`):
  gating, mapping, header-only key, session forwarding, restriction vs
  bias, quota paths.
