#!/usr/bin/env node
/**
 * wipe-images.mjs — fresh-start helpers for menu photos (imageVariants pipeline).
 *
 * The owner wants to start images from zero: strip every old item photo, then
 * re-upload clean ones through the new imageVariants pipeline. The real photos
 * live in production Cloudflare (KV MENU_KV + R2 MENU_IMAGES) and cannot be
 * touched from here without credentials — so this script is read-only by
 * default and every destructive step needs explicit confirmation.
 *
 * Modes (exactly one per run, default = report):
 *
 *   1. report (dry-run, DEFAULT — read-only, no backup needed, nothing written):
 *        node scripts/wipe-images.mjs [--source=menu.seed.json]
 *     Reads a local menu doc and prints: item count, internal vs external
 *     imageUrl counts, imageVariants counts, extracted R2 keys, approx size.
 *
 *   2. strip (local file rewrite — backup first):
 *        node scripts/wipe-images.mjs --strip --in=menu.seed.json --out=menu.stripped.json
 *     Copies the file with `imageUrl` + `imageVariants` removed from every
 *     item, then prints a report. A timestamped backup of --in is written
 *     first (menu-backup-<timestamp>.json). Refuses --in == --out unless
 *     --confirm is also passed.
 *
 *   3. r2-list (read-only — lists production R2 keys under menu/):
 *        CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
 *          node scripts/wipe-images.mjs --r2-list [--bucket=chou-3abelak-images] [--prefix=menu/]
 *     NOTE: `wrangler r2 object` has get/put/delete but NO list subcommand
 *     (confirmed against Cloudflare docs), so listing goes through the R2
 *     REST API with fetch (built into Node, no new dependencies). The
 *     --prefix guard applies: only menu/ (or a sub-prefix of it) is allowed.
 *
 *   4. r2-delete (DESTRUCTIVE — dry-run unless --confirm):
 *        node scripts/wipe-images.mjs --r2-delete --key=menu/2026/01/<uuid>.jpg [--key=...]
 *        node scripts/wipe-images.mjs --r2-delete --keys-file=r2-keys.json --confirm [--bucket=...]
 *     Without --confirm it only prints what WOULD be deleted (dry-run first).
 *     With --confirm it snapshots the key list to menu-backup-r2-<ts>.json
 *     and deletes each key via `npx wrangler r2 object delete <bucket>/<key>
 *     --remote`. Every key must start with menu/ — anything else is refused.
 *
 * Exit codes: 0 ok · 1 runtime error · 2 usage/validation error.
 * `npx tsc --noEmit` must stay 0 — this file is plain JS with no new deps.
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

// Must stay identical to IMAGE_KEY_RE in functions/_shared/image-meta.js.
const IMAGE_KEY_RE =
  /^menu\/\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;
const MARKER = '/api/images/';
const ALLOWED_PREFIX = 'menu/';
const DEFAULT_BUCKET = 'chou-3abelak-images';
const DEFAULT_SOURCE = 'menu.seed.json';
const API_BASE = 'https://api.cloudflare.com/client/v4';

const log = (msg) => console.log(msg);
const err = (msg) => console.error(msg);

function usage(exitCode = 2) {
  err(`Usage | الاستخدام:
  node scripts/wipe-images.mjs [--source=path]                                  report (dry-run, default)
  node scripts/wipe-images.mjs --strip --in=path --out=path [--confirm]         strip imageUrl+imageVariants
  node scripts/wipe-images.mjs --r2-list [--bucket=name] [--prefix=menu/]       list production R2 keys (REST)
  node scripts/wipe-images.mjs --r2-delete (--key=k|--keys-file=f) [--bucket=name] [--confirm]
                                                                                delete R2 keys via wrangler

  Flags: --source | --strip --in --out | --r2-list | --r2-delete --key --keys-file
         --bucket (default ${DEFAULT_BUCKET}) --prefix (must start with menu/)
         --account (or $CLOUDFLARE_ACCOUNT_ID) · token from $CLOUDFLARE_API_TOKEN
         --confirm (required for any real delete / same-file strip) · --help`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = {};
  const multi = { key: [] };
  for (const raw of argv) {
    if (raw === '--help' || raw === '-h') return { help: true };
    if (raw === '--strip') { args.strip = true; continue; }
    if (raw === '--r2-list') { args.r2list = true; continue; }
    if (raw === '--r2-delete') { args.r2delete = true; continue; }
    if (raw === '--confirm') { args.confirm = true; continue; }
    const m = /^--([a-zA-Z-]+)=(.*)$/.exec(raw);
    if (!m) { err(`Unknown argument: ${raw} | وسيط غير معروف`); usage(); }
    const [, k, v] = m;
    if (k === 'key') { multi.key.push(v); continue; }
    if (['source', 'in', 'out', 'bucket', 'prefix', 'account', 'keys-file'].includes(k)) {
      args[k] = v; continue;
    }
    err(`Unknown option: --${k} | خيار غير معروف`); usage();
  }
  return { ...args, keys: multi.key };
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function loadMenuDoc(path) {
  if (!existsSync(path)) {
    err(`Source file not found: ${path} | الملف غير موجود`);
    process.exit(1);
  }
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    err(`Cannot read ${path}: ${e.message}`);
    process.exit(1);
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    err(`Invalid JSON in ${path}: ${e.message} | ملف JSON غير صالح`);
    process.exit(1);
  }
  const items = Array.isArray(doc) ? doc : doc.items;
  if (!Array.isArray(items)) {
    err(`No items[] array in ${path} | لا توجد قائمة أصناف في الملف`);
    process.exit(1);
  }
  return { doc, items, raw };
}

/** Same extraction rule as menuImageKeys() in functions/_shared/image-gc.js. */
function extractKey(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  const idx = raw.indexOf(MARKER);
  if (idx === -1) return null;
  let key = raw.slice(idx + MARKER.length);
  const cut = key.search(/[?#]/);
  if (cut !== -1) key = key.slice(0, cut);
  return IMAGE_KEY_RE.test(key) ? key : null;
}

function isInternalUrl(raw) {
  return typeof raw === 'string' && raw.includes(MARKER);
}

function isExternalUrl(raw) {
  return typeof raw === 'string' && /^https?:\/\//i.test(raw) && !raw.includes(MARKER);
}

function analyze(items) {
  const stats = {
    items: items.length,
    internalImageUrl: 0,
    externalImageUrl: 0,
    variantsS: 0,
    variantsM: 0,
    itemsWithAnyPhoto: 0,
    keys: new Set(),
  };
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    let hasPhoto = false;
    if (isInternalUrl(item.imageUrl)) { stats.internalImageUrl += 1; hasPhoto = true; }
    else if (isExternalUrl(item.imageUrl)) { stats.externalImageUrl += 1; hasPhoto = true; }
    else if (typeof item.imageUrl === 'string' && item.imageUrl) { stats.externalImageUrl += 1; hasPhoto = true; }
    const v = item.imageVariants;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (typeof v.s === 'string' && v.s) {
        stats.variantsS += 1; hasPhoto = true;
        if (isInternalUrl(v.s)) { /* counted below via key extraction */ }
        else if (v.s) { /* external variant, no R2 key */ }
      }
      if (typeof v.m === 'string' && v.m) {
        stats.variantsM += 1; hasPhoto = true;
      }
    }
    for (const k of [extractKey(item.imageUrl), v && extractKey(v.s), v && extractKey(v.m)]) {
      if (k) stats.keys.add(k);
    }
    if (hasPhoto) stats.itemsWithAnyPhoto += 1;
  }
  return stats;
}

function printReport(source, bytes, stats) {
  const keys = [...stats.keys].sort();
  log(`== wipe-images report | تقرير (dry-run — read-only, لم يُغيَّر شيء) ==`);
  log(`source: ${source} (${bytes} bytes)`);
  log(`items: ${stats.items} | الأصناف`);
  log(`imageUrl internal (/api/images/): ${stats.internalImageUrl} | داخلية`);
  log(`imageUrl external (http...): ${stats.externalImageUrl} | خارجية`);
  log(`imageVariants.s: ${stats.variantsS} · imageVariants.m: ${stats.variantsM}`);
  log(`items with any photo: ${stats.itemsWithAnyPhoto}`);
  log(`R2 keys extracted (menuImageKeys rules): ${keys.length}`);
  for (const k of keys) log(`  - ${k}`);
  log(`approx JSON size: ${(bytes / 1024).toFixed(1)} KB`);
}

function writeBackupOf(filePath, label) {
  const ts = timestamp();
  const backupPath = join(dirname(resolve(filePath)), `menu-backup-${ts}.json`);
  writeFileSync(backupPath, readFileSync(filePath, 'utf8'));
  log(`backup written before any change: ${backupPath} | تم حفظ نسخة احتياطية: ${backupPath} (${label})`);
  return backupPath;
}

// ------------------------------------------------------------------ --strip

function runStrip(args) {
  const inPath = args.in;
  const outPath = args.out;
  if (!inPath || !outPath) {
    err('--strip requires --in=path and --out=path | وضع strip يحتاج --in و --out');
    process.exit(2);
  }
  const inAbs = resolve(inPath);
  const outAbs = resolve(outPath);
  if (inAbs === outAbs && !args.confirm) {
    err('Refusing to overwrite the input file without --confirm. Use a different --out, or repeat with --confirm. | رفض الكتابة فوق نفس الملف بدون --confirm');
    process.exit(2);
  }
  const { doc, items, raw } = loadMenuDoc(inPath);
  writeBackupOf(inPath, 'strip source');

  let strippedItems = 0;
  let strippedUrls = 0;
  let strippedVariants = 0;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    let touched = false;
    if ('imageUrl' in item && item.imageUrl != null && item.imageUrl !== '') { strippedUrls += 1; touched = true; }
    if ('imageVariants' in item && item.imageVariants != null) { strippedVariants += 1; touched = true; }
    delete item.imageUrl;
    delete item.imageVariants;
    if (touched) strippedItems += 1;
  }

  // Preserve the file's line-ending style (repo seed uses CRLF) + trailing newline.
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  let out = JSON.stringify(Array.isArray(doc) ? items : { ...doc, items }, null, 2);
  if (eol === '\r\n') out = out.replace(/\n/g, '\r\n');
  writeFileSync(outPath, out + eol);

  log(`== strip done | تم التنظيف ==`);
  log(`in: ${inPath} → out: ${outPath}`);
  log(`items stripped: ${strippedItems}/${items.length} · imageUrl removed: ${strippedUrls} · imageVariants removed: ${strippedVariants}`);
  const after = analyze(items);
  log(`remaining R2 keys: ${after.keys.size} · remaining photos: ${after.itemsWithAnyPhoto}`);
  if (after.keys.size !== 0 || after.itemsWithAnyPhoto !== 0) {
    err('WARNING: photos remain after strip — inspect the output file. | تحذير: ما زالت هناك صور بعد التنظيف');
    process.exit(1);
  }
}

// -------------------------------------------------------------- R2 helpers

function checkPrefixGuard(prefix) {
  const p = prefix || ALLOWED_PREFIX;
  if (p !== ALLOWED_PREFIX && !p.startsWith(ALLOWED_PREFIX)) {
    err(`Refusing prefix "${p}": only "${ALLOWED_PREFIX}" (or a sub-prefix of it) is allowed. | البادئة مرفوضة: فقط menu/ مسموح`);
    process.exit(2);
  }
  return p;
}

function resolveBucket(args) {
  return args.bucket || process.env.R2_BUCKET || DEFAULT_BUCKET;
}

function resolveAccount(args) {
  return args.account || process.env.CLOUDFLARE_ACCOUNT_ID || '';
}

async function r2ListRest(bucket, prefix, account, token) {
  const all = [];
  let cursor;
  for (;;) {
    const url = new URL(`${API_BASE}/accounts/${account}/r2/buckets/${bucket}/objects`);
    url.searchParams.set('prefix', prefix);
    url.searchParams.set('per_page', '1000');
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.success !== true || !Array.isArray(body.result)) {
      const msg = (body && body.errors && body.errors[0] && body.errors[0].message) || `HTTP ${res.status}`;
      err(`R2 list failed: ${msg} | فشل سرد الملفات`);
      process.exit(1);
    }
    for (const obj of body.result) {
      if (obj && typeof obj.key === 'string') all.push(obj);
    }
    const info = body.result_info || {};
    if (info.is_truncated && info.cursor) cursor = info.cursor;
    else break;
  }
  return all;
}

async function runR2List(args) {
  const prefix = checkPrefixGuard(args.prefix);
  const bucket = resolveBucket(args);
  const account = resolveAccount(args);
  const token = process.env.CLOUDFLARE_API_TOKEN || '';
  if (!account || !token) {
    err(`Missing credentials for R2 list. Set:
  export CLOUDFLARE_ACCOUNT_ID=<account-id>   (or pass --account=...)
  export CLOUDFLARE_API_TOKEN=<token with R2 read permission>
| بيانات الاعتماد ناقصة — اضبط المتغيرين أعلاه ثم أعد المحاولة`);
    process.exit(2);
  }
  log(`listing R2 objects: bucket=${bucket} prefix=${prefix} (read-only) | سرد ملفات R2 (قراءة فقط)…`);
  const objects = await r2ListRest(bucket, prefix, account, token);
  const keys = objects.map((o) => o.key).sort();
  const totalBytes = objects.reduce((n, o) => n + (Number(o.size) || 0), 0);
  log(`objects: ${objects.length} · approx size: ${(totalBytes / 1024).toFixed(1)} KB`);
  for (const o of objects.sort((a, b) => (a.key < b.key ? -1 : 1))) {
    log(`  - ${o.key} (${o.size || 0} bytes, ${o.last_modified || 'unknown date'})`);
  }
  if (args.out) {
    writeFileSync(args.out, JSON.stringify(keys, null, 2) + '\n');
    log(`key list saved to ${args.out} — feed it to --r2-delete via --keys-file | حُفظت القائمة، استخدمها مع --keys-file`);
  } else {
    log(`tip: re-run with --out=r2-keys.json to save this list for --r2-delete --keys-file`);
  }
}

function loadKeysForDelete(args) {
  let keys = [...(args.keys || [])];
  if (args['keys-file']) {
    if (!existsSync(args['keys-file'])) {
      err(`keys file not found: ${args['keys-file']} | ملف المفاتيح غير موجود`);
      process.exit(1);
    }
    const parsed = JSON.parse(readFileSync(args['keys-file'], 'utf8'));
    const arr = Array.isArray(parsed) ? parsed : parsed.keys;
    if (!Array.isArray(arr)) {
      err(`keys file must be a JSON array (or {"keys": [...]}) | صيغة ملف المفاتيح غير صالحة`);
      process.exit(2);
    }
    keys = keys.concat(arr);
  }
  keys = [...new Set(keys.filter((k) => typeof k === 'string' && k))];
  if (keys.length === 0) {
    err('No keys given. Pass --key=<k> (repeatable) or --keys-file=<json>. | لم تُعطَ أي مفاتيح');
    process.exit(2);
  }
  const prefix = checkPrefixGuard(args.prefix);
  for (const k of keys) {
    if (!k.startsWith(prefix)) {
      err(`Refusing key outside prefix "${prefix}": ${k} | مفتاح مرفوض خارج البادئة المسموحة`);
      process.exit(2);
    }
    if (!IMAGE_KEY_RE.test(k)) {
      err(`WARNING: key does not match the strict menu/<YYYY>/<MM>/<uuid>.<ext> shape (old pipeline?): ${k} | تحذير: شكل غير قياسي`);
    }
  }
  return { keys: keys.sort(), prefix };
}

function runR2Delete(args) {
  const bucket = resolveBucket(args);
  const { keys, prefix } = loadKeysForDelete(args);
  const local = process.env.R2_LOCAL === '1';
  const scope = local ? '--local (miniflare)' : '--remote (PRODUCTION)';

  if (!args.confirm) {
    log(`== r2-delete DRY-RUN — nothing deleted | تجربة جافة: لم يُحذف شيء ==`);
    log(`bucket=${bucket} prefix=${prefix} scope=${scope} · objects that WOULD be deleted: ${keys.length}`);
    for (const k of keys) log(`  - ${bucket}/${k}`);
    log(`to really delete: repeat the same command with --confirm | للحذف الفعلي أعد نفس الأمر مع --confirm`);
    return;
  }

  // Backup: snapshot the doomed key list before touching R2.
  const ts = timestamp();
  const snapshotPath = join(process.cwd(), `menu-backup-r2-${ts}.json`);
  writeFileSync(snapshotPath, JSON.stringify({ bucket, prefix, scope, deletedAt: new Date().toISOString(), keys }, null, 2) + '\n');
  log(`snapshot of keys to delete: ${snapshotPath} | حُفظت قائمة المفاتيح قبل الحذف`);

  const check = spawnSync('npx', ['wrangler', '--version'], { encoding: 'utf8' });
  if (check.status !== 0) {
    err('wrangler is not available (npx wrangler --version failed). Log in first: `npx wrangler login`. | wrangler غير متوفر');
    process.exit(1);
  }

  let okCount = 0;
  const failed = [];
  for (const k of keys) {
    log(`deleting ${bucket}/${k} ${scope} …`);
    const r = spawnSync('npx', ['wrangler', 'r2', 'object', 'delete', `${bucket}/${k}`, local ? '--local' : '--remote'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (r.status === 0) { okCount += 1; }
    else {
      failed.push(k);
      err(`FAILED ${k}: ${(r.stderr || r.stdout || 'unknown error').trim().split('\n').pop()}`);
    }
  }
  log(`== r2-delete done: ${okCount}/${keys.length} deleted | اكتمل الحذف ==`);
  if (failed.length > 0) {
    err(`failed keys (${failed.length}):`);
    for (const k of failed) err(`  - ${k}`);
    process.exit(1);
  }
}

// ------------------------------------------------------------------ main

const parsed = parseArgs(process.argv.slice(2));
if (parsed.help) usage(0);

const actions = [parsed.strip ? 1 : 0, parsed.r2list ? 1 : 0, parsed.r2delete ? 1 : 0].reduce((a, b) => a + b, 0);
if (actions > 1) {
  err('Pick ONE mode: default report, --strip, --r2-list, or --r2-delete. | اختر وضعاً واحداً فقط');
  process.exit(2);
}

if (parsed.strip) {
  runStrip(parsed);
} else if (parsed.r2list) {
  await runR2List(parsed);
} else if (parsed.r2delete) {
  runR2Delete(parsed);
} else {
  const source = parsed.source || DEFAULT_SOURCE;
  const { items } = loadMenuDoc(source);
  const bytes = statSync(source).size;
  printReport(source, bytes, analyze(items));
}
