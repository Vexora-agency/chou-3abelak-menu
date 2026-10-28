import React from 'react';
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
  return (
<div className="fixed inset-0 z-50 flex items-center justify-center p-4">
  <div
    onClick={() => onClose()}
    className="fixed inset-0 bg-black/70"
  />
  <div className="relative z-10 w-full max-w-[480px] bg-[#141414] border-2 border-[var(--primary)] rounded-2xl p-5 max-h-[90vh] overflow-y-auto space-y-4 shadow-2xl stagger">
    <h3 className="text-lg font-black">
      {isNew ? (isAr ? 'إضافة وجبة جديدة' : 'Add New Item') : (isAr ? 'تعديل الوجبة' : 'Edit Item')}
    </h3>

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

    {/* Modal Buttons */}
    <div className="flex gap-3 pt-3">
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
