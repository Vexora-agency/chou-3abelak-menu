# Local street index (instant side-street suggestions)

The region's own streets ship with the app: a compact index built once from
OpenStreetMap, searched on-device with zero network, and merged FIRST —
above every provider pass. A customer typing «السيوف شارع 16» sees the
street instantly even when Geoapify and Photon return nothing.

## How it works

- `scripts/build-street-index.mjs` queries Overpass for named highways in a
  bbox (`--bbox --id --cityAr --cityEn --country`, optional `--split=2x2` tiling, or `--center=31.21,29.95 --radiusKm=10` for the pin-centered form.
  tiling for busy servers), dedupes segments sharing one normalized name,
  and writes `public/data/street-index/<id>.json` + `manifest.json`.
 * - Center on the restaurant pin from the admin map with a generous radius
 *   (`--center=lat,lng --radiusKm=N`, default 10, bbox derived automatically).
 * - `--append` merges quadrant runs into one file (busy Overpass servers
 *   drop big queries, so large areas are built tile by tile).
  Example: `node scripts/build-street-index.mjs --bbox=31.19,29.93,31.24,30.00 --id=alex-east --cityAr="الإسكندرية" --cityEn="Alexandria" --country=eg --split=2`.
- `src/utils/streetIndex.ts` lazy-loads the matching index once per session
  (country match, else map-viewport inside the index bbox; other countries
  never download it), searches with the same Arabic recall rules as the
  server (alef unify, شارع↔street, area-drop backoff), and requires every
  token to match — no fuzzy guessing.
- `useAddressAutocomplete` shows local matches instantly, then merges the
  server passes behind (deduplicated). On server failure the local rows
  stand alone instead of an empty list.
- Row shape matches the server contract
  `{ label, line1, line2, lat, lng }` (center of the OSM way); the pin +
  reverse-geocode + exact-delivery details complete the precision after
  the pick.

## Coverage and honesty

- The index holds ONE row per named street (segments share a name); long
  streets pin to a representative center — the customer drags the pin the
  last meters, the reverse lookup names the exact spot.
- Unnamed alleys are not in OSM and cannot be indexed: for those the pin,
  the satellite view habit, and the structured details remain the path.
- Data © OpenStreetMap contributors (ODbL) — kept in the manifest; map
  tiles already carry the attribution. Rebuild periodically (new roads do
  get mapped) and add one index per delivery city the same way.

## Contracts

- `npx tsx scripts/test-street-index.mjs` (wired into `test:all` as
  `test:street-index`): unit matching + committed fixture shape and smoke.
