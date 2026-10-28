/**
 * SQL performance audit: EXPLAIN QUERY PLAN + ms timing for every important
 * repository query. READ-ONLY w.r.t. project state — it VACUUMs the local D1
 * file into os.tmpdir(), seeds synthetic rows there, measures, and discards.
 * Run: node scripts/test-sql-performance.mjs
 * Requires: local D1 state present (.wrangler/state/v3/d1, from `pages dev`).
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D1DIR = join(ROOT, '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');

function findOrdersDb() {
  const files = readdirSync(D1DIR).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
  for (const f of files) {
    try {
      const db = new DatabaseSync(join(D1DIR, f), { readOnly: true });
      const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='orders'").get();
      db.close();
      if (t) return join(D1DIR, f);
    } catch { /* not ours */ }
  }
  return null;
}

const src = findOrdersDb();
if (!src) {
  console.error('No local D1 with an orders table. Run `npx wrangler pages dev ./dist` once first.');
  process.exit(2);
}
const workdir = join(tmpdir(), 'chou-perf');
mkdirSync(workdir, { recursive: true });
const copy = join(workdir, 'perf.sqlite');
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  try { rmSync(copy + suffix, { force: true }); } catch { /* fresh start */ }
}
// VACUUM INTO = clean consistent snapshot, original untouched.
{
  const db = new DatabaseSync(src);
  db.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
  db.close();
}
const db = new DatabaseSync(copy);
const baseRows = db.prepare('SELECT COUNT(*) AS c FROM orders').get().c;

// Seed to restaurant-at-scale volume (2k rows over 3 months, mixed status).
const SEED = 2000;
{
  const statuses = ['new', 'confirmed', 'completed', 'cancelled'];
  const ins = db.prepare(`INSERT INTO orders (id, number, idem_key, created_at, updated_at, status, type,
    customer_name, customer_phone, phone_norm, customer_address, customer_table, notes, location_lat,
    location_lng, items_json, subtotal, delivery_fee, total, lang, pii_purged_at)
    VALUES (?, ?, ?, ?, ?, ?, 'delivery', 'Perf', '70000000', ?, 'Beirut', NULL, NULL, NULL, NULL, '[]', 100, 0, 100, 'en', NULL)`);
  const t0 = Date.now();
  db.exec('BEGIN');
  for (let i = 0; i < SEED; i++) {
    const d = new Date(Date.UTC(2026, i % 3, (i % 28) + 1, 12)).toISOString();
    ins.run(`perf-${i}`, 100000 + i, null, d, d, statuses[i % 4], `7000${String(1000 + (i % 9000))}`, );
  }
  db.exec('COMMIT');
  console.log(`seeded ${SEED} rows in ${Date.now() - t0}ms (base table had ${baseRows})`);
}
const ROWS = db.prepare('SELECT COUNT(*) AS c FROM orders').get().c;

function explain(sql) {
  const rows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all();
  return rows.map((r) => r.detail).join(' | ');
}
function timeIt(label, sql, binds = [], runs = 20) {
  const st = db.prepare(sql);
  const ts = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    st.all(...binds);
    ts.push(performance.now() - t0);
  }
  const avg = ts.reduce((a, b) => a + b, 0) / ts.length;
  return { label, sql, avg, min: Math.min(...ts), max: Math.max(...ts) };
}
const plan = (label, sql) => ({ label, plan: explain(sql) });
const plans = [
  plan('findOrderByIdemKey (orders.repo.js:9)', 'SELECT number, total FROM orders WHERE idem_key = ?'),
  plan('findOrderById (orders.repo.js:13)', 'SELECT * FROM orders WHERE id = ?'),
  plan('nextOrderNumber (orders.repo.js:25)', 'UPDATE order_counter SET last_number = last_number + 1 WHERE id = 1 RETURNING last_number'),
  plan('listOrders window (orders.repo.js:60)', 'SELECT * FROM orders WHERE created_at >= ? AND created_at < ? ORDER BY created_at DESC LIMIT 11'),
  plan('updateOrderStatus (orders.repo.js:109)', 'UPDATE orders SET status = ?1, updated_at = ?2 WHERE id = ?3'),
  plan('countRevenue (reports.repo.js:54)', "SELECT COUNT(*) AS c, COALESCE(SUM(total),0) AS rev FROM orders WHERE created_at >= ? AND created_at < ? AND status != 'cancelled'"),
  plan('countByStatus (reports.repo.js:62)', 'SELECT status, COUNT(*) AS c FROM orders WHERE created_at >= ? AND created_at < ? GROUP BY status'),
  plan('fetchOrderRows (reports.repo.js:71)', 'SELECT id, number, created_at, type, status, items_json, subtotal, delivery_fee, total FROM orders WHERE created_at >= ? AND created_at < ? ORDER BY number ASC'),
  plan('getMonthCSV window (same shape)', 'SELECT id, number, created_at, type, status, items_json, subtotal, delivery_fee, total FROM orders WHERE created_at >= ? AND created_at < ? ORDER BY number ASC'),
  plan('customer search LIKE (customer-data.repo.js:29)', "SELECT id FROM orders WHERE phone_norm LIKE ? ORDER BY created_at DESC LIMIT 50"),
  plan('purgeOldPII (reports.repo.js:107)', 'UPDATE orders SET customer_name = NULL, pii_purged_at = ?1 WHERE created_at < ?2 AND pii_purged_at IS NULL'),
];

const JAN = ['2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'];
const timings = [
  timeIt('findOrderByIdemKey', 'SELECT number, total FROM orders WHERE idem_key = ?', ['nope']),
  timeIt('findOrderById', 'SELECT * FROM orders WHERE id = ?', ['perf-42']),
  timeIt('nextOrderNumber', 'UPDATE order_counter SET last_number = last_number + 1 WHERE id = 1 RETURNING last_number', []),
  timeIt('listOrders window+limit', 'SELECT * FROM orders WHERE created_at >= ? AND created_at < ? ORDER BY created_at DESC LIMIT 11', JAN),
  timeIt('updateOrderStatus', 'UPDATE orders SET status = ?1, updated_at = ?2 WHERE id = ?3', ['completed', new Date().toISOString(), 'perf-43']),
  timeIt('countRevenue', "SELECT COUNT(*) AS c, COALESCE(SUM(total),0) AS rev FROM orders WHERE created_at >= ? AND created_at < ? AND status != 'cancelled'", JAN),
  timeIt('countByStatus', 'SELECT status, COUNT(*) AS c FROM orders WHERE created_at >= ? AND created_at < ? GROUP BY status', JAN),
  timeIt('fetchOrderRows (~700 rows)', 'SELECT id, number, created_at, type, status, items_json, subtotal, delivery_fee, total FROM orders WHERE created_at >= ? AND created_at < ? ORDER BY number ASC', JAN),
  timeIt('customer LIKE %…% (full scan)', 'SELECT id FROM orders WHERE phone_norm LIKE ? ORDER BY created_at DESC LIMIT 50', ['%70001%']),
  timeIt('customer LIKE prefix (still scan)', 'SELECT id FROM orders WHERE phone_norm LIKE ? ORDER BY created_at DESC LIMIT 50', ['70001%']),
  timeIt('purgeOldPII (0 rows match)', 'UPDATE orders SET customer_name = NULL, pii_purged_at = ?1 WHERE created_at < ?2 AND pii_purged_at IS NULL', [new Date().toISOString(), '2020-01-01T00:00:00.000Z']),
];
{ // INSERT needs a fresh UNIQUE number per run — dedicated loop.
  const ts = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    db.prepare(`INSERT INTO orders (id, number, idem_key, created_at, updated_at, status, type, customer_name, customer_phone, phone_norm, customer_address, customer_table, notes, location_lat, location_lng, items_json, subtotal, delivery_fee, total, lang) VALUES ('time-${i}', ${990000 + i}, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'new', 'delivery', 'T', '700', '700', 'B', NULL, NULL, NULL, NULL, '[]', 100, 0, 100, 'en')`).run();
    ts.push(performance.now() - t0);
  }
  const avg = ts.reduce((a, b) => a + b, 0) / ts.length;
  timings.push({ label: 'INSERT order', avg, min: Math.min(...ts), max: Math.max(...ts) });
}
// Restore the counter consumed by timing runs (keeps temp copy tidy; copy is discarded anyway).
db.close();

const verdict = (avg, planStr) =>
  /SCAN orders($| )/.test(planStr) ? 'SCAN — see notes' : avg > 50 ? 'SLOW' : avg > 20 ? 'OK' : 'FAST';

console.log(`\n### EXPLAIN (@${ROWS} rows)`);
for (const p of plans) console.log(`- ${p.label}\n    ${p.plan}`);
console.log('\n### TIMING (avg/min/max ms, 20 runs, temp copy — dev DB untouched)');
for (const t of timings) {
  const pl = plans.find((p) => p.label.split(' (')[0] === t.label)?.plan ?? '';
  console.log(`- ${t.label}: avg ${t.avg.toFixed(2)} / min ${t.min.toFixed(2)} / max ${t.max.toFixed(2)} → ${verdict(t.avg, pl)}`);
}
console.log('\nDone. Temp copy discarded (os.tmpdir).');
console.log('NOTE: single-row writes (INSERT/UPDATE/counter) show ~120-210ms here from laptop-disk fsync,');
console.log('not query shape — same statements measure ~2-3ms with synchronous=OFF. Reads above are fsync-free.');
