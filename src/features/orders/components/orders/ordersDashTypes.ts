/* ---------- Types (the API should return exactly this shape) ---------- */
import type { MenuData } from '@/src/types/menu';

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
  /** Split quantities: featureId → 0..qty. Absent = legacy (every addon applies to all units). */
  addonQty?: Record<string, number>;
  qty: number;
  unitPrice: number;
}

export interface Order {
  id: string;
  number: number;
  createdAt: string; // ISO date
  status: OrderStatus;
  type: OrderType;
  /** Payment method (today always 'cod') + status ('pending' until collected). */
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  customer: { name: string; phone: string; address?: string; table?: string };
  location?: { lat: number; lng: number };
  notes?: string;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  /** Confirm instant (ISO) — set when the kitchen acknowledges. */
  confirmedAt?: string | null;
  /** Smart-ETA instant (ISO) — mapped server-side in mapOrderRow. */
  etaAt?: string | null;
  /** Follow-up link (server-computed): earlier order number or null. */
  parentNumber?: number | null;
  /** Actor who last changed the order (kitchen/member display name).
   *  Set server-side on status changes; absent on older rows or when the
   *  owner changes the status (nothing renders then — by design). */
  updatedBy?: string | null;
  /** Fake-order risk (server-scored). Absent on older rows — treat undefined
   *  as not-review (back-compat: the badge simply does not render). */
  riskScore?: number;
  riskReasons?: string[];
  needsReview?: boolean;
  /** Admin dismissal (migration 0043): a checked-and-legitimate order no
   *  longer raises the badge. Absent on older rows — treated as not cleared. */
  reviewCleared?: boolean;
  /** Better Auth user id when the order was placed by a signed-in customer.
   *  Always present as string-or-null on new API rows; legacy payloads may
   *  omit it (the badge simply does not render). */
  customerUserId?: string | null;
  /** Blocked customer (phone blocklist): true when the order's phone is
   *  currently blocked. Absent on older rows — treat undefined as not
   *  blocked. Blocked phones cannot place new orders; their history stays
   *  visible and marked. */
  isBlocked?: boolean;
}

/** Kitchen health signal: the 1-minute order-nag sweep heartbeat.
 *  `stale` (>3 min) / `critical` (>5 min) are computed server-side;
 *  `neverRan` means no sweep recorded yet (fresh install — no alarm). */
export interface CronHealth {
  service: string;
  lastStartedAt: string | null;
  lastSuccessAt: string | null;
  lastDurationMs: number | null;
  runs: number;
  consecutiveErrors: number;
  lastError: string | null;
  lastResult: unknown;
  stale: boolean;
  critical: boolean;
  neverRan: boolean;
}

export interface OrdersDashboardProps {
  lang: 'en' | 'ar';
  menu: MenuData;
  orders: Order[];
  currency: string;
  loading?: boolean;
  onStatusChange: (id: string, status: OrderStatus) => void;
  onRefresh?: () => void;
  /** Owner-picked kitchen chime id (one of the 5 library ids, unknown -> classic). */
  kitchenSound?: string | null;
  /** Optional confirm gate (admin modal): when provided, destructive
   *  actions ask first instead of firing immediately. */
  onConfirm?: (box: { title: string; body: string; confirmText: string; mode?: 'confirm' | 'info'; action?: () => void }) => void;
  /** Kitchen board: section title drops "Recent" (plain "Orders"). */
  kitchen?: boolean;
  /** Review dismissal: resolves true when the badge cleared. */
  onTrustReview?: (id: string) => Promise<boolean>;
  /** Block request: opens the confirm gate, then owner-blocklists the number. */
  onBlockPhone?: (phone: string, orderNumber: number) => void;
}

export type Period = 'today' | '7d' | 'month' | 'lastMonth';

export const STR = {
  en: {
    today: 'Today', d7: '7 days', thisMonth: 'This month', lastMonth: 'Last month', refresh: 'Refresh', live: 'Live', liveTip: 'Auto-refresh on: new orders appear here by themselves', soundOn: 'New-order alerts on', soundOff: 'New-order alerts off',
    notificationsOff: "Notifications are off — you won't receive new-order alerts.",
    notificationsBlocked: 'Notifications are blocked in browser settings — allow them to receive alerts.',
    notificationsIos: 'On iPhone, add the admin panel to your Home Screen first to receive alerts.',
    notificationsUnsupported: "This browser can't send background alerts.",
    notificationsError: "Couldn't enable notifications — try again.",
    orders: 'Orders', revenue: 'Revenue', avg: 'Avg. order', pending: 'Awaiting you',
    vsPrev: 'vs previous', over: 'Orders over time', peak: 'Peak', ordersWord: 'orders',
    top: 'Top sellers', sold: 'sold',
    recent: 'Recent orders', all: 'All', showMore: 'Show more',
    new: 'New', confirmed: 'Preparing', ready: 'Ready', completed: 'Completed', cancelled: 'Cancelled',
    emptyTitle: 'No orders yet', emptyDesc: 'Orders placed from your menu will appear here instantly.',
    emptyView: 'No orders in this view.', noData: 'No data for this period.',
    itemsLabel: 'Items', phone: 'Phone', address: 'Address', table: 'Table', notes: 'Notes', openMaps: 'Open in Maps',
    subtotal: 'Subtotal', fee: 'Delivery fee', total: 'Total', payment: 'Payment', cod: 'Cash on Delivery',
    complete: 'Mark completed', cancel: 'Cancel order', reopen: 'Reopen', ack: 'Start preparing',
    wa: 'WhatsApp', call: 'Call', now: 'Just now',
    registered: 'Registered customer', registeredTip: 'This order was placed from a signed-in customer account.',
    blocked: 'Blocked', blockedTip: 'This customer is blocked — their new orders are rejected automatically.',
    min: (n: number) => `${n} min ago`, hr: (n: number) => `${n}h ago`,
    arrives: (t: string) => `Arrives ~${t}`, late: (n: number) => `${n}m late`,
    linkedLong: (n: number) => `Follow-up to order #${n} — same customer, prepare together`,
    jointTitle: (n: number) => n === 2 ? 'Linked pair — prepare & deliver together' : `Linked group (${n}) — prepare & deliver together`,
    jointShort: (n: number) => n === 2 ? 'Linked pair' : `Linked ×${n}`,
    ackBoth: (n: number) => `Start preparing all (${n})`,
    completeBoth: (n: number) => `Complete all (${n})`,
    alignBoth: (n: number) => `Bring all to the same stage (${n})`,
    by: (n: string) => `by ${n}`,
    blockTitle: (n: number) => `Block this number (order #${n})?`,
    blockBody: (p: string) => `Future orders from ${p} will be rejected automatically. The customer only sees a generic error.`,
    blockConfirm: 'Block number',
    blockForbidden: 'Only the owner can block numbers.',
    blockFailed: 'Could not block the number. Please try again.',
    blockedDoneTitle: 'Number blocked',
    blockedDoneBody: (p: string) => `${p} is now blocked. Future orders from this number will be rejected automatically, and the alert on this order was cleared.`,
    ok: 'OK',
  },
  ar: {
    today: 'اليوم', d7: '7 أيام', thisMonth: 'هذا الشهر', lastMonth: 'الشهر الماضي', refresh: 'تحديث', live: 'مباشر', liveTip: 'التحديث التلقائي يعمل: الطلبات الجديدة تظهر هنا وحدها', soundOn: 'تنبيهات الطلبات الجديدة مفعّلة', soundOff: 'تنبيهات الطلبات الجديدة متوقفة',
    notificationsOff: 'الإشعارات متوقفة — لن يصلك تنبيه عند وصول طلب جديد.',
    notificationsBlocked: 'الإشعارات محظورة من إعدادات المتصفح — اسمح بها لتصلك التنبيهات.',
    notificationsIos: 'على الآيفون، أضف لوحة الإدارة للشاشة الرئيسية أولًا لتصلك التنبيهات.',
    notificationsUnsupported: 'هذا المتصفح لا يدعم تنبيهات الخلفية.',
    notificationsError: 'تعذّر تفعيل الإشعارات — حاول مرة أخرى.',
    orders: 'الطلبات', revenue: 'الإيرادات', avg: 'متوسط الطلب', pending: 'بانتظارك',
    vsPrev: 'عن السابقة', over: 'الطلبات عبر الوقت', peak: 'الذروة', ordersWord: 'طلب',
    top: 'الأكثر مبيعاً', sold: 'مباع',
    recent: 'آخر الطلبات', all: 'الكل', showMore: 'عرض المزيد',
    new: 'جديد', confirmed: 'قيد التحضير', ready: 'جاهز', completed: 'مكتمل', cancelled: 'ملغي',
    emptyTitle: 'لا توجد طلبات بعد', emptyDesc: 'الطلبات القادمة من القائمة ستظهر هنا فورًا.',
    emptyView: 'لا توجد طلبات في هذا العرض.', noData: 'لا توجد بيانات لهذه الفترة.',
    itemsLabel: 'الأصناف', phone: 'الهاتف', address: 'العنوان', table: 'الطاولة', notes: 'ملاحظات', openMaps: 'فتح في الخرائط',
    subtotal: 'المجموع الفرعي', fee: 'رسوم التوصيل', total: 'الإجمالي', payment: 'الدفع', cod: 'الدفع عند الاستلام',
    complete: 'تم التسليم', cancel: 'إلغاء الطلب', reopen: 'إعادة فتح', ack: 'بدء التحضير',
    wa: 'واتساب', call: 'اتصال', now: 'الآن',
    registered: 'عميل مسجل', registeredTip: 'هذا الطلب من حساب عميل مسجل في المنصة.',
    blocked: 'محظور', blockedTip: 'هذا العميل محظور — طلباته الجديدة تُرفض تلقائيًا.',
    min: (n: number) => `قبل ${n} د`, hr: (n: number) => `قبل ${n} س`,
    arrives: (t: string) => `يوصل ~${t}`, late: (n: number) => `متأخر ${n} د`,
    linkedLong: (n: number) => `تابع للطلب #${n} — نفس الزبون، يُجهَّز معه`,
    jointTitle: (n: number) => n === 2 ? 'طلبان مرتبطان — يُجهَّزان ويوصلان معًا' : `طلبات مرتبطة (${n}) — تُجهَّز وتوصل معًا`,
    jointShort: (n: number) => n === 2 ? 'طلبان مرتبطتان' : `طلبات مرتبطة (${n})`,
    ackBoth: (n: number) => `بدء تحضير الكل (${n})`,
    completeBoth: (n: number) => `إتمام الكل (${n})`,
    alignBoth: (n: number) => `توحيد مرحلة الكل (${n})`,
    by: (n: string) => `بواسطة ${n}`,
    blockTitle: (n: number) => `حظر هذا الرقم (طلب #${n})؟`,
    blockBody: (p: string) => `سيتم رفض أي طلبات قادمة من ${p} تلقائيًا. العميل يرى رسالة خطأ عامة فقط.`,
    blockConfirm: 'حظر الرقم',
    blockForbidden: 'حظر الأرقام متاح للمالك فقط.',
    blockFailed: 'تعذر حظر الرقم. حاول مجددًا.',
    blockedDoneTitle: 'تم حظر الرقم',
    blockedDoneBody: (p: string) => `تم حظر ${p}. سيتم رفض أي طلبات قادمة من هذا الرقم تلقائيًا، وأُزيل التنبيه عن هذا الطلب.`,
    ok: 'حسنًا',
  },
} as const;
