// Features fakes + fixtures shared by test-features-* splits. Pure moves
// from scripts/test-features.mjs (same KV/DB behavior, same MENU values).
export function makeDB(orderRows) {
  const db = {
    orders: orderRows.map((o) => ({ ...o })),
    async batch(stmts) {
      for (const s of stmts) await s.run();
    },
    prepare(sql) {
      const st = {
        _a: [],
        bind(...a) {
          st._a = a;
          return st;
        },
        async first() {
          return qFirst(sql, st._a);
        },
        async all() {
          return { results: qAll(sql, st._a) };
        },
        async run() {
          return { meta: { changes: qRun(sql, st._a) } };
        },
      };
      return st;
    },
  };
  const like = (v, pat) => String(v == null ? '' : v).includes(String(pat).replace(/%/g, ''));
  function qFirst(sql, a) {
    if (sql.includes('FROM monthly_reports WHERE month')) return null;
    if (sql.includes('COALESCE(SUM(total)')) {
      const rows = db.orders.filter((o) => o.created_at >= a[0] && o.created_at < a[1] && o.status !== 'cancelled');
      return { c: rows.length, rev: rows.reduce((s, o) => s + o.total, 0) };
    }
    if (sql.includes('SELECT MAX(number)')) {
      return { m: db.orders.reduce((m, o) => Math.max(m, o.number || 0), 1000) };
    }
    if (sql.includes('FROM orders WHERE idem_key')) return null;
    if (sql.includes('SELECT MIN(created_at)')) {
      const ms = db.orders.map((o) => o.created_at).sort();
      return { m: ms.length ? ms[0] : null };
    }
    throw new Error('fake first: ' + sql.slice(0, 60));
  }
  function qAll(sql, a) {
    if (sql.includes('GROUP BY status')) {
      const m = new Map();
      for (const o of db.orders.filter((x) => x.created_at >= a[0] && x.created_at < a[1])) m.set(o.status, (m.get(o.status) || 0) + 1);
      return [...m.entries()].map(([status, c]) => ({ status, c }));
    }
    if (sql.includes('ORDER BY number ASC')) {
      return db.orders.filter((o) => o.created_at >= a[0] && o.created_at < a[1]).sort((x, y) => x.number - y.number);
    }
    if (sql.includes('ORDER BY created_at DESC LIMIT 50')) {
      return db.orders.filter((o) => like(o.phone_norm, a[0])).slice(0, 50);
    }
    if (sql.includes('phone_norm LIKE')) {
      return db.orders.filter((o) => like(o.phone_norm, a[0] === undefined ? a[1] : a[a.length - 1])).slice(0, 50);
    }
    if (sql.includes('SELECT month FROM monthly_reports')) return [];
    throw new Error('fake all: ' + sql.slice(0, 60));
  }
  function qRun(sql, a) {
    if (sql.startsWith('INSERT INTO orders')) {
      const cols = ['id', 'number', 'idem_key', 'created_at', 'updated_at', 'status', 'type', 'customer_name', 'customer_phone', 'phone_norm', 'customer_address', 'customer_table', 'notes', 'location_lat', 'location_lng', 'items_json', 'subtotal', 'delivery_fee', 'total', 'lang'];
      const row = {};
      cols.forEach((c, i) => { row[c] = a[i] === undefined ? null : a[i]; });
      row.pii_purged_at = null;
      db.orders.push(row);
      return 1;
    }
    if (sql.startsWith('INSERT INTO monthly_reports')) return 1;
    if (sql.includes('SET customer_name = NULL')) {
      let n = 0;
      for (const o of db.orders) {
        const match = a.length === 2 ? like(o.phone_norm, a[1]) : o.created_at < a[1] && (o.pii_purged_at === null || o.pii_purged_at === undefined);
        if (match) {
          o.customer_name = null;
          o.customer_phone = null;
          o.phone_norm = null;
          o.customer_address = null;
          o.customer_table = null;
          o.notes = null;
          o.location_lat = null;
          o.location_lng = null;
          o.pii_purged_at = a[0];
          n += 1;
        }
      }
      return n;
    }
    if (sql.startsWith('DELETE FROM orders')) {
      const before = db.orders.length;
      db.orders = db.orders.filter((o) => !like(o.phone_norm, a[0]));
      return before - db.orders.length;
    }
    throw new Error('fake run: ' + sql.slice(0, 60));
  }
  return db;
}

export const MENU = {
  version: 3,
  schemaVersion: 2,
  updatedAt: '2026-01-01T00:00:00.000Z',
  settings: {
    name: { en: 'T', ar: 'م' }, tagline: { en: '', ar: '' }, address: { en: '', ar: '' },
    hoursText: { en: '', ar: '' }, currency: { en: 'LBP', ar: 'ل.ل' }, logoText: 'T',
    phone: '70123456', whatsapp: '96170123456', mapUrl: '', statusMode: 'auto',
    openTime: '00:00', closeTime: '00:00', workingDays: ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'],
    timezone: 'Asia/Beirut', social: {}, socialEnabled: {}, about: { en: '', ar: '' },
    ordering: { enabled: true, types: ['delivery'], minOrder: 0, minOrderEnabled: false, deliveryFee: 0, deliveryFeeEnabled: false, note: { en: '', ar: '' }, paused: false, pausedUntil: null, pausedMessage: { en: '', ar: '' }, acceptWhenClosed: false },
    featureGroups: [], featureDefs: [], badges: { newDays: 1, topDays: 1, topCount: 1 },
    announcement: { enabled: false, text: { en: '', ar: '' }, startsAt: null, expiresAt: null },
    privacy: { extra: { en: '', ar: '' }, reviewed: false },
  },
  categories: [{ id: 'c1', name: { en: 'Pies', ar: 'فطائر' }, visible: true }],
  items: [{
    id: 'zaatar', categoryId: 'c1', name: { en: 'Zaatar', ar: 'زعتر' }, description: { en: '', ar: '' },
    pricing: { unit: 'pc', minQty: 1, step: 1, maxQty: 50, showUnit: false, price: 100000 },
    addons: [], badges: [], featured: false, available: true,
  }],
  addonGroups: [],
};

export function orderBody(over = {}) {
  return {
    type: 'delivery',
    customer: { name: 'John', phone: '70123456', address: 'Hamra' },
    notes: '',
    items: [{ id: 'zaatar', qty: 1 }],
    lang: 'en',
    ...over,
  };
}

export function mkOrderRow(n, created, phone, status = 'completed') {
  return {
    id: `o${n}`, number: 1000 + n, idem_key: null, created_at: created, updated_at: created,
    status, type: 'delivery', customer_name: 'John Doe', customer_phone: phone, phone_norm: String(phone).replace(/[^0-9]/g, ''),
    customer_address: 'Hamra', customer_table: null, notes: 'note', location_lat: 33.9, location_lng: 35.5,
    items_json: '[]', subtotal: 100, delivery_fee: 0, total: 100, lang: 'en', pii_purged_at: null,
  };
}
