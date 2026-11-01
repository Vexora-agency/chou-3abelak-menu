/**
 * Rules-of-Hooks regression test: every component that calls useGuardedText
 * must call ALL of its hooks before any early return. Violating this crashes
 * React ("Rendered more hooks than during the previous render") and unmounts
 * the whole app — the black screen reported when opening any menu item
 * (ItemDetailsModal called useGuardedText *after* `if (!item) return null`).
 * Run: node scripts/test-hook-order.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) { pass++; } else { fail++; console.error(`FAIL ${n} ${x}`); } };

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Files that consume useGuardedText (grep-verified; update if the set grows).
const FILES = [
  'src/features/menu/components/ItemDetailsModal.tsx',
  'src/features/cart/components/CartBar.tsx',
  'src/features/cart/components/cart/OrderSummaryLines.tsx',
];

for (const rel of FILES) {
  const lines = readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n').split('\n');
  const hookLines = [];
  let firstEarlyReturn = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Hook call at statement start (const x = useX(...) or bare useX(...)).
    if (/^\s*(?:const\s+[\w{}\s,]+\s*=\s*)?use[A-Z][A-Za-z]*\s*\(/.test(line)) {
      hookLines.push(i + 1);
    }
    // Top-level early return: `if (...) return ...;` or bare `return ...;`
    // at component-body depth (2-space indent), before any JSX return.
    if (firstEarlyReturn < 0 && /^ {2}(?:if\s*\(.*\)\s*return\b|return\b)/.test(line)) {
      firstEarlyReturn = i + 1;
    }
  }
  ok(hookLines.length > 0, `${rel} calls hooks (guard is live)`);
  if (firstEarlyReturn < 0) {
    ok(true, `${rel} has no early return — order trivially stable`);
  } else {
    const bad = hookLines.filter((n) => n > firstEarlyReturn);
    ok(bad.length === 0, `${rel}: all hooks (lines ${hookLines.join(',')}) run before first early return (line ${firstEarlyReturn})`, bad.length ? `violations at ${bad.join(',')}` : '');
  }
}

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
