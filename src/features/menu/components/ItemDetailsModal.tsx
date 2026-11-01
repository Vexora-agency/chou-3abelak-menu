import React, { useEffect, useState } from 'react';
import { useBodyScrollLock } from '@/src/hooks/useBodyScrollLock';
import { MenuData, MenuItem, CartLine } from '@/src/types/menu';
import { X, Plus, Minus, Flame, Sparkles, Award } from 'lucide-react';
import { pickLangText, badgeLabel } from '@/src/utils/menuHelpers';
import {
  itemAddons, cartLineKey, hasOptions, hasVariants, getVariant,
  lineTotal, perUnitPrice, featureName, normalizePricing, priceLabel, formatPrice,
} from '@/src/utils/pricing';
import { VariantPicker } from './item-view/VariantPicker';
import { AddonPicker } from './item-view/AddonPicker';

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
      // Default-on add-ons open pre-selected — the customer can remove them.
      setAddonIds(itemAddons(item).filter((a) => a.default).map((a) => a.featureId));
      setQty(normalizePricing(item).minQty);
    }
  }

  // Shared counter lock (iOS-safe) — replaces the bare overflow flag that
  // iOS Safari ignores, which let the page scroll behind the sheet.
  useBodyScrollLock(!!item);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (item) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
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

  // Live header: title gains the selected variant name, price pill shows the
  // live per-unit price (variant + add-ons, qty 1) so every tap updates both.
  const selectedVariantName = variants.length > 0 && variantId
    ? featureName(menu, variantId, lang)
    : null;
  const headerTitle = selectedVariantName
    ? `${pickLangText(item.name, lang)} — ${selectedVariantName}`
    : pickLangText(item.name, lang);
  let headerPrice: string | null = null;
  if (options) {
    try {
      headerPrice = formatPrice(perUnitPrice(item, { variantId, addonIds }), currency);
    } catch {
      headerPrice = null;
    }
  }

  const toggleAddon = (id: string) => {
    setAddonIds((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  };

  const stepQty = (dir: 1 | -1) => {
    setQty((q) => Math.max(pricing.minQty, Math.min(pricing.maxQty, q + dir * pricing.step)));
  };

  const chipBase = 'px-3.5 h-10 rounded-full text-xs font-bold border transition-colors btn-tactile inline-flex items-center gap-1.5';

  return (
    // Container height is 100dvh (not inset-0's bottom edge): on iOS Chrome
    // the layout viewport extends behind the bottom toolbar, so a bottom edge
    // would pin the sheet too low and leave a dark strip / cut the Close
    // button. dvh tracks the VISIBLE height — identical to inset-0 wherever
    // they agree, correct where they don't.
    <div className="fixed inset-x-0 top-0 h-[100dvh] z-50 flex items-end md:items-center justify-center p-0 md:p-6">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/60 anim-fade-in"
        aria-hidden="true"
      />

      {/* Drawer on mobile, Centered Modal on Desktop.
          Entrance animation on the wrapper, scrolling on the inner div —
          never both on one element (phone scroll glitches). */}
      <div
        className={`anim-slide-up relative z-10 w-full max-w-[520px] max-h-[92vh] max-h-[calc(92dvh-env(safe-area-inset-bottom))] mb-[env(safe-area-inset-bottom)] md:mb-0 flex flex-col rounded-t-[28px] md:rounded-[28px] border-t-[5px] border-t-[var(--primary)] md:border-2 md:border-[var(--primary)] shadow-2xl overflow-hidden transition-colors duration-200 ${
          darkMode ? 'bg-[#141414] text-white' : 'bg-white text-[#0A0A0A]'
        }`}
      >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={headerTitle}
        className="overflow-y-auto overscroll-contain smooth-scroll-touch no-scrollbar flex-1 min-h-0 px-6 sm:px-8 pt-4 sm:pt-6 pb-[max(2rem,env(safe-area-inset-bottom))] overflow-x-clip"
      >
        {/* Drag Pill Handle (Mobile only) */}
        <div className={`w-11 h-1.5 rounded-full mx-auto mb-4 md:hidden ${darkMode ? 'bg-neutral-600' : 'bg-neutral-300'}`} />

        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className={`absolute top-3 end-4 w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
            darkMode
              ? 'bg-neutral-800 text-neutral-300 hover:text-white hover:bg-neutral-700'
              : 'bg-neutral-100 text-neutral-700 hover:text-black hover:bg-neutral-200'
          }`}
          aria-label={isAr ? 'إغلاق' : 'Close modal'}
        >
          <X size={20} />
        </button>

        {/* Header: Title and Price. The X sits absolute at the inline-end
            corner, so the row reserves 56px on the END side (pe-14 works in
            both LTR and RTL) — the price pill can never slide under it. */}
        <div className="flex justify-between items-start gap-4 pe-14">
          <div className="min-w-0 flex-1">
            <h3 dir="auto" className={`text-xl sm:text-2xl font-black leading-tight ${darkMode ? 'text-white' : 'text-[#0A0A0A]'}`}>
              {headerTitle}
            </h3>
            {/* Badges */}
            <div className="flex items-center gap-1.5 mt-2">
              {item.badges.map((b) => (
                <span
                  key={b}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#0A0A0A] text-[var(--primary)] border border-[var(--primary)]"
                >
                    {b === 'spicy' && <Flame size={12} className="fill-[var(--primary)]" />}
                    {b === 'top' && <Award size={12} className="fill-[var(--primary)]" />}
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

          <div className="flex-shrink-0 px-3.5 py-1.5 rounded-full text-lg font-black bg-[var(--primary)] text-[#0A0A0A] shadow-sm whitespace-nowrap tabular-nums" dir="ltr">
            {headerPrice ?? priceLabel(item, lang, currency)}
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
                  <div className="flex items-center gap-1.5 bg-[var(--primary)] text-[#0A0A0A] rounded-full p-1 shadow-sm">
                    <button
                      type="button"
                      onClick={() => stepQty(-1)}
                      className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-full bg-black/10 hover:bg-black/20 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] flex items-center justify-center font-bold text-[#0A0A0A]"
                      aria-label={isAr ? 'إنقاص' : 'Decrease'}
                    >
                      <Minus size={18} className="stroke-[3]" />
                    </button>
                    <span className="font-black text-base px-2 min-w-[28px] text-center text-[#0A0A0A] tabular-nums" dir="ltr">
                      {qty}
                    </span>
                    <button
                      type="button"
                      onClick={() => stepQty(1)}
                      className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-full bg-black/10 hover:bg-black/20 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] flex items-center justify-center font-bold text-[#0A0A0A]"
                      aria-label={isAr ? 'زيادة' : 'Increase'}
                    >
                      <Plus size={18} className="stroke-[3]" />
                    </button>
                  </div>
                </div>

                {/* Add button with live total */}
                <button
                  type="button"
                  disabled={liveTotal === null}
                  onClick={() => onAddConfigured(item, variantId, addonIds, qty)}
                  className="btn-tactile w-full h-12 rounded-full bg-[var(--primary)] text-[#0A0A0A] font-extrabold text-base flex items-center justify-center gap-2 shadow-lg hover:brightness-110 disabled:opacity-50"
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
                className="btn-tactile w-full h-12 rounded-full bg-[var(--primary)] text-[#0A0A0A] font-extrabold text-base flex items-center justify-center gap-2 shadow-lg hover:brightness-110"
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
                <div className="flex items-center gap-1.5 bg-[var(--primary)] text-[#0A0A0A] rounded-full p-1 shadow-sm shrink-0">
                  <button
                    type="button"
                    onClick={() => onUpdateLine(singleKey, -1)}
                    className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-full bg-black/10 hover:bg-black/20 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] flex items-center justify-center font-bold text-[#0A0A0A]"
                  >
                    <Minus size={18} className="stroke-[3]" />
                  </button>
                  <span className="font-black text-base px-2 min-w-[28px] text-center text-[#0A0A0A] tabular-nums" dir="ltr">
                    {singleQty}
                  </span>
                  <button
                    type="button"
                    onClick={() => onUpdateLine(singleKey, 1)}
                    className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-full bg-black/10 hover:bg-black/20 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] flex items-center justify-center font-bold text-[#0A0A0A]"
                  >
                    <Plus size={18} className="stroke-[3]" />
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
            className={`btn-tactile w-full h-11 min-h-[44px] rounded-full border text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
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
    </div>
  );
};
