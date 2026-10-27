import React from 'react';
import { Save, AlertTriangle, Trash2 } from 'lucide-react';
import type { MenuData, MenuItem } from '@/src/types/menu';
import { ItemEditModal } from '@/src/components/ItemEditModal';

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
  lang, dirty, autoSave, onSave,
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
        <div className="fixed bottom-4 left-0 right-0 z-40 px-4 flex justify-center">
          <div className="w-full max-w-[500px] bg-[#141414] border-2 border-[#FFC400] rounded-full p-2 px-5 flex items-center justify-between shadow-2xl">
            <div className="flex items-center gap-2 text-xs text-amber-400 font-bold">
              <AlertTriangle size={16} />
              <span>{isAr ? 'لديك تعديلات غير محفوظة!' : 'Unsaved changes!'}</span>
            </div>

            <button
              type="button"
              onClick={() => onSave()}
              className="btn-tactile px-5 py-2 rounded-full bg-[#FFC400] text-[#0A0A0A] font-black text-xs flex items-center gap-1.5 shadow-md"
            >
              <Save size={15} />
              <span>{isAr ? 'حفظ التعديلات' : 'Save Changes'}</span>
            </button>
          </div>
        </div>
      )}

      {/* UNDO TOAST (8s after a trash delete) */}
      {undoToast && (
        <div className="fixed bottom-4 left-0 right-0 z-40 px-4 flex justify-center" role="status">
          <div className="w-full max-w-[500px] bg-[#141414] border border-neutral-700 rounded-full p-2 ps-5 flex items-center justify-between gap-3 shadow-2xl">
            <span className="text-xs font-bold text-neutral-200 truncate">{undoToast.label}</span>
            <button
              type="button"
              onClick={() => onUndo(undoToast.undo)}
              className="btn-tactile shrink-0 px-5 py-2 rounded-full bg-[#FFC400] text-[#0A0A0A] font-black text-xs"
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
