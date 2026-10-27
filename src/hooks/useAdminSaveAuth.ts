import { useState, useEffect } from 'react';
import { isRecord, readJson } from '@/src/utils/safeJson';
import type { LoginResult } from '@/src/components/AdminLogin';

export function useAdminSaveAuth() {
  // Admin view toggle. The admin entry points are hidden from customers:
  // the owner opens the site with #admin at the end of the address.
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(() => window.location.hash === '#admin');
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
        const res = await fetch('/api/auth/session', {
          headers: { 'X-Requested-With': 'menu-admin' },
          credentials: 'same-origin',
        });
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
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'menu-admin' },
        credentials: 'same-origin',
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
      return { ok: false, error: 'network' };
    } catch {
      return { ok: false, error: 'network' };
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'X-Requested-With': 'menu-admin' },
        credentials: 'same-origin',
      });
    } catch {}
    setAuthStatus('guest');
    closeAdmin();
  };

  useEffect(() => {
    const syncAdminHash = () => {
      const unlocked = window.location.hash === '#admin';
      setAdminUnlocked(unlocked);
      if (unlocked) setShowAdmin(true);
    };
    syncAdminHash();
    window.addEventListener('hashchange', syncAdminHash);
    return () => window.removeEventListener('hashchange', syncAdminHash);
  }, []);

  const closeAdmin = () => {
    setShowAdmin(false);
    setAdminUnlocked(false);
    if (window.location.hash === '#admin') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  };

  return {
    showAdmin,
    setShowAdmin,
    adminUnlocked,
    authStatus,
    setAuthStatus,
    handleLoginSubmit,
    handleLogout,
    closeAdmin,
  };
}
