// Unit tests for src/utils/safeJson.ts (untrusted-boundary guards).
// Run: npx tsx scripts/test-safe-json.ts
import { isRecord, readJson, parseJson, str, num, langText } from '../src/utils/safeJson';

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string): void {
  if (cond) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name}`);
  }
}

ok(isRecord({}) === true, 'empty object is a record');
ok(isRecord({ a: 1 }) === true, 'object is a record');
ok(isRecord([]) === false, 'array is not a record');
ok(isRecord(null) === false, 'null is not a record');
ok(isRecord('x') === false, 'string is not a record');
ok(isRecord(42) === false, 'number is not a record');

ok(parseJson('{"a":1}') !== null, 'valid JSON parses');
ok((parseJson('{"a":1}') as { a: number }).a === 1, 'parsed value intact');
ok(parseJson('{oops') === null, 'bad JSON yields null, never throws');
ok(parseJson('') === null, 'empty text yields null');

const goodRes = { json: () => Promise.resolve({ ok: true }) } as unknown as Response;
ok((await readJson(goodRes)) !== null, 'readJson resolves body');
const badRes = {
  json: () => Promise.reject(new Error('bad')),
} as unknown as Response;
ok((await readJson(badRes)) === null, 'readJson rejects to null');

ok(str('hi') === 'hi', 'str keeps strings');
ok(str(42) === '', 'str drops numbers');
ok(str(null) === '', 'str drops null');
ok(str(undefined, 'fb') === 'fb', 'str honors fallback');
ok(num(7) === 7, 'num keeps finite numbers');
ok(num(NaN) === 0, 'num drops NaN');
ok(num('7') === 0, 'num drops numeric strings');
ok(num(undefined, 5) === 5, 'num honors fallback');
const lt = langText({ en: 'Hi', ar: 'مرحبا' });
ok(lt.en === 'Hi' && lt.ar === 'مرحبا', 'langText keeps both languages');
const lt2 = langText({ en: 3 });
ok(lt2.en === '' && lt2.ar === '', 'langText drops non-strings');
const lt3 = langText(null);
ok(lt3.en === '' && lt3.ar === '', 'langText defaults on null');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
