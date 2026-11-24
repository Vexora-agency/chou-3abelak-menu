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
  global via `GEOAPIFY_DAILY_MAX`), calls Geoapify server-to-server with
  proximity bias on the restaurant pin (no strict country filter —
  delivery areas span borders, so bias ranks the closest matches first
  and the customer picks), and returns only
  `[{ label, line1, line2, lat, lng }]` with `no-store`.
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
