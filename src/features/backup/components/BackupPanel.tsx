// TODO(maint): 355 lines — split into BackupPanel + BackupHistory + BackupImport
// when next touched. backup/ subfolder (backupStrings/backupUtils/ChangeList/BackupModal)
// already started the split. Documented, not refactored (Fix 3C).
import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity, AlertTriangle, Archive, Check, Clock, Download, FileJson, FileSpreadsheet, History, Loader2, Printer, RotateCcw, ShieldAlert, ShieldCheck, Trash2, Upload, Undo2, X,
} from 'lucide-react';
import { STR } from './backup/backupStrings';
import { card, fmtDate, rel } from './backup/backupUtils';
import { ChangeList } from './backup/ChangeList';
import { BackupModal as Modal } from './backup/BackupModal';

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
export interface ActivityEntry {
  id: string;
  t: string;
  actor: string;
  action: string;
  label: { en: string; ar: string };
  ref: { kind: 'trash' | 'version'; id: string } | null;
}
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
  /** False when the Reports tab is plan-gated — the email can never be set then. */
  reportsOn: boolean;
  /** Live menu version: captured at review/apply time as the concurrency base. */
  menuVersion: number;
  onLoadChanges: (versionId: string) => Promise<{ changes: Change[]; comparedTo: 'live' | 'version' }>;
  onRestoreVersion: (versionId: string, expectedVersion?: number) => Promise<{ ok: boolean; conflict: boolean }>;
  onExport: (kind: 'json' | 'csv' | 'print') => void | Promise<void>;
  onAnalyzeImport: (file: File) => Promise<ImportAnalysis>;
  onApplyImport: (token: string, opts: { includeSettings?: boolean }) => Promise<{ ok: boolean; conflict: boolean }>;
  onRestoreTrash: (id: string) => Promise<{ ok: boolean; conflict: boolean }>;
  onDeleteForever: (id: string) => Promise<void>;
  onToggleAuto: (on: boolean) => Promise<{ ok: boolean }>;
  activity: ActivityEntry[];
}

const BackupPanel: React.FC<BackupPanelProps> = ({ lang, versions, trash, status, reportsOn, menuVersion, onLoadChanges, onRestoreVersion, onExport, onAnalyzeImport, onApplyImport, onRestoreTrash, onDeleteForever, onToggleAuto, activity }) => {
  // Owner decision: animations always run (never honor reduced-motion).
  const t = STR[lang]; const isAr = lang === 'ar'; const reduce = false;
  const [tab, setTab] = useState<'history' | 'export' | 'import' | 'trash'>('history');
  const [actFilter, setActFilter] = useState<'all' | 'saves' | 'deletes' | 'restores' | 'imports'>('all');
  const [limit, setLimit] = useState(6);
  const [modal, setModal] = useState<{ v: VersionEntry; changes: Change[] | null; comparedTo: 'live' | 'version'; baseVersion: number } | null>(null);
  const [busy, setBusy] = useState(false);
  // Single-writer discipline: while ANY menu mutation is in flight, every
  // other mutation button locks. Reads (review open, export, navigation)
  // stay live. The server's expectedVersion 409s remain the final guard —
  // this just stops you from tripping them by accident.
  const [opBusy, setOpBusy] = useState(false);
  const runOp = async <T,>(fn: () => Promise<T>): Promise<T> => {
    setOpBusy(true);
    try {
      return await fn();
    } finally {
      setOpBusy(false);
    }
  };
  const [note, setNote] = useState<string | null>(null);
  const [errNote, setErrNote] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [includeSettings, setIncludeSettings] = useState(false);
  const [busyUndoId, setBusyUndoId] = useState<string | null>(null);
  const doUndoTrash = async (trashId: string | null | undefined) => {
    if (!trashId || busyUndoId || opBusy) return;
    setBusyUndoId(trashId);
    try {
      const r = await runOp(() => onRestoreTrash(trashId));
      if (!r.ok) flashErr(r.conflict ? t.restoreConflict : t.actUndoFail);
    } finally {
      setBusyUndoId(null);
    }
  };
  const [typed, setTyped] = useState('');
  const [applied, setApplied] = useState(false);
  const [sure, setSure] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const flash = (s: string) => { setNote(s); window.setTimeout(() => setNote(null), 4200); };
  const flashErr = (s: string) => { setErrNote(s); window.setTimeout(() => setErrNote(null), 6000); };
  const rise = (d: number) => ({ initial: reduce ? (false as const) : { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.45, delay: d, ease: [0.22, 1, 0.36, 1] as const } });

  // Review race guard: tapping Review on several rows fast must never land
  // an older response on top of a newer modal (wrong version restored!).
  // Each open takes a ticket; only the latest ticket may commit.
  const reviewTicket = useRef(0);
  const openRestore = async (v: VersionEntry) => {
    const ticket = ++reviewTicket.current;
    // Capture the concurrency base NOW (what you reviewed is what must still
    // be live when you press restore — anything newer 409s instead of
    // silently overwriting).
    const base = menuVersion;
    setModal({ v, changes: null, comparedTo: 'live', baseVersion: base });
    const loaded = await onLoadChanges(v.id);
    if (reviewTicket.current !== ticket) return;
    setModal({ v, changes: loaded.changes, comparedTo: loaded.comparedTo, baseVersion: base });
  };
  const doRestore = async () => {
    if (!modal || opBusy) return;
    setBusy(true);
    try {
      const r = await runOp(() => onRestoreVersion(modal.v.id, modal.baseVersion));
      if (r.ok) {
        setModal(null);
        flash(t.done);
      } else if (r.conflict) {
        setModal(null);
        flashErr(t.restoreConflict);
      } else {
        flashErr(t.restoreFailed);
      }
    } finally {
      setBusy(false);
    }
  };

  // One timeline: version snapshots + logged actions, newest first.
  // 'save' actions are skipped — their version rows already represent them.
  type FeedItem = { kind: 'version'; t: string; v: VersionEntry } | { kind: 'act'; t: string; a: ActivityEntry };
  // Undo is offered only while the trash entry still exists — a second
  // click (or an already-purged entry) surfaces a clear error instead.
  const trashIds = new Set(trash.map((x) => x.id));
  const feed: FeedItem[] = [
    ...versions.map((v): FeedItem => ({ kind: 'version', t: v.createdAt || '', v })),
    ...activity.filter((a) => a.action !== 'save').map((a): FeedItem => ({ kind: 'act', t: a.t || '', a })),
  ]
    .filter((f) => {
      if (actFilter === 'all') return true;
      if (f.kind === 'version') return actFilter === 'saves';
      if (actFilter === 'deletes') return f.a.action === 'item.delete' || f.a.action === 'trash.delete';
      if (actFilter === 'restores') return f.a.action === 'trash.restore' || f.a.action === 'version.restore';
      if (actFilter === 'imports') return f.a.action === 'import.apply';
      return false;
    })
    .sort((x, y) => (x.t < y.t ? 1 : x.t > y.t ? -1 : 0));

  const analyze = async (file: File | undefined) => {
    if (!file) return; setBusy(true); setApplied(false); setTyped(''); setIncludeSettings(false);
    try { setAnalysis(await onAnalyzeImport(file)); } finally { setBusy(false); }
  };
  const canSettings = analysis?.signed === true && analysis.hasSettingsChanges;
  const visibleChanges = analysis ? analysis.changes.filter((c) => includeSettings || c.scope !== 'settings') : [];
  const needsWord = !!analysis && visibleChanges.length > 0;
  const okToApply = needsWord && typed.trim().toUpperCase() === t.confirmWord.toUpperCase() && !busy;
  const apply = async () => {
    if (!analysis || opBusy) return;
    setBusy(true);
    try {
      const r = await runOp(() => onApplyImport(analysis.token, { includeSettings: includeSettings && canSettings }));
      if (r.ok) setApplied(true);
      else if (r.conflict) flashErr(t.applyConflict);
      else flashErr(t.applyFailed);
    } finally {
      setBusy(false);
    }
  };

  const Tab = (id: typeof tab, label: string, icon: React.ReactNode, badge?: number) => (    <button key={id} type="button" onClick={() => setTab(id)} aria-pressed={tab === id}
      className={`relative shrink-0 px-3.5 h-9 rounded-full text-xs font-bold whitespace-nowrap inline-flex items-center gap-1.5 transition-colors ${tab === id ? 'text-[#0A0A0A]' : 'text-neutral-400 hover:text-white'}`}>
      {tab === id && <motion.span layoutId="bk-tab" className="absolute inset-0 rounded-full bg-[var(--primary)]" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
      <span className="relative z-10 inline-flex items-center gap-1.5">{icon}{label}{badge ? <span className={`px-1.5 rounded-full text-[10px] ${tab === id ? 'bg-black/15' : 'bg-neutral-800'}`}>{badge}</span> : null}</span>
    </button>
  );

  return (
    <div className="space-y-4" dir={isAr ? 'rtl' : 'ltr'}>
      <motion.div {...rise(0)} className={`${card} flex items-start gap-3.5`}>
        <span className="w-11 h-11 shrink-0 rounded-2xl bg-[var(--primary)] text-[#0A0A0A] flex items-center justify-center"><ShieldCheck size={22} /></span>
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
        {errNote && (<motion.div role="alert" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
          <div className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-3 text-xs text-red-300"><AlertTriangle size={15} />{errNote}</div></motion.div>)}
      </AnimatePresence>

      {/* HISTORY — one timeline: snapshots + logged actions, newest first */}
      {tab === 'history' && (
        <motion.div key="h" {...rise(0)} className={card}>
          <p className="text-xs leading-relaxed text-neutral-400">{t.histIntro}</p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {([
              ['all', t.fAll],
              ['saves', t.fSaves],
              ['deletes', t.fDeletes],
              ['restores', t.fRestores],
              ['imports', t.fImports],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setActFilter(k)}
                aria-pressed={actFilter === k}
                className={`h-8 px-3.5 rounded-full text-[11px] font-bold border transition-colors ${actFilter === k ? 'bg-[var(--primary)] border-[var(--primary)] text-[#0A0A0A]' : 'bg-transparent border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-white'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-3 space-y-2">
            {feed.length === 0 && <p className="py-8 text-center text-xs text-neutral-500">{t.actEmpty}</p>}
            {feed.slice(0, limit).map((f) =>
              f.kind === 'version' ? (
                <div key={`v-${f.v.id}`} className={`rounded-xl border p-3 ${f.v.current ? 'border-[var(--primary)]/40 bg-[var(--primary)]/[0.05]' : 'border-neutral-800 bg-black/40'}`}>
                  <div className="flex items-center gap-3">
                    <span className="w-9 h-9 shrink-0 rounded-xl bg-black border border-neutral-800 text-[var(--primary)] flex items-center justify-center">{f.v.source === 'restore' ? <RotateCcw size={16} /> : f.v.source === 'import' ? <Upload size={16} /> : <Archive size={16} />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 flex-wrap"><b className="text-sm">{t.src[f.v.source]}</b>{f.v.current && <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[var(--primary)] text-[#0A0A0A]">{t.current}</span>}</span>
                      <span className="block text-[11px] text-neutral-400 mt-0.5">{fmtDate(f.v.createdAt, lang)} · {t.by} {f.v.actor}</span>
                    </span>
                    {!f.v.current && (
                      <span className="flex gap-1.5 shrink-0">
                        <button type="button" onClick={() => void openRestore(f.v)} className="btn-tactile h-9 px-3 rounded-full border border-neutral-700 text-neutral-200 text-xs font-bold hover:border-[var(--primary)] hover:text-[var(--primary)]">{t.preview}</button>
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-bold">
                    {f.v.summary.added > 0 && <span className="px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">+{f.v.summary.added} {t.added}</span>}
                    {f.v.summary.removed > 0 && <span className="px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">−{f.v.summary.removed} {t.removed}</span>}
                    {f.v.summary.changed > 0 && <span className="px-2 py-0.5 rounded-full bg-[var(--primary)]/15 text-[var(--primary)]">~{f.v.summary.changed} {t.changed}</span>}
                    {f.v.summary.prices > 0 && <span className="px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-300">{f.v.summary.prices} {t.prices}</span>}
                  </div>
                </div>
              ) : (
                <div key={`a-${f.a.id || `${f.a.t}-${f.a.action}`}`} className="rounded-xl border border-neutral-800 bg-black/40 p-3 flex items-center gap-3">
                  <span className="w-9 h-9 shrink-0 rounded-xl bg-black border border-neutral-800 text-[var(--primary)] flex items-center justify-center"><Activity size={16} /></span>
                  <span className="min-w-0 flex-1">
                    <b className="block text-xs leading-snug">{isAr ? f.a.label.ar : f.a.label.en}</b>
                    <span className="text-[11px] text-neutral-500">{rel(f.a.t, lang)} · {f.a.actor}</span>
                  </span>
                      {f.a.ref?.kind === 'trash' && trashIds.has(f.a.ref.id) && (
                        <button type="button" onClick={() => void doUndoTrash(f.a.ref?.id)} disabled={busyUndoId === f.a.ref?.id || opBusy} className="btn-tactile h-9 px-3 rounded-full border border-neutral-700 text-neutral-200 text-xs font-extrabold inline-flex items-center gap-1.5 shrink-0 hover:border-[var(--primary)] hover:text-[var(--primary)] disabled:opacity-50" title={t.actUndo}>
                          {busyUndoId === f.a.ref?.id ? <Loader2 size={14} className="animate-spin" /> : <><Undo2 size={14} />{t.actUndo}</>}
                        </button>
                      )}
                </div>
              )
            )}
          </div>
          {feed.length > limit && <button type="button" onClick={() => setLimit((l) => l + 10)} className="btn-tactile mt-3 w-full h-10 rounded-full border border-neutral-700 text-neutral-300 text-xs font-bold hover:bg-white/5">+{feed.length - limit}</button>}
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
              <span className="w-11 h-11 shrink-0 rounded-2xl bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center"><x.icon size={21} /></span>
              <span className="min-w-0 flex-1"><span className="flex items-center gap-2 flex-wrap"><b className="text-sm">{x.a}</b>{x.rec && <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[var(--primary)] text-[#0A0A0A]">{t.recommended}</span>}</span>
                <span className="block text-xs leading-relaxed text-neutral-400 mt-1">{x.b}</span></span>
              <button type="button" onClick={() => void onExport(x.k)} className="btn-tactile shrink-0 h-10 px-4 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-xs font-extrabold">{x.btn}</button>
            </div>
          ))}
          <div className={`${card} flex items-center gap-3.5`}>
            <span className="w-11 h-11 shrink-0 rounded-2xl bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center"><Clock size={21} /></span>
            <span className="min-w-0 flex-1"><b className="text-sm">{t.autoTitle}</b><span className="block text-xs leading-relaxed text-neutral-400 mt-1">{!reportsOn ? t.autoNeedsPro : status.destination ? t.autoD(status.destination) : t.autoNoMail}</span></span>
            <button type="button" role="switch" aria-checked={status.autoWeekly} aria-label={t.autoTitle} disabled={!reportsOn || !status.destination} onClick={() => { const on = !status.autoWeekly; void (async () => { const r = await onToggleAuto(on); if (r.ok) { if (on) flash(t.autoOn); } else flashErr(t.autoFailed); })(); }}
              className={`relative w-12 h-7 rounded-full shrink-0 transition-colors disabled:opacity-40 ${status.autoWeekly ? 'bg-[var(--primary)]' : 'bg-neutral-700'}`}>
              <motion.span layout={!reduce} transition={{ type: 'spring', stiffness: 500, damping: 32 }} className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow ${status.autoWeekly ? 'end-1' : 'start-1'}`} />
            </button>
          </div>
        </motion.div>
      )}

      {/* IMPORT */}
      {tab === 'import' && (
        <motion.div key="i" {...rise(0)} className="space-y-3">
          {!analysis && (
            <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); void analyze(e.dataTransfer.files?.[0]); }}
              className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${drag ? 'border-[var(--primary)] bg-[var(--primary)]/[0.06]' : 'border-neutral-700 bg-neutral-900'}`}>
              {busy ? <><Loader2 size={30} className="mx-auto animate-spin text-[var(--primary)]" /><p className="mt-3 text-sm font-bold">{t.analyzing}</p></> : <>
                <Upload size={30} className="mx-auto text-[var(--primary)]" /><p className="mt-3 text-sm font-extrabold">{t.dropTitle}</p><p className="mt-1 text-xs text-neutral-500">{t.dropSub}</p>
                <button type="button" onClick={() => fileRef.current?.click()} className="btn-tactile mt-4 h-11 px-6 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-sm font-extrabold">{t.choose}</button></>}
              <input ref={fileRef} type="file" accept=".json,.csv,application/json,text/csv" className="sr-only" onChange={(e) => { void analyze(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
          )}

          {analysis && !applied && (
            <div className={`${card} space-y-4`}>
              <div className="flex items-start gap-3">
                <span className="w-10 h-10 shrink-0 rounded-xl bg-black border border-neutral-800 text-[var(--primary)] flex items-center justify-center">{analysis.format === 'json' ? <FileJson size={18} /> : <FileSpreadsheet size={18} />}</span>
                <span className="min-w-0 flex-1"><b className="block text-sm truncate" dir="ltr">{analysis.fileName}</b>
                  <span className="text-xs text-neutral-400">{analysis.counts.items} {t.items} · {analysis.counts.categories} {t.categories}</span></span>
                <span className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold border ${analysis.signed ? 'bg-green-500/15 text-green-400 border-green-500/30' : 'bg-amber-500/10 text-amber-300 border-amber-400/30'}`}>
                  {analysis.signed ? <ShieldCheck size={12} /> : <AlertTriangle size={12} />}{analysis.signed ? t.signed : analysis.format === 'csv' ? t.csvFile : t.unsigned}</span>
              </div>
              {!analysis.signed && <p className="text-xs leading-relaxed text-amber-200/90 bg-amber-500/[0.07] border border-amber-400/25 rounded-xl p-3">{t.unsignedNote}</p>}
              {analysis.warnings.map((w, i) => <p key={i} className="flex gap-2 text-xs text-amber-200/90"><AlertTriangle size={14} className="shrink-0 mt-px" />{w}</p>)}

              <div><h3 className="text-sm font-extrabold text-[var(--primary)] mb-2">{t.reviewTitle}</h3>
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
                    className="w-full h-12 rounded-xl bg-black border border-neutral-700 px-3 text-sm outline-none focus:border-[var(--primary)] focus:ring-4 focus:ring-[var(--primary)]/15" /></div>
              )}
              <div className="flex flex-wrap gap-2.5">
                <button type="button" disabled={!okToApply || opBusy} onClick={() => void apply()} className="btn-tactile h-11 px-5 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-sm font-extrabold inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
                  {busy ? <><Loader2 size={16} className="animate-spin" />{t.applying}</> : <><Check size={16} strokeWidth={3} />{t.apply}</>}</button>
                <button type="button" onClick={() => setAnalysis(null)} className="btn-tactile h-11 px-5 rounded-full border border-neutral-700 text-neutral-300 text-sm font-bold">{t.startOver}</button>
              </div>
            </div>
          )}

          {analysis && applied && (
            <div className={`${card} text-center py-8`}>
              <span className="mx-auto w-14 h-14 rounded-full bg-[var(--primary)] text-[#0A0A0A] flex items-center justify-center"><Check size={28} strokeWidth={3} /></span>
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
                      <button type="button" onClick={() => void doUndoTrash(x.id)} disabled={busyUndoId === x.id || opBusy} className="btn-tactile h-9 px-3 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-xs font-extrabold inline-flex items-center gap-1 disabled:opacity-50">{busyUndoId === x.id ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}{t.restoreItem}</button>
                    <button type="button" disabled={opBusy} onClick={() => { if (opBusy) return; if (sure === x.id) { setSure(null); void runOp(() => onDeleteForever(x.id)); } else setSure(x.id); }} onBlur={() => setSure(null)}
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
            <p className="mt-4 mb-2 text-xs font-semibold text-neutral-300">{modal.comparedTo === 'version' ? t.stepSub : t.restoreSub}</p>
            {modal.changes === null ? <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-[var(--primary)]" /></div>
              : modal.changes.length ? <ChangeList changes={modal.changes} lang={lang} /> : <p className="text-xs text-neutral-500 py-3">{t.noChanges}</p>}
            <p className="mt-4 flex gap-2 rounded-xl bg-green-500/[0.07] border border-green-500/25 p-3 text-xs text-green-300"><ShieldCheck size={15} className="shrink-0 mt-px" />{t.safetyCopy}</p>
            <div className="mt-4 flex gap-2.5">
              <button type="button" disabled={busy || opBusy || modal.changes === null} onClick={() => void doRestore()} className="btn-tactile flex-1 h-12 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-sm font-extrabold inline-flex items-center justify-center gap-2 disabled:opacity-50">
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
