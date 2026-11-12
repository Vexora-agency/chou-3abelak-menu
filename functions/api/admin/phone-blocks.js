/**
 * Admin phone blocklist: GET/POST/DELETE /api/admin/phone-blocks.
 * Owner-only (canonical getRole gate + checkApiHeaders, like every admin
 * route; the directory _middleware already requires a session). All
 * responses are jsonNoStore — nothing here is ever cached.
 *
 *   GET    -> { ok:true, blocked:[{ phone_norm, reason, created_at }] }
 *   POST   -> { ok:true, block:{ phone_norm, reason, created_at } } — phone
 *             6-15 digits, reason <= 140 chars
 *   DELETE -> { ok:true, removed:true } — idempotent unblock
 *
 * Failures: 400 invalid_phone / invalid_reason / bad_request, 403
 * forbidden (non-owner), 503 unavailable (DB).
 */

import { checkApiHeaders, jsonNoStore, readJsonBody } from '../../_shared/session.js';
import { getRole } from '../../_shared/access.js';
import {
  addPhoneBlock,
  listPhoneBlocks,
  removePhoneBlock,
} from '../../_shared/repositories/orders.repo.js';

const MAX_BODY_BYTES = 4 * 1024;
const MAX_REASON = 140;

function normalizePhone(v) {
  return typeof v === 'string' ? v.replace(/[^0-9]/g, '') : '';
}

function isLocalDev(request, env) {
  try {
    if (env && env.ALLOW_LOCAL_DEV === '1') {
      const h = new URL(request.url).hostname;
      if (h === 'localhost' || h === '127.0.0.1') return true;
    }
  } catch {}
  return false;
}

export async function onRequest(context) {
  const { request, env } = context;

  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error, message: gate.message }, gate.status);

  // Owner-only: the master session (sub 'admin'). Kitchen/client sessions
  // fail closed — a crew device must never manage the blocklist.
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
      // `blocked` (snake-case rows): the dashboard renders these keys
      // directly — the shape is the admin API contract.
      const blocked = await listPhoneBlocks(db);
      return jsonNoStore({ ok: true, blocked });
    } catch {
      return jsonNoStore({ error: 'unavailable' }, 503);
    }
  }

  if (request.method === 'POST' || request.method === 'DELETE') {
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
    const phone = normalizePhone(body.phone);
    if (phone.length < 6 || phone.length > 15) {
      return jsonNoStore({ error: 'invalid_phone' }, 400);
    }
    if (request.method === 'DELETE') {
      try {
        const removed = await removePhoneBlock(db, phone);
        return jsonNoStore({ ok: true, removed });
      } catch {
        return jsonNoStore({ error: 'unavailable' }, 503);
      }
    }
    const rawReason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (rawReason.length > MAX_REASON) {
      return jsonNoStore({ error: 'invalid_reason' }, 400);
    }
    try {
      const block = await addPhoneBlock(db, phone, rawReason ? rawReason : null);
      return jsonNoStore({ ok: true, block });
    } catch {
      return jsonNoStore({ error: 'unavailable' }, 503);
    }
  }

  return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET, POST, DELETE' });
}
