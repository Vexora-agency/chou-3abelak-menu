/**
 * POST /api/internal/run-reports — daily scheduled run (called by the
 * tiny scheduler Worker, NOT by browsers).
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` with a constant-time compare.
 * No cookies are consulted. Wrong/missing secret answers 404 so the route
 * is indistinguishable from a missing one.
 *
 * One run does, in order:
 *  (a) previous-month email: if the previous complete month has no
 *      emailed_at (and fewer than 5 attempts), generate + email it to the
 *      verified address. Retries on later runs, then 'failed' (visible in
 *      the Reports tab). Exactly-once: emailed_at short-circuits reruns.
 *  (b) data retention (PII purge, order delete, report delete).
 */

import { jsonNoStore, safeCompareStrings } from '../../_shared/session.js';
import { hasFeature } from '../../_shared/plan.js';
import {
  buildEmailPayload,
  currentMonthInTZ,
  dayOfMonthInTZ,
  generateMonthlyReport,
  getMonthCSV,
  getReportSettings,
  loadMenuBasics,
  prevMonth,
  readStoredReport,
  runRetention,
  sha256Hex,
} from '../../_shared/reports.js';
import {
  backupEnvelope,
  getAutoBackup,
  getSiteId,
  pruneVersions,
  purgeTrash,
  setAutoBackup,
  signPayload,
  weekdayInTZ,
  weeklyBackupEmail,
} from '../../_shared/versions.js';
import { base64EncodeUtf8, sendEmail } from '../../_shared/mail.js';
import { renderMonthlyReportEmail } from '../../_shared/report-email.js';

const CSV_ATTACH_LIMIT = 400 * 1024;
const MAX_ATTEMPTS = 5;

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return jsonNoStore({ error: 'not_found' }, 404);

  const secret = typeof env?.CRON_SECRET === 'string' ? env.CRON_SECRET : '';
  const auth = request.headers.get('Authorization') || '';
  const presented = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!secret || !presented || !safeCompareStrings(presented, secret)) {
    return jsonNoStore({ error: 'not_found' }, 404);
  }
  // The whole scheduled job (email + retention) belongs to monthlyReports.
  if (!hasFeature(env, 'monthlyReports')) return jsonNoStore({ error: 'not_found' }, 404);
  if (!env.ORDERS_DB) return jsonNoStore({ error: 'unavailable' }, 503);

  // ---- (a) previous-month email ----
  const { timezone, restaurantName } = await loadMenuBasics(env);
  const month = prevMonth(currentMonthInTZ(timezone, Date.now()));
  let emailed = false;
  let attempts = 0;

  // The previous month is complete on/after day 1 (guard reads naturally).
  if (dayOfMonthInTZ(timezone, Date.now()) >= 1) {
    const settings = await getReportSettings(env.ORDERS_DB);
    const email = typeof settings?.email === 'string' ? settings.email : '';
    const sendable = settings?.enabled && settings?.verified && email;
    if (sendable) {
      // generate first so the monthly_reports row exists (idempotent reuse),
      // then decide from the stored attempts/emailed_at (race-safe).
      let gen = null;
      try {
        gen = await generateMonthlyReport(env, month);
      } catch {}
      const fresh = gen ? await readStoredReport(env.ORDERS_DB, month) : null;
      attempts = fresh?.attempts || 0;
      if (fresh && !fresh.emailedAt && attempts < MAX_ATTEMPTS) {
        attempts += 1;
        try {
          await env.ORDERS_DB.prepare(
            'UPDATE monthly_reports SET email_attempts = ?1, email_status = ?2 WHERE month = ?3'
          )
            .bind(attempts, 'pending', month)
            .run();
        } catch {}
        try {
          let csvText = null;
          try {
            const got = await getMonthCSV(env, month);
            if (got && typeof got.csv === 'string') csvText = got.csv;
          } catch {}
          const csvBytes = csvText === null ? Infinity : new TextEncoder().encode(csvText).length;
          const attach = csvText !== null && csvBytes < CSV_ATTACH_LIMIT;
          const payload = await buildEmailPayload(env, gen.summary, attach);
          const rendered = renderMonthlyReportEmail(payload, settings.language === 'ar' ? 'ar' : 'en');
          const emailHash = (await sha256Hex(email.toLowerCase())).slice(0, 32);
          await sendEmail(env, {
            to: email,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            fromName: restaurantName.en,
            idempotencyKey: `monthly/${month}/${emailHash}`,
            attachments: attach
              ? [{ filename: `chou3abelak-${month}-orders.csv`, content: base64EncodeUtf8(csvText) }]
              : undefined,
          });
          emailed = true;
          try {
            await env.ORDERS_DB.prepare(
              "UPDATE monthly_reports SET emailed_at = ?1, email_status = 'sent' WHERE month = ?2"
            )
              .bind(new Date().toISOString(), month)
              .run();
          } catch {}
        } catch {
          try {
            await env.ORDERS_DB.prepare('UPDATE monthly_reports SET email_attempts = ?1, email_status = ?2 WHERE month = ?3')
              .bind(attempts, attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', month)
              .run();
          } catch {}
        }
      } else if (fresh && !fresh.emailedAt && attempts >= MAX_ATTEMPTS && fresh.emailStatus !== 'failed') {
        try {
          await env.ORDERS_DB.prepare("UPDATE monthly_reports SET email_status = 'failed' WHERE month = ?1")
            .bind(month)
            .run();
        } catch {}
      }
    }
  }

  // ---- (b) weekly automatic backup (Mondays, business timezone) ----
  let weekly = { sent: false };
  try {
    const auto = await getAutoBackup(env);
    if (auto.enabled && weekdayInTZ(timezone, Date.now()) === 1) {
      const rs = await getReportSettings(env.ORDERS_DB);
      const dest = rs && rs.enabled && rs.verified && rs.email ? rs.email : null;
      if (dest) {
        let menuDoc = null;
        try {
          menuDoc = await env.MENU_KV.get('menu', { type: 'json' });
        } catch {}
        if (menuDoc) {
          let dateStr = '';
          try {
            dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
          } catch {
            dateStr = new Date().toISOString().slice(0, 10);
          }
          const envelope = backupEnvelope({ menu: menuDoc, siteId: await getSiteId(env), exportedAt: new Date().toISOString() });
          const sig = await signPayload(env, envelope);
          const json = JSON.stringify({ ...envelope, sig });
          const content = weeklyBackupEmail(dateStr, restaurantName.en);
          const emailHash = (await sha256Hex(dest.toLowerCase())).slice(0, 32);
          await sendEmail(env, {
            to: dest,
            subject: content.subject,
            html: content.html,
            text: content.text,
            fromName: restaurantName.en,
            idempotencyKey: `weekly/${dateStr}/${emailHash}`,
            attachments: [{ filename: `chou3abelak-backup-${dateStr}.json`, content: base64EncodeUtf8(json) }],
          });
          weekly = { sent: true };
          await setAutoBackup(env, { enabled: true, lastBackupAt: new Date().toISOString() });
          if (env.REPORTS && typeof env.REPORTS.put === 'function') {
            try {
              await env.REPORTS.put(`backups/${dateStr}.json`, json, { httpMetadata: { contentType: 'application/json' } });
              const listed = await env.REPORTS.list({ prefix: 'backups/' });
              const keys = ((listed && listed.objects) || []).map((o) => o.key).sort().reverse();
              for (const k of keys.slice(12)) {
                try {
                  await env.REPORTS.delete(k);
                } catch {}
              }
            } catch {}
          }
        }
      }
    }
  } catch {
    weekly = { sent: false };
  }

  // ---- (c) retention + history housekeeping ----
  let retention = null;
  try {
    retention = await runRetention(env);
  } catch {
    retention = { error: 'unavailable' };
  }
  let prunedVersions = 0;
  let trashPurged = 0;
  try {
    prunedVersions = await pruneVersions(env);
  } catch {}
  try {
    trashPurged = await purgeTrash(env);
  } catch {}

  return jsonNoStore({ ok: true, month, emailed, attempts, retention, weekly, prunedVersions, trashPurged });
}
