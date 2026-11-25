import React, { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, MapPin, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { AdminFetch } from '@/src/lib/api-client';
import { RestaurantPinPicker } from './RestaurantPinPicker';

interface CustomPlacesSectionProps {
  lang: 'en' | 'ar';
  adminFetch: AdminFetch;
  onConfirm?: (box: { title: string; body: string; confirmText: string; mode?: 'confirm' | 'info'; action?: () => void }) => void;
}

interface PlaceRow {
  id: number;
  name_ar: string;
  name_en: string | null;
  lat: number;
  lng: number;
  kind: 'area' | 'landmark' | 'street';
}

const KINDS = ['area', 'landmark', 'street'] as const;

const kindLabel = (k: string, ar: boolean) => {
  if (k === 'area') return ar ? 'حي / منطقة' : 'Area';
  if (k === 'street') return ar ? 'شارع' : 'Street';
  return ar ? 'معلم' : 'Landmark';
};

/** Owner-curated areas & landmarks: the names customers actually use
 * («دوار كذا»، «جنب فرن فلان») with the exact pin the owner drops.
 * Served FIRST in address autocomplete, above every provider pass. */
export const CustomPlacesSection: React.FC<CustomPlacesSectionProps> = ({ lang, adminFetch, onConfirm }) => {
  const isAr = lang === 'ar';
  const [rows, setRows] = useState<PlaceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [hidden403, setHidden403] = useState(false);
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [kind, setKind] = useState<'area' | 'landmark' | 'street'>('landmark');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [editing, setEditing] = useState<PlaceRow | null>(null);
  const [editNameAr, setEditNameAr] = useState('');
  const [editNameEn, setEditNameEn] = useState('');
  const [editKind, setEditKind] = useState<'area' | 'landmark' | 'street'>('landmark');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/custom-places');
      if (res.status === 403) { setHidden403(true); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json().catch(() => null)) as { ok?: boolean; places?: PlaceRow[] } | null;
      if (!data || data.ok !== true || !Array.isArray(data.places)) throw new Error('bad-shape');
      setRows(data.places);
      setLoadError(false);
    } catch { setLoadError(true); }
    finally { setLoading(false); }
  }, [adminFetch]);

  useEffect(() => { void refresh(); }, [refresh]);
  if (hidden403) return null;

  const valid = (): boolean => {
    if (nameAr.trim().length < 2) {
      setFieldError(isAr ? 'أدخل الاسم بالعربية (حرفان على الأقل).' : 'Enter the Arabic name (2+ characters).');
      return false;
    }
    if (!coords) {
      setFieldError(isAr ? 'اختر النقطة من الخريطة أولًا.' : 'Pick the point on the map first.');
      return false;
    }
    setFieldError(null);
    return true;
  };

  const add = async () => {
    if (!valid()) return;
    setBusy('add');
    setMsg(null);
    try {
      const res = await adminFetch('/api/admin/custom-places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name_ar: nameAr.trim().slice(0, 80),
          ...(nameEn.trim() ? { name_en: nameEn.trim().slice(0, 80) } : {}),
          kind,
          lat: coords!.lat,
          lng: coords!.lng,
        }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data || data.ok !== true) throw new Error(data?.error || `HTTP ${res.status}`);
      setNameAr('');
      setNameEn('');
      setKind('landmark');
      setCoords(null);
      setMsg({ kind: 'ok', text: isAr ? 'تمت إضافة المكان — سيظهر أولًا في الاقتراحات.' : 'Place added — it now ranks first in suggestions.' });
      setLoading(true);
      await refresh();
    } catch { setMsg({ kind: 'err', text: isAr ? 'تعذرت الإضافة — حاول مجددًا.' : 'Could not add — try again.' }); }
    finally { setBusy(null); }
  };

  const startEdit = (row: PlaceRow) => {
    setEditing(row);
    setEditNameAr(row.name_ar);
    setEditNameEn(row.name_en || '');
    setEditKind(row.kind);
  };

  const saveEdit = async () => {
    if (!editing || editNameAr.trim().length < 2) return;
    setBusy(`edit:${editing.id}`);
    setMsg(null);
    try {
      const res = await adminFetch(`/api/admin/custom-places?id=${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name_ar: editNameAr.trim().slice(0, 80),
          ...(editNameEn.trim() ? { name_en: editNameEn.trim().slice(0, 80) } : {}),
          kind: editKind,
        }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data || data.ok !== true) throw new Error(data?.error || `HTTP ${res.status}`);
      setEditing(null);
      setMsg({ kind: 'ok', text: isAr ? 'تم الحفظ.' : 'Saved.' });
      setLoading(true);
      await refresh();
    } catch { setMsg({ kind: 'err', text: isAr ? 'تعذر الحفظ — حاول مجددًا.' : 'Could not save — try again.' }); }
    finally { setBusy(null); }
  };

  const askRemove = (row: PlaceRow) => {
    const run = async () => {
      setBusy(`del:${row.id}`);
      setMsg(null);
      try {
        const res = await adminFetch(`/api/admin/custom-places?id=${row.id}`, { method: 'DELETE' });
        const data = (await res.json().catch(() => null)) as { ok?: boolean } | null;
        if (!res.ok || !data || data.ok !== true) throw new Error(`HTTP ${res.status}`);
        setMsg({ kind: 'ok', text: isAr ? 'تم الحذف.' : 'Deleted.' });
        setLoading(true);
        await refresh();
      } catch { setMsg({ kind: 'err', text: isAr ? 'تعذر الحذف — حاول مجددًا.' : 'Could not delete — try again.' }); }
      finally { setBusy(null); }
    };
    if (onConfirm) {
      onConfirm({
        title: isAr ? 'حذف المكان؟' : 'Delete this place?',
        body: row.name_ar,
        confirmText: isAr ? 'حذف' : 'Delete',
        action: () => void run(),
      });
    } else void run();
  };

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h3 className="text-sm font-black text-white">{isAr ? 'الأماكن والمعالم' : 'Areas & landmarks'}</h3>
      <p className="mt-1 text-[11px] font-bold text-neutral-400">
        {isAr
          ? 'أسماء يستعملها الزبائن فعلًا («دوار كذا»، «جنب فرن فلان») — تظهر أولًا في الاقتراحات قبل أي مزود.'
          : 'Names customers actually use — ranked first in suggestions, above every provider.'}
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2" dir={isAr ? 'rtl' : 'ltr'}>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-neutral-400">{isAr ? 'الاسم بالعربية *' : 'Arabic name *'}</span>
          <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="auto" maxLength={80} placeholder={isAr ? 'مثال: دوار السيوف' : 'e.g. El Soyouf roundabout'}
            className="h-11 w-full rounded-xl border border-neutral-700 bg-black px-3 text-sm text-white placeholder-neutral-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-neutral-400">{isAr ? 'الاسم بالإنجليزية (اختياري)' : 'English name (optional)'}</span>
          <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="auto" maxLength={80} placeholder="El Soyouf"
            className="h-11 w-full rounded-xl border border-neutral-700 bg-black px-3 text-sm text-white placeholder-neutral-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-neutral-400">{isAr ? 'النوع' : 'Type'}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}
            className="h-11 w-full rounded-xl border border-neutral-700 bg-black px-3 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
            {KINDS.map((k) => <option key={k} value={k}>{kindLabel(k, isAr)}</option>)}
          </select>
        </label>
        <div className="flex items-end">
          <button type="button" onClick={() => setPickOpen(true)}
            className="inline-flex h-11 min-h-[44px] w-full items-center justify-center gap-1.5 rounded-full border border-neutral-700 px-3 text-xs font-black text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
            <MapPin size={14} aria-hidden="true" />
            {coords
              ? <span dir="ltr" className="tabular-nums">{coords.lat}, {coords.lng}</span>
              : (isAr ? 'اختيار النقطة من الخريطة' : 'Pick point on map')}
          </button>
        </div>
      </div>
      {fieldError && <p role="alert" className="mt-2 text-xs font-bold text-red-400">{fieldError}</p>}
      <button type="button" onClick={() => void add()} disabled={busy === 'add'}
        className="mt-3 inline-flex h-11 min-h-[44px] items-center gap-1.5 rounded-full bg-[var(--primary)] px-5 text-xs font-black text-[#0A0A0A] disabled:opacity-60">
        {busy === 'add' ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
        {isAr ? 'إضافة المكان' : 'Add place'}
      </button>
      {msg && <p role="status" className={`mt-2 text-xs font-bold ${msg.kind === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</p>}

      <div className="mt-4 space-y-2">
        {loading && <p className="inline-flex items-center gap-2 text-xs font-bold text-neutral-400"><Loader2 size={14} className="animate-spin" />{isAr ? 'جارٍ التحميل…' : 'Loading…'}</p>}
        {loadError && !loading && <p className="text-xs font-bold text-red-400">{isAr ? 'تعذر التحميل — حاول مجددًا.' : 'Could not load — try again.'}</p>}
        {!loading && !loadError && rows.length === 0 && (
          <p className="text-xs font-bold text-neutral-500">{isAr ? 'لا أماكن بعد — أضف أول معلم يعرفه الزبائن.' : 'No places yet — add the first landmark customers know.'}</p>
        )}
        {rows.map((row) => (
          <div key={row.id} className="rounded-xl border border-neutral-800 bg-black/40 p-3">
            {editing?.id === row.id ? (
              <div className="grid gap-2 sm:grid-cols-3" dir={isAr ? 'rtl' : 'ltr'}>
                <input value={editNameAr} onChange={(e) => setEditNameAr(e.target.value)} dir="auto" maxLength={80}
                  className="h-11 rounded-xl border border-neutral-700 bg-black px-3 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" />
                <input value={editNameEn} onChange={(e) => setEditNameEn(e.target.value)} dir="auto" maxLength={80} placeholder="EN"
                  className="h-11 rounded-xl border border-neutral-700 bg-black px-3 text-sm text-white placeholder-neutral-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" />
                <div className="flex gap-2">
                  <select value={editKind} onChange={(e) => setEditKind(e.target.value as typeof editKind)}
                    className="h-11 flex-1 rounded-xl border border-neutral-700 bg-black px-2 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
                    {KINDS.map((k) => <option key={k} value={k}>{kindLabel(k, isAr)}</option>)}
                  </select>
                  <button type="button" onClick={() => void saveEdit()} disabled={busy === `edit:${row.id}`} aria-label={isAr ? 'حفظ' : 'Save'}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[var(--primary)] text-[#0A0A0A] disabled:opacity-60">
                    {busy === `edit:${row.id}` ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                  </button>
                  <button type="button" onClick={() => setEditing(null)} aria-label={isAr ? 'إلغاء' : 'Cancel'}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-neutral-700 text-neutral-300">
                    <X size={15} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black text-white" dir="auto">{row.name_ar}</p>
                  <p className="mt-0.5 text-[11px] font-bold text-neutral-500" dir="ltr">
                    <span className="tabular-nums">{row.lat}, {row.lng}</span>
                    {' · '}{kindLabel(row.kind, isAr)}
                    {row.name_en ? ` · ${row.name_en}` : ''}
                  </p>
                </div>
                <button type="button" onClick={() => startEdit(row)} aria-label={isAr ? 'تعديل' : 'Edit'}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-neutral-700 text-neutral-300">
                  <Pencil size={14} />
                </button>
                <button type="button" onClick={() => askRemove(row)} disabled={busy === `del:${row.id}`} aria-label={isAr ? 'حذف' : 'Delete'}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-red-900 text-red-400 disabled:opacity-60">
                  {busy === `del:${row.id}` ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {pickOpen && (
        <RestaurantPinPicker
          lang={lang}
          initial={coords}
          onConfirm={(lat, lng) => { setCoords({ lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 }); setPickOpen(false); }}
          onClose={() => setPickOpen(false)}
        />
      )}
    </div>
  );
};
