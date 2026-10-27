import { useState, useEffect, useMemo } from 'react';
import { MenuData, MenuItem, CartLine, ResolvedCartLine } from '@/src/types/menu';
import {
  cartLineKey, clampQty, isValidQty, lineTotal,
  perUnitPrice, hasOptions, normalizePricing,
} from '@/src/utils/pricing';
import { isRecord, parseJson } from '@/src/utils/safeJson';

/** Resolve one persisted line against the live menu (null when broken). */
function resolveLine(menu: MenuData, key: string, line: CartLine): ResolvedCartLine | null {
  const item = menu.items.find((i) => i.id === line.id);
  if (!item || !item.available) return null;
  try {
    const addonIds = Array.isArray(line.addonIds) ? line.addonIds : [];
    const unit = perUnitPrice(item, { variantId: line.variantId, addonIds });
    const total = lineTotal(item, { variantId: line.variantId, addonIds, qty: line.quantity });
    return { key, item, variantId: line.variantId, addonIds, quantity: line.quantity, unit, total };
  } catch {
    return null;
  }
}

/** Load the persisted cart, migrating the legacy id->qty shape. */
function loadCart(): Record<string, CartLine> {
  try {
    const saved = localStorage.getItem('cart_v1');
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
          out[cartLineKey(line.id, line.variantId, line.addonIds)] = line;
        }
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function useShopCartState(menu: MenuData | null, setActiveItem: (item: MenuItem | null) => void) {
  // Cart lines keyed by id + variantId + sorted addonIds (legacy id->qty
  // carts migrate on load).
  const [cart, setCart] = useState<Record<string, CartLine>>(loadCart);

  // Sync Cart to LocalStorage and clean unavailable items
  useEffect(() => {
    try {
      localStorage.setItem('cart_v1', JSON.stringify(cart));
    } catch {}
  }, [cart]);

  // Clean lines that no longer resolve (item removed/unavailable, variant or
  // add-on gone) and snap quantities back onto the item's min/step/max grid.
  // Pure helper: returns the SAME ref when nothing changes, so the guarded
  // setCart below converges after at most one extra render (and usually zero).
  const cleanCartLines = (prev: Record<string, CartLine>): Record<string, CartLine> => {
    if (!menu) return prev;
    const entries = Object.entries(prev);
    if (entries.length === 0) return prev;
    let changed = false;
    const out: Record<string, CartLine> = {};
    for (const [, line] of entries) {
      const item = menu.items.find((i) => i.id === line.id);
      if (!item || !item.available) {
        changed = true;
        continue;
      }
      try {
        perUnitPrice(item, { variantId: line.variantId, addonIds: line.addonIds });
      } catch {
        changed = true;
        continue;
      }
      if (!isValidQty(item, line.quantity)) {
        const fixed = clampQty(item, line.quantity);
        if (fixed !== line.quantity) {
          changed = true;
          out[cartLineKey(line.id, line.variantId, line.addonIds)] = { ...line, quantity: fixed };
          continue;
        }
      }
      out[cartLineKey(line.id, line.variantId, line.addonIds)] = line;
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
  };

  const snapDown = (item: MenuItem, qty: number) => {
    const p = normalizePricing(item);
    const capped = Math.min(qty, p.maxQty);
    return p.minQty + Math.floor((capped - p.minQty) / p.step) * p.step;
  };

  const handleAddConfigured = (item: MenuItem, variantId: string | undefined, addonIds: string[], qty: number) => {
    if (!item.available) return;
    const key = cartLineKey(item.id, variantId, addonIds);
    setCart((prev) => {
      const ex = prev[key];
      const quantity = ex ? snapDown(item, ex.quantity + qty) : qty;
      const line: CartLine = { id: item.id, quantity };
      if (variantId) line.variantId = variantId;
      if (addonIds.length) line.addonIds = [...addonIds];
      return { ...prev, [key]: line };
    });
  };

  const handleUpdateLine = (key: string, dir: 1 | -1) => {
    setCart((prev) => {
      const line = prev[key];
      if (!line) return prev;
      const item = menu?.items.find((i) => i.id === line.id);
      if (!item) {
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
      return { ...prev, [key]: { ...line, quantity: next } };
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
    handleUpdateLine,
    handleRemoveLine,
    handleClearCart,
  };
}
