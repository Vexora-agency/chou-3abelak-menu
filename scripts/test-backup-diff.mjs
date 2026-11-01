// Unit tests for Backup & History: diffMenus, signatures, CSV round trip
// (Arabic), category icon fields. Pure split of test-backup.mjs.
// Run: node scripts/test-backup-diff.mjs
import { diffMenus, summarizeChanges } from '../functions/_shared/diff.js';
import {
  applyCSVToMenu,
  buildMenuCSV,
  buildPrintHTML,
} from '../functions/_shared/versions.js';
import { validateMenu } from '../functions/_shared/validate.js';
import { createAsserts } from './_helpers/shared.mjs';
import { bi, makeMenu } from './_helpers/backup-fixture.mjs';

const { ok, summary } = createAsserts();

/* ---------------- 1. diffMenus ---------------- */

{
  const a = makeMenu();
  const b = JSON.parse(JSON.stringify(a));
  ok(diffMenus(a, JSON.parse(JSON.stringify(a)), 'en').length === 0, 'identical menus: no changes');
  // price change
  b.items[0].pricing.price = 160000;
  let ch = diffMenus(a, b, 'en');
  ok(ch.length === 1 && ch[0].kind === 'changed' && ch[0].detail === 'Price 150,000 → 160,000', `price detail (${ch[0] && ch[0].detail})`);
  // arabic detail prefix enables price counting
  const chAr = diffMenus(a, b, 'ar');
  ok(chAr[0].detail.startsWith('السعر'), 'arabic price prefix');
  ok(summarizeChanges(ch).prices === 1 && summarizeChanges(chAr).prices === 1, 'price counting both languages');
  // availability + category move + rename + variant price
  b.items[2].available = false;
  b.items[2].categoryId = 'c1';
  b.items[1].name.en = 'Mashrouha Special';
  b.items[1].variants[0].price = 210000;
  ch = diffMenus(a, b, 'en');
  ok(ch.some((c) => c.detail === 'Availability: Available → Hidden'), 'availability detail');
  ok(ch.some((c) => c.detail === 'Category: Drinks → Pies'), 'category move detail');
  ok(ch.some((c) => c.detail === 'Name: Mashrouha, "Special" → Mashrouha Special'), 'rename detail');
  ok(ch.some((c) => c.scope === 'item' && c.detail.startsWith('Variants:')), 'variant change detail');
  // removed item + added category + renamed category
  const c = JSON.parse(JSON.stringify(a));
  c.items = c.items.filter((it) => it.id !== 'pepsi');
  c.categories.push({ id: 'c3', name: bi('Desserts', 'حلويات'), visible: true });
  c.categories[0].name.en = 'Pies!';
  ch = diffMenus(a, c, 'en');
  ok(ch.some((x) => x.kind === 'removed' && x.label === 'Pepsi'), 'removed item');
  ok(ch.some((x) => x.kind === 'added' && x.scope === 'category' && x.label === 'Desserts'), 'added category');
  ok(ch.some((x) => x.detail === 'Name: Pies → Pies!'), 'renamed category');
  // sensitive settings
  const d = JSON.parse(JSON.stringify(a));
  d.settings.phone = '+96170999999';
  d.settings.ordering.enabled = true;
  d.settings.timezone = 'UTC';
  ch = diffMenus(a, d, 'en');
  ok(ch.some((x) => x.label === 'Phone number' && x.sensitive), 'phone sensitive');
  ok(ch.some((x) => x.label === 'Online ordering' && x.sensitive), 'ordering sensitive');
  ok(ch.some((x) => x.label === 'Timezone' && x.sensitive), 'timezone sensitive');
  // cap at 500
  const big = JSON.parse(JSON.stringify(a));
  for (let i = 0; i < 600; i++) {
    big.items.push({ ...JSON.parse(JSON.stringify(a.items[0])), id: `x${i}`, categoryId: 'c1' });
  }
  ok(diffMenus(a, big, 'en').length === 500, 'changes capped at 500');
}

/* ---------------- 2. Signatures ---------------- */

{
  const { backupEnvelope, signPayload, verifyPayload } = await import('../functions/_shared/versions.js');
  const env2 = { BACKUP_SECRET: 'test-backup-secret-1234567890' };
  const menu = makeMenu();
  const payload = backupEnvelope({ menu, siteId: 'site1', exportedAt: '2026-01-01T00:00:00.000Z' });
  const sig = await signPayload(env2, payload);
  ok(/^[0-9a-f]{64}$/.test(sig), 'sig shape');
  ok((await verifyPayload(env2, payload, sig)) === true, 'valid sig verifies');
  const tampered = { ...payload, menu: { ...menu, items: [] } };
  ok((await verifyPayload(env2, tampered, sig)) === false, 'tampered file fails verification');
  ok((await verifyPayload({ BACKUP_SECRET: 'other-secret-12345678901234' }, payload, sig)) === false, 'wrong secret fails');
  ok((await verifyPayload(env2, payload, null)) === false, 'missing sig is unsigned');
}

/* ---------------- 3. CSV round trip + print XSS ---------------- */

{
  const menu = makeMenu();
  const csv = buildMenuCSV(menu);
  ok(csv.charCodeAt(0) === 0xfeff, 'menu CSV BOM');
  const noBom = csv.replace(/^\uFEFF/, '');
  ok(noBom.split('\n')[0] === 'category,item_id,name_en,name_ar,variant_id,variant_en,variant_ar,price,unit,available', 'menu CSV header');
  ok(csv.includes('مشروحة') && csv.includes('"Mashrouha, ""Special""'), 'CSV Arabic + quoting');
  // change a price, drop a row (must NOT delete), add unknown id (skipped)
  const lines = noBom.trim().split('\n');
  const body = lines.slice(1).filter((l) => !l.includes(',pepsi,'));
  const tweaked = [lines[0], ...body.map((l) => (l.includes(',zaatar,') ? l.replace(',150000,', ',170000,') : l)), 'Pies,ghost,Ghost,شبح,,,,50000,pc,true', 'Nope,ghost2,Ghost2,شبح2,,,,50000,pc,true'].join('\n');
  const applied = applyCSVToMenu(menu, tweaked);
  const v = validateMenu(applied.menu);
  ok(v.ok, 'merged CSV menu validates');
  ok(v.value.items.find((it) => it.id === 'zaatar').pricing.price === 170000, 'CSV price update applies');
  ok(v.value.items.some((it) => it.id === 'pepsi'), 'dropped CSV row never deletes');
  ok(applied.added === 1 && applied.skipped === 1, 'known-category adds, unknown-category skips');
  // print page escapes everything
  const evil = makeMenu();
  evil.items[0].name.en = '<script>alert(1)</script>';
  const html = buildPrintHTML(evil, 'en');
  ok(!html.includes('<script>alert'), 'print escapes item names');
  ok(html.includes('&lt;script&gt;'), 'print shows escaped text');
  ok(html.includes('A4') && html.includes('Chou 3abelak'), 'print has A4 + brand');
}

/* ---------------- 3b. Categories: card icon watermark fields ---------------- */

{
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const withIcon = (patch) => {
    const m = makeMenu();
    Object.assign(m.categories[0], patch);
    return validateMenu(m);
  };
  let v = withIcon({ icon: 'pizza', iconStyle: 'pattern' });
  ok(v.ok && v.value.categories[0].icon === 'pizza' && v.value.categories[0].iconStyle === 'pattern', 'glyph icon + pattern style preserved');
  v = withIcon({ icon: 'custom', iconUrl: png });
  ok(v.ok && v.value.categories[0].icon === 'custom' && v.value.categories[0].iconUrl === png, 'custom PNG iconUrl preserved');
  v = withIcon({ icon: 'nope' });
  ok(v.ok && v.value.categories[0].icon === undefined, 'unknown icon falls back (dropped)');
  v = withIcon({ icon: 'custom', iconUrl: 'data:image/jpeg;base64,xx' });
  ok(!v.ok, 'non-PNG iconUrl rejected');
  v = withIcon({ icon: 'custom', iconUrl: 'data:image/png;base64,' + 'A'.repeat(60001) });
  ok(!v.ok, 'oversized iconUrl rejected');
  v = withIcon({ iconStyle: 'wallpaper' });
  ok(v.ok && v.value.categories[0].iconStyle === undefined, 'unknown iconStyle dropped');
  v = withIcon({ iconStyle: 'center', iconOpacity: 30, iconX: 20, iconY: 80 });
  ok(v.ok && v.value.categories[0].iconStyle === 'center' && v.value.categories[0].iconOpacity === 30 && v.value.categories[0].iconX === 20 && v.value.categories[0].iconY === 80, 'style + opacity + position preserved');
  v = withIcon({ iconOpacity: 99, iconX: -5, iconY: 250 });
  ok(v.ok && v.value.categories[0].iconOpacity === undefined && v.value.categories[0].iconX === undefined && v.value.categories[0].iconY === undefined, 'out-of-range opacity/position dropped');
  v = withIcon({ iconScale: 150 });
  ok(v.ok && v.value.categories[0].iconScale === 150, 'valid scale preserved');
  v = withIcon({ iconScale: 10 });
  ok(v.ok && v.value.categories[0].iconScale === undefined, 'out-of-range scale dropped');
  v = withIcon({ icon: 'waves', iconRotate: 45 });
  ok(v.ok && v.value.categories[0].icon === 'waves' && v.value.categories[0].iconRotate === 45, 'decor glyph + rotation preserved');
  v = withIcon({ iconRotate: 200 });
  ok(v.ok && v.value.categories[0].iconRotate === undefined, 'out-of-range rotation dropped');
}

summary();
