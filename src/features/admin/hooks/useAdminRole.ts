import { useEffect, useState } from 'react';
import { adminFetch } from '@/src/lib/api-client';
import { isRecord } from '@/src/utils/safeJson';

export type AdminRole = 'owner' | 'kitchen' | 'client';

/**
 * Session role for the admin shell (UX routing only — real enforcement
 * stays in the per-route server gates). 'kitchen' = kitchen-role invite
 * session; 'client' = client invite session (full shell, exactly like the
 * owner minus owner-only areas); everything else/unknown = owner shell.
 * Fail-open to the full shell: an unreadable probe must never hide the
 * owner's own tabs, it only means the kitchen chrome stays off.
 */
export function useAdminRole() {
  const [role, setRole] = useState<AdminRole | null>(null);

  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const res = await adminFetch('/api/admin/whoami');
        if (!res.ok || stop) return;
        const data: unknown = await res.json().catch(() => null);
        if (stop || !isRecord(data)) return;
        if (data.role === 'kitchen') setRole('kitchen');
        else if (data.role === 'client') setRole('client');
        else if (data.role === 'owner') setRole('owner');
      } catch {
        // Fail-soft: unknown role renders the full owner shell.
      }
    })();
    return () => {
      stop = true;
    };
  }, []);

  return { role, isKitchen: role === 'kitchen' };
}
