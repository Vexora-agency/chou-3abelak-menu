# Delivery-zones geodata

Where the country / governorate lists come from, how they are refreshed,
and the licensing + privacy rules around them.

## Sources (pinned)

| Data | Upstream | Pinned SHA | License |
|---|---|---|---|
| Countries (250, ISO 3166-1 + Arabic names) | [mledoze/countries](https://github.com/mledoze/countries) | `fa4f62182d19ff4f8b325cde6387c9cd9d80955a` | ODbL-1.0 |
| Subdivisions (~5,300, ISO 3166-2 codes + names, incl. Arabic where available) | [dr5hn/countries-states-cities-database](https://github.com/dr5hn/countries-states-cities-database) | `20de077b176b00ba0fc0f298a55caa1dc6337a86` | ODbL-1.0 |
| Lebanon governorates (9, bilingual + match aliases) | Hand-curated in `scripts/build-geodata.mjs` | — | CC0 (ours) |

Regenerate with `npm run build:geodata` (needs network once; the app
itself never fetches upstream at runtime). Output files are committed:

- `src/data/geo/countries.json` — client country list `[{cc,en,ar}]` (~17 KB, bundled).
- `functions/_shared/geodata/countries.json` — identical server copy (one script writes both, so they cannot drift).
- `public/geo/subdivisions/<CC>.json` — lazy per-country lists `[{code,en,ar|null,aliases?}]` fetched on demand by the admin UI and the checkout matcher.
- `*/geodata.meta.json` — source SHAs + license next to each output.

ODbL attribution: this file + the `meta` sidecars carry the required
credit ("Contains data from mledoze/countries and dr5hn/countries-states-cities-database, © contributors, ODbL-1.0").

## Lebanon specifics

Lebanon has **nine** governorates; ISO 3166-2:LB only defines codes for
eight — **Keserwan-Jbeil has no ISO code** (confirmed 2023-2026, shown as
`LB-…` upstream). It therefore carries our stable house code `LB-KJ` and
matches by name/alias as well as code. Arabic display names are curated
(`بيروت، جبل لبنان، الشمال، الجنوب، البقاع، بعلبك-الهرمل، عكار، النبطية،
كسروان-جبيل`); aliases cover common Latin/Arabic variants. City names
(Jounieh, Tripoli, …) are deliberately NOT governorate aliases — a city
pin resolves to its governorate through the geocoder's own response.

## Runtime matching

`matchZone()` (twinned in `src/utils/deliveryZones.ts` and
`functions/_shared/delivery-zones.js`, covered by
`scripts/test-delivery-zones.mjs`) is **code-first, name-second**: an
allowed ISO code wins; otherwise the pin's localized subdivision name is
normalized (case/whitespace/diacritics-insensitive, Arabic alef forms
unified) and compared against allowed names + aliases. This survives
geocoder boundary drift (e.g. a Jounieh pin reported under Mount Lebanon).

When subdivision data cannot be loaded (offline), matching falls back to
the country level rather than stranding the customer. The always-on
server-side distance backstop (`maxKm` from the restaurant, haversine,
zero external calls) is the real guarantee.

## Pin → zone resolution (customer side)

`useDeliveryZoneCheck` calls BigDataCloud's **free client-side**
reverse-geocode endpoint (`api.bigdatacloud.net`, no key) with the freshly
picked pin and `localityLanguage` matching the UI language. Usage follows
their fair-use policy: called from the user's own browser, with the live
GPS/dragged pin, on explicit user action (confirming a delivery location).
It is fail-soft by design — any failure reads as "unknown" (soft warning
only, never a hard block). Server-side use of that endpoint is forbidden
(402 + IP ban), so the server never calls it; see above for what the
server checks instead.
