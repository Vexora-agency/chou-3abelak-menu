/**
 * Bundle safety gate (runs after `vite build`, both locally and in the
 * Cloudflare Pages build). Fails the deploy if a forbidden development or
 * retired-integration string ships in the customer bundle.
 *
 * Mirrors the old GitHub Actions grep step without relying on shell tools.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const DIST = 'dist';
const FORBIDDEN = [
  { label: 'dev-admin backdoor', re: /dev-admin/i },
  { label: 'build-stamp comment', re: /REMOVE BEFORE COMMIT/i },
  { label: 'retired WhatsApp automation (waapi)', re: /waapi/i },
  { label: 'retired WhatsApp automation (sentVia)', re: /sentVia/i },
];
const SCAN_EXT = new Set(['.js', '.mjs', '.css', '.html']);

const offenders = [];

function scan(file) {
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const { label, re } of FORBIDDEN) {
    if (re.test(text)) offenders.push(`${file} :: ${label}`);
  }
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const file = join(dir, entry);
    const info = statSync(file);
    if (info.isDirectory()) walk(file);
    else if (SCAN_EXT.has(extname(file))) scan(file);
  }
}

if (!existsSync(join(DIST, 'index.html')) || !existsSync(join(DIST, 'assets'))) {
  console.error('bundle check: dist/index.html or dist/assets is missing — run the build first');
  process.exit(1);
}

scan(join(DIST, 'index.html'));
walk(join(DIST, 'assets'));

if (offenders.length > 0) {
  console.error('FORBIDDEN STRING IN BUNDLE');
  for (const line of offenders) console.error(`  ${line}`);
  process.exit(1);
}

console.log('bundle check clean');
