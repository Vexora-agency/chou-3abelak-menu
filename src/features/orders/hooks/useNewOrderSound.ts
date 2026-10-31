import { useEffect, useRef } from 'react';
import {
  ALARM_INTERVAL_MS,
  ALARM_SESSION_MS,
  bellPatternById,
  type BellSoundId,
} from '@/src/utils/bellPatterns';

let ctx: AudioContext | null = null;

function ensureCtx(): AudioContext | null {
  try {
    if (typeof window === 'undefined') return null;
    if (!ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Call from a user gesture (toggle-on, first tap) so autoplay policy unlocks. */
export function unlockOrderSound() {
  ensureCtx();
}

/**
 * True while the browser refuses audio (no gesture yet / autoplay block).
 * The dashboard shows a "tap anywhere" hint in this state instead of
 * beeping into the void.
 */
export function isAudioLocked(): boolean {
  try {
    if (!ctx) return true;
    return ctx.state !== 'running';
  } catch {
    return true;
  }
}

/**
 * Kitchen bell: the owner-picked 2-second chime, Web Audio only — zero
 * assets, zero deps. Zero bytes over the network (smaller than any
 * compressed MP3), so it never affects site speed: the tone is
 * synthesized at play time. `sound` is one of the 5 library ids
 * (unknown -> classic); the alarm interval below re-fires every 4s
 * (2s sound + 2s silence) for a 30-minute session.
 */
export function playNewOrderBeep(sound?: BellSoundId | string | null) {
  const ac = ensureCtx();
  if (!ac) return;
  // Suspended (no gesture yet): schedule anyway (harmless silence) and retry
  // on a widening ladder — the alarm re-fires every tick anyway, so a late
  // unlock still catches sound within seconds instead of losing this beep.
  // Each retry re-resolves the context (never re-ladders: bounded, 2 shots).
  if (ac.state !== 'running' && typeof window !== 'undefined') {
    const retryOnce = () => {
      try {
        const c2 = ensureCtx();
        if (c2 && c2.state === 'running') playOnce(c2, sound);
      } catch {}
    };
    window.setTimeout(retryOnce, 600);
    window.setTimeout(retryOnce, 2500);
  }
  playOnce(ac, sound);
}

function playOnce(ac: AudioContext, sound?: BellSoundId | string | null) {
  try {
    const pattern = bellPatternById(sound);
    const t = ac.currentTime;
    // Bell-ish partials per strike: fundamental + inharmonic overtones,
    // fast attack, ~0.45s decay. All sine — smooth, no harsh harmonics.
    for (const s of pattern.strikes) {
      const partials: Array<[number, number]> = [[1, 1], [2.4, 0.35], [5.43, 0.12]];
      for (const [ratio, amp] of partials) {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'sine';
        osc.frequency.value = s.freq * ratio;
        const at = t + s.at;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.001, s.vol * amp), at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
        osc.connect(gain);
        gain.connect(ac.destination);
        osc.start(at);
        osc.stop(at + 0.5);
      }
    }
  } catch {}
}

/** Alarm session cap: 30 minutes per continuous unacknowledged period. */
export const KITCHEN_ALARM_SESSION_MS = ALARM_SESSION_MS;
/** Chime (2s) + silence (2s) = one 4s cycle. */
export const KITCHEN_ALARM_INTERVAL_MS = ALARM_INTERVAL_MS;

/**
 * Beeps when order ids appear that weren't in the previous poll. First load
 * never beeps (baseline, not news). Respects the owner's toggle.
 */
export function useNewOrderSound(orderIds: string[], enabled: boolean, sound?: BellSoundId | string | null) {
  const prevRef = useRef<string[] | null>(null);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = orderIds;
    if (!enabled || !prev || prev.length === 0) return;
    const known = new Set(prev);
    if (orderIds.some((id) => !known.has(id))) playNewOrderBeep(soundRef.current);
  }, [orderIds, enabled]);
}

/**
 * Kitchen alarm: while `active` (unacknowledged new orders exist) AND the
 * bell is on, play the picked 2s chime every 4s (2s sound + 2s silence)
 * for at most 30 minutes per continuous session. Each ack (or cancel)
 * re-evaluates: silence returns the moment no new order is left, and a
 * fresh order after silence starts a new 30-minute session.
 * Paused when the tab is hidden; cleaned up on unmount/toggle-off.
 */
export function useNewOrderAlarm(active: boolean, enabled: boolean, sound?: BellSoundId | string | null) {
  const soundRef = useRef(sound);
  soundRef.current = sound;
  useEffect(() => {
    if (!active || !enabled) return;
    const sessionStart = Date.now();
    // Immediate chime on session start so the owner hears it at once.
    if (document.visibilityState === 'visible') playNewOrderBeep(soundRef.current);
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - sessionStart > ALARM_SESSION_MS) return;
      playNewOrderBeep(soundRef.current);
    }, ALARM_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [active, enabled]);
}
