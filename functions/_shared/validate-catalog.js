/**
 * Catalog validation (categories, legacy addon groups, items).
 * Single consumer: the validate.js orchestrator.
 */
import { validateBilingual, ID_REGEX } from './validate-core.js';

/**
 * Validates the categories array. Returns the cleaned list plus the id set
 * the items phase uses for existence checks. Appends to `errors`.
 */
function validateCategories(categories, errors) {
  if (categories.length > 30) {
    errors.push('Maximum 30 categories allowed');
  }
  const categoryIds = new Set();
  const cleanCategories = [];
  for (const cat of categories) {
    if (!cat || typeof cat !== 'object') continue;
    const id = typeof cat.id === 'string' ? cat.id.trim() : '';
    if (!ID_REGEX.test(id)) {
      errors.push(`Invalid category ID: "${id}" (must match ${ID_REGEX})`);
      continue;
    }
    if (categoryIds.has(id)) {
      errors.push(`Duplicate category ID: "${id}"`);
      continue;
    }
    categoryIds.add(id);
    // Display layout: cards grid, text-first list, compact rows or
    // photo-first cards.
    // Historical menus rendered the 'manakish' section as a list, so it
    // keeps that default.
    const layout = cat.layout === 'list' || cat.layout === 'compact' || cat.layout === 'cards' || cat.layout === 'photos'
      ? cat.layout
      : (id === 'manakish' ? 'list' : 'cards');
    // Card watermark (opt-in): 'brand' pan mark, an explicit glyph key
    // (see src/utils/cardMark.ts CARD_MARKS — keep the two lists in
    // sync), 'custom' (small PNG in iconUrl), or 'none'. Undefined =
    // no watermark (clean default, same as the original cards).
    // Unknown values are dropped.
    const CARD_ICONS = ['brand', 'pizza', 'sandwich', 'drumstick', 'beef', 'fish', 'soup', 'salad', 'cup', 'coffee', 'martini', 'beer', 'wine', 'milk', 'croissant', 'cake', 'donut', 'cookie', 'icecream', 'candy', 'lollipop', 'apple', 'citrus', 'grape', 'banana', 'carrot', 'leaf', 'wheat', 'egg', 'popcorn', 'utensils', 'chef', 'flame', 'sparkles', 'star', 'waves', 'droplets', 'flower', 'shell', 'feather', 'rainbow', 'cloud', 'snowflake', 'spline', 'crown', 'gem', 'music', 'heart', 'sun', 'moon', 'clover', 'custom', 'none'];
    const icon = CARD_ICONS.includes(cat.icon) ? cat.icon : undefined;
    // Custom PNG watermark: must be a small PNG data URL (admin resizes to
    // ≤256px first; the cap keeps the 256 KB menu payload safe).
    let iconUrl;
    if (cat.iconUrl !== undefined && cat.iconUrl !== '') {
      if (typeof cat.iconUrl !== 'string'
        || cat.iconUrl.length > 60000
        || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(cat.iconUrl)) {
        errors.push(`Category "${id}" icon image must be a small PNG data URL (≤ ~40 KB)`);
      } else {
        iconUrl = cat.iconUrl;
      }
    }
    // Watermark style: single corner mark, centered emblem, tiled
    // pattern, or full-bleed cover.
    const MARK_STYLES = ['corner', 'center', 'pattern', 'cover'];
    const iconStyle = MARK_STYLES.includes(cat.iconStyle) ? cat.iconStyle : undefined;
    // Watermark opacity percent (default 18) and anchor (per-style
    // defaults). Out-of-range values are dropped, never stored.
    const clampPct = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : undefined);
    const iconOpacity = clampPct(cat.iconOpacity, 5, 60);
    const iconScale = clampPct(cat.iconScale, 25, 200);
    const iconRotate = clampPct(cat.iconRotate, -180, 180);
    const iconX = clampPct(cat.iconX, 0, 100);
    const iconY = clampPct(cat.iconY, 0, 100);
    cleanCategories.push({
      id,
      name: validateBilingual(errors, cat.name, `category[${id}].name`, 80),
      visible: Boolean(cat.visible),
      layout,
      ...(icon ? { icon } : {}),
      ...(iconUrl ? { iconUrl } : {}),
      ...(iconStyle ? { iconStyle } : {}),
      ...(iconOpacity !== undefined ? { iconOpacity } : {}),
      ...(iconScale !== undefined ? { iconScale } : {}),
      ...(iconRotate !== undefined ? { iconRotate } : {}),
      ...(iconX !== undefined ? { iconX } : {}),
      ...(iconY !== undefined ? { iconY } : {}),
    });
  }
  return { cleanCategories, categoryIds };
}

/**
 * Collects legacy category-scoped add-on groups (migrated into the feature
 * library + per-item add-ons by the items phase). Needs the validated
 * category ids and the library's ensureFeature. Appends to `errors`.
 */
function validateLegacyGroups(addonGroups, errors, categoryIds, ensureFeature) {
  // Legacy category-scoped add-on groups migrate into the library +
  // per-item add-ons (collected here, expanded after items validate).
  // NOTE: the feature library itself is parsed earlier (before cleanSettings).
  const legacyGroups = [];
  if (addonGroups !== undefined) {
    if (!Array.isArray(addonGroups)) {
      errors.push('addonGroups must be an array');
    } else {
      if (addonGroups.length > 50) errors.push('Maximum 50 add-on groups allowed');
      const addonIds = new Set();
      for (const g of addonGroups) {
        if (!g || typeof g !== 'object') continue;
        const gid = typeof g.id === 'string' ? g.id.trim() : '';
        if (!ID_REGEX.test(gid)) {
          errors.push(`Invalid add-on group ID: "${gid}"`);
          continue;
        }
        if (addonIds.has(gid)) {
          errors.push(`Duplicate add-on group ID: "${gid}"`);
          continue;
        }
        addonIds.add(gid);
        if (!Number.isInteger(g.price) || g.price < 0 || g.price > 100000000) {
          errors.push(`Add-on "${gid}" price must be an integer >= 0`);
          continue;
        }
        const cats = Array.isArray(g.categoryIds) ? g.categoryIds : [];
        if (cats.length === 0) {
          errors.push(`Add-on "${gid}" must list at least one category`);
          continue;
        }
        let catsOk = true;
        for (const c of cats) {
          if (typeof c !== 'string' || !categoryIds.has(c)) {
            errors.push(`Add-on "${gid}" has non-existent categoryId "${c}"`);
            catsOk = false;
          }
        }
        if (!catsOk) continue;
        ensureFeature(gid, 'addon', g.name);
        legacyGroups.push({ id: gid, price: g.price, categoryIds: [...new Set(cats)] });
      }
    }
  }
  return legacyGroups;
}

export { validateCategories, validateLegacyGroups };
export { validateItems } from './validate-items.js';
