import type { MenuData, MenuItem } from '@/src/types/menu';
import { normalizePricing } from '@/src/utils/pricing';
import { isRecord, str } from '@/src/utils/safeJson';
import type { AdminFetch } from '@/src/lib/api-client';

interface AdminCatalogOptions {
  menu: MenuData;
  updateMenu: (updater: (prev: MenuData) => MenuData) => void;
  flushDirty: () => Promise<number | null>;
  isAr: boolean;
  adminFetch: AdminFetch;
  showUndoToast: (label: string, undo: () => void) => void;
  refreshMenuFromServer: () => Promise<boolean>;
  handleRestoreTrashById: (trashId: string) => Promise<{ ok: boolean; conflict: boolean }>;
  editingItem: MenuItem | null;
  setEditingItem: (item: MenuItem | null) => void;
  isNewItem: boolean;
}

/** Category + item mutations (single reason to change: the catalog). */
export function useAdminCatalog({
  menu, updateMenu, flushDirty, isAr, adminFetch,
  showUndoToast, refreshMenuFromServer, handleRestoreTrashById,
  editingItem, setEditingItem, isNewItem,
}: AdminCatalogOptions) {
  // Category Actions
  const handleAddCategory = () => {
    const newId = `c_${Date.now().toString(36)}`;
    updateMenu((prev) => ({
      ...prev,
      categories: [
        ...prev.categories,
        { id: newId, name: { en: 'New Category', ar: 'قسم جديد' }, visible: true },
      ],
    }));
  };

  const handleMoveCategory = (index: number, direction: 'up' | 'down') => {
    updateMenu((prev) => {
      const newCats = [...prev.categories];
      const targetIdx = direction === 'up' ? index - 1 : index + 1;
      if (targetIdx < 0 || targetIdx >= newCats.length) return prev;
      const temp = newCats[index];
      newCats[index] = newCats[targetIdx];
      newCats[targetIdx] = temp;
      return { ...prev, categories: newCats };
    });
  };

  const handleRestoreTrashByIdLocal = handleRestoreTrashById;

  const handleDeleteCategory = async (catId: string) => {
    const cat = menu.categories.find((c) => c.id === catId);
    const v = await flushDirty();
    if (v === null) return;
    try {
      const res = await adminFetch('/api/admin/trash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'category', id: catId, baseVersion: v }),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok || !isRecord(data) || !data.ok) {
        if (res.status === 409) {
          await refreshMenuFromServer();
          alert(isAr ? 'تغيّرت القائمة أثناء الحذف. أُعيد التحميل — حاول مجددًا.' : 'The menu changed during delete. Reloaded — please retry.');
        } else {
          alert(isAr ? 'تعذر الحذف. حاول مجددًا.' : 'Could not delete. Please try again.');
        }
        return;
      }
      await refreshMenuFromServer();
      const label = cat ? (isAr ? cat.name.ar : cat.name.en) : catId;
      showUndoToast(
        isAr ? `حُذف القسم "${label}"` : `Deleted category "${label}"`,
        () => { void handleRestoreTrashByIdLocal(str((data as { trashId?: unknown }).trashId)); }
      );
    } catch {
      alert(isAr ? 'تعذر الحذف. حاول مجددًا.' : 'Could not delete. Please try again.');
    }
  };

  // Item Actions
  const handleSaveItemModal = () => {
    if (!editingItem) return;
    if (!editingItem.name.en.trim() && !editingItem.name.ar.trim()) {
      alert(isAr ? 'يرجى إدخال اسم الصنف' : 'Item name is required');
      return;
    }
    // The server rejects unknown/empty categoryId with a generic 400 — catch
    // it here with a field-level message instead of a cryptic save failure.
    if (!editingItem.categoryId || !(menu.categories || []).some((c) => c.id === editingItem.categoryId)) {
      alert(isAr ? 'اختر قسمًا موجودًا للصنف قبل الحفظ' : 'Pick an existing category for this item before saving');
      return;
    }
    const rawPricing = editingItem.pricing && typeof editingItem.pricing === 'object'
      ? editingItem.pricing
      : { unit: 'pc' as const, minQty: 1, step: 1, maxQty: 50, showUnit: false };
    if (!Number.isInteger(rawPricing.minQty) || rawPricing.minQty < 1) {
      alert(isAr ? 'أقل كمية يجب أن تكون عددًا صحيحًا ≥ 1' : 'Min quantity must be an integer ≥ 1');
      return;
    }
    if (!Number.isInteger(rawPricing.step) || rawPricing.step < 1) {
      alert(isAr ? 'الخطوة يجب أن تكون عددًا صحيحًا ≥ 1' : 'Step must be an integer ≥ 1');
      return;
    }
    if (!Number.isInteger(rawPricing.maxQty) || rawPricing.maxQty < rawPricing.minQty) {
      alert(isAr ? 'أقصى كمية يجب أن تكون عددًا صحيحًا ≥ أقل كمية' : 'Max quantity must be an integer ≥ min quantity');
      return;
    }
    // Sizes and add-ons: feature must exist in the library and be unique
    // per list (the list itself decides the role — no cross checks)
    const variants = Array.isArray(editingItem.variants) ? editingItem.variants : [];
    const seenV = new Set<string>();
    for (const v of variants) {
      if (!v.featureId || seenV.has(v.featureId) || !(menu.settings.featureDefs || []).some((d) => d.id === v.featureId)) {
        alert(isAr ? 'كل حجم يجب أن يختار ميزة موجودة وغير مكررة' : 'Every size must pick an existing, unique feature');
        return;
      }
      seenV.add(v.featureId);
      // Empty (cleared) or 0 = free; negative is rejected.
      if (typeof v.price !== 'number' || !Number.isFinite(v.price) || v.price < 0) {
        alert(isAr ? 'سعر الحجم يجب أن يكون رقمًا ≥ 0 (فارغ أو 0 = مجانًا)' : 'Size price must be a number ≥ 0 (empty or 0 = free)');
        return;
      }
    }
    const addons = Array.isArray(editingItem.addons) ? editingItem.addons : [];
    const seenA = new Set<string>();
    for (const a of addons) {
      if (!a.featureId || seenA.has(a.featureId) || !(menu.settings.featureDefs || []).some((d) => d.id === a.featureId)) {
        alert(isAr ? 'كل إضافة يجب أن تختار ميزة موجودة وغير مكررة' : 'Every add-on must pick an existing, unique feature');
        return;
      }
      seenA.add(a.featureId);
      if (typeof a.price !== 'number' || !Number.isFinite(a.price) || a.price < 0) {
        alert(isAr ? 'سعر الإضافة يجب أن يكون رقمًا ≥ 0 (0 = مجانًا)' : 'Add-on price must be a number ≥ 0 (0 = free)');
        return;
      }
    }
    if (variants.length === 0) {
      // Empty = free (saved as 0 below); only negative/NaN is rejected.
      const rp = rawPricing.price;
      if (rp !== undefined && (typeof rp !== 'number' || !Number.isFinite(rp) || rp < 0)) {
        alert(isAr ? 'السعر لا يمكن أن يكون سالبًا (اتركه فارغًا للمجاني)' : 'Price can’t be negative (leave it empty for free)');
        return;
      }
    }

    // Auto-fill the blank language from the written one
    const pricing = normalizePricing(editingItem);
    // No sizes + no price typed = free item.
    if (variants.length === 0 && pricing.price === undefined) pricing.price = 0;
    const filled: MenuItem = {
      ...editingItem,
      pricing,
      ...(variants.length ? { variants: variants.map((v) => ({ featureId: v.featureId, price: v.price })) } : { variants: undefined }),
      ...(addons.length ? { addons: addons.map((a) => ({ featureId: a.featureId, price: a.price, ...(a.default ? { default: true as const } : {}) })) } : { addons: undefined }),
      // Keep an explicit default only when it still points at a size
      ...(editingItem.defaultVariant && variants.some((v) => v.featureId === editingItem.defaultVariant)
        ? { defaultVariant: editingItem.defaultVariant }
        : { defaultVariant: undefined }),
      name: {
        en: editingItem.name.en.trim() ? editingItem.name.en : editingItem.name.ar,
        ar: editingItem.name.ar.trim() ? editingItem.name.ar : editingItem.name.en,
      },
      description: {
        en: editingItem.description.en.trim() ? editingItem.description.en : editingItem.description.ar,
        ar: editingItem.description.ar.trim() ? editingItem.description.ar : editingItem.description.en,
      },
    };
    if (!variants.length) delete (filled as Partial<MenuItem>).variants;
    if (!addons.length) delete (filled as Partial<MenuItem>).addons;
    if (!variants.some((v) => v.featureId === filled.defaultVariant)) delete (filled as Partial<MenuItem>).defaultVariant;

    updateMenu((prev) => {
      if (isNewItem) {
        return { ...prev, items: [...prev.items, filled] };
      }
      return {
        ...prev,
        items: prev.items.map((i) => (i.id === filled.id ? filled : i)),
      };
    });

    setEditingItem(null);
  };

  const handleDuplicateItem = (item: MenuItem) => {
    // Fresh identity AND fresh NEW-window: copying addedAt would inherit the
    // original's "new" badge timing instead of starting the clone's own.
    const { addedAt: _droppedAddedAt, ...rest } = item;
    void _droppedAddedAt;
    const duplicated: MenuItem = {
      ...rest,
      id: `i_${Date.now().toString(36)}`,
      name: {
        en: `${item.name.en} (Copy)`,
        ar: `${item.name.ar} (نسخة)`,
      },
    };
    updateMenu((prev) => ({ ...prev, items: [...prev.items, duplicated] }));
  };

  const handleDeleteItem = async (itemId: string) => {
    const it = menu.items.find((i) => i.id === itemId);
    const v = await flushDirty();
    if (v === null) return;
    try {
      const res = await adminFetch('/api/admin/trash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'item', id: itemId, baseVersion: v }),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok || !isRecord(data) || !data.ok) {
        if (res.status === 409) {
          await refreshMenuFromServer();
          alert(isAr ? 'تغيّرت القائمة أثناء الحذف. أُعيد التحميل — حاول مجددًا.' : 'The menu changed during delete. Reloaded — please retry.');
        } else {
          alert(isAr ? 'تعذر الحذف. حاول مجددًا.' : 'Could not delete. Please try again.');
        }
        return;
      }
      await refreshMenuFromServer();
      const label = it ? (isAr ? it.name.ar : it.name.en) : itemId;
      showUndoToast(
        isAr ? `حُذف "${label}"` : `Deleted "${label}"`,
        () => { void handleRestoreTrashByIdLocal(str((data as { trashId?: unknown }).trashId)); }
      );
    } catch {
      alert(isAr ? 'تعذر الحذف. حاول مجددًا.' : 'Could not delete. Please try again.');
    }
  };

  const handleMoveItem = (itemId: string, direction: 'up' | 'down') => {
    updateMenu((prev) => {
      const items = [...prev.items];
      const idx = items.findIndex((i) => i.id === itemId);
      if (idx === -1) return prev;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= items.length) return prev;
      const temp = items[idx];
      items[idx] = items[targetIdx];
      items[targetIdx] = temp;
      return { ...prev, items };
    });
  };

  return {
    handleAddCategory, handleMoveCategory, handleDeleteCategory,
    handleSaveItemModal, handleDuplicateItem, handleDeleteItem, handleMoveItem,
  };
}
