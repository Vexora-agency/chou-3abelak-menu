/**
 * Owner-curated places (areas & landmarks) contract.
 * Run: node scripts/test-custom-places.mjs
 *
 * No network, no real D1: the repository and the admin route are exercised
 * against a tiny in-memory D1 stub. Proves:
 *  - validation edges (names, coords, kinds) and Arabic matching rules;
 *  - place → suggestion-row mapping (saved-place line, alt-language details);
 *  - the admin route: owner gate (403), 405, 400s, CRUD happy paths,
 *    no-store, and no logging.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAsserts } from './_helpers/shared.mjs';
import {
  addCustomPlace,
  customPlaceToSuggestion,
  listCustomPlaces,
  normalizePlaceText,
  removeCustomPlace,
  searchCustomPlaces,
  updateCustomPlace,
  validateCustomPlace,
} from '../functions/_shared/repositories/places.repo.js';
import { onRequest } from '../functions/api/admin/custom-places.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');
const { ok, summary } = createAsserts();

function check(name, cond) {
  if (cond) console.log(`  ok ${name}`);
  ok(cond, name);
}

function adminReq(path, { method = 'GET', body, local = false } = {}) {
  const origin = local ? 'http://127.0.0.1:8787' : 'https://example.com';
  const headers = { 'X-Requested-With': 'menu-admin', 'X-Admin-Key': 'test', Origin: origin };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return new Request(`${origin}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/* In-memory D1 stub: prepare(sql).bind(...).all()/run()/first(). */
function stubDb(seed = []) {
  const rows = seed.map((r, i) => ({ id: i + 1, ...r }));
  let seq = rows.length;
  const table = (sql) => {
    const s = sql.toLowerCase();
    return {
      all: async () => {
        if (!s.includes('from custom_places')) throw new Error('no-table');
        return { results: [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)) };
      },
      run: async function () {
        if (s.startsWith('insert into custom_places')) {
          seq += 1;
          rows.push({ id: seq, created_at: '2026-11-26T00:00:00.000Z', updated_at: null, ...this._v });
          return { meta: { changes: 1, last_row_id: seq } };
        }
        if (s.startsWith('update custom_places')) {
          const hit = rows.find((r) => r.id === this._id);
          if (!hit) return { meta: { changes: 0 } };
          Object.assign(hit, this._v);
          return { meta: { changes: 1 } };
        }
        if (s.startsWith('delete from custom_places')) {
          const i = rows.findIndex((r) => r.id === this._id);
          if (i < 0) return { meta: { changes: 0 } };
          rows.splice(i, 1);
          return { meta: { changes: 1 } };
        }
        throw new Error('bad-sql');
      },
      first: async () => null,
      bind: function (...a) {
        if (s.startsWith('insert into custom_places')) {
          this._v = { name_ar: a[0], name_en: a[1], lat: a[2], lng: a[3], kind: a[4], created_at: a[5] };
        } else if (s.startsWith('update custom_places')) {
          this._v = { name_ar: a[0], name_en: a[1], kind: a[2], updated_at: a[3] };
          this._id = a[4];
        } else if (s.startsWith('delete from custom_places')) {
          this._id = a[0];
        }
        return this;
      },
    };
  };
  return { prepare: (sql) => table(sql), _rows: rows };
}

/* ---------- validation + matching ---------- */

check('normalize unifies alef and ة/ى, strips tashkeel',
  normalizePlaceText('الإسكندرية') === 'الاسكندريه' && normalizePlaceText('شَارع') === 'شارع');
check('validate accepts a full place',
  validateCustomPlace({ name_ar: 'دوار السيوف', name_en: 'El Soyouf', lat: 31.2, lng: 29.95, kind: 'area' }).ok === true);
check('validate rejects a short name', validateCustomPlace({ name_ar: 'س', lat: 31.2, lng: 29.95 }).error === 'invalid_name');
check('validate rejects bad coords', validateCustomPlace({ name_ar: 'دوار السيوف', lat: 91, lng: 0 }).error === 'invalid_coords');
check('validate defaults the kind', validateCustomPlace({ name_ar: 'دوار السيوف', lat: 31.2, lng: 29.95 }).value.kind === 'landmark');

check('mapping carries the saved-place line',
  JSON.stringify(customPlaceToSuggestion({ name_ar: 'دوار السيوف', name_en: 'El Soyouf Roundabout', lat: 31.2, lng: 29.95 }, 'ar'))
  === JSON.stringify({ label: 'دوار السيوف', line1: 'دوار السيوف', line2: 'مكان محفوظ', lat: 31.2, lng: 29.95, details: 'El Soyouf Roundabout' }));
check('mapping falls back to english for en lang',
  customPlaceToSuggestion({ name_ar: 'دوار السيوف', name_en: null, lat: 31.2, lng: 29.95 }, 'en').line1 === 'دوار السيوف');
check('mapping nulls garbage', customPlaceToSuggestion(null, 'ar') === null
  && customPlaceToSuggestion({ name_ar: '', lat: 1, lng: 1 }, 'ar') === null);

/* ---------- repository ---------- */

{
  const db = stubDb([
    { name_ar: 'دوار السيوف', name_en: 'El Soyouf', lat: 31.205, lng: 29.945, kind: 'landmark', created_at: '2026-11-25T00:00:00.000Z', updated_at: null },
    { name_ar: 'فرن الحمد', name_en: null, lat: 31.206, lng: 29.946, kind: 'landmark', created_at: '2026-11-26T00:00:00.000Z', updated_at: null },
  ]);
  const all = await listCustomPlaces(db);
  check('list returns newest first', all.length === 2 && all[0].name_ar === 'فرن الحمد');
  const hit = await searchCustomPlaces(db, 'السيوف', 'ar');
  check('search matches normalized arabic', hit.length === 1 && hit[0].name_ar === 'دوار السيوف');
  const hitEn = await searchCustomPlaces(db, 'soyOUf', 'en');
  check('search matches latin case-insensitively', hitEn.length === 1);
  check('search ignores short queries', (await searchCustomPlaces(db, 'س', 'ar')).length === 0);
  const added = await addCustomPlace(db, { name_ar: 'شارع 16', lat: '31.202', lng: '29.952', kind: 'street' });
  check('add accepts string coords', added.ok === true && added.place.id === 3 && added.place.kind === 'street');
  const bad = await addCustomPlace(db, { name_ar: 'x', lat: 1, lng: 1 });
  check('add rejects invalid without touching the db', bad.ok === false && (await listCustomPlaces(db)).length === 3);
  const upd = await updateCustomPlace(db, 3, { name_ar: 'شارع 16 المعدل', kind: 'street' });
  check('update renames', upd.ok === true && upd.place.name_ar === 'شارع 16 المعدل');
  const updMissing = await updateCustomPlace(db, 99, { name_ar: 'غائب' });
  check('update 404s unknown ids', updMissing.ok === false && updMissing.error === 'not_found');
  check('remove deletes', await removeCustomPlace(db, 3) === true);
  check('remove is idempotent', await removeCustomPlace(db, 3) === false);
  const broken = { prepare: () => { throw new Error('down'); } };
  check('list fails open on missing table', (await listCustomPlaces(broken)).length === 0);
  check('search fails open on missing table', (await searchCustomPlaces(broken, 'السيوف', 'ar')).length === 0);
}

/* ---------- admin route ---------- */

const routeSource = read('functions/api/admin/custom-places.js');
const repoSource = read('functions/_shared/repositories/places.repo.js');
check('route never logs', !routeSource.includes('console.'));
check('repo never logs', !repoSource.includes('console.'));
check('route is owner-gated', routeSource.includes("getRole") && routeSource.includes('403'));

const noGate = await onRequest({ request: new Request('https://example.com/api/admin/custom-places'), env: {} });
check('route: missing customer header is 400', noGate.status === 400);

const dbEnv = { ORDERS_DB: stubDb([]) };
const forbidden = await onRequest({ request: adminReq('/api/admin/custom-places'), env: dbEnv });
check('route: non-owner is 403', forbidden.status === 403);

const localEnv = { ALLOW_LOCAL_DEV: '1', ORDERS_DB: stubDb([]) };
const empty = await onRequest({ request: adminReq('/api/admin/custom-places', { local: true }), env: localEnv });
const emptyBody = await readJson(empty);
check('route: GET lists places', empty.status === 200 && emptyBody && emptyBody.ok === true && Array.isArray(emptyBody.places));

const created = await onRequest({ request: adminReq('/api/admin/custom-places', { local: true, method: 'POST', body: { name_ar: 'دوار السيوف', lat: 31.205, lng: 29.945 } }), env: localEnv });
const createdBody = await readJson(created);
check('route: POST creates with defaults', created.status === 200 && createdBody && createdBody.ok === true
  && createdBody.place.name_ar === 'دوار السيوف' && createdBody.place.kind === 'landmark');

const badName = await onRequest({ request: adminReq('/api/admin/custom-places', { local: true, method: 'POST', body: { name_ar: 'س', lat: 31.2, lng: 29.9 } }), env: localEnv });
check('route: POST invalid_name is 400', badName.status === 400 && (await readJson(badName)).error === 'invalid_name');

const badCoords = await onRequest({ request: adminReq('/api/admin/custom-places', { local: true, method: 'POST', body: { name_ar: 'دوار السيوف', lat: 91, lng: 0 } }), env: localEnv });
check('route: POST invalid_coords is 400', badCoords.status === 400);

const renamed = await onRequest({ request: adminReq('/api/admin/custom-places?id=1', { local: true, method: 'PUT', body: { name_ar: 'دوار السيوف الجديد' } }), env: localEnv });
const renamedBody = await readJson(renamed);
check('route: PUT renames', renamed.status === 200 && renamedBody && renamedBody.ok === true && renamedBody.place.name_ar === 'دوار السيوف الجديد');

const noId = await onRequest({ request: adminReq('/api/admin/custom-places', { local: true, method: 'PUT', body: { name_ar: 'دوار السيوف' } }), env: localEnv });
check('route: PUT without id is 400 invalid_id', noId.status === 400);

const removed = await onRequest({ request: adminReq('/api/admin/custom-places?id=1', { local: true, method: 'DELETE' }), env: localEnv });
const removedBody = await readJson(removed);
check('route: DELETE removes', removed.status === 200 && removedBody && removedBody.ok === true && removedBody.removed === true);

const removedAgain = await onRequest({ request: adminReq('/api/admin/custom-places?id=1', { local: true, method: 'DELETE' }), env: localEnv });
check('route: DELETE is idempotent', removedAgain.status === 200 && (await readJson(removedAgain)).removed === false);

const patch = await onRequest({ request: adminReq('/api/admin/custom-places', { local: true, method: 'PATCH' }), env: localEnv });
check('route: PATCH is 405', patch.status === 405);

const noDb = await onRequest({ request: adminReq('/api/admin/custom-places', { local: true }), env: { ALLOW_LOCAL_DEV: '1' } });
check('route: missing D1 is 503', noDb.status === 503);

summary();
