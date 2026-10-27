/**
 * Typed mirror of functions/_shared/status.js — the single implementation
 * is imported (never duplicated) so client and server can never drift.
 * Covers ordering.enabled in MenuSettings via the extended type below.
 */
import { getOrderingState as getState } from '@/functions/_shared/status.js';
import type { MenuSettings } from '@/src/types/menu';
import { isRecord, readJson, str } from '@/src/utils/safeJson';
import { setServerOffsetFromDateHeader } from '@/src/utils/serverTime';

export type OrderingState = 'open' | 'paused' | 'closed' | 'disabled';

export interface OrderingStatus {
  state: OrderingState;
  message: { en: string; ar: string };
  reopensAt?: string;
}

export function getOrderingState(settings: MenuSettings, nowMs: number = Date.now()): OrderingStatus {
  return getState(settings, nowMs) as OrderingStatus;
}

/**
 * Live ordering status from the server. Never throws — returns null on any
 * failure so callers can fall back to the last known / local state.
 */
export async function fetchOrderingStatus(signal?: AbortSignal): Promise<OrderingStatus | null> {
  try {
    const res = await fetch('/api/ordering-state', signal ? { signal } : undefined).catch(() => null);
    if (!res || !res.ok) return null;
    setServerOffsetFromDateHeader(res.headers.get('Date'));
    const data: unknown = await readJson(res);
    if (!isRecord(data)) return null;
    const state = data.state;
    if (state !== 'open' && state !== 'paused' && state !== 'closed' && state !== 'disabled') return null;
    return {
      state,
      message: isRecord(data.message)
        ? { en: str(data.message.en), ar: str(data.message.ar) }
        : { en: '', ar: '' },
      ...(typeof data.reopensAt === 'string' ? { reopensAt: data.reopensAt } : {}),
    };
  } catch {
    return null;
  }
}
