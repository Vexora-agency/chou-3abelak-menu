import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Check, Ban, Plus, Power, Trash2, Loader2, Send } from 'lucide-react';
import type { AdminFetch } from '@/src/lib/api-client';
import { readJson } from '@/src/utils/safeJson';
import { SettingsGroupBody, SettingsGroupHeader } from './SettingsCollapsible';

/** Invite/account role. Server may not know `role` yet (pre-role DB/API):
 *  every read normalizes unknown/missing values to 'client'. This section
 *  only ever shows the 'kitchen' slice — client rows stay in AccessSection. */
type InviteRole = 'client' | 'kitchen';

const normRole = (r?: string | null): InviteRole => (r === 'kitchen' ? 'kitchen' : 'client');

/** Invite lifetime picked at creation. `null` = open (no expiry); the
 *  `durationDays` field is ignored by pre-duration servers (extra field)
 *  and honored once server-side support lands — safe both ways. */
type InviteDuration = 1 | 7 | 30 | null;

const DURATION_OPTS: Array<{ key: string; value: InviteDuration; ar: string; en: string }> = [
  { key: '1', value: 1, ar: '24 ساعة', en: '24 hours' },
  { key: '7', value: 7, ar: '7 أيام', en: '7 days' },
  { key: '30', value: 30, ar: '30 يوم', en: '30 days' },
  { key: 'open', value: null, ar: 'مفتوحة', en: 'Open' },
];

interface InviteRow {
  id: string;
  username: string;
  createdAt: string;
  expiresAt?: string | null;
  status: 'pending' | 'used' | 'expired';
  role?: string;
}

interface ClientRow {
  username: string;
  createdAt: string;
  disabled: boolean;
  role?: string;
  expiresAt?: string | null;
}

interface DeliveryChatRow {
  chatId: number;
  label?: string | null;
  linkedAt?: string | null;
}

interface TeamAccessSectionProps {
  lang: 'en' | 'ar';
  adminFetch: AdminFetch;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onConfirm?: (box: {
    title: string;
    body: string;
    confirmText: string;
    mode?: 'confirm' | 'info';
    action?: () => void;
  }) => void;
}

/**
 * Team & crew access (moved out of AccessSection): kitchen invite links +
 * kitchen logins, plus delivery-crew Telegram sharing. Owner-only by
 * construction — the endpoints 403 non-master sessions, and then this whole
 * section hides itself (a client login never sees it).
 */
export const TeamAccessSection: React.FC<TeamAccessSectionProps> = ({ lang, adminFetch, collapsed = false, onToggleCollapse, onConfirm }) => {
  const isAr = lang === 'ar';
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<InviteRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [name, setName] = useState('');
  const [durationDays, setDurationDays] = useState<InviteDuration>(null);
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [formErr, setFormErr] = useState('');
  const [fresh, setFresh] = useState<{ link: string; username: string; expiresAt: string; role: InviteRole } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  // Delivery-crew sharing (moved here from AccessSection): invite link
  // state lives apart from the web-invite flow so the two never clobber
  // each other. Same bot, order copies + same Telegram buttons as the owner.
  const [crewLink, setCrewLink] = useState<string | null>(null);
  const [crewBusy, setCrewBusy] = useState<string | null>(null);
  const [crewCopied, setCrewCopied] = useState(false);
  const [crewChats, setCrewChats] = useState<DeliveryChatRow[]>([]);
  const [crewMsg, setCrewMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refreshCrew = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/telegram');
      if (!res.ok) return;
      const data = (await readJson(res)) as { deliveryChats?: DeliveryChatRow[] | null };
      setCrewChats(Array.isArray(data?.deliveryChats) ? data.deliveryChats : []);
    } catch {}
  }, [adminFetch]);

  const refresh = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/invites/list');
      if (res.status === 403) {
        setAllowed(false);
        return;
      }
      const data = (await readJson(res)) as { ok?: boolean; invites?: InviteRow[]; clients?: ClientRow[] };
      if (res.ok && data && data.ok && Array.isArray(data.invites)) {
        setAllowed(true);
        setRows(data.invites);
        setClients(Array.isArray(data.clients) ? data.clients : []);
      } else {
        setAllowed(false);
      }
    } catch {
      setAllowed(false);
    }
  }, [adminFetch]);

  useEffect(() => {
    void refresh();
    void refreshCrew();
  }, [refresh, refreshCrew]);

  // Not the owner (or unreachable): this section does not exist here.
  if (allowed === null) return null;
  if (allowed === false) return null;

  const kitchenRows = rows.filter((r) => normRole(r.role) === 'kitchen');
  const kitchenClients = clients.filter((c) => normRole(c.role) === 'kitchen');

  const create = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const username = name.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{1,30}$/.test(username)) {
      setFormErr(isAr ? 'من 2 إلى 31 حرفًا: أحرف صغيرة وأرقام و - و _' : '2-31 chars: lowercase, digits, - or _');
      return;
    }
    setBusy(true);
    setFormErr('');
    setFresh(null);
    try {
      const res = await adminFetch('/api/admin/invites/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // `durationDays` is ignored by pre-duration servers (extra field)
        // and honored once server-side duration support lands — safe both ways.
        body: JSON.stringify({ username, role: 'kitchen', durationDays }),
      });
      const data = (await readJson(res)) as { ok?: boolean; link?: string; username?: string; expiresAt?: string; role?: string; error?: string };
      if (res.ok && data && data.ok && data.link) {
        setFresh({ link: data.link, username: data.username || username, expiresAt: data.expiresAt || '', role: 'kitchen' });
        setName('');
        void refresh();
      } else if (data && data.error === 'exists') {
        setFormErr(isAr ? 'هذا الاسم لديه دخول بالفعل' : 'That name already has a login');
      } else if (data && data.error === 'pending') {
        setFormErr(isAr ? 'يوجد رابط غير مستخدم — احذفه أولًا' : 'An unused link exists — revoke it first');
      } else if (data && data.error === 'reserved') {
        setFormErr(isAr ? 'هذا الاسم محجوز لدخول المالك' : 'That name belongs to the master login');
      } else {
        setFormErr(isAr ? 'تعذر إنشاء الرابط' : 'Could not create the link');
      }
    } catch {
      setFormErr(isAr ? 'تعذر الاتصال' : 'Connection problem');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.link);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = fresh.link;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {}
      ta.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  /** Two-tap arm-then-fire for destructive actions (revoke invite, delete login). */
  const armed = (key: string, fire: () => Promise<void>) => {
    if (confirmKey !== key) {
      setConfirmKey(key);
      window.setTimeout(() => setConfirmKey((cur) => (cur === key ? null : cur)), 4000);
      return;
    }
    setConfirmKey(null);
    void fire();
  };

  const revoke = (id: string) =>
    armed(`revoke:${id}`, async () => {
      try {
        await adminFetch('/api/admin/invites/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
      } catch {}
      void refresh();
    });

  const updateClient = (username: string, action: 'disable' | 'enable' | 'delete') => {
    const fire = async () => {
      setActing(`${action}:${username}`);
      setFormErr('');
      try {
        const res = await adminFetch('/api/admin/clients/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, action }),
        });
        if (!res.ok) {
          setFormErr(isAr ? 'تعذر تنفيذ العملية' : 'Could not complete the action');
        }
      } catch {
        setFormErr(isAr ? 'تعذر الاتصال' : 'Connection problem');
      } finally {
        setActing(null);
        void refresh();
      }
    };
    // Deleting is forever — arm first. Disable/enable reverses in one tap.
    if (action === 'delete') armed(`delete:${username}`, fire);
    else void fire();
  };

  const invitePill = (s: InviteRow['status']) =>
    s === 'pending'
      ? 'bg-amber-500/10 border-amber-400/30 text-amber-300'
      : s === 'used'
        ? 'bg-green-500/10 border-green-500/30 text-green-400'
        : 'bg-neutral-800 border-neutral-700 text-neutral-500';

  /** Expiry chip text: dated when the response carries `expiresAt`, open otherwise. */
  const expiryText = (iso?: string | null): string => {
    const d = (iso || '').slice(0, 10);
    if (!d) return isAr ? 'مفتوح' : 'Open';
    return isAr ? `ينتهي في ${d}` : `Expires ${d}`;
  };

  /** Plain-https share targets (no new dependencies, per project policy). */
  const waShare = (link: string) => `https://wa.me/?text=${encodeURIComponent(link)}`;
  const tgShare = (link: string, text: string) =>
    `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;

  const copyText = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        return true;
      } catch {
        return false;
      }
    }
  };

  const inviteCrew = async () => {
    setCrewBusy('code');
    setCrewCopied(false);
    setCrewMsg(null);
    try {
      const res = await adminFetch('/api/admin/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delivery-code' }),
      });
      const data = (await readJson(res)) as { deepLink?: string | null };
      if (!res.ok || !data?.deepLink) {
        setCrewMsg({ kind: 'err', text: isAr ? 'تعذر إنشاء رابط الدليفري.' : 'Could not create the delivery link.' });
      } else {
        setCrewLink(data.deepLink);
        setCrewMsg({ kind: 'ok', text: isAr
          ? 'ابعت الرابط للدليفري — يفتحه ويضغط Start. الرابط صالح لعشر دقائق ولاستخدام واحد.'
          : 'Send the link to the courier — they open it and press Start. Single-use, ten minutes.' });
      }
    } catch {
      setCrewMsg({ kind: 'err', text: isAr ? 'تعذر إنشاء رابط الدليفري.' : 'Could not create the delivery link.' });
    } finally {
      setCrewBusy(null);
    }
  };

  const copyCrewLink = async () => {
    if (!crewLink) return;
    if (await copyText(crewLink)) {
      setCrewCopied(true);
      window.setTimeout(() => setCrewCopied(false), 2000);
    } else {
      setCrewMsg({ kind: 'err', text: isAr ? 'تعذر النسخ — انسخ الرابط يدويًا.' : 'Copy failed — copy the link manually.' });
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
        setCrewMsg({ kind: 'err', text: isAr ? 'تعذر إزالة الدليفري.' : 'Could not remove the courier.' });
      } else {
        setCrewMsg({ kind: 'ok', text: isAr ? 'تمت إزالة الدليفري — لن تصله طلبات جديدة.' : 'Courier removed — no more orders will reach them.' });
        await refreshCrew();
      }
    } catch {
      setCrewMsg({ kind: 'err', text: isAr ? 'تعذر إزالة الدليفري.' : 'Could not remove the courier.' });
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
        title={isAr ? 'دخول المطبخ والطاقم' : 'Kitchen & Crew Access'}
        subtitle={isAr
          ? 'دعوة المطبخ: امسح الرابط أو اضغطه للدخول فورًا — بلا كلمة سر، والرابط يموت بعد أول استخدام. اختر المدة قبل الإنشاء.'
          : 'Kitchen invite: scan or tap the link to enter instantly — no password, and the link dies after first use. Pick the duration before creating.'}
        lang={lang}
        collapsed={collapsed}
        onToggle={() => onToggleCollapse?.()}
      />
      <SettingsGroupBody open={!collapsed}>
      <form onSubmit={(e) => void create(e)} className="flex gap-2">
        <input
          type="text"
          dir="ltr"
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 31))}
          placeholder={isAr ? 'اسم دخول المطبخ، مثال: kitchen1' : 'Kitchen login name, e.g. kitchen1'}
          aria-label={isAr ? 'اسم دخول المطبخ' : 'Kitchen login name'}
          className="flex-1 min-w-0 h-11 min-h-[44px] px-3 rounded-lg bg-black border border-neutral-700 text-base tabular-nums focus:border-[var(--primary)] placeholder:text-neutral-600 outline-none"
        />
        <button
          type="submit"
          disabled={busy || name.trim().length < 2}
          className="btn-tactile h-11 min-h-[44px] px-5 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-xs font-extrabold hover:brightness-110 disabled:opacity-40 flex items-center gap-1.5 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          <Plus size={15} className="stroke-[3]" />
          {busy ? '…' : isAr ? 'إنشاء رابط' : 'Create link'}
        </button>
      </form>
      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <legend className="sr-only">{isAr ? 'مدة الدعوة' : 'Invite duration'}</legend>
        {DURATION_OPTS.map((o) => (
          <label key={o.key} className="flex items-center gap-1.5 text-xs font-bold text-neutral-300 cursor-pointer min-h-[44px]">
            <input
              type="radio"
              name="invite-duration-kitchen"
              value={o.key}
              checked={durationDays === o.value}
              onChange={() => setDurationDays(o.value)}
              className="h-4 w-4 accent-[var(--primary)]"
            />
            {isAr ? o.ar : o.en}
          </label>
        ))}
      </fieldset>
      {formErr ? (
        <p className="text-xs text-amber-400" role="alert">{formErr}</p>
      ) : null}

      {fresh ? (
        <div className="rounded-xl border border-[var(--primary)]/40 bg-black p-3 space-y-2">
          <p className="text-[11px] font-bold text-[var(--primary)]">
            {isAr ? `رابط ${fresh.username} — يُعرض مرة واحدة، انسخه الآن` : `${fresh.username}'s link — shown once, copy it now`}
            {' '}
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-sky-500/10 border-sky-500/30 text-sky-400">
              {isAr ? 'مطبخ' : 'Kitchen'}
            </span>
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              dir="ltr"
              value={fresh.link}
              onFocus={(e) => e.target.select()}
              className="flex-1 min-w-0 h-11 min-h-[44px] px-3 rounded-lg bg-neutral-900 border border-neutral-700 text-xs tabular-nums text-neutral-200 outline-none"
            />
            <button
              type="button"
              onClick={() => void copy()}
              className="h-11 min-h-[44px] px-5 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-xs font-extrabold hover:brightness-110 flex items-center gap-1.5 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            >
              {copied ? <Check size={15} className="stroke-[3]" /> : <Copy size={15} />}
              {copied ? (isAr ? 'تم' : 'Copied') : (isAr ? 'نسخ' : 'Copy')}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={waShare(fresh.link)}
              target="_blank"
              rel="noreferrer"
              className="h-9 px-4 rounded-full border border-neutral-700 text-neutral-300 text-[11px] font-bold inline-flex items-center gap-1.5 hover:border-[var(--primary)] hover:text-[var(--primary)]"
            >
              <Send size={13} />
              {isAr ? 'مشاركة واتساب' : 'Share via WhatsApp'}
            </a>
            <a
              href={tgShare(fresh.link, fresh.username)}
              target="_blank"
              rel="noreferrer"
              className="h-9 px-4 rounded-full border border-neutral-700 text-neutral-300 text-[11px] font-bold inline-flex items-center gap-1.5 hover:border-[var(--primary)] hover:text-[var(--primary)]"
            >
              <Send size={13} />
              {isAr ? 'مشاركة تليجرام' : 'Share via Telegram'}
            </a>
          </div>
          <p className="text-[10px] text-neutral-500">
            {isAr
              ? <>دعوة مطبخ: امسح الرابط أو اضغطه للدخول فورًا — بلا كلمة سر، والرابط يموت بعد أول استخدام. {fresh.expiresAt ? <>ينتهي في <span dir="ltr" className="tabular-nums">{fresh.expiresAt.slice(0, 10)}</span>.</> : <>مفتوح — بلا انتهاء.</>}</>
              : <>Kitchen invite: scan or tap the link to enter instantly — no password, and the link dies after first use. {fresh.expiresAt ? <>Expires <span dir="ltr" className="tabular-nums">{fresh.expiresAt.slice(0, 10)}</span>.</> : <>Open — no expiry.</>}</>}
          </p>
        </div>
      ) : null}

      {/* Live kitchen logins: disable locks out now (sessions die too), delete removes all. */}
      <div>
        <h3 className={`text-[11px] font-extrabold text-neutral-400 mb-2 ${isAr ? '' : 'uppercase tracking-wider'}`}>
          {isAr ? 'حسابات المطبخ' : 'Kitchen logins'}
        </h3>
        {kitchenClients.length ? (
          <ul className="space-y-2">
            {kitchenClients.map((c) => (
              <li
                key={c.username}
                className="flex items-center gap-2 rounded-xl bg-black border border-neutral-800 px-3 py-2"
              >
                <span className="font-bold text-sm tabular-nums" dir="ltr">{c.username}</span>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    c.disabled
                      ? 'bg-red-500/10 border-red-500/30 text-red-400'
                      : 'bg-green-500/10 border-green-500/30 text-green-400'
                  }`}
                >
                  {c.disabled ? (isAr ? 'موقوف' : 'disabled') : (isAr ? 'نشط' : 'active')}
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-sky-500/10 border-sky-500/30 text-sky-400">
                  {isAr ? 'مطبخ' : 'Kitchen'}
                </span>
                <span className="text-[10px] text-neutral-500 tabular-nums" dir="ltr">
                  {expiryText(c.expiresAt)}
                </span>
                <span className="ms-auto flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={acting !== null}
                    onClick={() => updateClient(c.username, c.disabled ? 'enable' : 'disable')}
                    title={c.disabled ? (isAr ? 'تفعيل' : 'Enable') : (isAr ? 'تعطيل الدخول فورًا' : 'Disable now')}
                    aria-label={c.disabled ? (isAr ? `تفعيل ${c.username}` : `Enable ${c.username}`) : (isAr ? `تعطيل ${c.username}` : `Disable ${c.username}`)}
                    className="h-8 w-8 rounded-full border border-neutral-700 text-neutral-400 hover:text-[var(--primary)] hover:border-[var(--primary)]/50 flex items-center justify-center transition-colors disabled:opacity-40"
                  >
                    <Power size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={acting !== null}
                    onClick={() => updateClient(c.username, 'delete')}
                    title={isAr ? 'حذف نهائي' : 'Delete forever'}
                    aria-label={isAr ? `حذف ${c.username} نهائيًا` : `Delete ${c.username} forever`}
                    className={`h-8 px-2.5 rounded-full text-[11px] font-bold border transition-colors flex items-center gap-1 disabled:opacity-40 ${
                      confirmKey === `delete:${c.username}`
                        ? 'border-red-500 text-red-400 hover:bg-red-500 hover:text-black'
                        : 'border-neutral-700 text-neutral-400 hover:text-red-400 hover:border-red-500/50'
                    }`}
                  >
                    <Trash2 size={13} />
                    {confirmKey === `delete:${c.username}` ? (isAr ? 'تأكيد؟' : 'Sure?') : (isAr ? 'حذف' : 'Delete')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-neutral-600">
            {isAr ? 'لا توجد حسابات مطبخ بعد — أنشئ رابط دعوة أعلاه.' : 'No kitchen logins yet — create an invite link above.'}
          </p>
        )}
      </div>

      {/* Pending kitchen invite links. */}
      <div>
        <h3 className={`text-[11px] font-extrabold text-neutral-400 mb-2 ${isAr ? '' : 'uppercase tracking-wider'}`}>
          {isAr ? 'روابط دعوة المطبخ' : 'Kitchen invite links'}
        </h3>
        {kitchenRows.length ? (
          <ul className="space-y-2">
            {kitchenRows.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-2.5 rounded-xl bg-black border border-neutral-800 px-3 py-2"
              >
                <span className="font-bold text-sm tabular-nums" dir="ltr">{r.username}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${invitePill(r.status)}`}>
                  {r.status === 'pending' ? (isAr ? 'بانتظار' : 'pending') : r.status === 'used' ? (isAr ? 'مُستخدم' : 'used') : (isAr ? 'منتهي' : 'expired')}
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-sky-500/10 border-sky-500/30 text-sky-400">
                  {isAr ? 'مطبخ' : 'Kitchen'}
                </span>
                <span className="text-[10px] text-neutral-500 tabular-nums ms-auto" dir="ltr">
                  {expiryText(r.expiresAt)}
                </span>
                {r.status === 'pending' ? (
                  <button
                    type="button"
                    onClick={() => revoke(r.id)}
                    className={`h-8 px-3 rounded-full text-[11px] font-bold border transition-colors flex items-center gap-1 ${
                      confirmKey === `revoke:${r.id}`
                        ? 'border-red-500 text-red-400 hover:bg-red-500 hover:text-black'
                        : 'border-neutral-700 text-neutral-400 hover:text-red-400 hover:border-red-500/50'
                    }`}
                  >
                    <Ban size={13} />
                    {confirmKey === `revoke:${r.id}` ? (isAr ? 'تأكيد الحذف؟' : 'Confirm?') : (isAr ? 'حذف' : 'Revoke')}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-neutral-600">
            {isAr ? 'لا توجد روابط دعوة مطبخ بعد.' : 'No kitchen invite links yet.'}
          </p>
        )}
      </div>
      {/* Delivery-crew sharing (moved here from the Access section):
          same bot, order copies + same Telegram buttons as the owner. */}
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
              {crewCopied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
              {crewCopied ? (isAr ? 'اتنسخ' : 'Copied') : (isAr ? 'نسخ' : 'Copy')}
            </button>
          </div>
        )}
        {crewLink && (
          <div className="flex flex-wrap gap-2">
            <a
              href={waShare(crewLink)}
              target="_blank"
              rel="noreferrer"
              className="h-9 px-4 rounded-full border border-neutral-700 text-neutral-300 text-[11px] font-bold inline-flex items-center gap-1.5 hover:border-[var(--primary)] hover:text-[var(--primary)]"
            >
              <Send size={13} />
              {isAr ? 'مشاركة واتساب' : 'Share via WhatsApp'}
            </a>
            <a
              href={tgShare(crewLink, isAr ? 'رابط الدليفري' : 'Delivery invite')}
              target="_blank"
              rel="noreferrer"
              className="h-9 px-4 rounded-full border border-neutral-700 text-neutral-300 text-[11px] font-bold inline-flex items-center gap-1.5 hover:border-[var(--primary)] hover:text-[var(--primary)]"
            >
              <Send size={13} />
              {isAr ? 'مشاركة تليجرام' : 'Share via Telegram'}
            </a>
          </div>
        )}
        {crewChats.length > 0 && (
          <div className="space-y-1.5">
            {crewChats.map((c) => {
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
        {crewMsg && (
          <p role="status" className={`text-xs font-bold rounded-xl px-3 py-2 border inline-flex items-center gap-1.5 ${
            crewMsg.kind === 'ok'
              ? 'text-[var(--primary)] border-[var(--primary)]/40 bg-[var(--primary)]/10'
              : 'text-red-400 border-red-800 bg-red-950/40'
          }`}>
            {crewMsg.kind === 'ok' ? <Check size={13} strokeWidth={3} /> : null}<span>{crewMsg.text}</span>
          </p>
        )}
      </div>
      </SettingsGroupBody>
    </div>
  );
};
