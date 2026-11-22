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
  /** Which channel produced this request. */
  method?: 'whatsapp' | 'sms';
  createdAt: string;
  expiresAt: string;
}

export interface PhoneVerificationStatus {
  verified: boolean;
  verifiedUntil: string | null;
  pending: PendingPhoneVerification | null;
  /** True when another member already owns this number. */
  linkedToOtherAccount?: boolean;
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
  /** Top-level channel for the request. */
  method?: 'whatsapp' | 'sms';
  /** SMS fallback returns the pending row without a code. */
  pending?: PendingPhoneVerification;
  verification?: {
    phone: string;
    reference: string;
    code: string;
    method?: 'whatsapp';
    createdAt: string;
    expiresAt: string;
    message: string;
    whatsappUrl: string | null;
  };
}

export async function requestPhoneVerification(
  phone: string,
  lang: 'en' | 'ar',
  method: 'whatsapp' | 'sms' = 'whatsapp',
): Promise<RequestedPhoneVerification> {
  return apiFetch<RequestedPhoneVerification>('/api/account/phone-verification', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, lang, method }),
  });
}

/** Submit the code the member received by SMS (UniMTX fallback). */
export async function verifyPhoneSms(
  phone: string,
  code: string,
): Promise<{ ok: true; verified: boolean; verifiedUntil?: string | null }> {
  return apiFetch('/api/account/phone-verification', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'verify', phone, code }),
  });
}
