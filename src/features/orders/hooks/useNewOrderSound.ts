import { useEffect, useRef } from 'react';
import {
  ALARM_INTERVAL_MS,
  ALARM_SESSION_MS,
  bellPatternById,
  type BellSoundId,
} from '@/src/utils/bellPatterns';

let ctx: AudioContext | null = null;

// Overlap guard: the 2 s beep must never stack on itself (session-start
// chime + toggle beep + new-order beep can land in the same second).
// Calls inside the cooldown are dropped — the 4 s alarm loop re-fires
// anyway, so nothing is lost, only the stutter. Timestamp set
// synchronously at schedule time (never after an await).
let lastBeepStartMs = 0;
const BEEP_COOLDOWN_MS = 2000;

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
  // Single-flight: skip when the previous beep is still ringing.
  const now = Date.now();
  if (now - lastBeepStartMs < BEEP_COOLDOWN_MS) return;
  lastBeepStartMs = now;
  // Suspended (no gesture yet): do NOT schedule on the frozen context —
  // those nodes are inaudible (or a stacked blast on a late resume) while
  // the timestamp above is already consumed, and the same-tick alarm chime
  // is then eaten by the cooldown: the classic silent first order. The
  // bounded ladder (2 shots) owns this beep instead — each retry
  // re-resolves the context, awaits resume, and plays at most once per
  // ladder (played flag), only when truly running. Concurrent triggers
  // stay single-flighted by the timestamp above (no ladder stacking); the
  // 4s alarm loop remains the long-term net while still locked.
  if (ac.state !== 'running' && typeof window !== 'undefined') {
    let played = false;
    const retryOnce = () => {
      if (played) return;
      try {
        const c2 = ensureCtx();
        if (!c2) return;
        // resume() flips state asynchronously on real browsers — a
        // synchronous check right after the call always sees 'suspended'
        // and drops the retry. Await it first, then check.
        void c2
          .resume()
          .catch(() => {})
          .then(() => {
            try {
              if (played) return;
              if (c2.state !== 'running') return;
              played = true;
              playOnce(c2, sound);
            } catch {}
          });
      } catch {}
    };
    window.setTimeout(retryOnce, 600);
    window.setTimeout(retryOnce, 2500);
    return;
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
 * Beeps when order ids appear that weren't in the previous poll. The first
 * effect run never beeps (prev === null is the baseline, not news). An
 * empty baseline IS news on transition: [] -> [A] is a real arrival, so it
 * beeps here instead of leaning on the alarm, which only covers
 * status === 'new'. No double-beep: the alarm's session-start chime lands on
 * the same tick and the 2s single-flight guard merges them into one.
 */
export function useNewOrderSound(orderIds: string[], enabled: boolean, sound?: BellSoundId | string | null) {
  const prevRef = useRef<string[] | null>(null);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = orderIds;
    if (!enabled || !prev) return;
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
