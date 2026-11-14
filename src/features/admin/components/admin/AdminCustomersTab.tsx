import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  BadgeCheck,
  CalendarDays,
  Mail,
  MapPin,
  Phone,
  ReceiptText,
  RefreshCw,
  Search,
  Users,
  X,
} from 'lucide-react';
import type { AdminFetch } from '@/src/lib/api-client';
import { readJson, isRecord } from '@/src/utils/safeJson';
import { formatPrice } from '@/src/utils/pricing';
import { CustomerAvatar } from '@/src/features/auth';

export interface AdminCustomer {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  phone: string | null;
  address: string | null;
  joinedAt: string | null;
  ordersCount: number;
  totalSpent: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
}

interface AdminCustomersTabProps {
  lang: 'en' | 'ar';
  currency: string;
  adminFetch: AdminFetch;
}

const STR = {
  en: {
    title: 'Registered customers',
    subtitle: 'Accounts created on the site, with their saved details and order history.',
    searchPh: 'Search by name, email or phone',
    search: 'Search customers',
    loading: 'Loading customers…',
    error: 'Could not load registered customers.',
    retry: 'Try again',
    refresh: 'Refresh',
    empty: 'No registered customers yet',
    emptyDesc: 'Customers who create an account will appear here with their details.',
    customers: 'Customers',
    countHint: 'Registered site accounts',
    orders: 'Orders',
    verified: 'Verified',
    joined: 'Joined',
    lastOrder: 'Last order',
    noOrders: 'No orders yet',
    call: 'Call',
    email: 'Email',
    addressMissing: 'No saved address',
    phoneMissing: 'No saved phone',
    showing: (n: number) => `${n} ${n === 1 ? 'account' : 'accounts'}`,
  },
  ar: {
    title: 'العملاء المسجلون',
    subtitle: 'الحسابات التي أنشأها العملاء على الموقع، مع بياناتهم وسجل طلباتهم.',
    searchPh: 'ابحث بالاسم أو البريد أو الهاتف',
    search: 'بحث عن العملاء',
    loading: 'جارٍ تحميل العملاء…',
    error: 'تعذّر تحميل العملاء المسجلين.',
    retry: 'إعادة المحاولة',
    refresh: 'تحديث',
    empty: 'لا يوجد عملاء مسجلون بعد',
    emptyDesc: 'سيظهر هنا كل عميل ينشئ حسابًا مع بياناته.',
    customers: 'العملاء',
    countHint: 'حسابات مسجلة على الموقع',
    orders: 'الطلبات',
    verified: 'موثّق',
    joined: 'انضم',
    lastOrder: 'آخر طلب',
    noOrders: 'لا توجد طلبات بعد',
    call: 'اتصال',
    email: 'البريد',
    addressMissing: 'لا يوجد عنوان محفوظ',
    phoneMissing: 'لا يوجد هاتف محفوظ',
    showing: (n: number) => `${n} حساب`,
  },
} as const;

function dateLabel(iso: string | null, isAr: boolean) {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleDateString(isAr ? 'ar-EG-u-nu-latn' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const card = 'p-4 sm:p-5 rounded-2xl bg-neutral-900 border border-neutral-800';

export function AdminCustomersTab({ lang, currency, adminFetch }: AdminCustomersTabProps) {
  const t = STR[lang];
  const isAr = lang === 'ar';
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<AdminCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [version, setVersion] = useState(0);
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        setLoading(true);
        setError(false);
        try {
          const url = `/api/admin/customers?q=${encodeURIComponent(query.trim())}&limit=200`;
          const res = await adminFetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data: unknown = await readJson(res);
          const list = isRecord(data) && Array.isArray(data.customers) ? data.customers : [];
          if (reqId.current !== id) return;
          setRows(list as AdminCustomer[]);
        } catch {
          if (reqId.current !== id) return;
          setRows([]);
          setError(true);
        } finally {
          if (reqId.current === id) setLoading(false);
        }
      })();
    }, query ? 320 : 0);
    return () => window.clearTimeout(timer);
  }, [query, version, adminFetch]);

  const rise = (delay: number) => ({
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] as const },
  });

  return (
    <div className="space-y-4" dir={isAr ? 'rtl' : 'ltr'}>
      <motion.div {...rise(0)} className={card}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className={`text-sm font-extrabold text-[var(--primary)] ${isAr ? '' : 'uppercase tracking-wider'}`}>{t.title}</h2>
            <p className="mt-1 text-xs text-neutral-400">{t.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => setVersion((v) => v + 1)}
            aria-label={t.refresh}
            title={t.refresh}
            className="shrink-0 w-11 h-11 min-w-[44px] rounded-full border border-neutral-700 text-neutral-300 hover:text-white hover:border-[var(--primary)]/60 transition-colors flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-3 relative">
          <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-neutral-500" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchPh}
            aria-label={t.search}
            className="w-full h-11 ps-10 pe-10 rounded-xl bg-neutral-950 border border-neutral-700 text-white placeholder-neutral-500 text-base focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={t.refresh}
              className="absolute end-1 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full text-neutral-400 hover:text-white flex items-center justify-center"
            >
              <X size={15} />
            </button>
          )}
        </div>

        <div className="mt-3 flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-950 px-3.5 py-2.5">
          <span className="w-9 h-9 min-w-[36px] rounded-full bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center">
            <Users size={17} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-bold text-neutral-300">{t.customers}</span>
            <span className="block text-[10px] text-neutral-500 truncate">{t.countHint}</span>
          </span>
          <b className="text-xl font-black tabular-nums text-white" dir="ltr">{rows.length}</b>
        </div>
      </motion.div>

      {loading && (
        <div className="space-y-2.5" aria-busy="true" aria-label={t.loading}>
          {[0, 1, 2].map((i) => <div key={i} className="h-[118px] rounded-2xl bg-neutral-900 border border-neutral-800 animate-pulse" />)}
        </div>
      )}

      {!loading && error && (
        <div role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-center">
          <AlertCircle size={28} className="mx-auto text-red-400" aria-hidden="true" />
          <p className="mt-2 text-sm font-bold text-red-300">{t.error}</p>
          <button type="button" onClick={() => setVersion((v) => v + 1)} className="mt-3 h-11 px-5 rounded-full bg-red-500/15 text-red-300 text-xs font-extrabold">
            {t.retry}
          </button>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className={`${card} py-10 text-center`}>
          <Users size={34} className="mx-auto text-[var(--primary)]/70" aria-hidden="true" />
          <p className="mt-3 text-sm font-extrabold">{t.empty}</p>
          <p className="mt-1 text-xs text-neutral-500">{t.emptyDesc}</p>
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="space-y-2.5">
          <p className="text-[11px] font-bold text-neutral-500">{t.showing(rows.length)}</p>
          {rows.map((row, index) => (
            <motion.div key={row.id} {...rise(Math.min(0.1 + index * 0.03, 0.3))} className={card}>
              <div className="flex items-start gap-3">
                <CustomerAvatar name={row.name} className="w-12 h-12 min-w-[48px] rounded-full" textClassName="text-lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <b className="text-sm font-extrabold truncate">{row.name || '—'}</b>
                    {row.emailVerified && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-1.5 py-0.5 rounded-full border border-emerald-400/40 bg-emerald-400/10 text-emerald-300">
                        <BadgeCheck size={11} aria-hidden="true" />{t.verified}
                      </span>
                    )}
                  </div>
                  <a
                    href={`mailto:${row.email}`}
                    dir={isAr ? 'rtl' : 'ltr'}
                    className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-neutral-400 hover:text-[var(--primary)] truncate"
                  >
                    <Mail size={12} className="shrink-0" aria-hidden="true" />
                    <span dir="ltr" className="truncate">{row.email || '—'}</span>
                  </a>
                </div>
                <div className="shrink-0 text-end">
                  <b className="block text-sm tabular-nums" dir="ltr">{formatPrice(row.totalSpent || 0, currency)}</b>
                  <span className="text-[10px] font-bold text-neutral-500">{row.ordersCount || 0} {t.orders}</span>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-2 min-w-0 text-neutral-300">
                  <Phone size={13} className="shrink-0 text-[var(--primary)]" aria-hidden="true" />
                  {row.phone ? (
                    <a href={`tel:+${row.phone}`} className="truncate tabular-nums hover:text-[var(--primary)]" dir="ltr">{row.phone}</a>
                  ) : (
                    <span className="text-neutral-500">{t.phoneMissing}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 min-w-0 text-neutral-300">
                  <MapPin size={13} className="shrink-0 text-[var(--primary)]" aria-hidden="true" />
                  <span className="truncate" dir="auto">{row.address || t.addressMissing}</span>
                </div>
                <div className="flex items-center gap-2 text-neutral-500">
                  <CalendarDays size={13} className="shrink-0 text-[var(--primary)]" aria-hidden="true" />
                  <span>{t.joined} {dateLabel(row.joinedAt, isAr)}</span>
                </div>
                <div className="flex items-center gap-2 text-neutral-500">
                  <ReceiptText size={13} className="shrink-0 text-[var(--primary)]" aria-hidden="true" />
                  <span>{t.lastOrder}: {row.lastOrderAt ? dateLabel(row.lastOrderAt, isAr) : t.noOrders}</span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
