/**
 * GET /api/reports/confirm?token=... — PUBLIC confirmation link from the
 * report-settings email. Constant-time token-hash compare, single use, then
 * verified=1. Reveals nothing about the account (no address ever rendered).
 */

import { safeCompareStrings } from '../../_shared/session.js';
import { sha256Hex } from '../../_shared/reports.js';
import { confirmReportEmail, getReportSettingsRow } from '../../_shared/repositories/report-settings.repo.js';

function page(ok, logoUrl, adminUrl) {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const back = adminUrl
    ? `<div><a href="${esc(adminUrl)}" style="display:inline-block;margin-top:26px;padding:14px 36px;background:#FFC400;color:#0A0A0A;font-weight:bold;font-size:15px;border-radius:999px;text-decoration:none;font-family:Arial,Tahoma,sans-serif;">Back to Admin / عودة إلى الإدارة</a></div>`
    : '';
  const title = ok ? 'Email confirmed / تم تأكيد البريد' : 'Link invalid or expired / الرابط غير صالح أو منتهي';
  const body = ok
    ? '<p>Monthly reports will now be sent to your confirmed address.</p><p dir="rtl">ستصلك التقارير الشهرية على عنوانك المؤكد من الآن.</p>'
    : '<p>This confirmation link is invalid or has expired. Ask the store admin to send a new one from Dashboard → Reports.</p><p dir="rtl">رابط التأكيد غير صالح أو انتهت صلاحيته. اطلب من مدير المتجر إرسال رابط جديد من لوحة التحكم ثم التقارير.</p>';
  const logo = logoUrl
    ? `<img src="${logoUrl}" width="180" alt="Chou 3abelak" style="display:block;margin:0 auto 4px;border:0;max-width:180px;height:auto;">`
    : '';
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${title}</title></head><body style="margin:0;background:#0A0A0A;color:#fff;font-family:Arial,Tahoma,sans-serif;">` +
      `<div style="max-width:560px;margin:0 auto;padding:40px 24px 48px;text-align:center;">` +
      logo +
      `<div style="height:4px;border-radius:2px;background:#FFC400;max-width:180px;margin:14px auto 22px;"></div>` +
      `<div style="display:inline-block;width:56px;height:56px;border-radius:28px;background:${ok ? '#1E9E52' : '#5A5A5A'};font-size:28px;line-height:56px;">${ok ? '✓' : '!'}</div>` +
      `<h1 style="font-size:20px;margin:20px 0 12px;">${title}</h1>` +
      `<div style="font-size:14px;line-height:22px;color:#BDBDBD;">${body}</div>${back}</div></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: { 'Cache-Control': 'no-store' } });
  }
  let logoUrl = '';
  let adminUrl = '';
  try {
    const origin = new URL(request.url).origin;
    logoUrl = `${origin}/assets/email-logo.png`;
    adminUrl = `${origin}/admin`;
  } catch {}
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';
  if (!/^[0-9a-fA-F]{32,128}$/.test(token) || !env.ORDERS_DB) return page(false, logoUrl, adminUrl);

  let row;
  try {
    row = await getReportSettingsRow(env.ORDERS_DB);
  } catch {
    return page(false, logoUrl, adminUrl);
  }
  if (!row || !row.verify_token_hash) return page(false, logoUrl, adminUrl);
  if (row.verify_expires_at && String(row.verify_expires_at) < new Date().toISOString()) return page(false, logoUrl, adminUrl);

  let presented;
  try {
    presented = await sha256Hex(token.toLowerCase());
  } catch {
    return page(false, logoUrl, adminUrl);
  }
  if (!safeCompareStrings(presented, String(row.verify_token_hash))) return page(false, logoUrl, adminUrl);

  // Single use: verify and burn the token in one write.
  try {
    await confirmReportEmail(env.ORDERS_DB, new Date().toISOString());
  } catch {
    return page(false, logoUrl, adminUrl);
  }
  return page(true, logoUrl, adminUrl);
}
