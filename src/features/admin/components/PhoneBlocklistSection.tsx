import React, { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Plus, Trash2 } from 'lucide-react';
import type { AdminFetch } from '@/src/lib/api-client';
import { cleanPhoneInput, phoneDigitsOnly } from '@/src/utils/digits';
import { SettingsGroupBody, SettingsGroupHeader } from './SettingsCollapsible';

interface PhoneBlocklistSectionProps {
  lang: 'en' | 'ar';
  adminFetch: AdminFetch;
  onConfirm?: (box: { title: string; body: string; confirmText: string; mode?: 'confirm' | 'info'; action?: () => void }) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

interface BlockedRow { phone_norm: string; reason: string | null; created_at: string; }

const fmtDate = (iso: string, lang: 'en' | 'ar'): string => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  try {
    return new Date(ms).toLocaleDateString(lang === 'ar' ? 'ar-LB' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return ''; }
};

/** Phone blocklist — fake-order protection card: list + add (phone + optional reason) + delete per row. */
export const PhoneBlocklistSection: React.FC<PhoneBlocklistSectionProps> = ({ lang, adminFetch, onConfirm, collapsed = false, onToggleCollapse }) => {
  const isAr = lang === 'ar';
  const [rows, setRows] = useState<BlockedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [hidden403, setHidden403] = useState(false);
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/phone-blocks');
      if (res.status === 403) { setHidden403(true); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json().catch(() => null)) as { ok?: boolean; blocked?: BlockedRow[] } | null;
      if (!data || data.ok !== true || !Array.isArray(data.blocked)) throw new Error('bad-shape');
      setRows(data.blocked);
      setLoadError(false);
    } catch { setLoadError(true); }
    finally { setLoading(false); }
  }, [adminFetch]);

  useEffect(() => { void refresh(); }, [refresh]);

  const validDigits = (raw: string): string | null => {
    const d = phoneDigitsOnly(raw);
    return d.length >= 6 && d.length <= 15 ? d : null;
  };

  const add = async () => {
    const d = validDigits(phone);
    if (!d) { setFieldError(isAr ? 'أدخل رقمًا صحيحًا (6 إلى 15 رقمًا).' : 'Enter a valid number (6 to 15 digits).'); return; }
    setFieldError(null);
    setBusy('add');
    setMsg(null);
    try {
      const res = await adminFetch('/api/admin/phone-blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: d, ...(reason.trim() ? { reason: reason.trim().slice(0, 140) } : {}) }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data || data.ok !== true) throw new Error(data?.error || `HTTP ${res.status}`);
      setPhone('');
      setReason('');
      setMsg({ kind: 'ok', text: isAr ? 'تم حظر الرقم.' : 'Number blocked.' });
      setLoading(true);
      await refresh();
    } catch { setMsg({ kind: 'err', text: isAr ? 'تعذر حظر الرقم — حاول مجددًا.' : 'Could not block the number — try again.' }); }
    finally { setBusy(null); }
  };

  const doRemove = async (phoneNorm: string) => {
    setBusy(`del:${phoneNorm}`);
    setMsg(null);
    try {
      const res = await adminFetch('/api/admin/phone-blocks', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneNorm }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRows((prev) => prev.filter((r) => r.phone_norm !== phoneNorm));
      setMsg({ kind: 'ok', text: isAr ? 'تم إلغاء الحظر.' : 'Unblocked.' });
    } catch { setMsg({ kind: 'err', text: isAr ? 'تعذر إلغاء الحظر — حاول مجددًا.' : 'Could not unblock — try again.' }); }
    finally { setBusy(null); }
  };

  const askRemove = (phoneNorm: string) => {
    const box = {
      title: isAr ? 'إلغاء حظر الرقم؟' : 'Unblock this number?',
      body: isAr ? `سيتمكن ${phoneNorm} من إتمام الطلبات مجددًا.` : `${phoneNorm} will be able to place orders again.`,
      confirmText: isAr ? 'إلغاء الحظر' : 'Unblock',
      mode: 'confirm' as const,
      action: () => void doRemove(phoneNorm),
    };
    if (onConfirm) onConfirm(box);
    else if (window.confirm(box.body)) void doRemove(phoneNorm);
  };

  if (hidden403) return null;

  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800">
      <SettingsGroupHeader
        title={isAr ? 'حظر أرقام الهواتف' : 'Blocked phone numbers'}
        subtitle={isAr ? 'الأرقام المحظورة لا تستطيع إتمام الطلب — للتعامل مع العبث المتكرر.' : 'Blocked numbers cannot place orders — for repeat abuse.'}
        lang={lang} collapsed={collapsed} onToggle={() => onToggleCollapse?.()}
      />
      <SettingsGroupBody open={!collapsed}>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1 min-w-0">
            <label htmlFor="phone-block-input" className="block text-xs text-neutral-400 mb-1">{isAr ? 'رقم الهاتف' : 'Phone number'}</label>
            <input id="phone-block-input" type="tel" inputMode="tel" dir="ltr" value={phone} maxLength={24}
              onChange={(e) => { setPhone(cleanPhoneInput(e.target.value)); setFieldError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
              placeholder="70 123 456"
              className="w-full h-11 min-h-[44px] px-3 rounded-lg bg-black border border-neutral-700 text-base text-start tabular-nums focus:border-[var(--primary)]" />
          </div>
          <div className="flex-1 min-w-0">
            <label htmlFor="phone-block-reason" className="block text-xs text-neutral-400 mb-1">{isAr ? 'السبب (اختياري)' : 'Reason (optional)'}</label>
            <input id="phone-block-reason" type="text" value={reason} maxLength={140} onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
              placeholder={isAr ? 'مثال: طلبات وهمية متكررة' : 'e.g. repeated fake orders'}
              className="w-full h-11 min-h-[44px] px-3 rounded-lg bg-black border border-neutral-700 text-base focus:border-[var(--primary)]" />
          </div>
          <div className="flex items-end">
            <button type="button" onClick={() => void add()} disabled={busy === 'add'}
              className="btn-tactile h-11 min-h-[44px] px-5 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-sm font-extrabold inline-flex items-center gap-2 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
              {busy === 'add' ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} strokeWidth={3} />}
              {isAr ? 'حظر' : 'Block'}
            </button>
          </div>
        </div>

        {fieldError && <p role="alert" className="text-xs font-bold text-red-400">{fieldError}</p>}

        {loading && (
          <div className="space-y-2" aria-hidden="true">
            {[0, 1].map((i) => <div key={i} className="h-[52px] rounded-xl bg-black/40 border border-neutral-800 animate-pulse" />)}
          </div>
        )}

        {!loading && loadError && (
          <div className="flex flex-col gap-2">
            <p role="alert" className="text-xs font-bold text-red-400 rounded-xl px-3 py-2 border border-red-800 bg-red-950/40">
              {isAr ? 'تعذر تحميل قائمة الحظر — تحقق من الاتصال.' : 'Could not load the blocklist — check your connection.'}
            </p>
            <button type="button" onClick={() => { setLoading(true); setLoadError(false); void refresh(); }}
              className="btn-tactile self-start h-11 min-h-[44px] px-5 rounded-full border border-neutral-700 text-neutral-200 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
              {isAr ? 'إعادة المحاولة' : 'Retry'}
            </button>
          </div>
        )}

        {!loading && !loadError && rows.length === 0 && (
          <p className="text-[11px] text-neutral-500 rounded-xl px-3 py-2 border border-neutral-800 bg-black/40">
            {isAr ? 'لا توجد أرقام محظورة — القائمة فارغة.' : 'No blocked numbers — the list is empty.'}
          </p>
        )}

        {!loading && !loadError && rows.length > 0 && (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.phone_norm} className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-black/40 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span dir="ltr" className="block text-sm font-extrabold tabular-nums text-start">{r.phone_norm}</span>
                  <span dir="auto" className="block text-[11px] text-neutral-500 truncate">
                    {[r.reason, fmtDate(r.created_at, lang)].filter(Boolean).join(' · ') || '—'}
                  </span>
                </span>
                <button type="button" onClick={() => askRemove(r.phone_norm)} disabled={busy === `del:${r.phone_norm}`}
                  aria-label={isAr ? `إلغاء حظر ${r.phone_norm}` : `Unblock ${r.phone_norm}`}
                  className="btn-tactile shrink-0 h-11 min-h-[44px] min-w-[44px] px-3 rounded-full border border-neutral-700 text-neutral-300 text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-40 hover:border-red-500 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">
                  {busy === `del:${r.phone_norm}` ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  {isAr ? 'إلغاء الحظر' : 'Unblock'}
                </button>
              </li>
            ))}
          </ul>
        )}

        {msg && (
          <p role="status" className={`text-xs font-bold rounded-xl px-3 py-2 border inline-flex items-center gap-1.5 ${
            msg.kind === 'ok' ? 'text-[var(--primary)] border-[var(--primary)]/40 bg-[var(--primary)]/10' : 'text-red-400 border-red-800 bg-red-950/40'}`}>
            {msg.kind === 'ok' ? <Check size={13} strokeWidth={3} /> : null}<span>{msg.text}</span>
          </p>
        )}
      </SettingsGroupBody>
    </div>
  );
};
