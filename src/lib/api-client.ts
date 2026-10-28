import { readJson } from '@/src/utils/safeJson';
import { setServerOffsetFromDateHeader } from '@/src/utils/serverTime';

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`API error: ${status}`);
    this.status = status;
    this.body = body;
  }
}

/**
 * SINGLE fetch wrapper — ALL new features must use this or adminFetch/publicGet (skill §3.3).
 * Public API for ADD_NEW_FEATURE (docs/ADD_NEW_FEATURE.md): fail-loud JSON GET/PUT/DELETE.
 * Existing hooks use adminFetch/publicGet (fail-soft polling); this stays for new code so we
 * don't force-migrate stable polling paths. Not dead code — documented entry point.
 */
export async function apiFetch<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin', ...(init || {}) });
  setServerOffsetFromDateHeader(res.headers.get('Date'));
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await readJson(res);
    } catch {
      body = null;
    }
    throw new ApiError(res.status, body);
  }
  return (await readJson(res)) as T;
}

/** Shared admin transport signature (avoids duplicating the inline type in every hook). */
export type AdminFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Admin/auth transport: same as before (session cookie + X-Requested-With). */
export function adminFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    credentials: 'same-origin',
    ...(init || {}),
    headers: { 'X-Requested-With': 'menu-admin', ...((init && init.headers) || {}) },
  });
}

/** Public GET with optional AbortSignal + fail-null (for ordering-state style polling). */
export async function publicGet<T = unknown>(url: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(url, signal ? { signal } : undefined).catch(() => null);
    if (!res || !res.ok) return null;
    setServerOffsetFromDateHeader(res.headers.get('Date'));
    return (await readJson(res)) as T;
  } catch {
    return null;
  }
}

/**
 * Public POST returning the raw Response (for callers needing status branches,
 * e.g. the 403 availability gate). Same-origin credentials, JSON body, timeout.
 * Raw fetch lives ONLY here — services call this, never fetch() directly.
 */
export async function publicPostRaw(url: string, body: unknown, timeoutMs = 4000): Promise<Response | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
      signal: controller.signal,
    }).catch(() => null);
  } finally {
    window.clearTimeout(timer);
  }
}
