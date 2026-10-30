/**
 * Admin WhatsApp Cloud API settings: GET status / POST save|token|test.
 * ADMIN SESSION REQUIRED (directory middleware). The token is write-only:
 * GET exposes hasToken + updatedAt, never the value. Non-secret config lives
 * in service_config (key 'wa-api'); the token in service_secrets
 * (key 'wa-api-token'). Nothing here ever reaches the public /api/menu.
 */
import { checkApiHeaders, jsonNoStore, readJsonBody } from '../../_shared/session.js';
import { featureOffResponse, hasFeature } from '../../_shared/plan.js';
import {
  WA_CONFIG_KEY,
  WA_TOKEN_KEY,
  sanitizeWaConfig,
  buildOwnerParams,
  sendTemplate,
} from '../../_shared/whatsapp-api.js';

const MAX_BODY_BYTES = 4 * 1024;
const TOKEN_RE = /^[A-Za-z0-9_\-.~+/=]{50,600}$/;

async function readConfig(db) {
  try {
    const row = await db
      .prepare('SELECT value FROM service_config WHERE key = ?1')
      .bind(WA_CONFIG_KEY)
      .first();
    if (row && typeof row.value === 'string') {
      const parsed = JSON.parse(row.value);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {}
  return {};
}

async function readTokenMeta(db) {
  try {
    const row = await db
      .prepare('SELECT created_at FROM service_secrets WHERE key = ?1')
      .bind(WA_TOKEN_KEY)
      .first();
    if (row) return { hasToken: true, updatedAt: row.created_at || null };
  } catch {}
  return { hasToken: false, updatedAt: null };
}

export async function onRequest(context) {
  const { request, env } = context;

  if (!hasFeature(env, 'orderLogging')) return featureOffResponse();
  const gate = checkApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error, message: gate.message }, gate.status);

  const db = env.ORDERS_DB || null;
  if (!db) {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }

  // Status (config + token presence, never the token).
  if (request.method === 'GET') {
    const stored = await readConfig(db);
    const { config } = sanitizeWaConfig(stored);
    const token = await readTokenMeta(db);
    return jsonNoStore({ ok: true, config, ...token });
  }

  if (request.method !== 'POST') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET, POST' });
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    return jsonNoStore({ error: 'bad_content_type' }, 400);
  }

  let body;
  try {
    body = await readJsonBody(request, MAX_BODY_BYTES);
  } catch {
    return jsonNoStore({ error: 'bad_body' }, 400);
  }
  const action = body && typeof body.action === 'string' ? body.action : '';

  // Save non-secret config (validated; enabled requires completeness).
  if (action === 'save') {
    const { config, errors } = sanitizeWaConfig(body.config || {});
    if (errors.length) {
      return jsonNoStore({ error: 'invalid_config', errors: errors.slice(0, 5) }, 400);
    }
    try {
      await db
        .prepare('INSERT OR REPLACE INTO service_config (key, value, updated_at) VALUES (?1, ?2, ?3)')
        .bind(WA_CONFIG_KEY, JSON.stringify(config), new Date().toISOString())
        .run();
    } catch {
      return jsonNoStore({ error: 'unavailable' }, 503);
    }
    return jsonNoStore({ ok: true, config });
  }

  // Store the token (write-only; validated shape, never echoed).
  if (action === 'token') {
    const token = body && typeof body.token === 'string' ? body.token.trim() : '';
    if (!TOKEN_RE.test(token)) {
      return jsonNoStore({ error: 'invalid_token' }, 400);
    }
    try {
      await db
        .prepare('INSERT OR REPLACE INTO service_secrets (key, secret, created_at) VALUES (?1, ?2, ?3)')
        .bind(WA_TOKEN_KEY, token, new Date().toISOString())
        .run();
    } catch {
      return jsonNoStore({ error: 'unavailable' }, 503);
    }
    return jsonNoStore({ ok: true, hasToken: true });
  }

  if (action === 'tokenClear') {
    try {
      await db.prepare('DELETE FROM service_secrets WHERE key = ?1').bind(WA_TOKEN_KEY).run();
    } catch {
      return jsonNoStore({ error: 'unavailable' }, 503);
    }
    return jsonNoStore({ ok: true, hasToken: false });
  }

  // Test send: ONE real template to the owner number (billed). Proves the
  // whole chain (token + number ID + template approval) before going live.
  if (action === 'test') {
    const stored = await readConfig(db);
    const { config, errors } = sanitizeWaConfig(stored);
    if (!config.enabled || errors.length || !config.phoneNumberId || !config.ownerRecipient || !config.ownerTemplate) {
      return jsonNoStore({ error: 'incomplete_config' }, 400);
    }
    let token = '';
    try {
      const row = await db
        .prepare('SELECT secret FROM service_secrets WHERE key = ?1')
        .bind(WA_TOKEN_KEY)
        .first();
      token = row && typeof row.secret === 'string' ? row.secret : '';
    } catch {
      return jsonNoStore({ error: 'unavailable' }, 503);
    }
    if (!token) {
      return jsonNoStore({ error: 'missing_token' }, 400);
    }
    const out = await sendTemplate({
      token,
      phoneNumberId: config.phoneNumberId,
      to: config.ownerRecipient,
      templateName: config.ownerTemplate,
      params: buildOwnerParams({
        number: 'TEST-0',
        items: [{ qty: 1, name: { ar: 'صنف تجريبي' }, id: 'test' }],
        total: 0,
        currency: '',
        name: 'Test',
        phone: '-',
      }),
    });
    if (!out.ok) {
      return jsonNoStore({ error: 'send_failed', detail: String(out.error || '').slice(0, 200) }, 502);
    }
    return jsonNoStore({ ok: true, id: out.id || null });
  }

  return jsonNoStore({ error: 'bad_action' }, 400);
}
