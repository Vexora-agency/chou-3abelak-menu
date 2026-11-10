import React, { useEffect, useState } from 'react';
import { BellOff, BellRing, Loader2 } from 'lucide-react';
import {
  ensureSW,
  fetchVapidKey,
  getExistingSub,
  isIosDevice,
  isPushCapable,
  isStandaloneApp,
  postJson,
  subscribeDevice,
} from '@/src/utils/webpush';

interface KitchenSystemAlertsProps {
  lang: 'en' | 'ar';
}

type State = 'idle' | 'working' | 'on' | 'denied' | 'unsupported' | 'ios' | 'error';

/**
 * Kitchen system-alerts opt-in. The in-page bell needs an open tab and a
 * first tap (browser autoplay policy); the OS notification fired here
 * reaches the device with the phone locked. Transport reuses
 * subscribeDevice from webpush.ts; the subscription is saved against the
 * admin session (server-enforced), exactly like the customer flow but on
 * /api/admin/push-subscriptions.
 */
export const KitchenSystemAlerts: React.FC<KitchenSystemAlertsProps> = ({ lang }) => {
  const isAr = lang === 'ar';
  const [state, setState] = useState<State>('idle');
  const [errDetail, setErrDetail] = useState('');
  const [needsInstall] = useState<boolean>(() => isIosDevice() && !isStandaloneApp());

  // Already subscribed on this browser? Show on — no second prompt.
  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        if (!isPushCapable()) return;
        const sub = await getExistingSub();
        if (!stop && sub) setState('on');
      } catch {}
    })();
    return () => {
      stop = true;
    };
  }, []);

  const deviceLabel = () => {
    try {
      if (isIosDevice()) return 'iPhone/iPad';
      const ua = navigator.userAgent;
      if (/android/i.test(ua)) return 'Android';
      if (/windows/i.test(ua)) return 'Windows';
      if (/macintosh/i.test(ua)) return 'Mac';
      return 'Browser';
    } catch {
      return '';
    }
  };

  const onEnable = async () => {
    if (state === 'working' || state === 'on') return;
    if (!isPushCapable()) {
      setState(isIosDevice() ? 'ios' : 'unsupported');
      return;
    }
    setState('working');
    setErrDetail('');
    try {
      try {
        await ensureSW();
      } catch {
        setErrDetail('SW');
        setState('error');
        return;
      }
      const key = await fetchVapidKey();
      if (!key) {
        setErrDetail('KEY');
        setState('error');
        return;
      }
      let result;
      try {
        result = await subscribeDevice(key);
      } catch {
        setErrDetail('SUB');
        setState('error');
        return;
      }
      if (result.status === 'denied') {
        setState('denied');
        return;
      }
      if (result.status !== 'subscribed' || !result.sub) {
        setState(isIosDevice() ? 'ios' : 'unsupported');
        return;
      }
      const saved = await postJson(
        '/api/admin/push-subscriptions',
        { ...result.sub, label: `kitchen:${deviceLabel()}` },
        true
      );
      if (!saved.ok) {
        setErrDetail(`SAVE-${saved.status ?? 'net'}:${saved.err || 'unknown'}`);
        setState('error');
        return;
      }
      setState('on');
    } catch {
      setErrDetail('UNK');
      setState('error');
    }
  };

  const note =
    state === 'denied'
      ? isAr ? 'التنبيهات محظورة من المتصفح — فعّلها من إعدادات الموقع.' : 'Notifications are blocked — allow them in site settings.'
      : state === 'unsupported'
        ? isAr ? 'هذا المتصفح لا يدعم تنبيهات النظام.' : 'This browser cannot do system alerts.'
        : state === 'error'
          ? errDetail.startsWith('SAVE-401') || errDetail.startsWith('SAVE-403')
            ? isAr ? 'انتهت جلسة الدخول — سجّل الخروج والدخول مجددًا ثم فعّل.' : 'Session expired — log out and back in, then enable.'
            : isAr ? `تعذر الحفظ (${errDetail}) — أرسل هذا السطر كاملًا.` : `Could not save (${errDetail}) — send this full line.`
          : null;

  return (
    <div
      className="mb-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-4 flex flex-col gap-3"
      dir={isAr ? 'rtl' : 'ltr'}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ${state === 'on' ? 'bg-[var(--primary)] text-[#0A0A0A]' : 'bg-[var(--primary)]/10 text-[var(--primary)]'}`}>
            <BellRing size={17} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-black text-white">
              {isAr ? 'تفعيل تنبيهات النظام' : 'Enable system alerts'}
            </p>
            <p className="text-[11px] text-neutral-500">
              {state === 'on'
                ? (isAr ? 'مفعّلة على هذا الجهاز' : 'Active on this device')
                : (isAr ? 'تنبيه لكل طلب جديد — حتى والهاتف مقفل' : 'An alert per new order — even with the phone locked')}
            </p>
          </div>
        </div>
        {state !== 'on' && (
          <button
            type="button"
            onClick={() => void onEnable()}
            disabled={state === 'working'}
            className="btn-tactile shrink-0 h-11 min-h-[44px] px-5 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-xs font-extrabold inline-flex items-center gap-1.5 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            {state === 'working' ? <Loader2 size={14} className="animate-spin" /> : <BellRing size={14} />}
            {isAr ? 'تفعيل' : 'Enable'}
          </button>
        )}
      </div>
      {/* Bell-vs-push contrast: why both exist. */}
      <p className="text-[11px] leading-relaxed text-neutral-500 rounded-xl border border-neutral-800 bg-black/40 p-2.5">
        {isAr
          ? 'الجرس الداخلي يحتاج تبويبًا مفتوحًا ولمسة أولى (قيد المتصفح) — أما تنبيه النظام فيصلك والهاتف مقفل.'
          : 'The in-page bell needs an open tab and a first tap (a browser limit) — the system alert reaches you with the phone locked.'}
      </p>
      {(state === 'ios' || (needsInstall && state === 'idle')) && (
        <p className="text-[11px] leading-relaxed text-neutral-400 rounded-xl border border-neutral-800 bg-black/40 p-2.5">
          {isAr
            ? 'للآيفون: ثبّت الشاشة أولًا (مشاركة ← إضافة للشاشة الرئيسية) ثم فعّل من الأيقونة المثبتة.'
            : 'For iPhone: install the screen first (Share → Add to Home Screen), then enable from the installed icon.'}
        </p>
      )}
      {note && (
        <p className="text-[11px] text-neutral-500 inline-flex items-center gap-1">
          <BellOff size={11} />
          {note}
        </p>
      )}
    </div>
  );
};
