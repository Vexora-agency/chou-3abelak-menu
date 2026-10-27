import React, { useEffect, useState } from 'react';
import { MenuData, MenuItem, CartLine } from '@/src/types/menu';
import { X, Plus, Minus, Flame, Sparkles, Award } from 'lucide-react';
import { pickLangText, badgeLabel } from '@/src/utils/menuHelpers';
import {
  itemAddons, cartLineKey, hasOptions, hasVariants, getVariant,
  lineTotal, normalizePricing, priceLabel, formatPrice,
} from '@/src/utils/pricing';
import { VariantPicker } from '@/src/components/item-view/VariantPicker';
import { AddonPicker } from '@/src/components/item-view/AddonPicker';

interface ItemDetailsModalProps {
  item: MenuItem | null;
  menu: MenuData;
  onClose: () => void;
  cart: Record<string, CartLine>;
  onAddItem: (item: MenuItem) => void;
  onAddConfigured: (item: MenuItem, variantId: string | undefined, addonIds: string[], qty: number) => void;
  onUpdateLine: (key: string, dir: 1 | -1) => void;
  currency: string;
  lang: 'en' | 'ar';
  darkMode: boolean;
}

export const ItemDetailsModal: React.FC<ItemDetailsModalProps> = ({
  item,
  menu,
  onClose,
  cart,
  onAddItem,
  onAddConfigured,
  onUpdateLine,
  currency,
  lang,
  darkMode,
}) => {
  const isAr = lang === 'ar';

  // Configurator state (reset whenever a different item opens).
  // Render-phase adjustment (blessed pattern): applies before paint, so the
  // sheet never flashes the previous item's selection.
  const [variantId, setVariantId] = useState<string | undefined>(undefined);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [lastItemId, setLastItemId] = useState<string | null>(null);
  const openItemId = item?.id ?? null;
  if (openItemId !== lastItemId) {
    setLastItemId(openItemId);
    if (item) {
      setVariantId(getVariant(item)?.featureId);
      setAddonIds([]);
      setQty(normalizePricing(item).minQty);
    }
  }

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (item) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [item, onClose]);

  if (!item) return null;

  const pricing = normalizePricing(item);
  const options = hasOptions(item);
  const variants = hasVariants(item) ? item.variants || [] : [];
  const addons = itemAddons(item);
  const singleKey = cartLineKey(item.id);
  const singleQty = cart[singleKey]?.quantity || 0;

  // Live total for the configured selection
  let liveTotal: number | null;
  try {
    liveTotal = lineTotal(item, { variantId, addonIds, qty });
  } catch {
    liveTotal = null;
  }

  const toggleAddon = (id: string) => {
    setAddonIds((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  };

  const stepQty = (dir: 1 | -1) => {
    setQty((q) => Math.max(pricing.minQty, Math.min(pricing.maxQty, q + dir * pricing.step)));
  };

  const chipBase = 'px-3.5 h-10 rounded-full text-xs font-bold border transition-colors btn-tactile inline-flex items-center gap-1.5';

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-6">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/60 anim-fade-in"
        aria-hidden="true"
      />

      {/* Drawer on mobile, Centered Modal on Desktop */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={pickLangText(item.name, lang)}
        className={`relative z-10 w-full max-w-[520px] max-h-[92vh] overflow-y-auto overscroll-contain no-scrollbar rounded-t-[28px] md:rounded-[28px] border-t-[5px] border-t-[#FFC400] md:border-2 md:border-[#FFC400] px-6 sm:px-8 pt-4 sm:pt-6 pb-8 anim-slide-up shadow-2xl transition-colors duration-200 ${
          darkMode ? 'bg-[#141414] text-white' : 'bg-white text-[#0A0A0A]'
        }`}
      >
        {/* Drag Pill Handle (Mobile only) */}
        <div className={`w-11 h-1.5 rounded-full mx-auto mb-4 md:hidden ${darkMode ? 'bg-neutral-600' : 'bg-neutral-300'}`} />

        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className={`absolute top-4 right-5 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
            darkMode
              ? 'bg-neutral-800 text-neutral-300 hover:text-white hover:bg-neutral-700'
              : 'bg-neutral-100 text-neutral-700 hover:text-black hover:bg-neutral-200'
          }`}
          aria-label={isAr ? 'إغلاق' : 'Close modal'}
        >
          <X size={18} />
        </button>

        {/* Header: Title and Price */}
        <div className="flex justify-between items-start gap-4 pr-6">
          <div>
            <h3 className={`text-2xl font-black leading-tight ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
              {pickLangText(item.name, lang)}
            </h3>
            {/* Badges */}
            <div className="flex items-center gap-1.5 mt-2">
              {item.badges.map((b) => (
                <span
                  key={b}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#0A0A0A] text-[#FFC400] border border-[#FFC400]"
                >
                    {b === 'spicy' && <Flame size={12} className="fill-[#FFC400]" />}
                    {b === 'top' && <Award size={12} className="fill-[#FFC400]" />}
                    {b === 'new' && <Sparkles size={12} />}
                    {badgeLabel(b, lang)}
                </span>
              ))}
              {!item.available && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-neutral-600 text-white">
                  {isAr ? 'نفذت الكمية' : 'Sold out'}
                </span>
              )}
            </div>
          </div>

          <div className="flex-shrink-0 px-3.5 py-1.5 rounded-full text-lg font-black bg-[#FFC400] text-[#0A0A0A] shadow-sm whitespace-nowrap">
            {priceLabel(item, lang, currency)}
          </div>
        </div>

        {/* Description (hidden when the admin leaves it empty) */}
        {pickLangText(item.description, lang).trim() ? (
          <p
            className={`mt-4 text-sm leading-relaxed ${
              darkMode ? 'text-neutral-300' : 'text-neutral-700 font-medium'
            }`}
          >
            {pickLangText(item.description, lang)}
          </p>
        ) : null}

        {/* Ordering Actions */}
        <div className={`mt-6 pt-4 border-t space-y-4 ${darkMode ? 'border-neutral-800' : 'border-neutral-200'}`}>
          {item.available ? (
            options ? (
              <>
                {/* Variants (required — first is the default) */}
                <VariantPicker variants={variants} variantId={variantId} onSelect={setVariantId} menu={menu} lang={lang} currency={currency} darkMode={darkMode} isAr={isAr} chipBase={chipBase} />

                {/* Add-ons */}
                <AddonPicker addons={addons} addonIds={addonIds} onToggle={toggleAddon} menu={menu} lang={lang} currency={currency} darkMode={darkMode} isAr={isAr} chipBase={chipBase} />

                {/* Quantity stepper */}
                <div className="flex items-center justify-between gap-4">
                  <span className={`font-bold text-sm ${darkMode ? 'text-neutral-200' : 'text-neutral-800'}`}>
                    {isAr ? 'الكمية:' : 'Quantity:'}
                  </span>
                  <div className="flex items-center gap-2 bg-[#FFC400] text-[#0A0A0A] rounded-full p-1 shadow-sm">
                    <button
                      type="button"
                      onClick={() => stepQty(-1)}
                      className="w-8 h-8 rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center font-bold text-[#0A0A0A]"
                      aria-label={isAr ? 'إنقاص' : 'Decrease'}
                    >
                      <Minus size={16} className="stroke-[3]" />
                    </button>
                    <span className="font-black text-base px-2 min-w-[24px] text-center text-[#0A0A0A] tabular-nums">
                      {qty}
                    </span>
                    <button
                      type="button"
                      onClick={() => stepQty(1)}
                      className="w-8 h-8 rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center font-bold text-[#0A0A0A]"
                      aria-label={isAr ? 'زيادة' : 'Increase'}
                    >
                      <Plus size={16} className="stroke-[3]" />
                    </button>
                  </div>
                </div>

                {/* Add button with live total */}
                <button
                  type="button"
                  disabled={liveTotal === null}
                  onClick={() => onAddConfigured(item, variantId, addonIds, qty)}
                  className="btn-tactile w-full h-12 rounded-full bg-[#FFC400] text-[#0A0A0A] font-extrabold text-base flex items-center justify-center gap-2 shadow-lg hover:bg-[#ffd033] disabled:opacity-50"
                >
                  <Plus size={20} className="stroke-[3]" />
                  <span>{isAr ? 'إضافة إلى الطلب' : 'Add to Order'}</span>
                  {liveTotal !== null && (
                    <span className="tabular-nums" dir="ltr">· {formatPrice(liveTotal, currency)}</span>
                  )}
                </button>
              </>
            ) : singleQty === 0 ? (
              <button
                type="button"
                onClick={() => onAddItem(item)}
                className="btn-tactile w-full h-12 rounded-full bg-[#FFC400] text-[#0A0A0A] font-extrabold text-base flex items-center justify-center gap-2 shadow-lg hover:bg-[#ffd033]"
              >
                <Plus size={20} className="stroke-[3]" />
                <span>{isAr ? 'إضافة إلى الطلب' : 'Add to Order'}</span>
              </button>
            ) : (
              <div className={`flex items-center justify-between gap-4 p-2 rounded-full ${
                darkMode ? 'bg-neutral-800 text-white' : 'bg-neutral-100 text-[#0A0A0A]'
              }`}>
                <span className="font-bold text-sm px-4">
                  {isAr ? 'الكمية في السلة:' : 'In your cart:'}
                </span>
                <div className="flex items-center gap-2 bg-[#FFC400] text-[#0A0A0A] rounded-full p-1 shadow-sm">
                  <button
                    type="button"
                    onClick={() => onUpdateLine(singleKey, -1)}
                    className="w-8 h-8 rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center font-bold text-[#0A0A0A]"
                  >
                    <Minus size={16} className="stroke-[3]" />
                  </button>
                  <span className="font-black text-base px-2 min-w-[24px] text-center text-[#0A0A0A]">
                    {singleQty}
                  </span>
                  <button
                    type="button"
                    onClick={() => onUpdateLine(singleKey, 1)}
                    className="w-8 h-8 rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center font-bold text-[#0A0A0A]"
                  >
                    <Plus size={16} className="stroke-[3]" />
                  </button>
                </div>
              </div>
            )
          ) : (
            <div className={`text-center py-2 text-sm font-semibold ${darkMode ? 'text-neutral-400' : 'text-neutral-600'}`}>
              {isAr ? 'هذا العنصر غير متوفر حالياً' : 'This item is currently unavailable'}
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            className={`btn-tactile w-full h-11 rounded-full border text-sm font-semibold transition-colors ${
              darkMode
                ? 'border-neutral-700 text-neutral-300 hover:bg-white/5'
                : 'border-neutral-300 text-neutral-700 hover:bg-black/5'
            }`}
          >
            {isAr ? 'إغلاق' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};
