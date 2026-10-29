import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Copy, Check, Ban, Plus } from 'lucide-react';
import type { AdminFetch } from '@/src/lib/api-client';
import { readJson } from '@/src/utils/safeJson';

interface InviteRow {
  id: string;
  username: string;
  createdAt: string;
  expiresAt: string;
  status: 'pending' | 'used' | 'expired';
}

interface AccessSectionProps {
  lang: 'en' | 'ar';
  adminFetch: AdminFetch;
}

/**
 * Owner access control: mint single-use invite links so each client sets
 * their own password, list them, revoke them. Owner-only by construction —
 * the endpoints 403 non-master sessions, and then this whole section hides
 * itself (a client login never sees it).
 */
export const AccessSection: React.FC<AccessSectionProps> = ({ lang, adminFetch }) => {
  const isAr = lang === 'ar';
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<InviteRow[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [fresh, setFresh] = useState<{ link: string; username: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/invites/list');
      if (res.status === 403) {
        setAllowed(false);
        return;
      }
      const data = (await readJson(res)) as { ok?: boolean; invites?: InviteRow[] };
      if (res.ok && data && data.ok && Array.isArray(data.invites)) {
        setAllowed(true);
        setRows(data.invites);
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
      setFormErr(isAr ? 'من ٢ إلى ٣١ حرفًا: أحرف صغيرة وأرقام و - و _' : '2-31 chars: lowercase, digits, - or _');
      return;
    }
    setBusy(true);
    setFormErr('');
    setFresh(null);
    try {
      const res = await adminFetch('/api/admin/invites/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const data = (await readJson(res)) as { ok?: boolean; link?: string; username?: string; expiresAt?: string; error?: string };
      if (res.ok && data && data.ok && data.link) {
        setFresh({ link: data.link, username: data.username || username, expiresAt: data.expiresAt || '' });
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

  const revoke = async (id: string) => {
    if (confirmRevoke !== id) {
      setConfirmRevoke(id);
      window.setTimeout(() => setConfirmRevoke((cur) => (cur === id ? null : cur)), 4000);
      return;
    }
    setConfirmRevoke(null);
    try {
      await adminFetch('/api/admin/invites/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    } catch {}
    void refresh();
  };

  const pill = (s: InviteRow['status']) =>
    s === 'pending'
      ? 'bg-amber-500/10 border-amber-400/30 text-amber-300'
      : s === 'used'
        ? 'bg-green-500/10 border-green-500/30 text-green-400'
        : 'bg-neutral-800 border-neutral-700 text-neutral-500';

  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4">
      <div>
        <h2 className="text-sm font-extrabold text-[var(--primary)] uppercase tracking-wider flex items-center gap-2">
          <KeyRound size={15} />
          {isAr ? 'دخول العملاء' : 'Client Access'}
        </h2>
        <p className="text-[11px] text-neutral-500 mt-0.5">
          {isAr
            ? 'أنشئ رابط دعوة لمرة واحدة — العميل يضع كلمة سره بنفسه. دخولك الرئيسي يعمل دائمًا على كل مواقع العملاء.'
            : 'Mint a one-time invite link — the client sets their own password. Your master login always works on every client site.'}
        </p>
      </div>

      <form onSubmit={(e) => void create(e)} className="flex gap-2">
        <input
          type="text"
          dir="ltr"
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 31))}
          placeholder={isAr ? 'اسم الدخول، مثال: layali' : 'Login name, e.g. layali'}
          aria-label={isAr ? 'اسم دخول العميل' : 'Client login name'}
          className="flex-1 min-w-0 h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm tabular-nums focus:border-[var(--primary)] placeholder:text-neutral-600 outline-none"
        />
        <button
          type="submit"
          disabled={busy || name.trim().length < 2}
          className="btn-tactile h-10 px-4 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-xs font-extrabold hover:brightness-110 disabled:opacity-40 flex items-center gap-1.5 whitespace-nowrap"
        >
          <Plus size={15} className="stroke-[3]" />
          {busy ? (isAr ? '…' : '…') : isAr ? 'إنشاء رابط' : 'Create link'}
        </button>
      </form>
      {formErr ? (
        <p className="text-[11px] text-amber-400" role="alert">{formErr}</p>
      ) : null}

      {fresh ? (
        <div className="rounded-xl border border-[var(--primary)]/40 bg-black p-3 space-y-2">
          <p className="text-[11px] font-bold text-[var(--primary)]">
            {isAr ? `رابط ${fresh.username} — يُعرض مرة واحدة، انسخه الآن` : `${fresh.username}'s link — shown once, copy it now`}
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              dir="ltr"
              value={fresh.link}
              onFocus={(e) => e.target.select()}
              className="flex-1 min-w-0 h-10 px-3 rounded-lg bg-neutral-900 border border-neutral-700 text-xs tabular-nums text-neutral-200 outline-none"
            />
            <button
              type="button"
              onClick={() => void copy()}
              className="h-10 px-4 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-xs font-extrabold hover:brightness-110 flex items-center gap-1.5 whitespace-nowrap"
            >
              {copied ? <Check size={15} className="stroke-[3]" /> : <Copy size={15} />}
              {copied ? (isAr ? 'تم' : 'Copied') : (isAr ? 'نسخ' : 'Copy')}
            </button>
          </div>
          <p className="text-[10px] text-neutral-500">
            {isAr
              ? `صالح ٧٢ ساعة (حتى ${fresh.expiresAt.slice(0, 10)}) — يُستخدم مرة واحدة ثم يموت.`
              : `Valid 72 hours (until ${fresh.expiresAt.slice(0, 10)}) — single-use, then dead.`}
          </p>
        </div>
      ) : null}

      {rows.length ? (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-2.5 rounded-xl bg-black border border-neutral-800 px-3 py-2"
            >
              <span className="font-bold text-sm tabular-nums" dir="ltr">{r.username}</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${pill(r.status)}`}>
                {r.status === 'pending' ? (isAr ? 'بانتظار' : 'pending') : r.status === 'used' ? (isAr ? 'مُستخدم' : 'used') : (isAr ? 'منتهي' : 'expired')}
              </span>
              <span className="text-[10px] text-neutral-500 tabular-nums ms-auto" dir="ltr">
                {r.expiresAt.slice(0, 10)}
              </span>
              {r.status === 'pending' ? (
                <button
                  type="button"
                  onClick={() => void revoke(r.id)}
                  className={`h-8 px-3 rounded-full text-[11px] font-bold border transition-colors flex items-center gap-1 ${
                    confirmRevoke === r.id
                      ? 'border-red-500 text-red-400 hover:bg-red-500 hover:text-black'
                      : 'border-neutral-700 text-neutral-400 hover:text-red-400 hover:border-red-500/50'
                  }`}
                >
                  <Ban size={13} />
                  {confirmRevoke === r.id ? (isAr ? 'تأكيد الحذف؟' : 'Confirm?') : (isAr ? 'حذف' : 'Revoke')}
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
  );
};
