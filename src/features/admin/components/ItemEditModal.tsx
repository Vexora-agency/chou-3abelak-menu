import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import type { MenuData, MenuItem } from '@/src/types/menu';
import { useItemEditorSections } from '../hooks/useItemEditorSections';
import { ItemBasicFields } from './item-editor/ItemBasicFields';
import { ItemPricingFields } from './item-editor/ItemPricingFields';
import { ItemVariantsEditor } from './item-editor/ItemVariantsEditor';
import { ItemAddonsEditor } from './item-editor/ItemAddonsEditor';
import { ItemCalcPreview } from './item-editor/ItemCalcPreview';
import { ItemFlagsBar } from './item-editor/ItemFlagsBar';

export interface ItemEditModalProps {
  item: MenuItem;
  isNew: boolean;
  menu: MenuData;
  calcQty: number;
  pickingAddonSec: boolean;
  lang: 'en' | 'ar';
  onChange: (item: MenuItem) => void;
  onCalcQtyChange: (n: number) => void;
  onToggleAddonPicker: () => void;
  onCloseAddonPicker: () => void;
  onClose: () => void;
  onSave: () => void;
}

/** Edit Item dialog of the admin panel (draft editing; the parent owns open/save state). */
export const ItemEditModal: React.FC<ItemEditModalProps> = ({
  item,
  isNew,
  menu,
  calcQty,
  pickingAddonSec,
  lang,
  onChange,
  onCalcQtyChange,
  onToggleAddonPicker,
  onCloseAddonPicker,
  onClose,
  onSave,
}) => {
  const isAr = lang === 'ar';
  const { nonEmptySections, sizesSection } = useItemEditorSections(menu);
  // Escape closes the topmost layer: the addon picker first, the modal after.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (pickingAddonSec) onCloseAddonPicker();
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickingAddonSec, onClose, onCloseAddonPicker]);
  return (
<div className="fixed inset-0 z-50 flex items-center justify-center p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
  <div
    onClick={() => onClose()}
    className="fixed inset-0 bg-black/70"
  />
  {/* dvh (not vh): iOS Safari's vh includes the toolbar zone, so 90vh can run
      under it. overscroll-contain keeps scroll chaining inside the panel. */}
  <div className="relative z-10 w-full max-w-[480px] bg-[#141414] border-2 border-[var(--primary)] rounded-2xl p-5 max-h-[90dvh] overflow-y-auto overscroll-contain space-y-4 shadow-2xl stagger">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-lg font-black">
        {isNew ? (isAr ? 'إضافة صنف جديد' : 'Add New Item') : (isAr ? 'تعديل الصنف' : 'Edit Item')}
      </h3>
      <button
        type="button"
        onClick={() => onClose()}
        aria-label={isAr ? 'إغلاق' : 'Close'}
        className="w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center text-neutral-400 hover:text-white rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
      >
        <X size={20} />
      </button>
    </div>

    <ItemBasicFields item={item} menu={menu} lang={lang} onChange={onChange} />

    <ItemPricingFields item={item} lang={lang} onChange={onChange} />

    <ItemVariantsEditor item={item} menu={menu} lang={lang} sizesSection={sizesSection} onChange={onChange} />

    <ItemAddonsEditor
      item={item}
      menu={menu}
      lang={lang}
      pickingAddonSec={pickingAddonSec}
      nonEmptySections={nonEmptySections}
      sizesSection={sizesSection}
      onChange={onChange}
      onToggleAddonPicker={onToggleAddonPicker}
      onCloseAddonPicker={onCloseAddonPicker}
    />

    <ItemCalcPreview item={item} menu={menu} lang={lang} calcQty={calcQty} onCalcQtyChange={onCalcQtyChange} />

    <ItemFlagsBar item={item} menu={menu} lang={lang} onChange={onChange} />

    {/* Modal Buttons — sticky: Save/Cancel stay visible while the form scrolls */}
    <div className="sticky bottom-0 -mx-5 -mb-5 px-5 pt-3 pb-5 bg-[#141414]/95 backdrop-blur border-t border-neutral-800/70 flex gap-3 rounded-b-2xl">
      <button
        type="button"
        onClick={onSave}
        className="btn-tactile flex-1 h-11 rounded-full bg-[var(--primary)] text-[#0A0A0A] font-bold text-xs"
      >
        {isAr ? 'حفظ العنصر' : 'Save Item'}
      </button>
      <button
        type="button"
        onClick={() => onClose()}
        className="flex-1 h-11 rounded-full border border-neutral-700 text-neutral-300 text-xs font-semibold hover:bg-white/5"
      >
        {isAr ? 'إلغاء' : 'Cancel'}
      </button>
    </div>
  </div>
</div>
  );
};
