import React, { useState } from 'react';
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
} from 'lucide-react';

interface AdminPanelProps {
  initialMenu: MenuData;
  onSaveMenu: (newMenu: MenuData) => void;
  onClose: () => void;
  lang: 'en' | 'ar';
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  initialMenu,
  onSaveMenu,
  onClose,
  lang,
}) => {
  const isAr = lang === 'ar';
  const [menu, setMenu] = useState<MenuData>(initialMenu);
  const [dirty, setDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<'settings' | 'categories' | 'items' | 'backup'>('settings');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Item edit modal state
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [isNewItem, setIsNewItem] = useState(false);
  const [itemCategoryFilter, setItemCategoryFilter] = useState('all');
  const [itemSearch, setItemSearch] = useState('');

  // Update helper
  const updateMenu = (updater: (prev: MenuData) => MenuData) => {
    setMenu((prev) => {
      const updated = updater(prev);
      setDirty(true);
      return updated;
    });
  };

  const handleSave = () => {
    const updated = {
      ...menu,
      version: menu.version + 1,
      updatedAt: new Date().toISOString(),
    };
    onSaveMenu(updated);
    setMenu(updated);
    setDirty(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

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

    updateMenu((prev) => {
      if (isNewItem) {
        return { ...prev, items: [...prev.items, editingItem] };
      }
      return {
        ...prev,
        items: prev.items.map((i) => (i.id === editingItem.id ? editingItem : i)),
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
          <span className="text-xs px-2.5 py-1 rounded-full bg-neutral-800 border border-neutral-700 text-neutral-400">
            v{menu.version}
          </span>
        </div>
      </div>

      <h1 className="text-2xl font-black mt-4 mb-2 flex items-center gap-2">
        <span>🍔</span> {isAr ? 'إدارة قائمة الطعام' : 'Menu Management'}
      </h1>

      {/* Tabs */}
      <div className="flex gap-1.5 p-1 bg-neutral-900 rounded-2xl border border-neutral-800 mt-4 mb-6">
        {(['settings', 'categories', 'items', 'backup'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
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

          {/* Operational Hours */}
          <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4">
            <h2 className="text-sm font-extrabold text-[#FFC400] uppercase tracking-wider">
              {isAr ? 'مواعيد العمل والحالة' : 'Working Hours & Status'}
            </h2>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-neutral-400 mb-1">Status Mode</label>
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
                  <option value="auto">Auto (from hours)</option>
                  <option value="open">Always Open</option>
                  <option value="closed">Always Closed</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-neutral-400 mb-1">Open Time (HH:MM)</label>
                <input
                  type="text"
                  value={menu.settings.openTime}
                  onChange={(e) =>
                    updateMenu((m) => ({
                      ...m,
                      settings: { ...m.settings, openTime: e.target.value },
                    }))
                  }
                  className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[#FFC400]"
                />
              </div>

              <div>
                <label className="block text-xs text-neutral-400 mb-1">Close Time (HH:MM)</label>
                <input
                  type="text"
                  value={menu.settings.closeTime}
                  onChange={(e) =>
                    updateMenu((m) => ({
                      ...m,
                      settings: { ...m.settings, closeTime: e.target.value },
                    }))
                  }
                  className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[#FFC400]"
                />
              </div>
            </div>
          </div>

          {/* Ordering Configuration */}
          <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-extrabold text-[#FFC400] uppercase tracking-wider">
                {isAr ? 'إعدادات طلبات واتساب' : 'WhatsApp Ordering System'}
              </h2>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={menu.settings.ordering.enabled}
                  onChange={(e) =>
                    updateMenu((m) => ({
                      ...m,
                      settings: {
                        ...m.settings,
                        ordering: { ...m.settings.ordering, enabled: e.target.checked },
                      },
                    }))
                  }
                  className="w-4 h-4 rounded text-[#FFC400]"
                />
                <span className="font-bold">{isAr ? 'تفعيل الطلبات' : 'Enabled'}</span>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
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

              <div>
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
            </div>

            {/* Test Order Link Button */}
            <div className="pt-2">
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
            {menu.categories.map((cat, idx) => (
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
            ))}
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
                onChange={(e) => setItemSearch(e.target.value)}
                placeholder={isAr ? 'بحث في الوجبات...' : 'Search items...'}
                className="h-9 px-3 rounded-lg bg-neutral-900 border border-neutral-700 text-xs w-full"
              />
              <select
                value={itemCategoryFilter}
                onChange={(e) => setItemCategoryFilter(e.target.value)}
                className="h-9 px-2.5 rounded-lg bg-neutral-900 border border-neutral-700 text-xs"
              >
                <option value="all">{isAr ? 'كل الأقسام' : 'All Categories'}</option>
                {menu.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name.en}
                  </option>
                ))}
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
            {menu.items
              .filter((i) => {
                if (itemCategoryFilter !== 'all' && i.categoryId !== itemCategoryFilter) return false;
                if (!itemSearch) return true;
                return (
                  i.name.en.toLowerCase().includes(itemSearch.toLowerCase()) ||
                  i.name.ar.toLowerCase().includes(itemSearch.toLowerCase())
                );
              })
              .map((item) => (
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
                      {item.featured && (
                        <span className="text-[10px] bg-[#FFC400] text-black font-extrabold px-1.5 py-0.5 rounded">
                          ★
                        </span>
                      )}
                      {!item.available && (
                        <span className="text-[10px] bg-red-500/20 text-red-400 font-bold px-1.5 py-0.5 rounded">
                          Sold out
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
                      title="Toggle availability"
                    >
                      {item.available ? 'In Stock' : 'Out'}
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

      {/* STICKY BOTTOM SAVE BAR */}
      {dirty && (
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
                <label className="block text-xs text-neutral-400 mb-1">Price</label>
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
                <label className="block text-xs text-neutral-400 mb-1">Category</label>
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
              <label className="block text-xs text-neutral-400 mb-1.5">Badges</label>
              <div className="flex gap-4">
                {(['new', 'spicy', 'top'] as const).map((badge) => (
                  <label key={badge} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingItem.badges.includes(badge)}
                      onChange={(e) => {
                        const newBadges = e.target.checked
                          ? [...editingItem.badges, badge]
                          : editingItem.badges.filter((b) => b !== badge);
                        setEditingItem({ ...editingItem, badges: newBadges });
                      }}
                      className="w-4 h-4 rounded text-[#FFC400]"
                    />
                    <span className="capitalize">{badge}</span>
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
                <span className="font-bold">Featured in Carousel</span>
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
                <span className="font-bold">Available in Stock</span>
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
