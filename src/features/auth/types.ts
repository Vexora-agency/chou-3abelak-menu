export type Lang = 'en' | 'ar';

export type AccountStatus = 'new' | 'confirmed' | 'ready' | 'completed' | 'cancelled';

export interface CustomerUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  createdAt?: string | null;
}

export interface CustomerProfile {
  phone: string | null;
  address: string | null;
  updatedAt?: string | null;
}

export interface AccountOrderItem {
  id: string;
  name: { en: string; ar: string };
  variantName?: { en: string; ar: string };
  addonNames?: { en: string; ar: string }[];
  qty: number;
  unitPrice: number;
  unit?: string;
}

export interface AccountOrder {
  id: string;
  number: number;
  createdAt: string;
  status: AccountStatus;
  type: 'delivery' | 'pickup' | 'dinein';
  customer: { name: string; phone: string; address?: string; table?: string; email?: string };
  notes?: string;
  items: AccountOrderItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  location?: { lat: number; lng: number };
}
