/**
 * Pure customer-segment/sort logic for /admin/accounts.
 * Kept out of the React component so the filter rules are unit-testable.
 */

export interface AdminCustomer {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  phone: string | null;
  address: string | null;
  /** Default-address pin is present (profile is order-ready). */
  hasLocation: boolean;
  joinedAt: string | null;
  ordersCount: number;
  totalSpent: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
}

export type CustomerSort = 'newest' | 'orders' | 'spend' | 'avg' | 'recent' | 'name';
export type CustomerSegment =
  | 'all'
  | 'ordered'
  | 'new'
  | 'active'
  | 'repeat'
  | 'vip'
  | 'risk'
  | 'no-orders'
  | 'incomplete';

export interface CustomerSegmentMeta {
  counts: Record<CustomerSegment, number>;
  /** The current top-N spender ids (same definition as the VIP segment). */
  topIds: Set<string>;
}

const DAY_MS = 86_400_000;
const NEW_WINDOW_DAYS = 30;
const ACTIVE_WINDOW_DAYS = 30;
const RISK_WINDOW_DAYS = 60;
const VIP_LIMIT = 10;

function timestamp(iso: string | null): number {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

function withinDays(iso: string | null, days: number, now: number): boolean {
  const ms = timestamp(iso);
  return ms !== Number.NEGATIVE_INFINITY && now - ms <= days * DAY_MS;
}

function olderThanDays(iso: string | null, days: number, now: number): boolean {
  const ms = timestamp(iso);
  return ms !== Number.NEGATIVE_INFINITY && now - ms > days * DAY_MS;
}

function averageOrder(row: AdminCustomer): number {
  return row.ordersCount > 0 ? row.totalSpent / row.ordersCount : 0;
}

/** Segment chip counts (including the current top-10 spender set). */
export function customerSegmentMeta(rows: AdminCustomer[], now: number = Date.now()): CustomerSegmentMeta {
  const counts: Record<CustomerSegment, number> = {
    all: rows.length,
    ordered: 0,
    new: 0,
    active: 0,
    repeat: 0,
    vip: 0,
    risk: 0,
    'no-orders': 0,
    incomplete: 0,
  };
  const withOrders: AdminCustomer[] = [];
  for (const row of rows) {
    if (row.ordersCount > 0) {
      counts.ordered += 1;
      withOrders.push(row);
    }
    if (row.ordersCount >= 2) counts.repeat += 1;
    if (withinDays(row.joinedAt, NEW_WINDOW_DAYS, now)) counts.new += 1;
    if (withinDays(row.lastOrderAt, ACTIVE_WINDOW_DAYS, now)) counts.active += 1;
    if (row.ordersCount > 0 && olderThanDays(row.lastOrderAt, RISK_WINDOW_DAYS, now)) counts.risk += 1;
    if (row.ordersCount === 0) counts['no-orders'] += 1;
    if (!row.phone || !row.address || !row.hasLocation) counts.incomplete += 1;
  }
  const topIds = new Set(
    withOrders
      .slice()
      .sort((a, b) => b.totalSpent - a.totalSpent || b.ordersCount - a.ordersCount)
      .slice(0, VIP_LIMIT)
      .map((row) => row.id)
  );
  counts.vip = topIds.size;
  return { counts, topIds };
}

/** Apply the selected segment and sort, returning a new array. */
export function filterAndSortCustomers(
  rows: AdminCustomer[],
  options: {
    segment: CustomerSegment;
    sort: CustomerSort;
    lang: 'en' | 'ar';
    now?: number;
    /** Optional precomputed meta (avoids a second pass in the component). */
    topIds?: Set<string>;
  }
): AdminCustomer[] {
  const now = options.now ?? Date.now();
  const collator = new Intl.Collator(options.lang === 'ar' ? 'ar' : 'en', {
    sensitivity: 'base',
    numeric: true,
  });
  const topIds = options.topIds ?? customerSegmentMeta(rows, now).topIds;
  const inSegment = (row: AdminCustomer): boolean => {
    switch (options.segment) {
      case 'ordered': return row.ordersCount > 0;
      case 'new': return withinDays(row.joinedAt, NEW_WINDOW_DAYS, now);
      case 'active': return withinDays(row.lastOrderAt, ACTIVE_WINDOW_DAYS, now);
      case 'repeat': return row.ordersCount >= 2;
      case 'vip': return topIds.has(row.id);
      case 'risk': return row.ordersCount > 0 && olderThanDays(row.lastOrderAt, RISK_WINDOW_DAYS, now);
      case 'no-orders': return row.ordersCount === 0;
      case 'incomplete': return !row.phone || !row.address || !row.hasLocation;
      default: return true;
    }
  };
  const list = rows.filter(inSegment);
  list.sort((a, b) => {
    switch (options.sort) {
      case 'orders':
        return b.ordersCount - a.ordersCount || b.totalSpent - a.totalSpent || collator.compare(a.name, b.name);
      case 'spend':
        return b.totalSpent - a.totalSpent || b.ordersCount - a.ordersCount || collator.compare(a.name, b.name);
      case 'avg':
        return averageOrder(b) - averageOrder(a) || b.totalSpent - a.totalSpent || collator.compare(a.name, b.name);
      case 'recent':
        return timestamp(b.lastOrderAt) - timestamp(a.lastOrderAt)
          || timestamp(b.joinedAt) - timestamp(a.joinedAt)
          || collator.compare(a.name, b.name);
      case 'name':
        return collator.compare(a.name, b.name) || b.ordersCount - a.ordersCount;
      default:
        return timestamp(b.joinedAt) - timestamp(a.joinedAt) || collator.compare(a.name, b.name);
    }
  });
  return list;
}

/** Total spend of the rows currently visible (already filtered/searched). */
export function customerVisibleSpend(rows: AdminCustomer[]): number {
  return rows.reduce((sum, row) => sum + (Number(row.totalSpent) || 0), 0);
}
