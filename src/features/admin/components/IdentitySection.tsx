import React from 'react';
import type { MenuSettings } from '@/src/types/menu';

type IdentityValues = Pick<
  MenuSettings,
  'name' | 'tagline' | 'about' | 'phone' | 'whatsapp' | 'mapUrl' | 'currency'
>;

interface IdentitySectionProps extends IdentityValues {
  lang: 'en' | 'ar';
  onUpdate: (updater: (prev: IdentityValues) => IdentityValues) => void;
}

/** Restaurant Identity card of the admin Settings tab. */
export const IdentitySection: React.FC<IdentitySectionProps> = ({
  name,
  tagline,
  about,
  phone,
  whatsapp,
  mapUrl,
  currency,
  lang,
  onUpdate,
}) => {
  const isAr = lang === 'ar';
  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4">
      <h2 className="text-sm font-extrabold text-[var(--primary)] uppercase tracking-wider">
        {isAr ? 'بيانات المطعم' : 'Restaurant Identity'}
      </h2>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-neutral-400 mb-1">Name (EN)</label>
          <input
            type="text"
            value={name.en}
            onChange={(e) => onUpdate((prev) => ({ ...prev, name: { ...prev.name, en: e.target.value } }))}
            className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)]"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-400 mb-1">الاسم (AR)</label>
          <input
            type="text"
            dir="rtl"
            value={name.ar}
            onChange={(e) => onUpdate((prev) => ({ ...prev, name: { ...prev.name, ar: e.target.value } }))}
            className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)]"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs text-neutral-400">Tagline (EN)</label>
            <span className="text-[10px] text-neutral-500">{isAr ? 'فارغ = الافتراضي' : 'Empty = house default'}</span>
          </div>
          <input
            type="text"
            value={tagline.en}
            onChange={(e) => onUpdate((prev) => ({ ...prev, tagline: { ...prev.tagline, en: e.target.value } }))}
            className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)]"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-400 mb-1">الشعار اللفظي (AR)</label>
          <input
            type="text"
            dir="rtl"
            value={tagline.ar}
            onChange={(e) => onUpdate((prev) => ({ ...prev, tagline: { ...prev.tagline, ar: e.target.value } }))}
            className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)]"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs text-neutral-400">About / Footer Description (EN)</label>
            <span className="text-[10px] text-neutral-500">{isAr ? 'فارغ = الوصف الافتراضي' : 'Empty = house default'}</span>
          </div>
          <textarea
            rows={2}
            value={about.en}
            onChange={(e) => onUpdate((prev) => ({ ...prev, about: { ...prev.about, en: e.target.value } }))}
            className="w-full px-3 py-2 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)]"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-400 mb-1">وصف الفوتر (AR)</label>
          <textarea
            rows={2}
            dir="rtl"
            value={about.ar}
            onChange={(e) => onUpdate((prev) => ({ ...prev, about: { ...prev.about, ar: e.target.value } }))}
            className="w-full px-3 py-2 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)]"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-neutral-400 mb-1">Phone</label>
          <input
            type="text"
            value={phone}
            onChange={(e) => onUpdate((prev) => ({ ...prev, phone: e.target.value }))}
            className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)]"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-400 mb-1">WhatsApp (digits, e.g. 96170123456)</label>
          <input
            type="text"
            value={whatsapp}
            onChange={(e) => onUpdate((prev) => ({ ...prev, whatsapp: e.target.value.replace(/[^0-9]/g, '') }))}
            placeholder="96170123456"
            className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)]"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-neutral-400 mb-1">Google Maps URL</label>
        <input
          type="text"
          value={mapUrl}
          onChange={(e) => onUpdate((prev) => ({ ...prev, mapUrl: e.target.value }))}
          className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)]"
        />
      </div>

      {/* Currency Configuration */}
      <div className="grid grid-cols-2 gap-3 pt-1">
        <div>
          <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'رمز العملة (إنجليزي)' : 'Currency Symbol (EN)'}</label>
          <input
            type="text"
            value={currency.en}
            onChange={(e) => onUpdate((prev) => ({ ...prev, currency: { ...prev.currency, en: e.target.value } }))}
            placeholder="LBP"
            className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)]"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'رمز العملة (عربي)' : 'Currency Symbol (AR)'}</label>
          <input
            type="text"
            value={currency.ar}
            onChange={(e) => onUpdate((prev) => ({ ...prev, currency: { ...prev.currency, ar: e.target.value } }))}
            placeholder="ل.ل"
            className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)]"
          />
        </div>
      </div>
    </div>
  );
};
