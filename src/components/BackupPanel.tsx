import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  AlertTriangle, Archive, Check, ChevronDown, Clock, Download, FileJson, FileSpreadsheet, History, Loader2,
  Minus, Plus, Printer, RotateCcw, ShieldAlert, ShieldCheck, Trash2, Upload, X, Pencil,
} from 'lucide-react';

/* ---------- Types (the API returns exactly these shapes) ---------- */
export interface Change {
  kind: 'added' | 'removed' | 'changed';
  scope: 'item' | 'category' | 'settings';
  label: string;
  detail?: string; // e.g. "Price 580,000 -> 600,000"
  sensitive?: boolean; // phone, WhatsApp, ordering, plan...
}
export interface VersionEntry {
  id: string;
  createdAt: string;
  source: 'autosave' | 'manual' | 'import' | 'restore';
  actor: string;
  summary: { added: number; removed: number; changed: number; prices: number };
  current?: boolean;
}
export interface TrashEntry { id: string; kind: 'item' | 'category'; name: { en: string; ar: string }; deletedAt: string; purgeInDays: number }
export interface ImportAnalysis {
  fileName: string; format: 'json' | 'csv';
  signed: boolean | null; // null for CSV
  counts: { items: number; categories: number };
  changes: Change[]; hasSettingsChanges: boolean; warnings: string[]; token: string;
}
interface BackupPanelProps {
  lang: 'en' | 'ar';
  versions: VersionEntry[];
  trash: TrashEntry[];
  status: { lastBackupAt?: string; autoWeekly: boolean; destination?: string };
  onLoadChanges: (versionId: string) => Promise<Change[]>;
  onRestoreVersion: (versionId: string) => Promise<{ ok: boolean }>;
  onExport: (kind: 'json' | 'csv' | 'print') => void;
  onAnalyzeImport: (file: File) => Promise<ImportAnalysis>;
  onApplyImport: (token: string, opts: { includeSettings: boolean }) => Promise<{ ok: boolean }>;
  onRestoreTrash: (id: string) => Promise<void>;
  onDeleteForever: (id: string) => Promise<void>;
  onToggleAuto: (on: boolean) => Promise<void>;
}

const STR = {
  en: {
    protectedTitle: 'Your menu is protected', versionsN: (n: number) => `${n} saved versions`, lastBackup: (t: string) => `Last backup ${t}`, never: 'No backup yet', weeklyOn: 'Weekly email backup on', weeklyOff: 'Weekly email backup off',
    tHistory: 'History', tExport: 'Export', tImport: 'Import', tTrash: 'Trash',
    histIntro: 'Every save is kept. Restore any earlier version in two taps; a copy of the current menu is saved first, so a restore can always be undone.',
    current: 'Current', preview: 'Review', restore: 'Restore', by: 'by',
    src: { autosave: 'Auto-save', manual: 'Saved', import: 'Import', restore: 'Restore' },
    added: 'added', removed: 'removed', changed: 'changed', prices: 'prices',
    restoreTitle: 'Restore this version?', restoreSub: 'These changes will be made to your live menu:', noChanges: 'No differences from the current menu.',
    safetyCopy: 'We save a copy of your current menu first, so you can undo this.', confirmRestore: 'Restore version', restoring: 'Restoring…', done: 'Done. A new entry was added to the history.', cancel: 'Cancel', close: 'Close',
    exJson: 'Full backup', exJsonD: 'Everything in one signed file (menu, prices, settings). The only file that can fully restore your site.', recommended: 'Recommended',
    exCsv: 'Spreadsheet (CSV)', exCsvD: 'All items and prices for Excel or Google Sheets. Edit prices in bulk, then import it back with a preview.',
    exPrint: 'Printable menu', exPrintD: 'A clean page ready to print or save as PDF for your counter or WhatsApp.',
    download: 'Download', open: 'Open',
    autoTitle: 'Automatic weekly backup', autoD: (d?: string) => `A signed backup is emailed every week${d ? ` to ${d}` : ''}. It is also your off-site copy.`, autoNoMail: 'Confirm a report email first (Dashboard → Reports).',
    dropTitle: 'Drop a backup or spreadsheet here', dropSub: 'JSON backup or CSV · max 2 MB', choose: 'Choose file', analyzing: 'Checking the file…',
    signed: 'Signed by this site', unsigned: 'Not signed', csvFile: 'Spreadsheet', unsignedNote: 'Unsigned files can update menu items only. Business settings cannot be imported from them.',
    items: 'items', categories: 'categories', reviewTitle: 'Review before applying', nothing: 'Nothing would change.',
    settingsToggle: 'Also replace business settings', settingsToggleD: 'Phone, WhatsApp number, delivery and ordering options', settingsWarn: 'Orders will go to the WhatsApp number in this file. Check it carefully.',
    typeToConfirm: (w: string) => `Type ${w} to confirm`, confirmWord: 'APPLY', apply: 'Apply changes', applying: 'Applying…', applied: 'Applied. You can undo this from History.', startOver: 'Choose another file', sensitive: 'Sensitive',
    trashIntro: 'Deleted items stay here for 30 days. Nothing is lost by accident.', trashEmpty: 'The trash is empty.', purge: (n: number) => `Removed in ${n} days`, restoreItem: 'Restore', deleteForever: 'Delete forever', sure: 'Confirm delete', item: 'Item', category: 'Category',
    now: 'just now', ago: (t: string) => t,
  },
  ar: {
    protectedTitle: 'قائمتك محمية', versionsN: (n: number) => `${n} نسخة محفوظة`, lastBackup: (t: string) => `آخر نسخة ${t}`, never: 'لا توجد نسخة بعد', weeklyOn: 'النسخة الأسبوعية بالبريد مفعّلة', weeklyOff: 'النسخة الأسبوعية بالبريد متوقفة',
    tHistory: 'السجل', tExport: 'تصدير', tImport: 'استيراد', tTrash: 'المحذوفات',
    histIntro: 'كل حفظ يُحفظ. استرجع أي نسخة قديمة بلمستين. نحفظ نسخة من القائمة الحالية أولاً، فيمكن التراجع عن أي استرجاع.',
    current: 'الحالية', preview: 'مراجعة', restore: 'استرجاع', by: 'بواسطة',
    src: { autosave: 'حفظ تلقائي', manual: 'حفظ', import: 'استيراد', restore: 'استرجاع' },
    added: 'مضاف', removed: 'محذوف', changed: 'معدّل', prices: 'أسعار',
    restoreTitle: 'استرجاع هذه النسخة؟', restoreSub: 'ستُجرى هذه التغييرات على قائمتك المباشرة:', noChanges: 'لا فروق عن القائمة الحالية.',
    safetyCopy: 'نحفظ نسخة من القائمة الحالية أولاً، فيمكنك التراجع.', confirmRestore: 'استرجع النسخة', restoring: 'جارٍ الاسترجاع…', done: 'تم. أُضيف سجل جديد في السجل.', cancel: 'إلغاء', close: 'إغلاق',
    exJson: 'نسخة احتياطية كاملة', exJsonD: 'كل شيء في ملف موقّع واحد (القائمة والأسعار والإعدادات). الملف الوحيد الذي يستعيد موقعك بالكامل.', recommended: 'موصى به',
    exCsv: 'جدول بيانات (CSV)', exCsvD: 'كل الأصناف والأسعار لـ Excel أو Google Sheets. عدّل الأسعار دفعة واحدة ثم استورده مع معاينة.',
    exPrint: 'منيو للطباعة', exPrintD: 'صفحة نظيفة جاهزة للطباعة أو الحفظ PDF لعرضها في المحل أو إرسالها بواتساب.',
    download: 'تنزيل', open: 'فتح',
    autoTitle: 'نسخة أسبوعية تلقائية', autoD: (d?: string) => `يُرسل لك ملف نسخة موقّع كل أسبوع${d ? ` إلى ${d}` : ''}. وهو أيضاً نسختك خارج الموقع.`, autoNoMail: 'أكّد بريد التقارير أولاً (الطلبات ثم التقارير).',
    dropTitle: 'أفلت ملف النسخة أو الجدول هنا', dropSub: 'ملف JSON أو CSV · حتى 2 ميغابايت', choose: 'اختر ملفاً', analyzing: 'جارٍ فحص الملف…',
    signed: 'موقّع من هذا الموقع', unsigned: 'غير موقّع', csvFile: 'جدول بيانات', unsignedNote: 'الملفات غير الموقّعة تحدّث الأصناف فقط، ولا يمكن استيراد إعدادات العمل منها.',
    items: 'صنف', categories: 'قسم', reviewTitle: 'راجع قبل التطبيق', nothing: 'لن يتغير شيء.',
    settingsToggle: 'استبدل إعدادات العمل أيضاً', settingsToggleD: 'الهاتف ورقم واتساب والتوصيل وخيارات الطلب', settingsWarn: 'ستذهب الطلبات إلى رقم واتساب الموجود في هذا الملف. تحقق منه جيداً.',
    typeToConfirm: (w: string) => `اكتب ${w} للتأكيد`, confirmWord: 'تطبيق', apply: 'طبّق التغييرات', applying: 'جارٍ التطبيق…', applied: 'تم التطبيق. يمكنك التراجع من السجل.', startOver: 'اختر ملفاً آخر', sensitive: 'حساس',
    trashIntro: 'الأصناف المحذوفة تبقى هنا 30 يوماً. لا يضيع شيء بالخطأ.', trashEmpty: 'سلة المحذوفات فارغة.', purge: (n: number) => `تُحذف بعد ${n} يوماً`, restoreItem: 'استرجاع', deleteForever: 'حذف نهائي', sure: 'تأكيد الحذف', item: 'صنف', category: 'قسم',
    now: 'الآن', ago: (t: string) => t,
  },
} as const;

const card = 'p-4 sm:p-5 rounded-2xl bg-neutral-900 border border-neutral-800';
const loc = (l: 'en' | 'ar') => (l === 'ar' ? 'ar-u-nu-latn' : 'en-US');
const fmtDate = (iso: string, l: 'en' | 'ar') => new Date(iso).toLocaleString(loc(l), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
function rel(iso: string | undefined, l: 'en' | 'ar') {
  if (!iso) return '';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return STR[l].now;
  if (m < 60) return l === 'ar' ? `قبل ${m} د` : `${m} min ago`;
  if (m < 60 * 24) return l === 'ar' ? `قبل ${Math.floor(m / 60)} س` : `${Math.floor(m / 60)}h ago`;
  return l === 'ar' ? `قبل ${Math.floor(m / 1440)} يوماً` : `${Math.floor(m / 1440)}d ago`;
}

const KIND = {
  added: { icon: Plus, cls: 'bg-green-500/15 text-green-400' },
  removed: { icon: Minus, cls: 'bg-red-500/15 text-red-400' },
  changed: { icon: Pencil, cls: 'bg-[#FFC400]/15 text-[#FFC400]' },
} as const;

const ChangeList: React.FC<{ changes: Change[]; lang: 'en' | 'ar' }> = ({ changes, lang }) => {
  const t = STR[lang];
  const [open, setOpen] = useState(false);
  const ordered = [...changes].sort((a, b) => Number(!!b.sensitive) - Number(!!a.sensitive)); // sensitive changes always come first
  const shown = open ? ordered : ordered.slice(0, 5);
  return (
    <div>
      <ul className="space-y-1.5">
        {shown.map((c, i) => {
          const K = KIND[c.kind];
          return (
            <li key={i} className={`flex items-start gap-2.5 rounded-xl border p-2.5 text-[13px] ${c.sensitive ? 'border-red-400/40 bg-red-500/[0.06]' : 'border-neutral-800 bg-black/40'}`}>
              <span className={`mt-px w-6 h-6 shrink-0 rounded-lg flex items-center justify-center ${K.cls}`}><K.icon size={13} strokeWidth={2.6} /></span>
              <span className="min-w-0 flex-1">
                <span className="font-bold break-words">{c.label}</span>
                {c.sensitive && <span className="ms-2 inline-flex items-center gap-1 text-[10px] font-extrabold text-red-300"><ShieldAlert size={11} />{t.sensitive}</span>}
                {c.detail && <span className="block text-xs text-neutral-400 mt-0.5 break-words" dir="auto">{c.detail}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {changes.length > 5 && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-[#FFC400]">
          <ChevronDown size={14} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />{open ? t.close : `+${changes.length - 5}`}
        </button>
      )}
    </div>
  );
};

const Modal: React.FC<{ onClose: () => void; children: React.ReactNode; label: string }> = ({ onClose, children, label }) => {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <motion.button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/70" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.div role="dialog" aria-modal="true" aria-label={label} initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full sm:max-w-lg max-h-[88vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-neutral-900 border border-neutral-700 border-t-[#FFC400] p-5">
        {children}
      </motion.div>
    </div>
  );
};

const BackupPanel: React.FC<BackupPanelProps> = ({ lang, versions, trash, status, onLoadChanges, onRestoreVersion, onExport, onAnalyzeImport, onApplyImport, onRestoreTrash, onDeleteForever, onToggleAuto }) => {
  const t = STR[lang]; const isAr = lang === 'ar'; const reduce = useReducedMotion();
  const [tab, setTab] = useState<'history' | 'export' | 'import' | 'trash'>('history');
  const [limit, setLimit] = useState(6);
  const [modal, setModal] = useState<{ v: VersionEntry; changes: Change[] | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [includeSettings, setIncludeSettings] = useState(false);
  const [typed, setTyped] = useState('');
  const [applied, setApplied] = useState(false);
  const [sure, setSure] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const flash = (s: string) => { setNote(s); window.setTimeout(() => setNote(null), 4200); };
  const rise = (d: number) => ({ initial: reduce ? (false as const) : { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.45, delay: d, ease: [0.22, 1, 0.36, 1] as const } });

  const openRestore = async (v: VersionEntry) => { setModal({ v, changes: null }); const c = await onLoadChanges(v.id); setModal({ v, changes: c }); };
  const doRestore = async () => { if (!modal) return; setBusy(true); const r = await onRestoreVersion(modal.v.id); setBusy(false); if (r.ok) { setModal(null); flash(t.done); } };

  const analyze = async (file: File | undefined) => {
    if (!file) return; setBusy(true); setApplied(false); setTyped(''); setIncludeSettings(false);
    try { setAnalysis(await onAnalyzeImport(file)); } finally { setBusy(false); }
  };
  const canSettings = analysis?.signed === true && analysis.hasSettingsChanges;
  const visibleChanges = analysis ? analysis.changes.filter((c) => includeSettings || c.scope !== 'settings') : [];
  const needsWord = !!analysis && visibleChanges.length > 0;
  const okToApply = needsWord && typed.trim().toUpperCase() === t.confirmWord.toUpperCase() && !busy;
  const apply = async () => { if (!analysis) return; setBusy(true); const r = await onApplyImport(analysis.token, { includeSettings: includeSettings && canSettings }); setBusy(false); if (r.ok) setApplied(true); };

  const Tab = (id: typeof tab, label: string, icon: React.ReactNode, badge?: number) => (
    <button key={id} type="button" onClick={() => setTab(id)} aria-pressed={tab === id}
      className={`relative shrink-0 px-3.5 h-9 rounded-full text-xs font-bold whitespace-nowrap inline-flex items-center gap-1.5 transition-colors ${tab === id ? 'text-[#0A0A0A]' : 'text-neutral-400 hover:text-white'}`}>
      {tab === id && <motion.span layoutId="bk-tab" className="absolute inset-0 rounded-full bg-[#FFC400]" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
      <span className="relative z-10 inline-flex items-center gap-1.5">{icon}{label}{badge ? <span className={`px-1.5 rounded-full text-[10px] ${tab === id ? 'bg-black/15' : 'bg-neutral-800'}`}>{badge}</span> : null}</span>
    </button>
  );

  return (
    <div className="space-y-4" dir={isAr ? 'rtl' : 'ltr'}>
      <motion.div {...rise(0)} className={`${card} flex items-start gap-3.5`}>
        <span className="w-11 h-11 shrink-0 rounded-2xl bg-[#FFC400] text-[#0A0A0A] flex items-center justify-center"><ShieldCheck size={22} /></span>
        <div className="min-w-0">
          <h2 className="text-base font-extrabold">{t.protectedTitle}</h2>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold">
            <span className="px-2.5 py-1 rounded-full bg-black/50 border border-neutral-800 text-neutral-200">{t.versionsN(versions.length)}</span>
            <span className="px-2.5 py-1 rounded-full bg-black/50 border border-neutral-800 text-neutral-200">{status.lastBackupAt ? t.lastBackup(rel(status.lastBackupAt, lang)) : t.never}</span>
            <span className={`px-2.5 py-1 rounded-full border ${status.autoWeekly ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-neutral-800 border-neutral-700 text-neutral-400'}`}>{status.autoWeekly ? t.weeklyOn : t.weeklyOff}</span>
          </div>
        </div>
      </motion.div>

      <motion.div {...rise(0.06)} className="flex gap-1 p-1 bg-neutral-900 rounded-full border border-neutral-800 max-w-full overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {Tab('history', t.tHistory, <History size={14} />)}{Tab('export', t.tExport, <Download size={14} />)}{Tab('import', t.tImport, <Upload size={14} />)}{Tab('trash', t.tTrash, <Trash2 size={14} />, trash.length)}
      </motion.div>

      <AnimatePresence initial={false}>
        {note && (<motion.div role="status" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
          <div className="flex items-center gap-2 rounded-xl border border-green-500/30 bg-green-500/10 px-3.5 py-3 text-xs text-green-300"><Check size={15} />{note}</div></motion.div>)}
      </AnimatePresence>

      {/* HISTORY */}
      {tab === 'history' && (
        <motion.div key="h" {...rise(0)} className={card}>
          <p className="text-xs leading-relaxed text-neutral-400">{t.histIntro}</p>
          <div className="mt-3 space-y-2">
            {versions.slice(0, limit).map((v) => (
              <div key={v.id} className={`rounded-xl border p-3 ${v.current ? 'border-[#FFC400]/40 bg-[#FFC400]/[0.05]' : 'border-neutral-800 bg-black/40'}`}>
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 shrink-0 rounded-xl bg-black border border-neutral-800 text-[#FFC400] flex items-center justify-center">{v.source === 'restore' ? <RotateCcw size={16} /> : v.source === 'import' ? <Upload size={16} /> : <Archive size={16} />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 flex-wrap"><b className="text-sm">{t.src[v.source]}</b>{v.current && <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[#FFC400] text-[#0A0A0A]">{t.current}</span>}</span>
                    <span className="block text-[11px] text-neutral-400 mt-0.5">{fmtDate(v.createdAt, lang)} · {t.by} {v.actor}</span>
                  </span>
                  {!v.current && (
                    <span className="flex gap-1.5 shrink-0">
                      <button type="button" onClick={() => openRestore(v)} className="btn-tactile h-9 px-3 rounded-full border border-neutral-700 text-neutral-200 text-xs font-bold hover:border-[#FFC400] hover:text-[#FFC400]">{t.preview}</button>
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-bold">
                  {v.summary.added > 0 && <span className="px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">+{v.summary.added} {t.added}</span>}
                  {v.summary.removed > 0 && <span className="px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">−{v.summary.removed} {t.removed}</span>}
                  {v.summary.changed > 0 && <span className="px-2 py-0.5 rounded-full bg-[#FFC400]/15 text-[#FFC400]">~{v.summary.changed} {t.changed}</span>}
                  {v.summary.prices > 0 && <span className="px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-300">{v.summary.prices} {t.prices}</span>}
                </div>
              </div>
            ))}
          </div>
          {versions.length > limit && <button type="button" onClick={() => setLimit((l) => l + 6)} className="btn-tactile mt-3 w-full h-10 rounded-full border border-neutral-700 text-neutral-300 text-xs font-bold hover:bg-white/5">+{versions.length - limit}</button>}
        </motion.div>
      )}

      {/* EXPORT */}
      {tab === 'export' && (
        <motion.div key="e" {...rise(0)} className="space-y-3">
          {([
            { k: 'json', icon: FileJson, a: t.exJson, b: t.exJsonD, rec: true, btn: t.download },
            { k: 'csv', icon: FileSpreadsheet, a: t.exCsv, b: t.exCsvD, rec: false, btn: t.download },
            { k: 'print', icon: Printer, a: t.exPrint, b: t.exPrintD, rec: false, btn: t.open },
          ] as const).map((x) => (
            <div key={x.k} className={`${card} flex items-center gap-3.5`}>
              <span className="w-11 h-11 shrink-0 rounded-2xl bg-[#FFC400]/10 text-[#FFC400] flex items-center justify-center"><x.icon size={21} /></span>
              <span className="min-w-0 flex-1"><span className="flex items-center gap-2 flex-wrap"><b className="text-sm">{x.a}</b>{x.rec && <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[#FFC400] text-[#0A0A0A]">{t.recommended}</span>}</span>
                <span className="block text-xs leading-relaxed text-neutral-400 mt-1">{x.b}</span></span>
              <button type="button" onClick={() => onExport(x.k)} className="btn-tactile shrink-0 h-10 px-4 rounded-full bg-[#FFC400] text-[#0A0A0A] text-xs font-extrabold">{x.btn}</button>
            </div>
          ))}
          <div className={`${card} flex items-center gap-3.5`}>
            <span className="w-11 h-11 shrink-0 rounded-2xl bg-[#FFC400]/10 text-[#FFC400] flex items-center justify-center"><Clock size={21} /></span>
            <span className="min-w-0 flex-1"><b className="text-sm">{t.autoTitle}</b><span className="block text-xs leading-relaxed text-neutral-400 mt-1">{status.destination ? t.autoD(status.destination) : t.autoNoMail}</span></span>
            <button type="button" role="switch" aria-checked={status.autoWeekly} aria-label={t.autoTitle} disabled={!status.destination} onClick={() => onToggleAuto(!status.autoWeekly)}
              className={`relative w-12 h-7 rounded-full shrink-0 transition-colors disabled:opacity-40 ${status.autoWeekly ? 'bg-[#FFC400]' : 'bg-neutral-700'}`}>
              <motion.span layout={!reduce} transition={{ type: 'spring', stiffness: 500, damping: 32 }} className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow ${status.autoWeekly ? 'end-1' : 'start-1'}`} />
            </button>
          </div>
        </motion.div>
      )}

      {/* IMPORT */}
      {tab === 'import' && (
        <motion.div key="i" {...rise(0)} className="space-y-3">
          {!analysis && (
            <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); analyze(e.dataTransfer.files?.[0]); }}
              className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${drag ? 'border-[#FFC400] bg-[#FFC400]/[0.06]' : 'border-neutral-700 bg-neutral-900'}`}>
              {busy ? <><Loader2 size={30} className="mx-auto animate-spin text-[#FFC400]" /><p className="mt-3 text-sm font-bold">{t.analyzing}</p></> : <>
                <Upload size={30} className="mx-auto text-[#FFC400]" /><p className="mt-3 text-sm font-extrabold">{t.dropTitle}</p><p className="mt-1 text-xs text-neutral-500">{t.dropSub}</p>
                <button type="button" onClick={() => fileRef.current?.click()} className="btn-tactile mt-4 h-11 px-6 rounded-full bg-[#FFC400] text-[#0A0A0A] text-sm font-extrabold">{t.choose}</button></>}
              <input ref={fileRef} type="file" accept=".json,.csv,application/json,text/csv" className="sr-only" onChange={(e) => { analyze(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
          )}

          {analysis && !applied && (
            <div className={`${card} space-y-4`}>
              <div className="flex items-start gap-3">
                <span className="w-10 h-10 shrink-0 rounded-xl bg-black border border-neutral-800 text-[#FFC400] flex items-center justify-center">{analysis.format === 'json' ? <FileJson size={18} /> : <FileSpreadsheet size={18} />}</span>
                <span className="min-w-0 flex-1"><b className="block text-sm truncate" dir="ltr">{analysis.fileName}</b>
                  <span className="text-xs text-neutral-400">{analysis.counts.items} {t.items} · {analysis.counts.categories} {t.categories}</span></span>
                <span className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold border ${analysis.signed ? 'bg-green-500/15 text-green-400 border-green-500/30' : 'bg-amber-500/10 text-amber-300 border-amber-400/30'}`}>
                  {analysis.signed ? <ShieldCheck size={12} /> : <AlertTriangle size={12} />}{analysis.signed ? t.signed : analysis.format === 'csv' ? t.csvFile : t.unsigned}</span>
              </div>
              {!analysis.signed && <p className="text-xs leading-relaxed text-amber-200/90 bg-amber-500/[0.07] border border-amber-400/25 rounded-xl p-3">{t.unsignedNote}</p>}
              {analysis.warnings.map((w, i) => <p key={i} className="flex gap-2 text-xs text-amber-200/90"><AlertTriangle size={14} className="shrink-0 mt-px" />{w}</p>)}

              <div><h3 className="text-sm font-extrabold text-[#FFC400] mb-2">{t.reviewTitle}</h3>
                {visibleChanges.length ? <ChangeList changes={visibleChanges} lang={lang} /> : <p className="text-xs text-neutral-500">{t.nothing}</p>}</div>

              {analysis.hasSettingsChanges && (
                <label className={`flex items-start gap-3 rounded-xl border p-3 ${canSettings ? 'cursor-pointer border-neutral-700' : 'opacity-50 border-neutral-800'}`}>
                  <input type="checkbox" className="peer sr-only" disabled={!canSettings} checked={includeSettings} onChange={(e) => setIncludeSettings(e.target.checked)} />
                  <span className="mt-0.5 w-5 h-5 shrink-0 rounded-md border border-white/30 flex items-center justify-center text-[#0A0A0A] peer-checked:bg-red-400 peer-checked:border-red-400"><Check size={14} strokeWidth={3.5} className={includeSettings ? 'scale-100' : 'scale-0'} /></span>
                  <span><b className="block text-[13px]">{t.settingsToggle}</b><span className="block text-xs text-neutral-400 mt-0.5">{t.settingsToggleD}</span>
                    {includeSettings && <span className="mt-1.5 flex gap-1.5 text-xs font-bold text-red-300"><ShieldAlert size={14} className="shrink-0" />{t.settingsWarn}</span>}</span>
                </label>
              )}

              {needsWord && (
                <div><label htmlFor="bk-confirm" className="block text-xs font-semibold text-neutral-400 mb-1.5">{t.typeToConfirm(t.confirmWord)}</label>
                  <input id="bk-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters"
                    className="w-full h-12 rounded-xl bg-black border border-neutral-700 px-3 text-sm outline-none focus:border-[#FFC400] focus:ring-4 focus:ring-[#FFC400]/15" /></div>
              )}
              <div className="flex flex-wrap gap-2.5">
                <button type="button" disabled={!okToApply} onClick={apply} className="btn-tactile h-11 px-5 rounded-full bg-[#FFC400] text-[#0A0A0A] text-sm font-extrabold inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
                  {busy ? <><Loader2 size={16} className="animate-spin" />{t.applying}</> : <><Check size={16} strokeWidth={3} />{t.apply}</>}</button>
                <button type="button" onClick={() => setAnalysis(null)} className="btn-tactile h-11 px-5 rounded-full border border-neutral-700 text-neutral-300 text-sm font-bold">{t.startOver}</button>
              </div>
            </div>
          )}

          {analysis && applied && (
            <div className={`${card} text-center py-8`}>
              <span className="mx-auto w-14 h-14 rounded-full bg-[#FFC400] text-[#0A0A0A] flex items-center justify-center"><Check size={28} strokeWidth={3} /></span>
              <p className="mt-3 text-sm font-extrabold">{t.applied}</p>
              <button type="button" onClick={() => { setAnalysis(null); setApplied(false); setTab('history'); }} className="btn-tactile mt-4 h-10 px-5 rounded-full border border-neutral-700 text-neutral-200 text-xs font-bold">{t.tHistory}</button>
            </div>
          )}
        </motion.div>
      )}

      {/* TRASH */}
      {tab === 'trash' && (
        <motion.div key="t" {...rise(0)} className={card}>
          <p className="text-xs leading-relaxed text-neutral-400">{t.trashIntro}</p>
          <div className="mt-3 space-y-2">
            {trash.length === 0 && <p className="py-8 text-center text-xs text-neutral-500">{t.trashEmpty}</p>}
            <AnimatePresence initial={false}>
              {trash.map((x) => (
                <motion.div key={x.id} layout={reduce ? false : 'position'} exit={{ opacity: 0, scale: 0.96 }} className="rounded-xl border border-neutral-800 bg-black/40 p-3 flex items-center gap-3">
                  <span className="w-9 h-9 shrink-0 rounded-xl bg-black border border-neutral-800 text-neutral-400 flex items-center justify-center"><Trash2 size={16} /></span>
                  <span className="min-w-0 flex-1"><b className="block text-sm truncate">{isAr ? x.name.ar : x.name.en}</b>
                    <span className="text-[11px] text-neutral-500">{x.kind === 'item' ? t.item : t.category} · {rel(x.deletedAt, lang)} · {t.purge(x.purgeInDays)}</span></span>
                  <span className="flex gap-1.5 shrink-0">
                    <button type="button" onClick={() => onRestoreTrash(x.id)} className="btn-tactile h-9 px-3 rounded-full bg-[#FFC400] text-[#0A0A0A] text-xs font-extrabold inline-flex items-center gap-1"><RotateCcw size={13} />{t.restoreItem}</button>
                    <button type="button" onClick={() => (sure === x.id ? (setSure(null), onDeleteForever(x.id)) : setSure(x.id))} onBlur={() => setSure(null)}
                      className={`btn-tactile h-9 px-3 rounded-full border text-xs font-bold ${sure === x.id ? 'border-red-400 bg-red-500/15 text-red-300' : 'border-neutral-700 text-neutral-400'}`}>{sure === x.id ? t.sure : <Trash2 size={13} aria-label={t.deleteForever} />}</button>
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </motion.div>
      )}

      <AnimatePresence>
        {modal && (
          <Modal onClose={() => !busy && setModal(null)} label={t.restoreTitle}>
            <div className="flex items-start justify-between gap-3"><h3 className="text-lg font-extrabold">{t.restoreTitle}</h3>
              <button type="button" onClick={() => setModal(null)} aria-label={t.close} className="w-9 h-9 rounded-full border border-neutral-700 flex items-center justify-center text-neutral-400"><X size={16} /></button></div>
            <p className="mt-1 text-xs text-neutral-400">{fmtDate(modal.v.createdAt, lang)} · {t.src[modal.v.source]}</p>
            <p className="mt-4 mb-2 text-xs font-semibold text-neutral-300">{t.restoreSub}</p>
            {modal.changes === null ? <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-[#FFC400]" /></div>
              : modal.changes.length ? <ChangeList changes={modal.changes} lang={lang} /> : <p className="text-xs text-neutral-500 py-3">{t.noChanges}</p>}
            <p className="mt-4 flex gap-2 rounded-xl bg-green-500/[0.07] border border-green-500/25 p-3 text-xs text-green-300"><ShieldCheck size={15} className="shrink-0 mt-px" />{t.safetyCopy}</p>
            <div className="mt-4 flex gap-2.5">
              <button type="button" disabled={busy || modal.changes === null} onClick={doRestore} className="btn-tactile flex-1 h-12 rounded-full bg-[#FFC400] text-[#0A0A0A] text-sm font-extrabold inline-flex items-center justify-center gap-2 disabled:opacity-50">
                {busy ? <><Loader2 size={16} className="animate-spin" />{t.restoring}</> : <><RotateCcw size={15} />{t.confirmRestore}</>}</button>
              <button type="button" disabled={busy} onClick={() => setModal(null)} className="btn-tactile h-12 px-5 rounded-full border border-neutral-700 text-neutral-300 text-sm font-bold">{t.cancel}</button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
};

export default BackupPanel;
