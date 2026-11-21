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

export async function updateMyProfile(input: { phone: string; address: string; location?: { lat: number; lng: number; accuracy: number } | null }): Promise<{ profile: CustomerProfile }> {
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

export async function fetchMyOrders(days = 365, limit = 50, activeOnly = false): Promise<MyOrdersResponse> {
  return apiFetch<MyOrdersResponse>(
    `/api/account/orders?days=${days}&limit=${limit}${activeOnly ? '&active=1' : ''}`,
    { headers },
  );
}

export async function fetchMyOrder(number: number): Promise<AccountOrder> {
  const data = await apiFetch<{ order: AccountOrder }>(`/api/account/orders/${number}`, { headers });
  return data.order;
}

/* ---------- reverse WhatsApp phone verification ---------- */

export interface PendingPhoneVerification {
  phone: string;
  reference: string;
  createdAt: string;
  expiresAt: string;
}

export interface PhoneVerificationStatus {
  verified: boolean;
  verifiedUntil: string | null;
  pending: PendingPhoneVerification | null;
}

export async function fetchPhoneVerification(phone: string): Promise<PhoneVerificationStatus> {
  return apiFetch<PhoneVerificationStatus>(
    `/api/account/phone-verification?phone=${encodeURIComponent(phone)}`,
    { headers },
  );
}

export interface RequestedPhoneVerification {
  ok: true;
  verified: boolean;
  verifiedUntil?: string | null;
  verification?: {
    phone: string;
    reference: string;
    code: string;
    createdAt: string;
    expiresAt: string;
    message: string;
    whatsappUrl: string | null;
  };
}

export async function requestPhoneVerification(
  phone: string,
  lang: 'en' | 'ar',
): Promise<RequestedPhoneVerification> {
  return apiFetch<RequestedPhoneVerification>('/api/account/phone-verification', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, lang }),
  });
}
