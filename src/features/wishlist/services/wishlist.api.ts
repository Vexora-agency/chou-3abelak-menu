import { apiFetch } from '@/src/lib/api-client';

/** All customer-account calls use the customer CSRF header, never admin. */
const headers = { 'X-Requested-With': 'menu-customer' };

export interface WishlistEntry {
  itemId: string;
  createdAt: string;
}

export interface WishlistResponse {
  ok: true;
  items: WishlistEntry[];
  count: number;
}

export async function fetchWishlist(): Promise<WishlistResponse> {
  return apiFetch<WishlistResponse>('/api/account/wishlist', { headers });
}

export async function addWishlistItem(itemId: string): Promise<WishlistResponse> {
  return apiFetch<WishlistResponse>('/api/account/wishlist', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId }),
  });
}

export async function removeWishlistItem(itemId: string): Promise<WishlistResponse> {
  return apiFetch<WishlistResponse>(
    `/api/account/wishlist?itemId=${encodeURIComponent(itemId)}`,
    { method: 'DELETE', headers },
  );
}
