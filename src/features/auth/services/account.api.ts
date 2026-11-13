import { apiFetch } from '@/src/lib/api-client';
import type { AccountOrder, CustomerProfile, CustomerUser } from '../types';

/** All customer-account API calls use the customer CSRF header, never admin. */
const headers = { 'X-Requested-With': 'menu-customer' };

export interface ProfileResponse {
  user: CustomerUser;
  profile: CustomerProfile;
}

export async function fetchMyProfile(): Promise<ProfileResponse> {
  return apiFetch<ProfileResponse>('/api/account/profile', { headers });
}

export async function updateMyProfile(input: { phone: string; address: string }): Promise<{ profile: CustomerProfile }> {
  return apiFetch<{ profile: CustomerProfile }>('/api/account/profile', {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export interface MyOrdersResponse {
  orders: AccountOrder[];
  count: number;
  days: number;
}

export async function fetchMyOrders(days = 365, limit = 50): Promise<MyOrdersResponse> {
  return apiFetch<MyOrdersResponse>(`/api/account/orders?days=${days}&limit=${limit}`, { headers });
}

export async function fetchMyOrder(number: number): Promise<AccountOrder> {
  const data = await apiFetch<{ order: AccountOrder }>(`/api/account/orders/${number}`, { headers });
  return data.order;
}
