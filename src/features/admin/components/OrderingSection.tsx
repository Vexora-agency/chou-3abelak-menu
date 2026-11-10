import React from 'react';
import type { MenuSettings } from '@/src/types/menu';
import { applyDraftPause } from '@/src/utils/ordering';
import type { AdminFetch } from '@/src/lib/api-client';
import { OnlineOrderingSwitch } from './admin/OnlineOrderingSwitch';
import { SettingsGroupBody, SettingsGroupHeader } from './SettingsCollapsible';

type Ordering = MenuSettings['ordering'];

interface OrderingSectionProps {
  ordering: Ordering;
  currency: string;
  lang: 'en' | 'ar';
  whatsapp: string;
  adminFetch: AdminFetch;
  onMenuRefreshed: () => Promise<boolean>;
  onUpdate: (updater: (prev: Ordering) => Ordering) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

/** Ordering System card of the admin Settings tab. */
export const OrderingSection: React.FC<OrderingSectionProps> = ({
  ordering,
  currency,
  lang,
  whatsapp,
  adminFetch,
  onMenuRefreshed,
  onUpdate,
  collapsed = false,
  onToggleCollapse,
}) => {
  const isAr = lang === 'ar';
  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800">
      <SettingsGroupHeader
        title={isAr ? 'إعدادات الطلبات' : 'Ordering System'}
        subtitle={isAr ? 'التوصيل فقط — فعّل الحد الأدنى أو رسوم التوصيل أدناه' : 'Delivery only — enable a minimum order or a delivery fee below'}
        lang={lang}
        collapsed={collapsed}
        onToggle={() => onToggleCollapse?.()}
      />
      <SettingsGroupBody open={!collapsed}>
      {/* Master switch first: nothing below accepts orders while it is off */}
      <OnlineOrderingSwitch
        lang={lang}
        enabled={ordering.enabled === true}
        whatsapp={whatsapp}
        adminFetch={adminFetch}
        onMenuRefreshed={onMenuRefreshed}
      />

      {/* Min Order toggle + value */}
      <div className="rounded-xl border border-neutral-800 bg-black/40 p-3 space-y-3">
        <button
          type="button"
          role="switch"
          aria-checked={!!ordering.minOrderEnabled}
          onClick={() => onUpdate((prev) => ({ ...prev, minOrderEnabled: !prev.minOrderEnabled }))}
          className="w-full flex items-center justify-between gap-3 text-start min-h-[44px] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          <span>
            <span className="block text-xs font-bold">
              {isAr ? 'تفعيل الحد الأدنى للطلب' : 'Enable minimum order'}
            </span>
            <span className="block text-[11px] text-neutral-500 mt-0.5">
              {ordering.minOrderEnabled
                ? (isAr ? 'مفعّل — يظهر في السلة' : 'On — shown in the cart')
                : (isAr ? 'مطفأ (الافتراضي)' : 'Off (default)')}
            </span>
          </span>
          <span
            className={`relative w-11 h-6 flex-shrink-0 rounded-full transition-colors duration-200 ${
              ordering.minOrderEnabled ? 'bg-[var(--primary)]' : 'bg-neutral-700'
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${
                ordering.minOrderEnabled
                  ? (isAr ? 'left-0.5' : 'left-5')
                  : (isAr ? 'left-5' : 'left-0.5')
              }`}
            />
          </span>
        </button>
        {ordering.minOrderEnabled && (
          <div className="anim-fade-in">
            <label className="block text-xs text-neutral-400 mb-1">{isAr ? `الحد الأدنى للطلب (${currency})` : `Min Order (${currency})`}</label>
            <input
              type="number"
              step="any"
              value={ordering.minOrder}
              onChange={(e) => onUpdate((prev) => ({ ...prev, minOrder: Number(e.target.value) }))}
              className="w-full h-11 min-h-[44px] px-3 rounded-lg bg-black border border-neutral-700 text-base tabular-nums focus:border-[var(--primary)]"
            />
          </div>
        )}
      </div>

      {/* Delivery Fee toggle + value */}
      <div className="rounded-xl border border-neutral-800 bg-black/40 p-3 space-y-3">
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
          <span
            className={`relative w-11 h-6 flex-shrink-0 rounded-full transition-colors duration-200 ${
              ordering.deliveryFeeEnabled ? 'bg-[var(--primary)]' : 'bg-neutral-700'
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${
                ordering.deliveryFeeEnabled
                  ? (isAr ? 'left-0.5' : 'left-5')
                  : (isAr ? 'left-5' : 'left-0.5')
              }`}
            />
          </span>
        </button>
        {ordering.deliveryFeeEnabled && (
          <div className="anim-fade-in">
            <label className="block text-xs text-neutral-400 mb-1">{isAr ? `رسوم التوصيل (${currency})` : `Delivery Fee (${currency})`}</label>
            <input
              type="number"
              step="any"
              value={ordering.deliveryFee}
              onChange={(e) => onUpdate((prev) => ({ ...prev, deliveryFee: Number(e.target.value) }))}
              className="w-full h-11 min-h-[44px] px-3 rounded-lg bg-black border border-neutral-700 text-base tabular-nums focus:border-[var(--primary)]"
            />
          </div>
        )}
      </div>

      {/* Smart ETA tuning: 3 numbers only — courier speed, road factor and
          the receive window are fixed researched constants (not owner
          inputs), and the "received" button unlocks automatically 5 minutes
          after the computed arrival. */}
      <div className="rounded-xl border border-neutral-800 bg-black/40 p-3 space-y-3">
        <div>
          <p className="block text-xs font-bold">{isAr ? 'تقدير التوصيل الذكي' : 'Smart delivery estimate'}</p>
          <p className="block text-[11px] text-neutral-500 mt-0.5">
            {isAr ? 'مضبوطة وجاهزة — القيم الافتراضية تناسب معظم المطاعم. زر "استلمت" يفتح تلقائيًا بعد 5 دقائق من الوقت المتوقع.' : 'Pre-tuned and ready — defaults fit most restaurants. The Received button unlocks automatically 5 minutes after the ETA.'}
          </p>
        </div>
        <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'تحضير أساسي (د)' : 'Base prep (min)'}</label>
            <input
              type="number"
              step="any"
              min={0}
              max={180}
              value={ordering.prepMinutes}
              onChange={(e) => onUpdate((prev) => ({ ...prev, prepMinutes: Number(e.target.value) }))}
              className="w-full h-11 min-h-[44px] px-3 rounded-lg bg-black border border-neutral-700 text-base tabular-nums focus:border-[var(--primary)]"
            />
            <p className="text-[10px] text-neutral-500 mt-1">{isAr ? 'وقت ثابت يُضاف لتجهيز أي طلب.' : 'Fixed time added to prepare any order.'}</p>
          </div>
          <div>
            <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'دقائق التحضير / طلب' : 'Prep min / order'}</label>
            <input
              type="number"
              step="any"
              min={0}
              max={180}
              value={ordering.kitchenMinutesPerOrder}
              onChange={(e) => onUpdate((prev) => ({ ...prev, kitchenMinutesPerOrder: Number(e.target.value) }))}
              className="w-full h-11 min-h-[44px] px-3 rounded-lg bg-black border border-neutral-700 text-base tabular-nums focus:border-[var(--primary)]"
            />
            <p className="text-[10px] text-neutral-500 mt-1">{isAr ? 'تُضاف عن كل طلب قبله في طابور المطبخ.' : 'Added for each order ahead in the kitchen queue.'}</p>
          </div>
          <div className="min-[380px]:col-span-2">
            <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'توصيل احتياطي (د)' : 'Fallback delivery (min)'}</label>
            <input
              type="number"
              step="any"
              min={0}
              max={180}
              value={ordering.defaultDeliveryMinutes}
              onChange={(e) => onUpdate((prev) => ({ ...prev, defaultDeliveryMinutes: Number(e.target.value) }))}
              className="w-full h-11 min-h-[44px] px-3 rounded-lg bg-black border border-neutral-700 text-base tabular-nums focus:border-[var(--primary)]"
            />
            <p className="text-[10px] text-neutral-500 mt-1">{isAr ? 'يُستخدم عند غياب موقع دقيق للزبون.' : 'Used when the customer has no precise location.'}</p>
          </div>
          <div className="min-[380px]:col-span-2">
            <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'نافذة الإلغاء (د)' : 'Cancel window (min)'}</label>
            <input
              type="number"
              step={1}
              min={1}
              max={30}
              value={ordering.cancelWindowMin ?? 5}
              onChange={(e) => onUpdate((prev) => ({ ...prev, cancelWindowMin: Number(e.target.value) }))}
              className="w-full h-11 min-h-[44px] px-3 rounded-lg bg-black border border-neutral-700 text-base tabular-nums focus:border-[var(--primary)]"
            />
            <p className="text-[10px] text-neutral-500 mt-1">{isAr ? 'مهلة إلغاء الزبون وفترة سماح المطبخ (1–30 دقيقة). الصفر أو الفراغ = 5.' : 'Customer cancel + kitchen grace window (1–30 min). Zero or blank = 5.'}</p>
          </div>
        </div>
      </div>

      {/* Pause orders switch */}
      <div className="rounded-xl border border-neutral-800 bg-black/40 p-3 space-y-3">
        <button
          type="button"
          role="switch"
          aria-checked={!!ordering.paused}
          onClick={() => onUpdate((prev) => applyDraftPause(prev, !prev.paused, new Date().toISOString()))}
          className="w-full flex items-center justify-between gap-3 text-start min-h-[44px] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          <span>
            <span className="block text-xs font-bold">
              {isAr ? 'إيقاف استقبال الطلبات' : 'Pause orders'}
            </span>
            <span className="block text-[11px] text-neutral-500 mt-0.5">
              {ordering.paused
                ? (isAr ? 'متوقف — لن تصل طلبات جديدة' : 'Paused — no new orders')
                : (isAr ? 'يستقبل الطلبات' : 'Accepting orders')}
            </span>
            <span className="block text-[10px] text-neutral-600 mt-0.5">
              {isAr ? 'يُطبق عند الحفظ (تلقائي خلال ثانية تقريبًا)' : 'Applies on save (autosaves in ~1s)'}
            </span>
          </span>
          <span
            className={`relative w-11 h-6 flex-shrink-0 rounded-full transition-colors duration-200 ${
              ordering.paused ? 'bg-orange-500' : 'bg-neutral-700'
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${
                ordering.paused
                  ? (isAr ? 'left-0.5' : 'left-5')
                  : (isAr ? 'left-5' : 'left-0.5')
              }`}
            />
          </span>
        </button>
        {ordering.paused && (
          <div className="anim-fade-in space-y-3">
            <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'رسالة الإيقاف (EN)' : 'Pause message (EN)'}</label>
                <input
                  type="text"
                  value={ordering.pausedMessage.en}
                  maxLength={160}
                  onChange={(e) => onUpdate((prev) => ({ ...prev, pausedMessage: { ...prev.pausedMessage, en: e.target.value } }))}
                  placeholder="We are not taking orders right now…"
                  className="w-full h-11 min-h-[44px] px-3 rounded-lg bg-black border border-neutral-700 text-base focus:border-[var(--primary)]"
                />
              </div>
              <div>
                <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'رسالة الإيقاف (AR)' : 'Pause message (AR)'}</label>
                <input
                  type="text"
                  dir="rtl"
                  value={ordering.pausedMessage.ar}
                  maxLength={160}
                  onChange={(e) => onUpdate((prev) => ({ ...prev, pausedMessage: { ...prev.pausedMessage, ar: e.target.value } }))}
                  placeholder="لا نستقبل الطلبات حالياً…"
                  className="w-full h-11 min-h-[44px] px-3 rounded-lg bg-black border border-neutral-700 text-base focus:border-[var(--primary)]"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Accept orders when closed */}
      <div className="rounded-xl border border-neutral-800 bg-black/40 p-3">
        <button
          type="button"
          role="switch"
          aria-checked={!!ordering.acceptWhenClosed}
          onClick={() => onUpdate((prev) => ({ ...prev, acceptWhenClosed: !prev.acceptWhenClosed }))}
          className="w-full flex items-center justify-between gap-3 text-start min-h-[44px] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          <span>
            <span className="block text-xs font-bold">
              {isAr ? 'قبول الطلبات خارج الدوام' : 'Accept orders when closed'}
            </span>
            <span className="block text-[11px] text-neutral-500 mt-0.5">
              {isAr ? 'يسمح بالطلب أثناء الإغلاق (الحالة تظهر مغلق)' : 'Allows ordering outside hours (still shown as closed)'}
            </span>
          </span>
          <span
            className={`relative w-11 h-6 flex-shrink-0 rounded-full transition-colors duration-200 ${
              ordering.acceptWhenClosed ? 'bg-[var(--primary)]' : 'bg-neutral-700'
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${
                ordering.acceptWhenClosed
                  ? (isAr ? 'left-0.5' : 'left-5')
                  : (isAr ? 'left-5' : 'left-0.5')
              }`}
            />
          </span>
        </button>
      </div>
      </SettingsGroupBody>
    </div>
  );
};
