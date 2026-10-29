import { useState, useEffect } from 'react';
import { isRecord, readJson } from '@/src/utils/safeJson';
import { adminFetch } from '@/src/lib/api-client';
import type { LoginResult } from '../components/AdminLogin';

export function useAdminSaveAuth() {
  // Admin view toggle. The admin lives at /admin[/tab] paths (served the
  // app shell via _redirects, no-store + noindex via _headers) — no #hash:
  // back/forward, refresh and emailed links all behave like normal pages.
  // Old #admin/... bookmarks are upgraded to paths once, on load.
  const isAdminPath = (p: string) => p === '/admin' || p.startsWith('/admin/');
  const isLegacyHash = (h: string) => h === '#admin' || h.startsWith('#admin/');
  const withQuery = (path: string) => path + window.location.search;
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(
    () => isAdminPath(window.location.pathname) || isLegacyHash(window.location.hash)
  );
  // Cookie-session auth state for the admin area
  const [authStatus, setAuthStatus] = useState<'checking' | 'authed' | 'guest'>('checking');

  useEffect(() => {
    let cancelled = false;
    const checkSession = async () => {      if (!adminUnlocked) {
        setAuthStatus('guest');
        return;
      }
      setAuthStatus('checking');
      try {
        const res = await adminFetch('/api/auth/session');
        // Require the exact shape, not just HTTP 200 (dev servers may
        // answer unknown /api routes with HTML and a 200 status).
        const data: unknown = await readJson(res);
        if (!cancelled) setAuthStatus(res.ok && isRecord(data) && data.authenticated === true ? 'authed' : 'guest');
      } catch {
        if (!cancelled) setAuthStatus('guest');
      }
    };
    void checkSession();
    return () => {
      cancelled = true;
    };
  }, [adminUnlocked]);
  const handleLoginSubmit = async (values: { username: string; password: string; remember: boolean }): Promise<LoginResult> => {
    try {
      const res = await adminFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values).slice(0, 4096),
      });
      if (res.ok) return { ok: true };
      if (res.status === 429) {
        let minutes = 10;
        try {
          const data: unknown = await readJson(res);
          if (isRecord(data) && typeof data.retryAfter === 'number' && data.retryAfter > 0) {
            minutes = Math.ceil(data.retryAfter);
          }
        } catch {}
        return { ok: false, error: 'locked', retryAfter: minutes };
      }
      if (res.status === 401) return { ok: false, error: 'invalid' };
      if (res.status === 503) return { ok: false, error: 'unavailable' };
      return { ok: false, error: 'network' };
    } catch {
      return { ok: false, error: 'network' };
    }
  };

  const handleLogout = async () => {
    try {
      await adminFetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    setAuthStatus('guest');
    closeAdmin();
  };

  useEffect(() => {
    // One-time upgrade: old #admin/... bookmarks and emailed links become
    // /admin/... paths (the fragment never reaches the server, so the
    // client performs the migration itself).
    const hm = /^#admin(?:\/([a-z]+))?$/.exec(window.location.hash);
    if (hm && !isAdminPath(window.location.pathname)) {
      window.history.replaceState(null, '', withQuery(`/admin${hm[1] ? `/${hm[1]}` : '/dashboard'}`));
    }
    const syncAdminRoute = () => {
      // Back/forward across the /admin boundary opens/closes the view.
      const unlocked = isAdminPath(window.location.pathname);
      setAdminUnlocked(unlocked);
      setShowAdmin(unlocked);
    };
    syncAdminRoute();
    window.addEventListener('popstate', syncAdminRoute);
    return () => window.removeEventListener('popstate', syncAdminRoute);
  }, []);

  const openAdmin = () => {
    setAdminUnlocked(true);
    setShowAdmin(true);
    if (!isAdminPath(window.location.pathname)) {
      window.history.pushState(null, '', withQuery('/admin/dashboard'));
    }
  };

  const closeAdmin = () => {
    setShowAdmin(false);
    setAdminUnlocked(false);
    if (isAdminPath(window.location.pathname)) {
      // Back to the storefront, keeping dev query flags (?dev-admin…).
      window.history.replaceState(null, '', '/' + window.location.search);
    }
  };

  return {
    showAdmin,
    setShowAdmin,
    openAdmin,
    adminUnlocked,
    authStatus,
    setAuthStatus,
    handleLoginSubmit,
    handleLogout,
    closeAdmin,
  };
}
