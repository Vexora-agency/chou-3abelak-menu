import React, { useEffect, useRef, useState } from 'react';
import { Plus, Minus } from 'lucide-react';
import type { MenuItem } from '@/src/types/menu';
import { cartLineKey, hasOptions } from '@/src/utils/pricing';
import '@/src/features/seasonal/xmas-accents.css';

interface MenuListItemActionProps {
  item: MenuItem;
  small: boolean;
  qty: number;
  isAr: boolean;
  onAddItem: (item: MenuItem) => void;
  onUpdateLine: (key: string, dir: 1 | -1) => void;
  onOpenItem: (item: MenuItem) => void;
  /** Christmas theme on: snowfall spark burst around the + button on hover/tap. */
  festive?: boolean;
  /** `vertical` stacks the stepper for narrow list-card action columns. */
  layout?: 'horizontal' | 'vertical';
}

// Dense rows keep their compact look: the visible buttons stay small but
// an invisible hit-slop ring (::after) expands every tap area to 44px+.
// `animate` is false on the component's first render: a stored cart restores
// dozens of steppers at boot and they must not all pop. Every later qty
// change remounts the keyed number span, which replays the one-shot pop.
const renderStepper = (lineKey: string, qty: number, small: boolean, isAr: boolean, onUpdateLine: (key: string, dir: 1 | -1) => void, animate: boolean) => (
  <div className={`flex items-center ${small ? 'gap-1 p-0.5' : 'gap-1.5 p-1'} bg-[var(--primary)] text-[#0A0A0A] rounded-full ${small ? 'shadow-sm' : 'shadow-md'}${animate ? ' anim-stepper-in' : ''}`}>
    <button
      type="button"
      onClick={() => onUpdateLine(lineKey, -1)}
      className={`${small ? 'w-6 h-6' : 'w-7 h-7'} relative after:absolute after:-inset-2.5 after:content-[""] rounded-full bg-black/10 hover:bg-black/20 active:bg-black/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] flex items-center justify-center font-bold transition-all`}
      aria-label={isAr ? 'إنقاص' : 'Decrease'}
    >
      <Minus size={small ? 12 : 14} className="stroke-[3]" />
    </button>
    <span key={qty} className={`font-extrabold tabular-nums ${small ? 'text-xs px-1' : 'text-sm px-1.5'} min-w-[20px] text-center${animate ? ' anim-qty-pop' : ''}`}>
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

const renderVerticalStepper = (lineKey: string, qty: number, isAr: boolean, onUpdateLine: (key: string, dir: 1 | -1) => void, animate: boolean) => (
  <div className={`flex w-8 flex-col items-center gap-0.5 rounded-2xl bg-[var(--primary)] p-0.5 text-[#0A0A0A] shadow-md${animate ? ' anim-stepper-in' : ''}`}>
    <button
      type="button"
      onClick={() => onUpdateLine(lineKey, 1)}
      className="relative w-6 h-6 rounded-full bg-black/10 hover:bg-black/20 active:bg-black/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] flex items-center justify-center font-bold transition-all after:absolute after:-inset-2 after:content-['']"
      aria-label={isAr ? 'زيادة' : 'Increase'}
    >
      <Plus size={13} className="stroke-[3]" />
    </button>
    <span key={qty} className={`text-xs font-extrabold tabular-nums leading-none px-1${animate ? ' anim-qty-pop' : ''}`}>
      {qty}
    </span>
    <button
      type="button"
      onClick={() => onUpdateLine(lineKey, -1)}
      className="relative w-6 h-6 rounded-full bg-black/10 hover:bg-black/20 active:bg-black/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] flex items-center justify-center font-bold transition-all after:absolute after:-inset-2 after:content-['']"
      aria-label={isAr ? 'إنقاص' : 'Decrease'}
    >
      <Minus size={13} className="stroke-[3]" />
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
  festive = false,
  layout = 'horizontal',
}) => {
  const vertical = layout === 'vertical';
  const addShape = vertical
    ? 'w-12 h-12 rounded-2xl'
    : `${small ? 'w-8 h-8' : 'w-10 h-10'} rounded-full`;
  const addIcon = vertical ? 20 : small ? 16 : 18;
  const options = hasOptions(item);
  // Latch the one-shot pop only when the qty actually crosses 0 -> positive,
  // so a boot-restored stepper stays still and a later parent re-render can
  // never replay the entrance on steppers that were already on screen.
  const [stepperAnimate, setStepperAnimate] = useState(false);
  const prevQtyRef = useRef(qty);
  useEffect(() => {
    const prev = prevQtyRef.current;
    prevQtyRef.current = qty;
    if (prev === 0 && qty > 0) setStepperAnimate(true);
  }, [qty]);
  const animate = stepperAnimate;
  // Festive sparkles around the + button (CSS-only, aria-hidden).
  const sparks = festive && qty === 0 ? (
    <>
      <span aria-hidden="true" className="xmas-spark xmas-spark-1" />
      <span aria-hidden="true" className="xmas-spark xmas-spark-2" />
      <span aria-hidden="true" className="xmas-spark xmas-spark-3" />
      <span aria-hidden="true" className="xmas-spark xmas-spark-4" />
    </>
  ) : null;
  if (options) {
    if (qty === 0) {
      return (
        <button
          type="button"
          onClick={() => onAddItem(item)}
          className={`group ${addShape} relative after:absolute after:-inset-1.5 after:content-[""] bg-[var(--primary)] text-[#0A0A0A] flex items-center justify-center font-bold shadow-md hover:brightness-110 hover:scale-110 hover:shadow-[0_0_22px_color-mix(in_srgb,var(--primary)_55%,transparent)] active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 transition-all duration-200${festive ? ' xmas-add' : ''}`}
          aria-label={isAr ? `إضافة ${item.name.ar}` : `Add ${item.name.en}`}
        >
          <Plus size={addIcon} className="stroke-[2.5] transition-transform duration-300 group-hover:scale-125" />
          {sparks}
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => onOpenItem(item)}
        className={`bg-[var(--primary)] text-[#0A0A0A] font-extrabold shadow-md hover:brightness-110 hover:scale-[1.04] hover:shadow-[0_0_18px_color-mix(in_srgb,var(--primary)_50%,transparent)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 transition-all duration-200 ${
          vertical
            ? 'w-12 h-12 rounded-2xl text-sm'
            : small
              ? 'rounded-full h-11 min-h-[44px] px-4 text-xs'
              : 'rounded-full h-11 min-h-[44px] px-5 text-sm'
        }`}
        aria-label={isAr ? `تعديل ${item.name.ar}` : `Customize ${item.name.en}`}
      >
        <span key={qty} className={`tabular-nums${animate ? ' anim-qty-pop' : ''}`}>{qty}</span>
      </button>
    );
  }
  if (qty === 0) {
    return (
      <button
        type="button"
        onClick={() => onAddItem(item)}
        className={`group ${addShape} bg-[var(--primary)] text-[#0A0A0A] flex items-center justify-center font-bold shadow-md hover:brightness-110 hover:scale-110 hover:shadow-[0_0_22px_color-mix(in_srgb,var(--primary)_55%,transparent)] active:scale-90 transition-all duration-200${festive ? ' xmas-add' : ''}`}
        aria-label={isAr ? `إضافة ${item.name.ar}` : `Add ${item.name.en}`}
      >
        <Plus size={addIcon} className="stroke-[2.5] transition-transform duration-300 group-hover:scale-125" />
        {sparks}
      </button>
    );
  }
  return vertical
    ? renderVerticalStepper(cartLineKey(item.id), qty, isAr, onUpdateLine, animate)
    : renderStepper(cartLineKey(item.id), qty, small, isAr, onUpdateLine, animate);
};
