/**
 * Invite validity probe: GET /api/invite/validate?token=...
 * Public (the token IS the credential) + IP rate-limited. Read-only, so no
 * state changes: validity is single-use-enforced at redeem time.
 * Same response shape either way — only `ok` differs, never the reason.
 */

import { checkApiHeaders, jsonNoStore } from '../../_shared/session.js';
import {
  checkRateLimit,
  findInviteByHash,
  inviteUsable,
  isTokenFormat,
  rateKey,
  sha256Hex,
} from '../../_shared/access.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET') {
    return jsonNoStore({ error: 'method_not_allowed', message: 'Method Not Allowed' }, 405, { Allow: 'GET' });
  }
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error, message: gate.message }, gate.status);

  const kv = env.MENU_KV || null;
  const rl = await checkRateLimit(kv, rateKey('invite:validate', request), 30, 15 * 60);
  if (!rl.ok) return jsonNoStore({ ok: false, error: 'locked', retryMin: rl.retryMin }, 429);

  const url = new URL(request.url);
  const token = (url.searchParams.get('token') || '').trim();
  const db = env.ORDERS_DB || null;
  if (!isTokenFormat(token) || !db) return jsonNoStore({ ok: false });

  try {
    const row = await findInviteByHash(db, await sha256Hex(token));
    if (inviteUsable(row, new Date().toISOString())) {
      return jsonNoStore({ ok: true, username: row.username });
    }
    return jsonNoStore({ ok: false });
  } catch {
    return jsonNoStore({ ok: false });
  }
}
