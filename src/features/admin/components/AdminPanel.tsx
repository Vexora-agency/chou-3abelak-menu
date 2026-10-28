import React, { useState, useCallback, useEffect } from 'react';
import { MenuData, MenuItem, AdminSaveResult } from '@/src/types/menu';
import { BackupPanel } from '@/src/features/backup';
import { normalizePricing } from '@/src/utils/pricing';
import { CategoriesTab } from './CategoriesTab';
import { ItemsTab } from './ItemsTab';
import { AdminTopBar, type AdminTab } from './admin/AdminTopBar';
import { AdminSettingsTab } from './admin/AdminSettingsTab';
import { AdminDashboardTab } from './admin/AdminDashboardTab';
import { AdminOverlays, type ConfirmBox } from './admin/AdminOverlays';
import { useAdminApi } from '../hooks/useAdminApi';
import { useMenuSaver } from '../hooks/useMenuSaver';
import { useAdminOrders } from '@/src/features/orders';
import { useReportCenter } from '@/src/features/reports';
import { useBackupHistory } from '@/src/features/backup';
import { useAdminCatalog } from '../hooks/useAdminCatalog';

interface AdminPanelProps {
  initialMenu: MenuData;
  onSaveMenu: (newMenu: MenuData, source?: 'manual' | 'autosave') => Promise<AdminSaveResult | null>;
  onClose: () => void;
  onSignOut?: () => void;
  onToggleLang?: () => void;
  lang: 'en' | 'ar';
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
  const [saveSuccess, setSaveSuccess] = useState(false);
  const flashSaved = useCallback(() => {
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  }, []);

  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    // Deep-link: #admin/backup (or any tab) survives refresh.
    const m = /^#admin\/([a-z]+)$/.exec(window.location.hash);
    const t = m ? (m[1] as AdminTab) : null;
    return t === 'dashboard' || t === 'settings' || t === 'categories' || t === 'items' || t === 'backup'
      ? t
      : 'dashboard';
  });
  // Keep the tab in the address bar (replaceState: no history spam, refresh-safe).
  useEffect(() => {
    const want = `#admin/${activeTab}`;
    if (window.location.hash !== want) {
      window.history.replaceState(null, '', want);
    }
  }, [activeTab]);

  // Item edit modal state
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [isNewItem, setIsNewItem] = useState(false);
  const [calcQty, setCalcQty] = useState(1);
  // Reset the price calculator whenever a different item is edited
  // (render-phase adjustment: applies before paint, no extra pass).
  const [calcItemId, setCalcItemId] = useState<string | null>(null);
  const editingId = editingItem?.id ?? null;
  if (editingId !== calcItemId) {
    setCalcItemId(editingId);
    setCalcQty(1);
  }
  // Collapsed feature-library groups (open by default)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  // Professional confirm dialog (replaces native confirm for deletes).
  // mode 'info' shows a single OK button (for blocked deletes).
  const [confirmBox, setConfirmBox] = useState<ConfirmBox | null>(null);
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

  const { adminFetch, savePaused } = useAdminApi();
  const {
    menu, updateMenu, dirty, handleSave, flushDirty, replaceMenu, autoSave, setAutoSave,
  } = useMenuSaver({ initialMenu, onSaveMenu, isAr, savePaused, onSaved: flashSaved });
  const {
    orders, ordersLoading, ordersError, fetchOrders, handleOrderStatusChange,
  } = useAdminOrders({ isAr, timezone: menu.settings.timezone || 'Asia/Beirut', activeTab });
  const report = useReportCenter({ isAr, activeTab, adminFetch });
  const backup = useBackupHistory({
    isAr, lang, activeTab, adminFetch, savePaused,
    menuVersion: menu.version, replaceMenu,
  });
  const catalog = useAdminCatalog({
    menu, updateMenu, flushDirty, isAr, adminFetch,
    showUndoToast: backup.showUndoToast,
    refreshMenuFromServer: backup.refreshMenuFromServer,
    handleRestoreTrashById: backup.handleRestoreTrashById,
    editingItem, setEditingItem, isNewItem,
  });

  // Refresh the activity feed after every successful save (manual or autosave).
  const fetchActivityOnSave = backup.fetchActivity;
  useEffect(() => {
    if (saveSuccess) void fetchActivityOnSave();
  }, [saveSuccess, fetchActivityOnSave]);

  const handleTabChange = (tab: AdminTab) => {
    setActiveTab(tab);
    setCatPage(0);
    setItemPage(0);
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white p-4 sm:p-6 md:p-8 pb-24 font-sans max-w-4xl mx-auto">
      <AdminTopBar
        lang={lang}
        onClose={onClose}
        saveSuccess={saveSuccess}
        onToggleLang={onToggleLang}
        autoSave={autoSave}
        onToggleAutoSave={() => setAutoSave((v) => !v)}
        onSignOut={onSignOut}
        activeTab={activeTab}
        onTabChange={handleTabChange}
      />

      {/* TAB 0: ORDERS DASHBOARD */}
      {activeTab === 'dashboard' && (
        <AdminDashboardTab
          lang={lang}
          menu={menu}
          orders={orders}
          ordersLoading={ordersLoading}
          ordersError={ordersError}
          onOrderStatusChange={(id, s) => void handleOrderStatusChange(id, s)}
          onRefreshOrders={() => void fetchOrders(false)}
          reportsOn={report.reportsOn}
          customersOn={report.customersOn}
          dashView={report.dashView}
          onDashViewChange={report.setDashView}
          reportSettings={report.reportSettings}
          reportRows={report.reportRows}
          retentionCfg={report.retentionCfg}
          reportSched={report.reportSched}
          onSaveReportSettings={report.handleSaveReportSettings}
          onResendVerification={report.handleResendVerification}
          onSendTestReport={report.handleSendTestReport}
          onDownloadReport={(m) => void report.handleDownloadReport(m)}
          onSearchCustomers={report.searchCustomers}
          onCustomerAction={report.handleCustomerAction}
          adminFetch={adminFetch}
          onMenuRefreshed={backup.refreshMenuFromServer}
        />
      )}

      {/* TAB 1: SETTINGS */}
      {activeTab === 'settings' && (
        <AdminSettingsTab
          menu={menu}
          lang={lang}
          adminFetch={adminFetch}
          onMenuRefreshed={backup.refreshMenuFromServer}
          onUpdateMenu={updateMenu}
          collapsedGroups={collapsedGroups}
          onToggleCollapse={(gid) => setCollapsedGroups((prev) => ({ ...prev, [gid]: !prev[gid] }))}
          onConfirm={(box) => setConfirmBox(box)}
        />
      )}

      {/* TAB 2: CATEGORIES */}
      {activeTab === 'categories' && (
        <CategoriesTab
          categories={menu.categories}
          page={catPage}
          pageSize={pageSize}
          lang={lang}
          onPageChange={setCatPage}
          onAdd={catalog.handleAddCategory}
          onMove={catalog.handleMoveCategory}
          onDelete={(catId) => void catalog.handleDeleteCategory(catId)}
          onUpdate={(updater) =>
            updateMenu((m) => ({ ...m, categories: updater(m.categories) }))
          }
        />
      )}

      {/* TAB 3: ITEMS */}
      {activeTab === 'items' && (
        <ItemsTab
          menu={menu}
          search={itemSearch}
          categoryFilter={itemCategoryFilter}
          badgeFilter={itemBadgeFilter}
          page={itemPage}
          pageSize={pageSize}
          lang={lang}
          onSearchChange={(v) => { setItemSearch(v); setItemPage(0); }}
          onCategoryFilterChange={(v) => { setItemCategoryFilter(v); setItemPage(0); }}
          onBadgeFilterChange={(v) => { setItemBadgeFilter(v); setItemPage(0); }}
          onPageChange={setItemPage}
          onAdd={() => {
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
          onOpenItem={(item, isNew) => {
            setEditingItem({ ...item, pricing: normalizePricing(item) });
            setIsNewItem(isNew);
            setCalcQty(1);
          }}
          onMove={catalog.handleMoveItem}
          onDuplicate={catalog.handleDuplicateItem}
          onDelete={(id) => void catalog.handleDeleteItem(id)}
          onUpdateItems={(updater) =>
            updateMenu((m) => ({ ...m, items: updater(m.items) }))
          }
        />
      )}

      {/* TAB 4: BACKUP & HISTORY */}
      {activeTab === 'backup' && (
        <BackupPanel
          lang={lang}
          versions={backup.versions}
          trash={backup.trash}
          status={backup.backupStatus}
          reportsOn={report.reportsOn}
          onLoadChanges={backup.onLoadChanges}
          onRestoreVersion={backup.onRestoreVersion}
          onExport={backup.onExport}
          onAnalyzeImport={backup.onAnalyzeImport}
          onApplyImport={backup.onApplyImport}
        onRestoreTrash={backup.onRestoreTrash}
        onDeleteForever={backup.onDeleteForever}
        onToggleAuto={backup.onToggleAuto}
        activity={backup.activity}
      />
      )}

      <AdminOverlays
        lang={lang}
        dirty={dirty}
        autoSave={autoSave}
        onSave={() => void handleSave()}
        undoToast={backup.undoToast}
        onUndo={(u) => { backup.clearUndoToast(); u(); }}
        confirmBox={confirmBox}
        onDismissConfirm={() => setConfirmBox(null)}
        editingItem={editingItem}
        isNewItem={isNewItem}
        menu={menu}
        calcQty={calcQty}
        pickingAddonSec={pickingAddonSec}
        onChangeItem={setEditingItem}
        onCalcQtyChange={setCalcQty}
        onToggleAddonPicker={() => setPickingAddonSec((p) => !p)}
        onCloseAddonPicker={() => setPickingAddonSec(false)}
        onCloseItem={() => setEditingItem(null)}
        onSaveItem={catalog.handleSaveItemModal}
      />
    </div>
  );
};
