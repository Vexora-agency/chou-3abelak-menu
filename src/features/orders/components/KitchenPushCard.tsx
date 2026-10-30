import React, { useEffect, useState } from 'react';
import { BellRing, BellOff, Loader2, Smartphone } from 'lucide-react';
import {
  fetchVapidKey, ensureSW, getExistingSub, isIosDevice, isPushCapable, isStandaloneApp,
  postJson, subscribeDevice, unsubscribeLocal,
} from '@/src/utils/webpush';
import { adminFetch } from '@/src/lib/api-client';

interface KitchenPushCardProps {
  lang: 'en' | 'ar';
}

type State = 'idle' | 'working' | 'on' | 'denied' | 'unsupported' | 'ios' | 'error';

/**
 * Kitchen alerts: subscribes THIS owner device (phone/laptop) so every new
 * order pushes a system notification — dashboard open or not, browser open
 * or not (OS rules apply: iOS needs the admin installed to Home Screen).
 * Subscription requires the admin session (server-enforced); payloads carry
 * number + total only, details open behind the login.
 */
export const KitchenPushCard: React.FC<KitchenPushCardProps> = ({ lang }) => {
  const isAr = lang === 'ar';
  const [state, setState] = useState<State>('idle');
  const [devices, setDevices] = useState<number | null>(null);
  // iPhone tab (not installed): push is impossible here by Apple policy —
  // say so UP FRONT instead of after the tap, with the install path.
  const [needsInstall] = useState<boolean>(() => isIosDevice() && !isStandaloneApp());

  const refreshCount = async () => {
    try {
      const res = await adminFetch('/api/admin/push-subscriptions');
      if (!res.ok) return;
      const data = (await res.json()) as { devices?: unknown[] };
      if (Array.isArray(data.devices)) setDevices(data.devices.length);
    } catch {}
  };

  // Bound already (previous visit)? Show on — tapping re-binds anyway.
  useEffect(() => {
    let stop = false;
    (async () => {
      void refreshCount();
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
      const ok = await postJson(
        '/api/admin/push-subscriptions',
        { ...result.sub, label: deviceLabel() },
        true
      );
      setState(ok ? 'on' : 'error');
      if (ok) void refreshCount();
    } catch {
      setState('error');
    }
  };

  const onDisable = async () => {
    setState('working');
    try {
      const sub = await getExistingSub();
      if (sub) {
        try {
          await adminFetch('/api/admin/push-subscriptions', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          });
        } catch {}
      }
      await unsubscribeLocal();
      setState('idle');
      void refreshCount();
    } catch {
      setState('error');
    }
  };

  const note =
    state === 'denied'
      ? isAr ? 'التنبيهات محظورة من المتصفح — فعّلها من إعدادات الموقع.' : 'Notifications are blocked — allow them in site settings.'
      : state === 'unsupported'
        ? isAr ? 'هذا المتصفح لا يدعم تنبيهات الخلفية.' : 'This browser cannot do background alerts.'
        : state === 'error'
          ? isAr ? 'تعذر الحفظ — حاول مجددًا.' : 'Could not save — try again.'
          : null;

  const on = state === 'on';

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${on ? 'bg-[var(--primary)] text-[#0A0A0A]' : 'bg-[var(--primary)]/10 text-[var(--primary)]'}`}>
            <Smartphone size={17} />
          </span>
          <div>
            <p className="text-sm font-black text-white">{isAr ? 'إشعارات المطبخ' : 'Kitchen alerts'}</p>
            <p className="text-[11px] text-neutral-500">
              {isAr
                ? 'كل طلب جديد يرنّ على هذا الجهاز — حتى واللوحة مقفولة.'
                : 'Every new order pings this device — even with the panel closed.'}
              {devices !== null && devices > 0 ? (isAr ? ` (${devices} ${devices === 1 ? 'جهاز' : 'أجهزة'})` : ` (${devices})`) : ''}
            </p>
          </div>
        </div>
        {on ? (
          <button
            type="button"
            onClick={() => void onDisable()}
            className="btn-tactile shrink-0 h-9 px-4 rounded-full border border-green-500/50 text-green-400 text-xs font-extrabold inline-flex items-center gap-1.5"
          >
            <BellRing size={14} />
            {isAr ? 'مفعّلة — إيقاف' : 'On — turn off'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void onEnable()}
            disabled={state === 'working'}
            className="btn-tactile shrink-0 h-9 px-4 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-xs font-extrabold inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            {state === 'working' ? <Loader2 size={14} className="animate-spin" /> : <BellRing size={14} />}
            {isAr ? 'تفعيل' : 'Enable'}
          </button>
        )}
      </div>
      {(state === 'ios' || (needsInstall && state === 'idle')) && (
        <p className="text-[11px] leading-relaxed text-neutral-400 rounded-xl border border-neutral-800 bg-black/40 p-2.5">
          {isAr
            ? 'للآيفون: افتح اللوحة في سفاري ← مشاركة ← إضافة للشاشة الرئيسية ← افتح أيقونة اللوحة ← فعّل من هناك.'
            : 'For iPhone: open the panel in Safari → Share → Add to Home Screen → open the panel icon → enable from there.'}
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
