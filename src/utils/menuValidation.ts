import { MenuData } from '@/src/types/menu';
import {
  autoplayIntervalOrDefault,
  bilingualBlock,
  clockTimeOrDefault,
  courierSpeedOrDefault,
  DEFAULT_ABOUT,
  DEFAULT_TAGLINE,
  etaMinutesOrDefault,
  isoDateOrNull,
  receiveDelayOrDefault,
  roadFactorOrDefault,
  socialFlagsOrDefault,
  socialOrderOrDefault,
  soundsOrDefault,
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
type NotificationsInput = Partial<MenuData['settings']['notifications']> & {
  events?: Partial<MenuData['settings']['notifications']['events']>;
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
  const n = ((s as unknown as { notifications?: unknown }).notifications || {}) as NotificationsInput;
  const ne = (n.events && typeof n.events === 'object' ? n.events : {}) as Partial<MenuData['settings']['notifications']['events']>;
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
      sounds: soundsOrDefault((s as unknown as { sounds?: unknown }).sounds),
      badges: (() => {
        const b = (s as unknown as { badges?: unknown }).badges;
        const o = b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
        const intOr = (v: unknown, fb: number, min: number, max: number) =>
          Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : fb;
        return { newDays: intOr(o.newDays, 14, 1, 365), topDays: intOr(o.topDays, 30, 1, 365), topCount: intOr(o.topCount, 6, 1, 50) };
      })(),
      showMore: (() => {
        const sm = (s as unknown as { showMore?: unknown }).showMore;
        const o = sm && typeof sm === 'object' ? (sm as Record<string, unknown>) : {};
        const intOr = (v: unknown, fb: number) =>
          Number.isInteger(v) && (v as number) >= 4 && (v as number) <= 50 ? (v as number) : fb;
        return { initial: intOr(o.initial, 12), batch: intOr(o.batch, 8) };
      })(),
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
        pausedAt: isoDateOrNull((o as { pausedAt?: unknown }).pausedAt),
        pausedMessage: bilingualBlock((o as { pausedMessage?: unknown }).pausedMessage, 160),
        acceptWhenClosed: (o as { acceptWhenClosed?: unknown }).acceptWhenClosed === true,
        prepMinutes: etaMinutesOrDefault((o as { prepMinutes?: unknown }).prepMinutes, 15),
        kitchenMinutesPerOrder: etaMinutesOrDefault((o as { kitchenMinutesPerOrder?: unknown }).kitchenMinutesPerOrder, 3),
        courierSpeedKmh: courierSpeedOrDefault((o as { courierSpeedKmh?: unknown }).courierSpeedKmh),
        roadFactor: roadFactorOrDefault((o as { roadFactor?: unknown }).roadFactor),
        defaultDeliveryMinutes: etaMinutesOrDefault((o as { defaultDeliveryMinutes?: unknown }).defaultDeliveryMinutes, 20),
        receiveDelayDeliveryMin: receiveDelayOrDefault((o as { receiveDelayDeliveryMin?: unknown }).receiveDelayDeliveryMin, 30),
        receiveDelayPickupMin: receiveDelayOrDefault((o as { receiveDelayPickupMin?: unknown }).receiveDelayPickupMin, 15),
      },
      notifications: {
        senderName: typeof n.senderName === 'string' ? n.senderName.slice(0, 80) : '',
        replyTo: typeof n.replyTo === 'string' ? n.replyTo.slice(0, 254) : '',
        events: {
          placed: ne.placed !== false,
          confirmed: ne.confirmed !== false,
          completed: ne.completed !== false,
          cancelled: ne.cancelled !== false,
          receipt_check: ne.receipt_check !== false,
        },
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
