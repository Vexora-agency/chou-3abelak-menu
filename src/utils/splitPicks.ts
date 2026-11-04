/**
 * Smart split-quantity helpers for the CUSTOMER UI (item sheet + cart).
 *
 * Pure functions only — all money and rule math stays in the pricing engine
 * (src/utils/pricing.ts: lineTotal / perUnitPrice / cartLineKey /
 * validatePicks). This file mirrors two engine rules so the UI can group
 * and clamp without round-tripping:
 *  - grouping: an add-on belongs to its library group when the def's
 *    groupId names a real featureGroup, else it falls in the orphan bucket
 *    (same idea as the admin item editor);
 *  - selection: 'single' caps the group's summed counts at qty, 'multi'
 *    forces every pick to 0-or-qty; unknown groups and the sizes section
 *    behave as 'multi' (exactly like validatePicks, which forces 'multi'
 *    for the sizes group id and defaults unknown groups to 'multi').
 */
import type { FeatureGroup, ItemAddon, MenuData, MenuItem } from '@/src/types/menu';

export type AddonSelection = 'single' | 'multi';

export interface AddonBlock {
  /** Group id, or '' for the orphan bucket. Stable React key. */
  key: string;
  groupId: string | null;
  name: { en: string; ar: string };
  prompt?: { en: string; ar: string };
  selection: AddonSelection;
  /** The item's add-ons in this block, in item.addons order. */
  addons: ItemAddon[];
}

function allGroups(menu: MenuData): FeatureGroup[] {
  const g: unknown = menu && menu.settings ? menu.settings.featureGroups : undefined;
  return Array.isArray(g) ? (g as FeatureGroup[]) : [];
}

function allDefs(menu: MenuData): Array<{ id: string; groupId: string }> {
  const d: unknown = menu && menu.settings ? (menu.settings as unknown as { featureDefs?: unknown }).featureDefs : undefined;
  return Array.isArray(d) ? (d as Array<{ id: string; groupId: string }>) : [];
}

/** Library group id for a feature, or null when orphan (unknown def/group). */
export function groupIdOfFeature(menu: MenuData, featureId: string): string | null {
  const def = allDefs(menu).find((x) => x && x.id === featureId);
  if (!def || typeof def.groupId !== 'string' || !def.groupId) return null;
  return allGroups(menu).some((g) => g && g.id === def.groupId) ? def.groupId : null;
}

/** Add-on selection rule for a group — mirrors the pricing engine. */
export function addonGroupSelection(menu: MenuData, groupId: string | null): AddonSelection {
  if (!groupId || groupId === 'sizes') return 'multi';
  // The locked spicy section is exactly one choice (mild/medium/extra-hot).
  if (groupId === 'spicy') return 'single';
  const g = allGroups(menu).find((x) => x && x.id === groupId);
  return g && g.selection === 'single' ? 'single' : 'multi';
}

function groupName(g: FeatureGroup): { en: string; ar: string } {
  const nm = (g && (g).name) || undefined;
  const en = nm && typeof nm.en === 'string' && nm.en ? nm.en : g.id;
  const ar = nm && typeof nm.ar === 'string' && nm.ar ? nm.ar : g.id;
  return { en, ar };
}

function groupPrompt(g: FeatureGroup): { en: string; ar: string } | undefined {
  const p = (g && (g).prompt) || undefined;
  if (!p || typeof p !== 'object') return undefined;
  return {
    en: typeof p.en === 'string' ? p.en : '',
    ar: typeof p.ar === 'string' ? p.ar : '',
  };
}

/**
 * The item's add-ons grouped by their resolved library section, in
 * featureGroups order with the orphan bucket trailing. Groups that own no
 * option on this item produce no block.
 */
export function addonBlocks(menu: MenuData, item: MenuItem): AddonBlock[] {
  const groups = allGroups(menu);
  const list: ItemAddon[] = item && Array.isArray(item.addons) ? item.addons : [];
  const perGroup = new Map<string, ItemAddon[]>();
  const orphan: ItemAddon[] = [];
  for (const a of list) {
    if (!a || typeof a.featureId !== 'string') {
      if (a) orphan.push(a);
      continue;
    }
    const gid = groupIdOfFeature(menu, a.featureId);
    if (gid) {
      const arr = perGroup.get(gid);
      if (arr) arr.push(a);
      else perGroup.set(gid, [a]);
    } else {
      orphan.push(a);
    }
  }
  const out: AddonBlock[] = [];
  for (const g of groups) {
    if (!g || typeof g.id !== 'string') continue;
    const arr = perGroup.get(g.id);
    if (arr && arr.length) {
      out.push({
        key: g.id,
        groupId: g.id,
        name: groupName(g),
        ...(groupPrompt(g) ? { prompt: groupPrompt(g) } : {}),
        selection: addonGroupSelection(menu, g.id),
        addons: arr,
      });
    }
  }
  if (orphan.length) {
    out.push({ key: '', groupId: null, name: { en: 'Other', ar: 'أخرى' }, selection: 'multi', addons: orphan });
  }
  return out;
}

function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n);
}

function isRecordLike(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Complete count map for the selected ids: explicit entry, else the full
 * quantity (legacy "applies to all units" semantics). Never throws.
 */
export function resolveSplitCounts(
  addonIds: string[],
  addonQty: Record<string, number> | undefined,
  qty: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  const live = (Array.isArray(addonIds) ? addonIds : []).filter(
    (x): x is string => typeof x === 'string',
  );
  for (const id of live) {
    const c: unknown = addonQty ? (addonQty as Record<string, unknown>)[id] : undefined;
    out[id] = isInt(c) ? (c) : qty;
  }
  return out;
}

/**
 * Canonical split map for storage/keys/engine/payload — or undefined when
 * the picks are legacy-shaped (no ids, or every count equals qty). Collapsing
 * trivial maps to undefined keeps legacy keys and payloads byte-identical.
 */
export function effectiveAddonQty(
  addonIds: string[],
  addonQty: Record<string, number> | undefined,
  qty: number,
): Record<string, number> | undefined {
  const live = (Array.isArray(addonIds) ? addonIds : []).filter(
    (x): x is string => typeof x === 'string',
  );
  if (!live.length) return undefined;
  const full = resolveSplitCounts(live, addonQty, qty);
  for (const id of live) {
    if (full[id] !== qty) return full;
  }
  return undefined;
}

/**
 * Clamp picks to a (new) quantity. 'multi' picks always ride the full qty;
 * each 'single' group sheds units from its largest pick (ties → last in
 * item order) until its sum fits. Zero-count selections are dropped.
 * Trivial all-full results collapse to the legacy shape (undefined).
 * Never throws — garbage counts coerce to qty here; validatePicks
 * downstream decides whether the line lives.
 */
export function clampSplitPicks(
  menu: MenuData,
  item: MenuItem,
  addonIds: string[],
  addonQty: Record<string, number> | undefined,
  qty: number,
): { ids: string[]; addonQty: Record<string, number> | undefined } {
  const live = (Array.isArray(addonIds) ? addonIds : []).filter(
    (x): x is string => typeof x === 'string',
  );
  if (!live.length) return { ids: [], addonQty: undefined };
  const q = isInt(qty) ? (qty) : 0;
  const counts = isRecordLike(addonQty) ? (addonQty) : undefined;
  const resolved = resolveSplitCounts(live, counts, q);
  for (const id of live) {
    const c = resolved[id];
    if (!isInt(c) || (c) < 0) resolved[id] = q;
  }
  // Deterministic order basis: the item's own add-on order.
  const order = new Map<string, number>();
  const itemAddons: ItemAddon[] = item && Array.isArray(item.addons) ? item.addons : [];
  itemAddons.forEach((a, i) => {
    if (a && typeof a.featureId === 'string' && !order.has(a.featureId)) order.set(a.featureId, i);
  });
  const rankOf = (id: string): number => (order.has(id) ? (order.get(id) as number) : 1e9);
  let kept = live.filter((id) => (resolved[id] ?? 0) !== 0);
  const singleGroups = new Map<string, string[]>();
  for (const id of kept) {
    const gid = groupIdOfFeature(menu, id);
    if (addonGroupSelection(menu, gid) !== 'single') {
      resolved[id] = q;
    } else {
      const k = gid ?? '';
      const arr = singleGroups.get(k);
      if (arr) arr.push(id);
      else singleGroups.set(k, [id]);
    }
  }
  for (const [, opts] of singleGroups) {
    opts.sort((a, b) => rankOf(a) - rankOf(b));
    let guard = 100000;
    while (guard-- > 0) {
      let sum = 0;
      for (const id of opts) sum += resolved[id] ?? 0;
      if (sum <= q) break;
      let pick: string = opts[opts.length - 1];
      let best = -Infinity;
      for (const id of opts) {
        const c = resolved[id] ?? 0;
        if (c >= best) {
          best = c;
          pick = id;
        }
      }
      if (!(best > 0)) break;
      resolved[pick] = (best) - 1;
    }
  }
  kept = kept.filter((id) => (resolved[id] ?? 0) !== 0);
  for (const id of live) {
    if (!kept.includes(id)) delete resolved[id];
  }
  return { ids: kept, addonQty: effectiveAddonQty(kept, resolved, q) };
}
