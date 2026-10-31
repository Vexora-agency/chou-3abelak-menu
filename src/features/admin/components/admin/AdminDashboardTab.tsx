import React, { useState } from 'react';
import { motion } from 'motion/react';
import type { MenuData } from '@/src/types/menu';
import { OrdersDashboard, type Order, type OrderStatus } from '@/src/features/orders';
import { ReportsPanel, type ReportSettings, type MonthlyReportRow, CustomerData, type CustomerResult } from '@/src/features/reports';
import OrderingToggle from './OrderingToggle';
import { getOrderingState } from '@/src/utils/status';
import { serverNow } from '@/src/utils/serverTime';
import type { AdminFetch } from '@/src/lib/api-client';
import { featuresConfig } from '@/src/config/features.config';

export type DashView = 'overview' | 'reports' | 'customers';

interface AdminDashboardTabProps {
  lang: 'en' | 'ar';
  menu: MenuData;
  orders: Order[];
  ordersLoading: boolean;
  ordersError: boolean;
  onOrderStatusChange: (id: string, s: OrderStatus) => void;
  onRefreshOrders: () => void;
  reportsOn: boolean;
  customersOn: boolean;
  dashView: DashView;
  onDashViewChange: (v: DashView) => void;
  reportSettings: ReportSettings | null;
  reportRows: MonthlyReportRow[];
  retentionCfg: { piiDays: number; orderMonths: number; reportMonths: number };
  reportSched: { sendTime: string; timezone: string };
  onSaveReportSettings: (s: { enabled: boolean; email: string; language: 'en' | 'ar' }) => Promise<{ ok: boolean; verificationSent?: boolean } | { ok: boolean }>;
  onResendVerification: () => Promise<void>;
  onSendTestReport: () => Promise<{ ok: boolean }>;
  onDownloadReport: (month: string) => void;
  onSearchCustomers: (phone: string) => Promise<{ results: CustomerResult[]; count: number }>;
  onCustomerAction: (args: { phone: string; mode: string; password: string; confirm: string }) => Promise<{ ok: boolean; mode?: string; count?: number; error?: string } | { ok: boolean; error: string }>;
  adminFetch: AdminFetch;
  onMenuRefreshed: () => Promise<boolean>;
}

/** TAB 0: ORDERS DASHBOARD — pause control, view switcher, orders/reports/customers. */
export const AdminDashboardTab: React.FC<AdminDashboardTabProps> = ({
  lang, menu, orders, ordersLoading, ordersError,
  onOrderStatusChange, onRefreshOrders,
  reportsOn, customersOn, dashView, onDashViewChange,
  reportSettings, reportRows, retentionCfg, reportSched,
  onSaveReportSettings, onResendVerification, onSendTestReport, onDownloadReport,
  onSearchCustomers, onCustomerAction,
  adminFetch, onMenuRefreshed,
}) => {
  const isAr = lang === 'ar';
  // White-label package gates: starter hides Reports UI, the customers view
  // and the orders overview (backend 404s all three too — these only hide
  // the tabs). The pause toggle above stays for every plan (core ops).
  // Current client has everything on → visually identical.
  const showReports = reportsOn && featuresConfig.enableReports;
  const showCustomers = customersOn && featuresConfig.enableCustomerData;
  const showOrders = featuresConfig.enableOrderLogging;
  // An expired timed pause counts as resumed everywhere (the state machine
  // treats it as open) — otherwise admin shows a stuck amber panel + 0:00
  // counter while customers can already order.
  const pausedUntilMs = typeof menu.settings.ordering.pausedUntil === 'string'
    ? Date.parse(menu.settings.ordering.pausedUntil) : NaN;
  const paused = menu.settings.ordering.paused === true
    && (!Number.isFinite(pausedUntilMs) || pausedUntilMs > serverNow());
  const liveState = getOrderingState(menu.settings, serverNow());
  // 'disabled' is its own truthful state — it must never masquerade as green
  // 'open', or the owner thinks ordering works while customers are blocked.
  const toggleState = liveState.state === 'disabled' ? 'disabled'
    : liveState.state === 'paused' ? 'paused'
    : liveState.state === 'closed' ? 'closed' : 'open';
  const resumesAt = paused && menu.settings.ordering.pausedUntil ? menu.settings.ordering.pausedUntil : null;
  const reopensAt = !paused && toggleState === 'closed' && liveState.reopensAt ? liveState.reopensAt : null;
  const pausedAtRaw = menu.settings.ordering.pausedAt ? Date.parse(menu.settings.ordering.pausedAt) : NaN;
  const sendPause = async (body: object) => {
    try {
      const r = await adminFetch('/api/admin/ordering/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error();
      await onMenuRefreshed();
    } catch {
      alert(isAr ? 'تعذر تحديث الحالة. حاول مجدداً.' : 'Could not update the status. Please try again.');
    }
  };
  const handlePause = (minutes: number | null) => sendPause(minutes === null ? { minutes: null } : { minutes });
  const handleResume = () => sendPause({ resume: true });
  // Server-clock correction snapshot (initializer runs once: rule-clean,
  // strictly better than the old code which had no correction at all).
  const [clockOffsetMs] = useState(() => serverNow() - Date.now());

  return (
    <>
      {/* Pause control — same design and motion as the launch spec */}
      <div className="mb-4">
        <OrderingToggle
          lang={lang}
          state={toggleState}
          resumesAt={resumesAt}
          reopensAt={reopensAt}
          timezone={menu.settings.timezone || 'Asia/Beirut'}
          clockOffsetMs={clockOffsetMs}
          pausedAtMs={Number.isFinite(pausedAtRaw) ? pausedAtRaw : null}
          onPause={handlePause}
          onResume={handleResume}
        />
      </div>
      {ordersError && showOrders && (
        <div className="mb-3 flex items-center justify-between gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs font-bold">
          <span>{isAr ? 'تعذر تحميل الطلبات.' : 'Could not load orders.'}</span>
          <button
            type="button"
          onClick={() => onRefreshOrders()}
          className="px-5 h-11 min-h-[44px] inline-flex items-center rounded-full bg-red-500/20 hover:bg-red-500/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            {isAr ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </div>
      )}
      {(showReports || showCustomers) && (
        <div className="mb-4 flex gap-1 p-1 bg-neutral-900 rounded-full border border-neutral-800 w-fit max-w-full overflow-x-auto no-scrollbar" role="tablist" aria-label={isAr ? 'الداشبورد' : 'Dashboard'}>
          {(['overview', ...(showReports ? ['reports'] : []), ...(showCustomers ? ['customers'] : [])] as Array<'overview' | 'reports' | 'customers'>).map((v) => {
            const active = dashView === v;
            return (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onDashViewChange(v)}
                className={`relative shrink-0 px-4 h-11 min-h-[44px] inline-flex items-center rounded-full text-xs font-bold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${active ? 'text-[#0A0A0A]' : 'text-neutral-400 hover:text-white'}`}
              >
                {active && <motion.span layoutId="dash-view" className="absolute inset-0 rounded-full bg-[var(--primary)] shadow-md" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                <span className="relative z-10">
                  {v === 'overview' ? (isAr ? 'نظرة عامة' : 'Overview') : v === 'reports' ? (isAr ? 'التقارير' : 'Reports') : (isAr ? 'العملاء' : 'Customers')}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {dashView === 'overview' && showOrders && (
      <OrdersDashboard
        lang={lang}
        orders={orders}
        currency={menu.settings.currency[lang] || menu.settings.currency.en}
        loading={ordersLoading}
        onStatusChange={(id, s) => onOrderStatusChange(id, s)}
        onRefresh={() => onRefreshOrders()}
        kitchenSound={menu.settings.sounds?.kitchen}
      />
      )}
      {dashView === 'reports' && showReports && reportSettings && (
        <ReportsPanel
          lang={lang}
          currency={menu.settings.currency[lang] || menu.settings.currency.en}
          settings={reportSettings}
          reports={reportRows}
          retention={retentionCfg}
          sendTime={reportSched.sendTime}
          timezone={reportSched.timezone}
          onSaveSettings={onSaveReportSettings}
          onResendVerification={onResendVerification}
          onSendTest={onSendTestReport}
          onDownload={(m) => onDownloadReport(m)}
        />
      )}
      {dashView === 'customers' && showCustomers && (
        <CustomerData
          lang={lang}
          currency={menu.settings.currency[lang] || menu.settings.currency.en}
          onSearch={onSearchCustomers}
          onAction={onCustomerAction}
        />
      )}
    </>
  );
};
