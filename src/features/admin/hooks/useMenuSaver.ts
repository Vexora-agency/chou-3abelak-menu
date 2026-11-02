import { useState, useEffect, useRef, useCallback } from 'react';
import type { FeatureGroup, MenuData, AdminSaveResult } from '@/src/types/menu';
import { ensureSettingsBlocks, formatHoursRange } from '@/src/utils/menuHelpers';

interface MenuSaverOptions {
  initialMenu: MenuData;
  onSaveMenu: (newMenu: MenuData, source?: 'manual' | 'autosave') => Promise<AdminSaveResult | null>;
  isAr: boolean;
  savePaused: { current: boolean };
  onSaved: () => void;
}

export function useMenuSaver({ initialMenu, onSaveMenu, isAr, savePaused: savePausedRef, onSaved }: MenuSaverOptions) {
  const [menu, setMenu] = useState<MenuData>(() => ensureSettingsBlocks(initialMenu));
  const [dirty, setDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveConflict, setSaveConflict] = useState(false);

  // Fresh-state mirror: queued/trailing saves must build from the LATEST
  // draft, never from the closure of the render that scheduled them.
  // (Synced in an effect — never assigned inside a state updater.)
  const menuRef = useRef(menu);
  useEffect(() => {
    menuRef.current = menu;
  }, [menu]);

  // Save serialization: overlapping PUTs carry the same base version, so
  // the loser 409s and the old handler discarded its draft (the off-by-one
  // hours lag). At most one PUT is ever in flight; a second request sets a
  // trailing flag and waits for the drain instead of firing immediately.
  const savingRef = useRef(false);
  const pendingRef = useRef<null | 'manual' | 'autosave'>(null);
  const drainWaiters = useRef<Array<() => void>>([]);
  const lastResultRef = useRef<number | null>(null);

  // Auto-save: when ON, every change is saved automatically after a short
  // pause, so the "unsaved changes" bar never appears. Persisted per device.
  const [autoSave, setAutoSave] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('admin_autosave_v1');
      // ON by default for new users; returning users keep their own choice.
      if (saved === null) return true;
      return saved === '1';
    } catch {
      return true;
    }
  });

  // Update helper
  const updateMenu = (updater: (prev: MenuData) => MenuData) => {
    setMenu((prev) => {
      const updated = updater(prev);
      setDirty(true);
      return updated;
    });
  };

  // One serialized PUT built from the freshest draft. Validation alerts
  // fire only for manual saves — an autosave loop must never alert every
  // 1.2 s on a persistently invalid draft (it stays dirty and retries).
  const runSave = async (source: 'manual' | 'autosave'): Promise<number | null> => {
    const snapshot = menuRef.current;
    const deny = (msgAr: string, msgEn: string): null => {
      if (source === 'manual') alert(isAr ? msgAr : msgEn);
      return null;
    };
    // Client-side validations below return early on problems
    const seenGrp = new Set<string>();
    for (const g of snapshot.settings.featureGroups || []) {
      if (!g.id.trim() || seenGrp.has(g.id.trim())) {
        return deny('معرّفات الأقسام يجب أن تكون فريدة وغير فارغة', 'Section ids must be unique and non-empty');
      }
      seenGrp.add(g.id.trim());
    }
    const seenFeat = new Set<string>();
    for (const f of snapshot.settings.featureDefs || []) {
      if (!f.id.trim() || seenFeat.has(f.id.trim())) {
        return deny('معرّفات الميزات يجب أن تكون فريدة وغير فارغة', 'Feature ids must be unique and non-empty');
      }
      seenFeat.add(f.id.trim());
      if (!(snapshot.settings.featureGroups || []).some((g) => g.id === f.groupId)) {
        return deny(`الميزة "${f.name.en || f.id}" بدون قسم صالح`, `Feature "${f.name.en || f.id}" has no valid section`);
      }
    }
    // Announcement guards mirror the server validator (validate.js) so a bad
    // schedule is caught here with a clear message instead of a raw 400.
    const annSave = snapshot.settings.announcement;
    if (annSave?.enabled && !annSave.text.en.trim() && !annSave.text.ar.trim()) {
      return deny('شريط الإعلان مفعّل لكن بدون نص — اكتب نصاً بإحدى اللغتين أو أطفئ الشريط', 'The banner is on but has no text — write text in at least one language or turn it off');
    }
    if (annSave?.startsAt && annSave?.expiresAt) {
      const s = Date.parse(annSave.startsAt);
      const e = Date.parse(annSave.expiresAt);
      if (Number.isFinite(s) && Number.isFinite(e) && e <= s) {
        return deny('تاريخ الانتهاء يجب أن يكون بعد تاريخ البدء', 'Ends must be after Starts');
      }
    }
    if (annSave?.expiresAt) {
      const e = Date.parse(annSave.expiresAt);
      if (Number.isFinite(e) && e > Date.now() + 365 * 86400000) {
        return deny('تاريخ الانتهاء يجب أن يكون خلال 365 يوماً', 'Ends must be within 365 days');
      }
    }
    // Send the CURRENT version; the server assigns version+1 on success.
    // (Bumping it here would always 409 against the server's check.)
    // Auto-fill: if one language is blank, copy the other so nothing renders empty
    const fillBi = (v: { en: string; ar: string }) => ({
      en: v.en.trim() ? v.en : v.ar,
      ar: v.ar.trim() ? v.ar : v.en,
    });
    const normalized: MenuData = {
      ...snapshot,
      settings: {
        ...snapshot.settings,
        name: fillBi(snapshot.settings.name),
        tagline: fillBi(snapshot.settings.tagline),
        address: fillBi(snapshot.settings.address),
        // hoursText is a legacy display field: always recompute it from the
        // SAVED open/close/days so it can never contradict the header pill
        // (which derives the same range via formatHoursRange).
        hoursText: {
          en: formatHoursRange(snapshot.settings, 'en'),
          ar: formatHoursRange(snapshot.settings, 'ar'),
        },
        currency: fillBi(snapshot.settings.currency),
        about: fillBi(snapshot.settings.about),
        featureDefs: (snapshot.settings.featureDefs || []).map((f) => ({ ...f, name: fillBi(f.name) })),
        // Library sections: fillBi names like everything else; selection is
        // normalized to 'single'|'multi' (default 'multi'); a prompt with one
        // blank side copies the filled side, both-blank drops to legacy.
        featureGroups: (snapshot.settings.featureGroups || []).map((g): FeatureGroup => {
          const base: FeatureGroup = {
            ...g,
            name: fillBi(g.name),
            selection: g.selection === 'single' ? 'single' : 'multi',
          };
          if (g.prompt === undefined) return base;
          const en = typeof g.prompt.en === 'string' ? g.prompt.en : '';
          const ar = typeof g.prompt.ar === 'string' ? g.prompt.ar : '';
          if (!en.trim() && !ar.trim()) {
            const { prompt: _dropped, ...rest } = base;
            void _dropped;
            return rest;
          }
          return { ...base, prompt: { en: en.trim() ? en : ar, ar: ar.trim() ? ar : en } };
        }),
      },
      items: snapshot.items.map((i) => ({
        ...i,
        name: fillBi(i.name),
        description: fillBi(i.description),
      })),
      categories: snapshot.categories.map((c) => ({ ...c, name: fillBi(c.name) })),
    };
    const updated = {
      ...normalized,
      version: normalized.version,
      updatedAt: new Date().toISOString(),
    };
    // Autofill is send-only: the server stores the filled copy, but the
    // screen keeps the admin's raw text (filled values appear after reload).
    // Adopt the authoritative version so the next save never 409s.
    const result = await onSaveMenu(updated, source);
    if (result && result.saved) {
      setMenu((prev) => ({ ...prev, version: result.doc.version, updatedAt: result.doc.updatedAt }));
      onSaved();
      setDirty(false);
      setSaveConflict(false);
      return result.doc.version;
    }
    // 409: adopt ONLY the winner's version/updatedAt — never its fields.
    // The local draft (the user's latest edits) stays on screen AND stays
    // dirty, so nothing is silently lost and the next save (auto or manual)
    // retries on the fresh base instead of 409ing again. No blind auto-retry
    // here: a second tab may own the conflicting change, and re-sending our
    // full doc over it would silently erase their work.
    if (result && result.doc) {
      setMenu((prev) => ({ ...prev, version: result.doc.version, updatedAt: result.doc.updatedAt }));
      setDirty(true);
      setSaveConflict(true);
    }
    return null;
  };

  // Serialized entry point: at most one PUT in flight. A save requested
  // while one runs coalesces into a single trailing run built from the
  // freshest draft (never a second PUT on the same base version), and
  // waiters (flushDirty) get the FINAL outcome, not an intermediate one.
  const handleSave = async (source: 'manual' | 'autosave' = 'manual'): Promise<number | null> => {
    if (savingRef.current) {
      pendingRef.current = source;
      await new Promise<void>((resolve) => {
        drainWaiters.current.push(resolve);
      });
      return lastResultRef.current;
    }
    savingRef.current = true;
    setIsSaving(true);
    try {
      let result = await runSave(source);
      while (pendingRef.current) {
        const next = pendingRef.current;
        pendingRef.current = null;
        // Restore/import/trash refreshes pause all saving — a trailing run
        // must not slip through and race the refresh.
        if (savePausedRef.current) break;
        result = await runSave(next);
      }
      lastResultRef.current = result;
      return result;
    } finally {
      savingRef.current = false;
      setIsSaving(false);
      const waiters = drainWaiters.current;
      drainWaiters.current = [];
      for (const w of waiters) {
        try { w(); } catch {}
      }
    }
  };

  // Keep a ref to the latest save so the auto-save timer never uses stale state
  const handleSaveRef = useRef(handleSave);
  useEffect(() => {
    handleSaveRef.current = handleSave;
  });

  useEffect(() => {
    try {
      localStorage.setItem('admin_autosave_v1', autoSave ? '1' : '0');
    } catch {}
  }, [autoSave]);

  // Auto-save shortly after any change while enabled (paused during
  // restore/import/trash refreshes so they never race the refresh).
  useEffect(() => {
    if (!autoSave || !dirty || savePausedRef.current) return;
    const t = window.setTimeout(() => { void handleSaveRef.current('autosave'); }, 1200);
    return () => window.clearTimeout(t);
  }, [autoSave, dirty, menu, savePausedRef]);

  // Flush unsaved edits first so server-side ops never discard them.
  // Returns the FINAL server version after any in-flight AND trailing
  // saves drain — never an intermediate one — or null when saving failed.
  const flushDirty = useCallback(async (): Promise<number | null> => {
    if (!dirty && !savingRef.current) return menuRef.current.version;
    return handleSaveRef.current('manual');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Adopt the authoritative menu after restore/import/trash ops.
  const replaceMenu = useCallback((doc: MenuData) => {
    pendingRef.current = null;
    setMenu(doc);
    setDirty(false);
    setSaveConflict(false);
  }, []);

  const dismissConflict = useCallback(() => {
    setSaveConflict(false);
  }, []);

  return { menu, updateMenu, dirty, handleSave, flushDirty, replaceMenu, autoSave, setAutoSave, isSaving, saveConflict, dismissConflict };
}
