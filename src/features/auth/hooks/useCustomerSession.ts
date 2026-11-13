import { authClient } from '@/src/lib/auth-client';
import type { CustomerUser } from '../types';

/** Shared Better Auth session state for the storefront header + account UI. */
export function useCustomerSession() {
  const { data, isPending, error, refetch } = authClient.useSession();
  const raw = data?.user;
  const user: CustomerUser | null = raw
    ? {
        id: raw.id,
        name: typeof raw.name === 'string' ? raw.name : '',
        email: typeof raw.email === 'string' ? raw.email : '',
        image: typeof raw.image === 'string' && raw.image ? raw.image : null,
        createdAt: raw.createdAt ? String(raw.createdAt) : null,
      }
    : null;
  return {
    user,
    session: data?.session ?? null,
    isPending,
    error,
    refetch,
  };
}
