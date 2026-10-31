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

// Dense rows keep their compact look: the visible buttons stay small but
// an invisible hit-slop ring (::after) expands every tap area to 44px+.
const renderStepper = (lineKey: string, qty: number, small: boolean, isAr: boolean, onUpdateLine: (key: string, dir: 1 | -1) => void) => (
  <div className={`flex items-center ${small ? 'gap-1 p-0.5' : 'gap-1.5 p-1'} bg-[var(--primary)] text-[#0A0A0A] rounded-full ${small ? 'shadow-sm' : 'shadow-md'}`}>
    <button
      type="button"
      onClick={() => onUpdateLine(lineKey, -1)}
      className={`${small ? 'w-6 h-6' : 'w-7 h-7'} relative after:absolute after:-inset-2.5 after:content-[""] rounded-full bg-black/10 hover:bg-black/20 active:bg-black/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] flex items-center justify-center font-bold transition-all`}
      aria-label={isAr ? 'إنقاص' : 'Decrease'}
    >
      <Minus size={small ? 12 : 14} className="stroke-[3]" />
    </button>
    <span className={`font-extrabold tabular-nums ${small ? 'text-xs px-1' : 'text-sm px-1.5'} min-w-[20px] text-center`}>
      {qty}
    </span>
    <button
      type="button"
      onClick={() => onUpdateLine(lineKey, 1)}
      className={`${small ? 'w-6 h-6' : 'w-7 h-7'} relative after:absolute after:-inset-2.5 after:content-[""] rounded-full bg-black/10 hover:bg-black/20 active:bg-black/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] flex items-center justify-center font-bold transition-all`}
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
          className={`group ${small ? 'w-8 h-8' : 'w-10 h-10'} relative after:absolute after:-inset-1.5 after:content-[""] rounded-full bg-[var(--primary)] text-[#0A0A0A] flex items-center justify-center font-bold shadow-md hover:brightness-110 hover:scale-110 hover:shadow-[0_0_22px_color-mix(in_srgb,var(--primary)_55%,transparent)] active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 transition-all duration-200`}
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
        className={`rounded-full bg-[var(--primary)] text-[#0A0A0A] font-extrabold shadow-md hover:brightness-110 hover:scale-[1.04] hover:shadow-[0_0_18px_color-mix(in_srgb,var(--primary)_50%,transparent)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 transition-all duration-200 ${small ? 'h-11 min-h-[44px] px-4 text-xs' : 'h-11 min-h-[44px] px-5 text-sm'}`}
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
        className={`group ${small ? 'w-8 h-8' : 'w-10 h-10'} rounded-full bg-[var(--primary)] text-[#0A0A0A] flex items-center justify-center font-bold shadow-md hover:brightness-110 hover:scale-110 hover:shadow-[0_0_22px_color-mix(in_srgb,var(--primary)_55%,transparent)] active:scale-90 transition-all duration-200`}
        aria-label={isAr ? `إضافة ${item.name.ar}` : `Add ${item.name.en}`}
      >
        <Plus size={small ? 16 : 18} className="stroke-[2.5] transition-transform duration-300 group-hover:scale-125" />
      </button>
    );
  }
  return renderStepper(cartLineKey(item.id), qty, small, isAr, onUpdateLine);
};
