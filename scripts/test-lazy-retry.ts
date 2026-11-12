// Unit tests for lazyWithReload's chunk-error predicate (src/utils/lazyRetry.ts).
// Guards the post-deploy white-screen: a stale hashed chunk 404s as
// text/html (SPA fallback) and Safari throws a MIME TypeError — that exact
// signature must be recognized so the app reloads once instead of crashing.
// Run: npx tsx scripts/test-lazy-retry.ts
import { isChunkLoadError } from '../src/utils/lazyRetry';

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
