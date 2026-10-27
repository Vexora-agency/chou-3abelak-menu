import type { MenuSettings } from '@/src/types/menu';

/** Marquee on unless the owner switches motion off. */
export function annScroll(ann: MenuSettings['announcement']): boolean {
  return ann?.scroll !== false;
}

/** Speed step 1 (slow) .. 10 (fast), default 5. */
export function annSpeed(ann: MenuSettings['announcement']): number {
  const s = ann?.speed;
  if (typeof s !== 'number' || !Number.isFinite(s)) return 5;
  return Math.min(10, Math.max(1, Math.round(s)));
}

/** Reading speed in px/s for a speed step — constant whatever the text length. */
export function pxPerSec(speed: number): number {
  return 10 + speed * 14;
}

export type AnnStatus = 'visible' | 'off' | 'empty' | 'scheduled' | 'expired';

/** Why the banner is (or isn't) showing — shared by the storefront banner and
 *  the admin live preview so the preview can never disagree with the storefront. */
export function announcementStatus(
  ann: MenuSettings['announcement'],
  lang: 'en' | 'ar',
  now: number
): { status: AnnStatus; text: string } {
  if (!ann || !ann.enabled) return { status: 'off', text: '' };
  const text =
    (lang === 'ar' ? ann.text.ar : ann.text.en) || (lang === 'ar' ? ann.text.en : ann.text.ar) || '';
  if (!text.trim()) return { status: 'empty', text: '' };
  if (ann.startsAt) {
    const t = Date.parse(ann.startsAt);
    if (Number.isFinite(t) && now < t) return { status: 'scheduled', text };
  }
  if (ann.expiresAt) {
    const t = Date.parse(ann.expiresAt);
    if (!Number.isFinite(t) || now >= t) return { status: 'expired', text };
  }
  return { status: 'visible', text };
}
