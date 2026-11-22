import { createAuthClient } from 'better-auth/react';

/**
 * Better Auth browser client.
 *
 * The server mounts at /api/auth on the current origin. Cookies are
 * HttpOnly/Secure/Lax; the client never stores tokens. Keeping the base URL
 * dynamic means the same build works on the apex, www and preview hosts.
 *
 * `basePath` is spelled out instead of relying on the library default so the
 * mount point is explicit in this file. It is the same path the server uses.
 */
const baseURL = typeof window !== 'undefined' ? window.location.origin : undefined;

export const authClient = createAuthClient(
  baseURL
    ? {
        baseURL,
        basePath: '/api/auth',
        fetchOptions: { credentials: 'same-origin' },
      }
    : {
        basePath: '/api/auth',
        fetchOptions: { credentials: 'same-origin' },
      }
);
