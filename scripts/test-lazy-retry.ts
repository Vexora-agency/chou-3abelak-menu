// Unit tests for lazyWithReload's chunk-error predicate (src/utils/lazyRetry.ts).
// Guards the post-deploy white-screen: a stale hashed chunk 404s as
// text/html (SPA fallback) and Safari throws a MIME TypeError — that exact
// signature must be recognized so the app reloads once instead of crashing.
// Run: npx tsx scripts/test-lazy-retry.ts
import {
  chunkReloadKey,
  isChunkLoadError,
  recoverFromChunkError,
} from '../src/utils/lazyRetry';

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

// The exact production signatures (Sentry 6d4174a3 + Chrome/Firefox variants).
ok(
  isChunkLoadError(
    new TypeError("'text/html' is not a valid JavaScript MIME type for module script 'https://x.pages.dev/assets/OrdersBell-A3l-ile0.js'.")
  ),
  'safari MIME TypeError recognized'
);
ok(
  isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/pages.dev/assets/CartDrawer-abc.js')),
  'chrome dynamic-import failure recognized'
);
ok(
  isChunkLoadError(new Error('Importing a module script failed.')),
  'firefox module failure recognized'
);
ok(
  isChunkLoadError(new Error('Loading chunk 42 failed.')),
  'webpack-style chunk failure recognized'
);
ok(isChunkLoadError(new TypeError('NetworkError when attempting to fetch resource.')) === false, 'plain network error NOT a chunk error');
ok(isChunkLoadError(new Error('no_price')) === false, 'domain error NOT a chunk error');
ok(isChunkLoadError(null) === false, 'null NOT a chunk error');
ok(isChunkLoadError(undefined) === false, 'undefined NOT a chunk error');
ok(isChunkLoadError('Failed to fetch dynamically imported module: x') === true, 'string chunk message recognized');

// Recovery is per module URL, so one stale chunk cannot block a later deploy.
const adminErr = new TypeError('Failed to fetch dynamically imported module: https://chou3abelak.site/assets/AdminPanel-D0MNqp-3.js');
const otherErr = new TypeError('Failed to fetch dynamically imported module: https://chou3abelak.site/assets/OrdersBell-abc123.js');
ok(chunkReloadKey(adminErr).includes('AdminPanel-D0MNqp-3.js'), 'failed chunk URL is the key');
ok(chunkReloadKey(adminErr) === chunkReloadKey(new TypeError('Failed to fetch dynamically imported module: https://chou3abelak.site/assets/AdminPanel-D0MNqp-3.js')), 'same chunk has one stable key');
ok(chunkReloadKey(adminErr) !== chunkReloadKey(otherErr), 'different chunks have different keys');

// Stub the browser globals used by the recovery path.
const session = new Map<string, string>();
let replaced = '';
(globalThis as unknown as { window: unknown }).window = {
  sessionStorage: {
    getItem: (k: string) => (session.has(k) ? session.get(k) : null),
    setItem: (k: string, v: string) => void session.set(k, String(v)),
    removeItem: (k: string) => void session.delete(k),
  },
  location: {
    href: 'https://chou3abelak.site/admin',
    replace: (url: string) => { replaced = url; },
    reload: () => { replaced = 'reload'; },
  },
};
ok(recoverFromChunkError(new Error('NetworkError when attempting to fetch resource.')) === false, 'plain network error does not reload');
session.set('chunk-reload-v1', '1');
ok(recoverFromChunkError(adminErr) === true, 'first stale chunk starts a reload');
ok(replaced.includes('/admin?_r='), 'reload keeps /admin and adds a cache-buster');
ok(recoverFromChunkError(adminErr) === false, 'the same failed chunk never reload-loops');
ok(recoverFromChunkError(otherErr) === true, 'a different stale chunk can still recover');
ok(!session.has('chunk-reload-v1'), 'legacy global one-shot flag is cleared');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
