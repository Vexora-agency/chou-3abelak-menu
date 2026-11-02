/* ---------- Types (the API should return exactly this shape) ---------- */
export type OrderStatus = 'new' | 'confirmed' | 'ready' | 'completed' | 'cancelled';
export type OrderType = 'delivery' | 'pickup' | 'dinein';

export interface OrderItem {
  id: string;
  /** Pricing unit id (absent on orders placed before units shipped). */
  unit?: string;
  name: { en: string; ar: string };
  variantId?: string;
  variantName?: { en: string; ar: string };
  addonIds?: string[];
  addonNames?: { en: string; ar: string }[];
  qty: number;
  unitPrice: number;
}

export interface Order {
  id: string;
  number: number;
  createdAt: string; // ISO date
  status: OrderStatus;
  type: OrderType;
  customer: { name: string; phone: string; address?: string; table?: string };
  location?: { lat: number; lng: number };
  notes?: string;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
}

export interface OrdersDashboardProps {
  lang: 'en' | 'ar';
  orders: Order[];
  currency: string;
  loading?: boolean;
  onStatusChange: (id: string, status: OrderStatus) => void;
  onRefresh?: () => void;
  /** Owner-picked kitchen chime id (one of the 5 library ids, unknown -> classic). */
  kitchenSound?: string | null;
}

export type Period = 'today' | '7d' | 'month' | 'lastMonth';

export const STR = {
  en: {
    today: 'Today', d7: '7 days', thisMonth: 'This month', lastMonth: 'Last month', refresh: 'Refresh', live: 'Live', liveTip: 'Auto-refresh on: new orders appear here by themselves', soundOn: 'New-order sound on', soundOff: 'New-order sound off',
    orders: 'Orders', revenue: 'Revenue', avg: 'Avg. order', pending: 'Awaiting you',
    vsPrev: 'vs previous', over: 'Orders over time', peak: 'Peak', ordersWord: 'orders',
    top: 'Top sellers', sold: 'sold',
    recent: 'Recent orders', all: 'All', showMore: 'Show more',
    new: 'New', confirmed: 'Preparing', ready: 'Ready', completed: 'Completed', cancelled: 'Cancelled',
    emptyTitle: 'No orders yet', emptyDesc: 'Orders placed from your menu will appear here instantly.',
    emptyView: 'No orders in this view.', noData: 'No data for this period.',
    itemsLabel: 'Items', phone: 'Phone', address: 'Address', table: 'Table', notes: 'Notes', openMaps: 'Open in Maps',
    subtotal: 'Subtotal', fee: 'Delivery fee', total: 'Total',
    complete: 'Mark completed', cancel: 'Cancel order', reopen: 'Reopen', ack: 'Start preparing', markReady: 'Mark ready',
    wa: 'WhatsApp', call: 'Call', now: 'Just now',
    min: (n: number) => `${n} min ago`, hr: (n: number) => `${n}h ago`,
  },
  ar: {
    today: 'اليوم', d7: '7 أيام', thisMonth: 'هذا الشهر', lastMonth: 'الشهر الماضي', refresh: 'تحديث', live: 'مباشر', liveTip: 'التحديث التلقائي يعمل: الطلبات الجديدة تظهر هنا وحدها', soundOn: 'صوت الطلبات الجديدة يعمل', soundOff: 'صوت الطلبات الجديدة متوقف',
    orders: 'الطلبات', revenue: 'الإيرادات', avg: 'متوسط الطلب', pending: 'بانتظارك',
    vsPrev: 'عن السابقة', over: 'الطلبات عبر الوقت', peak: 'الذروة', ordersWord: 'طلب',
    top: 'الأكثر مبيعاً', sold: 'مباع',
    recent: 'آخر الطلبات', all: 'الكل', showMore: 'عرض المزيد',
    new: 'جديد', confirmed: 'قيد التحضير', ready: 'جاهز', completed: 'مكتمل', cancelled: 'ملغي',
    emptyTitle: 'لا توجد طلبات بعد', emptyDesc: 'الطلبات القادمة من المنيو ستظهر هنا فوراً.',
    emptyView: 'لا توجد طلبات في هذا العرض.', noData: 'لا توجد بيانات لهذه الفترة.',
    itemsLabel: 'الأصناف', phone: 'الهاتف', address: 'العنوان', table: 'الطاولة', notes: 'ملاحظات', openMaps: 'فتح في الخرائط',
    subtotal: 'المجموع الفرعي', fee: 'رسوم التوصيل', total: 'الإجمالي',
    complete: 'تم التسليم', cancel: 'إلغاء الطلب', reopen: 'إعادة فتح', ack: 'بدء التحضير', markReady: 'تعيين جاهز',
    wa: 'واتساب', call: 'اتصال', now: 'الآن',
    min: (n: number) => `قبل ${n} د`, hr: (n: number) => `قبل ${n} س`,
  },
} as const;
