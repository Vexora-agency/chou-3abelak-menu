import { MenuData, AdminSaveResult } from '@/src/types/menu';
import { isRecord, readJson, parseJson } from '@/src/utils/safeJson';
import { adminFetch } from '@/src/lib/api-client';

// Sends the admin's filled copy to the server and resolves with the
// authoritative doc. The admin screen keeps its raw text on screen
// (autofill appears after reload); only the version is adopted there.
export function useAdminSaveMenu(setMenu: (menu: MenuData) => void, isAr = false) {
  const handleSaveMenuFromAdmin = (newMenu: MenuData, source?: 'manual' | 'autosave'): Promise<AdminSaveResult | null> => {
    // Alerts are manual-only: an autosave loop must never pop an alert on
    // every retry. Autosave failures stay visible via the conflict banner
    // (409) or simply stay dirty and retry (network/validation).
    const tell = (msgAr: string, msgEn: string) => {
      if (source !== 'autosave') window.alert(isAr ? msgAr : msgEn);
    };
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
          tell(
            'تعارض حفظ — تغييرك الأخير محفوظ على هذا الجهاز ولم يُفقَد. أعد المحاولة.',
            'Save conflict — your latest change is kept on this device. Try saving again.'
          );
          return latest ? { doc: latest, saved: false } : null;
        }
        tell(
          `فشل الحفظ (${res.status}). التغيير ظاهر على هذا الجهاز فقط.\n${detail.slice(0, 160)}`,
          `Save failed (${res.status}). The change is visible only on this device.\n${detail.slice(0, 160)}`
        );
        return null;
      })
      .catch((): AdminSaveResult | null => {
        tell('خطأ شبكة: لم يُحفظ التغيير على الخادم.', 'Network error: the change was NOT saved to the server.');
        return null;
      });
  };

  return handleSaveMenuFromAdmin;
}
