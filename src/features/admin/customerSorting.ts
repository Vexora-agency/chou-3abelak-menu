/**
 * Pure customer sorting logic for /admin/accounts.
 * Kept out of the React component so the ordering rules are unit-testable.
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

function timestamp(iso: string | null): number {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

function averageOrder(row: AdminCustomer): number {
  return row.ordersCount > 0 ? row.totalSpent / row.ordersCount : 0;
}

/** Return a new array sorted by the selected column (descending unless name). */
export function sortCustomers(
  rows: AdminCustomer[],
  options: { sort: CustomerSort; lang: 'en' | 'ar' }
): AdminCustomer[] {
  const collator = new Intl.Collator(options.lang === 'ar' ? 'ar' : 'en', {
    sensitivity: 'base',
    numeric: true,
  });
  const list = rows.slice();
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

/** Total spend of the rows currently visible (already searched). */
export function customerVisibleSpend(rows: AdminCustomer[]): number {
  return rows.reduce((sum, row) => sum + (Number(row.totalSpent) || 0), 0);
}
