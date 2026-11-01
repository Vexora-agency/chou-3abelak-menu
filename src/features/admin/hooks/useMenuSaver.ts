import { useState, useEffect, useRef, useCallback } from 'react';
import type { MenuData, AdminSaveResult } from '@/src/types/menu';
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

  const handleSave = async (source: 'manual' | 'autosave' = 'manual'): Promise<number | null> => {
    // Client-side validations below return early on problems
    const seenGrp = new Set<string>();
    for (const g of menu.settings.featureGroups || []) {
      if (!g.id.trim() || seenGrp.has(g.id.trim())) {
        alert(isAr ? 'معرّفات الأقسام يجب أن تكون فريدة وغير فارغة' : 'Section ids must be unique and non-empty');
        return null;
      }
      seenGrp.add(g.id.trim());
    }
    const seenFeat = new Set<string>();
    for (const f of menu.settings.featureDefs || []) {
      if (!f.id.trim() || seenFeat.has(f.id.trim())) {
        alert(isAr ? 'معرّفات الميزات يجب أن تكون فريدة وغير فارغة' : 'Feature ids must be unique and non-empty');
        return null;
      }
      seenFeat.add(f.id.trim());
      if (!(menu.settings.featureGroups || []).some((g) => g.id === f.groupId)) {
        alert(isAr ? `الميزة "${f.name.en || f.id}" بدون قسم صالح` : `Feature "${f.name.en || f.id}" has no valid section`);
        return null;
      }
    }
    // Announcement guards mirror the server validator (validate.js) so a bad
    // schedule is caught here with a clear message instead of a raw 400.
    const annSave = menu.settings.announcement;
    if (annSave?.enabled && !annSave.text.en.trim() && !annSave.text.ar.trim()) {
      alert(isAr ? 'شريط الإعلان مفعّل لكن بدون نص — اكتب نصاً بإحدى اللغتين أو أطفئ الشريط' : 'The banner is on but has no text — write text in at least one language or turn it off');
      return null;
    }
    if (annSave?.startsAt && annSave?.expiresAt) {
      const s = Date.parse(annSave.startsAt);
      const e = Date.parse(annSave.expiresAt);
      if (Number.isFinite(s) && Number.isFinite(e) && e <= s) {
        alert(isAr ? 'تاريخ الانتهاء يجب أن يكون بعد تاريخ البدء' : 'Ends must be after Starts');
        return null;
      }
    }
    if (annSave?.expiresAt) {
      const e = Date.parse(annSave.expiresAt);
      if (Number.isFinite(e) && e > Date.now() + 365 * 86400000) {
        alert(isAr ? 'تاريخ الانتهاء يجب أن يكون خلال 365 يوماً' : 'Ends must be within 365 days');
        return null;
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
      ...menu,
      settings: {
        ...menu.settings,
        name: fillBi(menu.settings.name),
        tagline: fillBi(menu.settings.tagline),
        address: fillBi(menu.settings.address),
        // hoursText is a legacy display field: always recompute it from the
        // SAVED open/close/days so it can never contradict the header pill
        // (which derives the same range via formatHoursRange).
        hoursText: {
          en: formatHoursRange(menu.settings, 'en'),
          ar: formatHoursRange(menu.settings, 'ar'),
        },
        currency: fillBi(menu.settings.currency),
        about: fillBi(menu.settings.about),
        featureDefs: (menu.settings.featureDefs || []).map((f) => ({ ...f, name: fillBi(f.name) })),
      },
      items: menu.items.map((i) => ({
        ...i,
        name: fillBi(i.name),
        description: fillBi(i.description),
      })),
      categories: menu.categories.map((c) => ({ ...c, name: fillBi(c.name) })),
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
      return result.doc.version;
    }
    // Failure: NEVER mark clean. A 409 carries the winning doc — adopt it
    // as the new truth (the alert already told the owner to reload), so
    // later trash/restore/import ops use the real baseVersion instead of a
    // stale one. A validation/network failure (null) keeps the local draft
    // dirty so nothing is silently lost.
    if (result && result.doc) {
      setMenu(result.doc);
      setDirty(false);
    }
    return null;
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
  // Returns the current server version, or null when saving failed.
  const flushDirty = useCallback(async (): Promise<number | null> => {
    if (!dirty) return menu.version;
    return handleSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, menu.version]);

  // Adopt the authoritative menu after restore/import/trash ops.
  const replaceMenu = useCallback((doc: MenuData) => {
    setMenu(doc);
    setDirty(false);
  }, []);

  return { menu, updateMenu, dirty, handleSave, flushDirty, replaceMenu, autoSave, setAutoSave };
}
