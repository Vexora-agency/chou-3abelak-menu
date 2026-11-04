import React from 'react';
import type { MenuSettings } from '@/src/types/menu';
import { SettingsGroupBody, SettingsGroupHeader } from './SettingsCollapsible';

type Notifications = MenuSettings['notifications'];
type NotifyEventKey = keyof Notifications['events'];

interface NotifyEmailSectionProps {
  notifications: Notifications;
  lang: 'en' | 'ar';
  onUpdate: (updater: (prev: Notifications) => Notifications) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const DEFAULT_EVENTS: Notifications['events'] = { placed: true, confirmed: true, completed: true, cancelled: true, receipt_check: true };

const EVENT_KEYS: NotifyEventKey[] = ['placed', 'confirmed', 'completed', 'cancelled', 'receipt_check'];

/** Order notification email card of the admin Settings tab. */
export const NotifyEmailSection: React.FC<NotifyEmailSectionProps> = ({
  notifications,
  lang,
  onUpdate,
  collapsed = false,
  onToggleCollapse,
}) => {
  const isAr = lang === 'ar';
  const cur: Notifications = notifications ?? { senderName: '', replyTo: '', events: { ...DEFAULT_EVENTS } };
  const events = cur.events ?? { ...DEFAULT_EVENTS };

  const eventLabel = (key: NotifyEventKey): string => {
    switch (key) {
      case 'placed':
        return isAr ? 'طلب جديد' : 'Order placed';
      case 'confirmed':
        return isAr ? 'تأكيد الطلب' : 'Order confirmed';
      case 'completed':
        return isAr ? 'اكتمال الطلب' : 'Order completed';
      case 'cancelled':
        return isAr ? 'إلغاء الطلب' : 'Order cancelled';
      case 'receipt_check':
        return isAr ? 'تأكيد الاستلام' : 'Receipt check';
    }
  };

  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800">
      <SettingsGroupHeader
        title={isAr ? 'بريد إشعارات الطلبات' : 'Order notification email'}
        subtitle={isAr ? 'تحديثات الطلب عبر البريد — اختر الأحداث المرسلة' : 'Order updates by email — choose which events send'}
        lang={lang}
        collapsed={collapsed}
        onToggle={() => onToggleCollapse?.()}
      />
      <SettingsGroupBody open={!collapsed}>
        <div>
          <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'اسم المرسل' : 'Sender name'}</label>
          <input
            type="text"
            value={cur.senderName ?? ''}
            maxLength={80}
            onChange={(e) => onUpdate((prev) => ({ ...prev, senderName: e.target.value }))}
            placeholder={isAr ? 'مثال: مطعم شاورما' : 'e.g. Shawarma House'}
            className="w-full h-11 min-h-[44px] px-3 rounded-lg bg-black border border-neutral-700 text-base focus:border-[var(--primary)]"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-400 mb-1">{isAr ? 'البريد المردود عليه' : 'Reply-to email'}</label>
          <input
            type="email"
            inputMode="email"
            dir="ltr"
            value={cur.replyTo ?? ''}
            maxLength={254}
            onChange={(e) => onUpdate((prev) => ({ ...prev, replyTo: e.target.value }))}
            placeholder="name@example.com"
            className="w-full h-11 min-h-[44px] px-3 rounded-lg bg-black border border-neutral-700 text-base text-start focus:border-[var(--primary)]"
          />
        </div>
        <div className="space-y-2.5">
          {EVENT_KEYS.map((key) => {
            const on = events[key] !== false;
            return (
              <div key={key} className="rounded-xl border border-neutral-800 bg-black/40 p-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  onClick={() =>
                    onUpdate((prev) => ({
                      ...prev,
                      events: { ...(prev.events ?? { ...DEFAULT_EVENTS }), [key]: !((prev.events ?? { ...DEFAULT_EVENTS })[key] !== false) },
                    }))
                  }
                  className="w-full flex items-center justify-between gap-3 text-start min-h-[44px] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                >
                  <span>
                    <span className="block text-xs font-bold">{eventLabel(key)}</span>
                    <span className="block text-[11px] text-neutral-500 mt-0.5">
                      {on
                        ? isAr
                          ? 'مفعّل — يُرسل بريد عند هذا الحدث'
                          : 'On — sends an email for this event'
                        : isAr
                          ? 'مطفأ'
                          : 'Off'}
                    </span>
                  </span>
                  <span
                    className={`relative w-11 h-6 shrink-0 rounded-full transition-colors duration-200 ${
                      on ? 'bg-[var(--primary)]' : 'bg-neutral-700'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${
                        on ? (isAr ? 'left-0.5' : 'left-5') : isAr ? 'left-5' : 'left-0.5'
                      }`}
                    />
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </SettingsGroupBody>
    </div>
  );
};
