import React, { useEffect, useState } from 'react';
import { Check, Copy, Loader2, Send, Unlink } from 'lucide-react';
import type { AdminFetch } from '@/src/lib/api-client';

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
}

interface TgStatus {
  linked?: boolean;
  linkedAt?: string | null;
  botUsername?: string | null;
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
 * Telegram owner notifications — pairing UI (Phase 2+3).
 * Shows link status, saves the public bot username (BotFather), issues
 * one-time pairing codes (10 min, single-use), and disconnects.
 * Secrets (bot token, webhook secret) are Cloudflare Pages env secrets —
 * set in the dashboard, never through this UI, never displayed.
 */
export const TelegramSection: React.FC<TelegramSectionProps> = ({ lang, adminFetch, onConfirm }) => {
  const isAr = lang === 'ar';
  const [status, setStatus] = useState<TgStatus | null>(null);
  const [botUsername, setBotUsername] = useState('');
  const [pair, setPair] = useState<{ code: string; deepLink: string | null; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refresh = async () => {
    try {
      const res = await adminFetch('/api/admin/telegram');
      if (!res.ok) return;
      const data = (await res.json()) as TgStatus;
      setStatus(data);
      if (typeof data.botUsername === 'string') setBotUsername(data.botUsername);
    } catch {}
  };

  useEffect(() => {
    let stop = false;
    void (async () => {
      if (stop) return;
      await refresh();
    })();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminFetch]);

  const say = (kind: 'ok' | 'err', text: string) => setMsg({ kind, text });

  const saveUsername = async () => {
    const name = botUsername.trim();
    if (!name) return;
    setBusy('username');
    setMsg(null);
    try {
      const res = await adminFetch('/api/admin/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save-username', botUsername: name }),
      });
      if (!res.ok) {
        say('err', isAr ? 'اسم البوت غير صالح.' : 'Invalid bot username.');
      } else {
        say('ok', isAr ? 'حُفظ اسم البوت.' : 'Bot username saved.');
        await refresh();
      }
    } catch {
      say('err', isAr ? 'تعذر الحفظ.' : 'Could not save.');
    } finally {
      setBusy(null);
    }
  };

  const newCode = async () => {
    setBusy('code');
    setMsg(null);
    try {
      const res = await adminFetch('/api/admin/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pair-code' }),
      });
      const data = (await res.json().catch(() => null)) as {
        code?: string; deepLink?: string | null; expiresAt?: string; needsUsername?: boolean;
      } | null;
      if (!res.ok || !data?.code) {
        say('err', isAr ? 'تعذر إنشاء كود الربط.' : 'Could not create a pairing code.');
      } else {
        setPair({ code: data.code, deepLink: data.deepLink ?? null, expiresAt: data.expiresAt ?? '' });
        if (data.needsUsername) {
          say('ok', isAr
            ? 'تم إنشاء الكود — احفظ اسم البوت أولًا ليظهر رابط مباشر.'
            : 'Code created — save the bot username first to get a direct link.');
        } else {
          say('ok', isAr ? 'تم إنشاء كود ربط (صالح 10 دقائق، استخدام واحد).' : 'Pairing code created (10 min, single-use).');
        }
      }
    } catch {
      say('err', isAr ? 'تعذر إنشاء الكود.' : 'Could not create a code.');
    } finally {
      setBusy(null);
    }
  };

  const copyLink = async () => {
    const text = pair?.deepLink || pair?.code || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      say('ok', isAr ? 'نُسخ الرابط.' : 'Link copied.');
    } catch {
      say('err', isAr ? 'تعذر النسخ.' : 'Could not copy.');
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
        say('err', isAr ? 'تعذر فك الربط.' : 'Could not disconnect.');
      } else {
        setPair(null);
        say('ok', isAr ? 'تم فك ربط Telegram.' : 'Telegram unlinked.');
        await refresh();
      }
    } catch {
      say('err', isAr ? 'تعذر فك الربط.' : 'Could not disconnect.');
    } finally {
      setBusy(null);
    }
  };

  const askDisconnect = () => {
    const box = {
      title: isAr ? 'فك ربط Telegram؟' : 'Unlink Telegram?',
      body: isAr
        ? 'ستتوقف إشعارات الطلبات على Telegram حتى تربط حسابًا جديدًا.'
        : 'Order notifications to Telegram will stop until you link again.',
      confirmText: isAr ? 'فك الربط' : 'Unlink',
      mode: 'confirm' as const,
      action: () => void doDisconnect(),
    };
    if (onConfirm) onConfirm(box);
    else if (window.confirm(box.body)) void doDisconnect();
  };

  const field = 'w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)]';
  const lbl = 'block text-xs text-neutral-400 mb-1';

  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-extrabold text-[var(--primary)] uppercase tracking-wider">
            {isAr ? 'إشعارات Telegram للمالك' : 'Telegram owner notifications'}
          </h2>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            {isAr
              ? 'اربط حسابك ليصلك إشعار فوري مع كل طلب جديد — بعد حفظ الطلب، وليس من المتصفح.'
              : 'Link your account to get an instant ping per new order — sent after the order saves, not from the browser.'}
          </p>
        </div>
        <span className={`shrink-0 text-[11px] font-extrabold px-2.5 py-1 rounded-full border ${status?.linked
          ? 'text-green-400 border-green-800 bg-green-950'
          : 'text-neutral-400 border-neutral-700 bg-black'}`}>
          {status?.linked ? (isAr ? '● مرتبط' : '● linked') : (isAr ? '○ غير مرتبط' : '○ not linked')}
        </span>
      </div>

      {status && (!status.hasBotToken || !status.hasWebhookSecret) && (
        <p className="text-[11px] text-amber-400 bg-amber-950/40 border border-amber-900 rounded-lg px-3 py-2">
          {isAr
            ? 'ينقص إعداد السيرفر (bot token / webhook secret) — ضعهما من Cloudflare Pages → Settings → Environment variables، ثم اربط حسابك هنا.'
            : 'Server setup missing (bot token / webhook secret) — set them in Cloudflare Pages → Settings → Environment variables, then link here.'}
        </p>
      )}

      <div>
        <label className={lbl}>{isAr ? 'اسم البوت (من BotFather)' : 'Bot username (from BotFather)'}</label>
        <div className="flex gap-2">
          <input value={botUsername} dir="ltr" spellCheck={false} autoComplete="off"
            onChange={(e) => setBotUsername(e.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 32))}
            placeholder="YourRestaurantBot" className={`${field} flex-1 min-w-0`} />
          <button type="button" onClick={() => void saveUsername()} disabled={busy === 'username' || !botUsername.trim()}
            className="btn-tactile shrink-0 h-10 px-4 rounded-lg bg-[var(--primary)] text-[#0A0A0A] text-xs font-extrabold disabled:opacity-40">
            {busy === 'username' ? <Loader2 size={14} className="animate-spin" /> : (isAr ? 'حفظ' : 'Save')}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2.5">
        <button type="button" onClick={() => void newCode()} disabled={busy === 'code'}
          className="btn-tactile h-11 px-5 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-sm font-extrabold inline-flex items-center gap-2 disabled:opacity-40">
          {busy === 'code' ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} />}
          {isAr ? 'إنشاء رابط ربط' : 'Generate pairing link'}
        </button>
        {status?.linked && (
          <button type="button" onClick={askDisconnect} disabled={busy === 'drop'}
            className="btn-tactile h-11 px-5 rounded-full border border-red-900 text-red-400 text-sm font-bold inline-flex items-center gap-2 disabled:opacity-40 hover:border-red-500">
            {busy === 'drop' ? <Loader2 size={16} className="animate-spin" /> : <Unlink size={15} />}
            {isAr ? 'فك الربط' : 'Unlink'}
          </button>
        )}
      </div>

      {pair && (
        <div className="rounded-xl bg-black border border-neutral-700 p-3 space-y-2">
          <p className="text-[11px] text-neutral-400">
            {isAr
              ? 'افتح الرابط من هاتفك (أو أرسل /start متبوعًا بالكود للبوت). صالح 10 دقائق واستخدام واحد فقط.'
              : 'Open the link from your phone (or send /start + code to the bot). Valid 10 minutes, single-use.'}
          </p>
          {pair.deepLink ? (
            <div className="flex gap-2 items-center">
              <a href={pair.deepLink} target="_blank" rel="noreferrer" dir="ltr"
                className="flex-1 min-w-0 truncate text-xs text-[var(--primary)] underline underline-offset-2">
                {pair.deepLink}
              </a>
              <button type="button" onClick={() => void copyLink()}
                className="btn-tactile shrink-0 h-9 px-3 rounded-lg border border-neutral-700 text-neutral-200 text-xs font-bold inline-flex items-center gap-1.5 hover:border-[var(--primary)]">
                <Copy size={13} />{isAr ? 'نسخ' : 'Copy'}
              </button>
            </div>
          ) : (
            <p dir="ltr" className="text-xs font-mono text-neutral-200 break-all">/start {pair.code}</p>
          )}
        </div>
      )}

      {status?.lastNotification && (
        <p className={`text-[11px] rounded-lg px-3 py-2 border ${status.lastNotification.status === 'sent'
          ? 'text-green-400 border-green-900 bg-green-950/40'
          : 'text-amber-400 border-amber-900 bg-amber-950/40'}`}>
          {isAr ? 'آخر إشعار: ' : 'Last notification: '}
          <span dir="ltr" className="font-mono">#{status.lastNotification.orderNumber}</span>
          {' · '}
          {status.lastNotification.status === 'sent'
            ? (isAr ? 'وصل ✅' : 'delivered ✅')
            : (isAr ? `فشل (محاولات: ${status.lastNotification.attempts ?? 0})` : `failed (attempts: ${status.lastNotification.attempts ?? 0})`)}
        </p>
      )}

      {msg && (
        <p role="status" className={`text-xs font-bold ${msg.kind === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
          {msg.kind === 'ok' ? <Check size={12} className="inline me-1" /> : null}{msg.text}
        </p>
      )}
    </div>
  );
};
