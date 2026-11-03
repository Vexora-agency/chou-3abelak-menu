/**
 * Report settings: GET /api/admin/report-settings, PUT /api/admin/report-settings
 * Behind the admin middleware + the "monthlyReports" plan feature (404 when off).
 *
 * PUT { enabled, email, language }: strict validation. When the address
 * changes, verified resets to 0 and only a SHA-256 hash of a random
 * single-use token (48 h) is stored; a confirmation email is sent.
 * Reports are only ever sent to a verified address.
 */

import { checkApiHeaders, jsonNoStore, readJsonBody } from '../../_shared/session.js';
import { featureOffResponse, hasFeature } from '../../_shared/plan.js';
import {
  getReportSettings,
  getRetentionConfig,
  isValidReportEmail,
  loadMenuBasics,
  newVerifyToken,
  sha256Hex,
  verifyExpiryISO,
} from '../../_shared/reports.js';
import { upsertReportSettings } from '../../_shared/repositories/report-settings.repo.js';
import { confirmEmailContent, sendEmail } from '../../_shared/mail.js';

function publicSettings(row, env) {
  const cfg = getRetentionConfig(env);
  return {
    enabled: !!row?.enabled,
    email: typeof row?.email === 'string' ? row.email : '',
    verified: !!row?.verified,
    language: row?.language === 'ar' ? 'ar' : 'en',
    retention: { piiDays: cfg.piiDays, orderMonths: cfg.orderMonths, reportMonths: cfg.reportMonths },
    schedule: { sendTime: '05:00', timezone: 'UTC' },
  };
}

async function sendConfirmation(env, email, token) {
  const site = typeof env?.SITE_URL === 'string' ? env.SITE_URL.replace(/\/$/, '') : '';
  if (!site) return false;
  const { restaurantName } = await loadMenuBasics(env);
  const name = restaurantName.en || 'our store';
  const content = confirmEmailContent(`${site}/api/reports/confirm?token=${token}`, name);
  try {
    await sendEmail(env, {
      to: email,
      subject: content.subject,
      html: content.html,
      text: content.text,
      fromName: name,
      idempotencyKey: `confirm/${(await sha256Hex(token)).slice(0, 32)}`,
    });
    return true;
  } catch {
    return false;
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!hasFeature(env, 'monthlyReports')) return featureOffResponse();
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (!env.ORDERS_DB) return jsonNoStore({ error: 'unavailable' }, 503);

  if (request.method === 'GET') {
    const row = await getReportSettings(env.ORDERS_DB);
    const { timezone } = await loadMenuBasics(env);
    return jsonNoStore({ ...publicSettings(row, env), businessTimezone: timezone });
  }

  if (request.method === 'PUT') {
    let body;
    try {
      body = await readJsonBody(request, 4 * 1024);
    } catch {
      return jsonNoStore({ ok: false, error: 'bad_request' }, 400);
    }
    if (typeof body.enabled !== 'boolean') return jsonNoStore({ ok: false, error: 'invalid_enabled' }, 400);
    if (body.language !== 'en' && body.language !== 'ar') return jsonNoStore({ ok: false, error: 'invalid_language' }, 400);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (body.enabled && !isValidReportEmail(email)) return jsonNoStore({ ok: false, error: 'invalid_email' }, 400);
    if (email && !isValidReportEmail(email)) return jsonNoStore({ ok: false, error: 'invalid_email' }, 400);

    const prev = await getReportSettings(env.ORDERS_DB);
    const prevEmail = typeof prev?.email === 'string' ? prev.email : '';
    const changed = email !== prevEmail;

    let verified = prev?.verified ? 1 : 0;
    let tokenHash = prev?.verify_token_hash || null;
    let expiresAt = prev?.verify_expires_at || null;
    let verificationSent = false;

    if (changed) {
      verified = 0;
      tokenHash = null;
      expiresAt = null;
      if (email) {
        const { token, hash } = await newVerifyToken();
        tokenHash = hash;
        expiresAt = verifyExpiryISO();
        verificationSent = await sendConfirmation(env, email, token);
      }
    }

    const nowIso = new Date().toISOString();
    try {
      await upsertReportSettings(env.ORDERS_DB, {
        enabled: body.enabled,
        email,
        verified,
        language: body.language,
        tokenHash,
        expiresAt,
        nowIso,
      });
    } catch {
      return jsonNoStore({ ok: false, error: 'unavailable' }, 503);
    }
    return jsonNoStore({ ok: true, verificationSent });
  }

  return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET, PUT' });
}
