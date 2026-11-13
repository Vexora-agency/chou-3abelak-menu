/**
 * Better Auth catch-all: /api/auth/*
 *
 * Cloudflare Pages route specificity keeps the three existing admin files
 * (login.js, logout.js, session.js) ahead of this catch-all. Everything
 * else — sign-up/email, sign-in/email, get-session, sign-out, callback/*,
 * update-user, … — is handled by Better Auth.
 *
 * The instance is created per request so `env.ORDERS_DB` and secrets are
 * available. Auth responses are never cacheable.
 */

import { createAuth } from '../../_shared/auth.js';
import { jsonNoStore } from '../../_shared/session.js';

export async function onRequest(context) {
  const { request, env } = context;

  try {
    const auth = createAuth(env, request, context.waitUntil);
    const response = await auth.handler(request);

    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    // Name/variable only: never log headers, cookies, bodies or secret values.
    console.error('[auth] handler unavailable', {
      name: error?.name || 'Error',
      variable: error?.variable || null,
    });
    return jsonNoStore({ error: 'auth_unavailable', message: 'Authentication is temporarily unavailable' }, 503);
  }
}
