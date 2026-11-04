// Phone digit normalization: Arabic-locale mobile keyboards emit Eastern
// Arabic-Indic (٠-٩) or Persian (۰-۹) numerals. Without normalization the
// input filter strips them and the field looks dead ("can't type on phones").
// Run: npm run test:digits
import { toWesternDigits, cleanPhoneInput, phoneDigitsOnly } from '../src/utils/digits';
import { validateOrderInput } from '../functions/_shared/orders.js';

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.error(`FAIL: ${name}`);
  }
};

ok('arabic-indic block', toWesternDigits('٠١٢٣٤٥٦٧٨٩') === '0123456789');
ok('persian block', toWesternDigits('۰۱۲۳۴۵۶۷۸۹') === '0123456789');
ok('mixed keeps western + symbols', toWesternDigits('+٩٦١ ٧٠-١٢٣') === '+961 70-123');
ok('empty safe', toWesternDigits('') === '' && toWesternDigits(null as unknown as string) === '');
ok('cleanPhoneInput', cleanPhoneInput('٧٠ ١٢٣-٤٥٦') === '70 123-456');
ok('phoneDigitsOnly strips spaces', phoneDigitsOnly('٧٠ ١٢٣ ٤٥٦') === '70123456');

// Backend: an Arabic-digit phone must NOT fail as invalid_phone.
const menu = {
  settings: {},
  items: [{ id: 'zaatar', name: { en: 'Zaatar', ar: 'زعتر' }, pricing: { unit: 'pc', price: 100, minQty: 1, step: 1, maxQty: 50, showUnit: false } }],
};
const body = {
  type: 'delivery',
  customer: { name: 'Ali', phone: '٧٠١٢٣٤٥٦', address: 'Beirut' },
  items: [{ id: 'zaatar', qty: 1 }],
  // Delivery requires a freshly picked pin every order (never remembered).
  location: { lat: 33.8938, lng: 35.5018, accuracy: 30 },
};
const out = validateOrderInput(body, menu) as { ok: boolean; errors: string[] };
ok('backend accepts arabic-digit phone', out.ok && out.errors.length === 0);
const western = validateOrderInput(
  { ...body, customer: { ...body.customer, phone: '70123456' } },
  menu
) as { ok: boolean; errors: string[] };
ok('backend parity western digits', JSON.stringify(western.errors) === JSON.stringify(out.errors));

// Backend keeps a sane GPS accuracy on the cleaned location (transient,
// never stored) so downstream can distrust coarse cell-tower fixes.
const withAcc = validateOrderInput(
  { ...body, location: { lat: 33.9, lng: 35.5, accuracy: 25 } },
  menu
) as { ok: boolean; cleaned: { location: { accuracy?: number } | null } };
ok('backend keeps sane accuracy', withAcc.ok && withAcc.cleaned !== null && withAcc.cleaned.location !== null && (withAcc.cleaned.location as { accuracy?: number }).accuracy === 25);
const badAcc = validateOrderInput(
  { ...body, location: { lat: 33.9, lng: 35.5, accuracy: 'good' } },
  menu
) as { ok: boolean; cleaned: { location: { accuracy?: unknown } | null } };
ok('backend drops insane accuracy, keeps coords', badAcc.ok && badAcc.cleaned !== null && badAcc.cleaned.location !== null && !('accuracy' in (badAcc.cleaned.location as object)));
const negAcc = validateOrderInput(
  { ...body, location: { lat: 33.9, lng: 35.5, accuracy: -5 } },
  menu
) as { ok: boolean; cleaned: { location: { accuracy?: unknown } | null } };
ok('backend drops negative accuracy', negAcc.ok && negAcc.cleaned !== null && negAcc.cleaned.location !== null && !('accuracy' in (negAcc.cleaned.location as object)));

console.log(`digits: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
