export const WISHLIST_STR = {
  en: {
    /** Icon button label, includes the dish name for screen readers. */
    add: (name: string) => `Save ${name} to wishlist`,
    remove: (name: string) => `Remove ${name} from wishlist`,
    save: 'Save to wishlist',
    saved: 'Saved to wishlist',
    shortSave: 'Save',
    shortSaved: 'Saved',
    fullError: 'Your wishlist is full. Remove an item to save another.',
    loadError: 'Could not load your wishlist.',
  },
  ar: {
    add: (name: string) => `احفظ ${name} في المفضلة`,
    remove: (name: string) => `أزل ${name} من المفضلة`,
    save: 'احفظ في المفضلة',
    saved: 'محفوظ في المفضلة',
    shortSave: 'حفظ',
    shortSaved: 'محفوظ',
    fullError: 'قائمة المفضلة ممتلئة. احذف عنصرًا لحفظ عنصر آخر.',
    loadError: 'تعذّر تحميل المفضلة.',
  },
} as const;
