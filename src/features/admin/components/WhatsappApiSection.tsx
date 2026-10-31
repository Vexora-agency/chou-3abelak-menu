import React, { useEffect, useState } from 'react';
import { Check, FlaskConical, Loader2, Send } from 'lucide-react';
import type { AdminFetch } from '@/src/lib/api-client';

interface WhatsappApiSectionProps {
  lang: 'en' | 'ar';
  adminFetch: AdminFetch;
}

interface WaConfig {
  enabled: boolean;
  phoneNumberId: string;
  ownerRecipient: string;
  ownerTemplate: string;
  customerTemplate: string;
  customerUpdates: boolean;
  dailyCap: number;
}

const EMPTY: WaConfig = {
  enabled: false,
  phoneNumberId: '',
  ownerRecipient: '',
  ownerTemplate: '',
  customerTemplate: '',
  customerUpdates: false,
  dailyCap: 100,
};

/**
 * WhatsApp Cloud API sender settings (server-side automation path).
 * Disabled by default = today's wa.me behavior byte-for-byte. Enabling
 * requires: Meta-approved number + permanent token + approved template names
 * (see the setup guide). The token is write-only (never displayed back).
 * A test send delivers ONE real template to the owner number (billed).
 */
export const WhatsappApiSection: React.FC<WhatsappApiSectionProps> = ({ lang, adminFetch }) => {
  const isAr = lang === 'ar';
  const [cfg, setCfg] = useState<WaConfig>(EMPTY);
  const [token, setToken] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [tokenAt, setTokenAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const res = await adminFetch('/api/admin/whatsapp');
        if (!res.ok || stop) return;
        const data = (await res.json()) as {
          config?: Partial<WaConfig>; hasToken?: boolean; updatedAt?: string | null;
        };
        if (stop) return;
        setCfg({ ...EMPTY, ...(data.config || {}) });
        setHasToken(data.hasToken === true);
        setTokenAt(typeof data.updatedAt === 'string' ? data.updatedAt : null);
      } catch {}
    })();
    return () => {
      stop = true;
    };
  }, [adminFetch]);

  const say = (kind: 'ok' | 'err', text: string) => setMsg({ kind, text });

  const save = async () => {
    setBusy('save');
    setMsg(null);
    try {
      const res = await adminFetch('/api/admin/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', config: cfg }),
      });
      const data = (await res.json().catch(() => null)) as { errors?: string[] } | null;
      if (!res.ok) {
        say('err', data?.errors?.length
          ? data.errors.join(' · ')
          : (isAr ? 'تعذر الحفظ.' : 'Could not save.'));
      } else {
        say('ok', isAr ? 'حُفظت الإعدادات.' : 'Settings saved.');
      }
    } catch {
      say('err', isAr ? 'تعذر الحفظ.' : 'Could not save.');
    } finally {
      setBusy(null);
    }
  };

  const saveToken = async () => {
    if (!token.trim()) return;
    setBusy('token');
    setMsg(null);
    try {
      const res = await adminFetch('/api/admin/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'token', token: token.trim() }),
      });
      if (!res.ok) {
        say('err', isAr ? 'التوكن مرفوض (الصيغة غير صالحة).' : 'Token rejected (bad format).');
      } else {
        setHasToken(true);
        setToken('');
        say('ok', isAr ? 'حُفظ التوكن (لا يُعرض مجددًا).' : 'Token saved (never shown again).');
      }
    } catch {
      say('err', isAr ? 'تعذر الحفظ.' : 'Could not save.');
    } finally {
      setBusy(null);
    }
  };

  const testSend = async () => {
    setBusy('test');
    setMsg(null);
    try {
      const res = await adminFetch('/api/admin/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test' }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null;
      if (!res.ok) {
        say('err', isAr
          ? `فشل الاختبار (${data?.error || res.status})${data?.detail ? `: ${data.detail}` : ''}`
          : `Test failed (${data?.error || res.status})${data?.detail ? `: ${data.detail}` : ''}`);
      } else {
        say('ok', isAr ? 'وصلت رسالة الاختبار للرقم المستلم — تحقق من واتساب.' : 'Test message delivered — check WhatsApp.');
      }
    } catch {
      say('err', isAr ? 'تعذر الاختبار.' : 'Could not test.');
    } finally {
      setBusy(null);
    }
  };

  const field = 'w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)]';
  const lbl = 'block text-xs text-neutral-400 mb-1';
  const set = (k: keyof WaConfig, v: string | number | boolean) =>
    setCfg((prev) => ({ ...prev, [k]: v } as WaConfig));

  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-extrabold text-[var(--primary)] uppercase tracking-wider">
            {isAr ? 'إرسال واتساب التلقائي (API)' : 'Automatic WhatsApp sending (API)'}
          </h2>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            {isAr
              ? 'مغلق افتراضيًا = زر واتساب الحالي كما هو. التفعيل يحتاج رقم Meta + توكن دائم + قالبًا معتمدًا.'
              : 'Off by default = current WhatsApp button unchanged. Enabling needs a Meta number + permanent token + approved template.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={cfg.enabled}
          onClick={() => set('enabled', !cfg.enabled)}
          className={`btn-tactile shrink-0 w-12 h-7 rounded-full transition-colors ${cfg.enabled ? 'bg-[var(--primary)]' : 'bg-neutral-700'}`}
        >
          <span className={`block w-5 h-5 rounded-full bg-white transition-transform ${cfg.enabled ? 'translate-x-5' : 'translate-x-1'}`} />
        </button>
      </div>

      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
        <div>
          <label className={lbl}>Phone Number ID</label>
          <input value={cfg.phoneNumberId} dir="ltr" inputMode="numeric"
            onChange={(e) => set('phoneNumberId', e.target.value.replace(/[^0-9]/g, '').slice(0, 32))}
            placeholder="123456789012345" className={`${field} tabular-nums`} />
        </div>
        <div>
          <label className={lbl}>{isAr ? 'رقم المستلم (دولي)' : 'Owner recipient (international)'}</label>
          <input value={cfg.ownerRecipient} dir="ltr" inputMode="tel"
            onChange={(e) => set('ownerRecipient', e.target.value.replace(/[^0-9]/g, '').slice(0, 15))}
            placeholder="96170123456" className={`${field} tabular-nums`} />
        </div>
        <div>
          <label className={lbl}>{isAr ? 'قالب طلب المالك (الاسم المعتمد)' : 'Owner template (approved name)'}</label>
          <input value={cfg.ownerTemplate} dir="ltr" spellCheck={false}
            onChange={(e) => set('ownerTemplate', e.target.value.trim().toLowerCase().slice(0, 64))}
            placeholder="order_received" className={field} />
        </div>
        <div>
          <label className={lbl}>{isAr ? 'قالب تأكيد الزبون' : 'Customer template'}</label>
          <input value={cfg.customerTemplate} dir="ltr" spellCheck={false}
            onChange={(e) => set('customerTemplate', e.target.value.trim().toLowerCase().slice(0, 64))}
            placeholder="order_confirmed" className={field} />
        </div>
        <div>
          <label className={lbl}>{isAr ? 'الحد اليومي للرسائل' : 'Daily message cap'}</label>
          <input type="number" min={1} max={5000} value={cfg.dailyCap}
            onChange={(e) => set('dailyCap', Math.min(5000, Math.max(1, Math.round(Number(e.target.value) || 100))))}
            className={`${field} tabular-nums`} />
        </div>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={cfg.customerUpdates}
              onChange={(e) => set('customerUpdates', e.target.checked)}
              className="w-4 h-4 rounded text-[var(--primary)]" />
            <span>{isAr ? 'تأكيد الزبائن المشتركين' : 'Confirm opted-in customers'}</span>
          </label>
        </div>
      </div>

      <div>
        <label className={lbl}>
          {isAr ? 'التوكن الدائم (يُحفظ ولا يُعرض)' : 'Permanent token (stored, never shown)'}
          {hasToken && <span className="ms-2 text-green-400">● {isAr ? 'محفوظ' : 'saved'}{tokenAt ? ` (${new Date(tokenAt).toLocaleDateString()})` : ''}</span>}
        </label>
        <div className="flex gap-2">
          <input type="password" value={token} dir="ltr" spellCheck={false} autoComplete="off"
            onChange={(e) => setToken(e.target.value)}
            placeholder="EAAG…" className={`${field} flex-1 min-w-0`} />
          <button type="button" onClick={() => void saveToken()} disabled={busy === 'token' || !token.trim()}
            className="btn-tactile shrink-0 h-10 px-4 rounded-lg bg-[var(--primary)] text-[#0A0A0A] text-xs font-extrabold disabled:opacity-40">
            {busy === 'token' ? <Loader2 size={14} className="animate-spin" /> : (isAr ? 'حفظ التوكن' : 'Save token')}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2.5">
        <button type="button" onClick={() => void save()} disabled={busy === 'save'}
          className="btn-tactile h-11 px-5 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-sm font-extrabold inline-flex items-center gap-2 disabled:opacity-40">
          {busy === 'save' ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} strokeWidth={3} />}
          {isAr ? 'حفظ الإعدادات' : 'Save settings'}
        </button>
        <button type="button" onClick={() => void testSend()} disabled={busy === 'test'}
          className="btn-tactile h-11 px-5 rounded-full border border-neutral-700 text-neutral-200 text-sm font-bold inline-flex items-center gap-2 disabled:opacity-40 hover:border-[var(--primary)] hover:text-[var(--primary)]">
          {busy === 'test' ? <Loader2 size={16} className="animate-spin" /> : <FlaskConical size={15} />}
          {isAr ? 'إرسال تجريبي (مدفوع)' : 'Test send (billed)'}
        </button>
      </div>
      {msg && (
        <p role="status" className={`text-xs font-bold ${msg.kind === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
          {msg.kind === 'ok' ? <Send size={12} className="inline me-1" /> : null}{msg.text}
        </p>
      )}
    </div>
  );
};
