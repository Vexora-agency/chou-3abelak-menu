import { canonicalLinkPhone, isSameCustomerPhone } from '../functions/_shared/orders.js';
import { linkedReceivableAtMs, receivableAtMs } from '../functions/_shared/eta.js';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log(`  ok ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

ok(canonicalLinkPhone('0100 123 4567') === '01001234567', 'strip spaces');
ok(canonicalLinkPhone('+201001234567') === '+201001234567'.replace(/[^0-9]/g, ''), 'plus stripped to digits');
ok(canonicalLinkPhone('00201001234567') === '201001234567', '00 prefix dropped');
ok(canonicalLinkPhone('') === '', 'garbage -> empty');
ok(isSameCustomerPhone('01001234567', '201001234567') === true, 'EG local vs intl suffix match');
ok(isSameCustomerPhone('03123456', '9613123456') === true, 'LB local vs intl suffix match');
ok(isSameCustomerPhone('01001234567', '01001234567') === true, 'exact match');
ok(isSameCustomerPhone('01001234567', '01987654321') === false, 'different numbers no link');
ok(isSameCustomerPhone('123', '123') === false, 'too short never links');
ok(isSameCustomerPhone('', '01001234567') === false, 'empty never links');

// Migration file exists + adds parent_number
const mig = readFileSync(new URL('../migrations/0023_linked_orders.sql', import.meta.url));
const txt = mig.toString();
ok(txt.includes('parent_number'), 'migration adds parent_number');
ok(txt.includes('idx_orders_phone_norm'), 'migration restores phone index');

// Joint delivery: child unlocks with the earlier parent
const now = Date.parse('2026-11-04T19:00:00.000Z');
const ownMs = receivableAtMs({ confirmedAt: '2026-11-04T19:08:00.000Z', createdAt: '2026-11-04T19:08:00.000Z', etaAt: '2026-11-04T19:50:00.000Z', orderType: 'delivery', settings: null, nowMs: now });
const parentMs = receivableAtMs({ confirmedAt: '2026-11-04T19:00:00.000Z', createdAt: '2026-11-04T19:00:00.000Z', etaAt: '2026-11-04T19:35:00.000Z', orderType: 'delivery', settings: null, nowMs: now });
const joint = linkedReceivableAtMs(ownMs, { status: 'confirmed', type: 'delivery', created_at: '2026-11-04T19:00:00.000Z', confirmed_at: '2026-11-04T19:00:00.000Z', eta_at: '2026-11-04T19:35:00.000Z' }, null, now);
ok(joint === Math.min(ownMs, parentMs), 'joint unlock takes earlier instant');
ok(linkedReceivableAtMs(ownMs, { status: 'completed' }, null, now) === ownMs, 'done parent ignored');
ok(linkedReceivableAtMs(ownMs, null, null, now) === ownMs, 'no parent keeps own');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
