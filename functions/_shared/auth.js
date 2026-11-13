/**
 * Better Auth factory for Cloudflare Pages Functions.
 *
 * The instance MUST be created per request: Pages bindings and secrets only
 * exist on the request `env`, never at module import time.
 *
 * Pinned to better-auth@1.7.23. Schema is generated from this exact config
 * (see docs/auth/02-plan.md §4.1) and committed as plain SQL under
 * migrations/. No adapter package is used: the native D1 binding is passed
 * directly.
 */

import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { buildAuthEmail, queueAuthEmail } from './auth-email.js';
import {
  authErrorMessage,
  validateAuthName,
  validateAuthPassword,
} from './validate-auth.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export class AuthConfigError extends Error {
  constructor(variable) {
    super(`${variable} is missing or invalid`);
    this.name = 'AuthConfigError';
    this.variable = variable;
  }
}

/** Google is enabled only when BOTH credentials are present and non-empty. */
export function isGoogleConfigured(env = {}) {
  const id = typeof env.GOOGLE_CLIENT_ID === 'string' ? env.GOOGLE_CLIENT_ID.trim() : '';
  const secret = typeof env.GOOGLE_CLIENT_SECRET === 'string' ? env.GOOGLE_CLIENT_SECRET.trim() : '';
  return !!(id && secret);
}

function fail(variable) {
  throw new AuthConfigError(variable);
}

function isLoopback(hostname) {
  return LOCAL_HOSTS.has(String(hostname || '').toLowerCase());
}

/** Parse a comma-separated exact-origin list. Wildcards and paths are rejected. */
export function parseTrustedOrigins(raw) {
  const out = [];
  const values = String(raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  for (const value of values) {
    if (value.includes('*')) fail('TRUSTED_ORIGINS');
    let url;
    try {
      url = new URL(value);
    } catch {
      fail('TRUSTED_ORIGINS');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') fail('TRUSTED_ORIGINS');
    if (url.username || url.password) fail('TRUSTED_ORIGINS');
    if (url.pathname !== '/' || url.search || url.hash) fail('TRUSTED_ORIGINS');
    const origin = url.origin;
    if (!out.includes(origin)) out.push(origin);
  }
  return out;
}

/**
 * Validate and normalize the auth env once per request.
 * Throws AuthConfigError naming the variable but never its value.
 */
export function resolveAuthConfig(env = {}) {
  const secret = typeof env.BETTER_AUTH_SECRET === 'string' ? env.BETTER_AUTH_SECRET.trim() : '';
  if (secret.length < 32) fail('BETTER_AUTH_SECRET');

  const rawURL = typeof env.BETTER_AUTH_URL === 'string' ? env.BETTER_AUTH_URL.trim() : '';
  if (!rawURL) fail('BETTER_AUTH_URL');

  let parsed;
  try {
    parsed = new URL(rawURL);
  } catch {
    fail('BETTER_AUTH_URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') fail('BETTER_AUTH_URL');
  if (parsed.username || parsed.password) fail('BETTER_AUTH_URL');
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) fail('BETTER_AUTH_URL');

  const baseURL = parsed.origin;
  const secureCookies = parsed.protocol === 'https:';
  const trustedOrigins = parseTrustedOrigins(env.TRUSTED_ORIGINS);

  if (!trustedOrigins.includes(baseURL)) trustedOrigins.unshift(baseURL);

  for (const origin of trustedOrigins) {
    const url = new URL(origin);
    if (url.protocol === 'http:' && !isLoopback(url.hostname)) {
      // Exact https origins in production; plain http only for localhost.
      fail('TRUSTED_ORIGINS');
    }
  }

  return { secret, baseURL, secureCookies, trustedOrigins };
}

function rateLimitRules() {
  return {
    '/sign-in/email': { window: 60, max: 10 },
    '/sign-up/email': { window: 60, max: 5 },
    '/request-password-reset': { window: 60, max: 3 },
    '/reset-password': { window: 60, max: 5 },
    '/send-verification-email': { window: 60, max: 3 },
    '/verify-email': { window: 60, max: 10 },
    '/sign-in/social': { window: 60, max: 10 },
    '/callback/*': { window: 60, max: 20 },
    '/get-session': false,
  };
}

function passwordHook() {
  return createAuthMiddleware(async (ctx) => {
    let password;
    let email;

    if (ctx.path === '/sign-up/email') {
      password = ctx.body?.password;
      email = ctx.body?.email;
    } else if (ctx.path === '/reset-password') {
      password = ctx.body?.newPassword;
    } else {
      return;
    }

    const result = validateAuthPassword(password, { email });
    if (!result.ok) {
      throw new APIError('BAD_REQUEST', {
        message: authErrorMessage(result.code),
        code: result.code,
      });
    }
  });
}

function userHooks() {
  const beforeWrite = async (data) => {
    if (!data || data.name === undefined) return { data };
    const result = validateAuthName(data.name);
    if (!result.ok) {
      throw new APIError('BAD_REQUEST', {
        message: authErrorMessage(result.code),
        code: result.code,
      });
    }
    return { data: { ...data, name: result.name } };
  };

  return {
    user: {
      create: { before: beforeWrite },
      update: { before: beforeWrite },
    },
  };
}

/**
 * @param {Record<string, unknown>} env Pages request env
 * @param {Request} [_request] reserved for future per-request logic
 * @param {(promise: Promise<unknown>) => void} [_waitUntil] reserved for Phase 5 email sends
 */
export function createAuth(env, _request, waitUntil) {
  const { secret, baseURL, secureCookies, trustedOrigins } = resolveAuthConfig(env);
  const requireEmailVerification = env.AUTH_REQUIRE_EMAIL_VERIFICATION !== '0';
  const socialProviders = isGoogleConfigured(env)
    ? {
        google: {
          clientId: String(env.GOOGLE_CLIENT_ID).trim(),
          clientSecret: String(env.GOOGLE_CLIENT_SECRET).trim(),
          // Google's provider already requests the minimal openid/email/profile
          // scopes. Do not append our own list: it would duplicate them.
          prompt: 'select_account',
        },
      }
    : {};

  return betterAuth({
    appName: 'Chou 3abelak',
    baseURL,
    basePath: '/api/auth',
    secret,
    trustedOrigins,
    database: env.ORDERS_DB,
    socialProviders,
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      autoSignIn: false,
      requireEmailVerification,
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        const mail = buildAuthEmail({ kind: 'reset', url, name: user?.name });
        queueAuthEmail(env, { to: user?.email, ...mail }, waitUntil);
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        const mail = buildAuthEmail({ kind: 'verify', url, name: user?.name });
        queueAuthEmail(env, { to: user?.email, ...mail }, waitUntil);
      },
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 3600,
    },
    session: {
      expiresIn: 604800, // 7 days
      updateAge: 86400, // refresh at most once per day
      cookieCache: { enabled: false },
    },
    account: {
      encryptOAuthTokens: true,
      storeStateStrategy: 'database',
    },
    verification: {
      storeIdentifier: 'hashed',
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 60,
      customRules: rateLimitRules(),
    },
    advanced: {
      useSecureCookies: secureCookies,
      cookiePrefix: 'chou',
      defaultCookieAttributes: {
        httpOnly: true,
        secure: secureCookies,
        sameSite: 'lax',
        path: '/',
      },
      ipAddress: {
        ipAddressHeaders: ['cf-connecting-ip'],
      },
      disableCSRFCheck: false,
      disableOriginCheck: false,
    },
    databaseHooks: userHooks(),
    hooks: {
      before: passwordHook(),
    },
    onAPIError: {
      onError: (error, ctx) => {
        // Never log headers, cookies, bodies, emails or tokens.
        const status = error?.statusCode ?? error?.status;
        const code = error?.body?.code;
        console.warn('[auth]', JSON.stringify({ path: ctx?.path || null, status: status || null, code: code || null }));
      },
    },
    logger: {
      level: 'warn',
    },
  });
}
