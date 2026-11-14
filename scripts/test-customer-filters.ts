// Pure /admin/accounts filter + sort logic. Run: npm run test:customer-filters
import {
  customerSegmentMeta,
  customerVisibleSpend,
  filterAndSortCustomers,
  type AdminCustomer,
} from '../src/features/admin/customerFilters';

const NOW = Date.parse('2026-11-14T12:00:00.000Z');
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) {
    pass += 1;
    console.log(`  ok ${name}`);
  } else {
    fail += 1;
    console.error(`  FAIL ${name}`);
  }
};

function customer(overrides: Partial<AdminCustomer> & Pick<AdminCustomer, 'id' | 'name'>): AdminCustomer {
  return {
    email: `${overrides.id}@example.com`,
    emailVerified: true,
    image: null,
    phone: '70123456',
    address: 'Beirut, Hamra',
    hasLocation: true,
    joinedAt: daysAgo(300),
    ordersCount: 0,
    totalSpent: 0,
    firstOrderAt: null,
    lastOrderAt: null,
    ...overrides,
  };
}

const rows: AdminCustomer[] = [
  customer({ id: 'c12', name: 'Ziad Top', ordersCount: 10, totalSpent: 1000, firstOrderAt: daysAgo(200), lastOrderAt: daysAgo(4) }),
  customer({ id: 'c1', name: 'Ali Fast', ordersCount: 8, totalSpent: 800, firstOrderAt: daysAgo(150), lastOrderAt: daysAgo(2) }),
  customer({ id: 'c2', name: 'Bilal Big', ordersCount: 6, totalSpent: 700, firstOrderAt: daysAgo(120), lastOrderAt: daysAgo(10) }),
  customer({ id: 'c3', name: 'Chadi Repeat', ordersCount: 3, totalSpent: 300, firstOrderAt: daysAgo(100), lastOrderAt: daysAgo(40) }),
  customer({ id: 'c4', name: 'Dina Active', ordersCount: 1, totalSpent: 100, firstOrderAt: daysAgo(12), lastOrderAt: daysAgo(5), joinedAt: daysAgo(60) }),
  customer({ id: 'c5', name: 'Elie Risk', ordersCount: 2, totalSpent: 200, firstOrderAt: daysAgo(180), lastOrderAt: daysAgo(90) }),
  customer({ id: 'c6', name: 'Fadi New', joinedAt: daysAgo(10) }),
  customer({ id: 'c7', name: 'Ghadi NoPhone', phone: null, ordersCount: 1, totalSpent: 50, firstOrderAt: daysAgo(8), lastOrderAt: daysAgo(3) }),
  customer({ id: 'c8', name: 'Hadi NoAddress', address: null, ordersCount: 1, totalSpent: 60, firstOrderAt: daysAgo(9), lastOrderAt: daysAgo(6) }),
  customer({ id: 'c9', name: 'Imad NoPin', hasLocation: false, ordersCount: 2, totalSpent: 150, firstOrderAt: daysAgo(30), lastOrderAt: daysAgo(20) }),
  customer({ id: 'c10', name: 'Jad NewNoOrder', joinedAt: daysAgo(2) }),
  customer({ id: 'c11', name: 'Kamal Old', joinedAt: daysAgo(500) }),
  customer({ id: 'c13', name: 'Nadim Mid', ordersCount: 2, totalSpent: 200, firstOrderAt: daysAgo(100), lastOrderAt: daysAgo(70) }),
  customer({ id: 'c14', name: 'Rami Good', ordersCount: 4, totalSpent: 400, firstOrderAt: daysAgo(120), lastOrderAt: daysAgo(20) }),
];

const meta = customerSegmentMeta(rows, NOW);
ok('all count', meta.counts.all === rows.length);
ok('ordered count', meta.counts.ordered === 11);
ok('repeat count', meta.counts.repeat === 8);
ok('no-orders count', meta.counts['no-orders'] === 3);
ok('new 30d count', meta.counts.new === 2); // c6 (10d) + c10 (2d)
ok('active 30d count', meta.counts.active === 8); // c12,c1,c2,c4,c7,c8,c9,c14
ok('risk 60d+ count', meta.counts.risk === 2); // c5 (90d) + c13 (70d)
ok('incomplete count', meta.counts.incomplete === 3); // phone/address/pin
ok('vip is capped at 10', meta.counts.vip === 10 && meta.topIds.size === 10);
ok('vip excludes the smallest spender', !meta.topIds.has('c7') && meta.topIds.has('c12'));

const vip = filterAndSortCustomers(rows, { segment: 'vip', sort: 'spend', lang: 'en', now: NOW, topIds: meta.topIds });
ok('vip filter returns 10', vip.length === 10);
ok('vip sort starts with top spender', vip[0].id === 'c12' && vip[1].id === 'c1');

const byOrders = filterAndSortCustomers(rows, { segment: 'all', sort: 'orders', lang: 'en', now: NOW });
ok('most orders first', byOrders[0].id === 'c12' && byOrders[1].id === 'c1');
const bySpend = filterAndSortCustomers(rows, { segment: 'all', sort: 'spend', lang: 'en', now: NOW });
ok('highest spend first', bySpend[0].id === 'c12' && bySpend[1].id === 'c1');
const byAvg = filterAndSortCustomers(rows, { segment: 'all', sort: 'avg', lang: 'en', now: NOW });
ok('highest average first', byAvg[0].id === 'c2'); // 116.67 average
const byRecent = filterAndSortCustomers(rows, { segment: 'all', sort: 'recent', lang: 'en', now: NOW });
ok('most recent order first', byRecent[0].id === 'c1');
const byName = filterAndSortCustomers(rows, { segment: 'all', sort: 'name', lang: 'en', now: NOW });
ok('name A-Z first', byName[0].name === 'Ali Fast');

const active = filterAndSortCustomers(rows, { segment: 'active', sort: 'newest', lang: 'en', now: NOW });
ok('active filter keeps only recent orders', active.length === 8 && active.every((row) => row.lastOrderAt !== null));
const risk = filterAndSortCustomers(rows, { segment: 'risk', sort: 'newest', lang: 'en', now: NOW });
ok('risk filter keeps lapsed customers with orders', risk.length === 2 && risk.every((row) => row.ordersCount > 0));
const incomplete = filterAndSortCustomers(rows, { segment: 'incomplete', sort: 'newest', lang: 'en', now: NOW });
ok('incomplete filter includes missing phone/address/pin', incomplete.length === 3);
const noOrders = filterAndSortCustomers(rows, { segment: 'no-orders', sort: 'newest', lang: 'en', now: NOW });
ok('no-orders filter', noOrders.length === 3 && noOrders.every((row) => row.ordersCount === 0));
const newRows = filterAndSortCustomers(rows, { segment: 'new', sort: 'newest', lang: 'en', now: NOW });
ok('new 30d filter', newRows.length === 2 && newRows.every((row) => row.joinedAt !== null));

const originalOrder = rows.map((row) => row.id).join(',');
filterAndSortCustomers(rows, { segment: 'all', sort: 'spend', lang: 'en', now: NOW });
ok('sorting does not mutate the source rows', rows.map((row) => row.id).join(',') === originalOrder);
ok('visible spend sums the visible rows', customerVisibleSpend(bySpend.slice(0, 2)) === 1800);

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${fail} failure(s)`);
process.exit(fail === 0 ? 0 : 1);
