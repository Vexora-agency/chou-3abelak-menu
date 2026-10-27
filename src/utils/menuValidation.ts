import { MenuData } from '@/src/types/menu';
import {
  autoplayIntervalOrDefault,
  bilingualBlock,
  clockTimeOrDefault,
  DEFAULT_ABOUT,
  DEFAULT_TAGLINE,
  isoDateOrNull,
  socialFlagsOrDefault,
  socialOrderOrDefault,
  statusModeOrDefault,
  tickerSpeedOrDefault,
  timezoneOrDefault,
  workingDaysOrAll,
} from '@/src/utils/settingsDefaults';

type AnnouncementInput = Partial<MenuData['settings']['announcement']> & {
  text?: Partial<{ en: string; ar: string }>;
};
type PrivacyInput = Partial<MenuData['settings']['privacy']> & {
  extra?: Partial<{ en: string; ar: string }>;
};

/** Fill optional settings blocks missing from old/seed docs so editors never
 *  read `undefined`. Mirrors the server validator's defaults (validate.js).
 *  Never mutates the input. */
export function ensureSettingsBlocks(menu: MenuData): MenuData {
  const s = menu.settings as MenuData['settings'] & {
    announcement?: AnnouncementInput;
    privacy?: PrivacyInput;
  };
  const a = s.announcement || {};
  const p = s.privacy || {};
  const o = (s as unknown as { ordering?: Record<string, unknown> }).ordering || {};
  return {
    ...menu,
    settings: {
      ...s,
      statusMode: statusModeOrDefault(s.statusMode),
      openTime: clockTimeOrDefault(s.openTime, '12:00'),
      closeTime: clockTimeOrDefault(s.closeTime, '00:00'),
      workingDays: workingDaysOrAll((s as unknown as { workingDays?: unknown }).workingDays),
      timezone: timezoneOrDefault(s.timezone),
      socialEnabled: socialFlagsOrDefault((s as unknown as { socialEnabled?: unknown }).socialEnabled),
      socialOrder: socialOrderOrDefault((s as unknown as { socialOrder?: unknown }).socialOrder),
      about: (() => {
        const a = bilingualBlock((s as unknown as { about?: unknown }).about, 300);
        return { en: a.en || DEFAULT_ABOUT.en, ar: a.ar || DEFAULT_ABOUT.ar };
      })(),
      tagline: (() => {
        const t = bilingualBlock((s as unknown as { tagline?: unknown }).tagline, 80);
        return { en: t.en || DEFAULT_TAGLINE.en, ar: t.ar || DEFAULT_TAGLINE.ar };
      })(),
      currency: (s.currency as unknown as { en?: unknown } | undefined)?.en ? s.currency : { en: 'LBP', ar: 'ل.ل' },
      defaultTheme: (s as unknown as { defaultTheme?: unknown }).defaultTheme === 'light' ? 'light' : 'dark',
      defaultLang: (s as unknown as { defaultLang?: unknown }).defaultLang === 'ar' ? 'ar' : 'en',
      featuredAutoplay: (s as unknown as { featuredAutoplay?: unknown }).featuredAutoplay !== undefined
        ? Boolean((s as unknown as { featuredAutoplay: unknown }).featuredAutoplay)
        : true,
      featuredAutoplayInterval: autoplayIntervalOrDefault(
        (s as unknown as { featuredAutoplayInterval?: unknown }).featuredAutoplayInterval
      ),
      ordering: {
        ...(o as object),
        enabled: Boolean((o as { enabled?: unknown }).enabled),
        types: Array.isArray((o as { types?: unknown }).types) && ((o as { types: unknown[] }).types).length
          ? ((o as { types: unknown[] }).types).filter((t) => ['delivery', 'pickup', 'dinein'].includes(t as string)) as MenuData['settings']['ordering']['types']
          : (['delivery', 'pickup', 'dinein'] as MenuData['settings']['ordering']['types']),
        minOrder: typeof (o as { minOrder?: unknown }).minOrder === 'number' ? (o as { minOrder: number }).minOrder : 0,
        deliveryFee: typeof (o as { deliveryFee?: unknown }).deliveryFee === 'number' ? (o as { deliveryFee: number }).deliveryFee : 0,
        minOrderEnabled: typeof (o as { minOrderEnabled?: unknown }).minOrderEnabled === 'boolean'
          ? (o as { minOrderEnabled: boolean }).minOrderEnabled
          : Number((o as { minOrder?: unknown }).minOrder) > 0,
        deliveryFeeEnabled: typeof (o as { deliveryFeeEnabled?: unknown }).deliveryFeeEnabled === 'boolean'
          ? (o as { deliveryFeeEnabled: boolean }).deliveryFeeEnabled
          : Number((o as { deliveryFee?: unknown }).deliveryFee) > 0,
        note: bilingualBlock((o as { note?: unknown }).note, 120),
        paused: (o as { paused?: unknown }).paused === true,
        pausedUntil: isoDateOrNull((o as { pausedUntil?: unknown }).pausedUntil),
        pausedMessage: bilingualBlock((o as { pausedMessage?: unknown }).pausedMessage, 160),
        acceptWhenClosed: (o as { acceptWhenClosed?: unknown }).acceptWhenClosed === true,
      },
      announcement: {
        enabled: a.enabled === true,
        text: {
          en: typeof a.text?.en === 'string' ? a.text.en : '',
          ar: typeof a.text?.ar === 'string' ? a.text.ar : '',
        },
        startsAt: isoDateOrNull(a.startsAt),
        expiresAt: isoDateOrNull(a.expiresAt),
        scroll: a.scroll !== false,
        speed: tickerSpeedOrDefault(a.speed),
      },
      privacy: {
        extra: {
          en: typeof p.extra?.en === 'string' ? p.extra.en : '',
          ar: typeof p.extra?.ar === 'string' ? p.extra.ar : '',
        },
        reviewed: p.reviewed === true,
      },
    },
  };
}
