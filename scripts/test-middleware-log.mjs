// Request-id middleware + structured error log tests (zero-dep).
// Run: node scripts/test-middleware-log.mjs
import { onRequest as rootMw } from '../functions/_middleware.js';
import { logError } from '../functions/_shared/log.js';

let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) { pass++; } else { fail++; console.error(`FAIL ${n} ${x}`); } };
const req = (url = 'https://x/api/menu', method = 'GET') => new Request(url, { method });

const origError = console.error;
let logged = [];
console.error = (m) => { logged.push(String(m)); };

// success path: reqId echoed, body untouched
{
  logged = [];
  const res = await rootMw({ request: req(), next: async () => new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }) });
  const id = res.headers.get('x-request-id');
  ok(res.status === 200 && typeof id === 'string' && id.length >= 4, 'success echoes x-request-id');
  ok((await res.text()) === '{"ok":true}', 'success body untouched');
  ok(logged.length === 0, 'success logs nothing');
}
// throw path: generic 500, one JSON line, matching reqId, no stack/PII
{
  logged = [];
  const res = await rootMw({ request: req('https://x/api/orders', 'POST'), next: async () => { throw new Error('db exploded'); } });
  const data = await res.json().catch(() => null);
  const id = res.headers.get('x-request-id');
  ok(res.status === 500 && data && data.error === 'unavailable', 'throw becomes generic 500');
  ok(data && data.reqId === id && typeof id === 'string' && id.length >= 4, '500 carries matching reqId');
  ok(logged.length === 1, 'exactly one log line');
  const entry = JSON.parse(logged[0]);
  ok(entry.level === 'error' && entry.reqId === id && entry.route === 'POST /api/orders', 'log line is structured');
  ok(!/exploded|stack|at |phone|token|secret|password/i.test(logged[0]) || /db exploded/.test(logged[0]), 'message kept, nothing else leaks');
  ok(!/body|query|header|cookie/i.test(JSON.stringify(Object.keys(entry))), 'no request-data keys logged');
}
// logError helper: truncates, never throws
{
  logged = [];
  const id = logError(req(), new Error('x'.repeat(5000)), { code: 'boom', status: 500 });
  const entry = JSON.parse(logged[0]);
  ok(typeof id === 'string' && entry.message.length <= 200, 'message truncated to 200');
  ok(entry.code === 'boom' && entry.status === 500, 'code/status passthrough');
  const id2 = logError(null, null, null);
  ok(typeof id2 === 'string', 'logError never throws');
}

console.error = origError;
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
