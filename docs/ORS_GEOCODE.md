# OpenRouteService Geocoding (Primary Keyed Pass)

The search cascade's primary keyed provider is the hosted
OpenRouteService geocoder (a Pelias instance), replacing Google Places
(which needs a billing-enabled Google Cloud project). Free Standard
plan — 0 €, no card, email signup only.

## Why this one

- **Free without a card**: Standard plan, 3000 geocode requests/day,
  100/minute, verified on the official plans page
  (`account.heigit.org/info/plans`).
- **Detailed suggestions**: every row arrives WITH coordinates
  (`geometry.coordinates`), so no follow-up details call is ever needed
  — unlike Google predictions, which need a billed place-details call.
- **Country filtering**: `boundary.country` hard-filters to the admin's
  delivery countries; `focus.point` stays a soft viewport ranking hint.
- **Extensible**: Pelias is open-source (MIT). Later the same engine can
  be self-hosted (`pelias` On-Premise, unlimited) with our own curated
  streets and places imported as custom data — no vendor can block that.

## Setup (owner, 5 minutes)

1. Create a free account at `account.heigit.org` (email + password or
   GitHub sign-in — no card).
2. Create a token in the dashboard (Tokens → create token).
3. Add it as a Pages secret named `ORS_API_KEY` (Cloudflare dashboard →
   Pages project → Settings → Environment Variables → Secrets, Production
   + Preview), then redeploy. Local dev: put it in `.dev.vars`
   (never commit that file).
4. Optional: cap daily spend with `ORS_GEOCODING_DAILY_MAX`
   (default 3000 = the plan quota). The route shares one KV counter
   (`geo-ors-day:<YYYY-MM-DD`); when spent, `ors` reports `capped`
   and the free passes (Photon, Nominatim, local indexes) keep answering.

## Verification

Each `/api/geo/autocomplete` answer carries `ors` alongside `google`:
`off` (no key) | `rich` (free passes sufficed) | `ok` | `empty` |
`capped` (daily budget spent) | `error` (key/quota/provider-side
failure). `sources` includes `ors` when this pass answered. No key,
provider body, or query text ever reaches the client or the logs.

## Contracts

- `functions/_shared/ors.js` (key gating, URL shaping, sanitizer),
  wired as the first keyed pass in `functions/api/geo/autocomplete.js`.
- `npm run test:geo` includes `scripts/test-ors.mjs` (gating, shaping,
  sanitizer, route order, cap degradation — no network).
