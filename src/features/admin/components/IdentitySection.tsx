import React, { useEffect, useRef, useState } from 'react';
import type { MenuSettings } from '@/src/types/menu';
import { DIAL_CODES, OTHER_ISO, composeFull, splitDialCode } from '@/src/config/dialCodes';
import { normalizeMapLocation, parseMapUrlCoords, looksLikeMapInput } from '@/src/utils/menuHelpers';
import { CountryCodePicker } from './CountryCodePicker';
import { SettingsGroupBody, SettingsGroupHeader } from './SettingsCollapsible';

type IdentityValues = Pick<
  MenuSettings,
  'name' | 'tagline' | 'about' | 'phone' | 'whatsapp' | 'mapUrl' | 'address' | 'currency'
>;

interface IdentitySectionProps extends IdentityValues {
  lang: 'en' | 'ar';
  onUpdate: (updater: (prev: IdentityValues) => IdentityValues) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

/** Identity & Contact card of the admin Settings tab. */
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
  collapsed = false,
  onToggleCollapse,
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
  const hasAddr = !!(addr.en.trim() || addr.ar.trim());
  const locCoords = parseMapUrlCoords(mapUrl);
  const [geoState, setGeoState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  // Folded always on mount: a saved address shows as one confirmation line
  // (Edit reopens), empty shows the fetch/manual actions. The fields open
  // only for review (after a fetch) or manual entry.
  const [addrOpen, setAddrOpen] = useState(false);
  // Last coords auto-fetched (mount never fetches — only NEW typing does),
  // and whether the current text came from a fetch (safe to refresh) or
  // from the owner's hand (never overwrite).
  const lastAutoRef = useRef<string | null>(null);
  const autoFilledRef = useRef(false);
  const addrRef = useRef(addr);
  addrRef.current = addr;
  // Machine-translate an English address to Arabic (free endpoints, best
  // effort — the owner reviews the result). Used only when Nominatim has
  // no Arabic name (e.g. London returns English for accept-language=ar).
  // Strict acceptance: a result counts ONLY if it actually contains Arabic
  // script — echoes ("Main Street" → "Main Street") and quota warnings
  // ("MYMEMORY WARNING…") fall through to the next option, never to the UI.
  const ARABIC_RE = /[\u0600-\u06FF]/;
  const toArabic = async (text: string): Promise<string> => {
    const t = (text || '').trim();
    if (!t) return '';
    if (ARABIC_RE.test(t)) return t;
    const withTimeout = async (work: (signal: AbortSignal) => Promise<string>): Promise<string> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        return await work(ctrl.signal);
      } catch {
        return '';
      } finally {
        clearTimeout(timer);
      }
    };
    const google = await withTimeout(async (signal) => {
      const r = await fetch(
        `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ar&dt=t&q=${encodeURIComponent(t)}`,
        { signal }
      );
      if (!r.ok) return '';
      const j: unknown = await r.json();
      const parts = Array.isArray(j) && Array.isArray(j[0]) ? (j[0] as unknown[]) : [];
      const out = parts
        .map((s) => (Array.isArray(s) && typeof s[0] === 'string' ? (s[0] as string) : ''))
        .join('')
        .trim();
      return out && ARABIC_RE.test(out) ? out : '';
    });
    if (google) return google;
    const memo = await withTimeout(async (signal) => {
      const r2 = await fetch(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(t)}&langpair=en|ar`,
        { signal }
      );
      if (!r2.ok) return '';
      const j2 = (await r2.json()) as { responseData?: { translatedText?: string } };
      const out2 = (j2?.responseData?.translatedText || '').trim();
      if (!out2 || /MYMEMORY WARNING/i.test(out2) || !ARABIC_RE.test(out2)) return '';
      return out2;
    });
    if (memo) return memo;
    return t;
  };
  const fetchAddress = async () => {
    const c = parseMapUrlCoords(mapUrl);
    if (!c) return;
    setGeoState('loading');
    try {
      const { en, ar } = await resolveAddressText(c);
      onUpdate((prev) => ({
        ...prev,
        address: { en: en || prev.address?.en || '', ar: ar || prev.address?.ar || '' },
      }));
      autoFilledRef.current = true;
      setAddrOpen(true);
      setGeoState('done');
    } catch {
      setGeoState('error');
    }
  };
  // Shared resolver: coords -> short EN+AR text (OAR names, machine Arabic
  // fallback). Used by the location auto-fetch AND by pasted links below.
  async function resolveAddressText(c: { lat: number; lng: number }) {
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
    return { en, ar };
  }
  // Coords out of typed address text: direct parse, or follow a short link
  // first (browsers may refuse cross-origin follows — then the hint below
  // asks for the full link instead).
  async function coordsFromTyped(text: string) {
    const direct = parseMapUrlCoords(text);
    if (direct) return direct;
    const t = (text || '').trim();
    if (!/^(https?:\/\/)?(maps\.app\.goo\.gl|goo\.gl|maps\.gl)\//i.test(t)) return null;
    try {
      const r = await fetch(/^https?:\/\//i.test(t) ? t : `https://${t}`, { redirect: 'follow' });
      if (!r.ok) return null;
      return parseMapUrlCoords(r.url || '');
    } catch {
      return null;
    }
  }
  const [typedErr, setTypedErr] = useState<'short' | 'link' | null>(null);
  // Convert a pasted link/coords sitting in the address fields into real
  // text (both languages). Returns whether anything resolved.
  async function resolveTyped() {
    const cur = addrRef.current;
    const src = looksLikeMapInput(cur.en) ? cur.en : looksLikeMapInput(cur.ar) ? cur.ar : '';
    if (!src) {
      setTypedErr(null);
      return false;
    }
    setGeoState('loading');
    setTypedErr(null);
    const c = await coordsFromTyped(src);
    if (!c) {
      setGeoState('idle');
      setTypedErr(/maps\.app\.goo\.gl|goo\.gl|maps\.gl/i.test(src) ? 'short' : 'link');
      return false;
    }
    try {
      const { en, ar } = await resolveAddressText(c);
      onUpdate((prev) => ({
        ...prev,
        address: { en: en || prev.address?.en || '', ar: ar || prev.address?.ar || '' },
      }));
      autoFilledRef.current = true;
      setAddrOpen(true);
      setGeoState('done');
      return true;
    } catch {
      setGeoState('error');
      return false;
    }
  }
  // Debounced: pasting a link or coords into the address fields converts
  // itself to text. Plain names never match, so normal typing is untouched.
  useEffect(() => {
    if (!looksLikeMapInput(addr.en) && !looksLikeMapInput(addr.ar)) {
      setTypedErr(null);
      return;
    }
    const t = window.setTimeout(() => {
      void resolveTyped();
    }, 900);
    return () => window.clearTimeout(t);
    // addr values drive the schedule; resolveTyped reads live refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addr.en, addr.ar]);
  // Mount once: a previously-saved link converts itself (the footer never
  // shows raw links — see the Footer guard).
  const convertedRef = useRef(false);
  useEffect(() => {
    if (convertedRef.current) return;
    convertedRef.current = true;
    if (looksLikeMapInput(addr.en) || looksLikeMapInput(addr.ar)) {
      void resolveTyped();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Auto-fetch: typing fresh coordinates fills the address by itself, no
  // button press. Debounced; skips hand-typed text (never overwrite the
  // owner's words) and skips the mount (existing coords are settled).
  useEffect(() => {
    const c = parseMapUrlCoords(mapUrl);
    const key = c ? `${c.lat},${c.lng}` : '';
    if (lastAutoRef.current === null) {
      lastAutoRef.current = key;
      return;
    }
    if (!key || key === lastAutoRef.current) return;
    lastAutoRef.current = key;
    if (addr.en.trim() || addr.ar.trim()) {
      if (!autoFilledRef.current) return;
    }
    const t = window.setTimeout(() => {
      // Re-check at fire time: hand-typed text in the meantime wins.
      const a = addrRef.current;
      if ((a.en.trim() || a.ar.trim()) && !autoFilledRef.current) return;
      void fetchAddress();
    }, 900);
    return () => window.clearTimeout(t);
    // fetchAddress reads live state; mapUrl/addr drive the schedule.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapUrl, addr.en, addr.ar]);
  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800">
      <SettingsGroupHeader
        title={isAr ? 'الهوية والتواصل' : 'Identity & Contact'}
        lang={lang}
        collapsed={collapsed}
        onToggle={() => onToggleCollapse?.()}
      />
      <SettingsGroupBody open={!collapsed}>
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
          <p className="text-[11px] text-neutral-500 mt-1" dir={isAr ? 'rtl' : 'ltr'}>
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
                ? 'الصق رابط خرائط جوجل بأي صيغة، أو إحداثيات، أو اسم المكان.'
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
            // A direct link (often a short goo.gl link) carries no coords:
            // say so plainly, or the owner expects the customer distance
            // that can never appear.
            return isAr
              ? 'رابط مختصر معتمد — يفتح كزر، لكن بدون مسافة للزبون. لإظهار المسافة الصق رابطًا فيه إحداثيات (افتح موقعك في خرائط جوجل وانسخ الرابط الكامل).'
              : 'Short link recognized — opens as a button, but no customer distance. To show distance, paste a link carrying coordinates (open your place in Google Maps and copy the full link).';
          })()}
        </p>
      </div>

      {/* Written address = the text line in the footer (Store Information).
          Hidden until fetched or manually opened; type by hand or fetch
          from the work location above (Arabic auto-translated when the
          map has no Arabic name). */}
      <div>
        {!addrOpen ? (
          hasAddr && !looksLikeMapInput(addr.en) && !looksLikeMapInput(addr.ar) ? (
            <button
              type="button"
              onClick={() => setAddrOpen(true)}
              className="w-full flex items-center gap-2.5 rounded-xl bg-black border border-neutral-800 px-3 py-2.5 text-start hover:border-[var(--primary)]/50 transition-colors"
            >
              <span className="w-2 h-2 shrink-0 rounded-full bg-green-400" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-extrabold text-green-400">
                  {isAr ? 'العنوان محفوظ ✓' : 'Address saved ✓'}
                </span>
                <span className="block text-xs text-neutral-300 truncate" dir="auto" title={isAr ? addr.ar || addr.en : addr.en || addr.ar}>
                  {isAr ? addr.ar || addr.en : addr.en || addr.ar}
                </span>
              </span>
              <span className="shrink-0 text-[11px] font-bold text-neutral-500 hover:text-[var(--primary)] transition-colors">
                {isAr ? 'تعديل' : 'Edit'}
              </span>
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {(looksLikeMapInput(addr.en) || looksLikeMapInput(addr.ar)) ? (
                <>
                  <span className="text-[11px] text-neutral-500" dir={isAr ? 'rtl' : 'ltr'}>
                    {geoState === 'loading'
                      ? (isAr ? 'جارٍ تحويل الرابط إلى عنوان…' : 'Converting the link to an address…')
                      : (isAr ? 'هذا المحتوى رابط — سيتحول لنص عنوان.' : 'This is a link — it will become address text.')}
                  </span>
                  {geoState !== 'loading' && (
                    <button
                      type="button"
                      onClick={() => void resolveTyped()}
                      className="h-11 min-h-[44px] px-5 rounded-full border border-[var(--primary)]/50 text-[var(--primary)] text-xs font-extrabold hover:bg-[var(--primary)] hover:text-[#0A0A0A] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                    >
                      {isAr ? 'تحويل الآن' : 'Convert now'}
                    </button>
                  )}
                </>
              ) : locCoords ? (
                <span className="text-[11px] text-neutral-500" dir={isAr ? 'rtl' : 'ltr'}>
                  {geoState === 'loading'
                    ? (isAr ? 'جارٍ جلب العنوان تلقائيًا…' : 'Fetching the address automatically…')
                    : (isAr ? 'سيُجلب العنوان تلقائيًا…' : 'The address will be fetched automatically…')}
                </span>
              ) : (
                <p className="text-[11px] text-neutral-500" dir={isAr ? 'rtl' : 'ltr'}>
                  {isAr ? 'ضع رابطًا أو إحداثيات أعلاه لجلب العنوان تلقائيًا.' : 'Put a link or coordinates above to auto-fetch the address.'}
                </p>
              )}
              <button
                type="button"
                onClick={() => setAddrOpen(true)}
                className="h-11 min-h-[44px] px-4 rounded-full text-xs font-bold text-neutral-400 hover:text-[var(--primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              >
                {isAr ? 'أو اكتبه يدويًا' : 'or write it manually'}
              </button>
              {typedErr === 'short' && (
                <span className="text-[11px] text-amber-400">
                  {isAr ? 'الرابط مختصر ولا يُفتح هنا — الصق الرابط الكامل أو الإحداثيات.' : 'Short links cannot open here — paste the full link or coordinates.'}
                </span>
              )}
              {typedErr === 'link' && (
                <span className="text-[11px] text-amber-400">
                  {isAr ? 'هذا الرابط بلا إحداثيات — ضعه في خانة موقع العمل، وهنا اكتب النص.' : 'This link carries no coordinates — put it in Work Location and type text here.'}
                </span>
              )}
              {geoState === 'error' && (
                <span className="text-[11px] text-amber-400">
                  {isAr ? 'تعذر الجلب — اكتب العنوان يدويًا.' : 'Could not fetch — type the address manually.'}
                </span>
              )}
            </div>
          )
        ) : (
          <>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs text-neutral-400">
                {isAr ? 'العنوان النصي (يظهر في الموقع)' : 'Written Address (shown on site)'}
              </label>
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAddrOpen(false)}
                  className="text-[11px] font-bold text-neutral-500 hover:text-[var(--primary)] transition-colors"
                >
                  {isAr ? 'إخفاء' : 'Hide'}
                </button>
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
              </span>
            </div>
            <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
              <input
                type="text"
                dir="ltr"
                value={addr.en}
                onChange={(e) => {
                  autoFilledRef.current = false;
                  onUpdate((prev) => ({ ...prev, address: { en: e.target.value, ar: prev.address?.ar || '' } }));
                }}
                placeholder="Gouraud Street, Mar Mikhael, Beirut"
                className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)] placeholder:text-neutral-600"
              />
              <input
                type="text"
                dir="rtl"
                value={addr.ar}
                onChange={(e) => {
                  autoFilledRef.current = false;
                  onUpdate((prev) => ({ ...prev, address: { en: prev.address?.en || '', ar: e.target.value } }));
                }}
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
      </SettingsGroupBody>
    </div>
  );
};
