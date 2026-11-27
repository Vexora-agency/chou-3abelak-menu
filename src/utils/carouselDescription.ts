import type { MenuItem } from '@/src/types/menu';

/** Same cap as the server validator (item descriptions use 300 too). */
export const CAROUSEL_DESCRIPTION_MAX = 300;

/**
 * The carousel-only description wins per language, then the item's regular
 * description. A blank custom value never hides the regular copy.
 */
export function pickCarouselDescription(item: MenuItem, lang: 'en' | 'ar'): string {
  const custom = item.carouselDescription?.[lang];
  if (typeof custom === 'string' && custom.trim()) return custom.trim();
  const own = item.description?.[lang];
  return typeof own === 'string' ? own.trim() : '';
}

export function hasCustomCarouselDescription(item: MenuItem): boolean {
  const custom = item.carouselDescription;
  if (!custom) return false;
  const en = typeof custom.en === 'string' ? custom.en : '';
  const ar = typeof custom.ar === 'string' ? custom.ar : '';
  return Boolean(en.trim() || ar.trim());
}
