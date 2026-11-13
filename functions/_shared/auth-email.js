/**
 * Transactional auth emails (Resend) — password reset + email verification.
 *
 * The email is bilingual (English first, Arabic second) so one template works
 * for both storefront languages without storing a per-user language.
 * Sending is queued through the Pages `waitUntil` so auth responses are never
 * delayed and a mail failure never changes the auth result.
 */

const RESEND_URL = 'https://api.resend.com/emails';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.toString();
  } catch {
    return '';
  }
}

/**
 * @param {{ kind: 'reset'|'verify', url: string, name?: string }} input
 * @returns {{ subject: string, html: string, text: string, url: string }}
 */
export function buildAuthEmail({ kind, url, name }) {
  const link = safeUrl(url);
  const safeName = escapeHtml(name || '');
  const isReset = kind === 'reset';
  const subject = isReset
    ? 'Reset your password — Chou 3abelak | إعادة تعيين كلمة المرور'
    : 'Verify your email — Chou 3abelak | تأكيد بريدك الإلكتروني';
  const titleEn = isReset ? 'Reset your password' : 'Verify your email';
  const titleAr = isReset ? 'إعادة تعيين كلمة المرور' : 'تأكيد البريد الإلكتروني';
  const introEn = isReset
    ? 'We received a request to reset the password for your Chou 3abelak account. This link is valid for one hour.'
    : 'Thanks for creating a Chou 3abelak account. Confirm your email to finish setting it up. This link is valid for one hour.';
  const introAr = isReset
    ? 'وصلنا طلب لإعادة تعيين كلمة المرور لحسابك في شو عبالك. الرابط صالح لمدة ساعة واحدة.'
    : 'شكرًا لإنشاء حساب في شو عبالك. أكّد بريدك الإلكتروني لإكمال الحساب. الرابط صالح لمدة ساعة واحدة.';
  const ctaEn = isReset ? 'Reset password' : 'Verify email';
  const ctaAr = isReset ? 'إعادة تعيين كلمة المرور' : 'تأكيد البريد';
  const ignoreEn = isReset
    ? 'If you did not request this, you can safely ignore this email — your password will not change.'
    : 'If you did not create this account, you can safely ignore this email.';
  const ignoreAr = isReset
    ? 'إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة بأمان — لن تتغير كلمة المرور.'
    : 'إذا لم تنشئ هذا الحساب، يمكنك تجاهل هذه الرسالة بأمان.';

  const greeting = safeName
    ? `<p style="margin:0 0 12px;color:#3f3a2f;font-size:14px">Hi ${safeName},</p>`
    : '';
  const greetingAr = safeName
    ? `<p style="margin:0 0 12px;color:#3f3a2f;font-size:14px;direction:rtl">مرحبًا ${safeName}،</p>`
    : '';

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4efe4;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4efe4;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5ddcc">
        <tr><td style="background:#0a0a0a;padding:20px 24px;border-bottom:4px solid #ffc400">
          <span style="color:#ffc400;font-size:18px;font-weight:800;letter-spacing:.3px">Chou 3abelak</span>
          <span style="color:#a3a3a3;font-size:12px;display:block;margin-top:4px">شو عبالك</span>
        </td></tr>
        <tr><td style="padding:26px 24px 8px">
          <h1 style="margin:0 0 12px;color:#0a0a0a;font-size:22px;line-height:1.3">${escapeHtml(titleEn)}</h1>
          ${greeting}
          <p style="margin:0 0 18px;color:#4a4438;font-size:14px;line-height:1.65">${escapeHtml(introEn)}</p>
          <p style="margin:0 0 22px">
            <a href="${escapeHtml(link)}" style="display:inline-block;background:#ffc400;color:#0a0a0a;text-decoration:none;font-weight:800;font-size:14px;padding:12px 20px;border-radius:999px">${escapeHtml(ctaEn)}</a>
          </p>
          <p style="margin:0 0 8px;color:#7a7262;font-size:12px;line-height:1.6">${escapeHtml(ignoreEn)}</p>
          <p style="margin:0 0 4px;color:#7a7262;font-size:11px;line-height:1.6">Or copy this link:</p>
          <p style="margin:0 0 20px;word-break:break-all;font-size:11px;line-height:1.5"><a href="${escapeHtml(link)}" style="color:#8a6d00">${escapeHtml(link)}</a></p>
        </td></tr>
        <tr><td style="padding:0 24px 24px;direction:rtl;text-align:right;border-top:1px solid #eee6d6">
          <h2 style="margin:18px 0 10px;color:#0a0a0a;font-size:18px">${escapeHtml(titleAr)}</h2>
          ${greetingAr}
          <p style="margin:0 0 10px;color:#4a4438;font-size:14px;line-height:1.8">${escapeHtml(introAr)}</p>
          <p style="margin:0 0 10px;color:#7a7262;font-size:12px;line-height:1.8">${escapeHtml(ignoreAr)}</p>
          <p style="margin:0;color:#7a7262;font-size:11px">${escapeHtml(ctaAr)}: <a href="${escapeHtml(link)}" style="color:#8a6d00">${escapeHtml(link)}</a></p>
        </td></tr>
        <tr><td style="background:#faf7f0;padding:14px 24px;color:#8a8272;font-size:10px;line-height:1.6">
          Chou 3abelak · This is an automated message. / هذه رسالة آلية.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    titleEn,
    '',
    introEn,
    '',
    link,
    '',
    '---',
    '',
    titleAr,
    '',
    introAr,
    '',
    link,
    '',
    ignoreEn,
    ignoreAr,
  ].join('\n');

  return { subject, html, text, url: link };
}

/**
 * Send one email via Resend. Never throws.
 * @returns {Promise<{ ok: boolean, status?: number, reason?: string }>}
 */
export async function sendAuthEmail(env, { to, subject, html, text }, fetchImpl = fetch) {
  const key = typeof env?.RESEND_API_KEY === 'string' ? env.RESEND_API_KEY.trim() : '';
  const from = typeof env?.MAIL_FROM_DOMAIN_EMAIL === 'string' ? env.MAIL_FROM_DOMAIN_EMAIL.trim() : '';
  if (!key || !from || typeof to !== 'string' || !to) {
    return { ok: false, reason: 'not_configured' };
  }
  if (typeof subject !== 'string' || typeof html !== 'string' || typeof text !== 'string') {
    return { ok: false, reason: 'bad_message' };
  }
  try {
    const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(10000)
      : undefined;
    const replyTo = typeof env?.REPLY_TO === 'string' && env.REPLY_TO.trim() ? env.REPLY_TO.trim() : undefined;
    const res = await fetchImpl(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Chou 3abelak <${from}>`,
        to: [to],
        subject,
        html,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
      ...(signal ? { signal } : {}),
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

/** Fire-and-forget queue; auth responses are never blocked by mail latency. */
export function queueAuthEmail(env, message, waitUntil, fetchImpl = fetch) {
  const task = sendAuthEmail(env, message, fetchImpl)
    .then((result) => {
      if (!result.ok) {
        // Reason/status only — never log the recipient or the token URL.
        console.warn('[auth-email]', JSON.stringify({ ok: false, reason: result.reason || null, status: result.status || null }));
      }
      return result;
    })
    .catch(() => ({ ok: false, reason: 'unexpected' }));
  if (typeof waitUntil === 'function') waitUntil(task);
  else void task;
}
