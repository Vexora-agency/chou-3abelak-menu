/**
 * CSV domain (BOM, quotes, Arabic) + merge-apply (never deletes).
 * Split from versions.js — no dependencies, works in Cloudflare Workers and Node.
 * Re-exported from ./versions.js so existing importers keep working.
 */

const MENU_CSV_HEADER = 'category,item_id,name_en,name_ar,variant_id,variant_en,variant_ar,price,unit,available';

function csvCell(v) {
  const s = String(v ?? '');
  return /["\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function featureNameOf(menu, fid, lang) {
  try {
    const defs = (menu && menu.settings && menu.settings.featureDefs) || [];
    const d = defs.find((x) => x && x.id === fid);
    if (!d) return '';
    return (d.name && (d.name[lang] || d.name.en)) || '';
  } catch {
    return '';
  }
}

function bothNames(en, ar) {
  const e = typeof en === 'string' ? en : '';
  const a = typeof ar === 'string' ? ar : '';
  if (e && a && e !== a) return `${e} / ${a}`;
  return e || a;
}

/** One row per item × variant. UTF-8 with BOM. No customer data exists here. */
export function buildMenuCSV(menu) {
  const m = menu || {};
  const cats = new Map((Array.isArray(m.categories) ? m.categories : []).map((c) => [c && c.id, c]));
  const lines = [MENU_CSV_HEADER];
  for (const it of Array.isArray(m.items) ? m.items : []) {
    if (!it || !it.id) continue;
    const cat = cats.get(it.categoryId);
    const category = cat ? bothNames(cat.name && cat.name.en, cat.name && cat.name.ar) : '';
    const unit = (it.pricing && it.pricing.unit) || '';
    const available = it.available === false ? 'false' : 'true';
    const nameEn = (it.name && it.name.en) || '';
    const nameAr = (it.name && it.name.ar) || '';
    const vs = Array.isArray(it.variants) ? it.variants : [];
    if (vs.length === 0) {
      const price = it.pricing && typeof it.pricing.price === 'number' ? it.pricing.price : '';
      lines.push([category, it.id, nameEn, nameAr, '', '', '', price, unit, available].map(csvCell).join(','));
    } else {
      for (const v of vs) {
        if (!v) continue;
        const ven = featureNameOf(m, v.featureId, 'en');
        const varr = featureNameOf(m, v.featureId, 'ar');
        lines.push([category, it.id, nameEn, nameAr, v.featureId || '', ven, varr, typeof v.price === 'number' ? v.price : '', unit, available].map(csvCell).join(','));
      }
    }
  }
  return '﻿' + lines.join('\n') + '\n';
}

/** Minimal RFC-4180 reader: quotes, doubled quotes, CRLF, BOM, Arabic-safe. */
export function parseCSV(text) {
  let s = String(text || '');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else if (ch === '\r') {
      // skip (paired with \n)
    } else {
      cell += ch;
    }
  }
  if (quoted) throw new Error('bad_csv');
  row.push(cell);
  const tailEmpty = row.length === 1 && row[0] === '' && rows.length > 0;
  if (!tailEmpty) rows.push(row);
  if (rows.length === 0) throw new Error('bad_csv');
  return { headers: rows[0].map((h) => h.trim()), rows: rows.slice(1) };
}

/**
 * Merge CSV rows into the current menu (updates + careful adds, NEVER
 * deletes). Returns { menu, updated, added, skipped }.
 */
export function applyCSVToMenu(current, csvText) {
  const { headers, rows } = parseCSV(csvText);
  const col = (name) => headers.findIndex((h) => h.toLowerCase() === name);
  const cItem = col('item_id');
  const cNameEn = col('name_en');
  const cNameAr = col('name_ar');
  const cVar = col('variant_id');
  const cPrice = col('price');
  const cAvail = col('available');
  const cCat = col('category');
  const cUnit = col('unit');
  if (cItem < 0) throw new Error('bad_csv');
  const menu = JSON.parse(JSON.stringify(current || {}));
  if (!Array.isArray(menu.items)) menu.items = [];
  if (!Array.isArray(menu.categories)) menu.categories = [];
  const byId = new Map(menu.items.map((it) => [it && it.id, it]));
  const catByName = new Map();
  for (const c of menu.categories) {
    if (!c) continue;
    if (c.name && c.name.en) catByName.set(c.name.en.trim().toLowerCase(), c.id);
    if (c.name && c.name.ar) catByName.set(c.name.ar.trim().toLowerCase(), c.id);
  }
  const parseAvail = (v) => {
    const s = String(v ?? '').trim().toLowerCase();
    if (['true', '1', 'yes'].includes(s)) return true;
    if (['false', '0', 'no'].includes(s)) return false;
    return null;
  };
  let updated = 0;
  let added = 0;
  let skipped = 0;
  const fileCats = new Set();
  let fileRows = 0;
  for (const r of rows) {
    const id = (r[cItem] || '').trim();
    if (!id) {
      skipped += 1;
      continue;
    }
    fileRows += 1;
    const catCell = cCat >= 0 ? (r[cCat] || '').trim() : '';
    if (catCell) fileCats.add(catCell.toLowerCase());
    const priceRaw = cPrice >= 0 ? (r[cPrice] || '').trim() : '';
    const price = priceRaw === '' ? null : Number(priceRaw);
    if (priceRaw !== '' && (!Number.isFinite(price) || price < 0 || price > 100000000)) {
      skipped += 1;
      continue;
    }
    const avail = cAvail >= 0 ? parseAvail(r[cAvail]) : null;
    const ne = cNameEn >= 0 ? (r[cNameEn] || '').trim() : '';
    const na = cNameAr >= 0 ? (r[cNameAr] || '').trim() : '';
    const varId = cVar >= 0 ? (r[cVar] || '').trim() : '';
    const existing = byId.get(id);
    if (existing) {
      if (ne) existing.name.en = ne.slice(0, 120);
      if (na) existing.name.ar = na.slice(0, 120);
      if (varId) {
        const vs = Array.isArray(existing.variants) ? existing.variants : [];
        const v = vs.find((x) => x && x.featureId === varId);
        if (v && price !== null) {
          v.price = price;
          updated += 1;
        } else {
          skipped += 1;
        }
      } else if (price !== null) {
        if (!existing.pricing || typeof existing.pricing !== 'object') existing.pricing = {};
        existing.pricing.price = price;
        updated += 1;
      }
      if (avail !== null) {
        existing.available = avail;
        updated += 1;
      }
      continue;
    }
    // New item: only when its category exists (matched by name).
    const catNameRaw = cCat >= 0 ? (r[cCat] || '').trim().toLowerCase() : '';
    const catId = catNameRaw ? catByName.get(catNameRaw) : null;
    if (!catId) {
      skipped += 1;
      continue;
    }
    if (varId) {
      skipped += 1;
      continue;
    }
    const unitRaw = cUnit >= 0 ? (r[cUnit] || '').trim() : '';
    const unit = ['pc', 'dozen', 'kg', 'g', 'box', 'pack'].includes(unitRaw) ? unitRaw : 'pc';
    const item = {
      id,
      categoryId: catId,
      name: { en: ne.slice(0, 120) || na.slice(0, 120) || id, ar: na.slice(0, 120) || ne.slice(0, 120) || id },
      description: { en: '', ar: '' },
      pricing: { unit, minQty: 1, step: 1, maxQty: 50, showUnit: false, price: price !== null ? price : 0 },
      addons: [],
      badges: [],
      featured: false,
      available: avail !== null ? avail : true,
    };
    menu.items.push(item);
    byId.set(id, item);
    added += 1;
  }
  return { menu, updated, added, skipped, fileRows, fileCategories: fileCats.size };
}
