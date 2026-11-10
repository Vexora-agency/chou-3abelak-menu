// Kitchen role (migration 0028): role claim + gates + invite/admin flows.
// Usage: node scripts/test-kitchen-role.mjs
// Real SQL via node:sqlite behind a minimal D1-shaped adapter — the actual
// migration files (0007 + 0008 + 0028) are applied, so CHECK constraints,
// defaults and backfills are tested for real. No network, no wrangler.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  ROLE_CLIENT,
  ROLE_KITCHEN,
  consumeInvite,
  findInviteByHash,
  getRole,
  inviteUsable,
  isMissingColumnError,
  isRole,
  newInviteToken,
  normalizeRole,
  requireKitchenOrOwner,
  requireOwner,
  roleFromPayload,
  sha256Hex,
} from '../functions/_shared/access.js';
import {
  createSessionToken,
  getSessionSecret,
  verifySessionToken,
} from '../functions/_shared/session.js';
import { onRequest as createInvite } from '../functions/api/admin/invites/create.js';
import { onRequest as listInvites } from '../functions/api/admin/invites/list.js';
import { onRequest as revokeInvite } from '../functions/api/admin/invites/revoke.js';
import { onRequest as updateClient } from '../functions/api/admin/clients/update.js';
import { onRequest as redeem } from '../functions/api/invite/redeem.js';
import { onRequest as validateInvite } from '../functions/api/invite/validate.js';
import { onRequest as login } from '../functions/api/auth/login.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const mig = (n) => readFileSync(join(ROOT, 'migrations', n), 'utf8');

let fails = 0;
const check = (name, cond) => {
  if (!cond) {
    fails++;
    console.error(`  FAIL ${name}`);
  } else {
    console.log(`  ok ${name}`);
  }
};

/* ---------- minimal D1-shaped adapter over node:sqlite ---------- */

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

function migratedDb() {
  const db = makeDb();
  db.exec(mig('0007_client_access.sql'));
  db.exec(mig('0008_client_user_status.sql'));
  db.exec(mig('0028_kitchen_role.sql'));
  return db;
}

function legacyDb() {
  const db = makeDb();
  db.exec(mig('0007_client_access.sql'));
  db.exec(mig('0008_client_user_status.sql'));
  return db;
}

function makeKv() {
  const store = new Map();
  return {
    get: async (k) => (store.has(k) ? store.get(k) : null),
    put: async (k, v) => { store.set(k, v); },
    delete: async (k) => { store.delete(k); },
  };
}

/* ---------- env + request helpers ---------- */

const secretBytes = crypto.getRandomValues(new Uint8Array(32));
let b64 = '';
for (let i = 0; i < secretBytes.length; i++) b64 += String.fromCharCode(secretBytes[i]);
const SESSION_SECRET = btoa(b64);
const secret = getSessionSecret({ SESSION_SECRET });
check('test secret decodes', !!secret);

const baseEnv = (db, kv) => ({
  SESSION_SECRET,
  SITE_URL: 'https://shop.example.com',
  ADMIN_USERNAME: 'masteradmin',
  ADMIN_PASSWORD_HASH: 'pbkdf2$50000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  ORDERS_DB: db,
  MENU_KV: kv,
});

const hdrs = (cookie) => ({
  'X-Requested-With': 'menu-admin',
  Origin: 'https://x',
  'Content-Type': 'application/json',
  ...(cookie ? { Cookie: cookie } : {}),
});

const call = (handler, method, path, { cookie, body, env }) =>
  handler(
    {
      request: new Request(`https://x${path}`, {
        method,
        headers: hdrs(cookie),
        ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
      }),
      env,
    },
  );

const cookieFor = (token) => `__Host-admin-session=${token}`;
const tokenFrom = (res) => {
  const set = res.headers.get('Set-Cookie') || '';
  const m = set.match(/__Host-admin-session=([^;]+)/);
  return m ? m[1] : null;
};
const ownerCookie = async (maxAge = 3600) =>
  cookieFor(await createSessionToken(secret, 'admin', maxAge));

/* ---------- 1. migration 0028 on real SQLite ---------- */
{
  const db = migratedDb();
  const cols = (t) =>
    db.prepare(`SELECT name, dflt_value AS d, [notnull] AS nn FROM pragma_table_info(?)`).bind(t).all();
  const inviteCols = (await cols('invites')).results;
  const userCols = (await cols('client_users')).results;
  check('0028 invites.role exists', inviteCols.some((c) => c.name === 'role'));
  check('0028 client_users.role exists', userCols.some((c) => c.name === 'role'));
  check('0028 invites.role defaults client', inviteCols.find((c) => c.name === 'role')?.d === "'client'");
  check('0028 client_users.role defaults client', userCols.find((c) => c.name === 'role')?.d === "'client'");

  // Backfill: pre-0028 rows read as client.
  db.exec(`INSERT INTO client_users (username, pass_hash, created_at) VALUES ('old', 'h', '2020-01-01T00:00:00.000Z')`);
  db.exec(`INSERT INTO invites (id, username, token_hash, created_at, expires_at, used_at, attempts)
           VALUES ('i1', 'old', '${'a'.repeat(64)}', '2020-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', NULL, 0)`);
  check(
    '0028 backfills client_users',
    (await db.prepare('SELECT role FROM client_users WHERE username = ?').bind('old').first())?.role === 'client'
  );
  check(
    '0028 backfills invites',
    (await db.prepare('SELECT role FROM invites WHERE id = ?').bind('i1').first())?.role === 'client'
  );

  // CHECK pins the value set on both tables.
  let badUser = false;
  try {
    await db.prepare(`INSERT INTO client_users (username, pass_hash, created_at, role) VALUES ('x','h','t','owner')`).run();
  } catch { badUser = true; }
  check('0028 CHECK rejects client_users role=owner', badUser);
  let badInvite = false;
  try {
    await db.prepare(`INSERT INTO invites (id, username, role, token_hash, created_at, expires_at, used_at, attempts)
                VALUES ('i2','x','admin','${'b'.repeat(64)}','t','2099-01-01T00:00:00.000Z',NULL,0)`).run();
  } catch { badInvite = true; }
  check('0028 CHECK rejects invites role=admin', badInvite);
  await db.prepare(`INSERT INTO client_users (username, pass_hash, created_at, role) VALUES ('k','h','t','kitchen')`).run();
  check(
    '0028 accepts kitchen',
    (await db.prepare('SELECT role FROM client_users WHERE username = ?').bind('k').first())?.role === 'kitchen'
  );
}

/* ---------- 2. role validators ---------- */
check('isRole client+kitchen', isRole('client') && isRole('kitchen'));
check('isRole rejects owner/admin/empty/garbage', !isRole('owner') && !isRole('admin') && !isRole('') && !isRole(null) && !isRole('CLIENT'));
check('normalizeRole defaults client', normalizeRole() === 'client' && normalizeRole('') === 'client');
check('normalizeRole trims+lowercases', normalizeRole(' Kitchen ') === 'kitchen');
check('normalizeRole never escalates', normalizeRole('owner') === 'client');
check('ROLE constants', ROLE_CLIENT === 'client' && ROLE_KITCHEN === 'kitchen');
check('roleFromPayload kitchen', roleFromPayload({ sub: 'client:k', role: 'kitchen' }) === 'kitchen');
check('roleFromPayload legacy is client', roleFromPayload({ sub: 'client:k' }) === 'client');
check('roleFromPayload garbage is client', roleFromPayload({ sub: 'client:k', role: 'owner' }) === 'client');
check('roleFromPayload owner', roleFromPayload({ sub: 'admin' }) === 'owner');
check('roleFromPayload null is client', roleFromPayload(null) === 'client');
check('isMissingColumnError', isMissingColumnError(new Error('D1_ERROR: no such column: role')) && isMissingColumnError(new Error('table invites has no column named role')) && !isMissingColumnError(new Error('boom')));

/* ---------- 3. session role claim round-trip ---------- */
{
  const t1 = await createSessionToken(secret, 'client:k1', 3600, { role: 'kitchen' });
  check('kitchen claim survives', (await verifySessionToken(secret, t1))?.role === 'kitchen');
  const t2 = await createSessionToken(secret, 'client:k2', 3600);
  check('legacy-shaped token has no claim', (await verifySessionToken(secret, t2))?.role === undefined);
  const t3 = await createSessionToken(secret, 'client:k3', 3600, { sub: 'admin', role: 'kitchen' });
  const p3 = await verifySessionToken(secret, t3);
  check('extras cannot override sub', p3?.sub === 'client:k3' && p3?.role === 'kitchen');
}

/* ---------- 4. gates: getRole + requireKitchenOrOwner ---------- */
{
  const db = migratedDb();
  await db.prepare('INSERT INTO client_users (username, pass_hash, created_at, role) VALUES (?,?,?,?)')
    .bind('kdb', 'h', new Date().toISOString(), 'kitchen').run();
  await db.prepare('INSERT INTO client_users (username, pass_hash, created_at, role) VALUES (?,?,?,?)')
    .bind('cdb', 'h', new Date().toISOString(), 'client').run();
  const env = baseEnv(db, makeKv());
  const req = (tok) => new Request('https://x/', { headers: tok ? { Cookie: cookieFor(tok) } : {} });

  const adminTok = await createSessionToken(secret, 'admin', 3600);
  check('getRole owner', (await getRole(req(adminTok), env)) === 'owner');
  check('requireKitchenOrOwner passes owner', !!(await requireKitchenOrOwner(req(adminTok), env)));
  check('requireOwner still passes owner', !!(await requireOwner(req(adminTok), env)));

  const kTok = await createSessionToken(secret, 'client:k1', 3600, { role: 'kitchen' });
  check('getRole kitchen claim', (await getRole(req(kTok), env)) === 'kitchen');
  check('kitchen gate passes', !!(await requireKitchenOrOwner(req(kTok), env)));
  check('requireOwner rejects kitchen', !(await requireOwner(req(kTok), env)));

  const cTok = await createSessionToken(secret, 'client:c1', 3600, { role: 'client' });
  check('getRole client claim', (await getRole(req(cTok), env)) === 'client');
  check('kitchen gate rejects client', !(await requireKitchenOrOwner(req(cTok), env)));

  // Legacy sessions (minted before 0028, no role claim): DB is the fallback,
  // unknown rows fail closed to client.
  const legacyKitchen = await createSessionToken(secret, 'client:kdb', 3600);
  check('legacy kitchen row reads kitchen', (await getRole(req(legacyKitchen), env)) === 'kitchen');
  check('legacy kitchen passes gate via DB', !!(await requireKitchenOrOwner(req(legacyKitchen), env)));
  const legacyClient = await createSessionToken(secret, 'client:cdb', 3600);
  check('legacy client row reads client', (await getRole(req(legacyClient), env)) === 'client');
  check('legacy client denied by gate', !(await requireKitchenOrOwner(req(legacyClient), env)));
  const legacyGhost = await createSessionToken(secret, 'client:ghost', 3600);
  check('legacy unknown user reads client', (await getRole(req(legacyGhost), env)) === 'client');
  check('legacy unknown user denied by gate', !(await requireKitchenOrOwner(req(legacyGhost), env)));

  check('anonymous has no role', (await getRole(req(null), env)) === null);
  check('anonymous denied by gate', !(await requireKitchenOrOwner(req(null), env)));
  check('garbage token denied', !(await requireKitchenOrOwner(req('nope'), env)));
}

/* ---------- 5. invites/create: role accepted, defaulted, validated ---------- */
{
  const db = migratedDb();
  const env = baseEnv(db, makeKv());
  const oc = await ownerCookie();
  const kitchenTok = await createSessionToken(secret, 'client:staff', 3600, { role: 'kitchen' });

  const bad = await call(createInvite, 'POST', '/api/admin/invites/create', {
    cookie: oc, body: { username: 'staff1', role: 'owner' }, env,
  });
  check('create rejects role=owner (400 bad_role)', bad.status === 400 && (await bad.json()).error === 'bad_role');
  const bad2 = await call(createInvite, 'POST', '/api/admin/invites/create', {
    cookie: oc, body: { username: 'staff2', role: 'admin' }, env,
  });
  check('create rejects role=admin', bad2.status === 400);

  const kc = await call(createInvite, 'POST', '/api/admin/invites/create', {
    cookie: oc, body: { username: 'chef1', role: 'kitchen' }, env,
  });
  const kBody = await kc.json();
  check('create kitchen ok + echoes role', kc.status === 200 && kBody.role === 'kitchen');
  check(
    'kitchen invite stored with role',
    (await db.prepare('SELECT role FROM invites WHERE username = ?').bind('chef1').first())?.role === 'kitchen'
  );

  const dc = await call(createInvite, 'POST', '/api/admin/invites/create', {
    cookie: oc, body: { username: 'reg1' }, env,
  });
  const dBody = await dc.json();
  check('create defaults to client', dc.status === 200 && dBody.role === 'client');

  const up = await call(createInvite, 'POST', '/api/admin/invites/create', {
    cookie: oc, body: { username: 'chef2', role: 'KITCHEN' }, env,
  });
  check('create normalizes case', up.status === 200 && (await up.json()).role === 'kitchen');

  const forbidden = await call(createInvite, 'POST', '/api/admin/invites/create', {
    cookie: cookieFor(kitchenTok), body: { username: 'staff9', role: 'kitchen' }, env,
  });
  check('create stays owner-only (kitchen 403)', forbidden.status === 403);

  // Pre-0028 database: default invites still mintable, kitchen fails closed.
  const ldb = legacyDb();
  const lenv = baseEnv(ldb, makeKv());
  const loc = await ownerCookie();
  const ldef = await call(createInvite, 'POST', '/api/admin/invites/create', {
    cookie: loc, body: { username: 'legacy1' }, env: lenv,
  });
  check('legacy DB still mints default invite', ldef.status === 200);
  const lkit = await call(createInvite, 'POST', '/api/admin/invites/create', {
    cookie: loc, body: { username: 'legacy2', role: 'kitchen' }, env: lenv,
  });
  check('legacy DB refuses kitchen invite (503)', lkit.status === 503);
}

/* ---------- 6. redeem: kitchen pairs passwordless w/ long session; client unchanged ---------- */
{
  const db = migratedDb();
  const env = baseEnv(db, makeKv());
  const { verifyPassword } = await import('../functions/_shared/session.js');
  const mkInvite = async (username, role) => {
    const token = newInviteToken();
    const now = new Date();
    await db.prepare(
      'INSERT INTO invites (id, username, role, token_hash, created_at, expires_at, used_at, attempts) VALUES (?, ?, ?, ?, ?, ?, NULL, 0)'
    )
      .bind(crypto.randomUUID(), username, role, await sha256Hex(token), now.toISOString(),
        new Date(now.getTime() + 72 * 3600 * 1000).toISOString())
      .run();
    return token;
  };

  // Kitchen: { token } only — no password sent at all.
  const kToken = await mkInvite('chef-redeem', 'kitchen');
  const r = await call(redeem, 'POST', '/api/invite/redeem', {
    body: { token: kToken }, env,
  });
  check('kitchen redeem token-only ok', r.status === 200 && (await r.json()).ok === true);
  const kRow = await db.prepare('SELECT role, pass_hash FROM client_users WHERE username = ?').bind('chef-redeem').first();
  check(
    'redeem persists kitchen role',
    kRow?.role === 'kitchen'
  );
  check(
    'kitchen pass_hash unusable (128 hex, never pbkdf2)',
    typeof kRow?.pass_hash === 'string' && /^[0-9a-f]{128}$/.test(kRow.pass_hash)
  );
  check('unusable hash never verifies', (await verifyPassword('abcdefgh1234', kRow.pass_hash)) === false);
  const sessionTok = tokenFrom(r);
  const payload = await verifySessionToken(secret, sessionTok);
  check('redeem session carries kitchen', payload?.sub === 'client:chef-redeem' && payload?.role === 'kitchen');
  check('kitchen session lasts 90 days', payload?.exp - payload?.iat === 90 * 24 * 3600);
  check(
    'kitchen cookie Max-Age 90 days',
    (r.headers.get('Set-Cookie') || '').includes(`Max-Age=${90 * 24 * 3600}`)
  );
  const gateReq = new Request('https://x/', { headers: { Cookie: cookieFor(sessionTok) } });
  check('redeemed kitchen passes gate', !!(await requireKitchenOrOwner(gateReq, env)));

  // Single-use preserved on the passwordless path.
  const replay = await call(redeem, 'POST', '/api/invite/redeem', { body: { token: kToken }, env });
  check('kitchen link single-use (replay 401)', replay.status === 401);

  // Re-pair: a second invite for the same device name updates the account.
  const kToken2 = await mkInvite('chef-redeem', 'kitchen');
  const rRe = await call(redeem, 'POST', '/api/invite/redeem', { body: { token: kToken2 }, env });
  check('kitchen re-pair ok (update path)', rRe.status === 200 && (await rRe.json()).ok === true);
  const kRow2 = await db.prepare('SELECT role, pass_hash FROM client_users WHERE username = ?').bind('chef-redeem').first();
  check(
    're-pair rotates hash, keeps kitchen',
    kRow2?.role === 'kitchen' && typeof kRow2?.pass_hash === 'string' && kRow2.pass_hash !== kRow.pass_hash
  );

  // Client path unchanged: password required, short session.
  const cToken = await mkInvite('reg-redeem', 'client');
  const r2 = await call(redeem, 'POST', '/api/invite/redeem', {
    body: { token: cToken, password: 'abcdefgh1234' }, env,
  });
  check('client redeem with password ok', r2.status === 200 && (await r2.json()).ok === true);
  const payload2 = await verifySessionToken(secret, tokenFrom(r2));
  check('client redeem session carries client', payload2?.role === 'client');
  check('client session stays 12h', payload2?.exp - payload2?.iat === 12 * 3600);
  const gateReq2 = new Request('https://x/', { headers: { Cookie: cookieFor(tokenFrom(r2)) } });
  check('redeemed client denied by gate', !(await requireKitchenOrOwner(gateReq2, env)));

  // Client without a password: same weak rejection as before.
  const cToken2 = await mkInvite('reg-nopass', 'client');
  const r3 = await call(redeem, 'POST', '/api/invite/redeem', { body: { token: cToken2 }, env });
  const r3Body = await r3.json();
  check('client redeem without password still 400 weak', r3.status === 400 && r3Body.error === 'weak');

  // validate exposes the role to the token holder; failures stay bare.
  const vToken = await mkInvite('chef-validate', 'kitchen');
  const v = await call(validateInvite, 'GET', `/api/invite/validate?token=${vToken}`, { env });
  const vBody = await v.json();
  check(
    'validate kitchen returns role',
    v.status === 200 && vBody.ok === true && vBody.username === 'chef-validate' && vBody.role === 'kitchen'
  );
  const vcToken = await mkInvite('reg-validate', 'client');
  const vcBody = await (await call(validateInvite, 'GET', `/api/invite/validate?token=${vcToken}`, { env })).json();
  check('validate client returns role', vcBody.ok === true && vcBody.role === 'client');
  const vbBody = await (
    await call(validateInvite, 'GET', `/api/invite/validate?token=${'z'.repeat(43)}`, { env })
  ).json();
  check('validate garbage stays bare', vbBody.ok === false && !('role' in vbBody));

  // findInviteByHash exposes the role; consumed rows stay single-use.
  const t3 = newInviteToken();
  await db.prepare(
    'INSERT INTO invites (id, username, role, token_hash, created_at, expires_at, used_at, attempts) VALUES (?, ?, ?, ?, ?, ?, NULL, 0)'
  )
    .bind('i3', 'once', 'kitchen', await sha256Hex(t3), new Date().toISOString(),
      new Date(Date.now() + 3600e3).toISOString())
    .run();
  const before = await findInviteByHash(db, await sha256Hex(t3));
  check('findInviteByHash exposes role', before?.role === 'kitchen');
  check('invite usable pre-redeem', inviteUsable(before, new Date().toISOString()));
  const c1 = await consumeInvite(db, await sha256Hex(t3), new Date().toISOString());
  const c2 = await consumeInvite(db, await sha256Hex(t3), new Date().toISOString());
  check('consume is single-use', !!c1 && c1.role === 'kitchen' && c2 === null);
}

/* ---------- 7. login: kitchen passwords rejected, client unchanged ---------- */
{
  const db = migratedDb();
  const kv = makeKv();
  const env = baseEnv(db, kv);
  const { hashClientPassword } = await import('../functions/_shared/access.js');
  const kHash = await hashClientPassword('kitchen-pass-1234');
  await db.prepare('INSERT INTO client_users (username, pass_hash, created_at, role) VALUES (?,?,?,?)')
    .bind('chef-login', kHash, new Date().toISOString(), 'kitchen').run();
  const cHash = await hashClientPassword('client-pass-1234');
  await db.prepare('INSERT INTO client_users (username, pass_hash, created_at, role) VALUES (?,?,?,?)')
    .bind('reg-login', cHash, new Date().toISOString(), 'client').run();

  // Even the CORRECT password never signs a kitchen account in.
  const kOk = await call(login, 'POST', '/api/auth/login', {
    body: { username: 'chef-login', password: 'kitchen-pass-1234' }, env,
  });
  const kOkBody = await kOk.json();
  check('kitchen password login rejected (403 kitchen_link_only)', kOk.status === 403 && kOkBody.error === 'kitchen_link_only');

  const kWrong = await call(login, 'POST', '/api/auth/login', {
    body: { username: 'chef-login', password: 'wrong-password-xyz' }, env,
  });
  check('kitchen wrong password also 403 (no oracle)', kWrong.status === 403 && (await kWrong.json()).error === 'kitchen_link_only');

  const cOk = await call(login, 'POST', '/api/auth/login', {
    body: { username: 'reg-login', password: 'client-pass-1234' }, env,
  });
  check('client login ok', cOk.status === 200);
  const lp = await verifySessionToken(secret, tokenFrom(cOk));
  check('client login session carries client', lp?.sub === 'client:reg-login' && lp?.role === 'client');

  const wrong = await call(login, 'POST', '/api/auth/login', {
    body: { username: 'reg-login', password: 'wrong-password-xyz' }, env,
  });
  check('client wrong password still 401', wrong.status === 401);

  await db.prepare('UPDATE client_users SET disabled_at = ? WHERE username = ?')
    .bind(new Date().toISOString(), 'reg-login').run();
  const dis = await call(login, 'POST', '/api/auth/login', {
    body: { username: 'reg-login', password: 'client-pass-1234' }, env,
  });
  check('disabled client login 401', dis.status === 401);
}

/* ---------- 8. list returns roles; update/revoke work for both roles ---------- */
{
  const db = migratedDb();
  const env = baseEnv(db, makeKv());
  await db.prepare(`INSERT INTO invites (id, username, role, token_hash, created_at, expires_at, used_at, attempts)
              VALUES ('li1','chef-list','kitchen','${'c'.repeat(64)}','2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z',NULL,0)`).run();
  await db.prepare(`INSERT INTO client_users (username, pass_hash, created_at, role) VALUES ('chef-list','h','2026-01-01T00:00:00.000Z','kitchen')`).run();
  await db.prepare(`INSERT INTO client_users (username, pass_hash, created_at, role) VALUES ('reg-list','h','2026-01-01T00:00:00.000Z','client')`).run();
  const oc = await ownerCookie();

  const l = await call(listInvites, 'GET', '/api/admin/invites/list', { cookie: oc, env });
  const lb = await l.json();
  check('list ok', l.status === 200 && lb.ok === true);
  check('list invite carries kitchen', (lb.invites || []).find((i) => i.id === 'li1')?.role === 'kitchen');
  check('list account carries kitchen', (lb.clients || []).find((c) => c.username === 'chef-list')?.role === 'kitchen');
  check('list account carries client', (lb.clients || []).find((c) => c.username === 'reg-list')?.role === 'client');
  check('list never leaks hashes', JSON.stringify(lb).includes('token_hash') === false);

  const kitchenTok = await createSessionToken(secret, 'client:chef-list', 3600, { role: 'kitchen' });
  const denied = await call(listInvites, 'GET', '/api/admin/invites/list', { cookie: cookieFor(kitchenTok), env });
  check('list stays owner-only (kitchen 403)', denied.status === 403);

  // update: disable/enable/delete a kitchen account (owner-only).
  const dis = await call(updateClient, 'POST', '/api/admin/clients/update', {
    cookie: oc, body: { username: 'chef-list', action: 'disable' }, env,
  });
  const disB = await dis.json();
  check('update disables kitchen account', dis.status === 200 && disB.disabled === true && disB.role === 'kitchen');
  const ena = await call(updateClient, 'POST', '/api/admin/clients/update', {
    cookie: oc, body: { username: 'chef-list', action: 'enable' }, env,
  });
  check('update enables kitchen account', ena.status === 200 && (await ena.json()).disabled === false);
  const updDenied = await call(updateClient, 'POST', '/api/admin/clients/update', {
    cookie: cookieFor(kitchenTok), body: { username: 'reg-list', action: 'disable' }, env,
  });
  check('update stays owner-only (kitchen 403)', updDenied.status === 403);
  const del = await call(updateClient, 'POST', '/api/admin/clients/update', {
    cookie: oc, body: { username: 'chef-list', action: 'delete' }, env,
  });
  const delB = await del.json();
  check('update deletes kitchen account', del.status === 200 && delB.deleted === true);
  check('deleted kitchen row gone', (await db.prepare('SELECT username FROM client_users WHERE username = ?').bind('chef-list').first()) === null);

  // revoke: deletes a kitchen invite by id (role-agnostic, owner-only).
  const rev = await call(revokeInvite, 'POST', '/api/admin/invites/revoke', {
    cookie: oc, body: { id: 'li1' }, env,
  });
  check('revoke removes kitchen invite', rev.status === 200 && (await db.prepare('SELECT id FROM invites WHERE id = ?').bind('li1').first()) === null);
  const revDenied = await call(revokeInvite, 'POST', '/api/admin/invites/revoke', {
    cookie: cookieFor(kitchenTok), body: { id: 'li1' }, env,
  });
  check('revoke stays owner-only (kitchen 403)', revDenied.status === 403);
}

/* ---------- 9. legacy DB end-to-end: everything degrades to client ---------- */
{
  const db = legacyDb();
  const env = baseEnv(db, makeKv());
  const oc = await ownerCookie();
  const l = await call(listInvites, 'GET', '/api/admin/invites/list', { cookie: oc, env });
  const lb = await l.json();
  check('legacy list ok, roles backfilled', l.status === 200 && (lb.invites || []).every((i) => i.role === 'client'));
}

if (fails) {
  console.error(`test-kitchen-role: ${fails} FAILURES`);
  process.exit(1);
}
console.log('test-kitchen-role: all green');
