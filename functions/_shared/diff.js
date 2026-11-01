/**
 * Menu diffing (no dependencies, pure functions).
 *
 * diffMenus(oldMenu, newMenu, lang) -> Change[] (max 500), each:
 *   { kind: 'added'|'removed'|'changed', scope: 'item'|'category'|'settings',
 *     label, detail?, sensitive? }
 * Price-change details always start with "Price"/"السعر" so
 * summarizeChanges() can count them for version badges.
 * Sensitive paths (contact/ordering/money/locale/plan keys) are flagged —
 * values still shown so the owner can review them, never hidden.
 */

const MAX_CHANGES = 500;

const L = {
  en: {
    price: 'Price',
    name: 'Name',
    availability: 'Availability',
    available: 'Available',
    hidden: 'Hidden',
    category: 'Category',
    variants: 'Variants',
    addonGroups: 'Add-on groups',
    groupsCount: (a, b) => `${a} → ${b} groups`,
    phone: 'Phone number',
    mapUrl: 'Map link',
    currencyEn: 'Currency (EN)',
    currencyAr: 'Currency (AR)',
    timezone: 'Timezone',
    statusMode: 'Open/closed mode',
    openTime: 'Opening time',
    closeTime: 'Closing time',
    workingDays: 'Working days',
    orderingOn: 'Online ordering',
    orderingTypes: 'Order types',
    minOrder: 'Minimum order',
    deliveryFee: 'Delivery fee',
  on: 'on',
  off: 'off',
  emptyCategory: 'Empty category',
  itemsInCategory: (n) => (n === 1 ? '1 item' : `${n} items`),
},
ar: {
    price: 'السعر',
    name: 'الاسم',
    availability: 'التوفر',
    available: 'متاح',
    hidden: 'مخفي',
    category: 'القسم',
    variants: 'الأحجام',
    addonGroups: 'مجموعات الإضافات',
    groupsCount: (a, b) => `${a} ← ${b} مجموعات`,
    phone: 'رقم الهاتف',
    mapUrl: 'رابط الخريطة',
    currencyEn: 'العملة (EN)',
    currencyAr: 'العملة (AR)',
    timezone: 'المنطقة الزمنية',
    statusMode: 'وضع الفتح/الإغلاق',
    openTime: 'وقت الفتح',
    closeTime: 'وقت الإغلاق',
    workingDays: 'أيام العمل',
    orderingOn: 'الطلب أونلاين',
    orderingTypes: 'أنواع الطلب',
    minOrder: 'أقل طلب',
    deliveryFee: 'رسوم التوصيل',
    on: 'مفعّل',
    off: 'مغلق',
    emptyCategory: 'قسم فارغ',
    itemsInCategory: (n) => (n === 1 ? 'صنف واحد' : n === 2 ? 'صنفان' : `${n} أصناف`),
  },
};

const SENSITIVE_RE = /phone|mapurl|ordering|currency|timezone|plan/i;

const fmtMoney = (n) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—';

const itemName = (it, lang) => {
  const nm = (it && it.name && (it.name[lang] || it.name.en)) || '';
  if (typeof nm === 'string' && nm.trim()) return nm.trim();
  const id = (it && it.id) || '';
  return id ? `${id} (${lang === 'ar' ? 'بدون اسم' : 'unnamed'})` : lang === 'ar' ? 'صنف' : 'item';
};

const catName = (c, lang) => {
  const nm = (c && c.name && (c.name[lang] || c.name.en)) || '';
  if (typeof nm === 'string' && nm.trim()) return nm.trim();
  const id = (c && c.id) || '';
  return id ? `${id} (${lang === 'ar' ? 'بدون اسم' : 'unnamed'})` : lang === 'ar' ? 'قسم' : 'category';
};

/** Comparable price signature: simple price, else sorted variant prices. */
function priceSig(it) {
  if (!it) return '';
  const vs = Array.isArray(it.variants) ? it.variants : [];
  if (vs.length === 0) {
    const p = it.pricing && typeof it.pricing.price === 'number' ? it.pricing.price : null;
    return `p:${p}`;
  }
  return (
    'v:' +
    vs
      .map((v) => `${v.featureId}:${v.price}`)
      .sort()
      .join(',')
  );
}

function simplePrice(it) {
  const vs = Array.isArray(it.variants) ? it.variants : [];
  if (vs.length > 0) return null;
  const p = it && it.pricing && typeof it.pricing.price === 'number' ? it.pricing.price : null;
  return p;
}

function variantDelta(a, b) {
  const ma = new Map((Array.isArray(a.variants) ? a.variants : []).map((v) => [v.featureId, v.price]));
  const mb = new Map((Array.isArray(b.variants) ? b.variants : []).map((v) => [v.featureId, v.price]));
  const names = new Set([...ma.keys(), ...mb.keys()]);
  const changed = [...names].filter((k) => ma.get(k) !== mb.get(k));
  return { from: ma.size, to: mb.size, changed: changed.length };
}

function str(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function diffMenus(a, b, lang = 'en') {
  const l = lang === 'ar' ? 'ar' : 'en';
  const t = L[l];
  const out = [];
  const push = (c) => {
    if (out.length < MAX_CHANGES) out.push(c);
  };
  const A = a || {};
  const B = b || {};

  // ---- items (by id) ----
  const am = new Map((Array.isArray(A.items) ? A.items : []).map((it) => [it && it.id, it]));
  const bm = new Map((Array.isArray(B.items) ? B.items : []).map((it) => [it && it.id, it]));
  const catOf = (menu, id) => {
    const cats = Array.isArray(menu.categories) ? menu.categories : [];
    return cats.find((c) => c && c.id === id) || null;
  };
  for (const [id, nb] of bm) {
    if (!id) continue;
    const ob = am.get(id);
    if (!ob) {
      const pb = simplePrice(nb);
      const priceBit = pb !== null ? ` · ${t.price} ${fmtMoney(pb)}` : '';
      push({ kind: 'added', scope: 'item', label: itemName(nb, l), detail: `${t.category}: ${catName(catOf(B, nb.categoryId), l)}${priceBit}` });
      continue;
    }
    if (itemName(ob, 'en') !== itemName(nb, 'en') || itemName(ob, 'ar') !== itemName(nb, 'ar')) {
      push({ kind: 'changed', scope: 'item', label: itemName(nb, l), detail: `${t.name}: ${itemName(ob, l)} → ${itemName(nb, l)}` });
    }
    if (priceSig(ob) !== priceSig(nb)) {
      const pa = simplePrice(ob);
      const pb = simplePrice(nb);
      const detail = pa !== null && pb !== null
        ? `${t.price} ${fmtMoney(pa)} → ${fmtMoney(pb)}`
        : `${t.variants}: ${variantDelta(ob, nb).changed} ${t.changed}`;
      push({ kind: 'changed', scope: 'item', label: itemName(nb, l), detail });
    }
    if (!!ob.available !== !!nb.available) {
      push({
        kind: 'changed',
        scope: 'item',
        label: itemName(nb, l),
        detail: `${t.availability}: ${ob.available ? t.available : t.hidden} → ${nb.available ? t.available : t.hidden}`,
      });
    }
    if ((ob.categoryId || '') !== (nb.categoryId || '')) {
      push({
        kind: 'changed',
        scope: 'item',
        label: itemName(nb, l),
        detail: `${t.category}: ${catName(catOf(A, ob.categoryId), l)} → ${catName(catOf(B, nb.categoryId), l)}`,
      });
    }
  }
  for (const [id, ob] of am) {
    if (!id || bm.has(id)) continue;
    const pb = simplePrice(ob);
    const priceBit = pb !== null ? ` · ${t.price} ${fmtMoney(pb)}` : '';
    push({ kind: 'removed', scope: 'item', label: itemName(ob, l), detail: `${t.category}: ${catName(catOf(A, ob.categoryId), l)}${priceBit}` });
  }

  // ---- categories (by id) ----
  const ac = new Map((Array.isArray(A.categories) ? A.categories : []).map((c) => [c && c.id, c]));
  const bc = new Map((Array.isArray(B.categories) ? B.categories : []).map((c) => [c && c.id, c]));
  for (const [id, nc] of bc) {
    if (!id) continue;
    if (!ac.has(id)) {
      const n = (Array.isArray(B.items) ? B.items : []).filter((it) => it && it.categoryId === id).length;
      push({ kind: 'added', scope: 'category', label: catName(nc, l), detail: n > 0 ? t.itemsInCategory(n) : t.emptyCategory });
    } else {
      const oc = ac.get(id);
      if (catName(oc, 'en') !== catName(nc, 'en') || catName(oc, 'ar') !== catName(nc, 'ar')) {
        push({ kind: 'changed', scope: 'category', label: catName(nc, l), detail: `${t.name}: ${catName(oc, l)} → ${catName(nc, l)}` });
      }
    }
  }
  for (const [id, oc] of ac) {
    if (!id || bc.has(id)) continue;
    const n = (Array.isArray(A.items) ? A.items : []).filter((it) => it && it.categoryId === id).length;
    push({ kind: 'removed', scope: 'category', label: catName(oc, l), detail: n > 0 ? t.itemsInCategory(n) : t.emptyCategory });
  }

  // ---- addonGroups (legacy array) ----
  const agA = Array.isArray(A.addonGroups) ? A.addonGroups : [];
  const agB = Array.isArray(B.addonGroups) ? B.addonGroups : [];
  if (JSON.stringify(agA) !== JSON.stringify(agB)) {
    const ids = (g) => new Set(g.map((x) => x && x.id).filter(Boolean));
    const ia = ids(agA);
    const ib = ids(agB);
    const addedN = [...ib].filter((x) => !ia.has(x)).length;
    const removedN = [...ia].filter((x) => !ib.has(x)).length;
    push({
      kind: addedN && !removedN ? 'added' : !addedN && removedN ? 'removed' : 'changed',
      scope: 'settings',
      label: t.addonGroups,
      detail: t.groupsCount(agA.length, agB.length),
    });
  }

  // ---- settings (curated operational paths) ----
  const sA = (A.settings && typeof A.settings === 'object' ? A.settings : {});
  const sB = (B.settings && typeof B.settings === 'object' ? B.settings : {});
  const oA = (sA.ordering && typeof sA.ordering === 'object' ? sA.ordering : {});
  const oB = (sB.ordering && typeof sB.ordering === 'object' ? sB.ordering : {});
  const paths = [
    ['phone', sA.phone, sB.phone],
    ['mapUrl', sA.mapUrl, sB.mapUrl],
    ['currencyEn', sA.currency && sA.currency.en, sB.currency && sB.currency.en],
    ['currencyAr', sA.currency && sA.currency.ar, sB.currency && sB.currency.ar],
    ['timezone', sA.timezone, sB.timezone],
    ['statusMode', sA.statusMode, sB.statusMode],
    ['openTime', sA.openTime, sB.openTime],
    ['closeTime', sA.closeTime, sB.closeTime],
    ['workingDays', Array.isArray(sA.workingDays) ? sA.workingDays.join(',') : sA.workingDays, Array.isArray(sB.workingDays) ? sB.workingDays.join(',') : sB.workingDays],
    ['orderingOn', !!oA.enabled, !!oB.enabled],
    ['orderingTypes', Array.isArray(oA.types) ? oA.types.join(',') : oA.types, Array.isArray(oB.types) ? oB.types.join(',') : oB.types],
    ['minOrder', oA.minOrder, oB.minOrder],
    ['deliveryFee', oA.deliveryFee, oB.deliveryFee],
  ];
  for (const [key, va, vb] of paths) {
    const sa = str(va);
    const sb = str(vb);
    if (sa === sb) continue;
    const label = t[key] || key;
    const sensitive = SENSITIVE_RE.test(key) || SENSITIVE_RE.test(label);
    let detail = `${sa || '—'} → ${sb || '—'}`;
    if (key === 'orderingOn') detail = `${va ? t.on : t.off} → ${vb ? t.on : t.off}`;
    push({ kind: 'changed', scope: 'settings', label, detail, sensitive: sensitive || undefined });
  }

  return out;
}

/** { added, removed, changed, prices } for version badges. */
export function summarizeChanges(changes) {
  const s = { added: 0, removed: 0, changed: 0, prices: 0 };
  for (const c of changes || []) {
    if (c.kind === 'added') s.added += 1;
    else if (c.kind === 'removed') s.removed += 1;
    else if (c.kind === 'changed') {
      s.changed += 1;
      if (c.scope === 'item' && typeof c.detail === 'string' && /^(Price\b|السعر)/.test(c.detail)) s.prices += 1;
    }
  }
  return s;
}
