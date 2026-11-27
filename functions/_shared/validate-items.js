/**
 * Item validation for restaurant menu documents (pricing, variants, add-ons, legacy migration).
 * Single consumer: the validate.js orchestrator (via validate-catalog re-export).
 */
import { validateBilingual, validateBilingualOpt, ID_REGEX, stripControls } from './validate-core.js';

/**
 * Validates the items array (pricing, variants, add-ons, legacy migration).
 * Needs the validated category ids, the collected legacy groups, and the
 * feature library lookup/mutator. Returns the cleaned items. Appends to
 * `errors` in document order.
 */
function validateItems(items, errors, categoryIds, legacyGroups, featureById, ensureFeature, groupById) {
  if (items.length > 500) {
    errors.push('Maximum 500 items allowed');
  }
  const itemIds = new Set();
  const cleanItems = [];
  const allowedBadges = ['new', 'spicy', 'top'];
  // Flexible custom features (hand/AI-authored imports): an unknown
  // featureId is accepted when it carries a usable bilingual name —
  // aliased onto an existing feature when the name matches one, else
  // created (explicit groupId, or the kind default). Nameless invented ids
  // get one last chance via affix matching (see below); anything left
  // fails with an actionable message. Returns the final featureId, or
  // null (error already pushed).
  const usableName = (name) =>
    name && typeof name === 'object' && (
      (typeof name.en === 'string' && name.en.trim()) || (typeof name.ar === 'string' && name.ar.trim())
    );
  const aliasByName = (name) => {
    const en = typeof name?.en === 'string' ? name.en.trim().toLowerCase() : '';
    const ar = typeof name?.ar === 'string' ? name.ar.trim() : '';
    if (!en && !ar) return null;
    for (const def of featureById.values()) {
      const den = typeof def.name?.en === 'string' ? def.name.en.trim().toLowerCase() : '';
      const dar = typeof def.name?.ar === 'string' ? def.name.ar.trim() : '';
      if ((en && den && en === den) || (ar && dar && ar === dar)) return def.id;
    }
    return null;
  };
  const resolveCustomFeature = (vid, name, groupId, kind, itemId, field) => {
    if (featureById.has(vid)) return vid;
    if (!usableName(name)) {
      // Last resort for nameless invented ids (the classic AI pattern
      // "drink-regular"): reuse when the FIRST or LAST dash-token exactly
      // equals an existing feature ("pepsi-diet" → "diet"). Middle tokens
      // never match ("super-regular-plus" stays rejected), and two
      // different matches mean ambiguous → rejected. Every alias surfaces
      // in the import preview, so nothing remaps silently.
      const toks = vid.toLowerCase().split(/[-_]+/).filter(Boolean);
      if (toks.length >= 2) {
        const ends = new Set([toks[0], toks[toks.length - 1]]);
        let found = null;
        for (const t of ends) {
          if (featureById.has(t)) {
            if (found && found !== t) { found = null; break; }
            found = t;
          }
        }
        if (found) return found;
      }
      errors.push(
        `Item "${itemId}" ${field} "${vid}" is not a known feature (add name:{en,ar} to auto-create it, or define it in Features Library first)`
      );
      return null;
    }
    const aliased = aliasByName(name);
    if (aliased) return aliased;
    const gid = typeof groupId === 'string' ? groupId.trim() : '';
    if (gid) {
      if (!groupById || !groupById.has(gid)) {
        errors.push(`Item "${itemId}" ${field} "${vid}" group "${gid}" does not exist`);
        return null;
      }
      ensureFeature(vid, kind, name, gid);
      return vid;
    }
    ensureFeature(vid, kind, name);
    return vid;
  };
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!ID_REGEX.test(id)) {
      errors.push(`Invalid item ID: "${id}"`);
      continue;
    }
    if (itemIds.has(id)) {
      errors.push(`Duplicate item ID: "${id}"`);
      continue;
    }
    itemIds.add(id);
    const categoryId = typeof item.categoryId === 'string' ? item.categoryId.trim() : '';
    if (!categoryIds.has(categoryId)) {
      errors.push(`Item "${id}" has non-existent categoryId "${categoryId}"`);
    }
    // Pricing block (new model). A legacy numeric `price` converts to
    // pricing { unit:'portion', price, ...defaults }.
    const validUnits = ['pc', 'portion', 'dozen', 'box', 'bottle', 'glass', 'kg'];
    const hasPricing = item.pricing && typeof item.pricing === 'object';
    const praw = hasPricing ? item.pricing : {};
    const legacyPrice = typeof item.price === 'number' && Number.isFinite(item.price) ? Math.max(0, Math.round((item.price + Number.EPSILON) * 100) / 100) : null;
    // Known units pass; a short custom label (max 24 chars) too — controls
    // stripped like every other free-text field.
    // Items with no pricing block at all keep the legacy 'portion' default.
    const rawUnit = typeof praw.unit === 'string' ? stripControls(praw.unit).trim() : '';
    const unit = validUnits.includes(rawUnit)
      ? rawUnit
      : (!hasPricing ? 'portion' : (rawUnit && rawUnit.length <= 24 ? rawUnit : null));
    if (unit === null) {
      errors.push(`Item "${id}" pricing.unit must be one of ${validUnits.join(', ')} or a custom label (max 24 chars)`);
      continue;
    }
    let basePrice;
    if (praw.price !== undefined) {
      if (typeof praw.price !== 'number' || !Number.isFinite(praw.price) || praw.price < 0 || praw.price > 100000000) {
        errors.push(`Item "${id}" pricing.price must be a number >= 0 (decimals allowed)`);
        continue;
      }
      basePrice = Math.round((praw.price + Number.EPSILON) * 100) / 100;
    } else if (legacyPrice !== null) {
      basePrice = legacyPrice;
    }
    const minQty = praw.minQty === undefined ? 1 : praw.minQty;
    const step = praw.step === undefined ? 1 : praw.step;
    const maxQty = praw.maxQty === undefined ? 50 : praw.maxQty;
    if (!Number.isInteger(minQty) || minQty < 1) {
      errors.push(`Item "${id}" pricing.minQty must be an integer >= 1`);
      continue;
    }
    if (!Number.isInteger(step) || step < 1) {
      errors.push(`Item "${id}" pricing.step must be an integer >= 1`);
      continue;
    }
    if (!Number.isInteger(maxQty) || maxQty < minQty) {
      errors.push(`Item "${id}" pricing.maxQty must be an integer >= minQty`);
      continue;
    }
    // Sizes (optional; names come from the feature library, prices live here).
    // Legacy inline {id, name, price} variants migrate into the library.
    let variants;
    // Raw→final id map for this item (custom ids resolve/alias during the
    // loop below; defaultVariant below reuses it). Per-item scope: declared
    // here so it exists even when variants are absent.
    const vAlias = new Map();
    if (item.variants !== undefined) {
      if (!Array.isArray(item.variants) || item.variants.length === 0) {
        errors.push(`Item "${id}" must have at least one variant when "variants" is present`);
        continue;
      }
      if (item.variants.length > 20) {
        errors.push(`Item "${id}" allows at most 20 variants`);
        continue;
      }
      const seenV = new Set();
      variants = [];
      let vOk = true;
      for (const v of item.variants) {
        if (!v || typeof v !== 'object') { vOk = false; break; }
        // New shape {featureId, price} or legacy {id, name?, price}.
        // Unknown featureIds carrying names auto-create/alias (flexible
        // hand/AI-authored imports); duplicates are judged on final ids.
        const rawId = typeof v.featureId === 'string' && v.featureId ? v.featureId : (typeof v.id === 'string' ? v.id : '');
        let vid = rawId.trim();
        if (!ID_REGEX.test(vid)) {
          errors.push(`Item "${id}" has an invalid or duplicate variant: "${vid}"`);
          vOk = false;
          break;
        }
        if (v.featureId) {
          if (!featureById.has(vid)) {
            const gid = typeof v.groupId === 'string' ? v.groupId : undefined;
            const resolved = resolveCustomFeature(vid, v.name, gid, 'size', id, 'variant');
            if (!resolved) { vOk = false; break; }
            vAlias.set(vid, resolved);
            vid = resolved;
          }
        } else {
          // Legacy inline name migrates into the library (first wins)
          ensureFeature(vid, 'size', v.name);
        }
        if (seenV.has(vid)) {
          errors.push(`Item "${id}" has an invalid or duplicate variant: "${vid}"`);
          vOk = false;
          break;
        }
        seenV.add(vid);
        if (typeof v.price !== 'number' || !Number.isFinite(v.price) || v.price < 0 || v.price > 100000000) {
          errors.push(`Item "${id}" variant "${vid}" price must be a number >= 0 (decimals allowed, 0 = free)`);
          vOk = false;
          break;
        }
        variants.push({ featureId: vid, price: Math.round((v.price + Number.EPSILON) * 100) / 100 });
      }
      if (!vOk) continue;
    }
    // Add-ons enabled on this item (prices here, 0 = free)
    let addons;
    if (item.addons !== undefined) {
      if (!Array.isArray(item.addons)) {
        errors.push(`Item "${id}" addons must be an array`);
        continue;
      }
      if (item.addons.length > 20) {
        errors.push(`Item "${id}" allows at most 20 add-ons`);
        continue;
      }
      const seenA = new Set();
      addons = [];
      let aOk = true;
      for (const a of item.addons) {
        if (!a || typeof a !== 'object') { aOk = false; break; }
        let aid = typeof a.featureId === 'string' ? a.featureId.trim() : '';
        if (!ID_REGEX.test(aid)) {
          errors.push(`Item "${id}" has an invalid or duplicate add-on: "${aid}"`);
          aOk = false;
          break;
        }
        // Heat opt-out: stored heat rows are dropped (the section X removed
        // them) — normalize would strip them at read time anyway, so the
        // saved doc stays clean and re-imports can't resurrect them.
        if (item.noHeat === true && (aid === 'spicy' || aid === 'spicy-mild' || aid === 'spicy-medium' || aid === 'spicy-hot')) {
          continue;
        }
        // Unknown ids with names auto-create/alias like variants (flexible
        // imports); accepted shape gains optional name/groupId.
        if (!featureById.has(aid)) {
          const gid = typeof a.groupId === 'string' ? a.groupId : undefined;
          const resolved = resolveCustomFeature(aid, a.name, gid, 'addon', id, 'add-on');
          if (!resolved) { aOk = false; break; }
          aid = resolved;
        }
        if (seenA.has(aid)) {
          errors.push(`Item "${id}" has an invalid or duplicate add-on: "${aid}"`);
          aOk = false;
          break;
        }
        seenA.add(aid);
        if (typeof a.price !== 'number' || !Number.isFinite(a.price) || a.price < 0 || a.price > 100000000) {
          errors.push(`Item "${id}" add-on "${aid}" price must be a number >= 0 (decimals allowed)`);
          aOk = false;
          break;
        }
        const cleanAddon = { featureId: aid, price: Math.round((a.price + Number.EPSILON) * 100) / 100 };
        if (a.default === true) cleanAddon.default = true;
        addons.push(cleanAddon);
      }
      if (!aOk) continue;
    }
    // Required add-on groups ("must pick at least one", set per group in
    // the item editor). Shape-checked only here: group ids, deduped. The
    // order-time validatePicks enforces them and skips groups with no
    // enabled option, so a stale id can never brick ordering.
    let requiredGroups;
    if (item.requiredGroups !== undefined) {
      if (!Array.isArray(item.requiredGroups)) {
        errors.push(`Item "${id}" requiredGroups must be an array`);
        continue;
      }
      if (item.requiredGroups.length > 10) {
        errors.push(`Item "${id}" allows at most 10 required groups`);
        continue;
      }
      const seenR = new Set();
      requiredGroups = [];
      let rOk = true;
      for (const gid of item.requiredGroups) {
        const clean = typeof gid === 'string' ? gid.trim() : '';
        if (!clean || clean.length > 64 || seenR.has(clean)) {
          errors.push(`Item "${id}" has an invalid required group: "${gid}"`);
          rOk = false;
          break;
        }
        seenR.add(clean);
        requiredGroups.push(clean);
      }
      if (!rOk) continue;
    }
    // Every item needs a price path: variants or a base price.
    if (!variants && basePrice === undefined) {
      errors.push(`Item "${id}" needs pricing.price or at least one variant`);
      continue;
    }
    const badges = Array.isArray(item.badges)
      ? item.badges.filter((b) => allowedBadges.includes(b))
      : [];
    // Heat opt-out (drinks, desserts): incompatible with the Spicy badge,
    // whose heat degree is mandatory — fail closed instead of saving a
    // contradictory item the customer could never order.
    if (item.noHeat === true && badges.includes('spicy')) {
      errors.push(`Item "${id}" cannot combine the Spicy badge with no-heat (heat is required for badged items)`);
      continue;
    }
    const pricing = { unit, minQty, step, maxQty, showUnit: praw.showUnit === true };
    // With variants the variant price rules; a base price is dropped to
    // avoid two competing sources of truth.
    if (!variants && basePrice !== undefined) pricing.price = basePrice;
    // Optional photo for the "photos" display layout. Remote http(s) or
    // root-relative paths only — never inline data: URLs, because the whole
    // menu document is capped at 256 KB.
    let imageUrl;
    if (item.imageUrl !== undefined && item.imageUrl !== null && item.imageUrl !== '') {
      if (typeof item.imageUrl !== 'string') {
        errors.push(`Item "${id}" imageUrl must be a string URL`);
      } else {
        const rawImageUrl = stripControls(item.imageUrl).trim();
        if (rawImageUrl.length > 500) {
          errors.push(`Item "${id}" imageUrl must be at most 500 characters`);
        } else if (!/^(https?:\/\/|\/)/i.test(rawImageUrl)) {
          errors.push(`Item "${id}" imageUrl must start with https://, http:// or /`);
        } else {
          imageUrl = rawImageUrl;
        }
      }
    }
    // Optional responsive variants { s, m } (s≈400w, m≈800w; imageUrl stays
    // the largest ≈1280w). Same URL rules as imageUrl. Invalid/empty values
    // are dropped silently (never fail the item): clean then continue.
    let imageVariants;
    if (item.imageVariants !== undefined && item.imageVariants !== null) {
      if (item.imageVariants && typeof item.imageVariants === 'object' && !Array.isArray(item.imageVariants)) {
        const cleanedVariants = {};
        for (const vk of ['s', 'm']) {
          const vv = item.imageVariants[vk];
          if (vv === undefined || vv === null || vv === '') continue;
          if (typeof vv !== 'string') continue;
          const rawVariant = stripControls(vv).trim();
          if (!rawVariant) continue;
          if (rawVariant.length > 500) continue;
          if (!/^(https?:\/\/|\/)/i.test(rawVariant)) continue;
          cleanedVariants[vk] = rawVariant;
        }
        if (Object.keys(cleanedVariants).length) imageVariants = cleanedVariants;
      }
      // Non-object imageVariants is dropped silently (no item rejection).
    }
    // Optional carousel-only description (never touches the item's own copy).
    // Empty/garbage values are dropped so the storefront falls back cleanly.
    const carouselDescription = validateBilingualOpt(item.carouselDescription, 300);
    const hasCarouselDescription = Boolean(
      carouselDescription.en.trim() || carouselDescription.ar.trim()
    );
    // Optional carousel-only framing (non-destructive; the item photo stays
    // untouched everywhere else). Garbage/default values are dropped.
    let carouselImage;
    if (item.carouselImage !== undefined && item.carouselImage !== null) {
      const ci = item.carouselImage;
      if (ci && typeof ci === 'object' && !Array.isArray(ci)) {
        const num = (v, min, max, fallback) =>
          typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
        const scale = Math.round(num(ci.scale, 0.8, 2.5, 1) * 100) / 100;
        const cx = Math.round(num(ci.x, -50, 50, 0) * 10) / 10;
        const cy = Math.round(num(ci.y, -50, 50, 0) * 10) / 10;
        const rotate = Math.round(num(ci.rotate, -180, 180, 0));
        const flipX = ci.flipX === true;
        const flipY = ci.flipY === true;
        if (scale !== 1 || cx !== 0 || cy !== 0 || rotate !== 0 || flipX || flipY) {
          carouselImage = { scale, x: cx, y: cy, rotate };
          if (flipX) carouselImage.flipX = true;
          if (flipY) carouselImage.flipY = true;
        }
      }
    }
    const cleanItem = {
      id,
      categoryId,
      name: validateBilingual(errors, item.name, `item[${id}].name`, 80),
      description: validateBilingual(errors, item.description, `item[${id}].description`, 300),
      pricing,
      badges,
      featured: Boolean(item.featured),
      available: item.available !== false,
    };
    if (imageUrl) cleanItem.imageUrl = imageUrl;
    if (imageVariants) cleanItem.imageVariants = imageVariants;
    if (hasCarouselDescription) cleanItem.carouselDescription = carouselDescription;
    if (carouselImage) cleanItem.carouselImage = carouselImage;
    if (item.noHeat === true) cleanItem.noHeat = true;
    if (variants) cleanItem.variants = variants;
    // Explicit default (★ marks in place, order untouched): must point at a size.
    // Raw ids pass through the same alias map as the variants above, so a
    // file that invents "drink-regular" with defaultVariant "drink-regular"
    // still resolves when the name matches the library.
    if (item.defaultVariant !== undefined) {
      const dvdRaw = typeof item.defaultVariant === 'string' ? item.defaultVariant.trim() : '';
      const dvd = vAlias.get(dvdRaw) || dvdRaw;
      if (!dvd || !variants || !variants.some((v) => v.featureId === dvd)) {
        errors.push(`Item "${id}" defaultVariant must match one of its variants`);
        continue;
      }
      cleanItem.defaultVariant = dvd;
    }
    if (addons && addons.length) cleanItem.addons = addons;
    if (requiredGroups && requiredGroups.length) cleanItem.requiredGroups = requiredGroups;
    // Legacy groups expand: every item of a listed category offers the
    // add-on at the group price (explicit per-item entries win).
    for (const g of legacyGroups) {
      if (!g.categoryIds.includes(categoryId)) continue;
      cleanItem.addons = cleanItem.addons || [];
      if (!cleanItem.addons.some((a) => a.featureId === g.id)) {
        cleanItem.addons.push({ featureId: g.id, price: g.price });
      }
    }
    if (cleanItem.addons && cleanItem.addons.length === 0) delete cleanItem.addons;
    // addedAt drives the automatic NEW badge (missing/invalid clears it)
    if (typeof item.addedAt === 'string' && item.addedAt) {
      const t = Date.parse(item.addedAt);
      if (!Number.isFinite(t)) {
        errors.push(`Item "${id}" addedAt must be a valid date or empty`);
        continue;
      }
      cleanItem.addedAt = new Date(t).toISOString();
    }
    cleanItems.push(cleanItem);
  }
  return cleanItems;
}

export { validateItems };
