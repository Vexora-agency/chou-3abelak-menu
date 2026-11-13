import { useEffect, useState } from 'react';

let cachedGoogle: boolean | null = null;

async function loadProviders(): Promise<boolean> {
  if (cachedGoogle !== null) return cachedGoogle;
  try {
    const res = await fetch('/api/auth/public-config', {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return false;
    const data: unknown = await res.json();
    const google = !!data && typeof data === 'object' && (data as { google?: unknown }).google === true;
    cachedGoogle = google;
    return google;
  } catch {
    return false;
  }
}

/** Public capability flags for the auth sheet (Google hidden until configured). */
export function useAuthProviders(enabled: boolean) {
  const [google, setGoogle] = useState(cachedGoogle === true);
  const [loading, setLoading] = useState(cachedGoogle === null);

  useEffect(() => {
    if (!enabled) return;
    if (cachedGoogle !== null) {
      setGoogle(cachedGoogle);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    void (async () => {
      const value = await loadProviders();
      if (!alive) return;
      setGoogle(value);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [enabled]);

  return { google, loading };
}
