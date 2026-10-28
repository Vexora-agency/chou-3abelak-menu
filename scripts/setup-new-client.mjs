#!/usr/bin/env node
/**
 * Setup a new white-label client from this base system.
 * Usage: node scripts/setup-new-client.mjs "Client Name" "#PRIMARY" [starter|pro|signature]
 * (Node — not perl/sed — so it runs on Windows Git-Bash, macOS and Linux alike.
 *  Node is already required for wrangler/vite, so no extra dependency.)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [name, primary, plan = 'starter'] = process.argv.slice(2);
if (!name || !primary) {
  console.error('Usage: node scripts/setup-new-client.mjs "Client Name" "#PRIMARY" [starter|pro|signature]');
  process.exit(1);
}
if (!/^#[0-9a-fA-F]{6}$/.test(primary)) {
  console.error(`Refusing: primary must be a #RRGGBB hex color, got ${JSON.stringify(primary)}`);
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const patch = (rel, from, to) => {
  const p = join(root, rel);
  const before = readFileSync(p, 'utf8');
  if (!before.includes(from)) {
    console.error(`Refusing: pattern not found in ${rel}: ${JSON.stringify(from)}`);
    process.exit(1);
  }
  writeFileSync(p, before.replace(from, to));
  console.log(`  patched ${rel}`);
};

console.log(`→ client=${name} primary=${primary} plan=${plan}`);

// 1. Theme primary (TS tokens + CSS var stay in sync; components read the var).
patch('src/config/theme.config.ts', "primary: '#FFC400'", `primary: '${primary}'`);
patch('src/styles/base.css', '--yellow: #FFC400;', `--yellow: ${primary};`);
patch('src/styles/base.css', 'outline: 3px solid #FFC400;', `outline: 3px solid ${primary};`);

// 2. Client identity.
patch('src/config/client.config.ts', "companyNameEn: 'Chou 3abelak'", `companyNameEn: '${name.replace(/'/g, "\\'")}'`);

// 3. Plan-gated flags (starter hides reports/orderLogging; backend 404s via SITE_PLAN anyway).
if (plan === 'starter') {
  patch('src/config/features.config.ts', 'enableReports: true', 'enableReports: false');
  patch('src/config/features.config.ts', 'enableOrderLogging: true', 'enableOrderLogging: false');
}

console.log('✓ Patched src/config + base.css. Next:');
console.log('  1. Replace public/assets/logo-final.png (+ email-logo.png) or update client.config.ts logo path');
console.log(`  2. Set Cloudflare env SITE_PLAN=${plan} (+ secrets from .env.example)`);
console.log('  3. npx wrangler d1 migrations apply ORDERS_DB --remote && npm run build');
