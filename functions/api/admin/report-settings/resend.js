/**
 * POST /api/admin/report-settings/resend — re-send the confirmation link
 * to the currently saved (unverified) address. Rate limited: 5 per hour.
 */

import { checkApiHeaders, jsonNoStore, readJsonBody } from '../../../_shared/session.js';
import { featureOffResponse, hasFeature } from '../../../_shared/plan.js';
import {
  getReportSettings,
  loadMenuBasics,
  newVerifyToken,
  sha256Hex,
  verifyExpiryISO,
} from '../../../_shared/reports.js';
import { confirmEmailContent, sendEmail } from '../../../_shared/mail.js';
import { hitRateLimit } from '../../../_shared/ratelimit.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (!hasFeature(env, 'monthlyReports')) return featureOffResponse();
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (request.method !== 'POST') return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  if (!env.ORDERS_DB) return jsonNoStore({ error: 'unavailable' }, 503);

  if (!(await hitRateLimit(env.MENU_KV, 'rl:report-resend', 5, 3600))) {
    return jsonNoStore({ ok: false, error: 'rate_limited' }, 429);
  }

  const row = await getReportSettings(env.ORDERS_DB);
  const email = typeof row?.email === 'string' ? row.email : '';
  if (!email) return jsonNoStore({ ok: false, error: 'no_email' }, 400);
  if (row?.verified) return jsonNoStore({ ok: false, error: 'already_verified' }, 400);

  const { token, hash } = await newVerifyToken();
  const expiresAt = verifyExpiryISO();
  try {
    await env.ORDERS_DB.prepare(
      'UPDATE report_settings SET verify_token_hash = ?1, verify_expires_at = ?2, updated_at = ?3 WHERE id = 1'
    )
      .bind(hash, expiresAt, new Date().toISOString())
      .run();
  } catch {
    return jsonNoStore({ ok: false, error: 'unavailable' }, 503);
  }

  const site = typeof env?.SITE_URL === 'string' ? env.SITE_URL.replace(/\/$/, '') : '';
  if (!site) return jsonNoStore({ ok: false, error: 'mail_unconfigured' }, 503);
  const { restaurantName } = await loadMenuBasics(env);
  const content = confirmEmailContent(`${site}/api/reports/confirm?token=${token}`, restaurantName.en || 'our restaurant');
  try {
    await sendEmail(env, {
      to: email,
      subject: content.subject,
      html: content.html,
      text: content.text,
      fromName: restaurantName.en,
      idempotencyKey: `confirm/${(await sha256Hex(token)).slice(0, 32)}`,
    });
  } catch {
    return jsonNoStore({ ok: false, error: 'mail_failed' }, 503);
  }
  return jsonNoStore({ ok: true });
}
