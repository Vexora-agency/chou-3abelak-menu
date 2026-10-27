import { STR } from '@/src/components/backup/backupStrings';

export const card = 'p-4 sm:p-5 rounded-2xl bg-neutral-900 border border-neutral-800';
export const loc = (l: 'en' | 'ar') => (l === 'ar' ? 'ar-u-nu-latn' : 'en-US');
export const fmtDate = (iso: string, l: 'en' | 'ar') => new Date(iso).toLocaleString(loc(l), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export function rel(iso: string | undefined, l: 'en' | 'ar') {
  if (!iso) return '';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return STR[l].now;
  if (m < 60) return l === 'ar' ? `قبل ${m} د` : `${m} min ago`;
  if (m < 60 * 24) return l === 'ar' ? `قبل ${Math.floor(m / 60)} س` : `${Math.floor(m / 60)}h ago`;
  return l === 'ar' ? `قبل ${Math.floor(m / 1440)} يوماً` : `${Math.floor(m / 1440)}d ago`;
}
