import type { FeatureGroup, MenuData } from '@/src/types/menu';

/** Sections that actually hold features + the sizes section (by id/name convention). */
export function useItemEditorSections(menu: MenuData): {
  nonEmptySections: FeatureGroup[];
  sizesSection: FeatureGroup | undefined;
} {
  // Sections that actually hold features (choices of the add-flow picker)
  const nonEmptySections = (menu.settings.featureGroups || []).filter((g) =>
    (menu.settings.featureDefs || []).some((d) => d.groupId === g.id)
  );
  // The sizes section, by convention: id "sizes" or a sizes-like name.
  // "Add size" bulk-adds straight from it — no picker, no questions.
  const isSizesSection = (g: { id: string; name: { en: string; ar: string } }): boolean => {
    if (g.id === 'sizes') return true;
    const names = [g.name?.en, g.name?.ar].map((s) => (s || '').trim().toLowerCase());
    return names.some((n) => n === 'size' || n === 'sizes' || n === 'أحجام' || n === 'احجام');
  };
  const sizesSection = nonEmptySections.find((g) => isSizesSection(g));
  return { nonEmptySections, sizesSection };
}
