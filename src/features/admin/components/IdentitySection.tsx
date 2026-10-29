import React from 'react';
import type { MenuSettings } from '@/src/types/menu';
import { DIAL_CODES, OTHER_ISO, composeFull, splitDialCode } from '@/src/config/dialCodes';
import { normalizeMapLocation, parseMapUrlCoords } from '@/src/utils/menuHelpers';
import { CountryCodePicker } from './CountryCodePicker';

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
  // WhatsApp picker (Google-style): country combo + national number input.
  // Stored value stays a single full-international digit string, so every
  // consumer (validation, wa.me links, dashboard) works unchanged.
  const waSplit = splitDialCode(whatsapp);
  const setWa = (iso: string, national: string) => {
    const entry = DIAL_CODES.find((c) => c.iso === iso);
    onUpdate((prev) => ({ ...prev, whatsapp: composeFull(entry ? entry.code : '', national) }));
  };
  const waComposed = (whatsapp || '').replace(/\D/g, '');
  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4">
      <h2 className="text-sm font-extrabold text-[var(--primary)] uppercase tracking-wider">
        {isAr ? 'بيانات المطعم' : 'Restaurant Identity'}
      </h2>

      <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
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

      <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-neutral-400 mb-1">Tagline (EN)</label>
          <input
            type="text"
            value={tagline.en}
            onChange={(e) => onUpdate((prev) => ({ ...prev, tagline: { ...prev.tagline, en: e.target.value } }))}
            className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)]"
          />
          <p className="text-[10px] text-neutral-500 mt-1">{isAr ? 'فارغ = الافتراضي' : 'Empty = house default'}</p>
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
          <label className="block text-xs text-neutral-400 mb-1">About / Footer Description (EN)</label>
          <textarea
            rows={2}
            value={about.en}
            onChange={(e) => onUpdate((prev) => ({ ...prev, about: { ...prev.about, en: e.target.value } }))}
            className="w-full px-3 py-2 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)]"
          />
          <p className="text-[10px] text-neutral-500 mt-1">{isAr ? 'فارغ = الوصف الافتراضي' : 'Empty = house default'}</p>
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

      <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
        {/* Phone takes the full row: side-by-side would squeeze the picker below. */}
        <div className="col-span-2">
          <label className="block text-xs text-neutral-400 mb-1">Phone</label>
          <input
            type="text"
            dir="ltr"
            value={phone}
            onChange={(e) => onUpdate((prev) => ({ ...prev, phone: e.target.value }))}
            className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)]"
          />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-neutral-400 mb-1">WhatsApp number</label>
          <div className="flex gap-2" dir="ltr">
            <CountryCodePicker
              value={waSplit.iso}
              onChange={(iso) => setWa(iso, waSplit.national)}
              lang={lang}
            />
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={waSplit.national}
              onChange={(e) => setWa(waSplit.iso, e.target.value)}
              placeholder={waSplit.iso === OTHER_ISO ? '96170123456' : '70 123 456'}
              aria-label="WhatsApp number without country code"
              dir="ltr"
              className="flex-1 min-w-0 h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)]"
            />
          </div>
          <p className="text-[11px] text-neutral-500 mt-1" dir="ltr">
            {waComposed
              ? <>Stored international: <b className="text-neutral-300 tabular-nums">+{waComposed}</b></>
              : (isAr ? 'اختر الدولة ثم اكتب الرقم المحلي.' : 'Pick the country, then type the local number.')}
          </p>
        </div>
      </div>

      <div>
          <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'موقع العمل' : 'Work Location'}</label>
          <input
            type="text"
            dir="ltr"
            value={mapUrl}
          onChange={(e) => onUpdate((prev) => ({ ...prev, mapUrl: e.target.value }))}
          placeholder="maps.app.goo.gl/… · 33.89, 35.50 · Hamra, Beirut"
          className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)] placeholder:text-neutral-600"
        />
        <p className="text-[11px] text-neutral-500 mt-1" dir={isAr ? 'rtl' : 'ltr'}>
          {(() => {
            const loc = normalizeMapLocation(mapUrl);
            if (loc.kind === 'empty') {
              return isAr
                ? 'الصق رابط خرائط جوجل بأي شكل، أو إحداثيات، أو اسم المكان.'
                : 'Paste any Google Maps link, coordinates, or a place name.';
            }
            if (loc.kind === 'coords') {
              const c = parseMapUrlCoords(mapUrl);
              const label = c ? `${c.lat}, ${c.lng}` : '';
              return isAr
                ? <>إحداثيات معتمدة: <b className="text-neutral-300 tabular-nums" dir="ltr">{label}</b> — تُستخدم للرابط والمسافة.</>
                : <>Recognized coordinates: <b className="text-neutral-300 tabular-nums">{label}</b> — used for the link and distance.</>;
            }
            if (loc.kind === 'search') {
              return isAr
                ? 'سيُحفظ كبحث خرائط عن هذا الاسم (الرابط يعمل، بدون مسافة).'
                : 'Will be saved as a Maps search for this name (link works, no distance).';
            }
            return isAr
              ? 'رابط مباشر معتمد — زر الموقع في الموقع يفتحه.'
              : 'Direct link recognized — the site Map button opens it.';
          })()}
        </p>
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
