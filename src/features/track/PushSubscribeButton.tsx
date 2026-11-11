import React, { useEffect, useState } from 'react';
import { BellRing, BellOff, Loader2 } from 'lucide-react';
import {
  fetchVapidKey, ensureSW, getExistingSub, isIosDevice, isPushCapable,
  subscribeDevice,
} from '@/src/utils/webpush';

interface PushSubscribeButtonProps {
  orderNumber: number;
  trackToken: string;
  lang: 'en' | 'ar';
  darkMode: boolean;
}

type State = 'idle' | 'working' | 'subscribed' | 'denied' | 'unsupported' | 'ios' | 'error';

/**
 * One-tap order updates: subscribes THIS device to THIS order (the tracking
 * token is the authorization) and stores the subscription server-side. The
 * owner's dashboard status tap is what fires the notification.
 */
export const PushSubscribeButton: React.FC<PushSubscribeButtonProps> = ({
  orderNumber,
  trackToken,
  lang,
  darkMode,
}) => {
  const isAr = lang === 'ar';
  const [state, setState] = useState<State>('idle');

  const bind = async (endpoint: string, p256dh: string, auth: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/push-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, p256dh, auth, orderNumber, trackToken }),
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  // Already subscribed on this browser (e.g. a previous order)? Bind it to
  // this order silently — consent was given then.
  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const sub = await getExistingSub();
        if (stop || !sub) return;
        if (await bind(sub.endpoint, sub.p256dh, sub.auth)) {
          if (!stop) setState('subscribed');
        }
      } catch {}
    })();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bind once per order
  }, [orderNumber, trackToken]);

  const onTap = async () => {
    if (state === 'working' || state === 'subscribed') return;
    if (!isPushCapable()) {
      setState(isIosDevice() ? 'ios' : 'unsupported');
      return;
    }
    setState('working');
    try {
      await ensureSW();
      const key = await fetchVapidKey();
      if (!key) throw new Error('no-key');
      const result = await subscribeDevice(key);
      if (result.status === 'denied') {
        setState('denied');
        return;
      }
      if (result.status !== 'subscribed' || !result.sub) {
        setState(isIosDevice() ? 'ios' : 'unsupported');
        return;
      }
      const ok = await bind(result.sub.endpoint, result.sub.p256dh, result.sub.auth);
      setState(ok ? 'subscribed' : 'error');
    } catch {
      setState('error');
    }
  };

  if (state === 'subscribed') {
    return (
      <div className="flex items-center justify-center gap-2 h-11 px-5 rounded-full bg-green-500/10 border border-green-500/40 text-green-500 text-xs font-extrabold">
        <BellRing size={15} />
        {isAr ? 'سنُعلمك بكل تحديث في طلبك' : 'We will ping you on every update'}
      </div>
    );
  }

  if (state === 'ios') {
    return (
      <div className={`rounded-2xl border p-3 text-[11px] leading-relaxed ${darkMode ? 'border-neutral-700 text-neutral-300' : 'border-neutral-300 text-neutral-700'}`}>
        {isAr
          ? 'للتنبيه على الآيفون: شارك ← إضافة للشاشة الرئيسية ← افتح أيقونة الموقع ← اضغط هذا الزر هناك.'
          : 'For iPhone alerts: Share → Add to Home Screen → open the site icon → tap this button there.'}
      </div>
    );
  }

  const note =
    state === 'denied'
      ? isAr ? 'التنبيهات محظورة في المتصفح — فعّلها من الإعدادات.' : 'Notifications are blocked in the browser — enable them in settings.'
      : state === 'unsupported'
        ? isAr ? 'متصفحك لا يدعم التنبيهات — يتم تحديث صفحة التتبع تلقائيًا.' : 'This browser cannot notify — the tracking page updates itself.'
        : state === 'error'
          ? isAr ? 'تعذر التفعيل — حاول مجددًا.' : 'Could not enable — try again.'
          : null;

  return (
    <div>
      <button
        type="button"
        onClick={() => void onTap()}
        disabled={state === 'working'}
        className={`btn-tactile w-full h-12 min-h-[48px] px-5 rounded-full border text-xs font-extrabold inline-flex items-center justify-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 ${
          darkMode
            ? 'border-[var(--primary)]/60 text-[var(--primary)] hover:bg-[var(--primary)] hover:text-[#0A0A0A]'
            : 'border-[#0A0A0A] text-[#0A0A0A] hover:bg-[#0A0A0A] hover:text-[var(--primary)]'
        } disabled:opacity-60`}
      >
        {state === 'working' ? <Loader2 size={15} className="animate-spin" /> : <BellRing size={15} />}
        {isAr ? 'نبّهني بحالة الطلب' : 'Notify me on updates'}
      </button>
      {note && (
        <p className={`mt-1.5 text-xs text-center flex items-center justify-center gap-1 ${isAr ? 'leading-relaxed' : ''} ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`}>
          <BellOff size={14} className="shrink-0" />
          <span className="min-w-0 break-words">{note}</span>
        </p>
      )}
    </div>
  );
};
