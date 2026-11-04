import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Loader2, Send, Unlink } from 'lucide-react';
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
  deliveryChats?: Array<{ chatId: number; label?: string | null; linkedAt?: string | null }> | null;
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
  // Delivery-crew sharing: invite link state lives apart from the owner
  // pairing above so the two flows never clobber each other.
  const [crewLink, setCrewLink] = useState<string | null>(null);
  const [crewBusy, setCrewBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
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

  const inviteCrew = async () => {
    setCrewBusy('code');
    setCopied(false);
    try {
      const res = await adminFetch('/api/admin/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delivery-code' }),
      });
      const data = (await res.json().catch(() => null)) as { deepLink?: string | null } | null;
      if (!res.ok || !data?.deepLink) {
        say('err', isAr ? 'تعذر إنشاء رابط الدليفري.' : 'Could not create the delivery link.');
      } else {
        setCrewLink(data.deepLink);
        say('ok', isAr
          ? 'ابعت الرابط للدليفري — يفتحه ويضغط Start. الرابط صالح لعشر دقائق ولاستخدام واحد.'
          : 'Send the link to the courier — they open it and press Start. Single-use, ten minutes.');
      }
    } catch {
      say('err', isAr ? 'تعذر إنشاء رابط الدليفري.' : 'Could not create the delivery link.');
    } finally {
      setCrewBusy(null);
    }
  };

  const copyCrewLink = async () => {
    if (!crewLink) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(crewLink);
      } else {
        const ta = document.createElement('textarea');
        ta.value = crewLink;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
    } catch {
      say('err', isAr ? 'تعذر النسخ — انسخ الرابط يدويًا.' : 'Copy failed — copy the link manually.');
    }
  };

  const doRemoveCrew = async (chatId: number) => {
    setCrewBusy(`drop:${chatId}`);
    try {
      const res = await adminFetch('/api/admin/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delivery-remove', chatId }),
      });
      if (!res.ok) {
        say('err', isAr ? 'تعذر إزالة الدليفري.' : 'Could not remove the courier.');
      } else {
        say('ok', isAr ? 'تمت إزالة الدليفري — لن تصله طلبات جديدة.' : 'Courier removed — no more orders will reach them.');
        await refresh();
      }
    } catch {
      say('err', isAr ? 'تعذر إزالة الدليفري.' : 'Could not remove the courier.');
    } finally {
      setCrewBusy(null);
    }
  };

  const askRemoveCrew = (chatId: number) => {
    const box = {
      title: isAr ? 'إزالة الدليفري؟' : 'Remove courier?',
      body: isAr
        ? 'لن تصل نسخ الطلبات الجديدة لهذا الحساب بعد الآن.'
        : 'New order copies will stop reaching this chat.',
      confirmText: isAr ? 'إزالة' : 'Remove',
      mode: 'confirm' as const,
      action: () => void doRemoveCrew(chatId),
    };
    if (onConfirm) onConfirm(box);
    else if (window.confirm(box.body)) void doRemoveCrew(chatId);
  };

  const formatLinkedAt = (iso: string | null | undefined): string | null => {
    if (!iso) return null;
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return null;
      return d.toLocaleString(isAr ? 'ar-u-nu-latn' : 'en-US', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    } catch {
      return null;
    }
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

      {/* Delivery-crew sharing: same bot, order copies + same buttons.
          Independent of the owner link above — crew never touches it. */}
      <div className="rounded-2xl border border-neutral-800 bg-black/40 p-3 space-y-2.5" role="group" aria-label={isAr ? 'مشاركة البوت مع الدليفري' : 'Share the bot with delivery'}>
        <p className="text-xs font-black text-neutral-200">
          {isAr ? 'مشاركة مع الدليفري' : 'Share with delivery'}
        </p>
        <p className="text-[11px] leading-relaxed text-neutral-400">
          {isAr
            ? 'الدليفري يشوف الطلبات ويقدر يأكد ويسلّم ويلغي من التيليجرام — نفس أزرارك.'
            : 'Delivery sees orders and can confirm, deliver and cancel from Telegram — same buttons as yours.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void inviteCrew()} disabled={crewBusy === 'code'}
            className="btn-tactile h-11 px-5 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-xs font-extrabold inline-flex items-center gap-2 disabled:opacity-40">
            {crewBusy === 'code' ? <Loader2 size={15} className="animate-spin" /> : <Send size={14} />}
            {isAr ? 'رابط دعوة للدليفري' : 'Invite delivery'}
          </button>
          {crewLink && (
            <a href={crewLink} target="_blank" rel="noreferrer"
              className="btn-tactile h-11 px-5 rounded-full border border-[var(--primary)] text-[var(--primary)] text-xs font-extrabold inline-flex items-center gap-2">
              {isAr ? 'فتح التيليجرام' : 'Open Telegram'}
            </a>
          )}
        </div>
        {crewLink && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              dir="ltr"
              value={crewLink}
              onFocus={(e) => e.target.select()}
              aria-label={isAr ? 'رابط الدعوة' : 'Invite link'}
              className="min-w-0 flex-1 h-11 px-3 rounded-lg bg-black border border-neutral-700 text-xs text-neutral-300 truncate focus:outline-none focus:border-[var(--primary)]"
            />
            <button type="button" onClick={() => void copyCrewLink()}
              aria-label={isAr ? 'نسخ الرابط' : 'Copy link'}
              className="btn-tactile shrink-0 h-11 min-h-[44px] min-w-[44px] px-3 rounded-full border border-neutral-700 text-neutral-300 text-xs font-bold inline-flex items-center gap-1.5 hover:border-[var(--primary)] hover:text-[var(--primary)]">
              {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
              {copied ? (isAr ? 'اتنسخ' : 'Copied') : (isAr ? 'نسخ' : 'Copy')}
            </button>
          </div>
        )}
        {Array.isArray(status?.deliveryChats) && status.deliveryChats.length > 0 && (
          <div className="space-y-1.5">
            {status.deliveryChats.map((c) => {
              const when = formatLinkedAt(c?.linkedAt);
              const dropping = crewBusy === `drop:${c.chatId}`;
              return (
                <div key={c.chatId} className="flex items-center justify-between gap-2 rounded-xl border border-neutral-800 bg-black/60 px-3 py-2">
                  <span className="min-w-0 text-xs font-bold text-neutral-200 truncate" dir="auto">
                    {isAr ? `دليفري #${c.chatId}` : `Delivery #${c.chatId}`}
                    {when && <span className="block text-[10px] font-normal text-neutral-500">{when}</span>}
                  </span>
                  <button type="button" onClick={() => askRemoveCrew(c.chatId)} disabled={dropping}
                    className="btn-tactile shrink-0 h-9 min-h-[36px] px-3 rounded-full border border-neutral-700 text-neutral-400 text-[11px] font-bold inline-flex items-center gap-1 disabled:opacity-40 hover:border-red-500 hover:text-red-400">
                    {dropping ? <Loader2 size={13} className="animate-spin" /> : null}
                    {isAr ? 'إزالة' : 'Remove'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

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
