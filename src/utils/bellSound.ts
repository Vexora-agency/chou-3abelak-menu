/**
 * Premium bell chime — synthesized with WebAudio, zero audio assets.
 * Two soft strikes (E5 + B5, a gentle fifth) with inharmonic bell partials
 * and a long exponential decay: a warm "ding-ding", never a harsh beep.
 * Master gain is kept low on purpose.
 *
 * The deep autoplay problem this solves: on iOS Safari (and hardened
 * Chrome), an AudioContext BORN while suspended can stay stuck forever —
 * resume() on it is a silent no-op, so the first ring works (born in a
 * tap) and every later ring dies quietly ("plays once, then never").
 * The fix is not to nurse the stuck context but to BIRTH A FRESH ONE
 * inside every user gesture — a context created in a tap starts running.
 * Anything that still cannot play is queued by the caller (pending set
 * flushed on gestures/polls/visibility) instead of being dropped.
 * Never throws, never rejects.
 */

let ctx: AudioContext | null = null;
let unlocked = false;

function audioCtor(): typeof AudioContext | null {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    return AC ?? null;
  } catch {
    return null;
  }
}

/** Lazily create (or return) the shared context. May be suspended. */
function sharedContext(): AudioContext | null {
  try {
    if (ctx) {
      // Dead contexts never recover — drop so the next birth is fresh.
      if (ctx.state === 'closed' || ctx.state === 'interrupted') {
        try {
          void ctx.close().catch(() => {});
        } catch {}
        ctx = null;
      } else {
        return ctx;
      }
    }
    const AC = audioCtor();
    if (!AC) return null;
    ctx = new AC();
    return ctx;
  } catch {
    return null;
  }
}

/**
 * MUST run inside a user gesture: drops any stuck context and births a
 * fresh one, which starts running. Never recreates a healthy context
 * (a tap mid-ring must not cut the decay tail).
 */
function ensureLiveInGesture(): void {
  try {
    if (ctx && ctx.state === 'running') {
      try {
        void ctx.resume().catch(() => {});
      } catch {}
      return;
    }
    if (ctx) {
      try {
        void ctx.close().catch(() => {});
      } catch {}
      ctx = null;
    }
    const AC = audioCtor();
    if (!AC) return;
    ctx = new AC();
    if (ctx.state === 'suspended') {
      try {
        void ctx.resume().catch(() => {});
      } catch {}
    }
  } catch {}
}

/** Call once from the app shell: keeps audio born fresh on every gesture. */
export function unlockBellAudio(): void {
  if (unlocked) return;
  unlocked = true;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  window.addEventListener('pointerdown', ensureLiveInGesture, { passive: true });
  // touchstart fires before any click synthesis on iOS — earliest unlock.
  window.addEventListener('touchstart', ensureLiveInGesture, { passive: true });
  window.addEventListener('touchend', ensureLiveInGesture, { passive: true });
  window.addEventListener('keydown', ensureLiveInGesture);
  window.addEventListener('focus', ensureLiveInGesture);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      try {
        ensureLiveInGesture();
      } catch {}
    }
  });
}

function strike(ac: AudioContext, at: number, freq: number, volume: number): void {
  // Bell-ish partials: fundamental + inharmonic overtones, fast attack,
  // ~1.8s decay. All sine — smooth, no harsh harmonics.
  const partials: Array<[number, number]> = [
    [1, 1],
    [2.4, 0.35],
    [5.43, 0.12],
  ];
  for (const [ratio, amp] of partials) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq * ratio;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(volume * amp, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.8);
    osc.connect(gain).connect(ac.destination);
    osc.start(at);
    osc.stop(at + 1.9);
  }
}

function strikeNow(ac: AudioContext): void {
  const now = ac.currentTime + 0.02;
  strike(ac, now, 659.25, 0.16); // E5
  strike(ac, now + 0.35, 987.77, 0.14); // B5 — a gentle fifth above
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Ring the chime. Resolves true ONLY on a real strike. A suspended
 * context gets resume attempts (~1.2s budget); anything still blocked
 * resolves false so the caller keeps it queued — combined with
 * gesture-born contexts, the chime lands on the next tap at the latest.
 */
export async function playBellChime(): Promise<boolean> {
  try {
    const ac = sharedContext();
    if (!ac) return false;
    // Read fresh each call (a function defeats TS property narrowing —
    // resume() genuinely flips suspended -> running at runtime).
    const stateOf = (): AudioContextState => {
      try {
        return ac.state;
      } catch {
        return 'suspended';
      }
    };
    if (stateOf() === 'running') {
      try {
        strikeNow(ac);
        return true;
      } catch {
        return false;
      }
    }
    for (let i = 0; i < 6; i++) {
      try {
        void ac.resume().catch(() => {});
      } catch {}
      await sleep(200);
      if (stateOf() === 'running') {
        try {
          strikeNow(ac);
          return true;
        } catch {
          return false;
        }
      }
    }
    return false;
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
