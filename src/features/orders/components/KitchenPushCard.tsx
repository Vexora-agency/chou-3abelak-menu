import React, { useEffect, useState } from 'react';
import { BellRing, BellOff, Loader2, Smartphone } from 'lucide-react';
import {
  fetchVapidKey, ensureSW, getExistingSub, isIosDevice, isPushCapable, isStandaloneApp,
  postJson, subscribeDevice, unsubscribeLocal,
} from '@/src/utils/webpush';
import { useInstallPrompt } from '@/src/hooks/useInstallPrompt';
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
  // Precise failure stage for remote diagnosis (SW / KEY / SUB / SAVE+status).
  const [errDetail, setErrDetail] = useState<string>('');
  // iPhone tab (not installed): push is impossible here by Apple policy —
  // say so UP FRONT instead of after the tap, with the install path.
  const [needsInstall] = useState<boolean>(() => isIosDevice() && !isStandaloneApp());
  // Android/desktop: the OS offers a real one-tap install sheet.
  const { canInstall, install } = useInstallPrompt();
  const [installing, setInstalling] = useState(false);

  const refreshCount = async () => {
    try {
      const res = await adminFetch('/api/admin/push-subscriptions');
      if (!res.ok) return;
      const data = (await res.json()) as { devices?: unknown[] };
      if (Array.isArray(data.devices)) setDevices(data.devices.length);
    } catch {}
  };

  // Bound already (previous visit)? Re-register it with the server on mount:
  // a local subscription with a missing server row would otherwise show "on"
  // and receive nothing (DB reset / session re-login / origin change).
  useEffect(() => {
    let stop = false;
    (async () => {
      void refreshCount();
      try {
        if (!isPushCapable()) return;
        const sub = await getExistingSub();
        if (stop || !sub) return;
        const saved = await postJson(
          '/api/admin/push-subscriptions',
          { ...sub, label: deviceLabel() },
          true
        );
        if (stop) return;
        if (saved.ok) {
          setState('on');
          void refreshCount();
        } else {
          // Keep the button available; the next tap shows the exact reason.
          setState('idle');
        }
      } catch {}
    })();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only bind
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
        { ...result.sub, label: deviceLabel() },
        true
      );
      if (!saved.ok) {
        // 401/403 = admin session gone (re-login); anything else shows the
        // server's own reason so one tap diagnoses it (e.g. a header the
        // installed app doesn't send).
        setErrDetail(`SAVE-${saved.status ?? 'net'}:${saved.err || 'unknown'}`);
        setState('error');
        return;
      }
      setState('on');
      void refreshCount();
    } catch {
      setErrDetail('UNK');
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
          ? errDetail.startsWith('SAVE-401') || errDetail.startsWith('SAVE-403')
            ? isAr ? 'انتهت جلسة الدخول — سجّل الخروج والدخول مجددًا ثم فعّل.' : 'Admin session expired — log out and back in, then enable.'
            : errDetail.includes('bad_subscription')
              ? isAr
                ? `هذا المتصفح أعطى اشتراكًا مرفوضًا — احذف الأيقونة وأعد تثبيتها من /admin ثم فعّل. (${errDetail})`
                : `This browser gave a rejected subscription — remove the icon, re-add from /admin, then enable. (${errDetail})`
              : errDetail.includes('Missing Origin')
                ? isAr
                  ? `التطبيق المثبت لا يرسل الترويسة المطلوبة — حدّث iOS وكرر التثبيت من سفاري. (${errDetail})`
                  : `The installed app omits a required header — update iOS and reinstall from Safari. (${errDetail})`
                : isAr ? `تعذر الحفظ (${errDetail}) — أرسل هذا السطر كاملًا.` : `Could not save (${errDetail}) — send this full line.`
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
            <p className="text-sm font-black text-white">{isAr ? 'تنبيهات الطلبات الجديدة' : 'New order alerts'}</p>
            <p className="text-[11px] text-neutral-500">
              {isAr
                ? 'كل طلب جديد يرنّ على هذا الجهاز — حتى عندما تكون اللوحة مغلقة.'
                : 'Every new order pings this device — even with the panel closed.'}
              {devices !== null && devices > 0 ? (isAr ? ` (${devices} ${devices === 1 ? 'جهاز' : 'أجهزة'})` : ` (${devices})`) : ''}
            </p>
          </div>
        </div>
        {on ? (
          <button
            type="button"
            onClick={() => void onDisable()}
            className="btn-tactile shrink-0 h-9 px-4 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-xs font-extrabold inline-flex items-center gap-1.5 hover:brightness-110"
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
            ? 'للآيفون: افتح اللوحة في سفاري ← مشاركة ← إضافة للشاشة الرئيسية ← افتح أيقونة اللوحة ← فعّل من هناك. (آبل لا تسمح بالتثبيت التلقائي — الخطوات إجبارية.)'
            : 'For iPhone: open the panel in Safari → Share → Add to Home Screen → open the panel icon → enable from there. (Apple forbids auto-install — manual steps only.)'}
        </p>
      )}
      {canInstall && !isStandaloneApp() && (
        <button
          type="button"
          disabled={installing}
          onClick={() => {
            setInstalling(true);
            void install().finally(() => setInstalling(false));
          }}
          className="btn-tactile h-10 px-4 rounded-full border border-[var(--primary)]/60 text-[var(--primary)] text-xs font-extrabold inline-flex items-center justify-center gap-2 disabled:opacity-60"
        >
          <Smartphone size={14} />
          {installing
            ? (isAr ? 'جارٍ التثبيت…' : 'Installing…')
            : (isAr ? 'ثبّت اللوحة على الجهاز (ضغطة واحدة)' : 'Install the panel (one tap)')}
        </button>
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
