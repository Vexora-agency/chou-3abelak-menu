// Renders sample EN and AR report emails to ./tmp-email/ for visual checks:  node scripts/preview-report-email.mjs [logoUrl]
import { mkdirSync, writeFileSync } from 'node:fs';
import { renderMonthlyReportEmail } from '../functions/_shared/report-email.js';
const logoUrl = process.argv[2] || 'https://example.com/assets/email-logo.png';
const data = {
  restaurantName: { en: 'Chou 3abelak', ar: 'شو عبالك' }, month: '2026-09', currency: { en: 'LBP', ar: 'ل.ل' },
  logoUrl, dashboardUrl: 'https://example.com/#admin', settingsUrl: 'https://example.com/#admin', csvAttached: true, retention: { piiDays: 90 },
  totals: { orders: 412, revenue: 68040000, avg: 165146, completed: 380, cancelled: 32 },
  prev: { orders: 368, revenue: 60120000, avg: 163370 },
  busiestDay: { date: '2026-09-12', orders: 31 }, peakHour: 20,
  topItems: [
    { name: { en: 'Zaatar & Labneh (Mashrouha)', ar: 'زعتر ولبنة (مشروحة)' }, qty: 96 },
    { name: { en: 'Akkawi & Mozzarella Cheese', ar: 'جبنة عكاوي وموزاريلا' }, qty: 81 },
    { name: { en: 'Plain Zaatar', ar: 'زعتر سادة' }, qty: 74 },
    { name: { en: 'Veggie Pizza (Large)', ar: 'بيتزا خضرة (كبير)' }, qty: 52 },
    { name: { en: 'Pepsi', ar: 'بيبسي' }, qty: 47 },
  ],
  types: { delivery: 228, pickup: 131, dinein: 53 },
};
mkdirSync('tmp-email', { recursive: true });
for (const l of ['en', 'ar']) { const r = renderMonthlyReportEmail(data, l); writeFileSync(`tmp-email/report-${l}.html`, r.html); writeFileSync(`tmp-email/report-${l}.txt`, r.text); console.log(l, '|', r.subject); }
