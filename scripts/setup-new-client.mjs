#!/usr/bin/env node
/**
 * Setup a new white-label client from this base system.
 * Usage: node scripts/setup-new-client.mjs "Client Name" "#PRIMARY" [starter|pro|plus]
 * (Node — not perl/sed — so it runs on Windows Git-Bash, macOS and Linux alike.
 *  Node is already required for wrangler/vite, so no extra dependency.)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [name, primary, plan = 'starter'] = process.argv.slice(2);
if (!name || !primary) {
  console.error('Usage: node scripts/setup-new-client.mjs "Client Name" "#PRIMARY" [starter|pro|plus]');
  process.exit(1);
}
if (!['starter', 'pro', 'plus'].includes(plan)) {
  console.error(`Refusing: plan must be starter|pro|plus, got ${JSON.stringify(plan)}`);
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
    // Idempotent re-runs (plan change scripts run twice): already there.
    if (before.includes(to)) {
      console.log(`  already ${rel}: ${JSON.stringify(to)}`);
      return;
    }
    console.error(`Refusing: pattern not found in ${rel}: ${JSON.stringify(from)}`);
    process.exit(1);
  }
  writeFileSync(p, before.replace(from, to));
  console.log(`  patched ${rel}`);
};

console.log(`→ client=${name} primary=${primary} plan=${plan}`);

// 1. Theme primary (TS tokens + CSS var stay in sync; components read the var).
// (The old hardcoded focus-outline patch is gone: base.css now reads
// var(--primary), so theming follows theme.config automatically.)
patch('src/config/theme.config.ts', "primary: '#FFC400'", `primary: '${primary}'`);
patch('src/styles/base.css', '--yellow: #FFC400;', `--yellow: ${primary};`);

// 2. Client identity.
patch('src/config/client.config.ts', "companyNameEn: 'Chou 3abelak'", `companyNameEn: '${name.replace(/'/g, "\\'")}'`);

// 3. Plan (single source of truth — the five UI flags derive from it).
// Works BOTH ways: downgrades and upgrades are just: set SITE_PLAN, re-run
// this script, rebuild, redeploy. No data is touched — hidden features' data
// stays stored. Plus unlocks the same code as pro (service-only difference).
// (The ?plan= dev preview override below the fallback is untouched.)
{
  const rel = 'src/config/features.config.ts';
  const p = join(root, rel);
  const before = readFileSync(p, 'utf8');
  const cur = ['starter', 'pro', 'plus'].find((v) => before.includes(`return '${v}';`));
  if (!cur) {
    console.error(`Refusing: plan fallback line not found in ${rel}`);
    process.exit(1);
  }
  if (cur === plan) {
    console.log(`  already ${rel}: plan = '${plan}'`);
  } else {
    writeFileSync(p, before.replace(`return '${cur}';`, `return '${plan}';`));
    console.log(`  patched ${rel}: plan ${cur} -> ${plan}`);
  }
}

console.log('✓ Patched src/config + base.css. Next:');
console.log('  1. Replace public/assets/logo-final.png (+ email-logo.png) or update client.config.ts logo path');
console.log(`  2. Set Cloudflare env SITE_PLAN=${plan} (+ secrets from .env.example)`);
console.log('  3. npx wrangler d1 migrations apply ORDERS_DB --remote && npm run build');
