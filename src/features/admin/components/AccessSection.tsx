import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Check, Ban, Plus, Power, Trash2, LogOut, Send } from 'lucide-react';
import type { AdminFetch } from '@/src/lib/api-client';
import { readJson } from '@/src/utils/safeJson';
import { SettingsGroupBody, SettingsGroupHeader } from './SettingsCollapsible';

/** Invite/account role. Server may not know `role` yet (pre-role DB/API):
 *  every read normalizes unknown/missing values to 'client'. */
type InviteRole = 'client' | 'kitchen';

const normRole = (r?: string | null): InviteRole => (r === 'kitchen' ? 'kitchen' : 'client');

/** Invite lifetime picked at creation. `null` = open (no expiry); the
 *  `durationDays` field is ignored by pre-duration servers (extra field)
 *  and honored once server-side duration support lands — safe both ways. */
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

interface AccessSectionProps {
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
 * Owner access control (client slice only — kitchen lives in
 * TeamAccessSection): logins (disable/enable/delete) plus single-use
 * invite links (create/revoke), plus the master kill switch. Owner-only
 * by construction — the endpoints 403 non-master sessions, and then
 * this whole section hides itself (a client login never sees it).
 *
 * Disable vs delete: disable keeps the account but locks it out NOW
 * (live sessions die at once); delete removes the row entirely and frees
 * the name for a future invite.
 */
export const AccessSection: React.FC<AccessSectionProps> = ({ lang, adminFetch, collapsed = false, onToggleCollapse, onConfirm }) => {
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
  }, [refresh]);

  // Not the owner (or unreachable): this section does not exist here.
  if (allowed === null) return null;
  if (allowed === false) return null;

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
        // `role` is fixed to client here (kitchen lives in
        // TeamAccessSection); `durationDays` is ignored by pre-duration
        // servers (extra field) and honored once server-side duration
        // support lands — safe both ways.
        body: JSON.stringify({ username, role: 'client', durationDays }),
      });
      const data = (await readJson(res)) as { ok?: boolean; link?: string; username?: string; expiresAt?: string; role?: string; error?: string };
      if (res.ok && data && data.ok && data.link) {
        setFresh({ link: data.link, username: data.username || username, expiresAt: data.expiresAt || '', role: 'client' });
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

  /** Kill every master session (stolen cookie response). Ours dies too —
   *  the reload below lands on the sign-in screen by design. */
  const revokeAllSessions = () =>
    armed('revoke-all-sessions', async () => {
      setActing('revoke-all');
      setFormErr('');
      try {
        const res = await adminFetch('/api/admin/sessions/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        if (res.ok) {
          window.location.reload();
          return;
        }
        setFormErr(isAr ? 'تعذر إلغاء الجلسات' : 'Could not revoke sessions');
      } catch {
        setFormErr(isAr ? 'تعذر الاتصال' : 'Connection problem');
      } finally {
        setActing(null);
      }
    });

  const invitePill = (s: InviteRow['status']) =>
    s === 'pending'
      ? 'bg-amber-500/10 border-amber-400/30 text-amber-300'
      : s === 'used'
        ? 'bg-green-500/10 border-green-500/30 text-green-400'
        : 'bg-neutral-800 border-neutral-700 text-neutral-500';

  /** Plain-https share targets (no new dependencies, per project policy). */
  const waShare = (link: string) => `https://wa.me/?text=${encodeURIComponent(link)}`;
  const tgShare = (link: string, text: string) =>
    `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;

  /** Account access expiry: dated when the response carries `expiresAt`, open otherwise. */
  const expiryText = (iso?: string | null): string => {
    const d = (iso || '').slice(0, 10);
    if (!d) return isAr ? 'مفتوح' : 'Open';
    return isAr ? `ينتهي في ${d}` : `Expires ${d}`;
  };

  /** Invite LINK expiry (always dated — links die in 72h single-use): labeled
   *  distinctly from account access so "open" accounts are never confusing. */
  const linkExpiryText = (iso?: string | null): string => {
    const d = (iso || '').slice(0, 10);
    if (!d) return isAr ? 'رابط لمرة واحدة' : 'Single-use link';
    return isAr ? `الرابط ينتهي في ${d}` : `Link expires ${d}`;
  };

  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800">
      <SettingsGroupHeader
        title={isAr ? 'دخول العملاء' : 'Client Access'}
        subtitle={isAr
          ? 'أنشئ رابط دعوة لمرة واحدة — الضيف يضع كلمة المرور بنفسه. اختر المدة قبل الإنشاء. دخولك الرئيسي يعمل دائمًا على كل المواقع.'
          : 'Mint a one-time invite link — the guest sets their own password. Pick the duration before creating. Your master login always works everywhere.'}
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
          placeholder={isAr ? 'اسم المستخدم، مثال: layali' : 'Login name, e.g. layali'}
          aria-label={isAr ? 'اسم المستخدم' : 'Client login name'}
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
              name="invite-duration-client"
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
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-violet-500/10 border-violet-500/30 text-violet-300">
              {isAr ? 'عميل' : 'Client'}
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
              {isAr ? 'مشاركة تيليجرام' : 'Share via Telegram'}
            </a>
          </div>
          <p className="text-[10px] text-neutral-500">
            {isAr
              ? <>{fresh.expiresAt ? <>الرابط ينتهي في <span dir="ltr" className="tabular-nums">{fresh.expiresAt.slice(0, 10)}</span> — يُستخدم مرة واحدة ثم تنتهي صلاحيته (ويبقى الدخول نفسه مفتوحًا).</> : <>رابط لمرة واحدة — الدخول نفسه مفتوح بلا انتهاء.</>}</>
              : <>{fresh.expiresAt ? <>Link expires <span dir="ltr" className="tabular-nums">{fresh.expiresAt.slice(0, 10)}</span> — single-use, then dead (the login itself stays open).</> : <>Single-use link — the login itself stays open.</>}</>}
          </p>
        </div>
      ) : null}

      {/* Live client logins: disable locks out now (sessions die too), delete removes all. */}
      <div>
        <h3 className={`text-[11px] font-extrabold text-neutral-400 mb-2 ${isAr ? '' : 'uppercase tracking-wider'}`}>
          {isAr ? 'حسابات العملاء' : 'Client logins'}
        </h3>
        {clients.filter((c) => normRole(c.role) !== 'kitchen').length ? (
          <ul className="space-y-2">
            {clients.filter((c) => normRole(c.role) !== 'kitchen').map((c) => (
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
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-violet-500/10 border-violet-500/30 text-violet-300">
                  {isAr ? 'عميل' : 'Client'}
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
            {isAr ? 'لا توجد حسابات دخول بعد — أنشئ رابط دعوة أعلاه.' : 'No logins yet — create an invite link above.'}
          </p>
        )}
      </div>

      {/* Pending invite links. */}
      <div>
        <h3 className={`text-[11px] font-extrabold text-neutral-400 mb-2 ${isAr ? '' : 'uppercase tracking-wider'}`}>
          {isAr ? 'روابط الدعوة' : 'Invite links'}
        </h3>
        {rows.filter((r) => normRole(r.role) !== 'kitchen').length ? (
          <ul className="space-y-2">
            {rows.filter((r) => normRole(r.role) !== 'kitchen').map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-2.5 rounded-xl bg-black border border-neutral-800 px-3 py-2"
              >
                <span className="font-bold text-sm tabular-nums" dir="ltr">{r.username}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${invitePill(r.status)}`}>
                  {r.status === 'pending' ? (isAr ? 'بانتظار' : 'pending') : r.status === 'used' ? (isAr ? 'مُستخدم' : 'used') : (isAr ? 'منتهي' : 'expired')}
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-violet-500/10 border-violet-500/30 text-violet-300">
                  {isAr ? 'عميل' : 'Client'}
                </span>
                <span className="text-[10px] text-neutral-500 tabular-nums ms-auto" dir="ltr">
                  {linkExpiryText(r.expiresAt)}
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
            {isAr ? 'لا توجد روابط دعوة بعد.' : 'No invite links yet.'}
          </p>
        )}
      </div>
      {/* Master kill switch: a compromised cookie dies everywhere at once. */}
      <div className="rounded-xl border border-red-500/30 bg-black p-3 space-y-2">
        <p className="text-[11px] font-bold text-red-400">
          {isAr ? 'جلسات المالك' : 'Master sessions'}
        </p>
        <p className="text-[11px] text-neutral-500">
          {isAr
            ? 'إذا شككت في تسرّب كلمة المرور: سيفصل هذا جميع الأجهزة فورًا (بما فيها جهازك — وستحتاج إلى تسجيل الدخول مجددًا).'
            : 'If the password may have leaked: this signs out every device at once (including you — you will sign in again).'}
        </p>
        <button
          type="button"
          disabled={acting !== null}
          onClick={() => revokeAllSessions()}
          className={`h-11 min-h-[44px] px-5 rounded-full text-xs font-extrabold border transition-colors flex items-center gap-1.5 whitespace-nowrap disabled:opacity-40 ${
            confirmKey === 'revoke-all-sessions'
              ? 'border-red-500 text-red-400 hover:bg-red-500 hover:text-black'
              : 'border-neutral-700 text-neutral-400 hover:text-red-400 hover:border-red-500/50'
          }`}
        >
          <LogOut size={14} />
          {confirmKey === 'revoke-all-sessions' ? (isAr ? 'تأكيد الفصل؟' : 'Confirm sign-out?') : (isAr ? 'فصل كل الأجهزة' : 'Sign out all devices')}
        </button>
      </div>
      </SettingsGroupBody>
    </div>
  );
};
