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
import {
  markReportAttempt,
  markReportFailed,
  markReportPending,
  markReportSent,
} from '../../_shared/repositories/reports.repo.js';
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
  // Each block below is gated on its OWN feature: the monthly email on
  // monthlyReports, the weekly backup + housekeeping on backups. Gating the
  // whole job on monthlyReports silently killed weekly backups for any plan
  // split that has backups without reports.
  const reportsOn = hasFeature(env, 'monthlyReports');
  const backupsOn = hasFeature(env, 'backups');
  if (!reportsOn && !backupsOn) return jsonNoStore({ error: 'not_found' }, 404);
  if (!env.ORDERS_DB) return jsonNoStore({ error: 'unavailable' }, 503);

  // ---- (a) previous-month email ----
  const { timezone, restaurantName } = await loadMenuBasics(env);
  const month = prevMonth(currentMonthInTZ(timezone, Date.now()));
  let emailed = false;
  let attempts = 0;

  if (reportsOn) {

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
          await markReportPending(env.ORDERS_DB, month, attempts);
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
            await markReportSent(env.ORDERS_DB, month, new Date().toISOString());
          } catch {}
        } catch {
          try {
            await markReportAttempt(env.ORDERS_DB, month, attempts, MAX_ATTEMPTS);
          } catch {}
        }
      } else if (fresh && !fresh.emailedAt && attempts >= MAX_ATTEMPTS && fresh.emailStatus !== 'failed') {
        try {
          await markReportFailed(env.ORDERS_DB, month);
        } catch {}
      }
    }
  }
  } // end reportsOn

  // ---- (b) weekly automatic backup (Mondays, business timezone) ----
  let weekly = { sent: false };
  if (backupsOn) {
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
  } // end backupsOn

  // ---- (c) retention + history housekeeping ----
  // Retention serves the reports data lifecycle; version/trash pruning
  // serves backups. Each runs only under its own feature.
  let retention;
  if (reportsOn) {
    try {
      retention = await runRetention(env);
    } catch {
      retention = { error: 'unavailable' };
    }
  } else {
    retention = { skipped: 'reports_off' };
  }
  let prunedVersions = 0;
  let trashPurged = 0;
  if (backupsOn) {
    try {
      prunedVersions = await pruneVersions(env);
    } catch {}
    try {
      trashPurged = await purgeTrash(env);
    } catch {}
  }

  return jsonNoStore({ ok: true, month, emailed, attempts, retention, weekly, prunedVersions, trashPurged });
}
