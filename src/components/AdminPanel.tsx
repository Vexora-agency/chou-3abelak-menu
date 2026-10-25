import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MenuData, MenuItem, Category, OrderType, FeatureDef, AdminSaveResult, ItemVariant, ItemAddon } from '../types/menu';
import { validateMenu } from '../../functions/_shared/validate.js';
import OrdersDashboard, { type Order, type OrderStatus } from './OrdersDashboard';
import { formatPrice } from '../utils/menuHelpers';
import { normalizePricing, priceLabel, isNewItem as isItemNew, featuresByGroup, unitLabel, featureName } from '../utils/pricing';
import {
  Save,
  ArrowLeft,
  Plus,
  Trash2,
  Copy,
  ChevronUp,
  ChevronDown,
  Eye,
  EyeOff,
  Download,
  Upload,
  RefreshCw,
  Check,
  AlertTriangle,
  Sparkles,
  Flame,
  Award,
  Globe,
  X,
} from 'lucide-react';

interface AdminPanelProps {
  initialMenu: MenuData;
  onSaveMenu: (newMenu: MenuData) => Promise<AdminSaveResult | null>;
  onClose: () => void;
  onSignOut?: () => void;
  onToggleLang?: () => void;
  lang: 'en' | 'ar';
}

// Compact pager: ‹ prev · numbered buttons with ellipsis · next › + "Showing X–Y of Z"
function Pager({
  page,
  pageCount,
  onChange,
  from,
  to,
  total,
  unit,
}: {
  page: number;
  pageCount: number;
  onChange: (p: number) => void;
  from: number;
  to: number;
  total: number;
  unit: string;
}) {
  if (pageCount <= 1) return null;
  const pages: (number | '…')[] = [];
  const push = (p: number) => {
    if (!pages.includes(p)) pages.push(p);
  };
  push(0);
  for (let p = page - 1; p <= page + 1; p++) if (p > 0 && p < pageCount - 1) push(p);
  if (pageCount > 1) push(pageCount - 1);
  pages.sort((a, b) => (a === '…' || b === '…' ? 0 : (a as number) - (b as number)));
  const withGaps: (number | '…')[] = [];
  pages.forEach((p, i) => {
    if (i > 0 && typeof p === 'number' && typeof pages[i - 1] === 'number' && (p as number) - (pages[i - 1] as number) > 1) withGaps.push('…');
    withGaps.push(p);
  });
  const btn = 'min-w-[32px] h-8 px-2 rounded-lg text-xs font-bold transition-colors';
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
      <span className="text-[11px] text-neutral-500">
        {from}–{to} {unit} {total}
      </span>
      <div className="flex items-center gap-1" role="navigation" aria-label="Pagination">
        <button
          type="button"
          disabled={page === 0}
          onClick={() => onChange(page - 1)}
          className={`${btn} bg-neutral-900 border border-neutral-700 text-neutral-300 hover:text-white disabled:opacity-30`}
          aria-label="Previous page"
        >
          ‹
        </button>
        {withGaps.map((p, i) =>
          p === '…' ? (
            <span key={`gap-${i}`} className="text-neutral-600 text-xs px-1">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p as number)}
              aria-current={p === page ? 'page' : undefined}
              className={`${btn} ${
                p === page
                  ? 'bg-[#FFC400] text-[#0A0A0A]'
                  : 'bg-neutral-900 border border-neutral-700 text-neutral-300 hover:text-white'
              }`}
            >
              {(p as number) + 1}
            </button>
          )
        )}
        <button
          type="button"
          disabled={page === pageCount - 1}
          onClick={() => onChange(page + 1)}
          className={`${btn} bg-neutral-900 border border-neutral-700 text-neutral-300 hover:text-white disabled:opacity-30`}
          aria-label="Next page"
        >
          ›
        </button>
      </div>
    </div>
  );
}

// "13:05" (24h) -> "1:05 PM" / "1:05 مساءً", so AM/PM is never ambiguous
function formatTime12h(t: string, isAr: boolean): string {
  const m = /^(\d{1,2}):(\d{2})/.exec((t || '').trim());
  if (!m) return t || '--:--';
  const h = parseInt(m[1], 10) % 24;
  const suffix = h < 12 ? (isAr ? 'صباحاً' : 'AM') : (isAr ? 'مساءً' : 'PM');
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  initialMenu,
  onSaveMenu,
  onClose,
  onSignOut,
  onToggleLang,
  lang,
}) => {
  const isAr = lang === 'ar';
  const [menu, setMenu] = useState<MenuData>(initialMenu);
  const [dirty, setDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'settings' | 'categories' | 'items' | 'backup'>('dashboard');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Auto-save: when ON, every change is saved automatically after a short
  // pause, so the "unsaved changes" bar never appears. Persisted per device.
  const [autoSave, setAutoSave] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('admin_autosave_v1');
      // ON by default for new users; returning users keep their own choice.
      if (saved === null) return true;
      return saved === '1';
    } catch {
      return true;
    }
  });

  // Item edit modal state
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [isNewItem, setIsNewItem] = useState(false);
  const [calcQty, setCalcQty] = useState(1);
  // Collapsed feature-library sections (open by default)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  // Professional confirm dialog (replaces native confirm for deletes).
  // mode 'info' shows a single OK button (for blocked deletes).
  const [confirmBox, setConfirmBox] = useState<{
    title: string;
    body: string;
    confirmText: string;
    mode?: 'confirm' | 'info';
    action?: () => void;
  } | null>(null);
  useEffect(() => {
    setCalcQty(7);
  }, [editingItem?.id]);
  // Sections that actually hold features (choices of the add-flow picker)
  const nonEmptySections = (menu.settings.featureGroups || []).filter((g) =>
    (menu.settings.featureDefs || []).some((d) => d.groupId === g.id)
  );
  // The sizes section, by convention: id "sizes" or a sizes-like name.
  // "Add size" bulk-adds straight from it — no picker, no questions.
  const isSizesSection = (g: { id: string; name: { en: string; ar: string } }): boolean => {
    if (g.id === 'sizes') return true;
    const names = [g.name?.en, g.name?.ar].map((s) => (s || '').trim().toLowerCase());
    return names.some((n) => n === 'size' || n === 'sizes' || n === 'أحجام' || n === 'احجام');
  };
  const sizesSection = nonEmptySections.find((g) => isSizesSection(g));
  // Add-flow picker (one-shot, add-ons only): press the add button, pick a
  // section, every remaining feature of that section drops in.
  const [pickingAddonSec, setPickingAddonSec] = useState(false);
  const [itemCategoryFilter, setItemCategoryFilter] = useState('all');
  const [itemBadgeFilter, setItemBadgeFilter] = useState<'all' | 'new' | 'spicy' | 'top'>('all');
  const [itemSearch, setItemSearch] = useState('');

  // Client-side pagination (8 rows per page — the sweet spot for tall admin rows)
  const pageSize = 8;
  const [catPage, setCatPage] = useState(0);
  const [itemPage, setItemPage] = useState(0);
  const clampPage = (p: number, count: number) => Math.max(0, Math.min(p, Math.max(0, count - 1)));

  // Orders dashboard state
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState(false);
  const ordersTitleBase = useRef(typeof document !== 'undefined' ? document.title : '');

  const fetchOrders = useCallback(async (silent = false) => {
    if (!silent) {
      setOrdersLoading(true);
      setOrdersError(false);
    }
    try {
      // days=65: the 30-day view compares against the previous 30 days, so it
      // needs up to 60 days of history (today + 7d/30d views fit inside it).
      const res = await fetch('/api/admin/orders?days=65&limit=2000', {
        headers: { 'X-Requested-With': 'menu-admin' },
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: Order[] = Array.isArray(data.orders) ? data.orders : [];
      setOrders((prev) => {
        const prevIds = new Set(prev.map((o) => o.id));
        const freshIds = list.filter((o) => !prevIds.has(o.id)).map((o) => o.id);
        if (prev.length > 0 && freshIds.length > 0 && typeof document !== 'undefined') {
          document.title = `(${freshIds.length}) ${isAr ? 'طلبات جديدة' : 'New orders'}`;
        }
        return list;
      });
      if (!silent) setOrdersLoading(false);
    } catch {
      if (!silent) {
        setOrdersLoading(false);
        setOrdersError(true);
      }
    }
  }, [isAr]);

  // Initial load + 30s poll while the tab is visible
  useEffect(() => {
    fetchOrders(false);
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchOrders(true);
    }, 30000);
    return () => window.clearInterval(id);
  }, [fetchOrders]);

  // Restore the page title when the dashboard tab is viewed
  useEffect(() => {
    if (activeTab === 'dashboard' && typeof document !== 'undefined') {
      document.title = ordersTitleBase.current || document.title;
    }
  }, [activeTab]);

  const handleOrderStatusChange = async (id: string, status: OrderStatus) => {    const prev = orders;
    setOrders((cur) => cur.map((o) => (o.id === id ? { ...o, status } : o)));
    try {
      const res = await fetch(`/api/admin/orders/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'menu-admin' },
        credentials: 'same-origin',
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fetchOrders(true);
    } catch {
      setOrders(prev);
      alert(isAr ? 'تعذر تحديث حالة الطلب. حاول مجدداً.' : 'Could not update the order status. Please try again.');
    }
  };

  // Update helper
  const updateMenu = (updater: (prev: MenuData) => MenuData) => {
    setMenu((prev) => {
      const updated = updater(prev);
      setDirty(true);
      return updated;
    });
  };

  const handleSave = async () => {
    // Client-side validations below return early on problems
    const seenGrp = new Set<string>();
    for (const g of menu.settings.featureGroups || []) {
      if (!g.id.trim() || seenGrp.has(g.id.trim())) {
        alert(isAr ? 'معرّفات الأقسام يجب أن تكون فريدة وغير فارغة' : 'Section ids must be unique and non-empty');
        return;
      }
      seenGrp.add(g.id.trim());
    }
    const seenFeat = new Set<string>();
    for (const f of menu.settings.featureDefs || []) {
      if (!f.id.trim() || seenFeat.has(f.id.trim())) {
        alert(isAr ? 'معرّفات الميزات يجب أن تكون فريدة وغير فارغة' : 'Feature ids must be unique and non-empty');
        return;
      }
      seenFeat.add(f.id.trim());
      if (!(menu.settings.featureGroups || []).some((g) => g.id === f.groupId)) {
        alert(isAr ? `الميزة "${f.name.en || f.id}" بدون قسم صالح` : `Feature "${f.name.en || f.id}" has no valid section`);
        return;
      }
    }
    // Send the CURRENT version; the server assigns version+1 on success.
    // (Bumping it here would always 409 against the server's check.)
    // Auto-fill: if one language is blank, copy the other so nothing renders empty
    const fillBi = (v: { en: string; ar: string }) => ({
      en: v.en.trim() ? v.en : v.ar,
      ar: v.ar.trim() ? v.ar : v.en,
    });
    const normalized: MenuData = {
      ...menu,
      settings: {
        ...menu.settings,
        name: fillBi(menu.settings.name),
        tagline: fillBi(menu.settings.tagline),
        address: fillBi(menu.settings.address),
        hoursText: fillBi(menu.settings.hoursText),
        currency: fillBi(menu.settings.currency),
        about: fillBi(menu.settings.about),
        featureDefs: (menu.settings.featureDefs || []).map((f) => ({ ...f, name: fillBi(f.name) })),
      },
      items: menu.items.map((i) => ({
        ...i,
        name: fillBi(i.name),
        description: fillBi(i.description),
      })),
      categories: menu.categories.map((c) => ({ ...c, name: fillBi(c.name) })),
    };
    const updated = {
      ...normalized,
      version: normalized.version,
      updatedAt: new Date().toISOString(),
    };
    // Autofill is send-only: the server stores the filled copy, but the
    // screen keeps the admin's raw text (filled values appear after reload).
    // Adopt the authoritative version so the next save never 409s.
    const result = await onSaveMenu(updated);
    if (result) {
      setMenu((prev) => ({ ...prev, version: result.doc.version, updatedAt: result.doc.updatedAt }));
      if (result.saved) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2500);
      }
    }
    setDirty(false);
  };

  // Keep a ref to the latest save so the auto-save timer never uses stale state
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  useEffect(() => {
    try {
      localStorage.setItem('admin_autosave_v1', autoSave ? '1' : '0');
    } catch {}
  }, [autoSave]);

  // Auto-save shortly after any change while enabled
  useEffect(() => {
    if (!autoSave || !dirty) return;
    const t = window.setTimeout(() => handleSaveRef.current(), 1200);
    return () => window.clearTimeout(t);
  }, [autoSave, dirty, menu]);

  // Category Actions
  const handleAddCategory = () => {
    const newId = `c_${Date.now().toString(36)}`;
    updateMenu((prev) => ({
      ...prev,
      categories: [
        ...prev.categories,
        { id: newId, name: { en: 'New Category', ar: 'قسم جديد' }, visible: true },
      ],
    }));
  };

  const handleMoveCategory = (index: number, direction: 'up' | 'down') => {
    updateMenu((prev) => {
      const newCats = [...prev.categories];
      const targetIdx = direction === 'up' ? index - 1 : index + 1;
      if (targetIdx < 0 || targetIdx >= newCats.length) return prev;
      const temp = newCats[index];
      newCats[index] = newCats[targetIdx];
      newCats[targetIdx] = temp;
      return { ...prev, categories: newCats };
    });
  };

  const handleDeleteCategory = (catId: string) => {
    const itemsCount = menu.items.filter((i) => i.categoryId === catId).length;
    if (itemsCount > 0) {
      alert(
        isAr
          ? `لا يمكن حذف هذا القسم لأنه يحتوي على ${itemsCount} وجبات. انقلها أو احذفها أولاً.`
          : `Cannot delete this category because it contains ${itemsCount} items. Move or delete them first.`
      );
      return;
    }
    updateMenu((prev) => ({
      ...prev,
      categories: prev.categories.filter((c) => c.id !== catId),
    }));
  };

  // Item Actions
  const handleSaveItemModal = () => {
    if (!editingItem) return;
    if (!editingItem.name.en.trim() && !editingItem.name.ar.trim()) {
      alert(isAr ? 'يرجى إدخال اسم الوجبة' : 'Item name is required');
      return;
    }
    const rawPricing = editingItem.pricing && typeof editingItem.pricing === 'object'
      ? editingItem.pricing
      : { unit: 'pc' as const, minQty: 1, step: 1, maxQty: 50, showUnit: false };
    if (!Number.isInteger(rawPricing.minQty) || rawPricing.minQty < 1) {
      alert(isAr ? 'أقل كمية يجب أن تكون عدداً صحيحاً ≥ 1' : 'Min quantity must be an integer ≥ 1');
      return;
    }
    if (!Number.isInteger(rawPricing.step) || rawPricing.step < 1) {
      alert(isAr ? 'الخطوة يجب أن تكون عدداً صحيحاً ≥ 1' : 'Step must be an integer ≥ 1');
      return;
    }
    if (!Number.isInteger(rawPricing.maxQty) || rawPricing.maxQty < rawPricing.minQty) {
      alert(isAr ? 'أقصى كمية يجب أن تكون عدداً صحيحاً ≥ أقل كمية' : 'Max quantity must be an integer ≥ min quantity');
      return;
    }
    // Sizes and add-ons: feature must exist in the library and be unique
    // per list (the list itself decides the role — no cross checks)
    const variants = Array.isArray(editingItem.variants) ? editingItem.variants : [];
    const seenV = new Set<string>();
    for (const v of variants) {
      if (!v.featureId || seenV.has(v.featureId) || !(menu.settings.featureDefs || []).some((d) => d.id === v.featureId)) {
        alert(isAr ? 'كل حجم يجب أن يختار ميزة موجودة وغير مكررة' : 'Every size must pick an existing, unique feature');
        return;
      }
      seenV.add(v.featureId);
      if (typeof v.price !== 'number' || !Number.isFinite(v.price) || v.price <= 0) {
        alert(isAr ? 'سعر الحجم يجب أن يكون رقماً > 0' : 'Size price must be a number > 0');
        return;
      }
    }
    const addons = Array.isArray(editingItem.addons) ? editingItem.addons : [];
    const seenA = new Set<string>();
    for (const a of addons) {
      if (!a.featureId || seenA.has(a.featureId) || !(menu.settings.featureDefs || []).some((d) => d.id === a.featureId)) {
        alert(isAr ? 'كل إضافة يجب أن تختار ميزة موجودة وغير مكررة' : 'Every add-on must pick an existing, unique feature');
        return;
      }
      seenA.add(a.featureId);
      if (typeof a.price !== 'number' || !Number.isFinite(a.price) || a.price < 0) {
        alert(isAr ? 'سعر الإضافة يجب أن يكون رقماً ≥ 0 (0 = مجاناً)' : 'Add-on price must be a number ≥ 0 (0 = free)');
        return;
      }
    }
    if (variants.length === 0) {
      if (rawPricing.price === undefined || typeof rawPricing.price !== 'number' || !Number.isFinite(rawPricing.price) || rawPricing.price < 0) {
        alert(isAr ? 'السعر يجب أن يكون رقماً ≥ 0 (أو أضف أحجاماً)' : 'Price must be a number ≥ 0 (or add sizes)');
        return;
      }
    }

    // Auto-fill the blank language from the written one
    const pricing = normalizePricing(editingItem);
    const filled: MenuItem = {
      ...editingItem,
      pricing,
      ...(variants.length ? { variants: variants.map((v) => ({ featureId: v.featureId, price: v.price })) } : { variants: undefined }),
      ...(addons.length ? { addons: addons.map((a) => ({ featureId: a.featureId, price: a.price })) } : { addons: undefined }),
      // Keep an explicit default only when it still points at a size
      ...(editingItem.defaultVariant && variants.some((v) => v.featureId === editingItem.defaultVariant)
        ? { defaultVariant: editingItem.defaultVariant }
        : { defaultVariant: undefined }),
      name: {
        en: editingItem.name.en.trim() ? editingItem.name.en : editingItem.name.ar,
        ar: editingItem.name.ar.trim() ? editingItem.name.ar : editingItem.name.en,
      },
      description: {
        en: editingItem.description.en.trim() ? editingItem.description.en : editingItem.description.ar,
        ar: editingItem.description.ar.trim() ? editingItem.description.ar : editingItem.description.en,
      },
    };
    if (!variants.length) delete (filled as Partial<MenuItem>).variants;
    if (!addons.length) delete (filled as Partial<MenuItem>).addons;
    if (!variants.some((v) => v.featureId === filled.defaultVariant)) delete (filled as Partial<MenuItem>).defaultVariant;

    updateMenu((prev) => {
      if (isNewItem) {
        return { ...prev, items: [...prev.items, filled] };
      }
      return {
        ...prev,
        items: prev.items.map((i) => (i.id === filled.id ? filled : i)),
      };
    });

    setEditingItem(null);
  };

  const handleDuplicateItem = (item: MenuItem) => {
    const duplicated: MenuItem = {
      ...item,
      id: `i_${Date.now().toString(36)}`,
      name: {
        en: `${item.name.en} (Copy)`,
        ar: `${item.name.ar} (نسخة)`,
      },
    };
    updateMenu((prev) => ({ ...prev, items: [...prev.items, duplicated] }));
  };

  const handleDeleteItem = (itemId: string) => {
    if (confirm(isAr ? 'هل أنت متأكد من حذف هذا العنصر؟' : 'Are you sure you want to delete this item?')) {
      updateMenu((prev) => ({
        ...prev,
        items: prev.items.filter((i) => i.id !== itemId),
      }));
    }
  };

  const handleMoveItem = (itemId: string, direction: 'up' | 'down') => {
    updateMenu((prev) => {
      const items = [...prev.items];
      const idx = items.findIndex((i) => i.id === itemId);
      if (idx === -1) return prev;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= items.length) return prev;
      const temp = items[idx];
      items[idx] = items[targetIdx];
      items[targetIdx] = temp;
      return { ...prev, items };
    });
  };

  // Export / Import
  const handleExportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(menu, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = `menu_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Allow the same file input to pick the same file twice in a row
    e.target.value = '';
    if (file.size > 256 * 1024) {
      alert(isAr ? 'الملف أكبر من 256KB' : 'File exceeds the 256 KB limit');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        // Early warning: UTF-8 Arabic misread as Latin-1 looks like Ø´Ùˆ…
        // (happens when the file was saved/opened with the wrong encoding).
        if (/[ØÙ][\u0080-\u00BF]/.test(text)) {
          alert(
            isAr
              ? 'تحذير: يبدو أن ترميز الملف ليس UTF-8 (الحروف العربية ستظهر برموز غريبة). أعد حفظ الملف بترميز UTF-8 ثم حاول مجدداً.'
              : 'Warning: this file does not look like UTF-8 (Arabic will show as garbled symbols). Re-save it as UTF-8 and try again.'
          );
          return;
        }
        const parsed = JSON.parse(text);
        // Strict shared validation: unknown/invalid fields are cleaned,
        // missing optional fields get safe defaults — so varied files import cleanly.
        const checked = validateMenu(parsed as never);
        if (!checked.ok || !checked.value) {
          const details = checked.errors.slice(0, 3).join('\n');
          alert(
            (isAr ? 'ملف غير صالح:\n' : 'Invalid menu file:\n') + details ||
              (isAr ? 'صيغة غير مدعومة' : 'Unsupported format')
          );
          return;
        }
        setMenu(checked.value as unknown as MenuData);
        setDirty(true);
        const n = checked.value.items.length;
        alert(
          isAr
            ? `تم استيراد ${n} صنف بنجاح! اضغط حفظ (أو انتظر الحفظ التلقائي).`
            : `Imported ${n} items successfully! Click Save (or wait for auto-save).`
        );
      } catch {
        alert(isAr ? 'تعذر قراءة ملف JSON' : 'Failed to parse JSON file');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white p-4 sm:p-6 md:p-8 pb-24 font-sans max-w-4xl mx-auto">
      {/* Top Bar */}
      <div className="flex items-center justify-between pb-4 border-b border-neutral-800">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-2 text-sm font-bold text-[#FFC400] hover:underline"
        >
          <ArrowLeft size={16} />
          <span>{isAr ? 'العودة للموقع الرئيسي' : 'Back to Live Menu'}</span>
        </button>

        <div className="flex items-center gap-2">
          {saveSuccess && (
            <span className="flex items-center gap-1 text-xs text-green-400 font-bold">
              <Check size={14} /> {isAr ? 'تم الحفظ!' : 'Saved!'}
            </span>
          )}
          {onToggleLang && (
            <button
              type="button"
              onClick={onToggleLang}
              aria-label={isAr ? 'Switch to English' : 'التبديل إلى العربية'}
              title={isAr ? 'Switch to English' : 'التبديل إلى العربية'}
              className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-neutral-800 border border-neutral-700 text-neutral-300 hover:text-[#FFC400] hover:border-[#FFC400]/60 transition-colors"
            >
              <Globe size={14} />
              <span>{isAr ? 'EN' : 'عربي'}</span>
            </button>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={autoSave}
            aria-label={isAr ? 'الحفظ التلقائي' : 'Auto-save'}
            title={isAr ? 'حفظ تلقائي لكل تعديل' : 'Auto-save every change'}
            onClick={() => setAutoSave((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full border transition-colors cursor-pointer"
            style={{ borderColor: autoSave ? '#FFC400' : '#3f3f46', color: autoSave ? '#FFC400' : '#a1a1aa' }}
          >
            <span
              className={`relative w-8 h-[18px] rounded-full transition-colors duration-200 ${autoSave ? 'bg-[#FFC400]' : 'bg-neutral-700'}`}
            >
              <span
                className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-all duration-200 ${autoSave ? 'left-[18px]' : 'left-[2px]'}`}
              />
            </span>
            <span>{isAr ? 'حفظ تلقائي' : 'Auto-save'}</span>
          </button>
          {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            className="text-xs px-2.5 py-1 rounded-full bg-neutral-800 border border-neutral-700 text-neutral-400 hover:text-red-400 hover:border-red-400/60 transition-colors font-bold"
          >
            {isAr ? 'تسجيل الخروج' : 'Sign out'}
          </button>
        )}
        </div>
      </div>

      <h1 className="text-2xl font-black mt-4 mb-2 flex items-center gap-2.5">
        <img
          src="/assets/pan-icon-yellow.png"
          alt=""
          aria-hidden="true"
          draggable={false}
          className="w-8 h-8 object-contain -rotate-12"
        />
        <span>{isAr ? 'إدارة قائمة الطعام' : 'Menu Management'}</span>
      </h1>

      {/* Tabs */}
      <div className="flex gap-1.5 p-1 bg-neutral-900 rounded-2xl border border-neutral-800 mt-4 mb-6 overflow-x-auto">
        {(['dashboard', 'settings', 'categories', 'items', 'backup'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => {
            setActiveTab(tab);
            setCatPage(0);
            setItemPage(0);
          }}
            className={`flex-1 whitespace-nowrap px-3 py-2 rounded-xl text-xs font-bold capitalize transition-all ${
              activeTab === tab
                ? 'bg-[#FFC400] text-[#0A0A0A] shadow-md'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            {tab === 'dashboard' && (isAr ? 'الطلبات' : 'Dashboard')}
            {tab === 'settings' && (isAr ? 'الإعدادات' : 'Settings')}
            {tab === 'categories' && (isAr ? 'الأقسام' : 'Categories')}
            {tab === 'items' && (isAr ? 'الوجبات' : 'Items')}
            {tab === 'backup' && (isAr ? 'النسخ الاحتياطي' : 'Backup')}
          </button>
        ))}
      </div>

      {/* TAB 0: ORDERS DASHBOARD */}
      {activeTab === 'dashboard' && (
        <>
          {ordersError && (
            <div className="mb-3 flex items-center justify-between gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs font-bold">
              <span>{isAr ? 'تعذر تحميل الطلبات.' : 'Could not load orders.'}</span>
              <button
                type="button"
                onClick={() => fetchOrders(false)}
                className="px-3 py-1.5 rounded-full bg-red-500/20 hover:bg-red-500/30 transition-colors"
              >
                {isAr ? 'إعادة المحاولة' : 'Retry'}
              </button>
            </div>
          )}
          <OrdersDashboard
            lang={lang}
            orders={orders}
            currency={menu.settings.currency[lang] || menu.settings.currency.en}
            loading={ordersLoading}
            onStatusChange={handleOrderStatusChange}
            onRefresh={() => fetchOrders(false)}
          />
        </>
      )}

      {/* TAB 1: SETTINGS */}
      {activeTab === 'settings' && (
        <div className="space-y-6">
          {/* Restaurant Identity */}
          <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4">
            <h2 className="text-sm font-extrabold text-[#FFC400] uppercase tracking-wider">
              {isAr ? 'بيانات المطعم' : 'Restaurant Identity'}
            </h2>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-neutral-400 mb-1">Name (EN)</label>
                <input
                  type="text"
                  value={menu.settings.name.en}
                  onChange={(e) =>
                    updateMenu((m) => ({
                      ...m,
                      settings: { ...m.settings, name: { ...m.settings.name, en: e.target.value } },
                    }))
                  }
                  className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[#FFC400]"
                />
              </div>
              <div>
                <label className="block text-xs text-neutral-400 mb-1">الاسم (AR)</label>
                <input
                  type="text"
                  dir="rtl"
                  value={menu.settings.name.ar}
                  onChange={(e) =>
                    updateMenu((m) => ({
                      ...m,
                      settings: { ...m.settings, name: { ...m.settings.name, ar: e.target.value } },
                    }))
                  }
                  className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[#FFC400]"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-neutral-400 mb-1">Tagline (EN)</label>
                <input
                  type="text"
                  value={menu.settings.tagline.en}
                  onChange={(e) =>
                    updateMenu((m) => ({
                      ...m,
                      settings: { ...m.settings, tagline: { ...m.settings.tagline, en: e.target.value } },
                    }))
                  }
                  className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[#FFC400]"
                />
              </div>
              <div>
                <label className="block text-xs text-neutral-400 mb-1">الشعار اللفظي (AR)</label>
                <input
                  type="text"
                  dir="rtl"
                  value={menu.settings.tagline.ar}
                  onChange={(e) =>
                    updateMenu((m) => ({
                      ...m,
                      settings: { ...m.settings, tagline: { ...m.settings.tagline, ar: e.target.value } },
                    }))
                  }
                  className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[#FFC400]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="block text-xs text-neutral-400 mb-1">About / Footer Description (EN)</label>
                <textarea
                  rows={2}
                  value={menu.settings.about.en}
                  onChange={(e) =>
                    updateMenu((m) => ({
                      ...m,
                      settings: { ...m.settings, about: { ...m.settings.about, en: e.target.value } },
                    }))
                  }
                  className="w-full px-3 py-2 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[#FFC400]"
                />
              </div>
              <div>
                <label className="block text-xs text-neutral-400 mb-1">وصف الفوتر (AR)</label>
                <textarea
                  rows={2}
                  dir="rtl"
                  value={menu.settings.about.ar}
                  onChange={(e) =>
                    updateMenu((m) => ({
                      ...m,
                      settings: { ...m.settings, about: { ...m.settings.about, ar: e.target.value } },
                    }))
                  }
                  className="w-full px-3 py-2 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[#FFC400]"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-neutral-400 mb-1">Phone</label>
                <input
                  type="text"
                  value={menu.settings.phone}
                  onChange={(e) =>
                    updateMenu((m) => ({
                      ...m,
                      settings: { ...m.settings, phone: e.target.value },
                    }))
                  }
                  className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[#FFC400]"
                />
              </div>
              <div>
                <label className="block text-xs text-neutral-400 mb-1">WhatsApp (Digits only)</label>
                <input
                  type="text"
                  value={menu.settings.whatsapp}
                  onChange={(e) =>
                    updateMenu((m) => ({
                      ...m,
                      settings: { ...m.settings, whatsapp: e.target.value },
                    }))
                  }
                  placeholder="201000000000"
                  className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[#FFC400]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-neutral-400 mb-1">Google Maps URL</label>
              <input
                type="text"
                value={menu.settings.mapUrl}
                onChange={(e) =>
                  updateMenu((m) => ({
                    ...m,
                    settings: { ...m.settings, mapUrl: e.target.value },
                  }))
                }
                className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[#FFC400]"
              />
            </div>

            {/* Currency Configuration */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'رمز العملة (إنجليزي)' : 'Currency Symbol (EN)'}</label>
                <input
                  type="text"
                  value={menu.settings.currency.en}
                  onChange={(e) =>
                    updateMenu((m) => ({
                      ...m,
                      settings: {
                        ...m.settings,
                        currency: { ...m.settings.currency, en: e.target.value },
                      },
                    }))
                  }
                  placeholder="LBP"
                  className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[#FFC400]"
                />
              </div>
              <div>
                <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'رمز العملة (عربي)' : 'Currency Symbol (AR)'}</label>
                <input
                  type="text"
                  value={menu.settings.currency.ar}
                  onChange={(e) =>
                    updateMenu((m) => ({
                      ...m,
                      settings: {
                        ...m.settings,
                        currency: { ...m.settings.currency, ar: e.target.value },
                      },
                    }))
                  }
                  placeholder="ل.ل"
                  className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[#FFC400]"
                />
              </div>
            </div>
          </div>

          {/* Social Media: per-platform switch + URL */}
          <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4">
            <div>
              <h2 className="text-sm font-extrabold text-[#FFC400] uppercase tracking-wider">
                {isAr ? 'التواصل الاجتماعي' : 'Social Media'}
              </h2>
              <p className="text-[11px] text-neutral-500 mt-0.5">
                {isAr ? 'شغّل المنصة اللي عايزها وحط الرابط بتاعها' : 'Turn on a platform and paste its link'}
              </p>
            </div>

            {(['instagram', 'facebook', 'tiktok'] as const).map((network) => {
              const on = !!menu.settings.socialEnabled?.[network];
              const label = network === 'instagram' ? 'Instagram' : network === 'facebook' ? 'Facebook' : 'TikTok';
              return (
                <div key={network} className="rounded-xl border border-neutral-800 bg-black/40 p-3 space-y-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={label}
                    onClick={() =>
                      updateMenu((m) => ({
                        ...m,
                        settings: {
                          ...m.settings,
                          socialEnabled: { ...m.settings.socialEnabled, [network]: !m.settings.socialEnabled?.[network] },
                        },
                      }))
                    }
                    className="w-full flex items-center justify-between gap-3 text-start"
                  >
                    <span className="text-xs font-bold">{label}</span>
                    <span
                      className={`relative w-11 h-6 flex-shrink-0 rounded-full transition-colors duration-200 ${
                        on ? 'bg-[#FFC400]' : 'bg-neutral-700'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${
                          on ? (isAr ? 'left-0.5' : 'left-5') : (isAr ? 'left-5' : 'left-0.5')
                        }`}
                      />
                    </span>
                  </button>
                  <div className={on ? '' : 'opacity-40 pointer-events-none'}>
                    <label className="block text-xs text-neutral-400 mb-1">{label} URL (https://…)</label>
                    <input
                      type="text"
                      dir="ltr"
                      value={menu.settings.social?.[network] || ''}
                      onChange={(e) =>
                        updateMenu((m) => ({
                          ...m,
                          settings: {
                            ...m.settings,
                            social: { ...m.settings.social, [network]: e.target.value },
                          },
                        }))
                      }
                      placeholder={`https://${network}.com/…`}
                      className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[#FFC400]"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* New Visitor Defaults: theme + language for first-time visitors only.
              Anyone who already picked their own keeps it (stored on their device). */}
          <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4">
            <div>
              <h2 className="text-sm font-extrabold text-[#FFC400] uppercase tracking-wider">
                {isAr ? 'الوضع الافتراضي للزوار الجدد' : 'New Visitor Defaults'}
              </h2>
              <p className="text-[11px] text-neutral-500 mt-0.5">
                {isAr
                  ? 'يطبق فقط على أول زيارة — اختيار العميل محفوظ دائماً'
                  : 'First visit only — a returning visitor keeps their own choice'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'المظهر الافتراضي' : 'Default theme'}</label>
                <select
                  value={menu.settings.defaultTheme === 'light' ? 'light' : 'dark'}
                  onChange={(e) =>
                    updateMenu((m) => ({
                      ...m,
                      settings: {
                        ...m.settings,
                        defaultTheme: (e.target.value === 'light' ? 'light' : 'dark') as 'dark' | 'light',
                      },
                    }))
                  }
                  className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[#FFC400]"
                >
                  <option value="dark">{isAr ? 'ليلي (افتراضي)' : 'Dark (default)'}</option>
                  <option value="light">{isAr ? 'نهاري' : 'Light'}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'اللغة الافتراضية' : 'Default language'}</label>
                <select
                  value={menu.settings.defaultLang === 'ar' ? 'ar' : 'en'}
                  onChange={(e) =>
                    updateMenu((m) => ({
                      ...m,
                      settings: {
                        ...m.settings,
                        defaultLang: (e.target.value === 'ar' ? 'ar' : 'en') as 'en' | 'ar',
                      },
                    }))
                  }
                  className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[#FFC400]"
                >
                  <option value="en">{isAr ? 'الإنجليزية (افتراضي)' : 'English (default)'}</option>
                  <option value="ar">{isAr ? 'العربية' : 'Arabic'}</option>
                </select>
              </div>
            </div>
          </div>

          {/* Operational Hours */}
          <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4">
            <h2 className="text-sm font-extrabold text-[#FFC400] uppercase tracking-wider">
              {isAr ? 'مواعيد العمل والحالة' : 'Working Hours & Status'}
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'وضع الحالة' : 'Status Mode'}</label>
                <select
                  value={menu.settings.statusMode}
                  onChange={(e) =>
                    updateMenu((m) => ({
                      ...m,
                      settings: {
                        ...m.settings,
                        statusMode: e.target.value as 'auto' | 'open' | 'closed',
                      },
                    }))
                  }
                  className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[#FFC400]"
                >
                  <option value="auto">{isAr ? 'تلقائي (حسب المواعيد)' : 'Auto (from hours)'}</option>
                  <option value="open">{isAr ? 'مفتوح دائماً' : 'Always Open'}</option>
                  <option value="closed">{isAr ? 'مغلق دائماً' : 'Always Closed'}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'وقت الفتح (ساعة:دقيقة)' : 'Open Time (HH:MM)'}</label>
                <input
                  type="time"
                  value={menu.settings.openTime}
                  onChange={(e) =>
                    updateMenu((m) => ({
                      ...m,
                      settings: { ...m.settings, openTime: e.target.value },
                    }))
                  }
                  className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[#FFC400] [color-scheme:dark]"
                />
              </div>

              <div>
                <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'وقت الإغلاق (ساعة:دقيقة)' : 'Close Time (HH:MM)'}</label>
                <input
                  type="time"
                  value={menu.settings.closeTime}
                  onChange={(e) =>
                    updateMenu((m) => ({
                      ...m,
                      settings: { ...m.settings, closeTime: e.target.value },
                    }))
                  }
                  className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[#FFC400] [color-scheme:dark]"
                />
              </div>
            </div>

        {/* Live AM/PM preview so open/close are never ambiguous */}
        <p className="text-xs font-bold text-[#FFC400]">
          {isAr
            ? `يفتح ${formatTime12h(menu.settings.openTime, true)} – يغلق ${formatTime12h(menu.settings.closeTime, true)}`
            : `Opens ${formatTime12h(menu.settings.openTime, false)} – Closes ${formatTime12h(menu.settings.closeTime, false)}`}
        </p>

        {/* Working days: tap to include/exclude a day */}
        <div>
          <span className="block text-xs text-neutral-400 mb-2">
            {isAr ? 'أيام العمل (اضغط لتفعيل/إيقاف اليوم)' : 'Working days (tap to toggle)'}
          </span>
          <div className="flex flex-wrap gap-2">
            {([
              { id: 'sat', en: 'Sat', ar: 'السبت' },
              { id: 'sun', en: 'Sun', ar: 'الأحد' },
              { id: 'mon', en: 'Mon', ar: 'الاثنين' },
              { id: 'tue', en: 'Tue', ar: 'الثلاثاء' },
              { id: 'wed', en: 'Wed', ar: 'الأربعاء' },
              { id: 'thu', en: 'Thu', ar: 'الخميس' },
              { id: 'fri', en: 'Fri', ar: 'الجمعة' },
            ] as const).map((d) => {
              const days = menu.settings.workingDays && menu.settings.workingDays.length
                ? menu.settings.workingDays
                : ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
              const on = days.includes(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => {
                    const current = menu.settings.workingDays && menu.settings.workingDays.length
                      ? menu.settings.workingDays
                      : ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
                    const next = current.includes(d.id)
                      ? current.filter((x) => x !== d.id)
                      : [...current, d.id];
                    updateMenu((m) => ({
                      ...m,
                      settings: { ...m.settings, workingDays: next.length ? next : [...current] },
                    }));
                  }}
                  aria-pressed={on}
                  title={isAr ? d.ar : d.en}
                  className={`h-9 min-w-[52px] px-3 rounded-full text-xs font-bold border-[1.5px] transition-all btn-tactile ${
                    on
                      ? 'bg-[#FFC400] text-[#0A0A0A] border-[#FFC400]'
                      : 'bg-transparent text-neutral-400 border-neutral-700 hover:border-neutral-500'
                  }`}
                >
                  {isAr ? d.ar : d.en}
                </button>
              );
            })}
          </div>
        </div>
      </div>

          {/* Ordering Configuration */}
          <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4">
            <div>
              <h2 className="text-sm font-extrabold text-[#FFC400] uppercase tracking-wider">
                {isAr ? 'إعدادات الطلبات' : 'Ordering System'}
              </h2>
              <p className="text-[11px] text-neutral-500 mt-0.5">
                {isAr ? 'التوصيل فقط — فعّل الحد الأدنى أو رسوم التوصيل أدناه' : 'Delivery only — enable a minimum order or a delivery fee below'}
              </p>
            </div>

            {/* Min Order toggle + value */}
            <div className="rounded-xl border border-neutral-800 bg-black/40 p-3 space-y-3">
              <button
                type="button"
                role="switch"
                aria-checked={!!menu.settings.ordering.minOrderEnabled}
                onClick={() =>
                  updateMenu((m) => ({
                    ...m,
                    settings: {
                      ...m.settings,
                      ordering: { ...m.settings.ordering, minOrderEnabled: !m.settings.ordering.minOrderEnabled },
                    },
                  }))
                }
                className="w-full flex items-center justify-between gap-3 text-start"
              >
                <span>
                  <span className="block text-xs font-bold">
                    {isAr ? 'تفعيل الحد الأدنى للطلب' : 'Enable minimum order'}
                  </span>
                  <span className="block text-[11px] text-neutral-500 mt-0.5">
                    {menu.settings.ordering.minOrderEnabled
                      ? (isAr ? 'مفعّل — يظهر في السلة' : 'On — shown in the cart')
                      : (isAr ? 'مطفأ (الافتراضي)' : 'Off (default)')}
                  </span>
                </span>
                <span
                  className={`relative w-11 h-6 flex-shrink-0 rounded-full transition-colors duration-200 ${
                    menu.settings.ordering.minOrderEnabled ? 'bg-[#FFC400]' : 'bg-neutral-700'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${
                      menu.settings.ordering.minOrderEnabled
                        ? (isAr ? 'left-0.5' : 'left-5')
                        : (isAr ? 'left-5' : 'left-0.5')
                    }`}
                  />
                </span>
              </button>
              {menu.settings.ordering.minOrderEnabled && (
                <div className="anim-fade-in">
                  <label className="block text-xs text-neutral-400 mb-1">Min Order ({menu.settings.currency.en})</label>
                  <input
                    type="number"
                    step="any"
                    value={menu.settings.ordering.minOrder}
                    onChange={(e) =>
                      updateMenu((m) => ({
                        ...m,
                        settings: {
                          ...m.settings,
                          ordering: { ...m.settings.ordering, minOrder: Number(e.target.value) },
                        },
                      }))
                    }
                    className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[#FFC400]"
                  />
                </div>
              )}
            </div>

            {/* Delivery Fee toggle + value */}
            <div className="rounded-xl border border-neutral-800 bg-black/40 p-3 space-y-3">
              <button
                type="button"
                role="switch"
                aria-checked={!!menu.settings.ordering.deliveryFeeEnabled}
                onClick={() =>
                  updateMenu((m) => ({
                    ...m,
                    settings: {
                      ...m.settings,
                      ordering: { ...m.settings.ordering, deliveryFeeEnabled: !m.settings.ordering.deliveryFeeEnabled },
                    },
                  }))
                }
                className="w-full flex items-center justify-between gap-3 text-start"
              >
                <span>
                  <span className="block text-xs font-bold">
                    {isAr ? 'تفعيل رسوم التوصيل' : 'Enable delivery fee'}
                  </span>
                  <span className="block text-[11px] text-neutral-500 mt-0.5">
                    {menu.settings.ordering.deliveryFeeEnabled
                      ? (isAr ? 'مفعّلة — تظهر في السلة' : 'On — shown in the cart')
                      : (isAr ? 'مطفأة (الافتراضي)' : 'Off (default)')}
                  </span>
                </span>
                <span
                  className={`relative w-11 h-6 flex-shrink-0 rounded-full transition-colors duration-200 ${
                    menu.settings.ordering.deliveryFeeEnabled ? 'bg-[#FFC400]' : 'bg-neutral-700'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${
                      menu.settings.ordering.deliveryFeeEnabled
                        ? (isAr ? 'left-0.5' : 'left-5')
                        : (isAr ? 'left-5' : 'left-0.5')
                    }`}
                  />
                </span>
              </button>
              {menu.settings.ordering.deliveryFeeEnabled && (
                <div className="anim-fade-in">
                  <label className="block text-xs text-neutral-400 mb-1">Delivery Fee ({menu.settings.currency.en})</label>
                  <input
                    type="number"
                    step="any"
                    value={menu.settings.ordering.deliveryFee}
                    onChange={(e) =>
                      updateMenu((m) => ({
                        ...m,
                        settings: {
                          ...m.settings,
                          ordering: { ...m.settings.ordering, deliveryFee: Number(e.target.value) },
                        },
                      }))
                    }
                    className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[#FFC400]"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Features Library (names only — prices are set per item) */}
          <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4">
            <div>
              <h2 className="text-sm font-extrabold text-[#FFC400] uppercase tracking-wider">
                {isAr ? 'مكتبة الميزات' : 'Features Library'}
              </h2>
              <p className="text-[11px] text-neutral-500 mt-0.5">
                {isAr
                  ? 'جهّز الخيارات هنا مرة واحدة بالأسماء، ثم فعّلها وسعّرها من داخل كل صنف'
                  : 'Define the options here once by name, then enable and price them inside each item'}
              </p>
            </div>

            {featuresByGroup(menu).map(({ group, features }) => (
              <div key={group.id || '(ungrouped)'} className="rounded-xl border border-neutral-800 bg-black/40 overflow-hidden">
                <button
                  type="button"
                  onClick={() => group.id && setCollapsedGroups((p) => ({ ...p, [group.id]: !p[group.id] }))}
                  className="w-full flex items-center justify-between gap-3 p-3 text-start"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <ChevronDown size={15} className={`shrink-0 text-neutral-500 transition-transform duration-300 ${collapsedGroups[group.id] ? '' : 'rotate-180'}`} />
                    <span className="font-extrabold text-sm text-white truncate">
                      {group.id ? (isAr ? group.name.ar : group.name.en) || group.id : (isAr ? 'أخرى' : 'Other')}
                    </span>
                    <span className="shrink-0 text-[11px] text-neutral-500 tabular-nums">{features.length}</span>
                  </span>
                  {group.id ? (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        const sectionName = ((isAr ? group.name.ar : group.name.en) || group.id) as string;
                        const inItems = menu.items.filter(
                          (it) =>
                            (it.variants || []).some((v) => (menu.settings.featureDefs || []).some((x) => x.id === v.featureId && x.groupId === group.id)) ||
                            (it.addons || []).some((a) => (menu.settings.featureDefs || []).some((x) => x.id === a.featureId && x.groupId === group.id))
                        ).length;
                        if (inItems > 0) {
                          setConfirmBox({
                            title: isAr ? `حذف قسم "${sectionName}"؟` : `Delete the "${sectionName}" section?`,
                            body: isAr
                              ? `ميزاته مستخدمة في ${inItems === 1 ? 'صنف واحد' : `${inItems} أصناف`}. احذفها من الأصناف أولاً ثم احذف القسم.`
                              : `Its features are used by ${inItems === 1 ? '1 item' : `${inItems} items`}. Remove them from the items first, then delete the section.`,
                            confirmText: '',
                            mode: 'info',
                          });
                          return;
                        }
                        const n = (menu.settings.featureDefs || []).filter((x) => x.groupId === group.id).length;
                        setConfirmBox({
                          title: isAr ? `حذف قسم "${sectionName}"؟` : `Delete the "${sectionName}" section?`,
                          body: isAr
                            ? n === 0
                              ? 'القسم فارغ. الحذف نهائي ولا يمكن التراجع عنه.'
                              : `القسم فيه ${n === 1 ? 'ميزة واحدة' : `${n} ميزات`} وستحذف معه. الحذف نهائي ولا يمكن التراجع عنه.`
                            : n === 0
                              ? 'The section is empty. Deletion is permanent and cannot be undone.'
                              : `The section holds ${n === 1 ? '1 feature' : `${n} features`}, which will be deleted with it. Deletion is permanent and cannot be undone.`,
                          confirmText: isAr ? 'حذف القسم' : 'Delete section',
                          action: () =>
                            updateMenu((m) => ({
                              ...m,
                              settings: {
                                ...m.settings,
                                featureGroups: (m.settings.featureGroups || []).filter((x) => x.id !== group.id),
                                featureDefs: (m.settings.featureDefs || []).filter((x) => x.groupId !== group.id),
                              },
                            })),
                        });
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
                      className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-red-500/40 text-red-400 text-[11px] font-bold hover:bg-red-500/10 transition-colors cursor-pointer"
                    >
                      <Trash2 size={12} />
                      {isAr ? 'حذف القسم' : 'Delete section'}
                    </span>
                  ) : null}
                </button>

                {!collapsedGroups[group.id] && (
                  <div className="px-3 pb-3 space-y-3">
                    {group.id ? (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'اسم القسم (EN)' : 'Section name (EN)'}</label>
                          <input
                            type="text"
                            value={group.name.en}
                            onChange={(e) =>
                              updateMenu((m) => ({
                                ...m,
                                settings: {
                                  ...m.settings,
                                  featureGroups: (m.settings.featureGroups || []).map((x) =>
                                    x.id === group.id ? { ...x, name: { ...x.name, en: e.target.value } } : x
                                  ),
                                },
                              }))
                            }
                            className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'اسم القسم (AR)' : 'Section name (AR)'}</label>
                          <input
                            type="text"
                            dir="rtl"
                            value={group.name.ar}
                            onChange={(e) =>
                              updateMenu((m) => ({
                                ...m,
                                settings: {
                                  ...m.settings,
                                  featureGroups: (m.settings.featureGroups || []).map((x) =>
                                    x.id === group.id ? { ...x, name: { ...x.name, ar: e.target.value } } : x
                                  ),
                                },
                              }))
                            }
                            className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm"
                          />
                        </div>
                      </div>
                    ) : null}
                    {features.length === 0 ? (
                      <p className="text-[11px] text-neutral-500">
                        {isAr ? 'فارغ — أضف ميزة من الزر أدناه.' : 'Empty — add a feature below.'}
                      </p>
                    ) : (
                      <div className="rounded-xl border border-neutral-800 bg-black/40 divide-y divide-neutral-800 overflow-hidden">
                        {features.map((f) => {
                      const usage = menu.items.filter(
                        (it) =>
                          (it.variants || []).some((v) => v.featureId === f.id) ||
                          (it.addons || []).some((a) => a.featureId === f.id)
                      ).length;
                      return (
                        <div key={f.id} className="p-3 space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs text-neutral-400 mb-1">Name (EN)</label>
                              <input
                                type="text"
                                value={f.name.en}
                                onChange={(e) =>
                                  updateMenu((m) => ({
                                    ...m,
                                    settings: {
                                      ...m.settings,
                                      featureDefs: (m.settings.featureDefs || []).map((x) =>
                                        x.id === f.id ? { ...x, name: { ...x.name, en: e.target.value } } : x
                                      ),
                                    },
                                  }))
                                }
                                className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-neutral-400 mb-1">الاسم (AR)</label>
                              <input
                                type="text"
                                dir="rtl"
                                value={f.name.ar}
                                onChange={(e) =>
                                  updateMenu((m) => ({
                                    ...m,
                                    settings: {
                                      ...m.settings,
                                      featureDefs: (m.settings.featureDefs || []).map((x) =>
                                        x.id === f.id ? { ...x, name: { ...x.name, ar: e.target.value } } : x
                                      ),
                                    },
                                  }))
                                }
                                className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm"
                              />
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[11px] text-neutral-500">
                              {usage > 0
                                ? isAr ? `مستخدمة في ${usage} أصناف` : `Used by ${usage} items`
                                : isAr ? 'غير مستخدمة' : 'Unused'}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const n = menu.items.filter(
                                  (it) =>
                                    (it.variants || []).some((v) => v.featureId === f.id) ||
                                    (it.addons || []).some((a) => a.featureId === f.id)
                                ).length;
                                if (n > 0) {
                                  const featName = ((isAr ? f.name.ar : f.name.en) || f.id) as string;
                                  setConfirmBox({
                                    title: isAr ? `حذف "${featName}"؟` : `Delete "${featName}"?`,
                                    body: isAr
                                      ? `مستخدمة في ${n === 1 ? 'صنف واحد' : `${n} أصناف`}. احذفها من الأصناف أولاً ثم احذفها من هنا.`
                                      : `Used by ${n === 1 ? '1 item' : `${n} items`}. Remove it from the items first, then delete it here.`,
                                    confirmText: '',
                                    mode: 'info',
                                  });
                                  return;
                                }
                                const featName = ((isAr ? f.name.ar : f.name.en) || f.id) as string;
                                setConfirmBox({
                                  title: isAr ? `حذف "${featName}"؟` : `Delete "${featName}"?`,
                                  body: isAr
                                    ? 'غير مستخدمة حالياً. الحذف نهائي ولا يمكن التراجع عنه.'
                                    : 'Currently unused. Deletion is permanent and cannot be undone.',
                                  confirmText: isAr ? 'حذف' : 'Delete',
                                  action: () =>
                                    updateMenu((m) => ({
                                      ...m,
                                      settings: {
                                        ...m.settings,
                                        featureDefs: (m.settings.featureDefs || []).filter((x) => x.id !== f.id),
                                      },
                                    })),
                                });
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-red-500/40 text-red-400 text-[11px] font-bold hover:bg-red-500/10 transition-colors"
                            >
                              <Trash2 size={12} />
                              {isAr ? 'حذف' : 'Delete'}
                            </button>
                          </div>
                        </div>
                      );
                      })}
                      </div>
                    )}

                    {group.id ? (
                      <div>
                        <button
                          type="button"
                          onClick={() =>
                            updateMenu((m) => ({
                              ...m,
                              settings: {
                                ...m.settings,
                                featureDefs: [
                                  ...(m.settings.featureDefs || []),
                                  { id: `f_${Date.now().toString(36)}`, groupId: group.id, name: { en: '', ar: '' } },
                                ],
                              },
                            }))
                          }
                          className="btn-tactile px-3 py-1.5 rounded-full border border-neutral-700 text-neutral-300 text-[11px] font-bold hover:border-[#FFC400] hover:text-[#FFC400]"
                        >
                          <Plus size={12} className="inline me-1" />
                          {isAr ? 'إضافة هنا' : 'Add here'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ))}

            <div>
              <button
                type="button"
                onClick={() =>
                  updateMenu((m) => ({
                    ...m,
                    settings: {
                      ...m.settings,
                      featureGroups: [
                        ...(m.settings.featureGroups || []),
                        {
                          id: `g_${Date.now().toString(36)}`,
                          name: { en: 'New section', ar: 'قسم جديد' },
                        },
                      ],
                    },
                  }))
                }
                className="btn-tactile px-3.5 h-10 rounded-xl bg-[#FFC400] text-[#0A0A0A] text-xs font-bold flex items-center gap-1 shadow-md"
              >
                <Plus size={14} />
                <span>{isAr ? 'إضافة قسم' : 'Add section'}</span>
              </button>
            </div>
            <p className="text-[11px] text-neutral-500">
              {isAr
                ? 'السعر يتحدد لكل صنف على حدة (0 = مجاناً للإضافات).'
                : 'Prices are set per item (0 = free for add-ons).'}
            </p>
          </div>

          {/* Smart Badges */}
          <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4">
            <div>
              <h2 className="text-sm font-extrabold text-[#FFC400] uppercase tracking-wider">
                {isAr ? 'الشارات الذكية' : 'Smart Badges'}
              </h2>
              <p className="text-[11px] text-neutral-500 mt-0.5">
                {isAr
                  ? 'NEW تلقائية بمؤقت، وTop من المبيعات باعتمادك'
                  : 'Automatic time-based NEW, sales-driven Top on your approval'}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {([
                { k: 'newDays', label: isAr ? 'مدة NEW (يوم)' : 'NEW days', hint: isAr ? 'تتشال لوحدها بعدها' : 'auto-removed after' },
                { k: 'topDays', label: isAr ? 'نافذة المبيعات (يوم)' : 'Sales window (days)', hint: isAr ? 'آخر كام يوم' : 'last N days' },
                { k: 'topCount', label: isAr ? 'عدد الـ Top' : 'Top count', hint: isAr ? 'أول كام صنف' : 'top N items' },
              ] as const).map((f) => (
                <div key={f.k}>
                  <label className="block text-xs text-neutral-400 mb-1">{f.label}</label>
                  <input
                    type="number"
                    step={1}
                    value={menu.settings.badges[f.k] ?? ''}
                    onChange={(e) =>
                      updateMenu((m) => ({
                        ...m,
                        settings: {
                          ...m.settings,
                          badges: { ...m.settings.badges, [f.k]: Number(e.target.value) },
                        },
                      }))
                    }
                    className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm"
                  />
                  <p className="text-[10px] text-neutral-500 mt-0.5">{f.hint}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Featured Carousel autoplay */}
          <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4">
            <button
              type="button"
              role="switch"
              aria-checked={menu.settings.featuredAutoplay !== false}
              onClick={() =>
                updateMenu((m) => ({
                  ...m,
                  settings: {
                    ...m.settings,
                    featuredAutoplay: !(m.settings.featuredAutoplay !== false),
                  },
                }))
              }
              className="w-full flex items-center justify-between gap-3 text-start"
            >
              <span>
                <span className="block text-sm font-extrabold text-[#FFC400] uppercase tracking-wider">
                  {isAr ? 'تحريك قسم المميز تلقائياً' : 'Featured Carousel Autoplay'}
                </span>
                <span className="block text-[11px] text-neutral-500 mt-0.5">
                  {(menu.settings.featuredAutoplay !== false)
                    ? (isAr ? 'يتحرك تلقائياً — يتوقف عند اللمس' : 'Auto-slides — pauses on touch')
                    : (isAr ? 'متوقف — يتحرك يدوياً فقط' : 'Off — manual scroll only')}
                </span>
              </span>
              <span
                className={`relative w-11 h-6 flex-shrink-0 rounded-full transition-colors duration-200 ${
                  menu.settings.featuredAutoplay !== false ? 'bg-[#FFC400]' : 'bg-neutral-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${
                    menu.settings.featuredAutoplay !== false
                      ? (isAr ? 'left-0.5' : 'left-5')
                      : (isAr ? 'left-5' : 'left-0.5')
                  }`}
                />
              </span>
            </button>
            {menu.settings.featuredAutoplay !== false && (
              <div className="anim-fade-in">
                <label className="block text-xs text-neutral-400 mb-1">
                  {isAr ? 'كل كام ثانية يتحرك؟ (2 - 10)' : 'Slide every N seconds (2 - 10)'}
                </label>
                <input
                  type="number"
                  min={2}
                  max={10}
                  value={menu.settings.featuredAutoplayInterval || 4}
                  onChange={(e) =>
                    updateMenu((m) => ({
                      ...m,
                      settings: {
                        ...m.settings,
                        featuredAutoplayInterval: Math.min(10, Math.max(2, Number(e.target.value) || 4)),
                      },
                    }))
                  }
                  className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[#FFC400]"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: CATEGORIES */}
      {activeTab === 'categories' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-sm font-extrabold text-[#FFC400] uppercase tracking-wider">
              {menu.categories.length} {isAr ? 'أقسام مضافة' : 'Categories'}
            </h2>
            <button
              type="button"
              onClick={handleAddCategory}
              className="btn-tactile px-3.5 py-1.5 rounded-full bg-[#FFC400] text-[#0A0A0A] font-bold text-xs flex items-center gap-1"
            >
              <Plus size={14} />
              <span>{isAr ? 'إضافة قسم جديد' : 'Add Category'}</span>
            </button>
          </div>

          <div className="space-y-2.5">
            {(() => {
              const pageCount = Math.max(1, Math.ceil(menu.categories.length / pageSize));
              const safe = clampPage(catPage, pageCount);
              const shown = menu.categories.slice(safe * pageSize, safe * pageSize + pageSize);
              return (
                <>
                  {shown.map((cat) => {
                    const idx = menu.categories.findIndex((c) => c.id === cat.id);
                    return (
              <div
                key={cat.id}
                className="flex items-center gap-3 p-3 rounded-xl bg-neutral-900 border border-neutral-800"
              >
                {/* Reorder Buttons */}
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => handleMoveCategory(idx, 'up')}
                    className="p-1 rounded text-neutral-400 hover:text-white disabled:opacity-20"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={idx === menu.categories.length - 1}
                    onClick={() => handleMoveCategory(idx, 'down')}
                    className="p-1 rounded text-neutral-400 hover:text-white disabled:opacity-20"
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>

                {/* Name inputs */}
                <div className="flex-1 grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={cat.name.en}
                    onChange={(e) =>
                      updateMenu((m) => ({
                        ...m,
                        categories: m.categories.map((c) =>
                          c.id === cat.id ? { ...c, name: { ...c.name, en: e.target.value } } : c
                        ),
                      }))
                    }
                    className="h-9 px-2.5 rounded bg-black border border-neutral-700 text-xs text-white"
                    placeholder="Category (EN)"
                  />
                  <input
                    type="text"
                    dir="rtl"
                    value={cat.name.ar}
                    onChange={(e) =>
                      updateMenu((m) => ({
                        ...m,
                        categories: m.categories.map((c) =>
                          c.id === cat.id ? { ...c, name: { ...c.name, ar: e.target.value } } : c
                        ),
                      }))
                    }
                    className="h-9 px-2.5 rounded bg-black border border-neutral-700 text-xs text-white"
                    placeholder="القسم (عربي)"
                  />
                </div>

                {/* Visibility Toggle */}
                <button
                  type="button"
                  onClick={() =>
                    updateMenu((m) => ({
                      ...m,
                      categories: m.categories.map((c) =>
                        c.id === cat.id ? { ...c, visible: !c.visible } : c
                      ),
                    }))
                  }
                  className={`p-2 rounded-lg ${
                    cat.visible ? 'text-green-400 bg-green-500/10' : 'text-neutral-500 bg-neutral-800'
                  }`}
                  title={cat.visible ? 'Visible' : 'Hidden'}
                >
                  {cat.visible ? <Eye size={16} /> : <EyeOff size={16} />}
                </button>

                {/* Delete */}
                <button
                  type="button"
                  onClick={() => handleDeleteCategory(cat.id)}
                  className="p-2 rounded-lg text-neutral-500 hover:text-red-400 hover:bg-red-500/10"
                >
                  <Trash2 size={16} />
                </button>
              </div>
                    );
                  })}
                  <Pager
                    page={safe}
                    pageCount={pageCount}
                    onChange={setCatPage}
                    from={menu.categories.length === 0 ? 0 : safe * pageSize + 1}
                    to={Math.min(menu.categories.length, safe * pageSize + pageSize)}
                    total={menu.categories.length}
                    unit={isAr ? 'من' : 'of'}
                  />
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* TAB 3: ITEMS */}
      {activeTab === 'items' && (
        <div className="space-y-4">
          <div className="flex flex-wrap justify-between items-center gap-2 mb-2">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                <input
                  type="text"
                  value={itemSearch}
                  onChange={(e) => {
                    setItemSearch(e.target.value);
                    setItemPage(0);
                  }}
                  placeholder={isAr ? 'بحث في الوجبات...' : 'Search items...'}
                  className="h-9 px-3 rounded-lg bg-neutral-900 border border-neutral-700 text-xs w-full"
                />
                <select
                  value={itemCategoryFilter}
                  onChange={(e) => {
                    setItemCategoryFilter(e.target.value);
                    setItemPage(0);
                  }}
                className="h-9 px-2.5 rounded-lg bg-neutral-900 border border-neutral-700 text-xs"
              >
                <option value="all">{isAr ? 'كل الأقسام' : 'All Categories'}</option>
                {menu.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name.en}
                  </option>
                ))}
              </select>
                <select
                  value={itemBadgeFilter}
                  onChange={(e) => {
                    setItemBadgeFilter(e.target.value as 'all' | 'new' | 'spicy' | 'top');
                    setItemPage(0);
                  }}
                className="h-9 px-2.5 rounded-lg bg-neutral-900 border border-neutral-700 text-xs"
                aria-label={isAr ? 'فلترة بالشارة' : 'Filter by badge'}
              >
                <option value="all">{isAr ? 'كل الشارات' : 'All Badges'}</option>
                <option value="new">{isAr ? 'جديد' : 'New'}</option>
                <option value="spicy">{isAr ? 'حار' : 'Spicy'}</option>
                <option value="top">{isAr ? 'الأكثر طلباً' : 'Top'}</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => {
                setEditingItem({
                  id: `i_${Date.now().toString(36)}`,
                  categoryId: menu.categories[0]?.id || '',
                  name: { en: '', ar: '' },
                  description: { en: '', ar: '' },
                  pricing: { unit: 'pc', minQty: 1, step: 1, maxQty: 50, showUnit: false },
                  badges: [],
                  featured: false,
                  available: true,
                });
                setIsNewItem(true);
                setCalcQty(1);
              }}
              className="btn-tactile px-3.5 py-2 rounded-full bg-[#FFC400] text-[#0A0A0A] font-bold text-xs flex items-center gap-1 shadow-md"
            >
              <Plus size={14} />
              <span>{isAr ? 'إضافة وجبة' : 'Add Item'}</span>
            </button>
          </div>

          {/* Items List */}
          <div className="space-y-2.5">
            {(() => {
              const filtered = menu.items.filter((i) => {
                if (itemCategoryFilter !== 'all' && i.categoryId !== itemCategoryFilter) return false;
                if (itemBadgeFilter !== 'all' && !i.badges.includes(itemBadgeFilter)) return false;
                if (!itemSearch) return true;
                return (
                  i.name.en.toLowerCase().includes(itemSearch.toLowerCase()) ||
                  i.name.ar.toLowerCase().includes(itemSearch.toLowerCase())
                );
              });
              const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
              const safe = clampPage(itemPage, pageCount);
              const shown = filtered.slice(safe * pageSize, safe * pageSize + pageSize);
              return (
                <>
                  {shown.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-neutral-900 border border-neutral-800 hover:border-neutral-700 transition-colors"
                >
                    <div
                      onClick={() => {
                        setEditingItem({ ...item, pricing: normalizePricing(item) });
                        setIsNewItem(false);
                        setCalcQty(1);
                      }}
                      className="flex-1 min-w-0 cursor-pointer"
                    >
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-white truncate">
                        {isAr ? item.name.ar : item.name.en}
                      </span>
                      {/* Badges — same icons as the customer menu */}
                      {item.badges.includes('new') && (
                        <span title={isAr ? 'جديد' : 'New'} className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#0A0A0A] text-[#FFC400] border border-[#FFC400]">
                          <Sparkles size={10} />
                        </span>
                      )}
                      {item.badges.includes('spicy') && (
                        <span title={isAr ? 'حار' : 'Spicy'} className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#0A0A0A] text-[#FFC400] border border-[#FFC400]">
                          <Flame size={10} />
                        </span>
                      )}
                      {item.badges.includes('top') && (
                        <span title={isAr ? 'الأكثر طلباً' : 'Top'} className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#0A0A0A] text-[#FFC400] border border-[#FFC400]">
                          <Award size={10} />
                        </span>
                      )}
                      {item.featured && (
                        <span title={isAr ? 'مميز — يظهر في الكاروسيل' : 'Featured — shows in the carousel'} className="text-[10px] bg-[#FFC400] text-black font-extrabold px-1.5 py-0.5 rounded">
                          ★
                        </span>
                      )}
                      {!item.available && (
                        <span className="text-[10px] bg-red-500/20 text-red-400 font-bold px-1.5 py-0.5 rounded">
                          {isAr ? 'نفذت الكمية' : 'Sold out'}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-neutral-400 mt-0.5">
                      {priceLabel(item, lang, menu.settings.currency[lang] || menu.settings.currency.en)} ·{' '}
                      {menu.categories.find((c) => c.id === item.categoryId)?.name[lang] || item.categoryId}
                    </div>
                  </div>

                  {/* Quick Toggles & Actions */}
                  <div className="flex items-center gap-1.5">
                    {/* Available toggle */}
                    <button
                      type="button"
                      onClick={() =>
                        updateMenu((m) => ({
                          ...m,
                          items: m.items.map((i) =>
                            i.id === item.id ? { ...i, available: !i.available } : i
                          ),
                        }))
                      }
                      className={`text-xs px-2 py-1 rounded-md font-bold ${
                        item.available
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-neutral-800 text-neutral-500'
                      }`}
                      title={isAr ? 'تبديل التوفر' : 'Toggle availability'}
                    >
                      {item.available ? (isAr ? 'متوفر' : 'In Stock') : (isAr ? 'نافذ' : 'Out')}
                    </button>

                    {/* Move Up/Down */}
                    <button
                      type="button"
                      onClick={() => handleMoveItem(item.id, 'up')}
                      className="p-1 text-neutral-400 hover:text-white"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveItem(item.id, 'down')}
                      className="p-1 text-neutral-400 hover:text-white"
                    >
                      <ChevronDown size={14} />
                    </button>

                    {/* Duplicate */}
                    <button
                      type="button"
                      onClick={() => handleDuplicateItem(item)}
                      className="p-1.5 text-neutral-400 hover:text-[#FFC400]"
                      title="Duplicate"
                    >
                      <Copy size={14} />
                    </button>

                    {/* Delete */}
                    <button
                      type="button"
                      onClick={() => handleDeleteItem(item.id)}
                      className="p-1.5 text-neutral-400 hover:text-red-400"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                  ))}
                  <Pager
                    page={safe}
                    pageCount={pageCount}
                    onChange={setItemPage}
                    from={filtered.length === 0 ? 0 : safe * pageSize + 1}
                    to={Math.min(filtered.length, safe * pageSize + pageSize)}
                    total={filtered.length}
                    unit={isAr ? 'من' : 'of'}
                  />
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* TAB 4: BACKUP & RESTORE */}
      {activeTab === 'backup' && (
        <div className="space-y-6">
          <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4">
            <h2 className="text-sm font-extrabold text-[#FFC400] uppercase tracking-wider">
              {isAr ? 'تصدير واستيراد البيانات' : 'Export & Import Menu Data'}
            </h2>
            <p className="text-xs text-neutral-400 leading-relaxed">
              {isAr
                ? 'يمكنك تنزيل ملف JSON كامل لقائمة الطعام للاحتفاظ بنسخة احتياطية، أو رفع ملف محفوظ مسبقاً.'
                : 'Download a full JSON document of the menu for backups, or import an existing configuration file.'}
            </p>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleExportJSON}
                className="btn-tactile flex-1 h-11 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-xs font-bold flex items-center justify-center gap-2 border border-neutral-700"
              >
                <Download size={16} />
                <span>{isAr ? 'تنزيل ملف JSON' : 'Export JSON'}</span>
              </button>

              <label className="btn-tactile flex-1 h-11 rounded-xl bg-[#FFC400] text-[#0A0A0A] text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-md">
                <Upload size={16} />
                <span>{isAr ? 'استيراد ملف JSON' : 'Import JSON'}</span>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleImportJSON}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        </div>
      )}

      {/* STICKY BOTTOM SAVE BAR (hidden while auto-save is on) */}
      {dirty && !autoSave && (
        <div className="fixed bottom-4 left-0 right-0 z-40 px-4 flex justify-center">
          <div className="w-full max-w-[500px] bg-[#141414] border-2 border-[#FFC400] rounded-full p-2 px-5 flex items-center justify-between shadow-2xl">
            <div className="flex items-center gap-2 text-xs text-amber-400 font-bold">
              <AlertTriangle size={16} />
              <span>{isAr ? 'لديك تعديلات غير محفوظة!' : 'Unsaved changes!'}</span>
            </div>

            <button
              type="button"
              onClick={handleSave}
              className="btn-tactile px-5 py-2 rounded-full bg-[#FFC400] text-[#0A0A0A] font-black text-xs flex items-center gap-1.5 shadow-md"
            >
              <Save size={15} />
              <span>{isAr ? 'حفظ التعديلات' : 'Save Changes'}</span>
            </button>
          </div>
        </div>
      )}

      {/* EDIT ITEM DIALOG MODAL */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            onClick={() => setEditingItem(null)}
            className="fixed inset-0 bg-black/70"
          />
          <div className="relative z-10 w-full max-w-[480px] bg-[#141414] border-2 border-[#FFC400] rounded-2xl p-5 max-h-[90vh] overflow-y-auto space-y-4 shadow-2xl">
            <h3 className="text-lg font-black">
              {isNewItem ? (isAr ? 'إضافة وجبة جديدة' : 'Add New Item') : (isAr ? 'تعديل الوجبة' : 'Edit Item')}
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-neutral-400 mb-1">Name (EN) *</label>
                <input
                  type="text"
                  value={editingItem.name.en}
                  onChange={(e) =>
                    setEditingItem({
                      ...editingItem,
                      name: { ...editingItem.name, en: e.target.value },
                    })
                  }
                  className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-neutral-400 mb-1">الاسم (AR) *</label>
                <input
                  type="text"
                  dir="rtl"
                  value={editingItem.name.ar}
                  onChange={(e) =>
                    setEditingItem({
                      ...editingItem,
                      name: { ...editingItem.name, ar: e.target.value },
                    })
                  }
                  className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-neutral-400 mb-1">Description (EN)</label>
              <textarea
                rows={2}
                value={editingItem.description.en}
                onChange={(e) =>
                  setEditingItem({
                    ...editingItem,
                    description: { ...editingItem.description, en: e.target.value },
                  })
                }
                className="w-full p-2.5 rounded-lg bg-black border border-neutral-700 text-xs"
              />
            </div>

            <div>
              <label className="block text-xs text-neutral-400 mb-1">الوصف (AR)</label>
              <textarea
                rows={2}
                dir="rtl"
                value={editingItem.description.ar}
                onChange={(e) =>
                  setEditingItem({
                    ...editingItem,
                    description: { ...editingItem.description, ar: e.target.value },
                  })
                }
                className="w-full p-2.5 rounded-lg bg-black border border-neutral-700 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'القسم' : 'Category'}</label>
                <select
                  value={editingItem.categoryId}
                  onChange={(e) =>
                    setEditingItem({
                      ...editingItem,
                      categoryId: e.target.value,
                    })
                  }
                  className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm"
                >
                  {menu.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name.en}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'الوحدة' : 'Unit'}</label>
                <select
                  value={editingItem.pricing.unit || 'pc'}
                  onChange={(e) =>
                    setEditingItem({
                      ...editingItem,
                      pricing: { ...normalizePricing(editingItem), unit: e.target.value as MenuItem['pricing']['unit'] },
                    })
                  }
                  className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm"
                >
                    {/* All units, most common first, with localized names */}
                    {(['pc', 'dozen', 'portion', 'box', 'bottle', 'glass', 'kg'] as const).map((u) => (
                      <option key={u} value={u}>
                        {isAr ? unitLabel(u, 1, 'ar') : unitLabel(u, 1, 'en')} · {u}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {/* Price (hidden when sizes exist — the size price rules) */}
            {!(editingItem.variants && editingItem.variants.length > 0) ? (
              <div>
                <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'السعر' : 'Price'}</label>
                <input
                  type="number"
                  step="any"
                  value={editingItem.pricing.price ?? ''}
                  onChange={(e) =>
                    setEditingItem({
                      ...editingItem,
                      pricing: { ...normalizePricing(editingItem), price: e.target.value === '' ? undefined : Number(e.target.value) },
                    })
                  }
                  className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm"
                />
              </div>
            ) : (
              <p className="text-[11px] text-neutral-500">
                {isAr ? 'السعر يأتي من الأحجام أدناه (النجمة ★ هي الافتراضي).' : 'Price comes from the sizes below (the ★ is the default).'}
              </p>
            )}

            {/* Min / Step / Max + show unit */}
            <div className="grid grid-cols-3 gap-3">
              {([
                { k: 'minQty', label: isAr ? 'أقل كمية' : 'Min qty' },
                { k: 'step', label: isAr ? 'الخطوة' : 'Step' },
                { k: 'maxQty', label: isAr ? 'أقصى كمية' : 'Max qty' },
              ] as const).map((f) => (
                <div key={f.k}>
                  <label className="block text-xs text-neutral-400 mb-1">{f.label}</label>
                  <input
                    type="number"
                    step={1}
                    value={editingItem.pricing[f.k] ?? ''}
                    onChange={(e) =>
                      setEditingItem({
                        ...editingItem,
                        pricing: { ...normalizePricing(editingItem), [f.k]: e.target.value === '' ? undefined : Number(e.target.value) },
                      })
                    }
                    className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm"
                  />
                </div>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={!!editingItem.pricing.showUnit}
                onChange={(e) =>
                  setEditingItem({
                    ...editingItem,
                    pricing: { ...normalizePricing(editingItem), showUnit: e.target.checked },
                  })
                }
                className="w-4 h-4 rounded text-[#FFC400]"
              />
              <span className="font-bold">{isAr ? 'إظهار الوحدة بجانب السعر (مثال: / دزينة)' : 'Show unit next to price (e.g. / dozen)'}</span>
            </label>

            {/* Sizes on this item (★ = default) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs text-neutral-400">
                  {isAr ? 'أحجام هذا الصنف (★ = الافتراضي)' : 'Sizes on this item (★ = default)'}
                </label>
              </div>
              <p className="text-[11px] text-neutral-500 mb-1.5">
                {isAr
                  ? 'اللي تحط عليه النجمة هو الافتراضي — والنجمة ثابتة مكانها مبتحركش الترتيب. بدون نجمة: الأول افتراضياً.'
                  : 'Whatever you star is the default — the star stays in place and never reorders. No star: the first is the default.'}
              </p>
              {((editingItem.variants || []).length === 0) && (
                <p className="text-[11px] text-neutral-500 mb-1.5">
                  {isAr ? 'بدون أحجام.' : 'No sizes.'}
                </p>
              )}
              {((editingItem.variants || []).length > 0) && (
                <div className="rounded-xl border border-neutral-800 bg-black/30 px-2.5 sm:px-3 pt-2 pb-1 mb-2">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[11px] font-extrabold text-[#FFC400]">
                      {sizesSection ? (isAr ? sizesSection.name.ar : sizesSection.name.en) : (isAr ? 'الأحجام' : 'Sizes')}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        if (!window.confirm(isAr ? 'حذف كل الأحجام من الصنف؟' : 'Remove all sizes from this item?')) return;
                        setEditingItem({ ...editingItem, variants: [], defaultVariant: undefined });
                      }}
                      className="btn-tactile shrink-0 w-6 h-6 rounded-full border border-neutral-700 text-neutral-500 hover:border-red-500 hover:text-red-400 hover:bg-red-900/30 transition-colors flex items-center justify-center"
                      title={isAr ? 'حذف القسم كاملاً' : 'Remove whole section'}
                      aria-label={isAr ? 'حذف القسم كاملاً' : 'Remove whole section'}
                    >
                      <X size={12} strokeWidth={2.5} />
                    </button>
                  </div>
              {(editingItem.variants || []).map((v, vi) => {
                const isDefault = (editingItem.defaultVariant ?? editingItem.variants?.[0]?.featureId) === v.featureId;
                const vDef = (menu.settings.featureDefs || []).find((d) => d.id === v.featureId);
                const vInSizes = !!sizesSection && !!vDef && vDef.groupId === sizesSection.id;
                // A size already used in another row can't be picked again — no duplicates
                const takenV = new Set((editingItem.variants || []).filter((_, i) => i !== vi).map((x) => x.featureId));
                const isFreeV = (id: string) => id === v.featureId || !takenV.has(id);
                const sizeOpts = sizesSection ? (menu.settings.featureDefs || []).filter((d) => d.groupId === sizesSection.id && isFreeV(d.id)) : [];
                return (
                  <div key={`${v.featureId}-${vi}`} className="flex items-end gap-1.5 sm:gap-2 mb-1.5">
                    <select
                      value={v.featureId}
                      onChange={(e) => {
                      const vs = [...(editingItem.variants || [])];
                      vs[vi] = { ...vs[vi], featureId: e.target.value };
                      setEditingItem({ ...editingItem, variants: vs });
                    }}
                      className="w-full min-w-0 h-9 px-2 rounded-lg bg-black border border-neutral-700 text-xs"
                      aria-label={isAr ? 'الميزة' : 'Feature'}
                    >
                      {vInSizes ? null : <option value="">—</option>}
                      {vInSizes && sizesSection ? (
                        <optgroup label={isAr ? sizesSection.name.ar : sizesSection.name.en}>
                          {sizeOpts.map((d) => (
                            <option key={d.id} value={d.id}>
                              {isAr ? d.name.ar : d.name.en}
                            </option>
                          ))}
                        </optgroup>
                      ) : (
                      featuresByGroup(menu)
                        .map(({ group, features }) => ({
                          group,
                          features: features.filter((d) => isFreeV(d.id)),
                        }))
                        .filter(({ features }) => features.length > 0)
                        .map(({ group, features }) => (
                        <optgroup key={group.id || 'other'} label={isAr ? group.name.ar : group.name.en}>
                          {features.map((d) => (
                            <option key={d.id} value={d.id}>
                              {isAr ? d.name.ar : d.name.en}
                            </option>
                          ))}
                        </optgroup>
                      )))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        // Mark in place — row order never changes
                        setEditingItem({ ...editingItem, defaultVariant: v.featureId });
                      }}
                      title={isAr ? 'الافتراضي' : 'Default'}
                      aria-label={isAr ? 'اجعله الافتراضي' : 'Make default'}
                      aria-pressed={isDefault}
                      className={`shrink-0 self-center w-7 h-7 rounded-full border text-[10px] font-black transition-colors ${
                        isDefault
                          ? 'bg-[#FFC400] text-[#0A0A0A] border-[#FFC400]'
                          : 'border-neutral-700 text-neutral-500 hover:border-[#FFC400] hover:text-[#FFC400]'
                      }`}
                    >
                      ★
                    </button>
                    <div className="flex flex-col items-center gap-0.5 shrink-0">
                      <span className={`text-[9px] font-bold text-neutral-500 leading-none${vi === 0 ? '' : ' invisible'}`}>{isAr ? 'السعر' : 'price'}</span>
                      <input
                        type="number"
                        step="any"
                        value={v.price}
                        aria-label={isAr ? 'سعر الحجم' : 'Size price'}
                        title={isAr ? 'سعر هذا الحجم لهذا الصنف' : 'This size’s price on this item'}
                        onChange={(e) => {
                          const vs = [...(editingItem.variants || [])];
                          vs[vi] = { ...vs[vi], price: Number(e.target.value) };
                          setEditingItem({ ...editingItem, variants: vs });
                        }}
                        className="w-16 sm:w-20 h-9 px-1.5 sm:px-2 rounded-lg bg-black border border-neutral-700 text-xs text-center tabular-nums"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const vs = (editingItem.variants || []).filter((_, i) => i !== vi);
                        setEditingItem({
                          ...editingItem,
                          variants: vs,
                          defaultVariant: vs.some((x) => x.featureId === editingItem.defaultVariant)
                            ? editingItem.defaultVariant
                            : undefined,
                        });
                      }}
                      className="p-1 self-center text-neutral-400 hover:text-red-400"
                      title="Remove"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
              {(() => {
                const usedV = new Set((editingItem.variants || []).map((x) => x.featureId));
                const missingV = sizesSection
                  ? (menu.settings.featureDefs || []).filter((d) => d.groupId === sizesSection.id && !usedV.has(d.id))
                  : [];
                return missingV.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 pt-0.5 pb-1.5">
                    {missingV.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => {
                          setEditingItem({
                            ...editingItem,
                            variants: [...(editingItem.variants || []), { featureId: d.id, price: 0 }],
                          });
                        }}
                        className="btn-tactile px-2.5 py-1 rounded-full border border-dashed border-neutral-600 text-neutral-400 text-[10px] font-bold hover:border-[#FFC400] hover:text-[#FFC400]"
                      >
                        <Plus size={10} className="inline me-1" />
                        {isAr ? d.name.ar : d.name.en}
                      </button>
                    ))}
                  </div>
                ) : null;
              })()}
                </div>
              )}
              {((editingItem.variants || []).length === 0) && (
              <button
                type="button"
                onClick={() => {
                  // Direct bulk: everything inside the sizes section drops in
                  // at once — no picker, no questions
                  if (!sizesSection) {
                    alert(
                      isAr
                        ? 'لا يوجد قسم أحجام — أنشئ قسماً وسمّه أحجام (Sizes) في المكتبة أولاً'
                        : 'No sizes section — create one and name it Sizes in the library first'
                    );
                    return;
                  }
                  const used = new Set((editingItem.variants || []).map((x) => x.featureId));
                  const fresh = (menu.settings.featureDefs || []).filter(
                    (d) => d.groupId === sizesSection.id && !used.has(d.id)
                  );
                  if (fresh.length === 0) {
                    alert(isAr ? 'كل الأحجام مضافة بالفعل' : 'All sizes already added');
                    return;
                  }
                  setEditingItem({
                    ...editingItem,
                    variants: [...(editingItem.variants || []), ...fresh.map((d) => ({ featureId: d.id, price: 0 }))],
                  });
                }}
                className="btn-tactile px-3 py-1.5 rounded-full border border-neutral-700 text-neutral-300 text-[11px] font-bold hover:border-[#FFC400] hover:text-[#FFC400]"
              >
                <Plus size={12} className="inline me-1" />
                {isAr ? 'إضافة حجم' : 'Add size'}
              </button>
              )}
            </div>

            {/* Add-ons enabled on this item (price here, 0 = free) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs text-neutral-400">{isAr ? 'إضافات هذا الصنف' : 'Add-ons on this item'}</label>
              </div>
              {((editingItem.addons || []).length === 0) && (
                <p className="text-[11px] text-neutral-500 mb-1.5">
                  {isAr ? 'بدون إضافات.' : 'No add-ons.'}
                </p>
              )}
              {(() => {
                const addons = editingItem.addons || [];
                const defOf = (fid: string) => (menu.settings.featureDefs || []).find((d) => d.id === fid);
                const validGroupOf = (fid: string) => {
                  const def = defOf(fid);
                  if (!def) return '';
                  if (sizesSection && def.groupId === sizesSection.id) return '';
                  return (menu.settings.featureGroups || []).some((g) => g.id === def.groupId) ? def.groupId : '';
                };
                const box = (a: { featureId: string; price: number }, ai: number, gid: string, showPrice: boolean) => {
                  const ownGroup = gid ? (menu.settings.featureGroups || []).find((g) => g.id === gid) : undefined;
                  // A feature already used in another box can't be picked again — no duplicates
                  const takenElsewhere = new Set(
                    (editingItem.addons || []).filter((_, i) => i !== ai).map((x) => x.featureId)
                  );
                  const isFree = (id: string) => id === a.featureId || !takenElsewhere.has(id);
                  const ownFeats = gid ? (menu.settings.featureDefs || []).filter((d) => d.groupId === gid && isFree(d.id)) : null;
                  return (
                  <div key={`${a.featureId}-${ai}`} className="flex items-end gap-1.5 sm:gap-2 mb-1.5">
                    <select
                      value={a.featureId}
                      onChange={(e) => {
                      const list = [...(editingItem.addons || [])];
                      list[ai] = { ...list[ai], featureId: e.target.value };
                      setEditingItem({ ...editingItem, addons: list });
                    }}
                      className="w-full min-w-0 h-9 px-2 rounded-lg bg-black border border-neutral-700 text-xs"
                      aria-label={isAr ? 'الميزة' : 'Feature'}
                    >
                      {gid ? null : <option value="">—</option>}
                      {ownFeats ? (
                        <optgroup label={isAr ? (ownGroup?.name.ar ?? '') : (ownGroup?.name.en ?? '')}>
                          {ownFeats.map((d) => (
                            <option key={d.id} value={d.id}>
                              {isAr ? d.name.ar : d.name.en}
                            </option>
                          ))}
                        </optgroup>
                      ) : (
                      featuresByGroup(menu)
                        .filter(({ group }) => !(sizesSection && group.id && group.id === sizesSection.id))
                        .map(({ group, features }) => ({
                          group,
                          features: features.filter((d) => isFree(d.id)),
                        }))
                        .filter(({ features }) => features.length > 0)
                        .map(({ group, features }) => (
                        <optgroup key={group.id || 'other'} label={isAr ? group.name.ar : group.name.en}>
                          {features.map((d) => (
                            <option key={d.id} value={d.id}>
                              {isAr ? d.name.ar : d.name.en}
                            </option>
                          ))}
                        </optgroup>
                      )))}
                    </select>
                    <div className="flex flex-col items-center gap-0.5 shrink-0">
                      <span className={`text-[9px] font-bold text-neutral-500 leading-none${showPrice ? '' : ' invisible'}`}>{isAr ? 'السعر' : 'price'}</span>
                      <input
                        type="number"
                        step="any"
                        value={a.price}
                        aria-label={isAr ? 'سعر الإضافة' : 'Add-on price'}
                        title={isAr ? 'سعر هذه الإضافة لهذا الصنف (0 = مجاناً)' : 'This add-on’s price on this item (0 = free)'}
                        onChange={(e) => {
                          const list = [...(editingItem.addons || [])];
                          list[ai] = { ...list[ai], price: Number(e.target.value) };
                          setEditingItem({ ...editingItem, addons: list });
                        }}
                        className="w-16 sm:w-20 h-9 px-1.5 sm:px-2 rounded-lg bg-black border border-neutral-700 text-xs text-center tabular-nums"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingItem({ ...editingItem, addons: (editingItem.addons || []).filter((_, i) => i !== ai) });
                      }}
                      className="p-1 self-center text-neutral-400 hover:text-red-400"
                      title="Remove"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  );
                };
                return (
                  <>
                    {(menu.settings.featureGroups || [])
                      .filter((g) => !(sizesSection && g.id === sizesSection.id))
                      .filter((g) => addons.some((a) => validGroupOf(a.featureId) === g.id))
                      .map((g) => {
                        const missing = (menu.settings.featureDefs || []).filter(
                          (d) => d.groupId === g.id && !addons.some((a) => a.featureId === d.id)
                        );
                        return (
                        <div key={g.id} className="rounded-xl border border-neutral-800 bg-black/30 px-2.5 sm:px-3 pt-2 pb-1 mb-2">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-[11px] font-extrabold text-[#FFC400]">
                              {isAr ? g.name.ar : g.name.en}
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                if (!window.confirm(isAr ? 'حذف كل ميزات هذا القسم من الصنف؟' : 'Remove all features of this section from this item?')) return;
                                setEditingItem({
                                  ...editingItem,
                                  addons: (editingItem.addons || []).filter((a) => validGroupOf(a.featureId) !== g.id),
                                });
                              }}
                              className="btn-tactile shrink-0 w-6 h-6 rounded-full border border-neutral-700 text-neutral-500 hover:border-red-500 hover:text-red-400 hover:bg-red-900/30 transition-colors flex items-center justify-center"
                              title={isAr ? 'حذف القسم كاملاً' : 'Remove whole section'}
                              aria-label={isAr ? 'حذف القسم كاملاً' : 'Remove whole section'}
                            >
                              <X size={12} strokeWidth={2.5} />
                            </button>
                          </div>
                          {addons
                            .map((a, ai) => ({ a, ai }))
                            .filter((x) => validGroupOf(x.a.featureId) === g.id)
                            .map((x, gi) => box(x.a, x.ai, g.id, gi === 0))}
                          {missing.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pt-0.5 pb-1.5">
                              {missing.map((d) => (
                                <button
                                  key={d.id}
                                  type="button"
                                  onClick={() => {
                                    setEditingItem({
                                      ...editingItem,
                                      addons: [...(editingItem.addons || []), { featureId: d.id, price: 0 }],
                                    });
                                  }}
                                  className="btn-tactile px-2.5 py-1 rounded-full border border-dashed border-neutral-600 text-neutral-400 text-[10px] font-bold hover:border-[#FFC400] hover:text-[#FFC400]"
                                >
                                  <Plus size={10} className="inline me-1" />
                                  {isAr ? d.name.ar : d.name.en}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        );
                      })}
                    {addons
                      .map((a, ai) => ({ a, ai }))
                      .filter((x) => !validGroupOf(x.a.featureId))
                      .map((x, oi) => box(x.a, x.ai, '', oi === 0))}
                  </>
                );
              })()}
              <button
                type="button"
                onClick={() => setPickingAddonSec((p) => !p)}
                className="btn-tactile px-3 py-1.5 rounded-full border border-neutral-700 text-neutral-300 text-[11px] font-bold hover:border-[#FFC400] hover:text-[#FFC400]"
              >
                <Plus size={12} className="inline me-1" />
                {isAr ? 'إضافة إضافة' : 'Add add-on'}
              </button>
              {pickingAddonSec && (() => {
                const usedIds = new Set((editingItem.addons || []).map((x) => x.featureId));
                const candidateSecs = nonEmptySections.filter((g) => !(sizesSection && g.id === sizesSection.id));
                const groupIdOf = (fid: string) => (menu.settings.featureDefs || []).find((d) => d.id === fid)?.groupId ?? '';
                const openSecs = candidateSecs.filter((g) =>
                  !(editingItem.addons || []).some((a) => groupIdOf(a.featureId) === g.id)
                );
                return (
                <div className="mt-2 space-y-2">
                  <p className="text-[11px] text-neutral-500">
                    {isAr ? 'اختر قسماً — كل ميزاته ستضاف دفعة واحدة:' : 'Pick a section — all its features get added at once:'}
                  </p>
                  {candidateSecs.length === 0 && (
                    <p className="text-[11px] text-neutral-500">
                      {isAr ? 'لا توجد أقسام — أنشئها من المكتبة أولاً' : 'No sections — create them in the library first'}
                    </p>
                  )}
                  {candidateSecs.length > 0 && openSecs.length === 0 && (
                    <p className="text-[11px] text-neutral-500">
                      {isAr ? 'كل الأقسام مضافة بالفعل' : 'All sections already added'}
                    </p>
                  )}
                  {openSecs.map((g) => {
                    const feats = (menu.settings.featureDefs || []).filter((d) => d.groupId === g.id);
                    const remaining = feats.filter((d) => !usedIds.has(d.id)).length;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => {
                          const fresh = feats.filter((d) => !usedIds.has(d.id));
                          if (fresh.length === 0) {
                            alert(isAr ? 'كل ميزات هذا القسم مضافة بالفعل' : 'All features of this section already added');
                            return;
                          }
                          setEditingItem({
                            ...editingItem,
                            addons: [...(editingItem.addons || []), ...fresh.map((d) => ({ featureId: d.id, price: 0 }))],
                          });
                          setPickingAddonSec(false);
                        }}
                        className="btn-tactile w-full text-start rounded-xl border border-neutral-700 bg-black/40 px-3 py-2 hover:border-[#FFC400] transition-colors"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <b className="text-xs text-white">{isAr ? g.name.ar : g.name.en}</b>
                          <span className="text-[10px] text-neutral-500 tabular-nums">
                            {isAr ? `${remaining} جديدة` : `${remaining} new`}
                          </span>
                        </span>
                        <span className="block text-[11px] text-neutral-400 mt-0.5 leading-relaxed">
                          {feats.map((d) => (isAr ? d.name.ar : d.name.en)).join(' · ')}
                        </span>
                      </button>
                    );
                  })}
                </div>
                );
              })()}
              <p className="text-[11px] text-neutral-500 mt-1.5">
                {isAr
                  ? 'السعر يُكتب هنا لكل صنف — وهو الذي يظهر للزبون محسوباً مع الكمية. لو الميزة ناقصة أنشئها من مكتبة الميزات.'
                  : 'The price is written here per item — it is what the customer sees, multiplied by quantity. If a feature is missing, create it in the Features library.'}
              </p>
            </div>

            {/* Item preview (name, description, details, features) + mini calculator */}
            <div className="rounded-xl border border-neutral-800 bg-black/40 p-3 space-y-3">
              <p className="text-xs font-extrabold text-neutral-300">{isAr ? 'معاينة الصنف:' : 'Item preview:'}</p>
              {(() => {
                const cur = menu.settings.currency[lang] || menu.settings.currency.en;
                const pvSizes = editingItem.variants || [];
                const pvAddons = editingItem.addons || [];
                const pv = { ...editingItem, variants: pvSizes.length ? pvSizes : undefined };
                let label = '—';
                try {
                  label = priceLabel(pv, lang, cur);
                } catch {}
                const desc = (isAr ? editingItem.description.ar : editingItem.description.en).trim();
                const p = editingItem.pricing;
                return (
                  <div className="rounded-xl border border-neutral-700 bg-[#141414] p-3.5">
                    <div className="flex justify-between items-start gap-3">
                      <span className="font-bold text-sm text-white">
                        {(isAr ? editingItem.name.ar : editingItem.name.en) || (isAr ? '(بدون اسم)' : '(no name)')}
                      </span>
                      <span className="shrink-0 px-3 py-1 rounded-full text-xs font-extrabold bg-[#FFC400] text-[#0A0A0A] tabular-nums whitespace-nowrap">
                        {label}
                      </span>
                    </div>
                    {desc ? <p className="text-[11px] text-neutral-400 mt-1 leading-relaxed">{desc}</p> : null}
                    <p className="text-[11px] text-neutral-500 mt-1.5 tabular-nums">
                      {isAr ? 'الوحدة: ' : 'Unit: '}{unitLabel(p.unit, 1, lang)}
                      {' · '}
                      {isAr ? `الكمية: ${p.minQty}–${p.maxQty}` : `Qty: ${p.minQty}–${p.maxQty}`}
                      {p.step !== 1 && (isAr ? ` بخطوة ${p.step}` : ` step ${p.step}`)}
                    </p>
                    {pvSizes.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-dashed border-neutral-800 space-y-2">
                        {(menu.settings.featureGroups || [])
                          .map((g) => ({
                            group: g,
                            lines: pvSizes.filter((v) => {
                              const def = (menu.settings.featureDefs || []).find((d) => d.id === v.featureId);
                              return def?.groupId === g.id;
                            }),
                          }))
                          .filter((x) => x.lines.length > 0)
                          .map(({ group, lines }) => (
                            <div key={group.id}>
                              <p className="text-[10px] font-bold text-neutral-500 mb-1">
                                {isAr ? group.name.ar : group.name.en}
                              </p>
                              {lines.map((v, vi) => {
                                const isDef = ((editingItem.defaultVariant && pvSizes.some((x) => x.featureId === editingItem.defaultVariant)
                                  ? editingItem.defaultVariant
                                  : pvSizes[0]?.featureId) === v.featureId);
                                return (
                                  <div key={`${v.featureId || 'blank'}-${vi}`} className="flex justify-between text-[11px]">
                                    <span className="text-neutral-300">
                                      {featureName(menu, v.featureId, lang)}
                                      {isDef && <span className="ms-1.5 text-[#FFC400] font-bold">{isAr ? '(افتراضي)' : '(default)'}</span>}
                                    </span>
                                    <span className="text-neutral-400 tabular-nums" dir="ltr">{formatPrice(v.price, cur)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                        {pvSizes
                          .filter((v) => {
                            const def = (menu.settings.featureDefs || []).find((d) => d.id === v.featureId);
                            return !def || !(menu.settings.featureGroups || []).some((g) => g.id === def.groupId);
                          })
                          .map((v, vi) => (
                            <div key={`orphan-${v.featureId || 'blank'}-${vi}`} className="flex justify-between text-[11px]">
                              <span className="text-neutral-300">
                                {featureName(menu, v.featureId, lang)}
                              </span>
                              <span className="text-neutral-400 tabular-nums" dir="ltr">{formatPrice(v.price, cur)}</span>
                            </div>
                          ))}
                      </div>
                    )}
                    {pvAddons.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-dashed border-neutral-800 space-y-2">
                        {(menu.settings.featureGroups || [])
                          .map((g) => ({
                            group: g,
                            lines: pvAddons.filter((a) => {
                              const def = (menu.settings.featureDefs || []).find((d) => d.id === a.featureId);
                              return def?.groupId === g.id;
                            }),
                          }))
                          .filter((x) => x.lines.length > 0)
                          .map(({ group, lines }) => (
                            <div key={group.id}>
                              <p className="text-[10px] font-bold text-neutral-500 mb-1">
                                {isAr ? group.name.ar : group.name.en}
                              </p>
                              {lines.map((a, ai) => (
                                <div key={`${a.featureId || 'blank'}-${ai}`} className="flex justify-between text-[11px]">
                                  <span className="text-[#FFC400]">+ {featureName(menu, a.featureId, lang)}</span>
                                  <span className="text-neutral-400 tabular-nums" dir="ltr">
                                    {a.price === 0 ? (isAr ? 'مجاناً' : 'Free') : `+${formatPrice(a.price, cur)}`}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ))}
                        {pvAddons
                          .filter((a) => {
                            const def = (menu.settings.featureDefs || []).find((d) => d.id === a.featureId);
                            return !def || !(menu.settings.featureGroups || []).some((g) => g.id === def.groupId);
                          })
                          .map((a, ai) => (
                            <div key={`orphan-${a.featureId || 'blank'}-${ai}`} className="flex justify-between text-[11px]">
                              <span className="text-[#FFC400]">+ {featureName(menu, a.featureId, lang)}</span>
                              <span className="text-neutral-400 tabular-nums" dir="ltr">
                                {a.price === 0 ? (isAr ? 'مجاناً' : 'Free') : `+${formatPrice(a.price, cur)}`}
                              </span>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                );
              })()}
              <div className="flex items-center justify-between gap-3 text-xs">
                <label className="text-neutral-400">
                  {isAr ? 'جرّب: اطلب' : 'Try: order'}
                  <input
                    type="number"
                    step={1}
                    value={calcQty}
                    onChange={(e) => setCalcQty(Number(e.target.value))}
                    className="w-16 h-8 mx-1.5 px-2 rounded-lg bg-black border border-neutral-700 text-xs text-center"
                  />
                  {isAr ? '→ الإجمالي' : '→ total'}
                </label>
                <span className="font-extrabold text-white tabular-nums">
                  {(() => {
                    const vs = editingItem.variants || [];
                    const firstSize = (editingItem.defaultVariant && vs.find((v) => v.featureId === editingItem.defaultVariant)) || vs[0];
                    const base = firstSize ? firstSize.price : editingItem.pricing.price;
                    if (!Number.isInteger(calcQty) || calcQty <= 0 || typeof base !== 'number' || !Number.isFinite(base)) return '—';
                    return formatPrice((base as number) * calcQty, menu.settings.currency[lang] || menu.settings.currency.en);
                  })()}
                </span>
              </div>
            </div>

            {/* Badges Checkboxes (same icons as the menu) */}
            <div>
                <label className="block text-xs text-neutral-400 mb-1.5">{isAr ? 'الشارات' : 'Badges'}</label>
                <div className="flex gap-4">
                  {([
                    { id: 'new', en: 'New', ar: 'جديد' },
                    { id: 'spicy', en: 'Spicy', ar: 'حار' },
                    { id: 'top', en: 'Top', ar: 'الأكثر طلباً' },
                  ] as const).map((b) => (
                    <label key={b.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingItem.badges.includes(b.id)}
                        onChange={(e) => {
                          const newBadges = e.target.checked
                            ? [...editingItem.badges, b.id]
                            : editingItem.badges.filter((x) => x !== b.id);
                          setEditingItem({ ...editingItem, badges: newBadges });
                        }}
                        className="w-4 h-4 rounded text-[#FFC400]"
                      />
                      {b.id === 'spicy' && <Flame size={12} className="fill-[#FFC400] text-[#FFC400]" />}
                      {b.id === 'top' && <Award size={12} className="fill-[#FFC400] text-[#FFC400]" />}
                      {b.id === 'new' && <Sparkles size={12} className="text-[#FFC400]" />}
                      <span className="capitalize">{isAr ? b.ar : b.en}</span>
                    </label>
                  ))}
                </div>
            </div>

            {/* Featured & Available toggles */}
            <div className="flex gap-6 pt-2 border-t border-neutral-800">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={editingItem.featured}
                  onChange={(e) =>
                    setEditingItem({ ...editingItem, featured: e.target.checked })
                  }
                  className="w-4 h-4 rounded text-[#FFC400]"
                />
                <span className="font-bold">{isAr ? '★ مميز في الكاروسيل' : '★ Featured in Carousel'}</span>
              </label>

              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={editingItem.available}
                  onChange={(e) =>
                    setEditingItem({ ...editingItem, available: e.target.checked })
                  }
                  className="w-4 h-4 rounded text-[#FFC400]"
                />
                <span className="font-bold">{isAr ? 'متوفر في المخزون' : 'Available in Stock'}</span>
              </label>
            </div>

            {/* NEW badge control (automatic window from addedAt) */}
            <div className="rounded-xl border border-neutral-800 bg-black/40 p-3 flex items-center justify-between gap-3">
              <div className="text-xs">
                {isItemNew(menu, editingItem) ? (
                  <>
                    <span className="font-extrabold text-[#FFC400]">{isAr ? 'NEW مفعّلة' : 'NEW active'}</span>
                    <span className="block text-[11px] text-neutral-500 mt-0.5">
                      {isAr ? 'تختفي تلقائياً بعد مدة الـ NEW' : 'Auto-removed after the NEW period'}
                      {editingItem.addedAt ? ` (${new Date(editingItem.addedAt).toLocaleDateString()})` : ''}
                    </span>
                  </>
                ) : (
                  <span className="text-neutral-400">
                    {isAr ? 'ليست NEW حالياً' : 'Not NEW right now'}
                  </span>
                )}
              </div>
              {isItemNew(menu, editingItem) ? (
                <button
                  type="button"
                  onClick={() => {
                    const copy = { ...editingItem };
                    delete (copy as Partial<MenuItem>).addedAt;
                    setEditingItem(copy);
                  }}
                  className="px-3 py-1.5 rounded-full border border-neutral-700 text-neutral-300 text-[11px] font-bold hover:border-red-400 hover:text-red-400"
                >
                  {isAr ? 'شيل الجديد' : 'Remove new'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingItem({ ...editingItem, addedAt: new Date().toISOString() })}
                  className="btn-tactile px-3 py-1.5 rounded-full bg-[#FFC400] text-[#0A0A0A] text-[11px] font-bold"
                >
                  {isAr ? 'اعتبره جديد' : 'Mark as new'}
                </button>
              )}
            </div>

            {/* Modal Buttons */}
            <div className="flex gap-3 pt-3">
              <button
                type="button"
                onClick={handleSaveItemModal}
                className="btn-tactile flex-1 h-11 rounded-full bg-[#FFC400] text-[#0A0A0A] font-bold text-xs"
              >
                {isAr ? 'حفظ العنصر' : 'Save Item'}
              </button>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="flex-1 h-11 rounded-full border border-neutral-700 text-neutral-300 text-xs font-semibold hover:bg-white/5"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Professional confirm dialog (deletes) */}
      {confirmBox && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="alertdialog" aria-modal="true">
          <div className="fixed inset-0 bg-black/70 anim-fade-in" onClick={() => setConfirmBox(null)} aria-hidden="true" />
          <div className="relative z-10 w-full max-w-[340px] bg-[#141414] text-white border-2 border-red-500/60 rounded-2xl p-5 text-center shadow-2xl anim-pop-in">
            <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center mx-auto mb-3">
              <Trash2 size={22} />
            </div>
            <h3 className="text-base font-extrabold">{confirmBox.title}</h3>
            <p className="text-xs text-neutral-400 mt-1.5 leading-relaxed">{confirmBox.body}</p>
            <div className="flex gap-2 mt-5">
              <button
                type="button"
                onClick={() => setConfirmBox(null)}
                className="flex-1 h-11 rounded-full border border-white/20 text-white/80 text-sm font-bold hover:bg-white/5 transition-colors"
              >
                {confirmBox.mode === 'info' ? (isAr ? 'فهمت' : 'OK') : (isAr ? 'تراجع' : 'Cancel')}
              </button>
              {confirmBox.mode !== 'info' && (
                <button
                  type="button"
                  onClick={() => {
                    confirmBox.action?.();
                    setConfirmBox(null);
                  }}
                  className="btn-tactile flex-1 h-11 rounded-full bg-red-500 text-white text-sm font-bold hover:bg-red-600 shadow-md"
                >
                  {confirmBox.confirmText}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
