// Unit tests for the Google-style WhatsApp country picker data + logic.
// Run: npx tsx scripts/test-dial-codes.ts
import {
  DIAL_AR_NAMES,
  DIAL_CODES,
  DEFAULT_DIAL_ISO,
  OTHER_ISO,
  composeFull,
  filterDialCodes,
  flagEmoji,
  splitDialCode,
} from '../src/config/dialCodes';

let passed = 0;
let failed = 0;
function ok(cond: boolean, name: string) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL: ${name}`);
  }
}

/* ---------------- table shape ---------------- */
{
  ok(DIAL_CODES.length >= 200, `full world coverage (${DIAL_CODES.length})`);
  ok(DIAL_CODES.every((c) => /^[A-Z]{2}$/.test(c.iso)), 'all iso are 2 letters');
  ok(DIAL_CODES.every((c) => c.name.length >= 3 && /^[\x20-\x7E]+$/.test(c.name)), 'all names ASCII');
  ok(DIAL_CODES.every((c) => /^[1-9][0-9]{0,3}$/.test(c.code)), 'all codes are digit prefixes');
  const names = DIAL_CODES.map((c) => c.name.toLowerCase());
  ok(names.every((n, i) => i === 0 || names[i - 1] <= n), 'alphabetical by name');
  const spot: Array<[string, string]> = [
    ['LB', '961'], ['EG', '20'], ['SA', '966'], ['AE', '971'],
    ['US', '1'], ['GB', '44'], ['FR', '33'], ['DE', '49'],
    ['TR', '90'], ['IQ', '964'], ['JO', '962'], ['SY', '963'],
  ];
  for (const [iso, code] of spot) {
    ok(DIAL_CODES.some((c) => c.iso === iso && c.code === code), `spot check ${iso}=${code}`);
  }
  ok(flagEmoji('LB').length > 0 && flagEmoji('XX').length > 0, 'flag glyphs derive from iso');
  ok(flagEmoji('L') === '' && flagEmoji('') === '', 'flag rejects non-iso');
}

/* ---------------- split / compose ---------------- */
{
  const lb = splitDialCode('96170123456');
  ok(lb.iso === 'LB' && lb.code === '961' && lb.national === '70123456', 'split lebanon number');
  const eg = splitDialCode('+20 101 234 5678');
  ok(eg.iso === 'EG' && eg.national === '1012345678', 'split tolerates formatting');
  const blank = splitDialCode('');
  ok(blank.iso === DEFAULT_DIAL_ISO && blank.national === '', 'blank defaults to home country');
  const odd = splitDialCode('999999');
  ok(odd.iso === OTHER_ISO && odd.national === '999999', 'unknown values preserved under OTHER');
  ok(composeFull('961', '070123456') === '96170123456', 'trunk zero stripped on compose');
  ok(composeFull('961', '70 123-456') === '96170123456', 'formatting stripped on compose');
  ok(composeFull('961', '') === '', 'empty national stores empty (no phantom code)');
  ok(composeFull('', '96170123456') === '96170123456', 'OTHER passes digits through');
  // round trip: compose then split restores the parts
  const full = composeFull('20', '0101234567');
  const back = splitDialCode(full);
  ok(full === '20101234567' && back.iso === 'EG' && back.national === '101234567', 'round trip egypt local format');
}

/* ---------------- search ---------------- */
{
  ok(filterDialCodes('').length === DIAL_CODES.length, 'empty query returns all');
  ok(filterDialCodes('e').some((c) => c.iso === 'EG'), '"e" matches Egypt');
  const byCode = filterDialCodes('961');
  ok(byCode.length === 1 && byCode[0].iso === 'LB', '"961" isolates Lebanon');
  ok(filterDialCodes('لب').some((c) => c.iso === 'LB'), 'arabic alias matches Lebanon');
  ok(filterDialCodes('مصر').some((c) => c.iso === 'EG'), 'arabic alias matches Egypt');
  ok(filterDialCodes('xyz123').length === 0, 'no match returns empty');
  ok(
    Object.keys(DIAL_AR_NAMES).every((iso) => DIAL_CODES.some((c) => c.iso === iso)),
    'every arabic alias points at a real entry'
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
