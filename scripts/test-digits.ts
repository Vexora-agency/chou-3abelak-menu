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
const body = {
  type: 'delivery',
  customer: { name: 'Ali', phone: '٧٠١٢٣٤٥٦', address: 'Beirut' },
  items: [],
};
const out = validateOrderInput(body, { settings: {}, items: [] }) as { ok: boolean; errors: string[] };
ok('backend accepts arabic-digit phone', !out.ok && !out.errors.includes('invalid_phone') && out.errors.includes('invalid_items'));
const western = validateOrderInput(
  { ...body, customer: { ...body.customer, phone: '70123456' } },
  { settings: {}, items: [] }
) as { ok: boolean; errors: string[] };
ok('backend parity western digits', JSON.stringify(western.errors) === JSON.stringify(out.errors));

console.log(`digits: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
