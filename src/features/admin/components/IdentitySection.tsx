import React, { useState } from 'react';
import type { MenuSettings } from '@/src/types/menu';
import { DIAL_CODES, OTHER_ISO, composeFull, splitDialCode } from '@/src/config/dialCodes';
import { normalizeMapLocation, parseMapUrlCoords } from '@/src/utils/menuHelpers';
import { CountryCodePicker } from './CountryCodePicker';

type IdentityValues = Pick<
  MenuSettings,
  'name' | 'tagline' | 'about' | 'phone' | 'whatsapp' | 'mapUrl' | 'address' | 'currency'
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
  address,
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
  // Text address shown in the footer (Store Information). Resolvable from
  // the work location above: one on-demand lookup fills both languages.
  const addr = address || { en: '', ar: '' };
  const locCoords = parseMapUrlCoords(mapUrl);
  const [geoState, setGeoState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  // Written-address fields stay hidden until there is something to show:
  // existing saved text, a fresh fetch, or the manual toggle.
  const [addrOpen, setAddrOpen] = useState(!!(addr.en.trim() || addr.ar.trim()));
  // Machine-translate an English address to Arabic (free endpoints, best
  // effort — the owner reviews the result). Used only when Nominatim has
  // no Arabic name (e.g. London returns English for accept-language=ar).
  const toArabic = async (text: string): Promise<string> => {
    const t = (text || '').trim();
    if (!t) return '';
    if (/[\u0600-\u06FF]/.test(t)) return t;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(
        `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ar&dt=t&q=${encodeURIComponent(t)}`,
        { signal: ctrl.signal }
      );
      clearTimeout(timer);
      if (r.ok) {
        const j: unknown = await r.json();
        const parts = Array.isArray(j) && Array.isArray(j[0]) ? (j[0] as unknown[]) : [];
        const out = parts
          .map((s) => (Array.isArray(s) && typeof s[0] === 'string' ? (s[0] as string) : ''))
          .join('')
          .trim();
        if (out) return out;
      }
    } catch {}
    try {
      const r2 = await fetch(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(t)}&langpair=en|ar`
      );
      if (r2.ok) {
        const j2 = (await r2.json()) as { responseData?: { translatedText?: string } };
        const out2 = (j2?.responseData?.translatedText || '').trim();
        if (out2) return out2;
      }
    } catch {}
    return t;
  };
  const fetchAddress = async () => {
    const c = parseMapUrlCoords(mapUrl);
    if (!c) return;
    setGeoState('loading');
    try {
      const one = async (accept: string) => {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${c.lat}&lon=${c.lng}&zoom=18&accept-language=${accept}`
        );
        if (!r.ok) throw new Error('geo');
        const j = await r.json();
        const name = typeof j?.display_name === 'string' ? j.display_name : '';
        // First 3 parts (street → area → city); the full string is too long
        // for a footer line, and the owner can edit freely afterwards.
        return name.split(',').slice(0, 3).join(',').trim();
      };
      const [en, arRaw] = await Promise.all([one('en'), one('ar')]);
      if (!en && !arRaw) throw new Error('geo');
      const ar = await toArabic(arRaw || en);
      if (!en && !ar) throw new Error('geo');
      onUpdate((prev) => ({
        ...prev,
        address: { en: en || prev.address?.en || '', ar: ar || prev.address?.ar || '' },
      }));
      setAddrOpen(true);
      setGeoState('done');
    } catch {
      setGeoState('error');
    }
  };
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
          onChange={(e) => {
            setGeoState('idle');
            onUpdate((prev) => ({ ...prev, mapUrl: e.target.value }));
          }}
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

      {/* Written address = the text line in the footer (Store Information).
          Hidden until fetched or manually opened; type by hand or fetch
          from the work location above (Arabic auto-translated when the
          map has no Arabic name). */}
      <div>
        {!addrOpen ? (
          <div className="flex flex-wrap items-center gap-2">
            {locCoords ? (
              <button
                type="button"
                onClick={fetchAddress}
                disabled={geoState === 'loading'}
                className="h-9 px-4 rounded-full border border-[var(--primary)]/50 text-[var(--primary)] text-xs font-extrabold hover:bg-[var(--primary)] hover:text-[#0A0A0A] transition-colors disabled:opacity-50"
              >
                {geoState === 'loading'
                  ? (isAr ? 'جارٍ جلب العنوان…' : 'Fetching address…')
                  : (isAr ? 'جلب العنوان من الموقع' : 'Fetch address from location')}
              </button>
            ) : (
              <p className="text-[11px] text-neutral-500" dir={isAr ? 'rtl' : 'ltr'}>
                {isAr ? 'ضع رابطًا أو إحداثيات أعلاه لجلب العنوان تلقائيًا.' : 'Put a link or coordinates above to auto-fetch the address.'}
              </p>
            )}
            <button
              type="button"
              onClick={() => setAddrOpen(true)}
              className="h-9 px-4 rounded-full text-xs font-bold text-neutral-400 hover:text-[var(--primary)] transition-colors"
            >
              {isAr ? 'أو اكتبه يدويًا' : 'or write it manually'}
            </button>
            {geoState === 'error' && (
              <span className="text-[11px] text-amber-400">
                {isAr ? 'تعذر الجلب — اكتب العنوان يدويًا.' : 'Could not fetch — type the address manually.'}
              </span>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs text-neutral-400">
                {isAr ? 'العنوان النصي (يظهر في الموقع)' : 'Written Address (shown on site)'}
              </label>
              {locCoords && (
                <button
                  type="button"
                  onClick={fetchAddress}
                  disabled={geoState === 'loading'}
                  className="text-[11px] font-bold text-neutral-500 hover:text-[var(--primary)] transition-colors disabled:opacity-50"
                >
                  {geoState === 'loading'
                    ? (isAr ? 'جارٍ الجلب…' : 'Fetching…')
                    : (isAr ? '↻ إعادة الجلب من الموقع' : '↻ Re-fetch from location')}
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
              <input
                type="text"
                dir="ltr"
                value={addr.en}
                onChange={(e) => onUpdate((prev) => ({ ...prev, address: { en: e.target.value, ar: prev.address?.ar || '' } }))}
                placeholder="Gouraud Street, Mar Mikhael, Beirut"
                className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)] placeholder:text-neutral-600"
              />
              <input
                type="text"
                dir="rtl"
                value={addr.ar}
                onChange={(e) => onUpdate((prev) => ({ ...prev, address: { en: prev.address?.en || '', ar: e.target.value } }))}
                placeholder="شارع غورو، مار مخايل، بيروت"
                className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)] placeholder:text-neutral-600"
              />
            </div>
            {geoState === 'done' && (
              <p className="text-[11px] text-green-400 mt-1" dir={isAr ? 'rtl' : 'ltr'}>
                {isAr
                  ? 'تم ملء العنوان (العربية مترجمة آليًا عند غياب الاسم) — راجعه وعدّله.'
                  : 'Address filled (Arabic auto-translated when missing) — review and edit.'}
              </p>
            )}
            {geoState === 'error' && (
              <p className="text-[11px] text-amber-400 mt-1" dir={isAr ? 'rtl' : 'ltr'}>
                {isAr ? 'تعذر الجلب — اكتب العنوان يدويًا.' : 'Could not fetch — type the address manually.'}
              </p>
            )}
          </>
        )}
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
