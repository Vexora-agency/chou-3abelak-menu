import { useCallback, useRef } from 'react';
import { adminFetch as sharedAdminFetch } from '@/src/lib/api-client';

/** Shared admin transport: session-cookie fetch + autosave pause flag (single api-client). */
export function useAdminApi() {
  // Admin authed-fetch (session cookie). Stable identity for effects below.
  const adminFetch = useCallback(async (url: string, init?: RequestInit) => {
    return sharedAdminFetch(url, init);
  }, []);

  // Auto-save stays paused during restore/import/trash refreshes so they never race.
  const savePaused = useRef(false);

  return { adminFetch, savePaused };
}
