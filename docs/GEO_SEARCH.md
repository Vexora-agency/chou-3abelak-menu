# Address search cascade (Google primary, free fallbacks)

Typing a delivery address shows live suggestions with the closest exact
match first. Picking one moves the map pin and fills the address text, so
the fee, zone check, ETA, and the Telegram/kitchen maps link all run on
exact coordinates.

## Order (each stage runs only while results stay thin)

1. **Owner places** (`custom_places` — «جنب فرن فلان»): the names
   customers actually use, with the exact pin the owner dropped.
2. **Google Places (New)** — the primary external provider, quota-guarded
   (see `docs/GOOGLE_PLACES.md`). Session-billed, restricted to the
   delivery radius when the restaurant pin + explicit `maxKm` allow it,
   otherwise biased by the live map viewport. Coordinates resolve once on
   pick, never per keystroke.
3. **Photon** (Komoot OSM typeahead, free, keyless): smart-recall variants
   (normalized Arabic, latinized street-type, deep suffix chain so a
   dialect spelling like السويف still resolves via «شارع 16»,
   streets-only `osm_tag=highway` fallback, soft viewport bias only —
   never a hard bbox), rows carrying the query's street number
   ranked first.
4. Client-side, the device's own recent picks and the on-device region
   street index (`docs/STREET_INDEX.md`) merge in front — instant and free.

Geoapify was retired from this path by owner decision
(`functions/_shared/geoapify.js` stays as a tested standby module only).

## How it works

- Cart checkout + account settings address fields query
  `GET /api/geo/autocomplete?q=…&lang=…&country=…&lat=…&lng=…&session=…`
  (debounced 350 ms, min 3 chars, session cache, abort on keystroke).
- The route validates the query, rate-limits (60/min per IP; Google calls
  share `GOOGLE_PLACES_DAILY_MAX`, default 300/day), and returns stripped
  rows `[{ label, line1, line2, lat, lng, details?, placeId? }]` with
  `no-store` (Google rows carry `placeId` and null coords until the pick
  resolves them via `/api/geo/place-details`).
- `sources` names the passes that answered (`custom/google/photon`) and
  the `google` flag reports `off/rich/ok/empty/capped/error` — the owner
  verification readout. Responses and logs never carry keys, provider
  bodies, or the full query.

## Setup

1. Owner places: dashboard → «الأماكن والمعالم» (migration `0044` must be
   applied: `npx wrangler d1 migrations apply ORDERS_DB --remote`).
2. Google: key + billing + `GOOGLE_PLACES_API_KEY` secret (see
   `docs/GOOGLE_PLACES.md`); without it the app runs 100% on free passes.
3. Region street index: `docs/STREET_INDEX.md` (rebuild per city).

## Contracts

- `functions/api/geo/autocomplete.js` + `functions/api/geo/place-details.js`
  (server), `src/hooks/useAddressAutocomplete.ts` +
  `src/components/AddressSuggestList.tsx` (shared UI).
- `npm run test:geo` (route + sanitizer, no network),
  `test:cart` Section G (wiring), `test:joint-groups` untouched.
