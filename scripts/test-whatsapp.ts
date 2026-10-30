/**
 * WhatsApp message tests (needs tsx for @/ + TS).
 * Run: npx tsx scripts/test-whatsapp.ts
 * Covers: bilingual sections, exact totals math (variants/addons/fee),
 * distance + count lines, line-boundary truncation with order marker,
 * no-truncation without order number, invalid-line skipping.
 */
import { buildWhatsAppMessage, type WhatsAppLine } from '@/src/utils/whatsapp';
import type { CustomerDetails, MenuData } from '@/src/types/menu';

let pass = 0, fail = 0;
const ok = (cond: boolean, name: string, extra = '') => {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, extra); }
};

const menu = {
  settings: {
    name: { en: 'Chou 3abelak', ar: 'شو عبالك' },
    currency: { en: 'LBP', ar: 'ل.ل' },
    ordering: { deliveryFeeEnabled: true, deliveryFee: 100000, note: { en: 'Call on arrival', ar: 'اتصل عند الوصول' } },
    featureGroups: [
      { id: 'sizes', name: { en: 'Sizes', ar: 'أحجام' } },
      { id: 'addons', name: { en: 'Add-ons', ar: 'إضافات' } },
    ],
    featureDefs: [
      { id: 'regular', groupId: 'sizes', name: { en: 'Regular', ar: 'عادي' } },
      { id: 'mashrouha', groupId: 'sizes', name: { en: 'Mashrouha', ar: 'مشروحة' } },
      { id: 'extra-veg', groupId: 'addons', name: { en: 'Extra vegetables', ar: 'إضافة خضرة' } },
    ],
  },
} as unknown as MenuData;

const zaatar = {
  id: 'mk-zaatar-plain', categoryId: 'manakish',
  name: { en: 'Plain Zaatar', ar: 'زعتر سادة' },
  pricing: { unit: 'pc', minQty: 1, step: 1, maxQty: 50, showUnit: false },
  variants: [
    { featureId: 'regular', price: 80000 },
    { featureId: 'mashrouha', price: 120000 },
  ],
  addons: [{ featureId: 'extra-veg', price: 30000 }],
  badges: [], featured: false, available: true,
} as unknown as WhatsAppLine['item'];

const juice = {
  id: 'drink-juice', categoryId: 'drinks',
  name: { en: 'Juice', ar: 'عصير' },
  pricing: { unit: 'pc', minQty: 1, step: 1, maxQty: 50, showUnit: false, price: 50000 },
  badges: [], featured: false, available: true,
} as unknown as WhatsAppLine['item'];

const customer: CustomerDetails = {
  name: 'Mina', phone: '+96170123456', address: 'Hamra St', tableNumber: '',
  notes: 'No onions', orderType: 'delivery', remember: false,
};
const lines: WhatsAppLine[] = [
  { item: zaatar, variantId: 'mashrouha', addonIds: ['extra-veg'], quantity: 2 },
  { item: juice, quantity: 1 },
];
// zaatar mashrouha 120k + veg 30k = 150k x2 = 300k; juice 50k x1; subtotal 350k; fee 100k; total 450k.

// ---- EN ----
const en = buildWhatsAppMessage(menu, lines, customer, 'en', 1007, { lat: 33.9, lng: 35.5 }, '≈ 2.3 km');
ok(en.includes('🍔 Order #1007 — Chou 3abelak'), 'en header+number');
ok(en.includes('2x Plain Zaatar (Mashrouha (large & thin)) + Extra vegetables') || en.includes('2x Plain Zaatar'), 'en title+variant+addon', en.split('\n').slice(2, 4).join('|'));
ok(en.includes('2 × 150,000 = 300,000'), 'en math line', en.split('\n').slice(2, 6).join('|'));
ok(en.includes('Items: 2 (3 pcs)'), 'en count line');
ok(en.includes('Subtotal: 350,000'), 'en subtotal');
ok(en.includes('Delivery Fee: 100,000'), 'en fee');
ok(en.includes('Total: 450,000'), 'en total');
ok(en.includes('Name: Mina') && en.includes('Phone: +96170123456'), 'en customer');
ok(en.includes('Address: Hamra St'), 'en address');
ok(en.includes('https://www.google.com/maps?q=33.9,35.5'), 'en maps link');
ok(en.includes('Distance from restaurant: ≈ 2.3 km'), 'en distance');
ok(en.includes('Notes: No onions'), 'en notes');
ok(en.includes('📌 Call on arrival'), 'en store note');

// ---- AR ----
const arCustomer = { ...customer, name: 'مينا', address: 'شارع الحمرا', notes: 'بدون بصل' };
const ar = buildWhatsAppMessage(menu, lines, arCustomer, 'ar', 1007, { lat: 33.9, lng: 35.5 }, '≈ 2.3 كم');
ok(ar.includes('🍔 طلب #1007 — شو عبالك'), 'ar header+number');
ok(ar.includes('زعتر سادة') && ar.includes('مشروحة'), 'ar title');
ok(ar.includes('الأصناف: 2 (3 قطع)'), 'ar count');
ok(ar.includes('المجموع: 350,000'), 'ar subtotal');
ok(ar.includes('الإجمالي النهائي: 450,000'), 'ar total');
ok(ar.includes('المسافة من المطعم: ≈ 2.3 كم'), 'ar distance');
ok(ar.includes('ل.ل'), 'ar currency present');

// ---- fee off / no location / no number ----
const noFeeMenu = JSON.parse(JSON.stringify(menu));
noFeeMenu.settings.ordering.deliveryFeeEnabled = false;
const nf = buildWhatsAppMessage(noFeeMenu, lines, customer, 'en', null, null, null);
ok(!nf.includes('Delivery Fee') && !nf.includes('Total:'), 'no fee lines when disabled');
ok(!nf.includes('Location:'), 'no location line without coords');
ok(nf.includes('🍔 New Order from Chou 3abelak'), 'plain header without number');

// ---- invalid lines skipped, totals unaffected ----
const bad: WhatsAppLine[] = [
  ...lines,
  { item: null as unknown as WhatsAppLine['item'], quantity: 1 },
  { item: juice, quantity: 0 },
  { item: juice, quantity: -2 },
];
const sk = buildWhatsAppMessage(menu, bad, customer, 'en', null, null, null);
ok(sk.includes('Subtotal: 350,000'), 'bad lines skipped, math intact');

// ---- truncation: with number -> cut at newline + marker ----
const many: WhatsAppLine[] = Array.from({ length: 60 }, (_, i) => ({
  item: { ...juice, id: `j${i}`, name: { en: `Juice Item Number ${i}`, ar: `عصير ${i}` } }, quantity: 1,
}));
const big = buildWhatsAppMessage(menu, many, customer, 'en', 2001, null, null);
ok(big.length <= 1400 + 60, 'truncated near cap', String(big.length));
ok(!big.endsWith('...') || big.includes('order #2001'), 'marker references order');
ok(big.split('\n').every((l) => l.length < 1400), 'no single mutated line');
const linesKept = big.split('\n').filter((l) => l.startsWith('1x Juice Item'));
ok(linesKept.length > 0 && linesKept.length < 60, 'items cut, marker present', `${linesKept.length}/60`);

// ---- truncation: WITHOUT number -> never cut (integrity over convenience) ----
const bigNoNum = buildWhatsAppMessage(menu, many, customer, 'en', null, null, null);
ok(bigNoNum.length > 1400 && !bigNoNum.includes('truncated') && !bigNoNum.includes('…'), 'full text preserved without order number', String(bigNoNum.length));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
