# Address search cascade (Google primary, free fallbacks)

Typing a delivery address shows live suggestions with the closest exact
match first. Picking one moves the map pin and fills the address text, so
the fee, zone check, ETA, and the Telegram/kitchen maps link all run on
exact coordinates.

## Order (each stage runs only while results stay thin)

1. **On-device, instant, free**: the customer's own recent picks, then the
   downloadable places library (districts/suburbs/villages, per country —
   `docs/PLACES_INDEX.md`), then the region street index
   (`docs/STREET_INDEX.md`). Zero network, merged first.
2. **Google Places (New)** — the primary external provider, quota-guarded
   (see `docs/GOOGLE_PLACES.md`). Session-billed, soft-biased by the live
   map viewport (never fenced — out-of-zone pins are blocked at order
   submit, not hidden from search). Coordinates resolve once on
   pick, never per keystroke. Autocomplete (≤5 rows) is followed by a
   bounded Text Search pass (≤10 detailed rows with coordinates) when
   still thin.
3. **Photon** (Komoot OSM typeahead, free, keyless): smart-recall variants
   (normalized Arabic, latinized street-type, deep suffix chain so a
   dialect spelling like السويف still resolves via «شارع 16»,
   streets-only `osm_tag=highway` fallback, soft viewport bias only —
   never a hard bbox), rows carrying the query's street number
   ranked first.
4. **Nominatim full-text search** (free, keyless, throttled to its 1 req/s
   policy): catches named POIs buried mid-query («كنيسة الانبا اثناسيوس
   السيوف في الاسكندرية») that prefix indexes miss. Only for queries of
   8+ characters.

Geoapify was retired from this path by owner decision
(`functions/_shared/geoapify.js` stays as a tested standby module only).

## How it works

- Cart checkout + account settings address fields query
  `GET /api/geo/autocomplete?q=…&lang=…&country=…&lat=…&lng=…&session=…`
  (debounced 350 ms, min 3 chars, session cache, abort on keystroke).
  A single explicit «بحث» button (and Enter on an empty list) reruns the
  cascade at once and auto-pins the first fresh result — typing alone only
  ever suggests, never moves the pin.
- The confirmed pin shows exact coordinates with GPS accuracy.
  Arabic-Indic digits convert to Western and a lone ش expands to شارع
  before matching; a picked area is appended to the *server* query only
  («شارع 16، السيوف»). An explicit «بحث» button (and Enter on an empty
   list) reruns the full cascade immediately — skipping the debounce delay
   and the session cache — then auto-moves the pin to the first fresh
   result, so the customer is never forced to pick from the list; typing
   alone only ever suggests.
- The route validates the query, rate-limits (60/min per IP; Google calls
  share `GOOGLE_PLACES_DAILY_MAX`, default 300/day), and returns stripped
  rows `[{ label, line1, line2, lat, lng, details?, placeId? }]` with
  `no-store` (Google rows carry `placeId` and null coords until the pick
  resolves them via `/api/geo/place-details`).
- `sources` names the passes that answered (`google/google-text/photon`) and
  the `google` flag reports `off/rich/ok/empty/capped/error` — the owner
  verification readout. Responses and logs never carry keys, provider
  bodies, or the full query.

## Setup

1. Offline libraries: street index + place indexes ship in the repo
   (`docs/STREET_INDEX.md`, `docs/PLACES_INDEX.md`); rebuild per region
   with the documented commands. DB: apply migrations through 0045
   (`npx wrangler d1 migrations apply ORDERS_DB --remote`).
2. Google: key + billing + `GOOGLE_PLACES_API_KEY` secret (see
   `docs/GOOGLE_PLACES.md`); without it the app runs 100% on free passes.

## Contracts

- `functions/api/geo/autocomplete.js` + `functions/api/geo/place-details.js`
  (server), `src/hooks/useAddressAutocomplete.ts` +
  `src/components/AddressSuggestList.tsx` (shared UI).
- `npm run test:geo` (route + sanitizer, no network),
  `test:cart` Section G (wiring), `test:joint-groups` untouched.
