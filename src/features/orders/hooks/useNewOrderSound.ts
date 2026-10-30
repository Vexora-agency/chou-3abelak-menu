import { useEffect, useRef } from 'react';

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

/** Two-tone kitchen bell, Web Audio only — zero assets, zero deps. */
export function playNewOrderBeep(retryOnSuspend = true) {
  const ac = ensureCtx();
  if (!ac) return;
  // Suspended (no gesture yet): schedule anyway (harmless silence) and try
  // once more shortly after — covers the unlock landing mid-poll.
  if (ac.state !== 'running' && retryOnSuspend && typeof window !== 'undefined') {
    window.setTimeout(() => playNewOrderBeep(false), 600);
  }
  try {
    const t = ac.currentTime;
    [880, 1174.66].forEach((freq, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const at = t + i * 0.17;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.4, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(at);
      osc.stop(at + 0.18);
    });
  } catch {}
}

/**
 * Beeps when order ids appear that weren't in the previous poll. First load
 * never beeps (baseline, not news). Respects the owner's toggle.
 */
export function useNewOrderSound(orderIds: string[], enabled: boolean) {
  const prevRef = useRef<string[] | null>(null);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = orderIds;
    if (!enabled || !prev || prev.length === 0) return;
    const known = new Set(prev);
    if (orderIds.some((id) => !known.has(id))) playNewOrderBeep();
  }, [orderIds, enabled]);
}

/**
 * Kitchen alarm: while `active` (unacknowledged new orders exist) AND the
 * bell is on, beep every 3s until the owner acknowledges. Each ack (or
 * cancel) re-evaluates: silence returns the moment no new order is left.
 * Paused when the tab is hidden; cleaned up on unmount/toggle-off.
 */
export function useNewOrderAlarm(active: boolean, enabled: boolean) {
  useEffect(() => {
    if (!active || !enabled) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') playNewOrderBeep();
    }, 3000);
    return () => window.clearInterval(id);
  }, [active, enabled]);
}
