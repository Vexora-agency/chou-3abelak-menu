import { useState, useEffect, useCallback } from 'react';
import type { ReportSettings, MonthlyReportRow } from '../components/ReportsPanel';
import type { CustomerResult } from '../components/CustomerData';
import { isRecord, readJson } from '@/src/utils/safeJson';
import type { AdminFetch } from '@/src/lib/api-client';

interface ReportCenterOptions {
  isAr: boolean;
  activeTab: string;
  adminFetch: AdminFetch;
}

/** Dashboard reports + customer-data tool (single reason to change: the dashboard data tab). */
export function useReportCenter({ isAr, activeTab, adminFetch }: ReportCenterOptions) {
  // Monthly reports (plan-gated: a 404 from report-settings means the
  // feature is off and the Reports view stays hidden).
  const [dashView, setDashView] = useState<'overview' | 'reports' | 'customers' | 'accounts'>('overview');
  const [customersOn, setCustomersOn] = useState(false);
  const [reportsOn, setReportsOn] = useState(false);
  const [reportSettings, setReportSettings] = useState<ReportSettings | null>(null);
  const [reportRows, setReportRows] = useState<MonthlyReportRow[]>([]);
  const [retentionCfg, setRetentionCfg] = useState({ piiDays: 90, orderMonths: 13, reportMonths: 36 });
  const [reportSched, setReportSched] = useState({ sendTime: '05:00', timezone: 'UTC' });
  const [, setBizTz] = useState('Asia/Beirut');

  const fetchReportData = useCallback(async () => {
    try {
      const r = await adminFetch('/api/admin/report-settings');
      if (r.status === 404) {
        setReportsOn(false);
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const s: unknown = await readJson(r);
      const rec = isRecord(s) ? s : {};
      setReportSettings({
        enabled: !!rec.enabled,
        email: typeof rec.email === 'string' ? rec.email : '',
        verified: !!rec.verified,
        language: rec.language === 'ar' ? 'ar' : 'en',
      });
      if (isRecord(rec.retention)) {
        setRetentionCfg({
          piiDays: Number(rec.retention.piiDays) || 90,
          orderMonths: Number(rec.retention.orderMonths) || 13,
          reportMonths: Number(rec.retention.reportMonths) || 36,
        });
      }
      if (isRecord(rec.schedule)) {
        setReportSched({
          sendTime: typeof rec.schedule.sendTime === 'string' ? rec.schedule.sendTime : '05:00',
          timezone: typeof rec.schedule.timezone === 'string' ? rec.schedule.timezone : 'UTC',
        });
      }
      if (typeof rec.businessTimezone === 'string' && rec.businessTimezone) setBizTz(rec.businessTimezone);
      setReportsOn(true);
      const rl = await adminFetch('/api/admin/reports');
      if (!rl.ok) throw new Error(`HTTP ${rl.status}`);
      const d: unknown = await readJson(rl);
      const rows = isRecord(d) && Array.isArray(d.reports) ? (d.reports as MonthlyReportRow[]) : [];
      setReportRows(rows);
    } catch {
      // Stay on Overview; the error banner covers order loading.
    }
  }, [adminFetch]);

  // Load reports data when the dashboard tab opens (fetch trigger).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch trigger, see above
    if (activeTab === 'dashboard') void fetchReportData();
  }, [activeTab, fetchReportData]);

  // Customer-data tool visibility (orderLogging feature probe).
  useEffect(() => {
    if (activeTab !== 'dashboard') return;
    void (async () => {
      try {
        const r = await adminFetch('/api/admin/customer-data/status');
        setCustomersOn(r.ok);
        if (!r.ok && dashView === 'customers') setDashView('overview');
      } catch {
        setCustomersOn(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const handleSaveReportSettings = async (s: { enabled: boolean; email: string; language: 'en' | 'ar' }) => {
    try {
      const res = await adminFetch('/api/admin/report-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s),
      });
      const data: unknown = await readJson(res);
      if (!res.ok || !isRecord(data) || !data.ok) return { ok: false as const };
      await fetchReportData();
      return { ok: true as const, verificationSent: !!data.verificationSent };
    } catch {
      return { ok: false as const };
    }
  };

  const handleResendVerification = async () => {
    try {
      await adminFetch('/api/admin/report-settings/resend', { method: 'POST' });
      await fetchReportData();
    } catch {}
  };

  const handleDownloadReport = async (month: string) => {
    try {
      const res = await adminFetch(`/api/admin/reports/${encodeURIComponent(month)}.csv`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chou3abelak-${month}-orders.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert(isAr ? 'تعذر تنزيل الملف. حاول مجددًا.' : 'Could not download the file. Please try again.');
    }
  };

  const searchCustomers = async (phone: string) => {
    const r = await adminFetch(`/api/admin/customer-data/search?phone=${encodeURIComponent(phone)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d: unknown = await readJson(r);
    const results = isRecord(d) && Array.isArray(d.results) ? (d.results as CustomerResult[]) : [];
    return { results, count: isRecord(d) && typeof d.count === 'number' ? d.count : 0 };
  };

  const handleCustomerAction = async ({ phone, mode, password, confirm }: { phone: string; mode: string; password: string; confirm: string }) => {
    const r = await adminFetch('/api/admin/customer-data/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, mode, password, confirm }),
    });
    const ct = r.headers.get('Content-Type') || '';
    if (mode === 'export' && r.ok && ct.includes('text/csv')) {
      const blob = await r.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'customer-data-export.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      return { ok: true, mode, count: undefined };
    }
    const d: unknown = await readJson(r);
    if (!r.ok || !isRecord(d) || !d.ok) {
      return { ok: false as const, error: isRecord(d) && typeof d.error === 'string' ? d.error : 'error' };
    }
    return {
      ok: true as const,
      mode: typeof d.mode === 'string' ? d.mode : undefined,
      count: typeof d.count === 'number' ? d.count : undefined,
    };
  };

  return {
    dashView, setDashView, customersOn, reportsOn, reportSettings, reportRows,
    retentionCfg, reportSched, fetchReportData,
    handleSaveReportSettings, handleResendVerification,
    handleDownloadReport, searchCustomers, handleCustomerAction,
  };
}
