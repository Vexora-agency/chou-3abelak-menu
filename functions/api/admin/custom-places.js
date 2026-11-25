/**
 * Admin custom places (areas & landmarks): GET/POST/PUT/DELETE
 * /api/admin/custom-places. Owner-only (canonical getRole gate +
 * checkApiHeaders, like every admin route; the directory _middleware
 * already requires a session). All responses are jsonNoStore.
 *
 *   GET    -> { ok:true, places:[{ id, name_ar, name_en, lat, lng, kind, created_at, updated_at }] }
 *   POST   -> { ok:true, place } — name_ar 2..80 chars, finite lat/lng,
 *             kind area|landmark|street (default landmark)
 *   PUT    -> { ok:true, place } — rename/retag by ?id= (coords immutable:
 *             delete + re-add to move a pin)
 *   DELETE -> { ok:true, removed:true } — ?id=, idempotent
 *
 * Failures: 400 invalid_name / invalid_coords / invalid_id / not_found /
 * bad_request, 403 forbidden (non-owner), 503 unavailable (DB).
 */

import { checkApiHeaders, jsonNoStore, readJsonBody } from '../../_shared/session.js';
import { getRole } from '../../_shared/access.js';
import {
  addCustomPlace,
  listCustomPlaces,
  removeCustomPlace,
  updateCustomPlace,
} from '../../_shared/repositories/places.repo.js';

const MAX_BODY_BYTES = 4 * 1024;

function isLocalDev(request, env) {
  try {
    if (env && env.ALLOW_LOCAL_DEV === '1') {
      const h = new URL(request.url).hostname;
      if (h === 'localhost' || h === '127.0.0.1') return true;
    }
  } catch {}
  return false;
}

function queryId(request) {
  try {
    const v = new URL(request.url).searchParams.get('id');
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error, message: gate.message }, gate.status);

  // Owner-only: the master session (sub 'admin'). Kitchen/client sessions
  // fail closed — a crew device must never manage the places list.
  let owner = false;
  try {
    owner = (await getRole(request, env)) === 'owner';
  } catch {
    owner = false;
  }
  if (!owner && isLocalDev(request, env)) owner = true;
  if (!owner) return jsonNoStore({ error: 'forbidden', message: 'Forbidden' }, 403);

  const db = env.ORDERS_DB || null;
  if (!db) return jsonNoStore({ error: 'unavailable', message: 'Orders database not configured' }, 503);

  if (request.method === 'GET') {
    try {
      const places = await listCustomPlaces(db);
      return jsonNoStore({ ok: true, places });
    } catch {
      return jsonNoStore({ error: 'unavailable' }, 503);
    }
  }

  if (request.method === 'POST' || request.method === 'PUT' || request.method === 'DELETE') {
    if (request.method === 'DELETE') {
      const id = queryId(request);
      if (!id) return jsonNoStore({ error: 'invalid_id' }, 400);
      try {
        const removed = await removeCustomPlace(db, id);
        return jsonNoStore({ ok: true, removed });
      } catch {
        return jsonNoStore({ error: 'unavailable' }, 503);
      }
    }
    const contentType = request.headers.get('Content-Type') || '';
    if (!contentType.includes('application/json')) {
      return jsonNoStore({ error: 'bad_request' }, 400);
    }
    let body;
    try {
      body = await readJsonBody(request, MAX_BODY_BYTES);
    } catch {
      return jsonNoStore({ error: 'bad_request' }, 400);
    }
    try {
      if (request.method === 'POST') {
        const res = await addCustomPlace(db, body);
        if (!res.ok) return jsonNoStore({ error: res.error }, res.error === 'unavailable' ? 503 : 400);
        return jsonNoStore({ ok: true, place: res.place });
      }
      const id = queryId(request);
      if (!id) return jsonNoStore({ error: 'invalid_id' }, 400);
      const res = await updateCustomPlace(db, id, body);
      if (!res.ok) {
        const status = res.error === 'unavailable' ? 503 : res.error === 'not_found' ? 404 : 400;
        return jsonNoStore({ error: res.error }, status);
      }
      return jsonNoStore({ ok: true, place: res.place });
    } catch {
      return jsonNoStore({ error: 'unavailable' }, 503);
    }
  }

  return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET, POST, PUT, DELETE' });
}
