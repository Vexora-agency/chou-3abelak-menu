/**
 * Typed mirror of functions/_shared/status.js — the single implementation
 * is imported (never duplicated) so client and server can never drift.
 * Covers ordering.enabled in MenuSettings via the extended type below.
 */
import { getOrderingState as getState } from '@/functions/_shared/status.js';
import type { MenuSettings } from '@/src/types/menu';
import { isRecord, str } from '@/src/utils/safeJson';
import { publicGet, publicGetVersioned } from '@/src/lib/api-client';

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
  const data = await publicGet<unknown>('/api/ordering-state', signal);
  return parseOrderingStatus(data);
}

export interface VersionedOrderingFetch {
  state: OrderingStatus | null;
  /** Echo back on the next call so unchanged polls answer 304 (no body). */
  etag: string | null;
  /** True when the server answered 304: state is unchanged, keep showing it. */
  notModified: boolean;
}

/**
 * ETag round-trip variant for the scheduled poller (useOrderingState).
 * The checkout-time availability check keeps using fetchOrderingStatus
 * (always-fresh single shot). Shared parser below, so both paths agree.
 */
export async function fetchOrderingStatusVersioned(
  signal?: AbortSignal,
  etag?: string | null
): Promise<VersionedOrderingFetch> {
  const res = await publicGetVersioned<unknown>('/api/ordering-state', {
    ...(etag ? { etag } : {}),
    ...(signal ? { signal } : {}),
  });
  if (res.status === 'not-modified') return { state: null, etag: null, notModified: true };
  if (res.status !== 'fresh') return { state: null, etag: null, notModified: false };
  return { state: parseOrderingStatus(res.data), etag: res.etag, notModified: false };
}

function parseOrderingStatus(data: unknown): OrderingStatus | null {
  try {
    if (!data || !isRecord(data)) return null;
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
