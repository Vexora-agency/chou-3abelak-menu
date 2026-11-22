import { useCallback } from 'react';
import { adminFetch } from '@/src/lib/api-client';
import {
  ensureSW,
  fetchVapidKey,
  getExistingSub,
  isIosDevice,
  isPushCapable,
  isStandaloneApp,
  postJson,
  subscribeDevice,
  unsubscribeLocal,
} from '@/src/utils/webpush';

export type KitchenPushStatus =
  | 'on'
  | 'off'
  | 'denied'
  | 'ios'
  | 'unsupported'
  | 'error';

function deviceLabel(): string {
  try {
    if (isIosDevice()) return 'iPhone/iPad';
    const ua = navigator.userAgent;
    if (/android/i.test(ua)) return 'Android';
    if (/windows/i.test(ua)) return 'Windows';
    if (/macintosh/i.test(ua)) return 'Mac';
    return 'Browser';
  } catch {
    return '';
  }
}

/**
 * Kitchen Web Push lifecycle, driven by the dashboard bell toggle.
 *
 * Default behaviour: on mount `enable(false)` silently re-registers an
 * existing subscription (or subscribes when permission was already granted).
 * The bell handler calls `enable(true)` so a browser permission prompt can be
 * shown from that user gesture; turning the bell off calls `disable()` and
 * removes both the server row and the local subscription.
 */
export function useKitchenPush() {
  const enable = useCallback(async (interactive: boolean): Promise<KitchenPushStatus> => {
    if (!isPushCapable()) return isIosDevice() ? 'ios' : 'unsupported';
    if (isIosDevice() && !isStandaloneApp()) return 'ios';
    try {
      if (typeof Notification === 'undefined') return 'unsupported';
      if (Notification.permission === 'denied') return 'denied';
      if (Notification.permission === 'default' && !interactive) return 'off';

      await ensureSW();

      // Fast path: a browser subscription already exists (previous visit,
      // server row lost, re-login). Re-register it without prompting.
      const existing = await getExistingSub();
      if (existing) {
        const saved = await postJson(
          '/api/admin/push-subscriptions',
          { ...existing, label: deviceLabel() },
          true
        );
        if (saved.ok) return 'on';
      }

      const key = await fetchVapidKey();
      if (!key) return 'error';
      const result = await subscribeDevice(key);
      if (result.status === 'denied') return 'denied';
      if (result.status !== 'subscribed' || !result.sub) {
        return isIosDevice() ? 'ios' : 'unsupported';
      }
      const saved = await postJson(
        '/api/admin/push-subscriptions',
        { ...result.sub, label: deviceLabel() },
        true
      );
      return saved.ok ? 'on' : 'error';
    } catch {
      return 'error';
    }
  }, []);

  const disable = useCallback(async () => {
    try {
      const sub = await getExistingSub();
      if (sub) {
        try {
          await adminFetch('/api/admin/push-subscriptions', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          });
        } catch {}
      }
      await unsubscribeLocal();
    } catch {}
  }, []);

  return { enable, disable };
}
