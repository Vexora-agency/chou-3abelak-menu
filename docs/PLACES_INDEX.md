# Offline place libraries (downloadable areas for Egypt & Lebanon)

Every named district, suburb, village, town and city ships with the app —
the «areas» half of Talabat-style search. Areas suggest instantly with zero
typing by the owner and zero network at query time, merged ahead of streets:
recents → places → streets → server.

## Libraries

| File | Coverage | Source |
|---|---|---|
| `public/data/places-index/places-lb.json` | All of Lebanon (cities → hamlets) | OSM `place=*` |
| `public/data/places-index/places-eg.json` | Egypt (cities/towns/villages + Alexandria districts; extend per city) | OSM `place=*` |

Row shape: `[nameAr, nameLatin|null, lat, lng, kind]`. One row per
normalized name (the most significant record wins: city > town > village
> suburb > …). Coordinates round to 5 decimals.

## Build / rebuild

```bash
# Lebanon, whole country, one file:
node scripts/build-places-index.mjs --country=lb --id=places-lb --bbox=33.05,35.10,34.69,36.61

# Egypt, big areas tiled quadrant by quadrant (busy Overpass drops big queries):
node scripts/build-places-index.mjs --country=eg --id=places-eg --bbox=<q1> --kinds=city,town,village --append
node scripts/build-places-index.mjs --country=eg --id=places-eg --bbox=<q2> ... --append
```

Rules: `--kinds` limits the place types; `--bbox` or `--center=lat,lng
--radiusKm=N` selects the area; `--split=N` tiles one run; `--append`
merges quadrant runs (the manifest keeps the UNION bbox). Rebuild
periodically — new suburbs do get mapped.

## Client behavior

`src/utils/streetIndex.ts` lazy-loads the matching library once per
session (country match, else map-viewport inside the index bbox; other
countries download nothing). Search uses the same Arabic recall rules as
streets (alef unify, ة→ه, ى→ي, area-drop backoff) with a 4-row cap, and
the kind renders as `line2` context («السيوف، حي»).

## Coverage and honesty

- Only *named* places exist in OSM: unnamed alleys and brand-new
  compounds are absent until mapped — for those the pin, the reverse
  lookup and the exact-delivery details remain the path.
- Data © OpenStreetMap contributors (ODbL) — kept in the manifest; map
  tiles already carry the attribution.

## Contracts

- `npx tsx scripts/test-places-index.mjs` (wired into `test:all` as
  `test:places-index`): unit matching + committed fixture shape when the
  data files exist (skipped otherwise, so CI never needs the network).
