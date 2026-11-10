import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import type { MenuData } from '@/src/types/menu';
import { OrdersDashboard, type CronHealth, type Order, type OrderStatus } from '@/src/features/orders';
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
  /** Kitchen health signal (order-nag heartbeat). Null until fetched. */
  cronHealth: CronHealth | null;
  /** Grace-pipeline count (number only): `new` orders inside the 5-minute
   *  customer-cancel window, hidden from the list below. */
  graceHidden: number;
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
  onDownloadReport: (month: string) => void;
  onSearchCustomers: (phone: string) => Promise<{ results: CustomerResult[]; count: number }>;
  onCustomerAction: (args: { phone: string; mode: string; password: string; confirm: string }) => Promise<{ ok: boolean; mode?: string; count?: number; error?: string } | { ok: boolean; error: string }>;
  adminFetch: AdminFetch;
  onMenuRefreshed: () => Promise<boolean>;
  onConfirm?: (box: { title: string; body: string; confirmText: string; mode?: 'confirm' | 'info'; action?: () => void }) => void;
  /** Kitchen board: "Orders" title (no "Recent"); owner untouched. */
  kitchen?: boolean;
}

/** TAB 0: ORDERS DASHBOARD — pause control, view switcher, orders/reports/customers. */
export const AdminDashboardTab: React.FC<AdminDashboardTabProps> = ({
  lang, menu, orders, ordersLoading, ordersError, cronHealth, graceHidden,
  onOrderStatusChange, onRefreshOrders,
  reportsOn, customersOn, dashView, onDashViewChange,
  reportSettings, reportRows, retentionCfg, reportSched,
  onSaveReportSettings, onResendVerification, onDownloadReport,
  onSearchCustomers, onCustomerAction,
  adminFetch, onMenuRefreshed, onConfirm, kitchen,
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
  // While paused, refresh the menu on a slow cadence: a timed pause that
  // expires with the dashboard idle must flip to open by itself instead of
  // sticking on amber with a 0:00 countdown. (The cached menu never ages
  // on its own — only a refetch moves it.)
  useEffect(() => {
    if (!paused) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void onMenuRefreshed();
    }, 15000);
    return () => window.clearInterval(id);
  }, [paused, onMenuRefreshed]);

  // Server-clock correction snapshot (initializer runs once: rule-clean,
  // strictly better than the old code which had no correction at all).
  const [clockOffsetMs] = useState(() => serverNow() - Date.now());

  // Kitchen health banner: shown when the order-nag sweep goes stale
  // (>3 min, amber) or critical (>5 min, red). Minutes-since-last-sweep
  // recomputes on every render — the 5 s orders poll keeps it fresh.
  // neverRan (fresh install, no sweep yet) never alarms.
  const cronAt = cronHealth && !cronHealth.neverRan && cronHealth.lastSuccessAt
    ? Date.parse(cronHealth.lastSuccessAt) : NaN;
  const cronMins = Number.isFinite(cronAt) ? Math.max(1, Math.round((Date.now() - cronAt) / 60000)) : null;
  const showCronBanner = showOrders && !!cronHealth && !cronHealth.neverRan && (cronHealth.stale || cronHealth.critical);

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
      {showCronBanner && cronHealth && (
        <div className={`mb-3 flex items-center justify-between gap-3 p-3 rounded-xl text-xs font-bold border ${
          cronHealth.critical
            ? 'bg-red-500/10 border-red-500/30 text-red-300'
            : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
        }`}>
          <span>
            {cronHealth.critical
              ? (isAr ? 'التحديث التلقائي للمطبخ متوقف' : 'Kitchen auto-updates stopped')
              : (isAr ? 'التحديث التلقائي للمطبخ متأخر' : 'Kitchen auto-updates delayed')}
            {cronMins !== null && (
              <span className="opacity-80">{isAr ? ` — آخر تحديث منذ ${cronMins} د` : ` — last sweep ${cronMins}m ago`}</span>
            )}
            {cronHealth.critical && <span className="opacity-80">{isAr ? ' — تحقق من خدمة الكرون' : ' — check the cron service'}</span>}
          </span>
          <button
            type="button"
            onClick={() => onRefreshOrders()}
            className={`px-5 h-11 min-h-[44px] inline-flex items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 ${
              cronHealth.critical
                ? 'bg-red-500/20 hover:bg-red-500/30 focus-visible:ring-red-400'
                : 'bg-amber-500/20 hover:bg-amber-500/30 focus-visible:ring-amber-400'
            }`}
          >
            {isAr ? 'تحديث' : 'Refresh'}
          </button>
        </div>
      )}
      {/* Pipeline visibility (count only, no PII): orders sitting inside the
          5-minute customer-cancel window are hidden from the list below by
          design — this line proves a quiet board is calm, not stuck. */}
      {showOrders && graceHidden > 0 && (
        <p className="mb-3 flex items-center gap-1.5 text-[11px] font-bold text-neutral-500">
          <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] animate-pulse" />
          {isAr
            ? `${graceHidden} في مهلة الإلغاء (5 دقايق) — هيظهروا هنا تلقائيًا`
            : `${graceHidden} in the 5-min grace window — appearing automatically`}
        </p>
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
        onConfirm={onConfirm}
        onRefresh={() => onRefreshOrders()}
        kitchenSound={menu.settings.sounds?.kitchen}
        kitchen={kitchen}
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
