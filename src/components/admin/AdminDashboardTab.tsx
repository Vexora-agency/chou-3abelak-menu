import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import type { MenuData } from '@/src/types/menu';
import OrdersDashboard, { type Order, type OrderStatus } from '@/src/components/OrdersDashboard';
import ReportsPanel, { type ReportSettings, type MonthlyReportRow } from '@/src/components/ReportsPanel';
import CustomerData, { type CustomerResult } from '@/src/components/CustomerData';

export type DashView = 'overview' | 'reports' | 'customers';

/** Live "paused for HH:MM:SS" ticker — its own 1s clock so the dashboard
 *  doesn't re-render every second, and no refresh is needed to see time pass. */
function PausedElapsed({ since, isAr }: { since: number; isAr: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return <span>{isAr ? `منذ ${hh}:${mm}:${ss}` : `for ${hh}:${mm}:${ss}`}</span>;
}

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
  adminFetch: (url: string, init?: RequestInit) => Promise<Response>;
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
  const [pauseMenuOpen, setPauseMenuOpen] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <>
      {/* One-tap pause control (quick-toggle endpoint + menu refresh) */}
      {(() => {
        const paused = !!menu.settings.ordering.paused;
        const until = menu.settings.ordering.pausedUntil ? Date.parse(menu.settings.ordering.pausedUntil) : NaN;
        const pausedAtMs = menu.settings.ordering.pausedAt ? Date.parse(menu.settings.ordering.pausedAt) : NaN;
        const minsLeft = Number.isFinite(until) ? Math.max(0, Math.round((until - nowTick) / 60000)) : null;
        const countdown = minsLeft !== null
          ? (isAr ? `يستأنف بعد ${minsLeft} دقيقة` : `Resumes in ${minsLeft} min`)
          : (isAr ? 'متوقف حتى الاستئناف' : 'Paused until resumed');
        const sendPause = async (body: object) => {
          setPauseMenuOpen(false);
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
        return (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="flex gap-1 p-1 bg-neutral-900 rounded-full border border-neutral-800" role="group" aria-label={isAr ? 'حالة استقبال الطلبات' : 'Order acceptance'}>
              <button
                type="button"
                aria-pressed={!paused}
                onClick={() => { if (paused) void sendPause({ resume: true }); }}
                className={`relative px-4 h-8 rounded-full text-xs font-bold transition-colors ${!paused ? 'text-[#0A0A0A]' : 'text-neutral-400 hover:text-white'}`}
              >
                {!paused && <motion.span layoutId="pause-seg" className="absolute inset-0 rounded-full bg-[#FFC400] shadow-md" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                <span className="relative z-10 inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" aria-hidden="true" />
                  {isAr ? 'يستقبل' : 'Accepting'}
                </span>
              </button>
              <button
                type="button"
                aria-pressed={paused}
                onClick={() => { if (!paused) setPauseMenuOpen((v) => !v); }}
                className={`relative px-4 h-8 rounded-full text-xs font-bold transition-colors ${paused ? 'text-[#0A0A0A]' : 'text-neutral-400 hover:text-white'}`}
              >
                {paused && <motion.span layoutId="pause-seg" className="absolute inset-0 rounded-full bg-[#FFC400] shadow-md" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                <span className="relative z-10 inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-500" aria-hidden="true" />
                  {isAr ? 'متوقف' : 'Paused'}
                </span>
              </button>
            </div>
            {paused ? (
              <span className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-orange-300 tabular-nums">{countdown}</span>
                {Number.isFinite(pausedAtMs) && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-orange-300/80 tabular-nums">
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" aria-hidden="true" />
                    <PausedElapsed since={pausedAtMs} isAr={isAr} />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void sendPause({ resume: true })}
                  className="btn-tactile h-8 px-4 rounded-full bg-[#FFC400] text-[#0A0A0A] text-xs font-bold"
                >
                  {isAr ? 'استئناف' : 'Resume'}
                </button>
              </span>
            ) : (
              <span className="relative">
                {pauseMenuOpen && (
                  <>
                    {/* Clicking anywhere outside closes the duration menu */}
                    <button
                      type="button"
                      aria-hidden="true"
                      tabIndex={-1}
                      onClick={() => setPauseMenuOpen(false)}
                      className="fixed inset-0 z-20 cursor-default bg-transparent"
                    />
                    <span className="absolute z-30 mt-1 flex flex-col gap-1 p-1.5 rounded-xl bg-neutral-900 border border-neutral-700 shadow-2xl min-w-[160px]">
                    {([30, 60, 120] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => void sendPause({ minutes: m })}
                        className="text-start px-3 h-9 rounded-lg text-xs font-bold text-neutral-200 hover:bg-white/5"
                      >
                        {isAr ? `إيقاف ${m === 30 ? '30 دقيقة' : m === 60 ? 'ساعة' : 'ساعتين'}` : `Pause ${m === 30 ? '30 min' : m === 60 ? '1 hour' : '2 hours'}`}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => void sendPause({ minutes: null })}
                      className="text-start px-3 h-9 rounded-lg text-xs font-bold text-neutral-200 hover:bg-white/5"
                    >
                      {isAr ? 'حتى الاستئناف' : 'Until I resume'}
                    </button>
                    </span>
                  </>
                )}
              </span>
            )}
            <span className="basis-full text-[11px] leading-relaxed text-neutral-500">
              {paused
                ? (minsLeft !== null
                  ? (isAr ? 'الطلبات الجديدة متوقفة الآن — ستُستأنف تلقائياً عند انتهاء المدة.' : 'New orders are stopped — they resume automatically when the timer ends.')
                  : (isAr ? 'الطلبات الجديدة متوقفة الآن — لن تُستأنف إلا عندما تدوس استئناف.' : 'New orders are stopped — they resume only when you tap Resume.'))
                : (isAr ? 'الإيقاف يمنع أي طلب جديد فوراً — والزبائن يرون رسالتك بدل زر الإرسال.' : 'Pausing instantly blocks new orders — customers see your message instead of Send.')}
            </span>
          </div>
        );
      })()}
      {ordersError && (
        <div className="mb-3 flex items-center justify-between gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs font-bold">
          <span>{isAr ? 'تعذر تحميل الطلبات.' : 'Could not load orders.'}</span>
          <button
            type="button"
          onClick={() => onRefreshOrders()}
          className="px-3 py-1.5 rounded-full bg-red-500/20 hover:bg-red-500/30 transition-colors"
          >
            {isAr ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </div>
      )}
      {(reportsOn || customersOn) && (
        <div className="mb-4 flex gap-1 p-1 bg-neutral-900 rounded-full border border-neutral-800 w-fit max-w-full overflow-x-auto" role="tablist" aria-label={isAr ? 'الداشبورد' : 'Dashboard'}>
          {(['overview', ...(reportsOn ? ['reports'] : []), ...(customersOn ? ['customers'] : [])] as Array<'overview' | 'reports' | 'customers'>).map((v) => {
            const active = dashView === v;
            return (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onDashViewChange(v)}
                className={`relative shrink-0 px-4 h-8 rounded-full text-xs font-bold whitespace-nowrap transition-colors ${active ? 'text-[#0A0A0A]' : 'text-neutral-400 hover:text-white'}`}
              >
                {active && <motion.span layoutId="dash-view" className="absolute inset-0 rounded-full bg-[#FFC400] shadow-md" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                <span className="relative z-10">
                  {v === 'overview' ? (isAr ? 'نظرة عامة' : 'Overview') : v === 'reports' ? (isAr ? 'التقارير' : 'Reports') : (isAr ? 'العملاء' : 'Customers')}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {dashView === 'overview' && (
      <OrdersDashboard
        lang={lang}
        orders={orders}
        currency={menu.settings.currency[lang] || menu.settings.currency.en}
        loading={ordersLoading}
        onStatusChange={(id, s) => onOrderStatusChange(id, s)}
        onRefresh={() => onRefreshOrders()}
      />
      )}
      {dashView === 'reports' && reportsOn && reportSettings && (
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
      {dashView === 'customers' && customersOn && (
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
