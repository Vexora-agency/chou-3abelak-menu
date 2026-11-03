/**
 * Bell sound library: the 5 owner-pickable chimes for the kitchen bell
 * (admin dashboard) and the customer bell (menu page). Every pattern is
 * DATA only — one strike list of { freq, at, vol } inside a ~2s chime —
 * rendered by BOTH engines (Web Audio oscillators + runtime WAV for the
 * silent-switch-proof <audio> path), so all 5 sound identical everywhere
 * with zero audio files and zero network cost.
 *
 * The alarm mechanism is shared too: 2s chime + 2s silence every 4s for
 * at most ALARM_SESSION_MS per continuous session.
 */

/** One strike inside a chime: Hz, seconds from chime start, 0..1 gain. */
export interface BellStrike {
  freq: number;
  at: number;
  vol: number;
}

export type BellSoundId = 'classic' | 'triple' | 'urgent' | 'soft' | 'gong';

export interface BellPattern {
  id: BellSoundId;
  name: { en: string; ar: string };
  hint: { en: string; ar: string };
  strikes: BellStrike[];
}

const E5 = 659.25;
const B5 = 987.77;
const E6 = 1318.51;
const A5 = 880;
const C6 = 1046.5;
const E4 = 329.63;
const A4 = 440;

export const BELL_SOUNDS: BellPattern[] = [
  {
    id: 'classic',
    name: { en: 'Classic ding-ding', ar: 'دين-دين كلاسيك' },
    hint: { en: 'Warm alternating fifth', ar: 'نغمة دافئة متعاقبة' },
    strikes: [
      { freq: E5, at: 0, vol: 0.16 },
      { freq: B5, at: 0.5, vol: 0.14 },
      { freq: E5, at: 1.0, vol: 0.14 },
      { freq: B5, at: 1.5, vol: 0.12 },
    ],
  },
  {
    id: 'triple',
    name: { en: 'Triple bell', ar: 'الجرس الثلاثي' },
    hint: { en: 'Rising triple strike', ar: 'ثلاث دقات متصاعدة' },
    strikes: [
      { freq: E5, at: 0, vol: 0.16 },
      { freq: B5, at: 0.4, vol: 0.14 },
      { freq: E5, at: 0.8, vol: 0.14 },
      { freq: B5, at: 1.2, vol: 0.13 },
      { freq: E6, at: 1.6, vol: 0.12 },
    ],
  },
  {
    id: 'urgent',
    name: { en: 'Urgent beeps', ar: 'تنبيه سريع' },
    hint: { en: 'Four sharp same-note beeps', ar: 'أربع نغمات حادة متتالية' },
    strikes: [
      { freq: A5, at: 0, vol: 0.2 },
      { freq: A5, at: 0.45, vol: 0.2 },
      { freq: A5, at: 0.9, vol: 0.2 },
      { freq: A5, at: 1.35, vol: 0.2 },
    ],
  },
  {
    id: 'soft',
    name: { en: 'Soft whisper', ar: 'همس ناعم' },
    hint: { en: 'Gentle high chime, low volume', ar: 'رنين عالٍ هادئ بصوت منخفض' },
    strikes: [
      { freq: C6, at: 0, vol: 0.09 },
      { freq: E6, at: 0.55, vol: 0.08 },
      { freq: C6, at: 1.1, vol: 0.08 },
      { freq: E6, at: 1.6, vol: 0.07 },
    ],
  },
  {
    id: 'gong',
    name: { en: 'Deep gong', ar: 'جرس عميق' },
    hint: { en: 'Low warm bell', ar: 'جرس دافئ منخفض' },
    strikes: [
      { freq: E4, at: 0, vol: 0.22 },
      { freq: A4, at: 0.55, vol: 0.2 },
      { freq: E4, at: 1.1, vol: 0.18 },
      { freq: A4, at: 1.6, vol: 0.16 },
    ],
  },
];

/** Resolve any stored value to a real pattern (unknown -> classic). */
export function bellPatternById(id: unknown): BellPattern {
  const found = typeof id === 'string' ? BELL_SOUNDS.find((p) => p.id === id) : undefined;
  return found ?? BELL_SOUNDS[0];
}

/** True only for one of the 5 ids (settings validation gate). */
export function isBellSoundId(id: unknown): id is BellSoundId {
  return typeof id === 'string' && BELL_SOUNDS.some((p) => p.id === id);
}

/** Chime length in seconds (last strike + tail) for WAV sizing. */
export function bellPatternDuration(p: BellPattern): number {
  const last = p.strikes.reduce((m, s) => Math.max(m, s.at), 0);
  return last + 0.7;
}

/** Alarm session cap: 30 minutes per continuous unacknowledged period. */
export const ALARM_SESSION_MS = 30 * 60 * 1000;
/** Chime (~2s) + silence (~2s) = one 4s cycle. */
export const ALARM_INTERVAL_MS = 4000;
