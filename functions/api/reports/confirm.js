/**
 * GET /api/reports/confirm?token=... — PUBLIC confirmation link from the
 * report-settings email. Constant-time token-hash compare, single use, then
 * verified=1. Reveals nothing about the account (no address ever rendered).
 */

import { safeCompareStrings } from '../../_shared/session.js';
import { sha256Hex } from '../../_shared/reports.js';

function page(ok) {
  const title = ok ? 'Email confirmed / تم تأكيد البريد' : 'Link invalid or expired / الرابط غير صالح أو منتهي';
  const body = ok
    ? '<p>Monthly reports will now be sent to your confirmed address.</p><p dir="rtl">ستصلك التقارير الشهرية على عنوانك المؤكد من الآن.</p>'
    : '<p>This confirmation link is invalid or has expired. Ask the restaurant admin to send a new one from Dashboard → Reports.</p><p dir="rtl">رابط التأكيد غير صالح أو انتهت صلاحيته. اطلب من مدير المطعم إرسال رابط جديد من لوحة التحكم ثم التقارير.</p>';
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${title}</title></head><body style="margin:0;background:#0A0A0A;color:#fff;font-family:Arial,Tahoma,sans-serif;">` +
      `<div style="max-width:560px;margin:0 auto;padding:48px 24px;text-align:center;">` +
      `<div style="display:inline-block;width:56px;height:56px;border-radius:28px;background:${ok ? '#1E9E52' : '#5A5A5A'};font-size:28px;line-height:56px;">${ok ? '✓' : '!'}</div>` +
      `<h1 style="font-size:20px;margin:20px 0 12px;">${title}</h1>` +
      `<div style="font-size:14px;line-height:22px;color:#BDBDBD;">${body}</div></div></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: { 'Cache-Control': 'no-store' } });
  }
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';
  if (!/^[0-9a-fA-F]{32,128}$/.test(token) || !env.ORDERS_DB) return page(false);

  let row = null;
  try {
    row = await env.ORDERS_DB.prepare('SELECT * FROM report_settings WHERE id = 1').first();
  } catch {
    return page(false);
  }
  if (!row || !row.verify_token_hash) return page(false);
  if (row.verify_expires_at && String(row.verify_expires_at) < new Date().toISOString()) return page(false);

  let presented = '';
  try {
    presented = await sha256Hex(token.toLowerCase());
  } catch {
    return page(false);
  }
  if (!safeCompareStrings(presented, String(row.verify_token_hash))) return page(false);

  // Single use: verify and burn the token in one write.
  try {
    await env.ORDERS_DB.prepare(
      'UPDATE report_settings SET verified = 1, verify_token_hash = NULL, verify_expires_at = NULL, updated_at = ?1 WHERE id = 1'
    )
      .bind(new Date().toISOString())
      .run();
  } catch {
    return page(false);
  }
  return page(true);
}
