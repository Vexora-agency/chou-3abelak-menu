// Renderer checks for the monthly report email: enabled-only order types
// and dark-mode force-light roles. Run: node scripts/test-report-email.mjs
import { renderMonthlyReportEmail } from '../functions/_shared/report-email.js';
import { confirmEmailContent } from '../functions/_shared/mail.js';

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL: ${name}`);
  }
}

const data = () => ({
  restaurantName: { en: 'Chou 3abelak', ar: 'شو عبالك' }, month: '2026-09', currency: { en: 'LBP', ar: 'ل.ل' },
  logoUrl: 'https://example.com/assets/email-logo.png', dashboardUrl: 'https://example.com/#admin',
  manageUrl: 'https://example.com/#admin/reports', csvAttached: false, retention: { piiDays: 30 },
  totals: { orders: 100, revenue: 4000000, avg: 40000, completed: 95, cancelled: 5 },
  prev: null, busiestDay: null, peakHour: null,
  topItems: [{ name: { en: 'Zaatar', ar: 'زعتر' }, qty: 10 }],
  types: { delivery: 100, pickup: 0, dinein: 0 },
});

/* ---------------- order-type filtering ---------------- */
{
  const all = renderMonthlyReportEmail(data(), 'en').html;
  ok(all.includes('Delivery') && all.includes('Pickup') && all.includes('Dine-in'), 'default shows all three types');
  const d = data();
  d.orderTypes = ['delivery'];
  const one = renderMonthlyReportEmail(d, 'en').html;
  ok(one.includes('Delivery'), 'delivery-only keeps Delivery');
  ok(!one.includes('Pickup') && !one.includes('Dine-in'), 'delivery-only hides phantom types');
  const ar = renderMonthlyReportEmail(d, 'ar').html;
  ok(ar.includes('توصيل') && !ar.includes('استلام'), 'arabic respects the filter');
  const d2 = data();
  d2.orderTypes = [];
  ok(renderMonthlyReportEmail(d2, 'en').html.includes('Pickup'), 'empty list falls back to all');
}

/* ---------------- dark-mode force-light roles ---------------- */
{
  const html = renderMonthlyReportEmail(data(), 'en').html;
  for (const cls of ['em-dark-keep', 'em-bgw', 'em-bgchip', 'em-tink', 'em-tgrey', 'em-tmut', 'em-tfaint', 'em-ylb', 'em-ylt', 'em-grn', 'em-red', 'em-barbg', 'em-bylbrd']) {
    ok(html.includes(cls), `dark role present: ${cls}`);
  }
  ok(html.includes('[data-ogsc] .em-dark-keep'), 'gmail dark wrapper rule present');
  ok(html.includes('prefers-color-scheme'), 'media query present');
  ok(!/class="[^"]*"[^>]*class="/.test(html), 'no duplicate class attributes');
  ok(html.includes('https://example.com/#admin/reports'), 'manage link deep-links the reports view');
}

/* ---------------- confirmation email: same brand shell ---------------- */
{
  const c = confirmEmailContent('https://site.example/api/reports/confirm?token=abc', 'Chou 3abelak');
  ok(c.subject === 'Confirm your report email / أكّد بريد التقارير', 'confirm subject unchanged');
  ok(c.html.includes('https://site.example/assets/email-logo.png'), 'confirm logo derived from link origin');
  ok(c.html.includes('Confirm email address') && c.html.includes('تأكيد البريد الإلكتروني'), 'confirm CTAs bilingual');
  ok(c.html.includes('em-dark-keep') && c.html.includes('[data-ogsc]'), 'confirm dark roles present');
  ok(!/class="[^"]*"[^>]*class="/.test(c.html), 'confirm: no duplicate class attributes');
  ok(!c.html.includes('className='), 'confirm: no react-isms in raw html');
  const noLogo = confirmEmailContent('not-a-url', 'X');
  ok(!noLogo.html.includes('<img'), 'confirm omits logo when origin unknown');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
