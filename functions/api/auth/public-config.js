/**
 * GET /api/auth/public-config
 *
 * Public, tiny capability probe for the auth UI. Today it only says whether
 * Google OAuth has both credentials configured, so the storefront never
 * renders a dead Google button. It never exposes the client id/secret.
 *
 * This is a more-specific static route than the Better Auth catch-all
 * (`[[all]].js`), so Pages routes it here first.
 */

import { isGoogleConfigured } from '../../_shared/auth.js';
import { jsonNoStore } from '../../_shared/session.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  }
  return jsonNoStore({
    google: isGoogleConfigured(env),
    requireEmailVerification: env.AUTH_REQUIRE_EMAIL_VERIFICATION !== '0',
  });
}
