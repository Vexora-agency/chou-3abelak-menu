# Reverse geocoding (Nominatim, server-side proxy)

The map pin is the source of truth for delivery: every pin move shows a live
readable address, and Confirm writes that exact text (plus the optional
exact-delivery details) into the order — never bare coordinates when an
address exists.

## Why a proxy

Browsers cannot set the identifying `User-Agent` the Nominatim usage policy
requires, so the lookup rides server-to-server here:

- `GET /api/geo/reverse?lat=…&lng=…&lang=…` → `200 { ok: true, address }`.
- Zoom 18 (building level, not street level).
- `address` is `Place, Road, District, City` with wide OSM key coverage
  (footway/residential roads, borough/hamlet districts); a nearby named
  place is kept as a landmark prefix («near X» is what the driver needs).
- `address: null` with 200 is NOT a failure: open water and unnamed plots
  legitimately have no address — the client then confirms with coordinates.
- Rate limits: 60/min per IP plus a global daily cap
  (`GEO_REVERSE_DAILY_MAX`, default 2500) → 429, shared KV limiter that
  fails open when KV is missing. Upstream failure → 502.
- `no-store`, no coordinates and no provider body in responses or logs.

The client (`reverseGeocode` in
`src/features/cart/hooks/useMidSplitLocationMap.ts`) calls the proxy first
and only falls back to a direct Nominatim lookup when the proxy itself is
unreachable. Exact-delivery details (building/floor/apartment/landmark,
`composePreciseAddress`) are appended at Confirm time, so the order carries
one exact line: reverse text + structured details + pin coordinates.

Exact-delivery details live behind one toggle («العنوان غير دقيق؟ أضف
تفاصيل المبنى»): the map stays clean, and a customer whose preview reads
wrong expands building/floor/apartment/landmark in place. The composed
line is previewed live and written on Confirm. A GPS accuracy ring and a
zoom-for-precision hint keep hand pins honest without blocking.

## Contracts

- `functions/_shared/reverse.js` + `functions/api/geo/reverse.js` (server).
- `node scripts/test-geo-reverse.mjs` (wired into `npm run test:geo`),
  `npx tsx scripts/test-pin-precision.mjs` (wired into `test:all` as
  `test:pin-precision`).
