/**
 * Shared settings-default helpers for old/seed docs.
 *
 * Both client entry points — `normalizeMenu` (pricing.ts, used on every menu
 * load) and `ensureSettingsBlocks` (menuHelpers.ts, used by the admin panel)
 * — must apply byte-identical defaults. They used to carry their own copies
 * of these leaves; this module is the single source of truth.
 * Mirrors the server validator's defaults (functions/_shared/validate.js).
 * All functions are pure and never mutate their input.
 */

import type { SeasonalSettings, SocialPlatform } from '@/src/types/menu';
import { isBellSoundId } from '@/src/utils/bellPatterns';

export interface Bilingual {
  en: string;
  ar: string;
}

/** Coerce an unknown value to {en, ar} strings, sliced to `max` chars. */
export function bilingualBlock(v: unknown, max = 300): Bilingual {
  if (!v || typeof v !== 'object') return { en: '', ar: '' };
  const r = v as Record<string, unknown>;
  return {
    en: typeof r.en === 'string' ? r.en.slice(0, max) : '',
    ar: typeof r.ar === 'string' ? r.ar.slice(0, max) : '',
  };
}

/**
 * Corrupt date strings (hand-edited seeds, old caches) become null so time
 * windows treat them as "no limit" instead of hiding/showing forever.
 */
export function isoDateOrNull(v: unknown): string | null {
  return typeof v === 'string' && v && Number.isFinite(Date.parse(v)) ? v : null;
}

const VALID_DAYS = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];

/** Working-days list; unknown values dropped, empty means every day. */
export function workingDaysOrAll(v: unknown): string[] {
  const list: string[] = [];
  if (Array.isArray(v)) {
    for (const d of v) {
      if (typeof d === 'string' && VALID_DAYS.includes(d) && !list.includes(d)) list.push(d);
    }
  } else {
    return [...VALID_DAYS];
  }
  return list.length ? list : [...VALID_DAYS];
}

export interface SocialFlags {
  instagram: boolean;
  facebook: boolean;
  whatsapp: boolean;
}

/** Social visibility flags; anything but explicit `false` means on. */
export function socialFlagsOrDefault(v: unknown): SocialFlags {
  const r = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  return {
    instagram: r.instagram !== false,
    facebook: r.facebook !== false,
    whatsapp: r.whatsapp !== false,
  };
}

/** Canonical social platform order (admin-reorderable in settings). */
export const SOCIAL_PLATFORMS = ['instagram', 'facebook', 'whatsapp'] as const;

/** Display order of the social platforms; unknown keys dropped, missing ones appended. */
export function socialOrderOrDefault(v: unknown): SocialPlatform[] {
  const order: SocialPlatform[] = [];
  if (Array.isArray(v)) {
    for (const k of v) {
      if (
        typeof k === 'string' &&
        (SOCIAL_PLATFORMS as readonly string[]).includes(k) &&
        !order.includes(k as SocialPlatform)
      ) {
        order.push(k as SocialPlatform);
      }
    }
  }
  for (const k of SOCIAL_PLATFORMS) {
    if (!order.includes(k)) order.push(k);
  }
  return order;
}

/** Status mode; unknown values fall back to automatic hours. */
export function statusModeOrDefault(v: unknown): 'auto' | 'open' | 'closed' {
  return v === 'open' || v === 'closed' ? v : 'auto';
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "HH:MM" wall time; anything else falls back so open/closed never breaks. */
export function clockTimeOrDefault(v: unknown, fallback: string): string {
  return typeof v === 'string' && TIME_RE.test(v) ? v : fallback;
}

/** Business timezone; blank falls back to the restaurant's zone. */
export function timezoneOrDefault(v: unknown): string {
  return typeof v === 'string' && v.trim() ? v : 'Asia/Beirut';
}

/** Ticker speed step 1 (slow) .. 10 (fast), default 5. */
export function tickerSpeedOrDefault(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(10, Math.max(1, Math.round(v))) : 5;
}

/** Smart-ETA minute fields (prep / per-order / fallback): 0..180, default `fallback`. */
export function etaMinutesOrDefault(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 180 ? Math.round(v) : fallback;
}

/** Smart-ETA courier speed km/h: 5..120, default 25. Floats preserved. */
export function courierSpeedOrDefault(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 5 && v <= 120 ? v : 25;
}

/** Smart-ETA road detour multiplier: 1.0..2.0 rounded to 2 decimals, default 1.35. */
export function roadFactorOrDefault(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 2
    ? Math.round((v + Number.EPSILON) * 100) / 100
    : 1.35;
}

/** Smart-ETA receive-delay windows: 0..720 min, default `fallback`. */
export function receiveDelayOrDefault(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 720 ? Math.round(v) : fallback;
}

/** Customer self-cancel / kitchen grace window, whole minutes 1..30.
 *  Zero/blank/out-of-range in old docs falls back to `fallback` (5), so
 *  legacy menus behave exactly as today. */
export function cancelWindowOrDefault(v: unknown, fallback = 5): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 30 ? Math.round(v) : fallback;
}

/** Featured-carousel interval seconds, 2..10, default 4. */
export function autoplayIntervalOrDefault(v: unknown): number {
  return typeof v === 'number' && v >= 2 && v <= 10 ? Math.round(v) : 4;
}

export interface BellSounds {
  kitchen: string;
  customer: string;
}

/**
 * Owner-picked bell chimes; unknown ids fall back to classic (the engines
 * resolve unknown -> classic too, so an old client never goes silent).
 */
export function soundsOrDefault(v: unknown): BellSounds {
  const r = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const pick = (x: unknown) => (isBellSoundId(typeof x === 'string' ? x.trim() : x) ? (x as string).trim() : 'classic');
  return { kitchen: pick(r.kitchen), customer: pick(r.customer) };
}

/** Seasonal storefront themes (extensible — add future seasons here). */
export const SEASONAL_THEMES = ['off', 'christmas'] as const;

export type SeasonalThemeId = (typeof SEASONAL_THEMES)[number];

/** Seasonal theme id; unknown values fall back to `off` (never trusted blindly). */
export function seasonalThemeOrDefault(v: unknown): SeasonalThemeId {
  return v === 'christmas' ? 'christmas' : 'off';
}

/** Seasonal block; missing in old docs → `{ theme: 'off', live: false }`.
 *  `live` is strictly boolean (anything else → false): only an explicit
 *  dashboard flip ever turns effects on. Pure, never mutates. */
export function seasonalOrDefault(v: unknown): SeasonalSettings {
  const r = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  return { theme: seasonalThemeOrDefault(r.theme), live: r.live === true };
}

/**
 * House footer blurb shown when the admin left About empty.
 * Generic enough for any place; admin text always wins when present.
 */
export const DEFAULT_ABOUT: Bilingual = {
  en: 'Quality you can trust, fair prices — every day.',
  ar: 'جودة تستاهل، أسعار مناسبة — كل يوم.',
};

/**
 * House tagline shown when the admin left Tagline empty.
 * Same pattern as the footer blurb: generic, admin text always wins.
 */
export const DEFAULT_TAGLINE: Bilingual = {
  en: 'Fresh · Fast · Delicious',
  ar: 'طازج · سريع · شهي',
};

/**
 * Footer description text in the requested language: admin copy first
 * (with the other language as fallback), house default when both are blank.
 */
export function aboutOrDefault(v: unknown, lang: 'en' | 'ar'): string {
  const t = bilingualBlock(v, 300);
  const primary = (lang === 'ar' ? t.ar : t.en).trim();
  if (primary) return primary;
  const other = (lang === 'ar' ? t.en : t.ar).trim();
  return other || DEFAULT_ABOUT[lang];
}

/**
 * Tagline text in the requested language: admin copy first
 * (with the other language as fallback), house default when both are blank.
 */
export function taglineOrDefault(v: unknown, lang: 'en' | 'ar'): string {
  const t = bilingualBlock(v, 80);
  const primary = (lang === 'ar' ? t.ar : t.en).trim();
  if (primary) return primary;
  const other = (lang === 'ar' ? t.en : t.ar).trim();
  return other || DEFAULT_TAGLINE[lang];
}
