/**
 * GET/POST /api/admin/phone-verifications
 *
 * Owner-side manual approval for reverse WhatsApp phone verification.
 * GET lists live pending requests (newest last, so the oldest waiting member
 * is first). POST { id, action: 'approve' | 'reject' } decides one row.
 *
 * Admin middleware already gates this path; the kitchen role is denied there.
 * The code itself is never returned: the owner matches the WhatsApp message
 * by sender number + reference, then approves.
 */

import { checkApiHeaders, jsonNoStore, readJsonBody } from '../../_shared/session.js';
import { getRequestRole } from '../../_shared/kitchen-gate.js';
import {
  countPendingVerifications,
  decideVerification,
  expireStaleApproved,
  expireStalePending,
  getVerificationById,
  listVerifications,
  phoneOwnedByAnotherUser,
  pruneWhatsAppEvents,
} from '../../_shared/repositories/phone-verifications.repo.js';
import { PHONE_LINKED_ERROR, PHONE_LINKED_MESSAGE } from '../../_shared/phone-verification.js';

const MAX_BODY_BYTES = 4 * 1024;

function publicRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    phone: row.phone,
    reference: row.reference,
    status: row.status,
    method: row.method === 'sms' ? 'sms' : 'whatsapp',
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    decidedAt: row.decided_at || null,
    decidedBy: row.decided_by || null,
    memberName: typeof row.user_name === 'string' ? row.user_name : '',
    memberEmail: typeof row.user_email === 'string' ? row.user_email : '',
  };
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET' && request.method !== 'POST') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET, POST' });
  }

  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error, message: gate.message }, gate.status);

  const db = env.ORDERS_DB || null;
  if (!db) return jsonNoStore({ error: 'unavailable' }, 503);

  const nowIso = new Date().toISOString();

  if (request.method === 'GET') {
    try {
      await expireStalePending(db, nowIso);
      // Keep the webhook audit table bounded; 90 days is plenty for support.
      await pruneWhatsAppEvents(db, new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());
      const url = new URL(request.url);
      const status = url.searchParams.get('status') === 'all' ? 'all' : 'pending';
      const limitRaw = Number.parseInt(url.searchParams.get('limit') || '50', 10);
      const limit = Number.isInteger(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 50;
      const [rows, pendingCount] = await Promise.all([
        listVerifications(db, { status, limit, nowIso }),
        countPendingVerifications(db, nowIso),
      ]);
      const verifications = rows.map(publicRow);
      return jsonNoStore({ verifications, count: verifications.length, pendingCount, status });
    } catch {
      return jsonNoStore({ error: 'unavailable' }, 503);
    }
  }

  let body;
  try {
    body = await readJsonBody(request, MAX_BODY_BYTES);
  } catch {
    return jsonNoStore({ error: 'bad_request' }, 400);
  }

  const id = body && typeof body.id === 'string' ? body.id.trim().slice(0, 64) : '';
  const action = body && typeof body.action === 'string' ? body.action.trim().toLowerCase() : '';
  if (!id) return jsonNoStore({ error: 'id_required' }, 400);
  if (action !== 'approve' && action !== 'reject') return jsonNoStore({ error: 'bad_action' }, 400);

  try {
    await expireStalePending(db, nowIso);
    const role = await getRequestRole(request, env);
    if (action === 'approve') {
      const pending = await getVerificationById(db, id);
      if (!pending) {
        return jsonNoStore({ error: 'not_pending', message: 'This request was already decided or expired.' }, 409);
      }
      await expireStaleApproved(db, Date.now(), pending.phone);
      if (await phoneOwnedByAnotherUser(db, pending.phone, pending.user_id, Date.now())) {
        await decideVerification(db, id, {
          status: 'rejected',
          decidedBy: 'ownership_conflict',
          nowIso,
        });
        return jsonNoStore({ error: PHONE_LINKED_ERROR, message: PHONE_LINKED_MESSAGE }, 409);
      }
    }
    const row = await decideVerification(db, id, {
      status: action === 'approve' ? 'approved' : 'rejected',
      decidedBy: role || 'dashboard',
      nowIso,
    });
    if (!row) {
      return jsonNoStore({ error: 'not_pending', message: 'This request was already decided or expired.' }, 409);
    }
    return jsonNoStore({ ok: true, verification: publicRow(row) });
  } catch {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }
}
