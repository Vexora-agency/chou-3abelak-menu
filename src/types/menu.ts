export type OrderType = 'delivery' | 'pickup' | 'dinein';

export interface MenuItem {
  id: string;
  categoryId: string;
  name: { en: string; ar: string };
  description: { en: string; ar: string };
  price: number;
  badges: ('new' | 'spicy' | 'top')[];
  featured: boolean;
  available: boolean;
}

export interface Category {
  id: string;
  name: { en: string; ar: string };
  visible: boolean;
}

export interface MenuSettings {
  name: { en: string; ar: string };
  tagline: { en: string; ar: string };
  logoText: string;
  phone: string;
  whatsapp: string;
  mapUrl: string;
  address: { en: string; ar: string };
  hoursText: { en: string; ar: string };
  statusMode: 'auto' | 'open' | 'closed';
  openTime: string;
  closeTime: string;
  timezone: string;
  social: {
    instagram?: string;
    facebook?: string;
    tiktok?: string;
  };
  currency: { en: string; ar: string };
  ordering: {
    enabled: boolean;
    types: OrderType[];
    minOrder: number;
    deliveryFee: number;
    note: { en: string; ar: string };
  };
}

export interface MenuData {
  version: number;
  updatedAt: string;
  settings: MenuSettings;
  categories: Category[];
  items: MenuItem[];
}

export interface CartItem {
  id: string;
  quantity: number;
}

export interface CustomerDetails {
  name: string;
  phone: string;
  address: string;
  tableNumber: string;
  notes: string;
  orderType: OrderType;
  remember: boolean;
}
