/**
 * POST /api/admin/customer-data/action { phone, mode, password, confirm } —
 * anonymize (default) | delete | export CSV. Safeguards: admin password
 * re-entry, typed confirmation word + match count, 10/hour rate limit,
 * no-store. Every action writes an HMAC audit entry (no PII).
 */

import { checkApiHeaders, jsonNoStore, readJsonBody } from '../../../_shared/session.js';
import { featureOffResponse, hasFeature } from '../../../_shared/plan.js';
import { hitRateLimit } from '../../../_shared/ratelimit.js';
import {
  auditCustomerAction,
  checkAdminPassword,
  confirmWordOk,
  digitsOnly,
} from '../../../_shared/customer-data.js';
import {
  anonymizeByPhoneNorm,
  deleteByPhoneNorm,
  exportByPhoneNorm,
  findMatches,
} from '../../../_shared/repositories/customer-data.repo.js';
import { escapeCSV } from '../../../_shared/reports.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (!hasFeature(env, 'orderLogging')) return featureOffResponse();
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (request.method !== 'POST') return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  if (!env.ORDERS_DB) return jsonNoStore({ error: 'unavailable' }, 503);

  if (!(await hitRateLimit(env.MENU_KV, 'rl:customer-data', 10, 3600))) {
    return jsonNoStore({ ok: false, error: 'rate_limited' }, 429);
  }

  let body;
  try {
    body = await readJsonBody(request, 4 * 1024);
  } catch {
    return jsonNoStore({ ok: false, error: 'bad_request' }, 400);
  }
  const q = digitsOnly(body.phone);
  const mode = body.mode === 'delete' || body.mode === 'export' ? body.mode : 'anonymize';
  if (q.length < 6) return jsonNoStore({ ok: false, error: 'bad_request' }, 400);
  if (!(await checkAdminPassword(env, body.password))) return jsonNoStore({ ok: false, error: 'invalid_password' }, 403);
  if (!confirmWordOk(body.confirm, mode)) return jsonNoStore({ ok: false, error: 'confirmation_required' }, 400);

  let rows;
  try {
    rows = await findMatches(env.ORDERS_DB, q);
  } catch {
    return jsonNoStore({ ok: false, error: 'unavailable' }, 503);
  }
  if (rows.length === 0) return jsonNoStore({ ok: false, error: 'not_found' }, 404);

  const nowIso = new Date().toISOString();
  try {
    if (mode === 'delete') {
      await deleteByPhoneNorm(env.ORDERS_DB, q);
    } else if (mode === 'anonymize') {
      await anonymizeByPhoneNorm(env.ORDERS_DB, nowIso, q);
    } else {
      const list = await exportByPhoneNorm(env.ORDERS_DB, q);
      const lines = ['order_id,order_number,created_at,updated_at,status,type,customer_name,customer_phone,phone_norm,customer_address,customer_table,notes,location_lat,location_lng,items_json,subtotal,delivery_fee,total,lang,pii_purged_at'];
      for (const r of list) {
        lines.push(
          [r.id, r.number, r.created_at, r.updated_at, r.status, r.type, r.customer_name, r.customer_phone, r.phone_norm, r.customer_address, r.customer_table, r.notes, r.location_lat, r.location_lng, r.items_json, r.subtotal, r.delivery_fee, r.total, r.lang, r.pii_purged_at]
            .map(escapeCSV)
            .join(',')
        );
      }
      await auditCustomerAction(env, { who: 'admin', action: 'customer-data', mode, count: list.length, phoneNorm: q });
      return new Response('﻿' + lines.join('\n') + '\n', {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="customer-data-export.csv"',
          'Cache-Control': 'no-store',
        },
      });
    }
  } catch {
    return jsonNoStore({ ok: false, error: 'unavailable' }, 503);
  }
  await auditCustomerAction(env, { who: 'admin', action: 'customer-data', mode, count: rows.length, phoneNorm: q });
  return jsonNoStore({ ok: true, mode, count: rows.length });
}
