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

/** Confirmation-link email: same brand shell as the monthly report email
 *  (black logo band, gold accents, white card, black footer) so the two are
 *  visibly from the same store. Bilingual EN block + AR block, each with
 *  its own button. Dark-mode force-light rules included like the report mail. */
export function confirmEmailContent(confirmUrl, siteName) {
  const safe = String(confirmUrl || '');
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const name = String(siteName || 'our store');
  let logo = '';
  try {
    const origin = new URL(safe).origin;
    if (origin.startsWith('https://')) logo = `${origin}/assets/email-logo.png`;
  } catch {}
  const btn = (label) => `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td class="em-ylb" bgcolor="#FFC400" style="background:#FFC400;border-radius:999px;"><a href="${esc(safe)}" class="em-tink" style="display:inline-block;padding:15px 34px;font-size:15px;font-weight:bold;color:#0A0A0A;text-decoration:none;font-family:Arial,Tahoma,sans-serif;">${esc(label)}</a></td></tr></table>`;
  return {
    subject: `Confirm your report email / أكّد بريد التقارير`,
    html: `<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>Confirm your report email</title>
<style>@media (prefers-color-scheme: dark){
.em-dark-keep{background-color:#0A0A0A!important;}
.em-bgw{background-color:#FFFFFF!important;}
.em-tink{color:#0A0A0A!important;}.em-tgrey{color:#5A5A5A!important;}.em-tmut{color:#8A8A8A!important;}
.em-ylb{background-color:#FFC400!important;}.em-ylt{color:#FFC400!important;}
}
[data-ogsc] .em-dark-keep{background-color:#0A0A0A!important;}
[data-ogsc] .em-bgw{background-color:#FFFFFF!important;}
[data-ogsc] .em-tink{color:#0A0A0A!important;}[data-ogsc] .em-tgrey{color:#5A5A5A!important;}[data-ogsc] .em-tmut{color:#8A8A8A!important;}
[data-ogsc] .em-ylb{background-color:#FFC400!important;}[data-ogsc] .em-ylt{color:#FFC400!important;}</style></head>
<body style="margin:0;padding:0;background:#EDEDED;font-family:Arial,Tahoma,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#EDEDED"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;">
  <tr><td class="em-dark-keep" bgcolor="#0A0A0A" align="center" style="background:#0A0A0A;border-radius:20px 20px 0 0;padding:30px 24px 24px;">
    ${logo ? `<img src="${esc(logo)}" width="180" alt="${esc(name)}" style="display:block;margin:0 auto;border:0;max-width:180px;height:auto;font-size:18px;font-weight:bold;color:#FFC400;">` : ''}
    <div class="em-ylt" style="margin-top:16px;font-size:12px;font-weight:bold;letter-spacing:3px;text-transform:uppercase;color:#FFC400;">Email confirmation</div>
  </td></tr>
  <tr><td class="em-ylb" bgcolor="#FFC400" height="4" style="background:#FFC400;height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>
  <tr><td class="em-bgw" bgcolor="#FFFFFF" style="padding:30px 28px 6px;text-align:left;">
    <div class="em-tink" style="font-size:22px;line-height:28px;font-weight:bold;color:#0A0A0A;">Confirm your email</div>
    <div class="em-tgrey" style="font-size:15px;line-height:22px;color:#5A5A5A;margin-top:8px;">Click the button below to confirm this address for monthly reports from ${esc(name)}.</div>
  </td></tr>
  <tr><td class="em-bgw" bgcolor="#FFFFFF" align="center" style="padding:20px 28px 8px;">${btn('Confirm email address')}</td></tr>
  <tr><td class="em-bgw" bgcolor="#FFFFFF" dir="rtl" style="padding:18px 28px 6px;text-align:right;">
    <div class="em-tink" style="font-size:22px;line-height:28px;font-weight:bold;color:#0A0A0A;">أكّد بريدك</div>
    <div class="em-tgrey" style="font-size:15px;line-height:22px;color:#5A5A5A;margin-top:8px;">انقر زر التأكيد أدناه لتأكيد هذا العنوان لاستلام التقارير الشهرية من ${esc(name)}.</div>
  </td></tr>
  <tr><td class="em-bgw" bgcolor="#FFFFFF" align="center" dir="rtl" style="padding:20px 28px 8px;">${btn('تأكيد البريد الإلكتروني')}</td></tr>
  <tr><td class="em-bgw em-tmut" bgcolor="#FFFFFF" align="center" style="padding:14px 28px 28px;font-size:12px;color:#8A8A8A;">This link expires in 48 hours. / تنتهي صلاحية الرابط خلال 48 ساعة.</td></tr>
  <tr><td class="em-dark-keep" bgcolor="#0A0A0A" align="center" style="background:#0A0A0A;border-radius:0 0 20px 20px;padding:22px 24px;font-size:12px;line-height:19px;color:#BDBDBD;">
    Monthly reports from ${esc(name)} will reach this address once confirmed.
  </td></tr>
</table></td></tr></table></body></html>`,
    text: `Confirm your report email: ${safe}\n(This link expires in 48 hours.)\n\nتأكيد بريد التقارير: ${safe}\n(تنتهي صلاحية الرابط خلال 48 ساعة.)`,
  };
}
