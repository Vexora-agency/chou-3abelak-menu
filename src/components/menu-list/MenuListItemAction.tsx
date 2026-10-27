import React from 'react';
import { Plus, Minus } from 'lucide-react';
import type { MenuItem } from '@/src/types/menu';
import { cartLineKey, hasOptions } from '@/src/utils/pricing';

interface MenuListItemActionProps {
  item: MenuItem;
  small: boolean;
  qty: number;
  isAr: boolean;
  onAddItem: (item: MenuItem) => void;
  onUpdateLine: (key: string, dir: 1 | -1) => void;
  onOpenItem: (item: MenuItem) => void;
}

const renderStepper = (lineKey: string, qty: number, small: boolean, isAr: boolean, onUpdateLine: (key: string, dir: 1 | -1) => void) => (
  <div className={`flex items-center ${small ? 'gap-1 p-0.5' : 'gap-1.5 p-1'} bg-[#FFC400] text-[#0A0A0A] rounded-full ${small ? 'shadow-sm' : 'shadow-md'}`}>
    <button
      type="button"
      onClick={() => onUpdateLine(lineKey, -1)}
      className={`${small ? 'w-6 h-6' : 'w-7 h-7'} rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center font-bold transition-all`}
      aria-label={isAr ? 'إنقاص' : 'Decrease'}
    >
      <Minus size={small ? 12 : 14} className="stroke-[3]" />
    </button>
    <span className={`font-extrabold ${small ? 'text-xs px-1' : 'text-sm px-1.5'} min-w-[20px] text-center`}>
      {qty}
    </span>
    <button
      type="button"
      onClick={() => onUpdateLine(lineKey, 1)}
      className={`${small ? 'w-6 h-6' : 'w-7 h-7'} rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center font-bold transition-all`}
      aria-label={isAr ? 'زيادة' : 'Increase'}
    >
      <Plus size={small ? 12 : 14} className="stroke-[3]" />
    </button>
  </div>
);

// Action control for a card/row: option items always open the sheet,
// simple items add minQty directly then step.
export const MenuListItemAction: React.FC<MenuListItemActionProps> = ({
  item,
  small,
  qty,
  isAr,
  onAddItem,
  onUpdateLine,
  onOpenItem,
}) => {
  const options = hasOptions(item);
  if (options) {
    if (qty === 0) {
      return (
        <button
          type="button"
          onClick={() => onAddItem(item)}
          className={`group ${small ? 'w-8 h-8' : 'w-10 h-10'} rounded-full bg-[#FFC400] text-[#0A0A0A] flex items-center justify-center font-bold shadow-md hover:bg-[#ffd033] hover:scale-110 hover:shadow-[0_0_22px_rgba(255,196,0,0.55)] active:scale-90 transition-all duration-200`}
          aria-label={isAr ? `إضافة ${item.name.ar}` : `Add ${item.name.en}`}
        >
          <Plus size={small ? 16 : 18} className="stroke-[2.5] transition-transform duration-300 group-hover:scale-125" />
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => onOpenItem(item)}
        className={`rounded-full bg-[#FFC400] text-[#0A0A0A] font-extrabold shadow-md hover:bg-[#ffd033] hover:scale-[1.04] hover:shadow-[0_0_18px_rgba(255,196,0,0.5)] active:scale-95 transition-all duration-200 ${small ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm'}`}
        aria-label={isAr ? `تعديل ${item.name.ar}` : `Customize ${item.name.en}`}
      >
        <span className="tabular-nums">{qty}</span>
      </button>
    );
  }
  if (qty === 0) {
    return (
      <button
        type="button"
        onClick={() => onAddItem(item)}
        className={`group ${small ? 'w-8 h-8' : 'w-10 h-10'} rounded-full bg-[#FFC400] text-[#0A0A0A] flex items-center justify-center font-bold shadow-md hover:bg-[#ffd033] hover:scale-110 hover:shadow-[0_0_22px_rgba(255,196,0,0.55)] active:scale-90 transition-all duration-200`}
        aria-label={isAr ? `إضافة ${item.name.ar}` : `Add ${item.name.en}`}
      >
        <Plus size={small ? 16 : 18} className="stroke-[2.5] transition-transform duration-300 group-hover:scale-125" />
      </button>
    );
  }
  return renderStepper(cartLineKey(item.id), qty, small, isAr, onUpdateLine);
};
