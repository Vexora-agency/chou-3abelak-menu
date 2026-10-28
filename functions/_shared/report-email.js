// Monthly report email: pure function, npm-dependency-free (works in Workers and Node).
// renderMonthlyReportEmail(data, 'en' | 'ar') -> { subject, html, text }
import { prevMonth } from './reports.js';

const BLACK = '#0A0A0A', YELLOW = '#FFC400', GREY = '#5A5A5A', LIGHT = '#F6F6F6', LINE = '#E8E8E8', GREEN = '#1E9E52', RED = '#D93636';

const STR = {
  en: {
    label: 'Monthly report',
    greeting: (name) => `Here is how ${name} did last month.`,
    orders: 'Orders', revenue: 'Revenue', avg: 'Avg. order', vs: (m) => `vs ${m}`,
    highlights: 'Highlights', busiestDay: 'Busiest day', peakHour: 'Peak hour', bestSeller: 'Best seller',
    top: 'Top items', sold: 'sold', types: 'Order type', delivery: 'Delivery', pickup: 'Pickup', dinein: 'Dine-in',
    status: 'Completed', cancelled: 'Cancelled', ordersWord: 'orders',
    cta: 'Open dashboard', csvNote: 'The full list of orders is attached as a CSV file.', csvLink: 'Download the CSV from Dashboard → Reports.',
    retention: (d) => `For privacy, customer details are removed after ${d} days. This report never includes names, phones or addresses.`,
    footer: (name) => `You receive this email because monthly reports are enabled for ${name}.`,
    manage: 'Change the email or turn reports off', noOrders: 'No orders were placed this month.',
    subject: (m, name, n, rev, cur) => `${m} report for ${name}: ${n} orders, ${rev} ${cur}`,
    pre: (delta, best) => `${delta ? delta + ' revenue. ' : ''}${best ? 'Best seller: ' + best + '.' : ''}`.trim(),
  },
  ar: {
    label: 'التقرير الشهري',
    greeting: (name) => `هذا ملخص أداء ${name} خلال الشهر الماضي.`,
    orders: 'الطلبات', revenue: 'الإيرادات', avg: 'متوسط الطلب', vs: (m) => `مقارنة بـ ${m}`,
    highlights: 'أبرز الأرقام', busiestDay: 'أكثر الأيام ازدحاماً', peakHour: 'ساعة الذروة', bestSeller: 'الأكثر مبيعاً',
    top: 'الأكثر طلباً', sold: 'مباع', types: 'نوع الطلب', delivery: 'توصيل', pickup: 'استلام', dinein: 'في المطعم',
    status: 'مكتمل', cancelled: 'ملغي', ordersWord: 'طلب',
    cta: 'افتح لوحة التحكم', csvNote: 'قائمة الطلبات الكاملة مرفقة بملف CSV.', csvLink: 'يمكنك تنزيل الملف من لوحة التحكم ثم التقارير.',
    retention: (d) => `حفاظاً على الخصوصية، تُحذف بيانات العملاء بعد ${d} يوماً. ولا يحتوي هذا التقرير على أسماء أو هواتف أو عناوين.`,
    footer: (name) => `تصلك هذه الرسالة لأن التقارير الشهرية مفعّلة لـ ${name}.`,
    manage: 'تغيير البريد أو إيقاف التقارير', noOrders: 'لم تُسجَّل أي طلبات هذا الشهر.',
    subject: (m, name, n, rev, cur) => `تقرير ${m} لـ ${name}: ${n} طلب، ${rev} ${cur}`,
    pre: (delta, best) => `${delta ? delta + ' في الإيرادات. ' : ''}${best ? 'الأكثر مبيعاً: ' + best + '.' : ''}`.trim(),
  },
};

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n) => Math.round(n).toLocaleString('en-US');
const money = (n) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M` : num(n));
const locale = (l) => (l === 'ar' ? 'ar-u-nu-latn' : 'en-US');
const monthLabel = (ym, l) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(locale(l), { month: 'long', year: 'numeric', timeZone: 'UTC' }); };
const monthOnly = (ym, l) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(locale(l), { month: 'long', timeZone: 'UTC' }); };
const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);

function delta(cur, prev, l, prevName) {
  const p = pct(cur, prev);
  if (p === null) return '';
  const up = p >= 0;
  return `<div class="${up ? 'em-grn' : 'em-red'}" style="font-size:12px;font-weight:bold;color:${up ? GREEN : RED};margin-top:6px;" dir="ltr">${up ? '&#9650;' : '&#9660;'} ${up ? '+' : ''}${p}%</div><div class="em-tmut" style="font-size:11px;color:#8A8A8A;margin-top:2px;">${esc(STR[l].vs(prevName))}</div>`;
}

function bar(pctVal) {
  const w = Math.max(3, Math.min(100, Math.round(pctVal)));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;"><tr><td class="em-ylb" width="${w}%" height="6" bgcolor="${YELLOW}" style="height:6px;font-size:0;line-height:0;border-radius:3px;">&nbsp;</td><td class="em-barbg" height="6" bgcolor="#EDEDED" style="height:6px;font-size:0;line-height:0;">&nbsp;</td></tr></table>`;
}

export function renderMonthlyReportEmail(d, lang = 'en') {
  const l = lang === 'ar' ? 'ar' : 'en';
  const t = STR[l];
  const isAr = l === 'ar';
  const align = isAr ? 'right' : 'left';
  const opp = isAr ? 'left' : 'right';
  const font = isAr ? "Tahoma, 'Segoe UI', Arial, sans-serif" : "'Helvetica Neue', Helvetica, Arial, sans-serif";
  const name = d.restaurantName[l] || d.restaurantName.en;
  const cur = d.currency[l] || d.currency.en;
  const mLabel = monthLabel(d.month, l);
  const pName = monthOnly(prevMonth(d.month), l);
  const T = d.totals, P = d.prev;
  const best = d.topItems && d.topItems[0] ? d.topItems[0].name[l] || d.topItems[0].name.en : '';
  const revDelta = P ? pct(T.revenue, P.revenue) : null;
  const subject = t.subject(mLabel, name, num(T.orders), money(T.revenue), cur);
  const pre = t.pre(revDelta === null ? '' : `${revDelta >= 0 ? '+' : ''}${revDelta}%`, best);

  const kpi = (label, value, unit, dl) => `
    <td class="kpi" width="33%" valign="top" style="padding:0 4px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="em-bgchip" bgcolor="${LIGHT}" style="background:${LIGHT};border:1px solid ${LINE};border-radius:14px;padding:16px 12px;text-align:center;">
        <div class="em-tgrey" style="font-size:11px;font-weight:bold;letter-spacing:${isAr ? '0' : '1px'};text-transform:${isAr ? 'none' : 'uppercase'};color:${GREY};">${esc(label)}</div>
        <div class="em-tink" style="font-size:26px;line-height:32px;font-weight:bold;color:${BLACK};margin-top:6px;" dir="ltr">${esc(value)}</div>
        <div class="em-tmut" style="font-size:11px;color:#8A8A8A;">${esc(unit || '\u00a0')}</div>${dl}
      </td></tr></table>
    </td>`;

  const maxQty = Math.max(1, ...(d.topItems || []).map((i) => i.qty));
  const topRows = (d.topItems || []).slice(0, 5).map((it, i) => `
    <tr><td style="padding:9px 0 3px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td class="em-tink" style="font-size:14px;color:${BLACK};font-weight:bold;text-align:${align};"><span class="em-tfaint" style="color:#A0A0A0;font-weight:normal;">${i + 1}</span>&nbsp;&nbsp;${esc(it.name[l] || it.name.en)}</td>
        <td class="em-tgrey" width="90" style="font-size:12px;color:${GREY};text-align:${opp};white-space:nowrap;"><b class="em-tink" style="color:${BLACK};">${num(it.qty)}</b> ${esc(t.sold)}</td>
      </tr></table>${bar((it.qty / maxQty) * 100)}
    </td></tr>`).join('');

  const KNOWN_TYPES = ['delivery', 'pickup', 'dinein'];
  // Only the order types this restaurant actually offers (delivery-only
  // clients see a single row, never phantom pickup/dine-in lines).
  const enabledTypes = Array.isArray(d.orderTypes) && d.orderTypes.length
    ? KNOWN_TYPES.filter((k) => d.orderTypes.includes(k))
    : [...KNOWN_TYPES];
  const typeCount = (k) => (((d.types || {})[k]) || 0);
  const typeTotal = Math.max(1, enabledTypes.reduce((a, k) => a + typeCount(k), 0));
  const TYPE_COLORS = { delivery: YELLOW, pickup: BLACK, dinein: '#9A9A9A' };
  const typeRows = enabledTypes.map((k) => {
    const color = TYPE_COLORS[k];
    const p = Math.round((typeCount(k) / typeTotal) * 100);
    return `<tr><td style="padding:7px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td class="em-tink" style="font-size:13px;color:${BLACK};text-align:${align};"><span style="display:inline-block;width:10px;height:10px;border-radius:5px;background:${color};">&nbsp;</span>&nbsp;&nbsp;${esc(t[k])}</td>
      <td class="em-tgrey" width="110" style="font-size:12px;color:${GREY};text-align:${opp};white-space:nowrap;" dir="ltr"><b class="em-tink" style="color:${BLACK};">${num(typeCount(k))}</b> &middot; ${p}%</td></tr></table></td></tr>`;
  }).join('');

  const hl = [];
  if (d.busiestDay) hl.push([t.busiestDay, new Date(d.busiestDay.date + 'T12:00:00Z').toLocaleDateString(locale(l), { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }), `${num(d.busiestDay.orders)} ${t.ordersWord}`]);
  if (d.peakHour !== null && d.peakHour !== undefined) hl.push([t.peakHour, `${String(d.peakHour).padStart(2, '0')}:00 – ${String((d.peakHour + 1) % 24).padStart(2, '0')}:00`, '']);
  if (best) hl.push([t.bestSeller, best, d.topItems[0] ? `${num(d.topItems[0].qty)} ${t.sold}` : '']);
  const hlHtml = hl.map(([a, b, c]) => `<tr><td style="padding:10px 0;border-bottom:1px solid ${LINE};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td class="em-tgrey" style="font-size:12px;color:${GREY};text-align:${align};" width="38%">${esc(a)}</td>
      <td class="em-tink" style="font-size:14px;font-weight:bold;color:${BLACK};text-align:${align};">${esc(b)}${c ? `<span class="em-tgrey" style="font-weight:normal;color:${GREY};font-size:12px;"> &middot; ${esc(c)}</span>` : ''}</td></tr></table></td></tr>`).join('');

  const section = (title, inner) => `<tr><td class="em-bgw" bgcolor="#FFFFFF" style="padding:22px 28px 0;text-align:${align};">
      <div class="em-tink em-bylbrd" style="font-size:12px;font-weight:bold;letter-spacing:${isAr ? '0' : '1.5px'};text-transform:${isAr ? 'none' : 'uppercase'};color:${BLACK};border-${isAr ? 'right' : 'left'}:4px solid ${YELLOW};padding-${isAr ? 'right' : 'left'}:10px;margin-bottom:6px;">${esc(title)}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${inner}</table></td></tr>`;

  const typesSection = enabledTypes.length ? section(t.types, typeRows) : '';

  const empty = T.orders === 0;
  const html = `<!doctype html>
<html lang="${l}" dir="${isAr ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(subject)}</title>
<style>@media only screen and (max-width:480px){.kpi{display:block!important;width:100%!important;padding:0 0 8px!important}.px{padding-left:18px!important;padding-right:18px!important}}
/* Brand bands (logo header + footer) must stay black in dark mode: the logo
   artwork is white-on-transparent, so an inverted white band would erase it.
   The media query covers Apple Mail/Samsung/Outlook; the data-ogsc rule
   covers the Gmail app, which strips media queries but wraps content in a
   data-ogsc container when it inverts colors. */
@media (prefers-color-scheme: dark){.em-dark-keep{background-color:${BLACK}!important;}}
/* Gmail app dark mode (media queries stripped — the wrapper carries the signal instead). */
[data-ogsc] .em-dark-keep{background-color:${BLACK}!important;}
/* Force the light-mode design in dark mode (both contexts below): every role
   that must not invert gets its color back. Without this, dark clients
   invert white cards but leave dark text (or vice versa) and the mail turns
   unreadable. Brand bands stay black via .em-dark-keep above. */
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
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(pre)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#EDEDED"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;">
  <tr><td class="em-dark-keep" bgcolor="${BLACK}" align="center" style="background:${BLACK};border-radius:20px 20px 0 0;padding:30px 24px 24px;">
    <img src="${esc(d.logoUrl)}" width="180" alt="${esc(name)}" style="display:block;margin:0 auto;border:0;max-width:180px;height:auto;font-family:${font};font-size:18px;font-weight:bold;color:${YELLOW};">
    <div class="em-ylt" style="margin-top:16px;font-size:12px;font-weight:bold;letter-spacing:${isAr ? '0' : '3px'};text-transform:${isAr ? 'none' : 'uppercase'};color:${YELLOW};">${esc(t.label)}</div>
  </td></tr>
  <tr><td class="em-ylb" bgcolor="${YELLOW}" height="4" style="background:${YELLOW};height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>
  <tr><td class="em-bgw px" bgcolor="#FFFFFF" style="padding:30px 28px 6px;text-align:${align};">
    <div class="em-tink" style="font-size:30px;line-height:36px;font-weight:bold;color:${BLACK};">${esc(mLabel)}</div>
    <div class="em-tgrey" style="font-size:15px;line-height:22px;color:${GREY};margin-top:6px;">${esc(t.greeting(name))}</div>
  </td></tr>
  <tr><td class="em-bgw px" bgcolor="#FFFFFF" style="padding:18px 24px 4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    ${kpi(t.orders, num(T.orders), '', P ? delta(T.orders, P.orders, l, pName) : '')}
    ${kpi(t.revenue, money(T.revenue), cur, P ? delta(T.revenue, P.revenue, l, pName) : '')}
    ${kpi(t.avg, money(T.avg), cur, P ? delta(T.avg, P.avg, l, pName) : '')}
  </tr></table></td></tr>
  <tr><td class="em-bgw em-tgrey px" bgcolor="#FFFFFF" style="padding:10px 28px 0;text-align:${align};font-size:12px;color:${GREY};">${esc(t.status)}: <b class="em-grn" style="color:${GREEN};">${num(T.completed)}</b> &nbsp;&middot;&nbsp; ${esc(t.cancelled)}: <b class="${T.cancelled ? 'em-red' : 'em-tgrey'}" style="color:${T.cancelled ? RED : GREY};">${num(T.cancelled)}</b></td></tr>
  ${empty ? `<tr><td bgcolor="#FFFFFF" class="em-tgrey" style="padding:28px;text-align:center;font-size:14px;color:${GREY};">${esc(t.noOrders)}</td></tr>` : section(t.highlights, hlHtml) + section(t.top, topRows) + typesSection}
  <tr><td class="em-bgw" bgcolor="#FFFFFF" align="center" style="padding:30px 28px 8px;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr><td class="em-ylb" bgcolor="${YELLOW}" style="background:${YELLOW};border-radius:999px;"><a href="${esc(d.dashboardUrl)}" class="em-tink" style="display:inline-block;padding:15px 34px;font-size:15px;font-weight:bold;color:${BLACK};text-decoration:none;font-family:${font};">${esc(t.cta)}</a></td></tr></table>
  </td></tr>
  <tr><td class="em-bgw em-tgrey px" bgcolor="#FFFFFF" style="padding:14px 28px 28px;text-align:center;font-size:12px;line-height:19px;color:${GREY};">${esc(d.csvAttached ? t.csvNote : t.csvLink)}<br>${esc(t.retention(d.retention.piiDays))}</td></tr>
  <tr><td class="em-dark-keep" bgcolor="${BLACK}" align="center" style="background:${BLACK};border-radius:0 0 20px 20px;padding:22px 24px;font-size:12px;line-height:19px;color:#BDBDBD;">
    ${esc(t.footer(name))}<br><a href="${esc(d.manageUrl)}" class="em-ylt" style="color:${YELLOW};text-decoration:underline;">${esc(t.manage)}</a>
  </td></tr>
</table></td></tr></table></body></html>`;

  const lines = [`${t.label} - ${mLabel} - ${name}`, '', `${t.orders}: ${num(T.orders)}`, `${t.revenue}: ${num(T.revenue)} ${cur}`, `${t.avg}: ${num(T.avg)} ${cur}`, `${t.status}: ${num(T.completed)} | ${t.cancelled}: ${num(T.cancelled)}`, ''];
  (d.topItems || []).slice(0, 5).forEach((it, i) => lines.push(`${i + 1}. ${it.name[l] || it.name.en} - ${num(it.qty)} ${t.sold}`));
  lines.push('', `${t.cta}: ${d.dashboardUrl}`, '', t.retention(d.retention.piiDays), `${t.manage}: ${d.manageUrl}`);
  return { subject, html, text: lines.join('\n') };
}
