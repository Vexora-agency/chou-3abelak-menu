/**
 * Typed mirror of functions/_shared/status.js — the single implementation
 * is imported (never duplicated) so client and server can never drift.
 * Covers ordering.enabled in MenuSettings via the extended type below.
 */
import { getOrderingState as getState } from '../../functions/_shared/status.js';
import type { MenuSettings } from '../types/menu';

export type OrderingState = 'open' | 'paused' | 'closed' | 'disabled';

export interface OrderingStatus {
  state: OrderingState;
  message: { en: string; ar: string };
  reopensAt?: string;
}

export function getOrderingState(settings: MenuSettings, nowMs: number = Date.now()): OrderingStatus {
  return getState(settings, nowMs) as OrderingStatus;
}
