import React, { useMemo, useState } from 'react';
import type { MenuSettings } from '@/src/types/menu';
import { parseMapUrlCoords } from '@/src/utils/menuHelpers';
import { normalizeDeliveryFeeTiers, resolveDeliveryFee, tierRangeLabel, DELIVERY_FEE_TIERS_MAX, DELIVERY_FEE_UPTO_MIN_KM } from '@/src/utils/deliveryFees';
import { NumField } from './NumField';
import { MapPin, Plus, Trash2, Navigation, Sparkles } from 'lucide-react';

type Ordering = MenuSettings['ordering'];

interface DeliveryFeeSectionProps {
  ordering: Ordering;
  currency: string;
  lang: 'en' | 'ar';
  mapUrl: string;
  onUpdate: (updater: (prev: Ordering) => Ordering) => void;
  onPickRestaurant: () => void;
}

/** Smart delivery-fee card: flat fallback + distance tiers + free threshold. */
export const DeliveryFeeSection: React.FC<DeliveryFeeSectionProps> = ({
  ordering,
  currency,
  lang,
  mapUrl,
  onUpdate,
  onPickRestaurant,
}) => {
  const isAr = lang === 'ar';
  // Raw rows for the editor: every row the admin added, in insertion order.
  // Normalized tiers (sorted, valid only) feed the preview/simulator/resolver.
  // Editing works on raw rows so clearing a field never deletes its row —
  // blanks read as 0 and are flagged below until completed.
  const rawTiers = useMemo(() => {
    const v = ordering.deliveryFeeTiers;
    if (!Array.isArray(v)) return [];
    return v
      .filter((t) => t && typeof t === 'object')
      .slice(0, DELIVERY_FEE_TIERS_MAX)
      .map((t) => ({
        upToKm: typeof t.upToKm === 'number' && Number.isFinite(t.upToKm) ? Math.max(0, t.upToKm) : 0,
        fee: typeof t.fee === 'number' && Number.isFinite(t.fee) ? Math.max(0, t.fee) : 0,
      }));
  }, [ordering.deliveryFeeTiers]);
  const tiers = useMemo(() => normalizeDeliveryFeeTiers(rawTiers), [rawTiers]);
  const mode = ordering.deliveryFeeMode === 'distance' && rawTiers.length > 0 ? 'distance' : 'flat';
  const rawIncomplete = rawTiers.some((t) => t.upToKm < DELIVERY_FEE_UPTO_MIN_KM);
  const restCoords = parseMapUrlCoords(mapUrl);
  const [simKm, setSimKm] = useState(3);

  const simQuote = useMemo(
    () => resolveDeliveryFee({ ...ordering, deliveryFeeMode: 'distance', deliveryFeeTiers: tiers }, simKm, 0),
    [ordering, tiers, simKm],
  );

  const setTier = (idx: number, patch: { upToKm?: number; fee?: number }) => {
    onUpdate((prev) => {
      const cur = Array.isArray(prev.deliveryFeeTiers) ? prev.deliveryFeeTiers : [];
      const rows = cur
        .filter((t) => t && typeof t === 'object')
        .slice(0, DELIVERY_FEE_TIERS_MAX)
        .map((t) => ({
          upToKm: typeof t.upToKm === 'number' && Number.isFinite(t.upToKm) ? Math.max(0, t.upToKm) : 0,
          fee: typeof t.fee === 'number' && Number.isFinite(t.fee) ? Math.max(0, t.fee) : 0,
        }));
      // No sorting while editing: rows stay where the admin put them so
      // focus never jumps; the resolver/preview normalize (sort) on read.
      const next = rows.map((t, i) => (i === idx ? { ...t, ...patch } : t));
      return { ...prev, deliveryFeeTiers: next };
    });
  };

  const addTier = () => {
    onUpdate((prev) => {
      const cur = Array.isArray(prev.deliveryFeeTiers) ? prev.deliveryFeeTiers.filter((t) => t && typeof t === 'object') : [];
      if (cur.length >= DELIVERY_FEE_TIERS_MAX) return prev;
      const last = cur.length ? cur[cur.length - 1] : null;
      const lastUp = last && typeof last.upToKm === 'number' && Number.isFinite(last.upToKm) ? last.upToKm : 0;
      const lastFee = last && typeof last.fee === 'number' && Number.isFinite(last.fee) ? Math.max(0, last.fee) : Number(prev.deliveryFee) || 0;
      return {
        ...prev,
        deliveryFeeMode: 'distance',
        deliveryFeeTiers: [...cur, { upToKm: Math.round((lastUp + 2) * 10) / 10, fee: lastFee }],
      };
    });
  };

  const removeTier = (idx: number) => {
    onUpdate((prev) => {
      const cur = Array.isArray(prev.deliveryFeeTiers) ? prev.deliveryFeeTiers.filter((t) => t && typeof t === 'object') : [];
      const next = cur.filter((_, i) => i !== idx);
      return { ...prev, deliveryFeeTiers: next, deliveryFeeMode: next.length ? 'distance' : 'flat' };
    });
  };

  const fillExample = () => {
    const base = Number(ordering.deliveryFee) || 0;
    const step = (mult: number) => Math.round(base * mult * 100) / 100;
    onUpdate((prev) => ({
      ...prev,
      deliveryFeeMode: 'distance',
      deliveryFeeTiers: [
        { upToKm: 2, fee: base },
        { upToKm: 5, fee: step(1.5) },
        { upToKm: 10, fee: step(2) },
      ],
    }));
  };

  const switchMode = (m: 'flat' | 'distance') => {
    onUpdate((prev) => {
      if (m === 'flat') return { ...prev, deliveryFeeMode: 'flat' };
      const hasRows = Array.isArray(prev.deliveryFeeTiers) && prev.deliveryFeeTiers.some((t) => t && typeof t === 'object');
      if (!hasRows) {
        const base = Number(prev.deliveryFee) || 0;
        return {
          ...prev,
          deliveryFeeMode: 'distance',
          deliveryFeeTiers: [
            { upToKm: 2, fee: base },
            { upToKm: 5, fee: Math.round(base * 1.5 * 100) / 100 },
            { upToKm: 10, fee: Math.round(base * 2 * 100) / 100 },
          ],
        };
      }
      return { ...prev, deliveryFeeMode: 'distance' };
    });
  };

  return (
    <div className="rounded-xl border border-neutral-800 bg-black/40 p-3 space-y-3">
      {/* Master switch */}
      <button
        type="button"
        role="switch"
        aria-checked={!!ordering.deliveryFeeEnabled}
        onClick={() => onUpdate((prev) => ({ ...prev, deliveryFeeEnabled: !prev.deliveryFeeEnabled }))}
        className="w-full flex items-center justify-between gap-3 text-start min-h-[44px] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
      >
        <span>
          <span className="block text-xs font-bold">
            {isAr ? 'تفعيل رسوم التوصيل' : 'Enable delivery fee'}
          </span>
          <span className="block text-[11px] text-neutral-500 mt-0.5">
            {ordering.deliveryFeeEnabled
              ? (isAr ? 'مفعّلة — تظهر في السلة' : 'On — shown in the cart')
              : (isAr ? 'مطفأة (الافتراضي)' : 'Off (default)')}
          </span>
        </span>
        <span className={`relative w-11 h-6 flex-shrink-0 rounded-full transition-colors duration-200 ${ordering.deliveryFeeEnabled ? 'bg-[var(--primary)]' : 'bg-neutral-700'}`}>
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${ordering.deliveryFeeEnabled ? (isAr ? 'left-0.5' : 'left-5') : (isAr ? 'left-5' : 'left-0.5')}`} />
        </span>
      </button>

      {ordering.deliveryFeeEnabled && (
        <div className="anim-fade-in space-y-3">
          {/* Mode segmented control */}
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={isAr ? 'طريقة الحساب' : 'Pricing model'}>
            {(['flat', 'distance'] as const).map((m) => {
              const active = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => switchMode(m)}
                  className={`min-h-[48px] rounded-xl border px-3 py-2 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                    active ? 'border-[var(--primary)] bg-[var(--primary)]/10' : 'border-neutral-700 bg-black hover:border-neutral-500'
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-xs font-black">
                    {m === 'distance' && <Sparkles size={13} className={active ? 'text-[var(--primary)]' : 'text-neutral-500'} />}
                    {m === 'flat' ? (isAr ? 'رسوم ثابتة' : 'Flat fee') : (isAr ? 'حسب المسافة' : 'By distance')}
                  </span>
                  <span className="block text-[10px] text-neutral-500 mt-0.5">
                    {m === 'flat'
                      ? (isAr ? 'سعر واحد للجميع' : 'One fee for everyone')
                      : (isAr ? 'شرائح ذكية من موقع المطعم' : 'Smart tiers from your location')}
                  </span>
                </button>
              );
            })}
          </div>

          {mode === 'flat' ? (
            <div>
              <label className="block text-xs text-neutral-400 mb-1">{isAr ? `رسوم التوصيل (${currency})` : `Delivery Fee (${currency})`}</label>
              <NumField
                value={ordering.deliveryFee}
                onChange={(n) => onUpdate((prev) => ({ ...prev, deliveryFee: n }))}
                placeholder="0"
                ariaLabel={isAr ? `رسوم التوصيل (${currency})` : `Delivery Fee (${currency})`}
              />
            </div>
          ) : (
            <div className="space-y-3">
              {/* Restaurant anchor status — the single source of every distance */}
              <div className={`rounded-xl border px-3 py-2.5 flex items-start gap-2.5 ${restCoords ? 'border-green-500/30 bg-green-500/5' : 'border-amber-500/40 bg-amber-500/10'}`}>
                <MapPin size={16} className={`mt-0.5 shrink-0 ${restCoords ? 'text-green-400' : 'text-amber-400'}`} />
                <div className="min-w-0 flex-1">
                  {restCoords ? (
                    <>
                      <p className="text-[11px] font-bold text-green-400">
                        {isAr ? 'موقع المطعم محدد ✓ — كل المسافات تُحسب من هنا' : 'Restaurant located ✓ — all distances measured from here'}
                      </p>
                      <p className="text-[11px] text-neutral-400 tabular-nums mt-0.5" dir="ltr">
                        {restCoords.lat.toFixed(5)}, {restCoords.lng.toFixed(5)}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-[11px] font-bold text-amber-400">
                        {isAr ? 'موقع المطعم غير محدد — الشرائح لن تعمل بدقة' : 'Restaurant location missing — tiers need it'}
                      </p>
                      <p className="text-[10px] text-neutral-400 mt-0.5">
                        {isAr
                          ? 'الصق رابط خرائط كاملًا فيه إحداثيات في خانة موقع العمل، أو حدده على الخريطة.'
                          : 'Paste a full Maps link with coordinates in Work Location, or pin it on the map.'}
                      </p>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onPickRestaurant}
                  className="shrink-0 h-9 px-3 rounded-full border border-[var(--primary)]/50 text-[var(--primary)] text-[11px] font-extrabold hover:bg-[var(--primary)] hover:text-[#0A0A0A] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] inline-flex items-center gap-1"
                >
                  <Navigation size={12} />
                  {isAr ? 'الخريطة' : 'Map'}
                </button>
              </div>

              {/* Tiers editor (raw rows: clearing a field never deletes its row) */}
              {rawTiers.length === 0 ? (
                <button
                  type="button"
                  onClick={fillExample}
                  className="w-full min-h-[48px] rounded-xl border border-dashed border-[var(--primary)]/50 text-[var(--primary)] text-xs font-extrabold hover:bg-[var(--primary)]/10 transition-colors px-3 py-2"
                >
                  {isAr ? '＋ ابدأ بمثال جاهز (2 / 5 / 10 كم)' : '+ Start from an example (2 / 5 / 10 km)'}
                </button>
              ) : (
                <div className="space-y-2">
                  {rawTiers.map((t, i) => (
                    <div key={`tier-${i}`} className="rounded-xl border border-neutral-800 bg-black px-2.5 py-2 space-y-2 sm:space-y-0 sm:flex sm:items-center sm:gap-2">
                      <div className="flex items-center gap-2 sm:contents">
                        <span className="shrink-0 w-6 h-6 rounded-full bg-[var(--primary)]/15 text-[var(--primary)] text-[11px] font-black flex items-center justify-center tabular-nums">
                          {i + 1}
                        </span>
                        <span className="text-[11px] text-neutral-400 shrink-0">{isAr ? 'حتى' : 'Up to'}</span>
                        <NumField
                          value={t.upToKm}
                          onChange={(n) => setTier(i, { upToKm: Math.round(n * 10) / 10 })}
                          placeholder={isAr ? 'كم؟' : 'km'}
                          ariaLabel={isAr ? `الشريحة ${i + 1}: حتى كم` : `Tier ${i + 1}: up to km`}
                          max={2000}
                          className="h-10 px-2 rounded-lg bg-neutral-900 border border-neutral-700 text-sm tabular-nums focus:border-[var(--primary)] flex-1 min-w-0 sm:flex-none sm:w-20"
                        />
                        <span className="text-[11px] text-neutral-400 shrink-0">{isAr ? 'كم' : 'km'}</span>
                      </div>
                      <div className="flex items-center gap-2 sm:contents">
                        <span className="text-[11px] text-neutral-400 shrink-0 sm:hidden">{isAr ? 'الرسوم:' : 'Fee:'}</span>
                        <NumField
                          value={t.fee}
                          onChange={(n) => setTier(i, { fee: n })}
                          placeholder="0"
                          ariaLabel={isAr ? `الشريحة ${i + 1}: الرسوم` : `Tier ${i + 1}: fee`}
                          className="h-10 px-2 rounded-lg bg-neutral-900 border border-neutral-700 text-sm tabular-nums focus:border-[var(--primary)] flex-1 min-w-0"
                        />
                        <span className="text-[10px] text-neutral-500 shrink-0 hidden sm:inline">{currency}</span>
                        <button
                          type="button"
                          onClick={() => removeTier(i)}
                          aria-label={isAr ? `حذف الشريحة ${i + 1}` : `Delete tier ${i + 1}`}
                          className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-neutral-500 hover:text-red-400 hover:bg-red-500/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={addTier}
                      disabled={rawTiers.length >= DELIVERY_FEE_TIERS_MAX}
                      className="flex-1 min-h-[44px] rounded-xl border border-neutral-700 text-neutral-300 text-xs font-bold hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed px-3"
                    >
                      <Plus size={14} />
                      {isAr ? `إضافة شريحة (${rawTiers.length}/${DELIVERY_FEE_TIERS_MAX})` : `Add tier (${rawTiers.length}/${DELIVERY_FEE_TIERS_MAX})`}
                    </button>
                    <button
                      type="button"
                      onClick={fillExample}
                      className="h-[44px] px-3 rounded-xl text-[11px] font-bold text-neutral-500 hover:text-[var(--primary)] transition-colors"
                    >
                      {isAr ? '↻ مثال' : '↻ Example'}
                    </button>
                  </div>
                  {rawIncomplete && (
                    <p className="text-[11px] text-amber-400" dir={isAr ? 'rtl' : 'ltr'}>
                      {isAr
                        ? 'شريحة ناقصة: المسافة 0.1 كم على الأقل — أكملها قبل الحفظ.'
                        : 'An unfinished tier needs at least 0.1 km — complete it before saving.'}
                    </p>
                  )}
                </div>
              )}

              {/* Live preview table */}
              {tiers.length > 0 && (
                <div className="rounded-xl border border-neutral-800 overflow-hidden">
                  <div className="px-3 py-2 bg-neutral-900 text-[10px] font-black text-neutral-400 uppercase tracking-wide">
                    {isAr ? 'معاينة حية — ماذا سيدفع الزبون؟' : 'Live preview — what will customers pay?'}
                  </div>
                  {tiers.map((t, i) => (
                    <div key={`pv-${i}`} className={`flex items-center justify-between px-3 py-1.5 text-[11px] ${i % 2 ? 'bg-black' : 'bg-neutral-900/50'}`}>
                      <span className="text-neutral-300">{tierRangeLabel(tiers, i, lang)}</span>
                      <span className="font-black tabular-nums text-white" dir="ltr">
                        {t.fee} <span className="font-normal text-neutral-500">{currency}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Distance simulator */}
              {tiers.length > 0 && (
                <div className="rounded-xl border border-[var(--primary)]/25 bg-[var(--primary)]/5 px-3 py-2.5 space-y-2">
                  <label className="block text-[11px] font-bold text-neutral-300">
                    {isAr ? 'جرّب: لو الزبون على بعد…' : 'Try it: if the customer is…'}
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0.5}
                      max={20}
                      step={0.5}
                      value={simKm}
                      onChange={(e) => setSimKm(Number(e.target.value))}
                      className="flex-1 accent-[#FFC400]"
                      aria-label={isAr ? 'مسافة التجربة بالكيلومتر' : 'Simulated distance in km'}
                    />
                    <span className="shrink-0 text-sm font-black tabular-nums text-white" dir="ltr">
                      {simKm.toFixed(1)} {isAr ? 'كم' : 'km'}
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-300">
                    {isAr ? 'سيدفع: ' : 'They pay: '}
                    <b className="text-[var(--primary)] tabular-nums" dir="ltr">
                      {simQuote.fee} {currency}
                    </b>
                    {simQuote.tierIndex >= 0 && (
                      <span className="text-neutral-500"> · {tierRangeLabel(tiers, simQuote.tierIndex, lang)}</span>
                    )}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Free delivery threshold (both modes) */}
          <div className="rounded-xl border border-neutral-800 bg-black px-3 py-2.5">
            <button
              type="button"
              role="switch"
              aria-checked={!!ordering.freeDeliveryEnabled}
              onClick={() => onUpdate((prev) => ({ ...prev, freeDeliveryEnabled: !prev.freeDeliveryEnabled }))}
              className="w-full flex items-center justify-between gap-3 text-start min-h-[40px] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            >
              <span>
                <span className="block text-xs font-bold">{isAr ? 'توصيل مجاني فوق مبلغ' : 'Free delivery over amount'}</span>
                <span className="block text-[10px] text-neutral-500 mt-0.5">
                  {isAr ? 'حافز لرفع متوسط السلة — يعمل مع الثابتة والمسافة' : 'Boosts basket size — works with flat & distance'}
                </span>
              </span>
              <span className="relative w-10 flex-shrink-0 rounded-full transition-colors duration-200 h-[22px] bg-neutral-700 data-[on=true]:bg-[var(--primary)]" data-on={!!ordering.freeDeliveryEnabled}>
                <span className={`absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-all duration-200 ${ordering.freeDeliveryEnabled ? (isAr ? 'left-0.5' : 'left-[18px]') : (isAr ? 'left-[18px]' : 'left-0.5')}`} />
              </span>
            </button>
            {ordering.freeDeliveryEnabled && (
              <div className="anim-fade-in mt-2">
                <label className="block text-xs text-neutral-400 mb-1">{isAr ? `الطلبات فوق (${currency}) توصيلها مجاني` : `Orders over (${currency}) deliver free`}</label>
                <NumField
                  value={ordering.freeDeliveryMin ?? 0}
                  onChange={(n) => onUpdate((prev) => ({ ...prev, freeDeliveryMin: n }))}
                  placeholder="0"
                  ariaLabel={isAr ? `الطلبات فوق (${currency}) توصيلها مجاني` : `Orders over (${currency}) deliver free`}
                  className="w-full h-11 min-h-[44px] px-3 rounded-lg bg-neutral-900 border border-neutral-700 text-base tabular-nums focus:border-[var(--primary)]"
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
