// Backup fixture menu shared by test-backup-* splits. Pure move from
// scripts/test-backup.mjs (same fields, same values).
export function bi(en, ar) {
  return { en, ar };
}

export function makeMenu() {
  return {
    version: 1,
    schemaVersion: 2,
    updatedAt: '2026-01-01T00:00:00.000Z',
    settings: {
      name: bi('Chou 3abelak', 'شو عبالك'),
      tagline: bi('Fresh', 'طازج'),
      address: bi('', ''),
      hoursText: bi('Daily', 'يومي'),
      currency: bi('LBP', 'ل.ل'),
      logoText: 'C',
      phone: '70123456',
      whatsapp: '96170123456',
      mapUrl: '',
      statusMode: 'auto',
      openTime: '12:00',
      closeTime: '00:00',
      workingDays: ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'],
      timezone: 'Asia/Beirut',
      social: {},
      socialEnabled: {},
      about: bi('', ''),
      ordering: { enabled: false, types: ['delivery'], minOrder: 0, minOrderEnabled: false, deliveryFee: 0, deliveryFeeEnabled: false, note: bi('', '') },
      featureGroups: [{ id: 'sizes', name: bi('Sizes', 'الأحجام') }],
      featureDefs: [
        { id: 'small', groupId: 'sizes', name: bi('Small', 'صغير') },
        { id: 'large', groupId: 'sizes', name: bi('Large', 'كبير') },
      ],
      badges: { newDays: 14, topDays: 30, topCount: 6 },
    },
    categories: [
      { id: 'c1', name: bi('Pies', 'فطائر'), visible: true },
      { id: 'c2', name: bi('Drinks', 'مشروبات'), visible: true },
    ],
    items: [
      {
        id: 'zaatar', categoryId: 'c1', name: bi('Plain Zaatar', 'زعتر سادة'), description: bi('', ''),
        pricing: { unit: 'pc', minQty: 1, step: 1, maxQty: 50, showUnit: false, price: 150000 },
        addons: [], badges: [], featured: false, available: true,
      },
      {
        id: 'mash', categoryId: 'c1', name: bi('Mashrouha, "Special"', 'مشروحة'), description: bi('', ''),
        pricing: { unit: 'pc', minQty: 1, step: 1, maxQty: 50, showUnit: false },
        variants: [{ featureId: 'small', price: 200000 }, { featureId: 'large', price: 350000 }],
        addons: [], badges: [], featured: false, available: true,
      },
      {
        id: 'pepsi', categoryId: 'c2', name: bi('Pepsi', 'بيبسي'), description: bi('', ''),
        pricing: { unit: 'pc', minQty: 1, step: 1, maxQty: 50, showUnit: false, price: 30000 },
        addons: [], badges: [], featured: false, available: true,
      },
    ],
    addonGroups: [],
  };
}
