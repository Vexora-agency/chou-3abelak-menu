import React from 'react';
import { Check, ChevronDown, Globe, Loader2, MapPin, Search, X } from 'lucide-react';
import type { DeliveryZoneCountry, DeliveryZones, SubdivEntry } from '@/src/utils/deliveryZones';
import { COUNTRY_LIST, DEFAULT_DELIVERY_ZONES, flagEmoji } from '@/src/utils/deliveryZones';
import { SettingsGroupBody, SettingsGroupHeader } from './SettingsCollapsible';

/** Lazy per-country subdivision lists (public/geo/subdivisions/<CC>.json). */
const subdivCache = new Map<string, Promise<SubdivEntry[] | null>>();
function loadSubdivisions(cc: string): Promise<SubdivEntry[] | null> {
  const key = cc.toUpperCase();
  const hit = subdivCache.get(key);
  if (hit) return hit;
  const p = fetch(`/geo/subdivisions/${encodeURIComponent(key)}.json`, { headers: { Accept: 'application/json' } })
    .then((r) => {
      if (!r.ok) return null;
      return r.json() as Promise<unknown>;
    })
    .then((d) => {
      if (!Array.isArray(d)) return null;
      const list = (d as unknown[])
        .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
        .map((x) => ({
          code: typeof x.code === 'string' ? x.code : '',
          en: typeof x.en === 'string' ? x.en : '',
          ar: typeof x.ar === 'string' ? x.ar : null,
        }))
        .filter((x) => x.code && x.en);
      return list.length ? list : null;
    })
    .catch(() => null);
  subdivCache.set(key, p);
  return p;
}

const subName = (s: SubdivEntry, isAr: boolean) =>
  (isAr ? s.ar?.trim() || s.en : s.en.trim() || s.ar || s.code);

interface DeliveryZonesSectionProps {
  zones: DeliveryZones | undefined;
  lang: 'en' | 'ar';
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onUpdate: (updater: (prev: DeliveryZones) => DeliveryZones) => void;
}

/** Delivery-area card of the admin Settings tab: which countries (and which
 *  governorates inside them) delivery orders are accepted for. 'all' keeps
 *  today's behavior (serve everywhere, distance warning only); 'selected'
 *  hard-blocks out-of-zone delivery pins on the customer side and the API. */
export const DeliveryZonesSection: React.FC<DeliveryZonesSectionProps> = ({
  zones,
  lang,
  collapsed = false,
  onToggleCollapse,
  onUpdate,
}) => {
  const isAr = lang === 'ar';
  const z: DeliveryZones = zones && typeof zones === 'object'
    ? { mode: zones.mode === 'selected' ? 'selected' : 'all', maxKm: zones.maxKm, countries: Array.isArray(zones.countries) ? zones.countries : [] }
    : { ...DEFAULT_DELIVERY_ZONES };
  const [query, setQuery] = React.useState('');
  const [openCc, setOpenCc] = React.useState<string | null>(null);
  const [subdivs, setSubdivs] = React.useState<Record<string, { loading: boolean; list: SubdivEntry[] | null }>>({});

  const selected = React.useMemo(() => {
    const order = new Map(z.countries.map((c, i) => [c.cc, i]));
    return COUNTRY_LIST.filter((c) => order.has(c.cc))
      .sort((a, b) => (order.get(a.cc) as number) - (order.get(b.cc) as number));
  }, [z.countries]);
  const selectedSet = React.useMemo(() => new Set(z.countries.map((c) => c.cc)), [z.countries]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? COUNTRY_LIST.filter(
        (c) => c.en.toLowerCase().includes(q) || (c.ar || '').includes(query.trim()) || c.cc.toLowerCase() === q,
      ).slice(0, 60)
    : COUNTRY_LIST.slice(0, 60);

  const toggleCountry = (cc: string) => {
    onUpdate((prev) => {
      const has = (prev.countries || []).some((c) => c.cc === cc);
      if (has) return { ...prev, countries: (prev.countries || []).filter((c) => c.cc !== cc) };
      // New countries open WHOLE (all subdivisions) — the admin unchecks
      // the ones they don't serve. Keeps enabling a country one tap.
      return { ...prev, countries: [...(prev.countries || []), { cc, subdivisions: 'ALL' as const }] };
    });
  };

  const ensureSubdivs = (cc: string) => {
    setOpenCc((prev) => (prev === cc ? null : cc));
    setSubdivs((prev) => {
      if (prev[cc]) return prev;
      void loadSubdivisions(cc).then((list) =>
        setSubdivs((p) => ({ ...p, [cc]: { loading: false, list } })),
      );
      return { ...prev, [cc]: { loading: true, list: null } };
    });
  };

  const setSubSelection = (cc: string, codes: 'ALL' | string[]) => {
    onUpdate((prev) => ({
      ...prev,
      countries: (prev.countries || [])
        .map((c) => (c.cc === cc ? { ...c, subdivisions: codes } : c))
        .filter((c) => c.subdivisions === 'ALL' || (Array.isArray(c.subdivisions) && c.subdivisions.length > 0)),
    }));
  };

  const toggleSubdiv = (cc: string, code: string, list: SubdivEntry[]) => {
    const entry = (z.countries || []).find((c) => c.cc === cc);
    const current: string[] = !entry || entry.subdivisions === 'ALL'
      ? list.map((s) => s.code)
      : [...entry.subdivisions];
    const next = current.includes(code) ? current.filter((x) => x !== code) : [...current, code];
    if (!next.length) {
      // Nothing left checked = country not served — drop it (explicit).
      onUpdate((prev) => ({ ...prev, countries: (prev.countries || []).filter((c) => c.cc !== cc) }));
      return;
    }
    // Back to full coverage → collapse to 'ALL' (minimal payload).
    setSubSelection(cc, next.length === list.length ? 'ALL' : next);
  };

  const segBtn = (active: boolean) =>
    `px-3 h-9 text-[11px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
      active ? 'bg-[var(--primary)] text-[#0A0A0A]' : 'text-neutral-300 hover:text-[var(--primary)]'
    }`;

  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4">
      <SettingsGroupHeader
        title={isAr ? 'مناطق التوصيل' : 'Delivery zones'}
        subtitle={isAr ? 'حدد الدول والمحافظات التي توصل إليها — أو اترك التوصيل مفتوحًا للجميع' : 'Choose which countries and governorates you deliver to — or keep delivery open to everyone'}
        lang={lang}
        collapsed={collapsed}
        onToggle={() => onToggleCollapse?.()}
      />
      <SettingsGroupBody open={!collapsed}>
        <div className="space-y-4">
          {/* Mode: everywhere vs selected */}
          <div className="rounded-xl border border-neutral-800 bg-black/30 px-3 py-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs text-neutral-400 flex items-center gap-1.5">
                <Globe size={13} className="shrink-0" />
                {isAr ? 'نطاق التوصيل' : 'Delivery coverage'}
              </span>
              <div className="inline-flex rounded-full border border-neutral-700 overflow-hidden" role="group" aria-label={isAr ? 'نطاق التوصيل' : 'Delivery coverage'}>
                <button type="button" aria-pressed={z.mode === 'all'} onClick={() => onUpdate((p) => ({ ...p, mode: 'all' as const }))} className={segBtn(z.mode === 'all')}>
                  {isAr ? 'كل الدول' : 'Everywhere'}
                </button>
                <button type="button" aria-pressed={z.mode === 'selected'} onClick={() => onUpdate((p) => ({ ...p, mode: 'selected' as const }))} className={`${segBtn(z.mode === 'selected')} border-s border-neutral-700`}>
                  {isAr ? 'مناطق محددة' : 'Selected zones'}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs text-neutral-400">
                {isAr ? 'أقصى مسافة توصيل (كم) — حماية إضافية' : 'Max delivery distance (km) — extra backstop'}
              </span>
              <input
                type="number" min={1} max={2000} step={1}
                value={z.maxKm}
                onChange={(e) => {
                  const v = Math.round(Number(e.target.value));
                  if (!Number.isFinite(v)) return;
                  onUpdate((p) => ({ ...p, maxKm: Math.min(2000, Math.max(1, v)) }));
                }}
                className="w-24 h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm text-center tabular-nums"
                aria-label={isAr ? 'أقصى مسافة توصيل بالكيلومتر' : 'Max delivery distance in km'}
              />
            </div>
            <p className="text-[11px] text-neutral-500">
              {isAr
                ? '«كل الدول» = سلوك اليوم بدون أي منع. «مناطق محددة» = طلبات التوصيل خارج المناطق المختارة تُرفض مع زر واتساب.'
                : '“Everywhere” keeps today’s behavior (no blocking). “Selected zones” rejects out-of-zone delivery orders with a WhatsApp button.'}
            </p>
          </div>

          {z.mode === 'selected' && (
            <>
              {/* Selected chips */}
              {z.countries.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selected.map((c) => {
                    const entry = z.countries.find((x) => x.cc === c.cc) as DeliveryZoneCountry;
                    const count = entry.subdivisions === 'ALL' ? null : entry.subdivisions.length;
                    return (
                      <span key={c.cc} className="inline-flex items-center gap-1.5 ps-2.5 pe-1 py-1 rounded-full text-[11px] font-bold border border-[var(--primary)]/40 bg-[var(--primary)]/10 text-[var(--primary)]">
                        <span aria-hidden="true">{flagEmoji(c.cc)}</span>
                        <bdi>{isAr ? c.ar || c.en : c.en}</bdi>
                        {count !== null && <span className="tabular-nums opacity-80" dir="ltr">{count}</span>}
                        <button
                          type="button"
                          onClick={() => toggleCountry(c.cc)}
                          className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-[var(--primary)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                          aria-label={isAr ? `إزالة ${c.ar || c.en}` : `Remove ${c.en}`}
                        >
                          <X size={12} strokeWidth={3} />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Country search + picker */}
              <div className="rounded-xl border border-neutral-800 bg-black/30 p-3 space-y-2">
                <div className="relative">
                  <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-neutral-500" aria-hidden="true" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={isAr ? 'ابحث باسم الدولة (عربي أو إنجليزي)…' : 'Search countries (English or Arabic)…'}
                    className="w-full h-10 ps-9 pe-3 rounded-lg bg-black border border-neutral-700 text-sm"
                    aria-label={isAr ? 'البحث عن دولة' : 'Search countries'}
                  />
                </div>
                <div className="max-h-60 overflow-y-auto rounded-lg border border-neutral-800 divide-y divide-neutral-800/70" role="listbox" aria-label={isAr ? 'الدول' : 'Countries'}>
                  {filtered.map((c) => {
                    const on = selectedSet.has(c.cc);
                    return (
                      <button
                        key={c.cc}
                        type="button"
                        role="option"
                        aria-selected={on}
                        onClick={() => toggleCountry(c.cc)}
                        className={`w-full flex items-center gap-2.5 px-3 h-11 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)] ${on ? 'bg-[var(--primary)]/10' : 'hover:bg-white/5'}`}
                      >
                        <span className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center ${on ? 'bg-[var(--primary)] border-[var(--primary)] text-[#0A0A0A]' : 'border-neutral-600 text-transparent'}`} aria-hidden="true">
                          <Check size={13} strokeWidth={3.5} />
                        </span>
                        <span className="text-lg leading-none" aria-hidden="true">{flagEmoji(c.cc)}</span>
                        <span className="min-w-0 flex-1 truncate font-bold text-neutral-100" dir="auto">{isAr ? c.ar || c.en : c.en}</span>
                        <span className="shrink-0 text-[11px] text-neutral-500" dir="auto">{isAr ? c.en : c.ar}</span>
                        <span className="shrink-0 text-[10px] font-mono text-neutral-600" dir="ltr">{c.cc}</span>
                      </button>
                    );
                  })}
                  {filtered.length === 0 && (
                    <p className="px-3 py-4 text-center text-[11px] text-neutral-500">
                      {isAr ? 'لا توجد دولة بهذا الاسم' : 'No country matches that name'}
                    </p>
                  )}
                </div>
                {z.countries.length === 0 && (
                  <p className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-1.5">
                    {isAr
                      ? 'اختر دولة واحدة على الأقل، أو ارجع إلى «كل الدول» — بدون دول مختارة لن يصل أي طلب توصيل.'
                      : 'Pick at least one country, or switch back to “Everywhere” — with no countries selected, no delivery order can go through.'}
                  </p>
                )}
              </div>

              {/* Per-country governorates */}
              {selected.map((c) => {
                const entry = z.countries.find((x) => x.cc === c.cc) as DeliveryZoneCountry;
                const open = openCc === c.cc;
                const st = subdivs[c.cc];
                const list = st?.list ?? null;
                const allOpen = entry.subdivisions === 'ALL';
                return (
                  <div key={c.cc} className="rounded-xl border border-neutral-800 bg-black/30 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => ensureSubdivs(c.cc)}
                      aria-expanded={open}
                      className="w-full flex items-center justify-between gap-2 p-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)]"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="text-lg leading-none" aria-hidden="true">{flagEmoji(c.cc)}</span>
                        <b className="text-xs text-white truncate" dir="auto">{isAr ? c.ar || c.en : c.en}</b>
                        <span className="shrink-0 px-2 py-0.5 rounded-full border border-neutral-700 text-neutral-400 text-[10px] font-bold tabular-nums" dir="ltr">
                          {allOpen ? (isAr ? 'كل المحافظات' : 'All regions') : `${Array.isArray(entry.subdivisions) ? entry.subdivisions.length : 0} / ${list ? list.length : '…'}`}
                        </span>
                      </span>
                      <ChevronDown size={15} className={`shrink-0 text-neutral-500 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </button>
                    {open && (
                      <div className="px-3 pb-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={!list}
                            onClick={() => list && setSubSelection(c.cc, 'ALL')}
                            className="btn-tactile px-3 h-8 rounded-full border border-neutral-700 text-neutral-300 text-[11px] font-bold hover:border-[var(--primary)] hover:text-[var(--primary)] disabled:opacity-40"
                          >
                            {isAr ? 'تحديد الكل' : 'Select all'}
                          </button>
                          <span className="text-[11px] text-neutral-500">
                            {isAr
                              ? 'الدولة مفتوحة كلها افتراضيًا — أزل التحديد عن المحافظات التي لا توصّل إليها.'
                              : 'The whole country is open by default — untick the regions you don’t serve.'}
                          </span>
                        </div>
                        {!st || st.loading ? (
                          <p className="flex items-center gap-2 text-[11px] text-neutral-500 py-2">
                            <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                            {isAr ? 'جاري تحميل المحافظات…' : 'Loading regions…'}
                          </p>
                        ) : !list ? (
                          <p className="text-[11px] text-neutral-500 py-1">
                            {isAr ? 'لا توجد تقسيمات مسجلة لهذه الدولة — تُعامل كاملة مفتوحة.' : 'No recorded subdivisions for this country — treated as fully open.'}
                          </p>
                        ) : (
                          <div className="max-h-56 overflow-y-auto rounded-lg border border-neutral-800 divide-y divide-neutral-800/70">
                            {list.map((s) => {
                              const on = allOpen || (Array.isArray(entry.subdivisions) && entry.subdivisions.includes(s.code));
                              return (
                                <button
                                  key={s.code}
                                  type="button"
                                  role="checkbox"
                                  aria-checked={on}
                                  onClick={() => toggleSubdiv(c.cc, s.code, list)}
                                  className={`w-full flex items-center gap-2.5 px-3 h-11 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)] ${on ? '' : 'opacity-70'} hover:bg-white/5`}
                                >
                                  <span className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center ${on ? 'bg-[var(--primary)] border-[var(--primary)] text-[#0A0A0A]' : 'border-neutral-600 text-transparent'}`} aria-hidden="true">
                                    <Check size={13} strokeWidth={3.5} />
                                  </span>
                                  <MapPin size={13} className="shrink-0 text-neutral-500" aria-hidden="true" />
                                  <span className="min-w-0 flex-1 truncate font-bold text-neutral-100" dir="auto">{subName(s, isAr)}</span>
                                  <span className="shrink-0 text-[10px] font-mono text-neutral-600" dir="ltr">{s.code}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </SettingsGroupBody>
    </div>
  );
};
