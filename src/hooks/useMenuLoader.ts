import { useState, useEffect } from 'react';
import type { MenuData } from '@/src/types/menu';
import { normalizeMenu } from '@/src/utils/pricing';
import { setServerOffsetFromDateHeader } from '@/src/utils/serverTime';
import { isRecord, readJson, parseJson } from '@/src/utils/safeJson';

/** Loads the menu document (API → cache → seed) and exposes it with its setter. */
export function useMenuLoader() {
  const [menu, setMenu] = useState<MenuData | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch Menu on load
  useEffect(() => {
    const loadMenu = async () => {
      // 1. Check local storage cache (v3: per-section display layouts —
      //    older cached menus would otherwise pin the previous shapes).
      let cached: MenuData | null = null;
      try {
        const raw = localStorage.getItem('menu_cache_v3');
        if (raw) {
          const parsed: unknown = parseJson(raw);
          const isStale =
            (isRecord(parsed) &&
              isRecord(parsed.settings) &&
              isRecord(parsed.settings.currency) &&
              parsed.settings.currency.en === 'EGP') ||
            (isRecord(parsed) && typeof parsed.version === 'number' ? parsed.version : 1) < 2;
          if (isStale) {
            localStorage.removeItem('menu_cache_v3');
          } else if (isRecord(parsed)) {
            cached = parsed as unknown as MenuData;
          }
        }
      } catch {}

      try {
        // Try to fetch from /api/menu or fallback to /menu.seed.json
        const res = await fetch('/api/menu').catch(() => null);
        if (res && res.ok) {
          setServerOffsetFromDateHeader(res.headers.get('Date'));
          const data = (await readJson(res)) as MenuData;
          const normalized = normalizeMenu(data);
          setMenu(normalized);
          try {
            localStorage.setItem('menu_cache_v3', JSON.stringify(normalized));
          } catch {}
          setLoading(false);
          return;
        }
      } catch {}

      // Fallback to cache if available
      if (cached) {
        const normalized = normalizeMenu(cached);
        setMenu(normalized);
        setLoading(false);
        return;
      }

      // Fallback to /menu.seed.json
      try {
        const seedRes = await fetch('/menu.seed.json');
        if (seedRes.ok) {
          const seedData = (await readJson(seedRes)) as MenuData;
          const normalized = normalizeMenu(seedData);
          setMenu(normalized);
          try {
            localStorage.setItem('menu_cache_v3', JSON.stringify(normalized));
          } catch {}
        }
      } catch {
        // Seed failed too — menu stays null, UI shows its fallback.
      } finally {
        setLoading(false);
      }
    };

    void loadMenu();
  }, []);

  // Background refresh: schedules, prices and content edited in the admin
  // (possibly on another device) must reach already-open pages. The banner
  // tick alone can't do that — it only re-renders local state. Polls every
  // 60s while visible + once on every return to the tab. Only swaps state
  // when version/updatedAt actually changed, so idle pages never re-render.
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const res = await fetch('/api/menu').catch(() => null);
        if (!alive || !res || !res.ok) return;
        setServerOffsetFromDateHeader(res.headers.get('Date'));
        const data = (await readJson(res)) as MenuData;
        if (!isRecord(data)) return;
        setMenu((prev) => {
          if (
            prev &&
            typeof data.version === 'number' &&
            typeof data.updatedAt === 'string' &&
            prev.version === data.version &&
            prev.updatedAt === data.updatedAt
          ) {
            return prev;
          }
          const normalized = normalizeMenu(data);
          try {
            localStorage.setItem('menu_cache_v3', JSON.stringify(normalized));
          } catch {}
          return normalized;
        });
      } catch {}
    };
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 60000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return { menu, setMenu, loading };
}
