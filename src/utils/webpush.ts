/**
 * Shared Web Push client bits (customer order updates AND owner kitchen
 * alerts). No UI here — state machines live in the components. The send
 * library stays out of the main bundle: `subscribeDevice` dynamic-imports it
 * only on tap.
 */

export interface SubJson {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export const isIosDevice = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
};

/** Full stack present (SW + PushManager + visible Notification API). */
export const isPushCapable = (): boolean =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  typeof Notification !== 'undefined';

/** Running as an installed Home Screen app (Apple's gate for iOS push). */
export const isStandaloneApp = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    return (navigator as unknown as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
};

export async function ensureSW(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register('/sw.js');
}

export async function fetchVapidKey(): Promise<string | null> {
  try {
    const res = await fetch('/api/push-key');
    if (!res.ok) return null;
    const data = (await res.json()) as { publicKey?: unknown };
    return typeof data.publicKey === 'string' && data.publicKey ? data.publicKey : null;
  } catch {
    return null;
  }
}

/** Existing browser subscription, if any (prior consent — no prompt). */
export async function getExistingSub(): Promise<SubJson | null> {
  try {
    if (!isPushCapable()) return null;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return null;
    const j = sub.toJSON();
    if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) return null;
    return { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth };
  } catch {
    return null;
  }
}

export async function unsubscribeLocal(): Promise<void> {
  try {
    if (!isPushCapable()) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch {}
}

export async function subscribeDevice(
  publicKey: string
): Promise<{ status: 'subscribed' | 'denied' | 'unsupported'; sub?: SubJson }> {
  const { subscribe } = await import('@mmmike/web-push/client');
  const result = await subscribe(publicKey);
  if (result.status !== 'subscribed') return { status: result.status };
  const j = result.subscription.toJSON();
  if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) return { status: 'unsupported' };
  return {
    status: 'subscribed',
    sub: { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth },
  };
}

export async function postJson(
  path: string,
  body: unknown,
  admin = false
): Promise<{ ok: boolean; status: number | null }> {
  try {
    if (admin) {
      const { adminFetch } = await import('@/src/lib/api-client');
      const res = await adminFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { ok: res.ok, status: res.status };
    }
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: null };
  }
}
