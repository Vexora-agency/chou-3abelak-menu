import React, { useEffect, useState } from 'react';
import { BellRing, BellOff, Loader2 } from 'lucide-react';

interface PushSubscribeButtonProps {
  orderNumber: number;
  trackToken: string;
  lang: 'en' | 'ar';
  darkMode: boolean;
}

type State = 'idle' | 'working' | 'subscribed' | 'denied' | 'unsupported' | 'ios' | 'error';

const isIosDevice = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const isPushCapable = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  typeof Notification !== 'undefined';

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

  // Already subscribed on this browser (e.g. a previous order)? Bind it to
  // this order silently — consent was given then.
  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        if (!isPushCapable()) return;
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (stop || !sub) return;
        const json = sub.toJSON();
        if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;
        const res = await fetch('/api/push-subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: json.endpoint,
            p256dh: json.keys.p256dh,
            auth: json.keys.auth,
            orderNumber,
            trackToken,
          }),
        });
        if (!stop && res.ok) setState('subscribed');
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
      await navigator.serviceWorker.register('/sw.js');
      const keyRes = await fetch('/api/push-key');
      if (!keyRes.ok) throw new Error('no-key');
      const { publicKey } = (await keyRes.json()) as { publicKey?: string };
      if (!publicKey) throw new Error('no-key');
      const { subscribe } = await import('@mmmike/web-push/client');
      const result = await subscribe(publicKey);
      if (result.status === 'denied') {
        setState('denied');
        return;
      }
      if (result.status !== 'subscribed') {
        setState(isIosDevice() ? 'ios' : 'unsupported');
        return;
      }
      const json = result.subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error('bad-sub');
      const res = await fetch('/api/push-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
          orderNumber,
          trackToken,
        }),
      });
      setState(res.ok ? 'subscribed' : 'error');
    } catch {
      setState('error');
    }
  };

  if (state === 'subscribed') {
    return (
      <div className="flex items-center justify-center gap-2 h-11 px-5 rounded-full bg-green-500/10 border border-green-500/40 text-green-500 text-xs font-extrabold">
        <BellRing size={15} />
        {isAr ? 'هنبّهك بكل جديد في طلبك' : 'We will ping you on every update'}
      </div>
    );
  }

  if (state === 'ios') {
    return (
      <div className={`rounded-2xl border p-3 text-[11px] leading-relaxed ${darkMode ? 'border-neutral-700 text-neutral-300' : 'border-neutral-300 text-neutral-700'}`}>
        {isAr
          ? 'للتنبيه على الآيفون: شارك ← إضافة للشاشة الرئيسية ← افتح أيقونة الموقع ← دوس الزر ده هناك.'
          : 'For iPhone alerts: Share → Add to Home Screen → open the site icon → tap this button there.'}
      </div>
    );
  }

  const note =
    state === 'denied'
      ? isAr ? 'التنبيهات مقفولة من المتصفح — فعّلها من الإعدادات.' : 'Notifications are blocked in the browser — enable them in settings.'
      : state === 'unsupported'
        ? isAr ? 'متصفحك لا يدعم التنبيهات — صفحة التتبع تتحدث تلقائيًا.' : 'This browser cannot notify — the tracking page updates itself.'
        : state === 'error'
          ? isAr ? 'تعذر التفعيل — حاول مجددًا.' : 'Could not enable — try again.'
          : null;

  return (
    <div>
      <button
        type="button"
        onClick={() => void onTap()}
        disabled={state === 'working'}
        className={`btn-tactile w-full h-11 px-5 rounded-full border text-xs font-extrabold inline-flex items-center justify-center gap-2 transition-colors ${
          darkMode
            ? 'border-[var(--primary)]/60 text-[var(--primary)] hover:bg-[var(--primary)] hover:text-[#0A0A0A]'
            : 'border-[#0A0A0A] text-[#0A0A0A] hover:bg-[#0A0A0A] hover:text-[var(--primary)]'
        } disabled:opacity-60`}
      >
        {state === 'working' ? <Loader2 size={15} className="animate-spin" /> : <BellRing size={15} />}
        {isAr ? 'نبّهني بحالة الطلب' : 'Notify me on updates'}
      </button>
      {note && (
        <p className={`mt-1.5 text-[11px] text-center flex items-center justify-center gap-1 ${darkMode ? 'text-neutral-500' : 'text-neutral-500'}`}>
          <BellOff size={11} />
          {note}
        </p>
      )}
    </div>
  );
};
