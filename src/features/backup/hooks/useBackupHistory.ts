import { useState, useEffect, useRef, useCallback } from 'react';
import type { MenuData } from '@/src/types/menu';
import type { ActivityEntry, Change, VersionEntry, TrashEntry, ImportAnalysis } from '../components/BackupPanel';
import { isRecord, readJson } from '@/src/utils/safeJson';
import type { AdminFetch } from '@/src/lib/api-client';

interface BackupHistoryOptions {
  isAr: boolean;
  lang: 'en' | 'ar';
  activeTab: string;
  adminFetch: AdminFetch;
  savePaused: { current: boolean };
  menuVersion: number;
  replaceMenu: (doc: MenuData) => void;
}

/** Specific, actionable message per analyze failure (instead of one generic alert). */
function analyzeErrorText(code: string, detail: string, isAr: boolean): string {
  switch (code) {
    case 'payload_too_large':
      return isAr ? 'الملف أكبر من 2 ميغابايت. قسّمه أو قلّص حجمه وحاول مجددًا.' : 'The file is larger than 2 MB. Split it or shrink it and try again.';
    case 'unsafe_json':
      return isAr ? 'الملف مرفوض لأسباب أمنية (مفاتيح ممنوعة أو تداخل عميق جدًا).' : 'File rejected for security reasons (forbidden keys or excessive nesting).';
    case 'bad_csv':
      return isAr ? 'ملف CSV غير صالح — تأكد أن أول سطر هو: category,item_id,name_en,name_ar,variant_id,variant_en,variant_ar,price,unit,available' : 'Invalid CSV file — the first row must be: category,item_id,name_en,name_ar,variant_id,variant_en,variant_ar,price,unit,available';
    case 'bad_json':
      return isAr ? 'ملف JSON غير صالح — تأكد من الصيغة (أقواس وفواصل سليمة).' : 'Invalid JSON file — check the syntax (balanced brackets and commas).';
    case 'validation_error':
      return detail || (isAr ? 'تعذر فحص الملف. تحقق من الصيغة وحاول مجددًا.' : 'Could not analyze the file. Check the format and try again.');
    case 'rate_limited':
      return isAr ? 'محاولات كثيرة — انتظر قليلًا وحاول مجددًا.' : 'Too many attempts — wait a while and try again.';
    default:
      return isAr ? 'تعذر فحص الملف. تحقق من الصيغة وحاول مجددًا.' : 'Could not analyze the file. Check the format and try again.';
  }
}

/** Backup & history domain: versions, trash, import/export, undo toast. */
export function useBackupHistory({ isAr, lang, activeTab, adminFetch, savePaused: savePausedRef, menuVersion, replaceMenu }: BackupHistoryOptions) {
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [trash, setTrash] = useState<TrashEntry[]>([]);
  // Owner signal from the server (versions response). Clients see their own
  // rows only and must never learn of the master layer: no actor pills, no
  // auto-backup switch. Starts UNKNOWN (null) so UI gates can fail-open
  // while the check is in flight — a definitive false hides owner UI.
  const [isOwner, setIsOwner] = useState<boolean | null>(null);
  const [backupStatus, setBackupStatus] = useState<{ lastBackupAt?: string; autoWeekly: boolean; destination?: string }>({ autoWeekly: false });
  const [undoToast, setUndoToast] = useState<{ label: string; undo: () => void } | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  // Load failure signal: an empty timeline must read as "failed to load",
  // never as "no history". Shown as a banner + Retry on the backup tab.
  const [backupError, setBackupError] = useState(false);
  const undoTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(undoTimer.current), []);
  // Live version ref: the 8s undo toast closes over delete-time renders,
  // but the restore must send TODAY's baseVersion (post-refresh), or every
  // toast undo 409s by construction.
  const menuVersionRef = useRef(menuVersion);
  menuVersionRef.current = menuVersion;

  const showUndoToast = useCallback((label: string, undo: () => void) => {
    setUndoToast({ label, undo });
    window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndoToast(null), 8000);
  }, []);

  const clearUndoToast = useCallback(() => {
    setUndoToast(null);
    window.clearTimeout(undoTimer.current);
  }, []);

  const fetchBackupData = useCallback(async () => {
    try {
      const r = await adminFetch('/api/admin/versions');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d: unknown = await readJson(r);
      setVersions(isRecord(d) && Array.isArray(d.versions) ? (d.versions as VersionEntry[]) : []);
      setIsOwner(isRecord(d) && d.isOwner === true);
      if (isRecord(d) && isRecord(d.status)) {
        setBackupStatus({
          autoWeekly: !!d.status.autoWeekly,
          lastBackupAt: typeof d.status.lastBackupAt === 'string' ? d.status.lastBackupAt : undefined,
          destination: typeof d.status.destination === 'string' ? d.status.destination : undefined,
        });
      }
      const t = await adminFetch('/api/admin/trash');
      if (t.ok) {
        const td: unknown = await readJson(t);
        setTrash(isRecord(td) && Array.isArray(td.trash) ? (td.trash as TrashEntry[]) : []);
      }
      setBackupError(false);
    } catch {
      setBackupError(true);
    }
  }, [adminFetch]);

  const fetchActivity = useCallback(async () => {
    try {
      const r = await adminFetch('/api/admin/activity');
      if (!r.ok) return;
      const d: unknown = await readJson(r);
      if (isRecord(d) && Array.isArray(d.activity)) {
        setActivity((d.activity as ActivityEntry[]).filter((a) => a && typeof a === 'object'));
      }
    } catch {}
  }, [adminFetch]);

  // Load backup data + activity when the backup tab opens (fetch triggers).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch trigger, see above
    if (activeTab === 'backup') { void fetchBackupData(); void fetchActivity(); }
  }, [activeTab, fetchBackupData, fetchActivity]);

  // Adopt the authoritative menu after restore/import/trash ops (auto-save
  // stays paused until the refresh completes).
  const refreshMenuFromServer = useCallback(async (): Promise<boolean> => {
    savePausedRef.current = true;
    try {
      const res = await adminFetch('/api/admin/menu');
      if (!res.ok) return false;
      const doc: unknown = await readJson(res);
      if (!isRecord(doc) || !isRecord(doc.settings) || !Array.isArray(doc.items)) return false;
      replaceMenu(doc as unknown as MenuData);
      await fetchBackupData();
      await fetchActivity();
      return true;
    } catch {
      return false;
    } finally {
      savePausedRef.current = false;
    }
  }, [adminFetch, fetchBackupData, fetchActivity, replaceMenu, savePausedRef]);

  const handleRestoreTrashById = useCallback(async (trashId: string): Promise<{ ok: boolean; conflict: boolean }> => {
    try {
      const res = await adminFetch(`/api/admin/trash/${encodeURIComponent(trashId)}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Live ref, not the render-time prop: the undo toast outlives the
        // refresh that bumped the version, and a stale baseVersion 409s.
        body: JSON.stringify({ baseVersion: menuVersionRef.current }),
      });
      const data: unknown = await readJson(res);
      if (!res.ok || !isRecord(data) || !data.ok) {
        const conflict = res.status === 409;
        if (conflict) await refreshMenuFromServer();
        return { ok: false, conflict };
      }
      clearUndoToast();
      await refreshMenuFromServer();
      return { ok: true, conflict: false };
    } catch {
      return { ok: false, conflict: false };
    }
  }, [adminFetch, refreshMenuFromServer, clearUndoToast]);

  const onLoadChanges = useCallback(async (versionId: string) => {
    const r = await adminFetch(`/api/admin/versions/${encodeURIComponent(versionId)}/changes?lang=${lang}`);
    // A failed load must NOT masquerade as "no differences": the owner
    // could otherwise restore blind. The modal shows error + Retry.
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d: unknown = await readJson(r);
    return {
      changes: isRecord(d) && Array.isArray(d.changes) ? (d.changes as Change[]) : [],
      comparedTo: isRecord(d) && d.comparedTo === 'version' ? ('version' as const) : ('live' as const),
    };
  }, [adminFetch, lang]);

  const onRestoreVersion = useCallback(async (versionId: string, expectedVersion?: number) => {
    try {
      const r = await adminFetch(`/api/admin/versions/${encodeURIComponent(versionId)}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(expectedVersion === undefined ? {} : { expectedVersion }),
      });
      const d: unknown = await readJson(r);
      if (!r.ok || !isRecord(d) || !d.ok) {
        const conflict = r.status === 409;
        if (conflict) await refreshMenuFromServer();
        return { ok: false, conflict };
      }
      await refreshMenuFromServer();
      return { ok: true, conflict: false };
    } catch {
      return { ok: false, conflict: false };
    }
  }, [adminFetch, refreshMenuFromServer]);

  const onExport = useCallback(async (kind: string) => {
    try {
      if (kind === 'print') {
        const r = await adminFetch(`/api/admin/backup/print?lang=${lang}`);
        if (!r.ok) throw new Error();
        const blob = await r.blob();
        const url = window.URL.createObjectURL(new Blob([blob], { type: 'text/html' }));
        window.open(url, '_blank', 'noopener');
        window.setTimeout(() => window.URL.revokeObjectURL(url), 60000);
        return;
      }
      const path = kind === 'json' ? '/api/admin/backup/export' : '/api/admin/backup/csv';
      const r = await adminFetch(path);
      if (!r.ok) throw new Error();
      const blob = await r.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const cd = r.headers.get('Content-Disposition') || '';
      const m = /filename="([^"]+)"/.exec(cd);
      a.download = m ? m[1] : kind === 'json' ? 'chou3abelak-backup.json' : 'chou3abelak-menu.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert(isAr ? 'تعذر التنزيل. حاول مجددًا.' : 'Could not download. Please try again.');
    }
  }, [adminFetch, isAr, lang]);

  const onAnalyzeImport = useCallback(async (file: File) => {
    // Client-side guard with a specific message (the server enforces the same 2 MB limit).
    if (file.size > 2 * 1024 * 1024) {
      alert(isAr ? 'الملف أكبر من 2 ميغابايت. قسّمه أو قلّص حجمه وحاول مجددًا.' : 'The file is larger than 2 MB. Split it or shrink it and try again.');
      throw new Error('analyze_failed');
    }
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const contentType = file.type.includes('csv') || ext === 'csv' ? 'text/csv' : 'application/json';
    try {
      const r = await adminFetch(`/api/admin/import/analyze?lang=${lang}&name=${encodeURIComponent(file.name.slice(0, 120))}`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: file,
      });
      const d: unknown = await readJson(r);
      if (!r.ok || !isRecord(d)) {
        const errStr = (v: unknown) => (typeof v === 'string' ? v : '');
        alert(analyzeErrorText(errStr(d && isRecord(d) ? d.error : ''), errStr(d && isRecord(d) ? d.message : ''), isAr));
        throw new Error('analyze_failed');
      }
      return d as unknown as ImportAnalysis;
    } catch (e) {
      if (e instanceof Error && e.message === 'analyze_failed') throw e;
      alert(isAr ? 'تعذر فحص الملف. تحقق من الصيغة وحاول مجددًا.' : 'Could not analyze the file. Check the format and try again.');
      throw new Error('analyze_failed', { cause: e });
    }
  }, [adminFetch, isAr, lang]);

  const onApplyImport = useCallback(async (token: string, opts: { includeSettings?: boolean }) => {
    try {
      const r = await adminFetch('/api/admin/import/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, includeSettings: !!opts.includeSettings, baseVersion: menuVersion }),
      });
      const d: unknown = await readJson(r);
      if (!r.ok || !isRecord(d) || !d.ok) {
        const conflict = r.status === 409;
        if (conflict) await refreshMenuFromServer();
        // Surface the server's specific reason (validation detail,
        // rate-limit, conflict) instead of a generic failure wherever present.
        const message = isRecord(d) && typeof d.message === 'string' && d.message ? d.message : '';
        const rateLimited = r.status === 429;
        return { ok: false, conflict, message, rateLimited };
      }
      await refreshMenuFromServer();
      return { ok: true, conflict: false, message: '', rateLimited: false };
    } catch {
      return { ok: false, conflict: false, message: '', rateLimited: false };
    }
  }, [adminFetch, menuVersion, refreshMenuFromServer]);

  const onRestoreTrash = useCallback(async (id: string): Promise<{ ok: boolean; conflict: boolean }> => {
    return handleRestoreTrashById(id);
  }, [handleRestoreTrashById]);

  const onDeleteForever = useCallback(async (id: string) => {
    try {
      const r = await adminFetch(`/api/admin/trash/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error();
      await fetchBackupData();
    } catch {
      alert(isAr ? 'تعذر الحذف النهائي. حاول مجددًا.' : 'Could not delete. Please try again.');
    }
  }, [adminFetch, fetchBackupData, isAr]);

  const onToggleAuto = useCallback(async (on: boolean) => {
    // Optimistic: the switch answers instantly. A failed save reverts to the
    // server truth via the refetch below — the caller shows the error note.
    setBackupStatus((s) => ({ ...s, autoWeekly: on }));
    try {
      const r = await adminFetch('/api/admin/backup/auto', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: on }),
      });
      const d: unknown = await readJson(r);
      if (!r.ok || !isRecord(d) || !d.ok) {
        await fetchBackupData();
        return { ok: false as const, noDestination: isRecord(d) && d.error === 'no_destination' };
      }
      await fetchBackupData();
      return { ok: true as const, noDestination: false };
    } catch {
      await fetchBackupData();
      return { ok: false as const, noDestination: false };
    }
  }, [adminFetch, fetchBackupData]);

  return {
    versions, trash, backupStatus, backupError, undoToast, showUndoToast, clearUndoToast,
    activity, fetchActivity, fetchBackupData, refreshMenuFromServer, handleRestoreTrashById,
    onLoadChanges, onRestoreVersion, onExport, onAnalyzeImport, onApplyImport,
    onRestoreTrash, onDeleteForever, onToggleAuto, isOwner,
  };
}
