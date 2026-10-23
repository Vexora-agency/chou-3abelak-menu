import React, { useState, useEffect, useRef } from 'react';
import { MenuData, MenuItem, Category, OrderType } from '../types/menu';
import { formatPrice } from '../utils/menuHelpers';
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
  ExternalLink,
  Check,
  AlertTriangle,
  Sparkles,
  Flame,
  Award,
} from 'lucide-react';

interface AdminPanelProps {
  initialMenu: MenuData;
  onSaveMenu: (newMenu: MenuData) => void;
  onClose: () => void;
  onSignOut?: () => void;
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
  lang,
}) => {
  const isAr = lang === 'ar';
  const [menu, setMenu] = useState<MenuData>(initialMenu);
  const [dirty, setDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<'settings' | 'categories' | 'items' | 'backup'>('settings');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Auto-save: when ON, every change is saved automatically after a short
  // pause, so the "unsaved changes" bar never appears. Persisted per device.
  const [autoSave, setAutoSave] = useState<boolean>(() => {
    try {
      return localStorage.getItem('admin_autosave_v1') === '1';
    } catch {
      return false;
    }
  });

  // Item edit modal state
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [isNewItem, setIsNewItem] = useState(false);
  const [itemCategoryFilter, setItemCategoryFilter] = useState('all');
  const [itemBadgeFilter, setItemBadgeFilter] = useState<'all' | 'new' | 'spicy' | 'top'>('all');
  const [itemSearch, setItemSearch] = useState('');

  // Client-side pagination (8 rows per page — the sweet spot for tall admin rows)
  const pageSize = 8;
  const [catPage, setCatPage] = useState(0);
  const [itemPage, setItemPage] = useState(0);
  const clampPage = (p: number, count: number) => Math.max(0, Math.min(p, Math.max(0, count - 1)));

  // Update helper
  const updateMenu = (updater: (prev: MenuData) => MenuData) => {
    setMenu((prev) => {
      const updated = updater(prev);
      setDirty(true);
      return updated;
    });
  };

  const handleSave = () => {
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
      },
      items: menu.items.map((i) => ({ ...i, name: fillBi(i.name), description: fillBi(i.description) })),
      categories: menu.categories.map((c) => ({ ...c, name: fillBi(c.name) })),
    };
    const updated = {
      ...normalized,
      version: normalized.version + 1,
      updatedAt: new Date().toISOString(),
    };
    onSaveMenu(updated);
    setMenu(updated);
    setDirty(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
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

    // Auto-fill the blank language from the written one
    const filled: MenuItem = {
      ...editingItem,
      name: {
        en: editingItem.name.en.trim() ? editingItem.name.en : editingItem.name.ar,
        ar: editingItem.name.ar.trim() ? editingItem.name.ar : editingItem.name.en,
      },
      description: {
        en: editingItem.description.en.trim() ? editingItem.description.en : editingItem.description.ar,
        ar: editingItem.description.ar.trim() ? editingItem.description.ar : editingItem.description.en,
      },
    };

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
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed.settings && Array.isArray(parsed.categories) && Array.isArray(parsed.items)) {
          setMenu(parsed);
          setDirty(true);
          alert(isAr ? 'تم استيراد البيانات بنجاح! اضغط على زر الحفظ لتثبيتها.' : 'Menu imported successfully! Click Save to apply.');
        } else {
          alert('Invalid menu JSON format');
        }
      } catch {
        alert('Failed to parse JSON file');
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
        <span className="text-xs px-2.5 py-1 rounded-full bg-neutral-800 border border-neutral-700 text-neutral-400">
          v{menu.version}
        </span>
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
      <div className="flex gap-1.5 p-1 bg-neutral-900 rounded-2xl border border-neutral-800 mt-4 mb-6">
        {(['settings', 'categories', 'items', 'backup'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => {
            setActiveTab(tab);
            setCatPage(0);
            setItemPage(0);
          }}
            className={`flex-1 py-2 rounded-xl text-xs font-bold capitalize transition-all ${
              activeTab === tab
                ? 'bg-[#FFC400] text-[#0A0A0A] shadow-md'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            {tab === 'settings' && (isAr ? 'الإعدادات' : 'Settings')}
            {tab === 'categories' && (isAr ? 'الأقسام' : 'Categories')}
            {tab === 'items' && (isAr ? 'الوجبات' : 'Items')}
            {tab === 'backup' && (isAr ? 'النسخ الاحتياطي' : 'Backup')}
          </button>
        ))}
      </div>

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
                {isAr ? 'إعدادات طلبات واتساب' : 'WhatsApp Ordering System'}
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

            {/* Test Order Link Button */}
            <div className="pt-1">
              <a
                href={`https://wa.me/${(menu.settings.whatsapp || '').replace(/[^0-9]/g, '')}?text=Test%20Order%20from%20Menu`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-[#FFC400] hover:underline"
              >
                <ExternalLink size={14} />
                <span>{isAr ? 'اختبار رابط واتساب' : 'Test WhatsApp Order Link'}</span>
              </a>
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
                  categoryId: menu.categories[0]?.id || 'burgers',
                  name: { en: '', ar: '' },
                  description: { en: '', ar: '' },
                  price: 50,
                  badges: [],
                  featured: false,
                  available: true,
                });
                setIsNewItem(true);
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
                      setEditingItem(item);
                      setIsNewItem(false);
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
                      {formatPrice(item.price, menu.settings.currency[lang] || menu.settings.currency.en)} ·{' '}
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
                <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'السعر' : 'Price'}</label>
                <input
                  type="number"
                  value={editingItem.price}
                  onChange={(e) =>
                    setEditingItem({
                      ...editingItem,
                      price: Number(e.target.value),
                    })
                  }
                  className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm"
                />
              </div>

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
            </div>

            {/* Badges Checkboxes */}
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
                <span className="font-bold">{isAr ? 'مميز في الكاروسيل' : 'Featured in Carousel'}</span>
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
    </div>
  );
};
