// updated_by attribution (migration 0029): kitchen/client PATCH stamps the
// login name, owner PATCH clears to NULL (Recent orders shows nothing extra),
// GET exposes it as an additive-only field.
// Run: node scripts/test-updated-by.mjs
// Real SQL via node:sqlite behind a minimal D1-shaped adapter; the actual
// 0001 + 0029 migration files are applied so the ALTER is tested for real.
// No network, no wrangler.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { mapOrderRow } from '../functions/_shared/orders.js';
import { updateOrderStatus } from '../functions/_shared/repositories/orders.repo.js';
import { createSessionToken } from '../functions/_shared/session.js';
import { onRequest as patchOrder } from '../functions/api/admin/orders/[id].js';
import { onRequest as listOrders } from '../functions/api/admin/orders.js';
import { createAsserts } from './_helpers/shared.mjs';

const { ok, summary } = createAsserts();
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const mig = (n) => readFileSync(join(ROOT, 'migrations', n), 'utf8');

/* ---------- D1-shaped adapter over node:sqlite ---------- */
function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  const wrap = (stmt, args) => ({
    first: async () => (stmt.get(...args) ?? null),
    all: async () => ({ results: stmt.all(...args) }),
    run: async () => {
      const r = stmt.run(...args);
      return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
  });
  return {
    prepare: (sql) => {
      const stmt = sqlite.prepare(sql);
      return {
        bind: (...args) => wrap(stmt, args),
        first: async () => (stmt.get() ?? null),
        all: async () => ({ results: stmt.all() }),
        run: async () => {
          const r = stmt.run();
          return { meta: { changes: Number(r.changes) } };
        },
      };
    },
    exec: (sql) => sqlite.exec(sql),
  };
}

const ORDERS_MIN = `CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  idem_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL,
  type TEXT NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  customer_address TEXT,
  customer_table TEXT,
  notes TEXT,
  items_json TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  delivery_fee INTEGER NOT NULL,
  total INTEGER NOT NULL,
  lang TEXT,
  track_token TEXT,
  confirmed_at TEXT,
  eta_at TEXT,
  parent_number INTEGER,
  updated_by TEXT
);`;

const seedOrder = (over = {}) => ({
  id: 'o1',
  number: 1001,
  created_at: new Date(Date.now() - 3600e3).toISOString(),
  updated_at: new Date(Date.now() - 3600e3).toISOString(),
  status: 'confirmed',
  type: 'delivery',
  customer_name: 'Ali',
  customer_phone: '70123456',
  items_json: '[]',
  subtotal: 100,
  delivery_fee: 0,
  total: 100,
  lang: 'ar',
  track_token: null,
  confirmed_at: null,
  eta_at: null,
  parent_number: null,
  updated_by: null,
  ...over,
});

function insertOrder(db, o) {
  const cols = Object.keys(o);
  const placeholders = cols.map((_, i) => `?${i + 1}`).join(',');
  return db
    .prepare(`INSERT INTO orders (${cols.join(', ')}) VALUES (${placeholders})`)
    .bind(...cols.map((c) => o[c]))
    .run();
}

/* ---------- 0. forbidden numbers stay absent (README precedent) ---------- */
{
  const files = readdirSync(join(ROOT, 'migrations'));
  ok(!files.some((f) => f.startsWith('0002')), 'no 0002 migration exists (gap is intentional)');
  ok(!files.some((f) => f.startsWith('0021')), 'no 0021 migration exists (gap is intentional)');
  ok(files.includes('0029_updated_by.sql'), '0029_updated_by.sql exists');
}

/* ---------- 1. migration 0029 applies on the real 0001 shape ---------- */
{
  const db = makeDb();
  db.exec(mig('0001_orders.sql'));
  db.exec(mig('0029_updated_by.sql'));
  const cols = await db.prepare('SELECT name, dflt_value AS d, [notnull] AS nn FROM pragma_table_info(?)').bind('orders').all();
  const col = cols.results.find((c) => c.name === 'updated_by');
  ok(!!col, '0029 adds updated_by column');
  ok(col && col.nn === 0, 'updated_by is nullable');
  ok(!col || col.d === null || col.d === undefined, 'updated_by has no sensitive default');
  // Legacy row keeps NULL.
  db.exec(
    `INSERT INTO orders (id, number, created_at, updated_at, status, type, customer_name, customer_phone, items_json, subtotal, delivery_fee, total)
     VALUES ('legacy-1', 9001, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', 'new', 'delivery', 'Legacy', '70000000', '[]', 10, 0, 10)`
  );
  const legacy = await db.prepare('SELECT updated_by FROM orders WHERE id = ?').bind('legacy-1').first();
  ok(legacy && legacy.updated_by === null, 'legacy row reads NULL (no backfill)');
}

/* ---------- 2. mapOrderRow exposes updatedBy ---------- */
{
  const stamped = mapOrderRow({ id: 'x', number: 1, created_at: 't', status: 'ready', type: 'delivery', items_json: '[]', subtotal: 1, delivery_fee: 0, total: 1, updated_by: 'chef1' });
  ok(stamped.updatedBy === 'chef1', 'stamped row maps the actor name');
  const cleared = mapOrderRow({ id: 'y', number: 2, created_at: 't', status: 'completed', type: 'pickup', items_json: '[]', subtotal: 1, delivery_fee: 0, total: 1, updated_by: null });
  ok(cleared.updatedBy === null, 'cleared row maps null (key always present)');
  ok('updatedBy' in cleared, 'updatedBy key always present (no shape shift)');
  const legacy = mapOrderRow({ id: 'z', number: 3, created_at: 't', status: 'new', type: 'delivery', items_json: '[]', subtotal: 1, delivery_fee: 0, total: 1 });
  ok(legacy.updatedBy === null, 'pre-0029 row (missing column) maps null, never throws');
}

/* ---------- 3. updateOrderStatus: SQL contract + set/clear/preserve ---------- */
{
  // Legacy callers (no updatedBy key) keep the exact historical UPDATE text.
  const seen = [];
  const mockDb = {
    row: { id: 'm1', number: 1, created_at: 't', updated_at: 't', status: 'confirmed', type: 'delivery', items_json: '[]', subtotal: 1, delivery_fee: 0, total: 1 },
    prepare(sql) {
      seen.push(sql);
      const self = this;
      return {
        bind(...args) {
          return {
            async first() { return { ...self.row }; },
            async all() { return { results: [] }; },
            async run() { return { meta: { changes: 1 } }; },
          };
        },
        async first() { return { ...self.row }; },
      };
    },
  };
  await updateOrderStatus(mockDb, 'm1', 'ready');
  ok(seen.some((s) => s === 'UPDATE orders SET status = ?1, updated_at = ?2 WHERE id = ?3'), 'legacy UPDATE text unchanged without actor');
  seen.length = 0;
  await updateOrderStatus(mockDb, 'm1', 'ready', { updatedBy: 'chef1' });
  ok(seen.some((s) => s.includes('updated_by')), 'actor UPDATE writes updated_by');
}

{
  // Real-SQL set / clear / preserve on a migrated table.
  const db = makeDb();
  db.exec(ORDERS_MIN);
  await insertOrder(db, seedOrder({ id: 'a1', number: 2001, status: 'confirmed', updated_by: null }));
  const out1 = await updateOrderStatus(db, 'a1', 'ready', { updatedBy: 'chef1' });
  ok(out1 && out1.updatedBy === 'chef1', 'kitchen actor stamps the name');
  ok((await db.prepare('SELECT updated_by FROM orders WHERE id = ?').bind('a1').first())?.updated_by === 'chef1', 'stamp persisted');

  const out2 = await updateOrderStatus(db, 'a1', 'completed', { updatedBy: null });
  ok(out2 && out2.updatedBy === null, 'owner actor clears to null');
  ok((await db.prepare('SELECT updated_by FROM orders WHERE id = ?').bind('a1').first())?.updated_by === null, 'clear persisted');

  await db.prepare('UPDATE orders SET updated_by = ?1 WHERE id = ?2').bind('chef1', 'a1').run();
  const out3 = await updateOrderStatus(db, 'a1', 'cancelled');
  ok(out3 && out3.updatedBy === 'chef1', 'legacy caller (no key) preserves the existing value');

  // Pre-0029 table: actor writes degrade, the status flip still lands.
  const oldDb = makeDb();
  oldDb.exec(mig('0001_orders.sql'));
  oldDb.exec(
    `INSERT INTO orders (id, number, created_at, updated_at, status, type, customer_name, customer_phone, items_json, subtotal, delivery_fee, total)
     VALUES ('old-1', 9101, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'confirmed', 'delivery', 'Old', '71111111', '[]', 10, 0, 10)`
  );
  const outOld = await updateOrderStatus(oldDb, 'old-1', 'completed', { updatedBy: 'chef1' });
  ok(outOld && outOld.status === 'completed' && outOld.updatedBy === null, 'unmigrated DB: status flips, actor reads null (fail open)');
}

/* ---------- 4. PATCH route: kitchen/client stamp, owner clears ---------- */
{
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  let b64 = '';
  for (let i = 0; i < secretBytes.length; i++) b64 += String.fromCharCode(secretBytes[i]);
  const SESSION_SECRET = btoa(b64);

  const db = makeDb();
  db.exec(ORDERS_MIN);
  await insertOrder(db, seedOrder({ id: 'o1', number: 1001, status: 'confirmed' }));
  const kv = { get: async () => null, put: async () => {}, delete: async () => {} };
  const env = { SESSION_SECRET, ORDERS_DB: db, MENU_KV: kv, SITE_PLAN: 'pro' };

  const kitchenTok = await createSessionToken(secretBytes, 'client:chef1', 3600, { role: 'kitchen' });
  const clientTok = await createSessionToken(secretBytes, 'client:layali', 3600, { role: 'client' });
  const ownerTok = await createSessionToken(secretBytes, 'admin', 3600);
  const cookieFor = (t) => `__Host-admin-session=${t}`;
  const patchReq = (tok, status) =>
    new Request('https://x/api/admin/orders/o1', {
      method: 'PATCH',
      headers: {
        Cookie: cookieFor(tok),
        'X-Requested-With': 'menu-admin',
        Origin: 'https://x',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status }),
    });

  const rKitchen = await patchOrder({ request: patchReq(kitchenTok, 'ready'), env, params: { id: 'o1' } });
  const bKitchen = await rKitchen.json().catch(() => null);
  ok(rKitchen.status === 200 && bKitchen && bKitchen.order && bKitchen.order.updatedBy === 'chef1', 'PATCH from kitchen stamps the username');
  ok((await db.prepare('SELECT updated_by FROM orders WHERE id = ?').bind('o1').first())?.updated_by === 'chef1', 'kitchen stamp persisted');

  const rClient = await patchOrder({ request: patchReq(clientTok, 'completed'), env, params: { id: 'o1' } });
  const bClient = await rClient.json().catch(() => null);
  ok(rClient.status === 200 && bClient && bClient.order && bClient.order.updatedBy === 'layali', 'PATCH from client stamps the username');

  const rOwner = await patchOrder({ request: patchReq(ownerTok, 'cancelled'), env, params: { id: 'o1' } });
  const bOwner = await rOwner.json().catch(() => null);
  ok(rOwner.status === 200 && bOwner && bOwner.order && bOwner.order.updatedBy === null, 'PATCH from owner clears to null');
  ok((await db.prepare('SELECT updated_by FROM orders WHERE id = ?').bind('o1').first())?.updated_by === null, 'owner clear persisted');

  // GET exposes the field (additive-only): re-stamp then list.
  await patchOrder({ request: patchReq(kitchenTok, 'ready'), env, params: { id: 'o1' } });
  const rGet = await listOrders({
    request: new Request('https://x/api/admin/orders?days=365&limit=100', { headers: { Cookie: cookieFor(kitchenTok) } }),
    env,
  });
  const bGet = await rGet.json().catch(() => null);
  const found = bGet && Array.isArray(bGet.orders) ? bGet.orders.find((o) => o && o.id === 'o1') : null;
  ok(rGet.status === 200 && found && found.updatedBy === 'chef1', 'GET orders exposes updatedBy');
}

summary();
