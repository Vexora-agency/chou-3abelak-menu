import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, CookingPot, XCircle, ArrowLeft, BellRing, Loader2 } from 'lucide-react';
import { formatPrice } from '@/src/utils/pricing';
import { ReceivedButton } from './components/ReceivedButton';
import { CancelOrderButton } from './components/CancelOrderButton';

interface TrackViewProps {
  number: number;
  token: string;
  onBack: () => void;
}

interface TrackItem {
  qty: number;
  unitPrice: number;
  name: { en: string; ar: string };
  variantName?: { en: string; ar: string };
  addonNames?: { en: string; ar: string }[];
}

interface TrackData {
  number: number;
  status: 'new' | 'confirmed' | 'completed' | 'cancelled';
  items: TrackItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  lang: 'en' | 'ar';
  createdAt?: string;
}

const pick = (v: { en: string; ar: string } | undefined, lang: 'en' | 'ar') => {
  if (!v) return '';
  return (lang === 'ar' ? v.ar : v.en) || (lang === 'ar' ? v.en : v.ar) || '';
};

/**
 * Customer order tracking (?track=N&t=token): standalone page, no menu data
 * needed. Polls the token-gated /api/track every 7s while visible — the
 * owner's dashboard status tap is what moves this timeline.
 */
/** Site language preference (same key the storefront writes). */
function siteLang(): 'en' | 'ar' | null {
  try {
    const v = window.localStorage.getItem('menu_lang_v1');
    return v === 'en' || v === 'ar' ? v : null;
  } catch {
    return null;
  }
}

export const TrackView: React.FC<TrackViewProps> = ({ number, token, onBack }) => {
  // Follow the site language when set; otherwise fall back to the order's.
  // (The manual toggle below always wins for this visit.)
  const [lang, setLang] = useState<'en' | 'ar'>(() => siteLang() ?? 'ar');
  const [data, setData] = useState<TrackData | null>(null);
  const [missing, setMissing] = useState(false);
  const [storeName, setStoreName] = useState('');
  const [currency, setCurrency] = useState('LBP');
  const isAr = lang === 'ar';

  useEffect(() => {
    let stop = false;
    const loadMenu = async () => {
      try {
        const res = await fetch('/api/menu');
        if (!res.ok) return;
        const m = (await res.json()) as {
          settings?: { name?: { en: string; ar: string }; currency?: { en: string; ar: string } };
        };
        if (stop) return;
        const nm = m?.settings?.name;
        if (nm) setStoreName(lang === 'ar' ? nm.ar || nm.en : nm.en || nm.ar);
        const cur = m?.settings?.currency;
        if (cur) setCurrency(lang === 'ar' ? cur.ar || cur.en : cur.en || cur.ar);
      } catch {}
    };
    void loadMenu();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- menu once; lang switch re-resolves below
  }, []);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/track?number=${number}&t=${encodeURIComponent(token)}`);
        if (stop) return;
        if (res.status === 404) {
          setMissing(true);
          return;
        }
        if (!res.ok) return;
          const d = (await res.json()) as TrackData & { ok?: boolean };
          if (stop || !d || d.ok === false) return;
          setData(d);
          if (!siteLang() && (d.lang === 'ar' || d.lang === 'en')) setLang(d.lang);
      } catch {}
    };
    void tick();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void tick();
    }, 7000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [number, token]);

  const steps = [
    { id: 'new', label: isAr ? 'بانتظار التأكيد' : 'Awaiting confirmation', icon: Clock },
    { id: 'confirmed', label: isAr ? 'طلبك قيد التحضير' : 'Being prepared', icon: CookingPot },
    { id: 'completed', label: isAr ? 'تم التوصيل' : 'Delivered', icon: CheckCircle2 },
  ];
  const stage = data?.status === 'completed' ? 2 : data?.status === 'confirmed' ? 1 : 0;
  const cancelled = data?.status === 'cancelled';

  return (
    <div dir={isAr ? 'rtl' : 'ltr'} className="min-h-dvh bg-[#0A0A0A] text-white flex flex-col items-center px-5 pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-[520px]">
        {/* Sticky top bar: back-to-menu + language stay reachable no matter
            how far down the order details scroll (mobile-first fix). */}
        <div className="sticky top-0 z-20 -mx-5 px-5 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 bg-[#0A0A0A]/90 backdrop-blur-md">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 h-11 px-3 -ms-3 rounded-xl text-xs font-bold text-neutral-300 hover:text-[var(--primary)] active:text-[var(--primary)]"
            >
              <ArrowLeft size={16} className={isAr ? 'rotate-180' : ''} />
              {isAr ? 'المنيو' : 'Menu'}
            </button>
            <button
              type="button"
              onClick={() => setLang(isAr ? 'en' : 'ar')}
              className="h-11 px-5 rounded-full border border-neutral-700 text-xs font-bold text-neutral-300 hover:border-[var(--primary)] hover:text-[var(--primary)] active:border-[var(--primary)]"
            >
              {isAr ? 'EN' : 'عربي'}
            </button>
          </div>
        </div>
        <div className="pt-3">

        {missing ? (
          <div className="text-center py-16">
            <XCircle size={40} className="mx-auto text-neutral-600" />
            <p className="mt-4 font-black text-lg">{isAr ? 'رابط التتبع غير صالح' : 'Invalid tracking link'}</p>
              <p className="mt-1 text-sm text-neutral-400">
                {isAr ? 'استخدم رابط التتبع الكامل الخاص بطلبك.' : 'Use your order’s full tracking link.'}
              </p>
          </div>
        ) : !data ? (
          <div className="flex justify-center py-16">
            <Loader2 size={32} className="animate-spin text-[var(--primary)]" />
          </div>
        ) : (
          <>
            <p className="text-center text-xs font-bold text-neutral-500">
              {storeName || (isAr ? 'تتبع الطلب' : 'Order tracking')}
            </p>
            <h1 className="text-center text-3xl font-black mt-1 tabular-nums" dir="ltr">
              #{data.number}
            </h1>

            {cancelled ? (
              <div className="mt-6 rounded-2xl border border-red-500/40 bg-red-950/30 p-5 text-center">
                <XCircle size={32} className="mx-auto text-red-400" />
                <p className="mt-2 font-black">{isAr ? 'تم إلغاء الطلب' : 'Order cancelled'}</p>
                <p className="mt-1 text-xs text-neutral-400">
                  {isAr ? 'كلمنا لو في أي سؤال.' : 'Call us if you have any question.'}
                </p>
              </div>
            ) : (
              <ol className="mt-6 space-y-0">
                {steps.map((s, i) => {
                  const done = i <= stage;
                  const current = i === stage;
                  const Icon = s.icon;
                  return (
                    <li key={s.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span
                          className={`w-9 h-9 rounded-full flex items-center justify-center border-2 ${
                            done
                              ? 'bg-[var(--primary)] border-[var(--primary)] text-[#0A0A0A]'
                              : 'border-neutral-700 text-neutral-600'
                          } ${current ? 'animate-pulse' : ''}`}
                        >
                          <Icon size={17} strokeWidth={2.5} />
                        </span>
                        {i < steps.length - 1 && (
                          <span className={`w-0.5 flex-1 min-h-[22px] ${i < stage ? 'bg-[var(--primary)]' : 'bg-neutral-800'}`} />
                        )}
                      </div>
                      <div className="pb-6 pt-1.5">
                        <p className={`text-sm font-black ${done ? 'text-white' : 'text-neutral-600'}`}>{s.label}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}

            <div className="mt-2 rounded-2xl border border-neutral-800 border-t-2 border-t-[var(--primary)] bg-neutral-900/60 p-4 shadow-[0_10px_40px_-20px_rgba(0,0,0,0.8)]">
              {data.items.map((it, i) => (
                <div key={i} className="flex justify-between gap-3 py-1.5 text-sm">
                  <span className="text-neutral-200">
                    <b className="tabular-nums">{it.qty}x </b>
                    {pick(it.name, lang)}
                    {it.variantName && <span className="text-neutral-400"> ({pick(it.variantName, lang)})</span>}
                    {it.addonNames && it.addonNames.length > 0 && (
                      <span className="block text-[11px] text-neutral-500">
                        + {(it.addonNames.map((a) => pick(a, lang)) || []).join(isAr ? '، ' : ', ')}
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums text-neutral-300 shrink-0" dir="ltr">
                    {formatPrice(it.unitPrice * it.qty)}
                  </span>
                </div>
              ))}
              <div className="border-t border-neutral-800 mt-2 pt-2 flex justify-between text-sm font-black">
                <span>{isAr ? 'الإجمالي' : 'Total'}</span>
                <span className="tabular-nums text-[var(--primary)]" dir="ltr">
                  {formatPrice(data.total, currency)}
                </span>
              </div>
            </div>

            {data.status === 'new' && data.createdAt && (
              <div className="mt-4">
                <CancelOrderButton
                  number={data.number}
                  token={token}
                  createdAt={data.createdAt}
                  status={data.status}
                  lang={lang}
                  darkMode
                  onCancelled={() => setData((d) => (d ? { ...d, status: 'cancelled' } : d))}
                />
              </div>
            )}
            {(data.status === 'new' || data.status === 'confirmed') && (
              <div className="mt-4">
                <ReceivedButton
                  number={data.number}
                  token={token}
                  lang={lang}
                  darkMode
                  onConfirmed={() => setData((d) => (d ? { ...d, status: 'completed' } : d))}
                />
              </div>
            )}
            <p className="mt-4 text-center text-[11px] text-neutral-600 inline-flex items-center gap-1 justify-center w-full">
              <BellRing size={12} />
              {isAr ? 'الصفحة تتحدث تلقائيًا — خليها مفتوحة.' : 'This page updates itself — keep it open.'}
            </p>
          </>
        )}
        </div>
      </div>
    </div>
  );
};
