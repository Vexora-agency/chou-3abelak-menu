/**
 * POST /api/admin/report-settings/test — email the most recent complete
 * month's report to the verified address. Rate limited: 3 per hour.
 * Manual sends never touch emailed_at / email_attempts (the scheduled run
 * owns those), and use their own idempotency namespace.
 */

import { checkApiHeaders, jsonNoStore } from '../../../_shared/session.js';
import { featureOffResponse, hasFeature } from '../../../_shared/plan.js';
import {
  buildEmailPayload,
  currentMonthInTZ,
  generateMonthlyReport,
  getMonthCSV,
  getReportSettings,
  loadMenuBasics,
  prevMonth,
  sha256Hex,
} from '../../../_shared/reports.js';
import { base64EncodeUtf8, sendEmail } from '../../../_shared/mail.js';
import { renderMonthlyReportEmail } from '../../../_shared/report-email.js';
import { hitRateLimit } from '../../../_shared/ratelimit.js';

const CSV_ATTACH_LIMIT = 400 * 1024;

export async function onRequest(context) {
  const { request, env } = context;
  if (!hasFeature(env, 'monthlyReports')) return featureOffResponse();
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error }, gate.status);
  if (request.method !== 'POST') return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  if (!env.ORDERS_DB) return jsonNoStore({ error: 'unavailable' }, 503);

  if (!(await hitRateLimit(env.MENU_KV, 'rl:report-test', 3, 3600))) {
    return jsonNoStore({ ok: false, error: 'rate_limited' }, 429);
  }

  const settings = await getReportSettings(env.ORDERS_DB);
  const email = typeof settings?.email === 'string' ? settings.email : '';
  if (!email) return jsonNoStore({ ok: false, error: 'no_email' }, 400);
  if (!settings?.verified) return jsonNoStore({ ok: false, error: 'not_verified' }, 400);

  const { timezone, restaurantName } = await loadMenuBasics(env);
  const month = prevMonth(currentMonthInTZ(timezone));
  let gen;
  try {
    gen = await generateMonthlyReport(env, month);
  } catch {
    return jsonNoStore({ ok: false, error: 'unavailable' }, 503);
  }

  let csvText = null;
  try {
    const got = await getMonthCSV(env, month);
    if (got && typeof got.csv === 'string') csvText = got.csv;
  } catch {}
  const csvBytes = csvText === null ? Infinity : new TextEncoder().encode(csvText).length;
  const attach = csvText !== null && csvBytes < CSV_ATTACH_LIMIT;

  const payload = await buildEmailPayload(env, gen.summary, attach);
  const lang = settings.language === 'ar' ? 'ar' : 'en';
  const rendered = renderMonthlyReportEmail(payload, lang);
  const emailHash = (await sha256Hex(email.toLowerCase())).slice(0, 32);
  try {
    await sendEmail(env, {
      to: email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      fromName: restaurantName.en,
      idempotencyKey: `monthly-test/${month}/${emailHash}/${Date.now()}`,
      attachments: attach
        ? [{ filename: `chou3abelak-${month}-orders.csv`, content: base64EncodeUtf8(csvText) }]
        : undefined,
    });
  } catch (e) {
    const code = e && e.message === 'mail_unconfigured' ? 'mail_unconfigured' : 'mail_failed';
    return jsonNoStore({ ok: false, error: code }, 503);
  }
  return jsonNoStore({ ok: true, month });
}
