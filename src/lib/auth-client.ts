import { createAuthClient } from 'better-auth/react';

/**
 * Better Auth browser client.
 *
 * The server mounts at /api/auth on the current origin. Cookies are
 * HttpOnly/Secure/Lax; the client never stores tokens. Keeping the base URL
 * dynamic means the same build works on the apex, www and preview hosts.
 */
const baseURL = typeof window !== 'undefined' ? window.location.origin : undefined;

export const authClient = createAuthClient(
  baseURL
    ? {
        baseURL,
        fetchOptions: { credentials: 'same-origin' },
      }
    : {
        fetchOptions: { credentials: 'same-origin' },
      }
);
