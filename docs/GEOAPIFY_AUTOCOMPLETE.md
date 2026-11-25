# Address autocomplete (Geoapify, server-side proxy)

Typing a delivery address shows live suggestions (street/place matches with
the closest exact match first). Picking one fills the text **and** sets the
map pin, so the fee, zone check, ETA, and the Telegram/kitchen maps link all
run on exact coordinates instead of a text search that can return "not
found". Manual typing and pin-dragging keep working exactly as before.

## How it works

- Cart checkout + account settings address fields query
  `GET /api/geo/autocomplete?q=…&lang=…&country=…` (debounced 350 ms, min
  3 chars, session cache, abort on keystroke).
- The route validates the query, rate-limits (60/min per IP, 2500/day
  global via `GEOAPIFY_DAILY_MAX`), calls Geoapify with
  `filter=countrycode:<zone countries>` (the delivery-zone list is the
  only source of truth — never the phone-dial country) plus proximity
  bias on the live map viewport (`lat`/`lng` from the picker when the
  customer is looking elsewhere, otherwise the restaurant pin), and
  returns only
  `[{ label, line1, line2, lat, lng, details? }]` with `no-store`
  (`limit=20` so side streets have room to appear; `details` carries
  house number + street + suburb/district/city for small alleys, and
  fills `line2` when the provider leaves it empty). Deep search: when
  the filtered pass returns fewer than 3 rows, the same query runs once
  more unfiltered and merges behind the zone matches (one extra provider
  call only on thin results). When both Geoapify passes stay thin,
  a third keyless stage queries Photon (Komoot OSM typeahead, free without
  a key) with the same viewport bias plus a local bbox, over smart recall
  variants (max 2 calls): normalized Arabic, latinized street-type
  («شارع» to «street», since OSM ways are often Latin-tagged), and a
  backoff that drops the first token (usually the city). Rows carrying the
  query street number rank first behind the zone matches. Worldwide service (no selected zones)
  falls back to the client country hint, then to unfiltered.
- The browser never sees the API key or the provider payload. Key missing →
  `503 autocomplete_unavailable`: the UI degrades silently to manual entry.
- Attribution (required by Geoapify's free tier) renders under the list:
  «اقتراحات العناوين من Geoapify» with a follow-link to geoapify.com.

## Setup

1. Create a project + API key at https://www.geoapify.com/ (free tier covers
   this use; 1 request = 1 credit).
2. `npx wrangler pages secret put GEOAPIFY_API_KEY` (production) and set
   `GEOAPIFY_API_KEY=` in `.dev.vars` locally (see `.dev.vars.example`).
   Optional: `GEOAPIFY_DAILY_MAX` (default 2500).
3. Redeploy (Pages injects secrets at deploy time).
4. Test: type 3+ chars in the cart address field → suggestions appear;
   pick one → address fills and the pin card appears with the distance.

No npm package was installed: the integration is plain `fetch` through the
proxy, so there is no client bundle cost and the key cannot leak.

## Contracts

- `functions/_shared/geoapify.js` + `functions/api/geo/autocomplete.js`
  (server), `src/hooks/useAddressAutocomplete.ts` +
  `src/components/AddressSuggestList.tsx` (shared UI).
- `npm run test:geo` (route + sanitizer, no network),
  `test:cart` Section G (wiring), `test:joint-groups` untouched.
