// Customer order-event emails: pure function, npm-dependency-free (works in Workers and Node).
//
// buildOrderEmail({ event, order, storeName, currency, lang, trackUrl, timezone }) -> { subject, html, text }
// timezone defaults to Asia/Beirut (same convention as the admin preview).
//
// Brand shell mirrors functions/_shared/mail.js and functions/_shared/report-email.js:
// black logo band (.em-dark-keep), gold rule (.em-ylb), white card (.em-bgw),
// black footer (.em-dark-keep) and the em-* dark-mode roles for both
// [data-ogsc] (Gmail app) and prefers-color-scheme (Apple Mail and others).
// One language per message: 'ar' (dir=rtl) or 'en' (dir=ltr).
// No tracking pixels, no open-tracking, no external CSS/JS: image and button
// links derive from trackUrl's own origin only.

const BLACK = '#0A0A0A';
const YELLOW = '#FFC400';
const GREY = '#5A5A5A';
const LIGHT = '#F6F6F6';
const LINE = '#E8E8E8';
const GREEN = '#1E9E52';
const RED = '#D93636';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Day key (YYYY-MM-DD) of an instant in a zone — "اليوم / غداً" compares.
 *  Mirrors dayKeyInZone() in src/utils/etaFormat.ts (same rule, same zone). */
function dayKeyInZone(ms, timeZone) {
  if (typeof ms !== 'number' || Number.isNaN(ms)) return '';
  const tryZone = (tz) => {
    const opts = { year: 'numeric', month: '2-digit', day: '2-digit' };
    if (tz) opts.timeZone = tz;
    const parts = new Intl.DateTimeFormat('en-CA', opts).formatToParts(new Date(ms));
    let y = '';
    let m = '';
    let d = '';
    for (const p of parts) {
      if (p.type === 'year') y = p.value;
      else if (p.type === 'month') m = p.value;
      else if (p.type === 'day') d = p.value;
    }
    return y && m && d ? `${y}-${m}-${d}` : '';
  };
  try {
    const k = tryZone(timeZone);
    if (k) return k;
  } catch {}
  try {
    return tryZone(undefined);
  } catch {
    return '';
  }
}

/** ETA formatting in the store's timezone (UTC would show the wrong hour),
 *  day-aware so it points at the SAME calendar day as the track page range
 *  ("اليوم، 7:37 م" / "غداً، 7:37 م" / "6 نوفمبر، 7:37 م").
 *  The instant is the stamped eta_at itself — the track range is centered on
 *  this exact instant, so the two can never disagree. Anything unparseable
 *  passes through raw. */
function formatEta(etaAt, lang, tz, nowMs) {
  const raw = String(etaAt ?? '').trim();
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const timeZone = typeof tz === 'string' && tz ? tz : 'Asia/Beirut';
  const now = typeof nowMs === 'number' && !Number.isNaN(nowMs) ? nowMs : Date.now();
  const locale = lang === 'ar' ? 'ar-u-nu-latn' : 'en-US';
  try {
    const clock = d.toLocaleString(locale, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    });
    const etaDay = dayKeyInZone(d.getTime(), timeZone);
    const today = dayKeyInZone(now, timeZone);
    if (etaDay && today) {
      if (etaDay === today) return lang === 'ar' ? `اليوم، ${clock}` : `Today, ${clock}`;
      try {
        if (etaDay === dayKeyInZone(now + 24 * 60 * 60 * 1000, timeZone)) {
          return lang === 'ar' ? `غداً، ${clock}` : `Tomorrow, ${clock}`;
        }
      } catch {}
      try {
        const date = d.toLocaleString(locale, { day: 'numeric', month: 'short', timeZone });
        return lang === 'ar' ? `${date}، ${clock}` : `${date}, ${clock}`;
      } catch {}
    }
    return d.toLocaleString(locale, {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    });
  } catch {
    return raw;
  }
}

/** Simple total formatting: finite numbers get grouped digits, strings pass through. */
function formatTotal(total, currency, lang) {
  if (total === undefined || total === null || String(total).trim() === '') return '';
  const cur = String(currency ?? '').trim();
  let amount = String(total).trim();
  if (typeof total === 'number' && Number.isFinite(total)) {
    try {
      amount = total.toLocaleString(lang === 'ar' ? 'ar-u-nu-latn' : 'en-US', { maximumFractionDigits: 2 });
    } catch {
      amount = String(total);
    }
  }
  return cur ? `${amount} ${cur}` : amount;
}

/** Logo lives on the same origin as the tracking link (sender domain only, https). */
function logoFromTrackUrl(trackUrl) {
  try {
    const origin = new URL(String(trackUrl)).origin;
    if (origin.startsWith('https://')) return `${origin}/assets/email-logo.png`;
  } catch {}
  return '';
}

const STR = {
  ar: {
    meta: { number: 'رقم الطلب', total: 'الإجمالي', items: 'عدد الأصناف', eta: 'الوقت المتوقع' },
    footer: (store) => `هذه الرسالة من ${store}.`,
    cta: 'تتبع طلبك',
    placed: {
      label: 'تأكيد الطلب',
      title: 'تم استلام طلبك بنجاح',
      subject: (number, store) => `تم استلام طلبك رقم ${number} من ${store}`,
      body: (number, store) => `شكرًا لك! استلمنا طلبك رقم ${number} من ${store} وسنبدأ بتجهيزه قريبًا.`,
    },
    confirmed: {
      label: 'تحديث الطلب',
      title: 'طلبك قيد التحضير',
      subject: (number, store) => `طلبك رقم ${number} قيد التحضير في ${store}`,
      withEta: (number, eta) => `طلبك رقم ${number} قيد التحضير الآن. الوقت المتوقع: ${eta}.`,
      withoutEta: (number) => `طلبك رقم ${number} قيد التحضير الآن وسنعلمك عند جاهزيته.`,
    },
    completed: {
      label: 'تحديث الطلب',
      title: 'تم التوصيل بنجاح',
      subject: (number, store) => `تم توصيل طلبك رقم ${number} من ${store}`,
      body: (number, store) => `تم توصيل طلبك رقم ${number} بنجاح. شكرًا لاختيارك ${store}.`,
    },
    cancelled: {
      label: 'تحديث الطلب',
      title: 'تم إلغاء الطلب',
      subject: (number, store) => `تم إلغاء الطلب رقم ${number} في ${store}`,
      body: (number) => `تم إلغاء طلبك رقم ${number}. نتطلع لخدمتك قريبًا.`,
    },
    receipt_check: {
      label: 'تحديث الطلب',
      title: 'هل استلمت طلبك؟',
      subject: (number, store) => `هل استلمت طلبك رقم ${number} من ${store}؟`,
      body: (number, store) => `انتهت مدة التوصيل المتوقعة لطلبك رقم ${number}. إذا استلمته، يرجى تأكيد الاستلام من صفحة التتبع.`,
    },
  },
  en: {
    meta: { number: 'Order number', total: 'Total', items: 'Items', eta: 'Estimated time' },
    footer: (store) => `This message is from ${store}.`,
    cta: 'Track your order',
    placed: {
      label: 'Order confirmation',
      title: 'Order received',
      subject: (number, store) => `Order #${number} received from ${store}`,
      body: (number, store) => `Thank you! We received your order #${number} from ${store} and will start preparing it shortly.`,
    },
    confirmed: {
      label: 'Order update',
      title: 'Your order is being prepared',
      subject: (number, store) => `Order #${number} is being prepared at ${store}`,
      withEta: (number, eta) => `Your order #${number} is being prepared now. Estimated delivery time: ${eta}.`,
      withoutEta: (number) => `Your order #${number} is being prepared now and we will let you know when it is ready.`,
    },
    completed: {
      label: 'Order update',
      title: 'Delivered, enjoy your meal',
      subject: (number, store) => `Order #${number} delivered from ${store}`,
      body: (number, store) => `Your order #${number} has been delivered. Thank you for choosing ${store}.`,
    },
    cancelled: {
      label: 'Order update',
      title: 'Order cancelled',
      subject: (number, store) => `Order #${number} from ${store} has been cancelled`,
      body: (number) => `Your order #${number} has been cancelled. We look forward to serving you soon.`,
    },
    receipt_check: {
      label: 'Order update',
      title: 'Did your order arrive?',
      subject: (number, store) => `Did order #${number} from ${store} arrive?`,
      body: (number, store) => `The estimated delivery time for your order #${number} has passed. If it arrived, please confirm receipt on the tracking page.`,
    },
  },
};

/**
 * Build a single-language customer email for an order event.
 * event: 'placed' | 'confirmed' | 'completed' | 'cancelled'
 * order: { number, total?, etaAt?, itemsCount? } (only number is required)
 * timezone: IANA zone for the ETA wall-clock (defaults to Asia/Beirut).
 */
export function buildOrderEmail({ event, order, storeName, currency, lang, trackUrl, timezone }) {
  const l = lang === 'ar' ? 'ar' : 'en';
  const t = STR[l];
  const isAr = l === 'ar';
  const dir = isAr ? 'rtl' : 'ltr';
  const align = isAr ? 'right' : 'left';
  const font = isAr ? "Tahoma, 'Segoe UI', Arial, sans-serif" : "'Helvetica Neue', Helvetica, Arial, sans-serif";
  if (!t[event]) throw new Error('unknown_event');

  const number = order && order.number !== undefined && order.number !== null ? String(order.number).trim() : '';
  if (!number) throw new Error('missing_order_number');
  const store = String(storeName ?? '').trim() || (isAr ? 'متجرنا' : 'our store');
  const track = typeof trackUrl === 'string' ? trackUrl.trim() : '';
  const logo = track ? logoFromTrackUrl(track) : '';
  const total = formatTotal(order ? order.total : undefined, currency, l);
  const eta = event === 'confirmed' && order && order.etaAt ? formatEta(order.etaAt, l, timezone) : '';
  const items =
    order && order.itemsCount !== undefined && order.itemsCount !== null && String(order.itemsCount).trim() !== ''
      ? String(order.itemsCount).trim()
      : '';

  const ev = t[event];
  const subject = ev.subject(number, store);
  const body = event === 'confirmed' ? (eta ? ev.withEta(number, eta) : ev.withoutEta(number)) : ev.body(number, store);
  const badgeClass = event === 'cancelled' ? 'em-red' : 'em-grn';
  const badgeColor = event === 'cancelled' ? RED : GREEN;

  const metaRows = [
    [t.meta.number, `#${number}`],
    ...(total ? [[t.meta.total, total]] : []),
    ...(items ? [[t.meta.items, items]] : []),
    ...(eta ? [[t.meta.eta, eta]] : []),
  ]
    .map(
      // dir on the two-column table (not only on <html>): Gmail/Apps strip
      // the root tags and lose <html dir>, which would flip label/value to
      // the wrong sides. An explicit dir here keeps them glued correctly.
      ([k, v]) => `<tr><td style="padding:7px 0;border-bottom:1px solid ${LINE};"><table role="presentation" dir="${dir}" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td class="em-tgrey" style="font-size:12px;color:${GREY};text-align:${align};" width="38%">${esc(k)}</td>
        <td class="em-tink" dir="ltr" style="font-size:14px;font-weight:bold;color:${BLACK};text-align:${isAr ? 'left' : 'right'};">${esc(v)}</td></tr></table></td></tr>`
    )
    .join('');

  const btn = track
    ? `<tr><td class="em-bgw" bgcolor="#FFFFFF" align="center" style="padding:26px 28px 8px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr><td class="em-ylb" bgcolor="${YELLOW}" style="background:${YELLOW};border-radius:999px;"><a href="${esc(track)}" class="em-tink" style="display:inline-block;padding:15px 34px;font-size:15px;font-weight:bold;color:${BLACK};text-decoration:none;font-family:${font};">${esc(t.cta)}</a></td></tr></table>
    </td></tr>`
    : '';

  const html = `<!doctype html>
<html lang="${l}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(subject)}</title>
<style>@media only screen and (max-width:480px){.px{padding-left:18px!important;padding-right:18px!important}}
@media (prefers-color-scheme: dark){.em-dark-keep{background-color:${BLACK}!important;}}
[data-ogsc] .em-dark-keep{background-color:${BLACK}!important;}
@media (prefers-color-scheme: dark){
.em-bgw{background-color:#FFFFFF!important;}.em-bgchip{background-color:#F6F6F6!important;}
.em-tink{color:#0A0A0A!important;}.em-tgrey{color:#5A5A5A!important;}.em-tmut{color:#8A8A8A!important;}.em-tfaint{color:#A0A0A0!important;}
.em-ylb{background-color:#FFC400!important;}.em-ylt{color:#FFC400!important;}.em-grn{color:#1E9E52!important;}.em-red{color:#D93636!important;}
.em-barbg{background-color:#EDEDED!important;}.em-bylbrd{border-color:#FFC400!important;}
}
[data-ogsc] .em-bgw{background-color:#FFFFFF!important;}[data-ogsc] .em-bgchip{background-color:#F6F6F6!important;}
[data-ogsc] .em-tink{color:#0A0A0A!important;}[data-ogsc] .em-tgrey{color:#5A5A5A!important;}[data-ogsc] .em-tmut{color:#8A8A8A!important;}[data-ogsc] .em-tfaint{color:#A0A0A0!important;}
[data-ogsc] .em-ylb{background-color:#FFC400!important;}[data-ogsc] .em-ylt{color:#FFC400!important;}[data-ogsc] .em-grn{color:#1E9E52!important;}[data-ogsc] .em-red{color:#D93636!important;}
[data-ogsc] .em-barbg{background-color:#EDEDED!important;}[data-ogsc] .em-bylbrd{border-color:#FFC400!important;}</style></head>
<body style="margin:0;padding:0;background:#EDEDED;font-family:${font};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(subject)}</div>
<table role="presentation" dir="${dir}" width="100%" cellpadding="0" cellspacing="0" bgcolor="#EDEDED"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" dir="${dir}" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;">
  <tr><td class="em-dark-keep" bgcolor="${BLACK}" align="center" style="background:${BLACK};border-radius:20px 20px 0 0;padding:30px 24px 24px;">
    ${logo ? `<img src="${esc(logo)}" width="180" alt="${esc(store)}" style="display:block;margin:0 auto;border:0;max-width:180px;height:auto;font-family:${font};font-size:18px;font-weight:bold;color:${YELLOW};">` : `<div class="em-ylt" style="font-size:20px;font-weight:bold;color:${YELLOW};">${esc(store)}</div>`}
    <div class="em-ylt" style="margin-top:16px;font-size:12px;font-weight:bold;letter-spacing:${isAr ? '0' : '3px'};text-transform:${isAr ? 'none' : 'uppercase'};color:${YELLOW};">${esc(ev.label)}</div>
  </td></tr>
  <tr><td class="em-ylb" bgcolor="${YELLOW}" height="4" style="background:${YELLOW};height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>
  <tr><td class="em-bgw px" bgcolor="#FFFFFF" style="padding:30px 28px 6px;text-align:${align};">
    <div class="${badgeClass}" style="font-size:13px;font-weight:bold;color:${badgeColor};" dir="ltr">#${esc(number)}</div>
    <div class="em-tink" style="font-size:22px;line-height:28px;font-weight:bold;color:${BLACK};margin-top:6px;">${esc(ev.title)}</div>
    <div class="em-tgrey" style="font-size:15px;line-height:22px;color:${GREY};margin-top:8px;">${esc(body)}</div>
  </td></tr>
  <tr><td class="em-bgw px" bgcolor="#FFFFFF" style="padding:14px 28px 0;text-align:${align};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="em-bgchip" bgcolor="${LIGHT}" style="background:${LIGHT};border:1px solid ${LINE};border-radius:14px;padding:6px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${metaRows}</table>
    </td></tr></table>
  </td></tr>${btn}
  <tr><td class="em-dark-keep" bgcolor="${BLACK}" align="center" style="background:${BLACK};border-radius:0 0 20px 20px;padding:22px 24px;font-size:12px;line-height:19px;color:#BDBDBD;">
    ${esc(t.footer(store))}
  </td></tr>
</table></td></tr></table></body></html>`;

  const lines = [subject, '', body, '', `${t.meta.number}: #${number}`];
  if (total) lines.push(`${t.meta.total}: ${total}`);
  if (items) lines.push(`${t.meta.items}: ${items}`);
  if (eta) lines.push(`${t.meta.eta}: ${eta}`);
  if (track) lines.push('', `${t.cta}: ${track}`);
  lines.push('', t.footer(store));
  return { subject, html, text: lines.join('\n') };
}
