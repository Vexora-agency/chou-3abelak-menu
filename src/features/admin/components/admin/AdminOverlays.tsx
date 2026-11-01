import React from 'react';
import { Save, AlertTriangle, Trash2 } from 'lucide-react';
import type { MenuData, MenuItem } from '@/src/types/menu';
import { ItemEditModal } from '../ItemEditModal';

export interface ConfirmBox {
  title: string;
  body: string;
  confirmText: string;
  mode?: 'confirm' | 'info';
  action?: () => void;
}

interface AdminOverlaysProps {
  lang: 'en' | 'ar';
  dirty: boolean;
  autoSave: boolean;
  onSave: () => void;
  isSaving: boolean;
  saveConflict: boolean;
  onDismissConflict: () => void;
  undoToast: { label: string; undo: () => void } | null;
  onUndo: (undo: () => void) => void;
  confirmBox: ConfirmBox | null;
  onDismissConfirm: () => void;
  editingItem: MenuItem | null;
  isNewItem: boolean;
  menu: MenuData;
  calcQty: number;
  pickingAddonSec: boolean;
  onChangeItem: (item: MenuItem | null) => void;
  onCalcQtyChange: (q: number) => void;
  onToggleAddonPicker: () => void;
  onCloseAddonPicker: () => void;
  onCloseItem: () => void;
  onSaveItem: () => void;
}

/** Floating save bar, undo toast, confirm dialog, item editor modal. */
export const AdminOverlays: React.FC<AdminOverlaysProps> = ({
  lang, dirty, autoSave, onSave, isSaving, saveConflict, onDismissConflict,
  undoToast, onUndo,
  confirmBox, onDismissConfirm,
  editingItem, isNewItem, menu, calcQty, pickingAddonSec,
  onChangeItem, onCalcQtyChange, onToggleAddonPicker, onCloseAddonPicker,
  onCloseItem, onSaveItem,
}) => {
  const isAr = lang === 'ar';
  return (
    <>
      {/* STICKY BOTTOM SAVE BAR (hidden while auto-save is on) */}
      {dirty && !autoSave && (
        <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-0 right-0 z-40 px-4 flex justify-center">
          <div className="w-full max-w-[500px] bg-[#141414] border-2 border-[var(--primary)] rounded-3xl sm:rounded-full p-2 px-4 flex items-center justify-between gap-2 flex-wrap shadow-2xl">
            <div className="flex items-center gap-2 text-xs text-amber-400 font-bold min-w-0">
              <AlertTriangle size={16} className="shrink-0" />
              <span className="break-words">{isAr ? 'لديك تعديلات غير محفوظة!' : 'Unsaved changes!'}</span>
            </div>

            <button
              type="button"
              onClick={() => onSave()}
              disabled={isSaving}
              className="btn-tactile px-5 min-h-[44px] inline-flex items-center rounded-full bg-[var(--primary)] text-[#0A0A0A] font-black text-xs gap-1.5 shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:opacity-60"
            >
              <Save size={15} />
              <span>{isSaving ? (isAr ? 'جارٍ الحفظ…' : 'Saving…') : (isAr ? 'حفظ التعديلات' : 'Save Changes')}</span>
            </button>
          </div>
        </div>
      )}

      {/* SAVE-CONFLICT BANNER: a 409 kept the draft (dirty) and rebased
          only its version. Stays until the next successful save or manual
          dismiss — the autosave bar above hides when autoSave is on, so a
          conflict would otherwise be invisible. */}
      {saveConflict && (
        <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-0 right-0 z-40 px-4 flex justify-center" role="alert">
          <div className="w-full max-w-[500px] bg-[#141414] border-2 border-red-500/60 rounded-3xl sm:rounded-full p-2 px-4 flex items-center justify-between gap-2 flex-wrap shadow-2xl">
            <div className="flex items-center gap-2 text-xs text-red-300 font-bold min-w-0">
              <AlertTriangle size={16} className="shrink-0" />
              <span className="break-words">{isAr ? 'تعارض حفظ — تغييرك محفوظ هنا ولم يُفقَد.' : 'Save conflict — your change is kept here.'}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onSave()}
                disabled={isSaving}
                className="btn-tactile px-5 min-h-[44px] inline-flex items-center rounded-full bg-[var(--primary)] text-[#0A0A0A] font-black text-xs gap-1.5 shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:opacity-60"
              >
                <Save size={15} />
                <span>{isAr ? 'إعادة المحاولة' : 'Retry'}</span>
              </button>
              <button
                type="button"
                onClick={() => onDismissConflict()}
                aria-label={isAr ? 'إغلاق' : 'Dismiss'}
                className="w-11 h-11 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-full text-neutral-400 hover:text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* UNDO TOAST (8s after a trash delete) */}
      {undoToast && (
        <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-0 right-0 z-40 px-4 flex justify-center" role="status">
          <div className="w-full max-w-[500px] bg-[#141414] border border-neutral-700 rounded-3xl sm:rounded-full p-2 ps-4 flex items-center justify-between gap-3 shadow-2xl">
            <span className="text-xs font-bold text-neutral-200 truncate min-w-0" dir="auto">{undoToast.label}</span>
            <button
              type="button"
              onClick={() => onUndo(undoToast.undo)}
              className="btn-tactile shrink-0 px-5 min-h-[44px] inline-flex items-center rounded-full bg-[var(--primary)] text-[#0A0A0A] font-black text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            >
              {isAr ? 'تراجع' : 'Undo'}
            </button>
          </div>
        </div>
      )}

      {/* EDIT ITEM DIALOG MODAL */}
      {editingItem && (
        <ItemEditModal
          item={editingItem}
          isNew={isNewItem}
          menu={menu}
          calcQty={calcQty}
          pickingAddonSec={pickingAddonSec}
          lang={lang}
          onChange={onChangeItem}
          onCalcQtyChange={onCalcQtyChange}
          onToggleAddonPicker={onToggleAddonPicker}
          onCloseAddonPicker={onCloseAddonPicker}
          onClose={onCloseItem}
          onSave={onSaveItem}
        />
      )}

      {/* Professional confirm dialog (deletes) */}
      {confirmBox && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="alertdialog" aria-modal="true">
          <div className="fixed inset-0 bg-black/70 anim-fade-in" onClick={onDismissConfirm} aria-hidden="true" />
          <div className="relative z-10 w-full max-w-[340px] bg-[#141414] text-white border-2 border-red-500/60 rounded-2xl p-5 text-center shadow-2xl anim-pop-in">
            <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center mx-auto mb-3">
              <Trash2 size={22} />
            </div>
            <h3 className="text-base font-extrabold">{confirmBox.title}</h3>
            <p className="text-xs text-neutral-400 mt-1.5 leading-relaxed">{confirmBox.body}</p>
            <div className="flex gap-2 mt-5">
              <button
                type="button"
                onClick={onDismissConfirm}
                className="flex-1 h-11 rounded-full border border-white/20 text-white/80 text-sm font-bold hover:bg-white/5 transition-colors"
              >
                {confirmBox.mode === 'info' ? (isAr ? 'فهمت' : 'OK') : (isAr ? 'تراجع' : 'Cancel')}
              </button>
              {confirmBox.mode !== 'info' && (
                <button
                  type="button"
                  onClick={() => {
                    confirmBox.action?.();
                    onDismissConfirm();
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
    </>
  );
};
