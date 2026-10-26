/**
 * Outbound mail via the Resend HTTP API (no dependencies, fetch only).
 *
 * Privacy: never log recipient addresses, subjects or bodies. Callers get
 * generic error codes only. Resend request verified against the current
 * Resend API reference: POST https://api.resend.com/emails with
 * `Idempotency-Key` header (<=256 chars, 24 h window), attachments as
 * [{ filename, content: base64 }], `reply_to` as a plain address string.
 */

const RESEND_URL = 'https://api.resend.com/emails';

/** UTF-8 string -> base64 (Workers have no Buffer). */
export function base64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(String(str ?? ''));
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  // btoa throws on lone surrogates; TextEncoder output is always valid.
  return btoa(bin);
}

/**
 * Send one email. `idempotencyKey` must be unique per logical email
 * (e.g. `monthly/<YYYY-MM>/<recipient-hash>`).
 * Returns { id }. Throws Error('mail_unconfigured' | 'mail_failed').
 */
export async function sendEmail(env, { to, subject, html, text, attachments, idempotencyKey, fromName }) {
  const apiKey = typeof env?.RESEND_API_KEY === 'string' ? env.RESEND_API_KEY.trim() : '';
  const fromAddr = typeof env?.MAIL_FROM_DOMAIN_EMAIL === 'string' ? env.MAIL_FROM_DOMAIN_EMAIL.trim() : '';
  if (!apiKey || !fromAddr || !to || !subject) throw new Error('mail_unconfigured');

  const body = {
    from: fromName ? `${fromName} <${fromAddr}>` : fromAddr,
    to: [to],
    subject,
    html,
    text,
  };
  const replyTo = typeof env?.REPLY_TO === 'string' ? env.REPLY_TO.trim() : '';
  if (replyTo) body.reply_to = replyTo;
  if (Array.isArray(attachments) && attachments.length) body.attachments = attachments;

  let res;
  try {
    res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': String(idempotencyKey).slice(0, 256) } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('mail_failed');
  }
  if (!res.ok) throw new Error('mail_failed');
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { id: data && typeof data.id === 'string' ? data.id : null };
}

/** Confirmation-link email (bilingual, link only — no account details). */
export function confirmEmailContent(confirmUrl, siteName) {
  const safe = String(confirmUrl || '');
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const name = String(siteName || 'our restaurant');
  return {
    subject: `Confirm your report email / أكّد بريد التقارير`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">`
      + `<p>Click the link below to confirm this address for monthly reports from ${esc(name)}.</p>`
      + `<p><a href="${esc(safe)}">Confirm email address</a></p>`
      + `<p dir="rtl">انقر الرابط أدناه لتأكيد هذا العنوان لاستلام التقارير الشهرية من ${esc(name)}.</p>`
      + `<p dir="rtl"><a href="${esc(safe)}">تأكيد البريد الإلكتروني</a></p>`
      + `<p style="color:#888;font-size:12px;">This link expires in 48 hours. / تنتهي صلاحية الرابط خلال 48 ساعة.</p></div>`,
    text: `Confirm your report email: ${safe}\n(This link expires in 48 hours.)\n\nتأكيد بريد التقارير: ${safe}\n(تنتهي صلاحية الرابط خلال 48 ساعة.)`,
  };
}
