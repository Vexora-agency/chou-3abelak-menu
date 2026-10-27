// Reports fakes + fixtures shared by test-reports-* splits. Pure moves
// from scripts/test-reports.mjs (same fake D1/R2/KV dispatch, same rows).
export function makeKV(menuObj) {
  const store = new Map();
  return {
    async get(k, opts) {
      if (k === 'menu' && opts && opts.type === 'json') return menuObj;
      return store.has(k) ? store.get(k) : null;
    },
    async put(k, v) {
      store.set(k, v);
    },
  };
}

export function makeR2() {
  const store = new Map();
  return {
    puts: 0,
    deletes: [],
    async put(k, v) {
      this.puts += 1;
      store.set(k, v);
    },
    async get(k) {
      if (!store.has(k)) return null;
      const v = store.get(k);
      return { text: async () => v };
    },
    async delete(k) {
      this.deletes.push(k);
      store.delete(k);
    },
  };
}

// Minimal in-memory D1 over fixture rows. Dispatches on the exact query
// shapes used by functions/_shared/reports.js (all statements use bind()).
export function makeDB(orderRows, reportRows) {
  const db = {
    orders: orderRows.map((o) => ({ ...o })),
    reports: reportRows.map((r) => ({ ...r })),
    prepare(sql) {
      const st = {
        _args: [],
        bind(...args) {
          st._args = args;
          return st;
        },
        async first() {
          return dispatchFirst(sql, st._args);
        },
        async all() {
          return { results: dispatchAll(sql, st._args) };
        },
        async run() {
          return { meta: { changes: dispatchRun(sql, st._args) } };
        },
      };
      return st;
    },
  };
  function inBounds(o, from, to) {
    return o.created_at >= from && o.created_at < to;
  }
  function dispatchFirst(sql, a) {
    if (sql.includes('FROM report_settings')) return null;
    if (sql.includes('FROM monthly_reports WHERE month')) {
      return db.reports.find((r) => r.month === a[0]) || null;
    }
    if (sql.includes('COALESCE(SUM(total)')) {
      const rows = db.orders.filter((o) => inBounds(o, a[0], a[1]) && o.status !== 'cancelled');
      return { c: rows.length, rev: rows.reduce((s, o) => s + o.total, 0) };
    }
    if (sql.includes('SELECT MIN(created_at)')) {
      const ms = db.orders.map((o) => o.created_at).sort();
      return { m: ms.length ? ms[0] : null };
    }
    throw new Error(`fake-db: unhandled first(): ${sql}`);
  }
  function dispatchAll(sql, a) {
    if (sql.includes('GROUP BY status')) {
      const map = new Map();
      for (const o of db.orders.filter((o) => inBounds(o, a[0], a[1]))) {
        map.set(o.status, (map.get(o.status) || 0) + 1);
      }
      return [...map.entries()].map(([status, c]) => ({ status, c }));
    }
    if (sql.includes('ORDER BY number ASC')) {
      return db.orders.filter((o) => inBounds(o, a[0], a[1])).sort((x, y) => x.number - y.number);
    }
    if (sql.includes('SELECT month FROM monthly_reports WHERE month <')) {
      return db.reports.filter((r) => r.month < a[0]).map((r) => ({ month: r.month }));
    }
    if (sql.includes('SELECT month FROM monthly_reports')) {
      return db.reports.map((r) => ({ month: r.month }));
    }
    throw new Error(`fake-db: unhandled all(): ${sql}`);
  }
  function dispatchRun(sql, a) {
    if (sql.includes('INSERT INTO monthly_reports')) {
      if (db.reports.some((r) => r.month === a[0])) throw new Error('UNIQUE constraint');
      db.reports.push({ month: a[0], summary_json: a[1], csv_key: a[2], generated_at: a[3], emailed_at: null, email_status: null, email_attempts: 0 });
      return 1;
    }
    if (sql.includes('SET customer_name = NULL')) {
      let n = 0;
      for (const o of db.orders) {
        if (o.created_at < a[1] && (o.pii_purged_at === null || o.pii_purged_at === undefined)) {
          o.customer_name = null;
          o.customer_phone = null;
          o.customer_address = null;
          o.notes = null;
          o.pii_purged_at = a[0];
          n += 1;
        }
      }
      return n;
    }
    if (sql.includes('DELETE FROM orders')) {
      const before = db.orders.length;
      db.orders = db.orders.filter((o) => !(o.created_at < a[0] && o.pii_purged_at !== null && o.pii_purged_at !== undefined));
      return before - db.orders.length;
    }
    if (sql.includes('DELETE FROM monthly_reports')) {
      const before = db.reports.length;
      db.reports = db.reports.filter((r) => !(r.month < a[0]));
      return before - db.reports.length;
    }
    throw new Error(`fake-db: unhandled run(): ${sql}`);
  }
  return db;
}

export const MENU = {
  settings: {
    timezone: 'Asia/Beirut',
    name: { en: 'Chou 3abelak', ar: 'شو عبالك' },
    currency: { en: 'LBP', ar: 'ل.ل' },
  },
  items: [],
};

export function item(id, en, ar, qty, unitPrice, extra) {
  return { id, name: { en, ar }, qty, unitPrice, ...(extra || {}) };
}

// Sep 2026 in Beirut is UTC+3: 20:00 local == 17:00Z.
export function mkOrder(number, created_at, status, type, items, subtotal, fee, total) {
  return {
    id: `o${number}`,
    number,
    created_at,
    updated_at: created_at,
    status,
    type,
    customer_name: 'John Doe',
    customer_phone: '70123456',
    customer_address: 'Beirut, Hamra',
    customer_table: null,
    notes: 'no onions please',
    items_json: JSON.stringify(items),
    subtotal,
    delivery_fee: fee,
    total,
    lang: 'en',
    pii_purged_at: null,
  };
}

export const SEP_ORDERS = [
  mkOrder(1001, '2026-09-12T17:05:00.000Z', 'completed', 'delivery',
    [item('zaatar', 'Plain Zaatar', 'زعتر سادة', 2, 150000)], 300000, 20000, 320000),
  mkOrder(1002, '2026-09-12T17:40:00.000Z', 'completed', 'delivery',
    [item('zaatar', 'Plain Zaatar', 'زعتر سادة', 1, 150000), item('pepsi', 'Pepsi', 'بيبسي', 2, 30000)], 210000, 20000, 230000),
  mkOrder(1003, '2026-09-05T10:00:00.000Z', 'completed', 'pickup',
    [item('pizza', 'Veggie Pizza, Large "Special"', 'بيتزا', 1, 400000, { variantName: { en: 'Large', ar: 'كبير' } })], 400000, 0, 400000),
  mkOrder(1004, '2026-09-12T09:00:00.000Z', 'cancelled', 'delivery',
    [item('zaatar', 'Plain Zaatar', 'زعتر سادة', 1, 100000)], 100000, 0, 100000),
  mkOrder(1005, '2026-08-15T12:00:00.000Z', 'completed', 'dinein',
    [item('pepsi', 'Pepsi', 'بيبسي', 4, 30000)], 120000, 0, 120000),
];
