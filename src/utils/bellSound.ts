/**
 * Premium bell chime — synthesized with WebAudio, zero audio assets.
 * Two soft strikes (E6 + B6, just-intonation-ish fifth) with inharmonic
 * bell partials and a long exponential decay: a warm "ding-ding", never
 * a harsh beep. Master gain is kept low on purpose.
 *
 * Autoplay rules: the context is created/resumed on the first user gesture
 * (sticky activation) — playBellChime() silently returns false when the
 * browser still blocks audio. Never throws, never rejects.
 */

let ctx: AudioContext | null = null;
let unlocked = false;

function ensureContext(): AudioContext | null {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return ctx.state === 'running' ? ctx : null;
  } catch {
    return null;
  }
}

/** Call once from the app shell: unlocks audio on the first interaction. */
export function unlockBellAudio(): void {
  if (unlocked) return;
  unlocked = true;
  const unlock = () => {
    try {
      ensureContext();
    } catch {}
  };
  window.addEventListener('pointerdown', unlock, { once: true, passive: true });
  window.addEventListener('keydown', unlock, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      try {
        ensureContext();
      } catch {}
    }
  });
}

function strike(at: number, freq: number, volume: number): void {
  if (!ctx) return;
  // Bell-ish partials: fundamental + inharmonic overtones, fast attack,
  // ~1.8s decay. All sine — smooth, no harsh harmonics.
  const partials: Array<[number, number]> = [
    [1, 1],
    [2.4, 0.35],
    [5.43, 0.12],
  ];
  for (const [ratio, amp] of partials) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq * ratio;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(volume * amp, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.8);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 1.9);
  }
}

/** Ring the chime. Returns true when it actually played. */
export function playBellChime(): boolean {
  try {
    const ac = ensureContext();
    if (!ac) return false;
    const now = ac.currentTime;
    strike(now, 659.25, 0.16); // E5
    strike(now + 0.35, 987.77, 0.14); // B5 — a gentle fifth above
    return true;
  } catch {
    return false;
  }
}

/** Short double-tap vibration on new orders (mobile only, guarded). */
export function vibrateBell(): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate([70, 60, 70]);
    }
  } catch {}
}
