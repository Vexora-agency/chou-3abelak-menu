// Pure /admin/accounts sorting logic. Run: npm run test:customer-sorting
import {
  sortCustomers,
  type AdminCustomer,
} from '../src/features/admin/customerSorting';

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
    joinedAt: daysAgo(200),
    ordersCount: 0,
    totalSpent: 0,
    firstOrderAt: null,
    lastOrderAt: null,
    ...overrides,
  };
}

const rows: AdminCustomer[] = [
  customer({ id: 'c1', name: 'Ali VIP', ordersCount: 8, totalSpent: 800, firstOrderAt: daysAgo(150), lastOrderAt: daysAgo(2) }),
  customer({ id: 'c2', name: 'Bilal Big', ordersCount: 6, totalSpent: 700, firstOrderAt: daysAgo(120), lastOrderAt: daysAgo(10) }),
  customer({ id: 'c3', name: 'Chadi Small', ordersCount: 1, totalSpent: 100, firstOrderAt: daysAgo(12), lastOrderAt: daysAgo(5) }),
  customer({ id: 'c4', name: 'Dina New', joinedAt: daysAgo(2) }),
];

const byOrders = sortCustomers(rows, { sort: 'orders', lang: 'en' });
ok('most orders first', byOrders[0].id === 'c1' && byOrders[1].id === 'c2');
const bySpend = sortCustomers(rows, { sort: 'spend', lang: 'en' });
ok('highest spend first', bySpend[0].id === 'c1' && bySpend[1].id === 'c2');
const byAvg = sortCustomers(rows, { sort: 'avg', lang: 'en' });
ok('highest average first', byAvg[0].id === 'c2'); // 116.67 average
const byRecent = sortCustomers(rows, { sort: 'recent', lang: 'en' });
ok('most recent order first', byRecent[0].id === 'c1');
const byName = sortCustomers(rows, { sort: 'name', lang: 'en' });
ok('name A-Z first', byName[0].name === 'Ali VIP');
const byNewest = sortCustomers(rows, { sort: 'newest', lang: 'en' });
ok('newest account first', byNewest[0].id === 'c4');

const originalOrder = rows.map((row) => row.id).join(',');
sortCustomers(rows, { sort: 'spend', lang: 'en' });
ok('sorting does not mutate the source rows', rows.map((row) => row.id).join(',') === originalOrder);

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${fail} failure(s)`);
process.exit(fail === 0 ? 0 : 1);
