// Per-action confirm words: typing DELETE must never confirm an export.
// Run: node scripts/test-customer-confirm.mjs
import { confirmWordOk, CONFIRM_WORDS } from '../functions/_shared/customer-data.js';
import { createAsserts } from './_helpers/shared.mjs';

const { ok, summary } = createAsserts();

ok(confirmWordOk('DELETE', 'delete') === true, 'delete accepts DELETE');
ok(confirmWordOk('حذف', 'delete') === true, 'delete accepts حذف');
ok(confirmWordOk('delete', 'delete') === true, 'delete case-insensitive');
ok(confirmWordOk('ANONYMIZE', 'anonymize') === true, 'anonymize accepts ANONYMIZE');
ok(confirmWordOk('إخفاء', 'anonymize') === true, 'anonymize accepts إخفاء');
ok(confirmWordOk('EXPORT', 'export') === true, 'export accepts EXPORT');
ok(confirmWordOk('تصدير', 'export') === true, 'export accepts تصدير');
ok(confirmWordOk('DELETE', 'export') === false, 'export rejects DELETE');
ok(confirmWordOk('DELETE', 'anonymize') === false, 'anonymize rejects DELETE');
ok(confirmWordOk('EXPORT', 'delete') === false, 'delete rejects EXPORT');
ok(confirmWordOk('', 'delete') === false, 'empty rejected');
ok(confirmWordOk('  DELETE  ', 'delete') === true, 'whitespace trimmed');
ok(confirmWordOk('DELETE', 'unknown-mode') === false, 'unknown mode falls back to anonymize list');
ok(Array.isArray(CONFIRM_WORDS.delete) && CONFIRM_WORDS.delete.includes('DELETE'), 'word lists exported');

summary();
