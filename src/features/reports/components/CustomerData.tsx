import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Download, Eraser, Lock, Search, ShieldAlert, Trash2 } from 'lucide-react';

export interface CustomerResult {
  id: string;
  number: number;
  createdAt: string;
  status: string;
  type: string;
  name: string;
  phone: string;
  total: number;
  anonymized: boolean;
}

interface CustomerDataProps {
  lang: 'en' | 'ar';
  currency: string;
  onSearch: (phone: string) => Promise<{ results: CustomerResult[]; count: number }>;
  onAction: (args: { phone: string; mode: 'anonymize' | 'delete' | 'export'; password: string; confirm: string }) => Promise<{ ok: boolean; mode?: string; count?: number; error?: string }>;
}

const STR = {
  en: {
    title: 'Customer data', intro: 'Search by phone number. Results are masked — full details are never shown on screen.',
    searchPh: 'Phone digits (min 6)', search: 'Search', searching: 'Searching…',
    needDigits: 'Enter at least 6 digits.',
    anonymized: 'Anonymized', orders: 'orders', noRes: 'No orders found for this number.',
    modeT: 'Action on all matches', anonymize: 'Anonymize (recommended)', anonymizeD: 'Removes name, phone, address, notes and location. Keeps totals for statistics.',
    del: 'Delete orders completely', delD: 'Removes the rows entirely. Deleted rows may briefly remain in database recovery history.',
    exp: 'Export their data (CSV)', expD: 'All stored fields for an access request. Downloads immediately.',
    pass: 'Admin password', confirmT: (w: string, n: number) => `Type ${w} to confirm (${n} orders)`,
    go: 'Apply', applying: 'Applying…', ok: (m: string, n: number) => `Done: ${m} on ${n} orders.`,
    errPass: 'Wrong password.', errRate: 'Too many attempts. Try again later.', err: 'Something went wrong.',
  },
  ar: {
    title: 'بيانات العملاء', intro: 'ابحث برقم الهاتف. النتائج مقنّعة — لا تظهر التفاصيل الكاملة على الشاشة أبداً.',
    searchPh: 'أرقام الهاتف (6 على الأقل)', search: 'بحث', searching: 'جارٍ البحث…',
    needDigits: 'أدخل 6 أرقام على الأقل.',
    anonymized: 'مجهول', orders: 'طلب', noRes: 'لا توجد طلبات لهذا الرقم.',
    modeT: 'إجراء على كل النتائج', anonymize: 'إخفاء الهوية (موصى به)', anonymizeD: 'يحذف الاسم والهاتف والعنوان والملاحظات والموقع. يُبقي الإجماليات للإحصاءات.',
    del: 'حذف الطلبات نهائياً', delD: 'يحذف الصفوف تماماً. قد تبقى آثارها لفترة قصيرة في سجل الاسترداد الداخلي لقاعدة البيانات.',
    exp: 'تصدير بياناته (CSV)', expD: 'كل الحقول المخزنة لطلب حق الوصول. يُنزّل فوراً.',
    pass: 'كلمة سر الأدمن', confirmT: (w: string, n: number) => `اكتب ${w} للتأكيد (${n} طلبات)`,
    go: 'تنفيذ', applying: 'جارٍ التنفيذ…', ok: (m: string, n: number) => `تم: ${m} على ${n} طلبات.`,
    errPass: 'كلمة السر خاطئة.', errRate: 'محاولات كثيرة. حاول لاحقاً.', err: 'حدث خطأ ما.',
  },
} as const;

const card = 'p-4 sm:p-5 rounded-2xl bg-neutral-900 border border-neutral-800';
const loc = (l: 'en' | 'ar') => (l === 'ar' ? 'ar-u-nu-latn' : 'en-US');

const CustomerData: React.FC<CustomerDataProps> = ({ lang, currency, onSearch, onAction }) => {
  const t = STR[lang];
  const isAr = lang === 'ar';
  // Owner decision: animations always run (never honor reduced-motion).
  const reduce = false;
  const [phone, setPhone] = useState('');
  const [results, setResults] = useState<CustomerResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'anonymize' | 'delete' | 'export'>('anonymize');
  const [password, setPassword] = useState('');
  const [word, setWord] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const digits = phone.replace(/[^0-9]/g, '');
  const doSearch = async () => {
    if (digits.length < 6) {
      setMsg({ kind: 'err', text: t.needDigits });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await onSearch(digits);
      setResults(r.results);
      setSearched(true);
    } catch {
      setMsg({ kind: 'err', text: t.err });
    } finally {
      setBusy(false);
    }
  };

  const wordNeed = isAr ? 'حذف' : 'DELETE';
  const doAction = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await onAction({ phone: digits, mode, password, confirm: word });
      if (!r.ok) {
        setMsg({ kind: 'err', text: r.error === 'invalid_password' ? t.errPass : r.error === 'rate_limited' ? t.errRate : t.err });
      } else {
        const m = mode === 'anonymize' ? t.anonymize : mode === 'delete' ? t.del : t.exp;
        setMsg({ kind: 'ok', text: t.ok(m, r.count ?? results.length) });
        setPassword('');
        setWord('');
        await doSearchRefresh();
      }
    } catch {
      setMsg({ kind: 'err', text: t.err });
    } finally {
      setBusy(false);
    }
  };
  const doSearchRefresh = async () => {
    try {
      const r = await onSearch(digits);
      setResults(r.results);
    } catch {}
  };

  const rise = (d: number) => ({
    initial: reduce ? (false as const) : { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.45, delay: d, ease: [0.22, 1, 0.36, 1] as const },
  });

  return (
    <div className="space-y-4" dir={isAr ? 'rtl' : 'ltr'}>
      <motion.div {...rise(0)} className={card}>
        <h2 className={`text-sm font-extrabold text-[var(--primary)] ${isAr ? '' : 'uppercase tracking-wider'}`}>{t.title}</h2>
        <p className="mt-1 text-xs text-neutral-400">{t.intro}</p>
        <div className="mt-3 flex gap-2">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void doSearch(); }}
            inputMode="numeric"
            dir="ltr"
            placeholder={t.searchPh}
            aria-label={t.searchPh}
            className="flex-1 h-12 rounded-xl bg-black border border-neutral-700 px-3 text-sm text-white placeholder:text-neutral-600 outline-none focus:border-[var(--primary)] focus:ring-4 focus:ring-[var(--primary)]/15"
          />
          <button
            type="button"
            onClick={() => void doSearch()}
            disabled={busy}
            className="btn-tactile h-12 px-5 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-sm font-extrabold inline-flex items-center gap-2 disabled:opacity-40"
          >
            <Search size={16} />{busy ? t.searching : t.search}
          </button>
        </div>
        {msg && (
          <div role="status" className={`mt-3 rounded-xl border px-3.5 py-3 text-xs ${msg.kind === 'ok' ? 'border-green-500/30 bg-green-500/10 text-green-300' : 'border-red-400/30 bg-red-500/10 text-red-200'}`}>
            {msg.text}
          </div>
        )}
      </motion.div>

      {searched && (
        <motion.div {...rise(0.06)} className={card}>
          {results.length === 0 ? (
            <p className="text-xs text-neutral-500 py-4 text-center">{t.noRes}</p>
          ) : (
            <>
              <div className="space-y-2">
                {results.map((r) => (
                  <div key={r.id} className="rounded-xl border border-neutral-800 bg-black/40 p-3 flex items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 flex-wrap">
                        <b className="text-sm tabular-nums">#{r.number}</b>
                        {r.anonymized && <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-neutral-800 text-neutral-400">{t.anonymized}</span>}
                      </span>
                      <span className="block text-xs text-neutral-300 mt-0.5">{r.name} · <span dir="ltr">{r.phone}</span></span>
                      <span className="block text-[11px] text-neutral-500 mt-0.5 tabular-nums">
                        {new Date(r.createdAt).toLocaleDateString(loc(lang), { day: 'numeric', month: 'short' })} · {r.total} {currency} · {r.status}
                      </span>
                    </span>
                  </div>
                ))}
              </div>

              <h3 className="mt-4 text-sm font-extrabold text-[var(--primary)]">{t.modeT}</h3>
              <div className="mt-2 space-y-2">
                {([
                  { k: 'anonymize', icon: Eraser, a: t.anonymize, b: t.anonymizeD },
                  { k: 'delete', icon: Trash2, a: t.del, b: t.delD },
                  { k: 'export', icon: Download, a: t.exp, b: t.expD },
                ] as const).map((m) => (
                  <label key={m.k} className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer ${mode === m.k ? 'border-[var(--primary)]/60 bg-[var(--primary)]/[0.05]' : 'border-neutral-800'}`}>
                    <input type="radio" name="cd-mode" checked={mode === m.k} onChange={() => setMode(m.k)} className="mt-1 accent-[var(--primary)]" />
                    <span><b className="flex items-center gap-1.5 text-[13px]"><m.icon size={14} className="text-[var(--primary)]" />{m.a}</b>
                      <span className="block text-[11px] text-neutral-400 mt-0.5">{m.b}</span></span>
                  </label>
                ))}
              </div>

              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-neutral-400 mb-1.5"><Lock size={12} />{t.pass}</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    className="w-full h-12 rounded-xl bg-black border border-neutral-700 px-3 text-sm text-white outline-none focus:border-[var(--primary)] focus:ring-4 focus:ring-[var(--primary)]/15"
                  />
                </div>
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-neutral-400 mb-1.5"><ShieldAlert size={12} />{t.confirmT(wordNeed, results.length)}</label>
                  <input
                    value={word}
                    onChange={(e) => setWord(e.target.value)}
                    autoComplete="off"
                    dir={isAr ? 'rtl' : 'ltr'}
                    className="w-full h-12 rounded-xl bg-black border border-neutral-700 px-3 text-sm text-white outline-none focus:border-[var(--primary)] focus:ring-4 focus:ring-[var(--primary)]/15"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => void doAction()}
                disabled={busy || !password || !word.trim()}
                className="btn-tactile mt-3 h-11 px-6 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-sm font-extrabold disabled:opacity-40"
              >
                {busy ? t.applying : t.go}
              </button>
            </>
          )}
        </motion.div>
      )}
    </div>
  );
};

export default CustomerData;
