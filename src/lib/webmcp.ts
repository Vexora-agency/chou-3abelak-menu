/// <reference types="webmcp-types" />
import '@w3c/webmcp-polyfill/auto';
import type { MenuData } from '@/src/types/menu';

type MenuFetch = () => Promise<MenuData | null>;

async function fetchLiveMenu(signal?: AbortSignal): Promise<MenuData | null> {
  try {
    const res = await fetch('/api/menu', {
      credentials: 'same-origin',
      signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as MenuData;
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function itemPriceRange(item: MenuData['items'][number]): { min: number; max: number } | null {
  const prices: number[] = [];
  if (typeof item.pricing?.price === 'number') prices.push(item.pricing.price);
  for (const v of item.variants ?? []) {
    if (typeof v?.price === 'number') prices.push(v.price);
  }
  if (prices.length === 0) return null;
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

/**
 * Register read-only WebMCP tools for browser agents.
 * Safe to call once at startup: no-ops outside secure browser contexts,
 * never throws, and unregisters everything when the cleanup runs.
 */
export function initWebMCP(fetchMenu: MenuFetch = fetchLiveMenu): () => void {
  if (typeof document === 'undefined') return () => {};
  try {
    if (typeof window !== 'undefined' && !window.isSecureContext) return () => {};
    const context = document.modelContext;
    if (!context) return () => {};
    const controller = new AbortController();

    const register = (tool: WebMCP.ModelContextTool) =>
      context.registerTool(tool, { signal: controller.signal }).catch(() => {});

    void register({
      name: 'get-store-info',
      title: 'Store information',
      description:
        'Get the restaurant name, phone, written address, working hours and ordering status. Use for store questions, never for ordering.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      execute: async (_input, options) => {
        const menu = await fetchMenu().catch(() => null);
        const withSignal = options?.signal
          ? fetchLiveMenu(options.signal)
          : Promise.resolve(menu);
        const live = (await withSignal.catch(() => null)) ?? menu;
        if (!live) return { status: 'unavailable' };
        return {
          name: live.settings?.name ?? null,
          phone: live.settings?.phone ?? null,
          address: live.settings?.address ?? null,
          hoursText: live.settings?.hoursText ?? null,
          statusMode: live.settings?.statusMode ?? null,
          orderingEnabled: live.settings?.ordering?.enabled ?? false,
        };
      },
    });

    void register({
      name: 'list-categories',
      title: 'Menu categories',
      description: 'List visible menu categories with their names in English and Arabic.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      execute: async (_input) => {
        const menu = await fetchMenu().catch(() => null);
        if (!menu) return { categories: [] };
        return {
          categories: (menu.categories ?? [])
            .filter((c) => c.visible !== false)
            .map((c) => ({ id: c.id, name: c.name })),
        };
      },
    });

    void register({
      name: 'search-menu',
      title: 'Search menu items',
      description:
        'Search menu items by name. Returns matching items with ids, bilingual names, category, price range and badges. Read-only, never places an order.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search text, item name or keyword' },
          limit: { type: 'integer', description: 'Maximum results, 1 to 20', minimum: 1, maximum: 20 },
        },
        required: ['query'],
      },
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        const raw = (input as Record<string, unknown>)?.query;
        const query = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
        if (!query) return { items: [] };
        const limRaw = (input as Record<string, unknown>)?.limit;
        const limit =
          typeof limRaw === 'number' && Number.isFinite(limRaw)
            ? Math.min(20, Math.max(1, Math.floor(limRaw)))
            : 10;
        const menu = await fetchMenu().catch(() => null);
        if (!menu) return { items: [] };
        const out: Array<Record<string, unknown>> = [];
        for (const item of menu.items ?? []) {
          if (item.available === false) continue;
          const en = item.name?.en ?? '';
          const ar = item.name?.ar ?? '';
          if (!en.toLowerCase().includes(query) && !ar.includes(query)) continue;
          out.push({
            id: item.id,
            name: item.name,
            categoryId: item.categoryId,
            priceRange: itemPriceRange(item),
            badges: item.badges ?? [],
            featured: !!item.featured,
          });
          if (out.length >= limit) break;
        }
        return { items: out };
      },
    });

    return () => controller.abort();
  } catch {
    return () => {};
  }
}
