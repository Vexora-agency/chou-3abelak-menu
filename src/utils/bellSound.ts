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

function sharedContext(): AudioContext | null {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    return ctx;
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
      const ac = sharedContext();
      if (ac && ac.state === 'suspended') void ac.resume().catch(() => {});
    } catch {}
  };
  // touchend covers mobile Safari cases where pointerdown alone is not
  // treated as a user gesture for AudioContext.
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('touchend', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      try {
        const ac = sharedContext();
        if (ac && ac.state === 'suspended') void ac.resume().catch(() => {});
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

/** Ring the chime. Returns true when a strike was scheduled. */
export function playBellChime(): boolean {
  try {
    const ac = sharedContext();
    if (!ac) return false;
    const strikeNow = () => {
      try {
        const now = ac.currentTime + 0.02;
        strike(now, 659.25, 0.16); // E5
        strike(now + 0.35, 987.77, 0.14); // B5 — a gentle fifth above
      } catch {}
    };
    if (ac.state === 'running') {
      strikeNow();
      return true;
    }
    // First-touch race: the context exists but is still suspended (common
    // when the ring fires from a poll instead of a tap). Resume and retry
    // shortly instead of dropping the chime forever.
    try {
      void ac.resume().catch(() => {});
    } catch {}
    window.setTimeout(() => {
      try {
        if (ac.state === 'running') {
          const now = ac.currentTime + 0.02;
          strike(now, 659.25, 0.16);
          strike(now + 0.35, 987.77, 0.14);
        }
      } catch {}
    }, 450);
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
