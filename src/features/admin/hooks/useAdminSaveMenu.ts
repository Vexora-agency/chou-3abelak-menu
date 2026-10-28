import { MenuData, AdminSaveResult } from '@/src/types/menu';
import { isRecord, readJson, parseJson } from '@/src/utils/safeJson';
import { adminFetch } from '@/src/lib/api-client';

// Sends the admin's filled copy to the server and resolves with the
// authoritative doc. The admin screen keeps its raw text on screen
// (autofill appears after reload); only the version is adopted there.
export function useAdminSaveMenu(setMenu: (menu: MenuData) => void) {
  const handleSaveMenuFromAdmin = (newMenu: MenuData, source?: 'manual' | 'autosave'): Promise<AdminSaveResult | null> => {
    // Send to the backend and surface any failure instead of hiding it (single api-client)
    return adminFetch(`/api/admin/menu${source === 'autosave' ? '?source=autosave' : ''}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newMenu),
    })
      .then(async (res): Promise<AdminSaveResult | null> => {
        if (res.ok) {
          // Adopt the server copy so the customer view is current
          const saved: unknown = await readJson(res);
          if (isRecord(saved) && isRecord(saved.settings) && Array.isArray(saved.items)) {
            const doc = saved as unknown as MenuData;
            setMenu(doc);
            try {
              localStorage.setItem('menu_cache_v3', JSON.stringify(doc));
            } catch {}
            return { doc, saved: true };
          }
          return null;
        }
        const detail = await res.text().catch(() => '');
        if (res.status === 409) {
          let latest: MenuData | null = null;
          try {
            const data: unknown = parseJson(detail);
            if (
              isRecord(data) &&
              isRecord(data.latest) &&
              isRecord(data.latest.settings) &&
              Array.isArray(data.latest.items)
            ) {
              latest = data.latest as unknown as MenuData;
            }
          } catch {}
          window.alert('The menu was changed somewhere else. Reload the page and try again.');
          return latest ? { doc: latest, saved: false } : null;
        }
        window.alert(
          `Save failed (${res.status}). The change is visible only on this device.\n${detail.slice(0, 160)}`
        );
        return null;
      })
      .catch((): AdminSaveResult | null => {
        window.alert('Network error: the change was NOT saved to the server.');
        return null;
      });
  };

  return handleSaveMenuFromAdmin;
}
