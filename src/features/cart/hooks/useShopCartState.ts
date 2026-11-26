import { useState, useEffect, useMemo } from 'react';
import { MenuData, MenuItem, CartLine, ResolvedCartLine } from '@/src/types/menu';
import {
  cartLineKey, clampQty, isValidQty, lineTotal,
  perUnitPrice, getVariant, hasOptions, normalizePricing, validatePicks,
} from '@/src/utils/pricing';
import { clampSplitPicks, effectiveAddonQty, resolveSplitCounts } from '@/src/utils/splitPicks';
import { isRecord, parseJson } from '@/src/utils/safeJson';
import { clientConfig } from '@/src/config/client.config';

const CART_KEY = 'cart_v1';
const CART_TS_KEY = 'cart_timestamp_v1';
const CART_EXPIRY_DAYS = clientConfig.cart?.expiryDays ?? 7;

interface CanonicalPicks {
  ids: string[];
  addonQty: Record<string, number> | undefined;
}

function buildLine(
  id: string,
  variantId: string | undefined,
  quantity: number,
  picks: CanonicalPicks,
): CartLine {
  const line: CartLine = { id, quantity };
  if (variantId) line.variantId = variantId;
  if (picks.ids.length) line.addonIds = [...picks.ids];
  if (picks.addonQty) line.addonQty = { ...picks.addonQty };
  return line;
}

/** Snap a quantity onto the item's min/step/max grid (downwards). */
function snapQtyDown(item: MenuItem, qty: number): number {
  const p = normalizePricing(item);
  const capped = Math.min(qty, p.maxQty);
  return p.minQty + Math.floor((capped - p.minQty) / p.step) * p.step;
}

/**
 * Place a canonical line into the map, merging into any same-key occupant:
 * quantities via snapQtyDown, split lines additionally SUM the resolved
 * per-option counts and clamp them to the merged qty.
 *
 * A split key carries `fid:count` pairs while a legacy key carries bare
 * `fid`s — the two shapes can NEVER collide textually, so merging only
 * ever joins like with like (split+split or legacy+legacy).
 */
function upsertLine(
  out: Record<string, CartLine>,
  menu: MenuData,
  item: MenuItem,
  line: CartLine,
): void {
  let cur = line;
  for (let i = 0; i < 10; i++) {
    const key = cartLineKey(cur.id, cur.variantId, cur.addonIds, cur.addonQty, cur.quantity);
    const ex = out[key];
    if (!ex) {
      out[key] = cur;
      return;
    }
    const quantity = snapQtyDown(item, ex.quantity + cur.quantity);
    if (!ex.addonQty && !cur.addonQty) {
      // Legacy: quantities only, shape untouched (byte-identical to today).
      cur = { ...ex, quantity };
      out[key] = cur;
      return;
    }
    delete out[key];
    const ids = [...(ex.addonIds ?? [])];
    for (const id of cur.addonIds ?? []) {
      if (!ids.includes(id)) ids.push(id);
    }
    const re = resolveSplitCounts(ids, ex.addonQty, ex.quantity);
    const rc = resolveSplitCounts(ids, cur.addonQty, cur.quantity);
    const summed: Record<string, number> = {};
    for (const id of ids) summed[id] = (re[id] ?? 0) + (rc[id] ?? 0);
    const clamped = clampSplitPicks(menu, item, ids, summed, quantity);
    cur = buildLine(cur.id, cur.variantId ?? ex.variantId, quantity, clamped);
  }
  // Unreachable in practice (every merge grows qty, capped by maxQty):
  // force-place rather than dropping the customer's line.
  out[cartLineKey(cur.id, cur.variantId, cur.addonIds, cur.addonQty, cur.quantity)] = cur;
}

/** Resolve one persisted line against the live menu (null when broken). */
function resolveLine(menu: MenuData, key: string, line: CartLine): ResolvedCartLine | null {
  const item = menu.items.find((i) => i.id === line.id);
  if (!item || !item.available) return null;
  try {
    const addonIds = Array.isArray(line.addonIds) ? line.addonIds : [];
    const rawQ: unknown = line.addonQty;
    const addonQty =
      typeof rawQ === 'object' && rawQ !== null && !Array.isArray(rawQ)
        ? (rawQ as Record<string, number>)
        : undefined;
    const unit = perUnitPrice(item, { variantId: line.variantId, addonIds, addonQty, qty: line.quantity });
    const total = lineTotal(item, { variantId: line.variantId, addonIds, addonQty, qty: line.quantity });
    return {
      key,
      item,
      variantId: line.variantId,
      addonIds,
      ...(addonQty ? { addonQty: { ...addonQty } } : {}),
      quantity: line.quantity,
      unit,
      total,
    };
  } catch {
    return null;
  }
}

/** Load the persisted cart, migrating the legacy id->qty shape. Entries older
 *  than the configured sliding expiry (client.config cart.expiryDays) are
 *  dropped so abandoned carts never linger forever. */
function loadCart(): Record<string, CartLine> {
  try {
    const ts = localStorage.getItem(CART_TS_KEY);
    if (ts) {
      const age = Date.now() - parseInt(ts, 10);
      if (Number.isFinite(age) && age > CART_EXPIRY_DAYS * 24 * 60 * 60 * 1000) {
        localStorage.removeItem(CART_KEY);
        localStorage.removeItem(CART_TS_KEY);
        return {};
      }
    }
    const saved = localStorage.getItem(CART_KEY);
    if (!saved) return {};
    const parsed: unknown = parseJson(saved);
    if (!isRecord(parsed)) return {};
    const out: Record<string, CartLine> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number') {
        if (Number.isInteger(v) && v > 0) out[cartLineKey(k)] = { id: k, quantity: v };
      } else if (isRecord(v)) {
        const { id, quantity, variantId, addonIds } = v;
        if (typeof id === 'string' && typeof quantity === 'number' && Number.isInteger(quantity) && quantity > 0) {
          const line: CartLine = { id, quantity };
          if (typeof variantId === 'string' && variantId) line.variantId = variantId;
          if (Array.isArray(addonIds) && addonIds.length) {
            line.addonIds = addonIds.filter((a): a is string => typeof a === 'string');
          }
          // Split counts ride along untouched (numbers only — shape/group
          // validation happens in cleanCartLines once the menu is loaded).
          if (isRecord(v.addonQty)) {
            const q: Record<string, number> = {};
            for (const [ck, val] of Object.entries(v.addonQty)) {
              if (typeof val === 'number') q[ck] = val;
            }
            if (Object.keys(q).length) line.addonQty = q;
          }
          out[cartLineKey(line.id, line.variantId, line.addonIds, line.addonQty, line.quantity)] = line;
        }
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function useShopCartState(
  menu: MenuData | null,
  setActiveItem: (item: MenuItem | null) => void,
  // Called after EVERY successful add (plain or configured with add-ons):
  // the caller opens the cart drawer so the customer sees what landed.
  onAdded?: () => void,
) {
  // Cart lines keyed by id + variantId + sorted addonIds (legacy) or sorted
  // fid:count pairs (split) — legacy id->qty carts migrate on load.
  const [cart, setCart] = useState<Record<string, CartLine>>(loadCart);

  // Sync Cart to LocalStorage and clean unavailable items. The timestamp
  // refresh on every write gives a sliding expiry (see loadCart).
  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
      localStorage.setItem(CART_TS_KEY, Date.now().toString());
    } catch {}
  }, [cart]);

  // Clean lines that no longer resolve (item removed/unavailable, variant or
  // add-on gone, split picks violating the group rules) and snap quantities
  // back onto the item's min/step/max grid.
  // Pure helper: returns the SAME ref when nothing changes, so the guarded
  // setCart below converges after at most one extra render (and usually zero).
  const cleanCartLines = (prev: Record<string, CartLine>): Record<string, CartLine> => {
    if (!menu) return prev;
    const entries = Object.entries(prev);
    if (entries.length === 0) return prev;
    let changed = false;
    const out: Record<string, CartLine> = {};
    for (const [oldKey, line] of entries) {
      const item = menu.items.find((i) => i.id === line.id);
      if (!item || !item.available) {
        changed = true;
        continue;
      }
      const ids = Array.isArray(line.addonIds)
        ? line.addonIds.filter((a): a is string => typeof a === 'string')
        : [];
      const hasQ = line.addonQty !== undefined && line.addonQty !== null;
      const rawQ = (hasQ ? (line.addonQty) : undefined);
      let qty = line.quantity;
      try {
        // Group-aware validation (unknown/disabled options, dupes, bad
        // counts, multi partials, single overflows) — broken picks drop the
        // same way broken variants do below.
        validatePicks(menu, item, ids, rawQ, qty);
        perUnitPrice(item, { variantId: line.variantId, addonIds: ids, addonQty: rawQ, qty });
      } catch {
        changed = true;
        continue;
      }
      if (!isValidQty(item, qty)) {
        const fixed = clampQty(item, qty);
        if (fixed !== qty) {
          changed = true;
          qty = fixed;
        }
      }
      // Snap split counts to the (possibly snapped) qty; trivial all-full
      // maps collapse back to the legacy shape here.
      const clamped = clampSplitPicks(menu, item, ids, rawQ, qty);
      try {
        validatePicks(menu, item, clamped.ids, clamped.addonQty, qty);
      } catch {
        changed = true;
        continue;
      }
      const canonical = buildLine(
        line.id,
        typeof line.variantId === 'string' && line.variantId ? line.variantId : undefined,
        qty,
        clamped,
      );
      const newKey = cartLineKey(
        canonical.id, canonical.variantId, canonical.addonIds, canonical.addonQty, canonical.quantity,
      );
      if (newKey !== oldKey) {
        changed = true;
      } else if (JSON.stringify(canonical) !== JSON.stringify(line)) {
        changed = true;
      } else if (out[newKey]) {
        // Byte-identical duplicate (same line persisted twice): folding it
        // in changes the merged quantity.
        changed = true;
      }
      upsertLine(out, menu, item, canonical);
    }
    return changed ? out : prev;
  };
  if (menu) {
    const cleaned = cleanCartLines(cart);
    if (cleaned !== cart) setCart(cleaned);
  }

  // Cart operations (quantity grid: minQty start, step increments,
  // dropping below minQty removes the line).
  const handleAddItem = (item: MenuItem) => {
    if (!item.available || !menu) return;
    if (hasOptions(item)) {
      setActiveItem(item);
      return;
    }
    const p = normalizePricing(item);
    const key = cartLineKey(item.id);
    setCart((prev) => {
      const ex = prev[key];
      const next = ex ? Math.min(ex.quantity + p.step, p.maxQty) : p.minQty;
      return { ...prev, [key]: { id: item.id, quantity: next } };
    });
    onAdded?.();
  };

  const handleAddConfigured = (item: MenuItem, variantId: string | undefined, addonIds: string[], qty: number, addonQty?: Record<string, number>) => {
    if (!item.available || !menu) return;
    const ids = Array.isArray(addonIds) ? addonIds.filter((a): a is string => typeof a === 'string') : [];
    // Canonicalize BEFORE keying: trivial all-full maps are legacy-shaped,
    // so an un-split config always lands on its legacy key (as today).
    // Always pass qty alongside counts — that is what keeps split keys
    // (`fid:count`) textually distinct from legacy keys (bare `fid`).
    const eff = effectiveAddonQty(ids, addonQty, qty);
    try {
      validatePicks(menu, item, ids, eff, qty);
      perUnitPrice(item, { variantId, addonIds: ids, addonQty: eff, qty });
    } catch {
      // Never add an invalid state (the sheet already blocks it).
      return;
    }
    const incoming = buildLine(item.id, variantId || undefined, qty, { ids, addonQty: eff });
    setCart((prev) => {
      const copy = { ...prev };
      upsertLine(copy, menu, item, incoming);
      return copy;
    });
    onAdded?.();
  };

  /**
   * Quick add for the featured carousel: place `qty` units of the default
   * configuration in ONE go, without opening the item sheet or the cart
   * drawer (the carousel shows its own "added" confirmation). Existing
   * add paths above stay untouched.
   *
   * Returns false when the choice cannot be resolved silently — an item
   * with REQUIRED pick groups (the customer must choose an option) or an
   * invalid menu state. The caller then opens the item sheet instead.
   */
  const handleQuickAdd = (item: MenuItem, qty: number): boolean => {
    if (!item.available || !menu) return false;
    if (Array.isArray(item.requiredGroups) && item.requiredGroups.length > 0) return false;
    const variant = getVariant(item)?.featureId;
    const quantity = clampQty(item, qty);
    try {
      validatePicks(menu, item, [], undefined, quantity);
      perUnitPrice(item, { variantId: variant, addonIds: [], qty: quantity });
    } catch {
      return false;
    }
    const incoming = buildLine(item.id, variant, quantity, { ids: [], addonQty: undefined });
    setCart((prev) => {
      const copy = { ...prev };
      upsertLine(copy, menu, item, incoming);
      return copy;
    });
    return true;
  };

  const handleUpdateLine = (key: string, dir: 1 | -1) => {
    setCart((prev) => {
      const line = prev[key];
      if (!line) return prev;
      const m = menu;
      const item = m?.items.find((i) => i.id === line.id);
      if (!item || !m) {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      }
      const p = normalizePricing(item);
      const next = line.quantity + dir * p.step;
      if (next < p.minQty) {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      }
      if (next > p.maxQty) return prev;
      if (!line.addonQty || !Object.keys(line.addonQty).length) {
        return { ...prev, [key]: { ...line, quantity: next } };
      }
      // Split line: clamp counts to the new qty (same decrement-largest
      // rule as the sheet), re-key, and merge on collision.
      const ids = Array.isArray(line.addonIds) ? line.addonIds.filter((a): a is string => typeof a === 'string') : [];
      const clamped = clampSplitPicks(m, item, ids, line.addonQty, next);
      try {
        validatePicks(m, item, clamped.ids, clamped.addonQty, next);
      } catch {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      }
      const cur = buildLine(line.id, line.variantId, next, clamped);
      const newKey = cartLineKey(cur.id, cur.variantId, cur.addonIds, cur.addonQty, cur.quantity);
      if (newKey === key) return { ...prev, [key]: cur };
      const copy = { ...prev };
      delete copy[key];
      upsertLine(copy, m, item, cur);
      return copy;
    });
  };

  const handleRemoveLine = (key: string) => {
    setCart((prev) => {
      if (!prev[key]) return prev;
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
  };

  // Remove ONE add-on from a line (re-keys the line; merges into the
  // matching line when that config already sits in the cart).
  const handleRemoveAddon = (key: string, featureId: string) => {
    setCart((prev) => {
      const line = prev[key];
      if (!line || !line.addonIds || !line.addonIds.includes(featureId)) return prev;
      const item = menu?.items.find((i) => i.id === line.id);
      let ids = line.addonIds.filter((a) => a !== featureId);
      let counts = line.addonQty ? { ...line.addonQty } : undefined;
      if (counts) {
        delete counts[featureId];
        if (item && menu) {
          // Shrink-only change: re-clamp (collapses to legacy when the
          // remaining picks are all-full) so the re-key stays canonical.
          const clamped = clampSplitPicks(menu, item, ids, counts, line.quantity);
          ids = clamped.ids;
          counts = clamped.addonQty ? { ...clamped.addonQty } : undefined;
        } else if (!Object.keys(counts).length) {
          counts = undefined;
        }
      }
      const nextKey = cartLineKey(line.id, line.variantId, ids.length ? ids : undefined, counts, line.quantity);
      if (nextKey === key) return prev;
      const copy = { ...prev };
      delete copy[key];
      const next = buildLine(line.id, line.variantId, line.quantity, { ids, addonQty: counts });
      if (item && menu) {
        upsertLine(copy, menu, item, next);
      } else {
        const ex = copy[nextKey];
        if (ex) {
          // Menu not loaded: keep today's simple quantity fold.
          next.quantity = ex.quantity + line.quantity;
        }
        copy[nextKey] = next;
      }
      return copy;
    });
  };

  const handleClearCart = () => {
    setCart({});
  };

  // Cart lines with real money, and totals
  const cartLines = useMemo(() => {
    if (!menu) return [];
    const out: ResolvedCartLine[] = [];
    for (const [key, line] of Object.entries(cart)) {
      const r = resolveLine(menu, key, line);
      if (r) out.push(r);
    }
    return out;
  }, [menu, cart]);

  const totalCartCount = useMemo(() => {
    return cartLines.reduce((sum, l) => sum + l.quantity, 0);
  }, [cartLines]);

  const totalCartPrice = useMemo(() => {
    return cartLines.reduce((sum, l) => sum + l.total, 0);
  }, [cartLines]);

  return {
    cart,
    cartLines,
    totalCartCount,
    totalCartPrice,
    handleAddItem,
    handleAddConfigured,
    handleQuickAdd,
    handleUpdateLine,
    handleRemoveLine,
    handleRemoveAddon,
    handleClearCart,
  };
}
