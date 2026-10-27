/**
 * Print-HTML builder (A4, brand header, no admin controls).
 * Split from versions.js — no dependencies, works in Cloudflare Workers and Node.
 * Re-exported from ./versions.js so existing importers keep working.
 */

const escHtml = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmtPrice = (n) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '';

/**
 * Print-optimized menu page (A4, brand header, no admin controls).
 * Every dynamic string is escaped. Only visible categories and available
 * items are listed; variant lines show their own prices.
 */
export function buildPrintHTML(menu, lang = 'ar') {
  const l = lang === 'ar' ? 'ar' : 'en';
  const m = menu || {};
  const s = (m.settings && typeof m.settings === 'object' ? m.settings : {});
  const name = (s.name && (s.name[l] || s.name.en)) || 'Menu';
  const tagline = (s.tagline && (s.tagline[l] || s.tagline.en)) || '';
  const phone = s.phone || '';
  const cur = (s.currency && (s.currency[l] || s.currency.en)) || '';
  const freeWord = l === 'ar' ? 'مجاناً' : 'FREE';
  const money = (n) => (n === 0 ? freeWord : escHtml(fmtPrice(n)));
  const cats = (Array.isArray(m.categories) ? m.categories : []).filter((c) => c && c.visible !== false);
  const items = Array.isArray(m.items) ? m.items : [];
  const sections = cats
    .map((c) => {
      const list = items.filter((it) => it && it.categoryId === c.id && it.available !== false);
      if (list.length === 0) return '';
      const rows = list
        .map((it) => {
          const nm = (it.name && (it.name[l] || it.name.en)) || '';
          const vs = Array.isArray(it.variants) ? it.variants : [];
          let priceLine;
          if (vs.length === 0) {
            const p = it.pricing && typeof it.pricing.price === 'number' ? it.pricing.price : null;
            priceLine = `<span class="price">${money(p)} ${escHtml(cur)}</span>`;
          } else {
            const vrows = vs
              .map((v) => {
                let vn = '';
                try {
                  const defs = (m.settings && m.settings.featureDefs) || [];
                  const d = defs.find((x) => x && x.id === v.featureId);
                  vn = (d && d.name && (d.name[l] || d.name.en)) || '';
                } catch {}
                return `<div class="variant"><span>${escHtml(vn)}</span><span class="price">${money(typeof v.price === 'number' ? v.price : null)} ${escHtml(cur)}</span></div>`;
              })
              .join('');
            priceLine = `<div class="variants">${vrows}</div>`;
          }
          return `<div class="item"><span class="iname">${escHtml(nm)}</span>${priceLine}</div>`;
        })
        .join('');
      return `<section class="cat"><h2>${escHtml((c.name && (c.name[l] || c.name.en)) || '')}</h2>${rows}</section>`;
    })
    .join('');
  return `<!doctype html>
<html lang="${l}" dir="${l === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<title>${escHtml(name)}</title>
<style>
@page { size: A4; margin: 14mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Tahoma, 'Segoe UI', Arial, sans-serif; color: #111; }
header.brand { text-align: center; border-bottom: 3px solid #111; padding-bottom: 10px; margin-bottom: 14px; }
header.brand h1 { margin: 0; font-size: 28px; }
header.brand p { margin: 4px 0 0; font-size: 13px; color: #444; }
.cat { margin-bottom: 14px; break-inside: avoid; }
.cat h2 { margin: 0 0 6px; font-size: 18px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
.item { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 4px 0; font-size: 14px; }
.iname { font-weight: bold; }
.price { white-space: nowrap; font-weight: bold; }
.variants { display: flex; flex-direction: column; gap: 2px; }
.variant { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; color: #333; }
@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
<header class="brand"><h1>${escHtml(name)}</h1>${tagline ? `<p>${escHtml(tagline)}</p>` : ''}${phone ? `<p>${escHtml(phone)}</p>` : ''}</header>
${sections}
</body></html>`;
}
