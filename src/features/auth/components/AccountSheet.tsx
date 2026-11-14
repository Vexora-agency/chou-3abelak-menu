import { useEffect, useRef, useState, type FC } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ExternalLink,
  Loader2,
  LockKeyhole,
  LogOut,
  Mail,
  MapPin,
  RefreshCw,
  ShoppingBag,
  UserRound,
  X,
} from 'lucide-react';
import { authClient } from '@/src/lib/auth-client';
import { useBodyScrollLock } from '@/src/hooks/useBodyScrollLock';
import { useNow } from '@/src/hooks/useNow';
import { cleanPhoneInput } from '@/src/utils/digits';
import { formatMMSS } from '@/src/utils/countdown';
import { formatPrice } from '@/src/utils/pricing';
import { CustomerAvatar } from './CustomerAvatar';
import { CancelOrderButton } from '@/src/features/track/components/CancelOrderButton';
import { ReceivedButton } from '@/src/features/track/components/ReceivedButton';
import { useCustomerSession } from '../hooks/useCustomerSession';
import { useCustomerProfile } from '../hooks/useCustomerProfile';
import { useCustomerOrders } from '../hooks/useCustomerOrders';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { updateMyProfile } from '../services/account.api';
import { AUTH_STR } from '../strings';
import type { AccountOrder, AccountStatus } from '../types';

interface AccountSheetProps {
  open: boolean;
  onClose: () => void;
  onSignIn: () => void;
  lang: 'en' | 'ar';
  darkMode: boolean;
  currency: string;
  /** Owner-tuned self-cancel window (ms) — same setting as the guest bell. */
  cancelWindowMs: number;
}

type Tab = 'orders' | 'settings';

const STATUS_STYLE: Record<AccountStatus, string> = {
  new: 'border-[var(--primary)]/40 bg-[var(--primary)]/10 text-[#8a6d00] dark:text-[var(--primary)]',
  confirmed: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  ready: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  completed: 'border-neutral-400/40 bg-neutral-500/10 text-neutral-600 dark:text-neutral-300',
  cancelled: 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-300',
};

function dateLabel(iso: string, isAr: boolean) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString(isAr ? 'ar-EG-u-nu-latn' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function itemTitle(item: AccountOrder['items'][number], isAr: boolean) {
  if (!item) return '';
  const base = item.name?.[isAr ? 'ar' : 'en'] || item.name?.en || item.name?.ar || '';
  const variant = item.variantName?.[isAr ? 'ar' : 'en'] || item.variantName?.en || '';
  const addons = (item.addonNames || [])
    .map((a) => a?.[isAr ? 'ar' : 'en'] || a?.en || '')
    .filter(Boolean);
  return [base, variant, ...addons].filter(Boolean).join(' · ');
}

const OrderCard: FC<{
  order: AccountOrder;
  open: boolean;
  onToggle: () => void;
  lang: 'en' | 'ar';
  darkMode: boolean;
  currency: string;
  cancelWindowMs: number;
  onChanged: () => void;
}> = ({ order, open, onToggle, lang, darkMode, currency, cancelWindowMs, onChanged }) => {
  const t = AUTH_STR[lang];
  const isAr = lang === 'ar';
  const isActive = order.status === 'new' || order.status === 'confirmed' || order.status === 'ready';
  const nowMs = useNow(open && (order.status === 'confirmed' || order.status === 'ready'));
  const receivableMs = order.receivableAt ? Date.parse(order.receivableAt) : NaN;
  const receivableLocked = (order.status === 'confirmed' || order.status === 'ready')
    && Number.isFinite(receivableMs)
    && receivableMs > nowMs;
  const trackToken = typeof order.trackToken === 'string' ? order.trackToken : '';
  const readyToConfirm = (order.status === 'confirmed' || order.status === 'ready') && !receivableLocked;
  const cardGlow = isActive ? (readyToConfirm ? 'anim-order-ready' : 'anim-order-glow') : '';
  const statusLabel = {
    new: t.statusNew,
    confirmed: t.statusConfirmed,
    ready: t.statusReady,
    completed: t.statusCompleted,
    cancelled: t.statusCancelled,
  }[order.status];
  const typeLabel = {
    delivery: t.typeDelivery,
    pickup: t.typePickup,
    dinein: t.typeDinein,
  }[order.type];
  const itemCount = order.items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);

  return (
    <div className={`rounded-2xl border overflow-hidden transition-colors ${cardGlow} ${darkMode ? 'bg-neutral-900 border-neutral-800' : 'bg-[#fafafa] border-neutral-200'}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full text-start p-3.5 flex items-center gap-3 min-h-[64px]">
        <span className="shrink-0 w-10 h-10 rounded-xl bg-[var(--primary)]/10 border border-[var(--primary)]/30 text-[var(--primary)] flex items-center justify-center">
          <ShoppingBag size={18} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 flex-wrap">
            <b className="text-sm tabular-nums" dir="ltr">#{order.number}</b>
            <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${STATUS_STYLE[order.status]}`}>{statusLabel}</span>
          </span>
          <span className={`mt-0.5 block text-[11px] ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`}>
            {dateLabel(order.createdAt, isAr)} · {typeLabel} · {t.itemsCount(itemCount)}
          </span>
        </span>
        <span className="shrink-0 text-end">
          <span className="block text-sm font-extrabold tabular-nums" dir="ltr">{formatPrice(order.total, currency)}</span>
          <ChevronDown size={16} className={`ms-auto mt-1 transition-transform duration-300 ${open ? 'rotate-180' : ''} ${darkMode ? 'text-neutral-500' : 'text-neutral-400'}`} aria-hidden="true" />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className={`px-3.5 pb-3.5 pt-3 border-t space-y-3 ${darkMode ? 'border-neutral-800' : 'border-neutral-200'}`}>
              <div className="space-y-1.5">
                {order.items.map((item, index) => (
                  <div key={`${item.id}-${index}`} className="flex justify-between gap-3 text-xs">
                    <span className="min-w-0 flex-1 break-words">
                      <bdi dir="ltr" className="tabular-nums font-bold">{item.qty}</bdi>
                      <span dir="ltr">× </span>
                      <span dir="auto">{itemTitle(item, isAr)}</span>
                    </span>
                    <span className={`shrink-0 tabular-nums ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`} dir="ltr">
                      {formatPrice(item.qty * item.unitPrice, currency)}
                    </span>
                  </div>
                ))}
              </div>

              <div className={`pt-2 border-t space-y-1 text-xs ${darkMode ? 'border-neutral-800 text-neutral-400' : 'border-neutral-200 text-neutral-500'}`}>
                <div className="flex justify-between"><span>{t.subtotal}</span><span className="tabular-nums" dir="ltr">{formatPrice(order.subtotal, currency)}</span></div>
                {order.deliveryFee > 0 && <div className="flex justify-between"><span>{t.delivery}</span><span className="tabular-nums" dir="ltr">{formatPrice(order.deliveryFee, currency)}</span></div>}
                <div className={`flex justify-between text-sm font-extrabold ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}><span>{t.total}</span><span className="tabular-nums" dir="ltr">{formatPrice(order.total, currency)}</span></div>
                <div className="flex justify-between"><span>{t.payment}</span><span>{t.cod}</span></div>
              </div>

              {order.customer.address && (
                <p className={`flex items-start gap-1.5 text-xs ${darkMode ? 'text-neutral-300' : 'text-neutral-700'}`}>
                  <MapPin size={13} className="mt-0.5 shrink-0 text-[var(--primary)]" aria-hidden="true" />
                  <span dir="auto">{order.customer.address}</span>
                </p>
              )}
              {order.notes && (
                <p className={`text-xs rounded-xl border px-3 py-2 ${darkMode ? 'border-neutral-800 bg-black/30 text-neutral-300' : 'border-neutral-200 bg-white text-neutral-700'}`}>
                  <b className={darkMode ? 'text-neutral-500' : 'text-neutral-500'}>{t.notes}: </b>
                  <span dir="auto">{order.notes}</span>
                </p>
              )}

              {isActive && trackToken && (
                <div className="pt-1 space-y-2">
                  {order.status === 'new' && (
                    <CancelOrderButton
                      number={order.number}
                      token={trackToken}
                      createdAt={order.createdAt}
                      status={order.status}
                      lang={lang}
                      darkMode={darkMode}
                      cancelWindowMs={cancelWindowMs}
                      onCancelled={onChanged}
                    />
                  )}
                  <div className="flex flex-wrap items-start gap-2">
                    <a
                      href={`/?track=${order.number}&t=${encodeURIComponent(trackToken)}`}
                      className={`h-11 min-h-[44px] px-5 rounded-full border text-xs font-extrabold inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                        darkMode ? 'border-neutral-700 text-neutral-200 hover:border-[var(--primary)] hover:text-[var(--primary)]' : 'border-neutral-300 text-neutral-700 hover:border-[var(--primary)]'
                      }`}
                    >
                      <ExternalLink size={13} aria-hidden="true" />
                      {t.trackLive}
                    </a>
                    {(order.status === 'confirmed' || order.status === 'ready') && (
                      <ReceivedButton
                        number={order.number}
                        token={trackToken}
                        lang={lang}
                        darkMode={darkMode}
                        compact
                        groupCount={Array.isArray(order.groupNumbers) && order.groupNumbers.length > 0 ? order.groupNumbers.length + 1 : undefined}
                        disabled={receivableLocked}
                        waitingHint={receivableLocked ? t.unlockHint(formatMMSS(Math.max(0, receivableMs - nowMs))) : undefined}
                        onConfirmed={onChanged}
                      />
                    )}
                  </div>
                  {(order.status === 'confirmed' || order.status === 'ready') && !receivableLocked && (
                    <p className={`text-[11px] font-bold ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`}>
                      {t.receivedPrompt}
                    </p>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export function AccountSheet({ open, onClose, onSignIn, lang, darkMode, currency, cancelWindowMs }: AccountSheetProps) {
  const t = AUTH_STR[lang];
  const isAr = lang === 'ar';
  const sheetRef = useRef<HTMLDivElement>(null);
  const session = useCustomerSession();
  const profileState = useCustomerProfile(open);
  const ordersState = useCustomerOrders(open);

  const [tab, setTab] = useState<Tab>('orders');
  const [openOrder, setOpenOrder] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveOk, setSaveOk] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');

  useBodyScrollLock(open, 'account-sheet');
  useFocusTrap(open, sheetRef, onClose);

  useEffect(() => {
    if (!open) return;
    setTab('orders');
    setOpenOrder(null);
    setSaveError('');
    setSaveOk(false);
    setSignOutError('');
    setSigningOut(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setName(session.user?.name || '');
    setPhone(profileState.profile?.phone || '');
    setAddress(profileState.profile?.address || '');
  }, [open, session.user?.id, profileState.profile?.phone, profileState.profile?.address]);

  if (!open) return null;

  const user = session.user;
  const profile = profileState.profile;

  if (!session.isPending && !user) {
    return (
      <div className="fixed inset-x-0 top-0 h-[100dvh] z-[80] flex items-end md:items-center justify-center p-0 md:p-6">
        <div onClick={onClose} className="fixed inset-0 bg-black/60 anim-fade-in" aria-hidden="true" />
        <div
          ref={sheetRef}
          role="dialog"
          aria-modal="true"
          aria-label={t.accountTitle}
          dir={isAr ? 'rtl' : 'ltr'}
          className={`anim-drawer-in relative z-10 w-full max-w-[440px] rounded-t-[28px] md:rounded-[28px] border-t-[5px] border-t-[var(--primary)] md:border-2 md:border-[var(--primary)] p-6 text-center shadow-2xl ${darkMode ? 'bg-[#141414] text-white' : 'bg-white text-[#0A0A0A]'}`}
        >
          <UserRound size={40} className="mx-auto text-[var(--primary)]" aria-hidden="true" />
          <p className="mt-3 text-sm font-bold">{t.sessionExpired}</p>
          <div className="mt-4 flex flex-col gap-2">
            <button type="button" onClick={onSignIn} className="btn-tactile h-12 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-sm font-extrabold">
              {t.signInAgain}
            </button>
            <button type="button" onClick={onClose} className={`h-11 rounded-full text-xs font-bold ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`}>
              {t.close}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const save = async () => {
    if (!name.trim()) {
      setSaveError(t.errorName);
      return;
    }
    setSaving(true);
    setSaveError('');
    setSaveOk(false);
    try {
      const { error } = await authClient.updateUser({ name: name.trim() });
      if (error) throw error;
      await updateMyProfile({ phone, address });
      await Promise.all([session.refetch(), profileState.refetch()]);
      setSaveOk(true);
      window.setTimeout(() => setSaveOk(false), 2500);
    } catch {
      setSaveError(t.saveError);
    } finally {
      setSaving(false);
    }
  };

  const signOut = async () => {
    setSigningOut(true);
    setSignOutError('');
    try {
      await authClient.signOut();
      await session.refetch();
      onClose();
    } catch {
      setSignOutError(t.saveError);
      setSigningOut(false);
    }
  };

  const labelClass = `block text-xs font-bold mb-1 ${darkMode ? 'text-neutral-200' : 'text-neutral-800'}`;
  const inputClass = `w-full h-12 px-3.5 rounded-xl border text-base focus:outline-none focus:ring-2 focus:ring-[var(--primary)] transition-colors ${
    darkMode ? 'bg-[#181818] border-neutral-700 text-white placeholder-neutral-400' : 'bg-white border-neutral-300 text-[#0A0A0A] placeholder-neutral-500'
  }`;
  const mutedClass = darkMode ? 'text-neutral-400' : 'text-neutral-500';

  return (
    <div className="fixed inset-x-0 top-0 h-[100dvh] z-[80] flex items-end md:items-center justify-center p-0 md:p-6">
      <div onClick={onClose} className="fixed inset-0 bg-black/60 anim-fade-in" aria-hidden="true" />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={t.accountTitle}
        dir={isAr ? 'rtl' : 'ltr'}
        className={`anim-drawer-in relative z-10 w-full max-w-[560px] max-h-[92dvh] flex flex-col rounded-t-[28px] md:rounded-[28px] border-t-[5px] border-t-[var(--primary)] md:border-2 md:border-[var(--primary)] shadow-2xl overflow-hidden transition-colors duration-200 ${
          darkMode ? 'bg-[#141414] text-white' : 'bg-white text-[#0A0A0A]'
        }`}
      >
        <div className="overflow-y-auto overscroll-contain no-scrollbar flex-1 min-h-0 px-5 sm:px-7 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <div className={`w-11 h-1.5 rounded-full mx-auto mt-3 mb-2 md:hidden ${darkMode ? 'bg-neutral-600' : 'bg-neutral-300'}`} />

          <div className={`sticky top-0 z-10 -mx-5 sm:-mx-7 px-5 sm:px-7 pt-2 pb-3 ${darkMode ? 'bg-[#141414]' : 'bg-white'}`}>
            <div className="flex items-start gap-3">
              <CustomerAvatar
                name={user?.name || ''}
                className="w-14 h-14 min-w-[56px] rounded-full"
                textClassName="text-xl"
              />
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-black leading-tight truncate">{user?.name || t.accountTitle}</h2>
                <p className={`mt-0.5 text-xs truncate flex items-center gap-1.5 ${mutedClass}`}>
                  <Mail size={12} className="shrink-0" aria-hidden="true" />
                  <span dir="ltr">{user?.email || ''}</span>
                </p>
                {user?.createdAt && (
                  <p className={`mt-1 text-[10px] ${mutedClass}`}>
                    {t.memberSince} {dateLabel(user.createdAt, isAr)}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t.close}
                className={`shrink-0 w-11 h-11 min-w-[44px] rounded-full flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                  darkMode ? 'text-neutral-400 hover:text-white hover:bg-white/10' : 'text-neutral-500 hover:text-black hover:bg-black/5'
                }`}
              >
                <X size={20} />
              </button>
            </div>

            <div className={`mt-3 grid grid-cols-2 gap-1 p-1 rounded-full border ${darkMode ? 'bg-neutral-900 border-neutral-800' : 'bg-neutral-100 border-neutral-200'}`} role="tablist">
              {(['orders', 'settings'] as const).map((value) => {
                const active = tab === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setTab(value)}
                    className={`relative min-h-[44px] rounded-full text-xs font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                      active ? 'text-[#0A0A0A]' : darkMode ? 'text-neutral-400 hover:text-white' : 'text-neutral-500 hover:text-black'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="account-tab-pill"
                        className="absolute inset-0 rounded-full bg-[var(--primary)]"
                        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                      />
                    )}
                    <span className="relative z-10">{value === 'orders' ? t.orderHistory : t.settings}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {tab === 'orders' && (
            <div className="pt-1">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-extrabold">{t.ordersTitle}</h3>
                  <p className={`mt-0.5 text-[11px] ${mutedClass}`}>{t.ordersSubtitle}</p>
                </div>
                <button
                  type="button"
                  onClick={() => ordersState.refetch()}
                  aria-label={t.refresh}
                  title={t.refresh}
                  className={`shrink-0 w-11 h-11 min-w-[44px] rounded-full border flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${darkMode ? 'border-neutral-700 text-neutral-300 hover:text-white' : 'border-neutral-300 text-neutral-600 hover:text-black'}`}
                >
                  <RefreshCw size={16} className={ordersState.loading ? 'animate-spin' : ''} aria-hidden="true" />
                </button>
              </div>

              {ordersState.loading && (
                <div className="mt-4 space-y-2.5" aria-busy="true" aria-label={t.loading}>
                  {[0, 1, 2].map((i) => (
                    <div key={i} className={`h-[72px] rounded-2xl border animate-pulse ${darkMode ? 'bg-neutral-900 border-neutral-800' : 'bg-neutral-100 border-neutral-200'}`} />
                  ))}
                </div>
              )}

              {!ordersState.loading && ordersState.error && (
                <div role="alert" className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-center">
                  <AlertCircle size={24} className="mx-auto text-red-500" aria-hidden="true" />
                  <p className="mt-2 text-xs font-bold text-red-600 dark:text-red-300">{t.loadError}</p>
                  <button type="button" onClick={() => ordersState.refetch()} className="mt-3 h-11 px-5 rounded-full bg-red-500/15 text-red-700 dark:text-red-300 text-xs font-extrabold">
                    {t.retry}
                  </button>
                </div>
              )}

              {!ordersState.loading && !ordersState.error && ordersState.orders.length === 0 && (
                <div className={`mt-4 rounded-2xl border p-6 text-center ${darkMode ? 'bg-neutral-900 border-neutral-800' : 'bg-neutral-50 border-neutral-200'}`}>
                  <ShoppingBag size={30} className="mx-auto text-[var(--primary)]/80" aria-hidden="true" />
                  <p className="mt-3 text-sm font-extrabold">{t.noOrders}</p>
                  <p className={`mt-1 text-xs ${mutedClass}`}>{t.noOrdersDesc}</p>
                  <button type="button" onClick={onClose} className="btn-tactile mt-4 h-11 px-5 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-xs font-extrabold">
                    {t.browseMenu}
                  </button>
                </div>
              )}

              {!ordersState.loading && !ordersState.error && ordersState.orders.length > 0 && (
                <div className="mt-3 space-y-2.5 pb-2">
                  {ordersState.orders.map((order) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      open={openOrder === order.number}
                      onToggle={() => setOpenOrder((current) => (current === order.number ? null : order.number))}
                      lang={lang}
                      darkMode={darkMode}
                      currency={currency}
                      cancelWindowMs={cancelWindowMs}
                      onChanged={() => {
                        ordersState.refetch(true);
                        window.dispatchEvent(new Event('member-orders-changed'));
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'settings' && (
            <div className="pt-1 space-y-3">
              <div>
                <h3 className="text-sm font-extrabold">{t.profileTitle}</h3>
                <p className={`mt-0.5 text-[11px] ${mutedClass}`}>{t.profileSubtitle}</p>
              </div>

              <div>
                <label className={labelClass} htmlFor="account-name">{t.name}</label>
                <input
                  id="account-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  maxLength={80}
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass} htmlFor="account-email">{t.email}</label>
                <div className="relative">
                  <input
                    id="account-email"
                    type="email"
                    value={user?.email || ''}
                    readOnly
                    dir="ltr"
                    className={`${inputClass} pe-10 opacity-80 cursor-not-allowed ${isAr ? 'text-end' : 'text-start'}`}
                    aria-describedby="account-email-note"
                  />
                  <LockKeyhole size={15} className={`absolute end-3 top-1/2 -translate-y-1/2 ${mutedClass}`} aria-hidden="true" />
                </div>
                <p id="account-email-note" className={`mt-1 text-[10px] ${mutedClass}`}>{t.emailLocked}</p>
              </div>

              <div>
                <label className={labelClass} htmlFor="account-phone">{t.phone}</label>
                <input
                  id="account-phone"
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(cleanPhoneInput(e.target.value))}
                  autoComplete="tel"
                  dir="ltr"
                  maxLength={20}
                  placeholder={isAr ? '70123456' : '+961 70 123 456'}
                  className={`${inputClass} tabular-nums ${isAr ? 'text-end' : 'text-start'}`}
                  aria-describedby="account-phone-note"
                />
                <p id="account-phone-note" className={`mt-1 text-[10px] ${mutedClass}`}>{t.phoneHint}</p>
              </div>

              <div>
                <label className={labelClass} htmlFor="account-address">{t.defaultAddress}</label>
                <input
                  id="account-address"
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  autoComplete="street-address"
                  maxLength={200}
                  className={inputClass}
                  aria-describedby="account-address-note"
                />
                <p id="account-address-note" className={`mt-1 text-[10px] ${mutedClass}`}>{t.addressHint}</p>
              </div>

              {saveError && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs font-bold text-red-600 dark:text-red-300">{saveError}</p>}
              {saveOk && <p role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-xs font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5"><Check size={14} />{t.saved}</p>}

              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="btn-tactile w-full h-12 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-sm font-extrabold inline-flex items-center justify-center gap-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              >
                {saving && <Loader2 size={17} className="animate-spin" />}
                {saving ? t.saving : t.save}
              </button>

              <div className={`pt-3 mt-1 border-t ${darkMode ? 'border-neutral-800' : 'border-neutral-200'}`}>
                {signOutError && <p role="alert" className="mb-2 text-xs font-bold text-red-600 dark:text-red-300">{signOutError}</p>}
                <button
                  type="button"
                  onClick={() => void signOut()}
                  disabled={signingOut}
                  className={`w-full h-12 rounded-full border text-sm font-extrabold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                    darkMode ? 'border-red-500/40 text-red-400 hover:bg-red-500/10' : 'border-red-500/40 text-red-600 hover:bg-red-500/5'
                  }`}
                >
                  {signingOut ? <Loader2 size={17} className="animate-spin" /> : <LogOut size={17} />}
                  {signingOut ? t.signingOut : t.signOut}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
