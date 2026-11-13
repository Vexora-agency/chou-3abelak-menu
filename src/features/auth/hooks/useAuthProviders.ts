import { useEffect, useState } from 'react';

interface AuthProviders {
  google: boolean;
  requireEmailVerification: boolean;
}

const DEFAULT: AuthProviders = { google: false, requireEmailVerification: true };
let cached: AuthProviders | null = null;

async function loadProviders(): Promise<AuthProviders> {
  if (cached) return cached;
  try {
    const res = await fetch('/api/auth/public-config', {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return DEFAULT;
    const data: unknown = await res.json();
    const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
    const value: AuthProviders = {
      google: record.google === true,
      requireEmailVerification: record.requireEmailVerification !== false,
    };
    cached = value;
    return value;
  } catch {
    return DEFAULT;
  }
}

/** Public capability flags for the auth sheet. */
export function useAuthProviders(enabled: boolean) {
  const [providers, setProviders] = useState<AuthProviders>(cached || DEFAULT);
  const [loading, setLoading] = useState(cached === null);

  useEffect(() => {
    if (!enabled) return;
    if (cached) {
      setProviders(cached);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    void (async () => {
      const value = await loadProviders();
      if (!alive) return;
      setProviders(value);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [enabled]);

  return { ...providers, loading };
}
