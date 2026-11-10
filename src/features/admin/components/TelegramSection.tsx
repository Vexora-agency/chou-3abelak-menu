import React, { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Send, Unlink } from 'lucide-react';
import type { AdminFetch } from '@/src/lib/api-client';
import { SettingsGroupBody, SettingsGroupHeader } from './SettingsCollapsible';

interface TelegramSectionProps {
  lang: 'en' | 'ar';
  adminFetch: AdminFetch;
  onConfirm?: (box: {
    title: string;
    body: string;
    confirmText: string;
    mode?: 'confirm' | 'info';
    action?: () => void;
  }) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

interface TgStatus {
  linked?: boolean;
  linkedAt?: string | null;
  pairingPending?: boolean;
  pairingExpiresAt?: string | null;
  botConfigured?: boolean;
  hasBotToken?: boolean;
  hasWebhookSecret?: boolean;
  pairingTtlSec?: number;
  lastNotification?: {
    orderNumber?: number;
    status?: string;
    attempts?: number;
    updatedAt?: string | null;
    sentAt?: string | null;
  } | null;
}

/**
 * Telegram owner notifications — one-click pairing.
 * The owner only ever presses "Link" then "Open Telegram" and taps Start
 * in the chat. No usernames, no codes to type, no technical jargon.
 * (The bot itself is configured once by the developer via the
 * TELEGRAM_BOT_USERNAME Pages variable.)
 */
export const TelegramSection: React.FC<TelegramSectionProps> = ({ lang, adminFetch, onConfirm, collapsed = false, onToggleCollapse }) => {
  const isAr = lang === 'ar';
  const [status, setStatus] = useState<TgStatus | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // Edge-trigger for the one-time "linked" confirmation: the 15s poll would
  // otherwise re-set the same message on every tick.
  const wasLinkedRef = useRef<boolean | null>(null);

  const refresh = async () => {
    try {
      const res = await adminFetch('/api/admin/telegram');
      if (!res.ok) return;
      const data = (await res.json()) as TgStatus;
      setStatus(data);
      wasLinkedRef.current = data.linked === true;
    } catch {}
  };

  useEffect(() => {
    let stop = false;
    void (async () => {
      if (stop) return;
      await refresh();
    })();
    // While a pairing is in progress, poll until the owner presses Start
    // in Telegram — the pill flips to "linked" by itself, no refresh needed.
    // Idle-tab and already-linked polls are skipped (battery + data).
    const timer = window.setInterval(() => {
      if (stop || document.visibilityState !== 'visible') return;
      void (async () => {
        try {
          const res = await adminFetch('/api/admin/telegram');
          if (!res.ok || stop) return;
          const data = (await res.json()) as TgStatus;
          setStatus(data);
          // One-time brand confirmation on the false → true edge only.
          const linkedNow = data.linked === true;
          if (linkedNow && wasLinkedRef.current === false) {
            setDeepLink(null);
            setMsg({ kind: 'ok', text: isAr ? 'تم ربط Telegram — ستصلك إشعارات الطلبات فور وصولها.' : 'Telegram linked — order notifications will arrive instantly.' });
          }
          wasLinkedRef.current = linkedNow;
        } catch {}
      })();
    }, 15000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminFetch]);

  const say = (kind: 'ok' | 'err', text: string) => setMsg({ kind, text });

  const link = async () => {
    setBusy('code');
    setMsg(null);
    try {
      const res = await adminFetch('/api/admin/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pair-code' }),
      });
      const data = (await res.json().catch(() => null)) as { deepLink?: string | null } | null;
      if (!res.ok || !data?.deepLink) {
        say('err', isAr ? 'الربط غير متاح حاليًا — حاول لاحقًا.' : 'Linking is unavailable right now — try again later.');
      } else {
        setDeepLink(data.deepLink);
        say('ok', isAr
          ? 'اضغط "فتح Telegram" ثم اضغط Start في المحادثة — الرابط صالح لعشر دقائق.'
          : 'Tap "Open Telegram", then press Start in the chat — the link lasts ten minutes.');
      }
    } catch {
      say('err', isAr ? 'تعذر بدء الربط.' : 'Could not start linking.');
    } finally {
      setBusy(null);
    }
  };

  const doDisconnect = async () => {
    setBusy('drop');
    setMsg(null);
    try {
      const res = await adminFetch('/api/admin/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disconnect' }),
      });
      if (!res.ok) {
        say('err', isAr ? 'تعذر فك الربط.' : 'Could not unlink.');
      } else {
        setDeepLink(null);
        say('ok', isAr ? 'تم فك الربط.' : 'Unlinked.');
        await refresh();
      }
    } catch {
      say('err', isAr ? 'تعذر فك الربط.' : 'Could not unlink.');
    } finally {
      setBusy(null);
    }
  };

  const askDisconnect = () => {
    const box = {
      title: isAr ? 'فك الربط؟' : 'Unlink?',
      body: isAr
        ? 'ستتوقف إشعارات الطلبات على Telegram حتى تربط حسابك مجددًا.'
        : 'Order notifications on Telegram will stop until you link again.',
      confirmText: isAr ? 'فك الربط' : 'Unlink',
      mode: 'confirm' as const,
      action: () => void doDisconnect(),
    };
    if (onConfirm) onConfirm(box);
    else if (window.confirm(box.body)) void doDisconnect();
  };

  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800">
      <SettingsGroupHeader
        title={isAr ? 'إشعارات الطلبات' : 'Order notifications'}
        subtitle={isAr ? 'اربط حسابك ليصلك إشعار فوري مع كل طلب جديد.' : 'Link your account to get an instant ping with every new order.'}
        lang={lang}
        collapsed={collapsed}
        onToggle={() => onToggleCollapse?.()}
      />
      <SettingsGroupBody open={!collapsed}>
      <div className="flex justify-end">
        <span className={`shrink-0 text-[11px] font-extrabold px-2.5 py-1 rounded-full border ${status?.linked
          ? 'text-green-400 border-green-800 bg-green-950'
          : 'text-neutral-400 border-neutral-700 bg-black'}`}>
          {status?.linked ? (isAr ? '● مرتبط' : '● linked') : (isAr ? '○ غير مرتبط' : '○ not linked')}
        </span>
      </div>

      {!status?.linked && (
        <div className="flex flex-wrap gap-2.5">
          <button type="button" onClick={() => void link()} disabled={busy === 'code'}
            className="btn-tactile h-11 px-5 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-sm font-extrabold inline-flex items-center gap-2 disabled:opacity-40">
            {busy === 'code' ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} />}
            {deepLink || status?.pairingPending ? (isAr ? 'رابط جديد' : 'New link') : (isAr ? 'ربط Telegram' : 'Link Telegram')}
          </button>
          {deepLink && (
            <a href={deepLink} target="_blank" rel="noreferrer"
              className="btn-tactile h-11 px-5 rounded-full border border-[var(--primary)] text-[var(--primary)] text-sm font-extrabold inline-flex items-center gap-2">
              {isAr ? 'فتح Telegram' : 'Open Telegram'}
            </a>
          )}
        </div>
      )}

      {!status?.linked && !deepLink && status?.pairingPending && (
        <p className="text-[11px] text-neutral-400">
          {isAr
            ? 'في رابط ربط نشط — افتح Telegram واضغط Start لإتمامه، أو أنشئ رابطًا جديدًا.'
            : 'A pairing link is still active — press Start in Telegram to finish, or create a new link.'}
        </p>
      )}

      {status?.linked && (
        <button type="button" onClick={askDisconnect} disabled={busy === 'drop'}
          className="btn-tactile h-11 px-5 rounded-full border border-neutral-700 text-neutral-300 text-sm font-bold inline-flex items-center gap-2 disabled:opacity-40 hover:border-red-500 hover:text-red-400">
          {busy === 'drop' ? <Loader2 size={16} className="animate-spin" /> : <Unlink size={15} />}
          {isAr ? 'فك الربط' : 'Unlink'}
        </button>
      )}

      {/* Delivery-crew sharing moved to the Team & Crew group (TeamAccessSection)
          so every team invite lives in one place. This note is the pointer. */}
      <p className="text-[11px] text-neutral-500 rounded-xl px-3 py-2 border border-neutral-800 bg-black/40">
        {isAr
          ? 'مشاركة الطاقم (روابط الدليفري) انتقلت إلى قسم الفريق والطاقم — ستجدها في مجموعة «الفريق والطاقم».'
          : 'Crew sharing (delivery links) moved to the Team section — find it in the “Team & Crew” group.'}
      </p>

      {status?.lastNotification && (
        <p className={`text-[11px] rounded-xl px-3 py-2 border ${status.lastNotification.status === 'sent'
          ? 'text-green-400 border-green-800 bg-green-950/40'
          : 'text-amber-400 border-amber-800 bg-amber-950/40'}`}>
          {isAr ? 'آخر إشعار: ' : 'Last notification: '}
          <span dir="ltr" className="font-mono">#{status.lastNotification.orderNumber}</span>
          {' · '}
        {status.lastNotification.status === 'sent'
          ? (isAr ? 'وصل' : 'delivered')
          : (isAr ? `فشل (محاولات: ${status.lastNotification.attempts ?? 0})` : `failed (attempts: ${status.lastNotification.attempts ?? 0})`)}
        </p>
      )}

      {status && status.linked && !status.lastNotification && (
        <p className="text-[11px] text-neutral-500 rounded-xl px-3 py-2 border border-neutral-800 bg-black/40">
          {isAr ? 'لم تُرسل أي إشعارات بعد — ستظهر هنا فور وصول أول طلب.' : 'No notifications sent yet — the first order will appear here.'}
        </p>
      )}

      {msg && (
        <p role="status" className={`text-xs font-bold rounded-xl px-3 py-2 border inline-flex items-center gap-1.5 ${
          msg.kind === 'ok'
            ? 'text-[var(--primary)] border-[var(--primary)]/40 bg-[var(--primary)]/10'
            : 'text-red-400 border-red-800 bg-red-950/40'
        }`}>
          {msg.kind === 'ok' ? <Check size={13} strokeWidth={3} /> : null}<span>{msg.text}</span>
        </p>
      )}
      </SettingsGroupBody>
    </div>
  );
};
